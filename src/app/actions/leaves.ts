"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, leafEditAttempts, leaves, productTypes } from "@/db/schema";
import {
  isKnownHubspotProductTypeValue,
  loadHubspotProductTypeOptions,
} from "@/lib/hubspot-product-type-vocabulary";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  DIRECT_SERVICE_IDENTITIES,
  type DirectServiceIdentity,
} from "@/lib/product-structure/direct-service";
import { assertCanCreateLeaves } from "@/lib/spec-permission-guard";
import {
  loadLibraryBrowse,
  type LibraryBrowseFilters,
  type LibraryBrowseResult,
} from "@/lib/library-browse-loader";
import { ensureUser } from "@/lib/auth/ensure-user";
import { mapLeafToHubspotCreate, mapLeafToHubspotUpdate } from "@/lib/hubspot-mapper";
import {
  hubspotUpdateLanded,
  hubspotWriteOutcomeOf,
  toHubSpotProductUpdateProperties,
} from "@/lib/integrations/hubspot-provider";
import { hasUsableSku } from "@/lib/product-structure/attachment-eligibility";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { revalidatePath } from "next/cache";

// Phase A.1 v2 impl-4 — server actions for the leaves library table.
//
// `createLeaf(formData)` — Creates a globally-scoped library leaf.
// No quote_id (leaves are scenario-spanning per the library
// concept). Permission gated by users.can_create_leaves; admin
// role implicit-passes via assertCanCreateLeaves.
//
// slice-hubspot-bidirectional (May 2026) — HubSpot-first pattern
// restored. Pre-Phase-A.1-v2, the legacy `addProductSku` action
// wrote to HubSpot before the local DB row; the impl-4 refactor
// lost the write-back. This action now:
//   1. Validate input
//   2. Call HubSpot `createProduct` with name + sku + unit_cost
//      + url (push mapping per Concern C disposition)
//   3. On HubSpot success: insert `leaves` row with the returned
//      `hubspot_product_id` populated
//   4. On HubSpot failure: surface as VALIDATION error; no local
//      row created (HubSpot is authoritative — orphan local rows
//      would diverge the catalog)
//   5. Audit `leaf_create` carries hubspot_product_id +
//      source='nexus_authored'
//
// HubSpot-first ordering trade-off: if HubSpot succeeds but the
// DB INSERT fails, we have an orphan HubSpot product. PM re-tries
// → second HubSpot create would normally 22-error on duplicate
// hs_sku (HubSpot enforces SKU uniqueness when set); without SKU
// the orphan stays untracked. This matches the legacy pattern
// per `hubspot.ts:64-68` Pattern 32 banking — acceptable for v1.
//
// Audit: emits `leaf_create` per CLAUDE.md namespace. diff_json
// carries identity + initial commercial fields + the new
// `hubspot_product_id` + `source` discriminator.

export async function createLeaf(
  formData: FormData,
): Promise<ActionResult<{ leafId: string }>> {
  return runAction(async () => {
    const name = String(formData.get("name") ?? "").trim();
    const sku = String(formData.get("sku") ?? "").trim() || null;
    // Step 8 · `productTypeId` is NO LONGER READ. A leaf's classification is
    // HubSpot's alone; accepting a Nexus type here would have left the second
    // authority creatable at the exact moment a product enters the Library.
    //
    // HubSpot classification — the INTERNAL option value the dropdown carried,
    // never the label it displayed.
    const hubspotProductTypeRaw =
      String(formData.get("hubspotProductType") ?? "").trim();
    const hubspotProductType =
      hubspotProductTypeRaw === "" ? null : hubspotProductTypeRaw;
    // BV-012 §5 — the Nexus-governed commercial classification. Local only:
    // it is a statement about what Nexus may sell this as, not a HubSpot
    // property, so the HubSpot mapper below is deliberately untouched.
    //
    // Defaults to `product`, so the entire existing create path is unchanged
    // by its presence — a caller that sends nothing gets exactly what it got
    // before.
    const commercialKindRaw = String(formData.get("commercialKind") ?? "").trim();
    const serviceIdentityRaw = String(formData.get("serviceIdentity") ?? "").trim();
    const commercialKind: "product" | "service" =
      commercialKindRaw === "service" ? "service" : "product";
    const serviceIdentityCandidate =
      commercialKind === "service" && serviceIdentityRaw !== ""
        ? serviceIdentityRaw
        : null;

    if (commercialKindRaw !== "" && commercialKindRaw !== "product" && commercialKindRaw !== "service") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${commercialKindRaw}" is not a commercial kind. Expected "product" or "service".`,
      );
    }
    // Refused here as well as by the DB CHECK. The constraint would catch it,
    // but as a 500 naming a constraint; an operator needs to be told that a
    // service has to say WHICH service.
    if (commercialKind === "service" && serviceIdentityCandidate === null) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "A service needs a service identity — formulation, filling / blending, " +
          "pack-out / assembly, testing / micros, or other service.",
      );
    }
    // Narrowed here rather than cast at the insert. A cast would let a future
    // edit widen the accepted set without the compiler noticing; the predicate
    // makes the type follow the validation instead of asserting past it.
    const isGoverned = (v: string): v is DirectServiceIdentity =>
      (DIRECT_SERVICE_IDENTITIES as readonly string[]).includes(v);
    if (serviceIdentityCandidate !== null && !isGoverned(serviceIdentityCandidate)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${serviceIdentityCandidate}" is not a governed Direct Service identity. ` +
          `BV-012 §5.f keeps this set closed: ${DIRECT_SERVICE_IDENTITIES.join(", ")}.`,
      );
    }
    const serviceIdentity: DirectServiceIdentity | null = serviceIdentityCandidate;

    const unitCostRaw = String(formData.get("unitCost") ?? "").trim();
    const unitCost = unitCostRaw === "" ? null : unitCostRaw;
    const ownerIdRaw = String(formData.get("ownerId") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim() || null;

    if (!name)
      throw new ActionGuardError(ERR.VALIDATION, "name required");

    // CREATION IS OPEN TO EVERY AUTHENTICATED USER for beta.
    //
    // Business disposition, Edward 2026-08-27: "all Nexus users are authorized
    // to create a new Product Library item", so the unavailability of
    // + Create new product was never an intentional restriction.
    //
    // This REMOVES a check rather than adding one. `assertCanCreateLeaves` is
    // deliberately still used by `restoreLeaf` below and by
    // `pullProductsBatch` — un-archiving a library item and pulling the
    // HubSpot catalog are not creation, and the disposition changes only who
    // may initiate creation. Widening the shared guard would have carried both
    // along with it.
    //
    // Every other rule on this path is untouched: name is still required
    // above, and the HubSpot-first write-back below still governs the
    // library/HubSpot semantics.
    const user = await ensureUser();

    // HubSpot-first write-back. Push mapping per Concern C
    // disposition: name + sku + unit_cost + url + technical catalog price.
    // Price defaults to 0.00 at the mapper/provider boundary and is never a
    // Nexus quote or Sales Order transaction rate. Other
    // HubSpot product attributes (description, owner, FSC fields,
    // image_url) stay HubSpot-empty until pull-back or HubSpot UI
    // edit.
    // Reject anything that is not a member of the governed option set. This is
    // what stops a display label being written into the value's place — HubSpot
    // would accept "Primary Packaging" as a free string, and it would then match
    // no filter and no report, silently.
    if (hubspotProductType) {
      const options = await loadHubspotProductTypeOptions();
      if (!isKnownHubspotProductTypeValue(hubspotProductType, options)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `"${hubspotProductType}" is not a current HubSpot product type. ` +
            `Expected one of the internal option values, not a display label.`,
        );
      }
    }

    // ── A Direct Service is Nexus-local: no HubSpot product is created ────
    //
    // The HubSpot-first pattern exists because a packaging product's downstream
    // identity IS its HubSpot catalog record. A Direct Service's downstream
    // identity is a BV-011 accounting destination, resolved at NetSuite
    // projection (Stage 7) — HubSpot is not in that path, so creating a catalog
    // product for it would put a row in a system that has no question to answer
    // about it.
    //
    // This is why the commercial classification never travels: not merely
    // "don't send those two fields", but no HubSpot write at all for a service.
    // `hubspot_product_id` is nullable precisely for Nexus-local entries.
    const isService = commercialKind === "service";

    let hubspotProductId: string | null = null;
    let hubspotSubmittedProperties: Record<string, string> | null = null;
    let hubspotResponseBody: Record<string, unknown> | null = null;

    if (!isService) {
      const hubspotInput = mapLeafToHubspotCreate({
        name,
        sku,
        unitCost,
        url,
        hubspotProductType,
      });
      try {
        const { hubspot } = await getApplicationDependencies();
        const result = await hubspot.createProduct(hubspotInput);
        hubspotProductId = result.id;
        hubspotSubmittedProperties = result.submittedProperties;
        hubspotResponseBody = result.responseBody;
      } catch (err) {
        // HubSpot failures (network, 4xx, 5xx) surface as VALIDATION
        // so the modal UI can render the message inline. No local
        // row created.
        const message =
          err instanceof Error
            ? `Could not create product in HubSpot: ${err.message}`
            : "Could not create product in HubSpot (unknown error).";
        throw new ActionGuardError(ERR.VALIDATION, message);
      }
    }

    const inserted = await db
      .insert(leaves)
      .values({
        name,
        sku,
        unitCost,
        ownerId: ownerIdRaw === "" ? null : ownerIdRaw,
        url,
        archived: false,
        hubspotProductId,
        // Persisted from the same value sent to HubSpot, so a later pull
        // re-reading the product finds the classification unchanged.
        // NULL for a service — see the branch above.
        hubspotProductType: isService ? null : hubspotProductType,
        commercialKind,
        serviceIdentity,
      })
      .returning();
    const newRow = inserted[0];

    // Audit: `leaf_create` per CLAUDE.md namespace. `source:
    // 'nexus_authored'` distinguishes PM-driven creates from
    // pull-driven creates (which carry source='hubspot_pull' via
    // the pullProductsBatch executor in src/lib/hubspot-pull.ts).
    await writeAuditEntry({
      userId: user.id,
      entityType: "leaf",
      entityId: newRow.id,
      action: "leaf_create",
      diffJson: {
        name: newRow.name,
        sku: newRow.sku,
        unit_cost: newRow.unitCost,
        owner_id: newRow.ownerId,
        url: newRow.url,
        hubspot_product_id: newRow.hubspotProductId,
        hubspot_product_create_request: {
          properties: hubspotSubmittedProperties,
        },
        hubspot_product_create_response: hubspotResponseBody,
        source: "nexus_authored",
        created_by: user.id,
      },
    });

    // Revalidate any surface that lists library leaves. For impl-4
    // the practical effect is on the Setup tree which doesn't
    // directly render library leaves (only attached leaves via
    // assembly_leaves); revalidation here is a no-op in v1 but
    // future surfaces (impl-5 library browse) will pick up the
    // new row via this path.
    revalidatePath("/projects/[id]/quotes/[quoteId]/setup", "page");

    return { leafId: newRow.id };
  });
}

/**
 * slice-library-modal-polish Step 5 — restore a previously
 * archived library leaf (sets archived=false). Mirror of the
 * pull-flow's leaf_archive write but UI-driven; gated on
 * canCreateLeaves (same permission as create + refresh affordances
 * per Catch #6 disposition).
 *
 * Audit: `leaf_restored` action (new entry in the audit_log
 * namespace; documented in CLAUDE.md). diff_json carries from/to
 * shape: { archived: { from: true, to: false } }.
 *
 * Nexus-side only — when the leaf has a hubspot_product_id, the
 * HubSpot product remains archived on the HubSpot side. v1
 * tolerance per Pattern 32 (pre-production engineering tolerance);
 * v1.1+ bidirectional sync candidate.
 */
/**
 * Correct an existing Library product.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * It did not. `leaves.ts` exported create, restore and two reads, and nothing
 * that could change a product after it was made. So a product created without
 * a SKU could never acquire one -- while `attachment-eligibility` refused to
 * attach it and told the operator to "Add a SKU to the product in the Library",
 * naming a mechanism that was not there.
 *
 * Recreating was the only route available. Two `MISTR - 4oz Lube Silicone`
 * products do exist, 31 seconds apart with different HubSpot ids -- that is
 * confirmed. WHY they were created is not: nothing in the record establishes
 * that the missing edit path produced them, and the plausibility of the story
 * is not evidence for it. The duplicates are reported; their cause is open.
 *
 * ── WHAT IT DELIBERATELY WILL NOT DO ──────────────────────────────────────
 *
 * REPLACE AN ESTABLISHED SKU. Assigning a SKU to a product that has none is a
 * completion; changing one that downstream identity already depends on is a
 * different operation with a different blast radius -- frozen quotes, NetSuite
 * items and an operator's own memory may all point at the old value. It is
 * refused here and needs its own controlled path.
 *
 * TOUCH HISTORY. This writes `leaves` only. Frozen quote snapshots and
 * `leaf_specs` pins are untouched: a pin records what classification resolved
 * to AT THE MOMENT OF ATTACHMENT, and rewriting it would change what a quote
 * is recorded as having been built from. A reclassification here reaches
 * FUTURE attachments, which is what makes this master data rather than a
 * global edit.
 */
type LeafEditValues = {
  name: string;
  sku: string | null;
  url: string | null;
  unitCost: string | null;
  hubspotProductType: string | null;
};

export type LeafEditOutcome = {
  leafId: string;
  syncedToHubspot: boolean;
  /**
   * How the HubSpot write was ESTABLISHED to have ended, not how it appeared
   * to end.
   *
   *   applied        the call returned
   *   reconciled     the call failed and a read-back proved it had applied
   *   already_held   a recovery read the product first and found the recorded
   *                  values already there -- nothing was re-sent
   *   recovered      a recovery re-sent the recorded edit and it applied
   *   not_linked     the product has no HubSpot counterpart
   */
  hubspotOutcome:
    | "applied"
    | "reconciled"
    | "already_held"
    | "recovered"
    | "not_linked";
};

function describeObservedSku(
  observed: Record<string, string | null> | null,
): string {
  if (!observed) return "";
  const remote = observed.hs_sku;
  if (!remote) return "";
  return ` HubSpot currently holds the SKU "${remote}" for this product.`;
}

/**
 * The core of an edit, shared by the operator's save and by the recovery of an
 * edit whose remote outcome was never confirmed.
 *
 * ── THREE PHASES, AND WHY THE MIDDLE ONE HOLDS NO TRANSACTION ────────────
 *
 *   A · claim      lock, validate, and COMMIT the intent. Short.
 *   B · remote     the HubSpot call. No lock, no transaction, no connection.
 *   C · settle     lock again, write locally, resolve the intent. Short.
 *
 * The intent is committed in A -- before the request is issued -- because a
 * record written after a failure is written too late twice over. A's rollback
 * would release the lock before the record existed, letting another edit write
 * over an unconfirmed remote state; and a process that dies during B would
 * leave no trace at all. A committed `pending` row closes both: it is a claim
 * other writers can see, and it outlives the process that made it.
 *
 * It also removes the cost the previous shape had to pay -- a database
 * connection held open across a remote round trip.
 */
async function applyLeafEdit(opts: {
  userId: string;
  leafId: string;
  values: LeafEditValues;
  expectedVersion: string | null;
  recovery: { id: string; version: number } | null;
}): Promise<LeafEditOutcome> {
  const { userId, leafId, expectedVersion, recovery } = opts;
  const { hubspot } = await getApplicationDependencies();

  const lockLeaf = sql`select pg_advisory_xact_lock(hashtextextended(${`leaf:${leafId}`}, 0))`;

  // ── PHASE A · CLAIM ───────────────────────────────────────────────────
  const claim = await db.transaction(async (tx) => {
    await tx.execute(lockLeaf);
    if (opts.values.sku !== null) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`sku:${opts.values.sku.toUpperCase()}`}, 0))`,
      );
    }

    // Re-read UNDER the lock. The row read before it may already have moved.
    const [existing] = await tx
      .select()
      .from(leaves)
      .where(eq(leaves.id, leafId))
      .limit(1);
    if (!existing) throw new ActionGuardError(ERR.NOT_FOUND, "Product not found.");

    const [open] = await tx
      .select()
      .from(leafEditAttempts)
      .where(
        and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)),
      )
      .limit(1);

    if (recovery) {
      // ── THE RECOVERY MUST STILL BE THE OPEN ONE ──────────────────────
      //
      // Checked HERE, under the lock, not when the attempt was loaded. A
      // recovery that read an open attempt and then queued behind another
      // recovery of the same attempt would otherwise find it resolved,
      // satisfy "no open attempt", and proceed -- skipping the version
      // protection it is exempt from precisely because it was supposed to be
      // replaying a live one.
      if (!open || open.id !== recovery.id) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This unconfirmed edit has already been settled, by another recovery " +
            "or by someone else. Nothing was sent. Reload the product to see " +
            "where it ended up.",
        );
      }
      // ── CLAIM THE RECOVERY, DO NOT MERELY OBSERVE IT ─────────────────
      //
      // Reading "still open" is not enough. The attempt is not resolved until
      // phase C, so two recoveries that both read it here BOTH see it open,
      // both pass, and both send -- the lock serialises them and changes
      // nothing, because neither has done anything the other can see.
      //
      // Bumping the version under the lock is the thing the other one can
      // see. The second names a version that no longer matches, matches zero
      // rows, and stops before the remote call.
      const claimed = await tx
        .update(leafEditAttempts)
        .set({ version: open.version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(leafEditAttempts.id, recovery.id),
            eq(leafEditAttempts.version, recovery.version),
            isNull(leafEditAttempts.resolvedAt),
          ),
        )
        .returning({ id: leafEditAttempts.id });
      if (claimed.length === 0) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This unconfirmed edit has already been settled, or is being " +
            "recovered by someone else. Nothing was sent. Reload the product " +
            "to see where it ended up.",
        );
      }
    } else if (open && open.outcome === "pending") {
      // A CLAIM THAT HAS NOT COME BACK. Which is all that is known.
      //
      // It may be an edit still running, or one whose process died between
      // its remote call and its local write. Nothing at read time separates
      // those, and a timer would not separate them either -- it would just
      // dress a guess up as a fact. So the refusal claims neither.
      //
      // Recovery is offered for both, because recovering is safe against a
      // live edit as well as an abandoned one: it takes the claim exclusively
      // by version, and phase C resolves conditionally, so whichever settles
      // first wins and the other aborts before writing anything.
      throw new ActionGuardError(
        ERR.UNCONFIRMED_EDIT,
        "This product has an edit that was claimed and has not been settled. " +
          "It may still be running, or it may have been interrupted -- nothing " +
          "here can tell those apart. Nothing was saved. Try again in a moment, " +
          "or recover the claimed edit if it was interrupted.",
      );
    } else if (open) {
      // An unresolved attempt blocks ordinary editing: the product has a
      // remote state nobody has confirmed, and editing over it would
      // overwrite whatever is actually there -- including a SKU HubSpot may
      // have issued that Nexus never recorded. Local state cannot answer
      // that, because local state is exactly what failed to be written.
      const observed = open.observed as Record<string, string | null> | null;
      throw new ActionGuardError(
        ERR.UNCONFIRMED_EDIT,
        "An earlier edit to this product was never confirmed in HubSpot, so " +
          "what HubSpot holds is not known to match what Nexus holds." +
          describeObservedSku(observed) +
          " Recover that edit before making another -- editing over an " +
          "unconfirmed state would overwrite whatever is actually there.",
      );
    }

    if (!recovery) {
      const currentVersion = existing.updatedAt
        ? new Date(existing.updatedAt).toISOString()
        : null;
      if (currentVersion !== expectedVersion) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This product changed while you were editing it. Nothing was saved, " +
            "because saving would have overwritten that change with the values " +
            "you loaded before it. Reload the product and re-apply your edit.",
        );
      }
    }

    // A recovery's values come from the PERSISTED attempt, amendments
    // included, read here under the lock. Not from the caller's memory: an
    // amendment accepted in one request and applied from another process's
    // copy is an amendment that can be lost.
    const values: LeafEditValues = recovery
      ? {
          ...(open!.attempted as LeafEditValues),
          ...((open!.amended as Partial<LeafEditValues> | null) ?? {}),
          // Never amendable. The SKU is the identity-bearing field and is the
          // reason ordinary editing is blocked in the first place.
          sku: (open!.attempted as LeafEditValues).sku,
        }
      : opts.values;

    const hadSku = hasUsableSku(existing.sku);
    if (hadSku && values.sku !== existing.sku) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `This product's SKU is already established as "${existing.sku}". ` +
          "Downstream identity may depend on it -- quotes already sent, and the " +
          "NetSuite item it resolves to -- so replacing it is a separate " +
          "controlled correction, not an ordinary edit.",
      );
    }

    if (values.sku !== null) {
      const normalized = values.sku.toUpperCase();
      const clash = await tx
        .select({ id: leaves.id, name: leaves.name, sku: leaves.sku })
        .from(leaves)
        .where(
          sql`upper(btrim(${leaves.sku})) = ${normalized} and ${leaves.id} <> ${leafId}`,
        )
        .limit(1);
      if (clash.length > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `SKU "${values.sku}" already belongs to "${clash[0].name}". A SKU ` +
            "identifies one product; two products cannot share one.",
        );
      }

      // ── AN OPEN ATTEMPT IS ALSO A CLAIM ON ITS SKU ─────────────────
      //
      // `leaves.sku` does not carry the claim until phase C, so two products
      // completing the same SKU at once BOTH read it free -- the SKU lock
      // serialises them and they still both pass, because the first has not
      // written anything the second can see. The attempt row is what the
      // first wrote, and checking it is what makes the lock mean something.
      //
      // It also covers the case `leaves` never will: a claim whose process
      // died mid-flight still holds the SKU until someone settles it.
      const claimedElsewhere = await tx
        .select({
          id: leafEditAttempts.id,
          leafId: leafEditAttempts.leafId,
          attempted: leafEditAttempts.attempted,
        })
        .from(leafEditAttempts)
        .where(
          and(
            isNull(leafEditAttempts.resolvedAt),
            sql`${leafEditAttempts.leafId} <> ${leafId}`,
            sql`upper(btrim(coalesce(${leafEditAttempts.amended}->>'sku', ${leafEditAttempts.attempted}->>'sku'))) = ${normalized}`,
          ),
        )
        .limit(1);
      if (claimedElsewhere.length > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `SKU "${values.sku}" is already claimed by another product whose edit ` +
            "is in progress or unconfirmed. A SKU identifies one product; that " +
            "claim has to be settled before this one can take it.",
        );
      }
    }

    const update = mapLeafToHubspotUpdate(values);
    const submitted = toHubSpotProductUpdateProperties(update);

    // THE CLAIM ITSELF. Committed with this transaction, before anything is
    // sent. The partial unique index makes it exclusive.
    let attemptId = recovery?.id ?? null;
    if (!recovery) {
      const [row] = await tx
        .insert(leafEditAttempts)
        .values({
          leafId,
          hubspotProductId: existing.hubspotProductId,
          attempted: values,
          submitted,
          outcome: "pending",
          createdBy: userId,
        })
        .returning({ id: leafEditAttempts.id });
      attemptId = row.id;
    }

    return {
      attemptId: attemptId!,
      existing,
      values,
      update,
      submitted,
      hadSku,
    };
  });

  // ── PHASE B · REMOTE ──────────────────────────────────────────────────
  const { attemptId, existing, values, update, submitted, hadSku } = claim;
  const productId = existing.hubspotProductId;
  let hubspotOutcome: LeafEditOutcome["hubspotOutcome"] = "not_linked";

  if (productId) {
    // A RECOVERY READS BEFORE IT WRITES.
    //
    // The outstanding request may have completed after the read-back that
    // failed to see it -- a request that timed out is not a request that
    // stopped. Re-sending would work by idempotence, but it would also mean
    // this path never actually establishes what HubSpot holds, and a case
    // that only passes because the write is repeatable is not evidence that
    // the read happened.
    let alreadyHeld = false;
    if (recovery) {
      try {
        const snap = await hubspot.getProduct(productId);
        alreadyHeld = Boolean(snap && hubspotUpdateLanded(snap, update));
      } catch {
        // Unreadable. Fall through and send; the outcome is adjudicated the
        // same way any other uncertain write is.
      }
    }

    if (alreadyHeld) {
      hubspotOutcome = "already_held";
    } else {
      try {
        await hubspot.updateProduct(productId, update);
        hubspotOutcome = recovery ? "recovered" : "applied";
      } catch (e) {
        const verdict = hubspotWriteOutcomeOf(e);
        const detail = e instanceof Error ? e.message : String(e);

        if (verdict === "rejected") {
          // HubSpot answered and refused. Nothing applied -- so the claim is
          // released rather than left standing over a product that never
          // moved.
          await settleAttempt(attemptId, {
            resolution: "rejected",
            reason: detail,
          });
          throw new ActionGuardError(
            ERR.HUBSPOT,
            `HubSpot refused the update, so nothing was changed. ${detail}`,
          );
        }

        let observed: Record<string, string | null> | null = null;
        let readable = true;
        try {
          const snap = await hubspot.getProduct(productId);
          observed = snap?.properties ?? null;
          if (snap && hubspotUpdateLanded(snap, update)) {
            hubspotOutcome = "reconciled";
          } else {
            readable = true;
            await markUnconfirmed(attemptId, observed, true, detail);
            throw new ActionGuardError(
              ERR.HUBSPOT,
              "HubSpot did not confirm this update. Reading the product back " +
                "shows it does NOT hold the requested values -- it may have " +
                "applied in part, or hold values from elsewhere. Nexus was not " +
                "changed. Your edit has been kept: recover it to retry exactly " +
                `what you asked for. (${detail})`,
            );
          }
        } catch (readErr) {
          if (readErr instanceof ActionGuardError) throw readErr;
          readable = false;
          await markUnconfirmed(attemptId, null, false, detail);
          throw new ActionGuardError(
            ERR.HUBSPOT,
            "HubSpot did not confirm this update and could not be read back, " +
              "so whether it applied is UNKNOWN. Nexus was not changed. Your " +
              "edit has been kept: recover it to retry exactly what you asked " +
              `for. (${detail})`,
          );
        }
        void readable;
      }
    }
  }

  // ── PHASE C · SETTLE ──────────────────────────────────────────────────
  try {
    await db.transaction(async (tx) => {
      await tx.execute(lockLeaf);

      const before = {
        name: existing.name,
        sku: existing.sku,
        url: existing.url,
        unit_cost: existing.unitCost,
        hubspot_product_type: existing.hubspotProductType,
      };
      const after = {
        name: values.name,
        sku: values.sku,
        url: values.url,
        unit_cost: values.unitCost,
        hubspot_product_type: values.hubspotProductType,
      };

      // RESOLVE FIRST, AND CONDITIONALLY. If this claim has already been
      // settled -- by a recovery that overtook a slow live edit, or by
      // anything else -- then this process no longer speaks for the product
      // and must not write to it. Matching zero rows is the signal, and it
      // has to be read before the row is touched rather than after.
      const settled = await tx
        .update(leafEditAttempts)
        .set({
          resolvedAt: new Date(),
          resolution: hubspotOutcome,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leafEditAttempts.id, attemptId),
            isNull(leafEditAttempts.resolvedAt),
          ),
        )
        .returning({ id: leafEditAttempts.id });
      if (settled.length === 0) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This edit was settled by someone else while it was in flight. " +
            "HubSpot holds what was sent; Nexus was not written by this " +
            "attempt. Reload the product to see where it ended up.",
        );
      }

      await tx
        .update(leaves)
        .set({
          name: values.name,
          sku: values.sku,
          url: values.url,
          unitCost: values.unitCost,
          hubspotProductType: values.hubspotProductType,
          updatedAt: new Date(),
        })
        .where(eq(leaves.id, leafId));

      const changed = Object.keys(after).filter(
        (k) =>
          (before as Record<string, unknown>)[k] !==
          (after as Record<string, unknown>)[k],
      );

      await writeAuditEntry(
        {
          userId,
          entityType: "leaf",
          entityId: leafId,
          action: "leaf_updated",
          diffJson: {
            changed_fields: changed,
            before,
            after,
            sku_completed: !hadSku && values.sku !== null,
            hubspot_product_id: productId,
            synced_to_hubspot: productId !== null,
            hubspot_outcome: hubspotOutcome,
            attempt_id: attemptId,
            submitted,
          },
        },
        tx,
      );
    });
  } catch (e) {
    // A deliberate abort is not a divergence: the claim was already settled
    // by whoever won, and re-opening it would manufacture an unresolved state
    // out of an orderly one.
    if (e instanceof ActionGuardError) throw e;
    // HubSpot moved and the local half did not. The claim STAYS OPEN, which
    // is what keeps the next edit from overwriting values HubSpot already
    // holds -- and it was already durable before any of this began.
    await markDiverged(
      attemptId,
      Object.fromEntries(
        Object.entries(submitted).map(([k, v]) => [k, v === "" ? null : v]),
      ),
      e instanceof Error ? e.message : String(e),
    );
    throw new ActionGuardError(
      ERR.DATA_INTEGRITY,
      "HubSpot was updated but Nexus could not record it, so the two now " +
        "disagree about this product. Your edit has been kept: recover it to " +
        "bring Nexus into line. Editing this product normally is blocked until " +
        "then, so the values HubSpot already holds are not overwritten. " +
        `(${e instanceof Error ? e.message : String(e)})`,
    );
  }

  revalidatePath("/");
  return {
    leafId,
    syncedToHubspot: productId !== null,
    hubspotOutcome,
  };
}

/** Close a claim that turned out to protect nothing. */
async function settleAttempt(
  attemptId: string,
  opts: { resolution: string; reason: string },
): Promise<void> {
  await db
    .update(leafEditAttempts)
    .set({
      resolvedAt: new Date(),
      resolution: opts.resolution,
      reason: opts.reason,
      updatedAt: new Date(),
    })
    .where(eq(leafEditAttempts.id, attemptId));
}

async function markUnconfirmed(
  attemptId: string,
  observed: Record<string, string | null> | null,
  readable: boolean,
  detail: string,
): Promise<void> {
  await db
    .update(leafEditAttempts)
    .set({
      outcome: "unconfirmed",
      observed,
      reason: readable
        ? `read-back did not match the requested state: ${detail}`
        : `read-back could not be performed: ${detail}`,
      updatedAt: new Date(),
    })
    .where(eq(leafEditAttempts.id, attemptId));
}

async function markDiverged(
  attemptId: string,
  observed: Record<string, string | null>,
  detail: string,
): Promise<void> {
  await db
    .update(leafEditAttempts)
    .set({
      outcome: "diverged",
      observed,
      reason: `local write failed after HubSpot applied: ${detail}`,
      updatedAt: new Date(),
    })
    .where(eq(leafEditAttempts.id, attemptId));
}

function readLeafEditValues(formData: FormData): LeafEditValues {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new ActionGuardError(ERR.VALIDATION, "Product name is required.");

  const skuRaw = String(formData.get("sku") ?? "").trim();
  const unitCostRaw = String(formData.get("unitCost") ?? "").trim();
  const unitCost = unitCostRaw === "" ? null : unitCostRaw;
  if (unitCost !== null && !/^\d+(\.\d+)?$/.test(unitCost)) {
    // Checked here rather than left to the column. An unparseable cost would
    // otherwise fail at the UPDATE -- after HubSpot had already been written
    // -- turning an operator typo into a divergence between two catalogues.
    throw new ActionGuardError(
      ERR.VALIDATION,
      `"${unitCost}" is not a unit cost. Enter a number, or leave it empty.`,
    );
  }
  const hsTypeRaw = String(formData.get("hubspotProductType") ?? "").trim();

  return {
    name,
    sku: skuRaw === "" ? null : skuRaw,
    url: String(formData.get("url") ?? "").trim() || null,
    unitCost,
    hubspotProductType: hsTypeRaw === "" ? null : hsTypeRaw,
  };
}

export async function updateLeaf(
  formData: FormData,
): Promise<ActionResult<LeafEditOutcome>> {
  return runAction(async () => {
    const user = await ensureUser();
    await assertCanCreateLeaves();

    const leafId = String(formData.get("leafId") ?? "").trim();
    if (!leafId) throw new ActionGuardError(ERR.VALIDATION, "leafId is required.");

    // REQUIRED, not optional. An optional version token protects only the
    // callers that remember to send one, and the callers that forget lose
    // other people's edits silently -- which is the failure it exists to
    // prevent. Refusing loudly is the only version of this that works.
    const expectedVersion = String(formData.get("expectedUpdatedAt") ?? "").trim();
    if (!expectedVersion) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "expectedUpdatedAt is required: an edit must say which version of the product it was written against.",
      );
    }

    const values = readLeafEditValues(formData);

    // Read-only and slow; done before the lock so it is not held across it.
    if (values.hubspotProductType) {
      const options = await loadHubspotProductTypeOptions();
      if (!isKnownHubspotProductTypeValue(values.hubspotProductType, options)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `"${values.hubspotProductType}" is not a current HubSpot product type.`,
        );
      }
    }

    return applyLeafEdit({
      userId: user.id,
      leafId,
      values,
      expectedVersion,
      recovery: null,
    });
  });
}

/**
 * Recover an edit whose remote outcome was never confirmed.
 *
 * Replays THE RECORDED ATTEMPT, read under the lock at the moment it is
 * applied -- not values carried from the request that composed it.
 *
 * The product is read back FIRST, because the outstanding write may have
 * completed late. If HubSpot already holds the recorded values, nothing is
 * re-sent.
 *
 * Amendments are PERSISTED before anything is sent. A correction accepted in
 * one request and applied from another process's memory is a correction that
 * an interruption can lose, and the whole point of this path is that an
 * interruption loses nothing.
 */
export async function retryLeafEdit(
  formData: FormData,
): Promise<ActionResult<LeafEditOutcome>> {
  return runAction(async () => {
    const user = await ensureUser();
    await assertCanCreateLeaves();

    const leafId = String(formData.get("leafId") ?? "").trim();
    if (!leafId) throw new ActionGuardError(ERR.VALIDATION, "leafId is required.");

    const amendment = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`leaf:${leafId}`}, 0))`,
      );
      const [open] = await tx
        .select()
        .from(leafEditAttempts)
        .where(
          and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)),
        )
        .limit(1);
      if (!open) {
        throw new ActionGuardError(
          ERR.NOT_FOUND,
          "There is no unconfirmed edit to recover for this product.",
        );
      }

      const recorded = open.attempted as LeafEditValues;
      const observed = open.observed as Record<string, string | null> | null;

      // ── THE SKU IS PINNED ────────────────────────────────────────────
      //
      // A recovery replays the recorded edit. The correctable fields may be
      // amended, because a recorded attempt can be unrecoverable on its own
      // terms -- the value that broke the local write is IN the record and
      // fails identically on every replay, which would lock the product
      // behind its own attempt forever. The identity-bearing field may not.
      const pinnedSku = observed?.hs_sku ?? recorded.sku;
      const submittedSku = String(formData.get("sku") ?? "").trim();
      if (submittedSku !== "" && pinnedSku !== null && submittedSku !== pinnedSku) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `Recovery cannot change the SKU. This product's unconfirmed edit is for ` +
            `"${pinnedSku}"${
              observed?.hs_sku ? " and HubSpot already holds it" : ""
            }; recovering settles that, and replacing it is a separate ` +
            "controlled correction.",
        );
      }

      // Only fields the caller actually supplied become amendments.
      const amended: Partial<LeafEditValues> = {};
      for (const key of ["name", "url", "unitCost", "hubspotProductType"] as const) {
        const raw = formData.get(key);
        if (raw === null) continue;
        const v = String(raw).trim();
        const next = v === "" ? null : v;
        if (key === "name" && next === null) continue;
        if (next !== recorded[key]) {
          (amended as Record<string, string | null>)[key] = next;
        }
      }
      if (
        amended.unitCost !== undefined &&
        amended.unitCost !== null &&
        !/^\d+(\.\d+)?$/.test(amended.unitCost)
      ) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `"${amended.unitCost}" is not a unit cost. Enter a number, or leave it empty.`,
        );
      }

      let version = open.version;
      if (Object.keys(amended).length > 0) {
        // Persisted, and version-bumped, BEFORE anything is sent. Two
        // operators amending the same attempt cannot silently overwrite one
        // another: the loser's recovery names a version that no longer
        // matches and is refused.
        const merged = {
          ...((open.amended as Partial<LeafEditValues> | null) ?? {}),
          ...amended,
        };
        version = open.version + 1;
        await tx
          .update(leafEditAttempts)
          .set({ amended: merged, version, updatedAt: new Date() })
          .where(
            and(
              eq(leafEditAttempts.id, open.id),
              eq(leafEditAttempts.version, open.version),
              isNull(leafEditAttempts.resolvedAt),
            ),
          );
      }

      return { id: open.id, version };
    });

    return applyLeafEdit({
      userId: user.id,
      leafId,
      values: {
        name: "",
        sku: null,
        url: null,
        unitCost: null,
        hubspotProductType: null,
      },
      expectedVersion: null,
      recovery: amendment,
    });
  });
}

export async function restoreLeaf(
  leafId: string,
): Promise<ActionResult<{ leafId: string }>> {
  return runAction(async () => {
    const user = await assertCanCreateLeaves();

    const [existing] = await db
      .select({ id: leaves.id, archived: leaves.archived, name: leaves.name })
      .from(leaves)
      .where(eq(leaves.id, leafId))
      .limit(1);

    if (!existing) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Leaf not found.");
    }
    if (!existing.archived) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Leaf is already active. Nothing to restore.",
      );
    }

    await db
      .update(leaves)
      .set({ archived: false, updatedAt: new Date() })
      .where(eq(leaves.id, leafId));

    await writeAuditEntry({
      userId: user.id,
      entityType: "leaf",
      entityId: leafId,
      action: "leaf_restored",
      diffJson: {
        archived: { from: true, to: false },
        leaf_name: existing.name,
      },
    });

    revalidatePath("/projects/[id]/quotes/[quoteId]/setup", "page");
    return { leafId };
  });
}

/**
 * Phase A.1 v2 impl-5 — server action wrapper for client-side
 * library browse data fetch.
 *
 * Client opens the library browse modal → calls this action with
 * the filter state → receives the row list. The action is just
 * an authenticated wrapper around `loadLibraryBrowse` so the
 * client can use it via useTransition without server-only imports.
 */
export async function fetchLibraryBrowse(
  filters: LibraryBrowseFilters,
): Promise<ActionResult<LibraryBrowseResult>> {
  return runAction(async () => {
    // Auth check (server-only context); throws if signed out.
    await ensureUser();
    const result = await loadLibraryBrowse(filters);
    return result;
  });
}

/**
 * The governed `hs_product_type` option set, for the create-product dropdown.
 *
 * A server action rather than a threaded prop: the vocabulary is HubSpot-side
 * configuration, and fetching it where it is used keeps the authority in one
 * place instead of copying it down a component chain that would then need to
 * stay in sync.
 *
 * Labels are for display, values are what get sent and stored — the two differ
 * on the three largest categories, so the dropdown must carry both rather than
 * reconstructing one from the other.
 */
export async function fetchHubspotProductTypes(): Promise<
  ActionResult<{ options: { label: string; value: string }[] }>
> {
  return runAction(async () => {
    await ensureUser();
    const options = await loadHubspotProductTypeOptions();
    return { options: options.map((o) => ({ label: o.label, value: o.value })) };
  });
}
