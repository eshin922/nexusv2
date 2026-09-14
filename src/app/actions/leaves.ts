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
   *   applied       the call returned
   *   reconciled    the call failed and a read-back proved it had applied
   *   already_held  a retry read the product first and found the saved values
   *                 already there -- nothing was re-sent
   *   converged_unknown
   *                 both catalogs now hold the saved values, but an earlier
   *                 request was never answered and may still land. The claim
   *                 stays open; see the support procedure
   *   not_linked    the product has no HubSpot counterpart
   */
  hubspotOutcome:
    | "applied"
    | "reconciled"
    | "already_held"
    | "converged_unknown"
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
 * The core of an edit, shared by the operator's save and by retrying a saved
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
 * ── WHY A RETRY IS AN IDENTICAL REPLAY, AND WHY THAT IS THE WHOLE ANSWER ──
 *
 * When a request fails without an answer, it may still be in flight. If a
 * LATER request carrying DIFFERENT values is accepted and the earlier one then
 * lands on top of it, the two catalogs disagree and nothing local can prevent
 * it -- the ordering is decided on the far side.
 *
 * A retry that re-sends the SAME values has no such exposure: whichever
 * request lands last, HubSpot ends up holding the same thing. So the retry
 * replays the saved intent EXACTLY, and a different edit is refused until it
 * has. Converge first, then edit -- rather than letting a second, different
 * state be introduced while the first is still unsettled.
 *
 * That is what makes releasing safe after a retry succeeds, and it is why this
 * needs no amendment path, no confirmation step and no permanent hold.
 */
async function applyLeafEdit(opts: {
  userId: string;
  leafId: string;
  values: LeafEditValues;
  expectedVersion: string | null;
  retryOf: { id: string; version: number } | null;
}): Promise<LeafEditOutcome> {
  const { userId, leafId, expectedVersion, retryOf } = opts;
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

    if (retryOf) {
      // The retry must still own the claim, checked HERE rather than when it
      // was loaded. Two retries that both read "still open" would otherwise
      // both send -- the attempt is not resolved until phase C, so neither has
      // done anything the other can see. Taking the version is what the other
      // one can see.
      if (!open || open.id !== retryOf.id || open.version !== retryOf.version) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This saved edit has already been retried, or settled, by someone " +
            "else. Nothing was sent. Reload the product to see where it ended up.",
        );
      }
      const claimed = await tx
        .update(leafEditAttempts)
        .set({ version: open.version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(leafEditAttempts.id, retryOf.id),
            eq(leafEditAttempts.version, retryOf.version),
            isNull(leafEditAttempts.resolvedAt),
          ),
        )
        .returning({ id: leafEditAttempts.id });
      if (claimed.length === 0) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This saved edit is already being retried. Nothing was sent.",
        );
      }
    } else if (open) {
      // A saved edit is outstanding. A DIFFERENT edit now would introduce a
      // second state while the first is unsettled -- which is exactly the
      // situation an identical replay avoids. Retry first.
      const observed = open.observed as Record<string, string | null> | null;
      throw new ActionGuardError(
        ERR.UNCONFIRMED_EDIT,
        (open.outcome === "pending"
          ? "Another edit to this product has not finished yet. Try again in a moment."
          : open.outcome === "converged_unknown"
            ? "Both catalogs hold this product's saved values, but an earlier " +
              "request to HubSpot was never answered and may still land. A " +
              "DIFFERENT edit now could be overwritten by it without warning. " +
              "This needs the documented support procedure -- see the product's " +
              "saved edit."
            : open.outcome === "diverged"
              ? "An earlier edit reached HubSpot but was not recorded in Nexus, " +
                "so the two disagree. Retry the saved edit to bring them back " +
                "into line; nothing is outstanding at HubSpot."
              : "An earlier edit to this product was never confirmed in HubSpot, " +
                "so what HubSpot holds is not known to match what Nexus holds. " +
                "Retry that saved edit -- it re-sends exactly what was asked for, " +
                "so it is safe whichever request lands last.") +
          describeObservedSku(observed),
      );
    }

    if (!retryOf) {
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

    // A retry's values come from the PERSISTED attempt, read here under the
    // lock. Identical to what was originally submitted -- that is the point.
    const values: LeafEditValues = retryOf
      ? (open!.attempted as LeafEditValues)
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
        .select({ id: leaves.id, name: leaves.name })
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

      // An open attempt is ALSO a claim on its SKU: `leaves.sku` does not
      // carry it until phase C, so two products completing one SKU would both
      // read it free and the SKU lock would change nothing.
      const claimedElsewhere = await tx
        .select({ id: leafEditAttempts.id })
        .from(leafEditAttempts)
        .where(
          and(
            isNull(leafEditAttempts.resolvedAt),
            sql`${leafEditAttempts.leafId} <> ${leafId}`,
            sql`upper(btrim(${leafEditAttempts.attempted}->>'sku')) = ${normalized}`,
          ),
        )
        .limit(1);
      if (claimedElsewhere.length > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `SKU "${values.sku}" is already claimed by another product whose edit ` +
            "is in progress or unconfirmed. That claim has to be settled before " +
            "this one can take it.",
        );
      }
    }

    const update = mapLeafToHubspotUpdate(values);
    const submitted = toHubSpotProductUpdateProperties(update);

    // THE CLAIM ITSELF. Committed with this transaction, before anything is
    // sent. The partial unique index makes it exclusive.
    let attemptId = retryOf?.id ?? null;
    let claimedVersion = retryOf ? retryOf.version + 1 : 1;
    if (!retryOf) {
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
        .returning({ id: leafEditAttempts.id, version: leafEditAttempts.version });
      attemptId = row.id;
      claimedVersion = row.version;
    }

    return {
      attemptId: attemptId!,
      claimedVersion,
      // Carried from the attempt, not from this request. Whether an EARLIER
      // request was ever left unanswered is what decides if settling is safe,
      // and this request's own outcome cannot tell us.
      unanswered: Boolean(open?.unanswered),
      priorObserved: (open?.observed ?? null) as Record<string, string | null> | null,
      existing,
      values,
      update,
      submitted,
      hadSku,
    };
  });

  // ── PHASE B · REMOTE ──────────────────────────────────────────────────
  const {
    attemptId,
    claimedVersion,
    unanswered,
    priorObserved,
    existing,
    values,
    update,
    submitted,
    hadSku,
  } = claim;
  const productId = existing.hubspotProductId;
  let hubspotOutcome: LeafEditOutcome["hubspotOutcome"] = "not_linked";

  if (productId) {
    // A RETRY READS BEFORE IT WRITES. The outstanding request may have
    // completed after the read-back that failed to see it, and re-sending
    // would work by idempotence without ever establishing that.
    let alreadyHeld = false;
    if (retryOf) {
      try {
        const snap = await hubspot.getProduct(productId);
        alreadyHeld = Boolean(snap && hubspotUpdateLanded(snap, update));
      } catch {
        // Unreadable. Fall through and send; adjudicated like any other write.
      }
    }

    if (alreadyHeld) {
      hubspotOutcome = "already_held";
    } else {
      try {
        await hubspot.updateProduct(productId, update);
        hubspotOutcome = "applied";
      } catch (e) {
        const verdict = hubspotWriteOutcomeOf(e);
        const detail = e instanceof Error ? e.message : String(e);

        if (verdict === "rejected") {
          if (retryOf) {
            // A RETRY was rejected. That says nothing about the ORIGINAL
            // request, whose outcome was never established. Closing the claim
            // here would discard that and unblock a different edit over a
            // remote state nobody has confirmed.
            await keepUnconfirmed(
              attemptId,
              claimedVersion,
              priorObserved,
              `a retry was rejected by HubSpot: ${detail}`,
            );
            throw new ActionGuardError(
              ERR.HUBSPOT,
              "HubSpot refused this retry. That does NOT establish anything " +
                "about the earlier request, whose outcome was never confirmed " +
                `-- it may still have applied. The saved edit is kept. (${detail})`,
            );
          }
          // A FIRST attempt was rejected: nothing was uncertain beforehand and
          // nothing applied, so the claim is released.
          await settleAttempt(attemptId, claimedVersion, {
            resolution: "rejected",
            reason: detail,
          });
          throw new ActionGuardError(
            ERR.HUBSPOT,
            `HubSpot refused the update, so nothing was changed. ${detail}`,
          );
        }

        // UNCERTAIN. Adjudicated against the product itself, by its existing
        // id -- which is also what makes a retry safe.
        try {
          const snap = await hubspot.getProduct(productId);
          if (snap && hubspotUpdateLanded(snap, update)) {
            hubspotOutcome = "reconciled";
          } else {
            await markUnconfirmed(
              attemptId,
              claimedVersion,
              snap?.properties ?? null,
              true,
              detail,
            );
            throw new ActionGuardError(
              ERR.HUBSPOT,
              "HubSpot did not confirm this update. Reading the product back " +
                "shows it does NOT hold the requested values -- it may have " +
                "applied in part, or hold values from elsewhere. Nexus was not " +
                "changed. Your edit is saved: retry it to send exactly the same " +
                `request again. (${detail})`,
            );
          }
        } catch (readErr) {
          if (readErr instanceof ActionGuardError) throw readErr;
          await markUnconfirmed(attemptId, claimedVersion, null, false, detail);
          throw new ActionGuardError(
            ERR.HUBSPOT,
            "HubSpot did not confirm this update and could not be read back, " +
              "so whether it applied is UNKNOWN. Nexus was not changed. Your " +
              "edit is saved: retry it to send exactly the same request again. " +
              `(${detail})`,
          );
        }
      }
    }
  }

  // ── PHASE C · SETTLE ──────────────────────────────────────────────────
  try {
    await db.transaction(async (tx) => {
      await tx.execute(lockLeaf);

      // ── RELEASE ONLY WHAT IS KNOWN TO BE FINISHED ───────────────────
      //
      // A successful write here establishes that THIS request was accepted. It
      // establishes nothing about an earlier request that was never answered
      // and may still be in flight -- and releasing the claim would let a
      // DIFFERENT edit follow, which that earlier request could then land on
      // top of. Identical replay is only harmless while different edits are
      // excluded; releasing is what stops excluding them.
      //
      // So an attempt that has ever gone unanswered converges and stays held.
      // An attempt that never did -- HubSpot answered, the local write failed
      // -- has nothing outstanding and releases normally.
      const holdUnknown = unanswered;
      if (holdUnknown) hubspotOutcome = "converged_unknown";

      // Resolve FIRST, and conditionally. If this claim has already been
      // settled, this process no longer speaks for the product and must not
      // write to it.
      const settled = await tx
        .update(leafEditAttempts)
        .set(
          holdUnknown
            ? {
                outcome: "converged_unknown",
                reason:
                  "both catalogs hold the saved values, but an earlier request " +
                  "was never answered and may still land",
                version: claimedVersion + 1,
                updatedAt: new Date(),
              }
            : {
                resolvedAt: new Date(),
                resolution: hubspotOutcome,
                version: claimedVersion + 1,
                updatedAt: new Date(),
              },
        )
        .where(
          and(
            eq(leafEditAttempts.id, attemptId),
            eq(leafEditAttempts.version, claimedVersion),
            isNull(leafEditAttempts.resolvedAt),
          ),
        )
        .returning({ id: leafEditAttempts.id });
      if (settled.length === 0) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This edit was superseded while it was in flight -- another worker " +
            "claimed or settled it. HubSpot holds what was sent; Nexus was not " +
            "written by this attempt. Reload the product.",
        );
      }

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
            retried: Boolean(retryOf),
            submitted,
          },
        },
        tx,
      );
    });
  } catch (e) {
    if (e instanceof ActionGuardError) throw e;
    // HubSpot moved and the local half did not. The claim STAYS OPEN, so the
    // next edit is refused and the saved edit can be retried to converge.
    await markDiverged(
      attemptId,
      claimedVersion,
      Object.fromEntries(
        Object.entries(submitted).map(([k, v]) => [k, v === "" ? null : v]),
      ),
      e instanceof Error ? e.message : String(e),
    );
    throw new ActionGuardError(
      ERR.DATA_INTEGRITY,
      "HubSpot was updated but Nexus could not record it, so the two now " +
        "disagree about this product. Your edit is saved: retry it to bring " +
        `Nexus into line. (${e instanceof Error ? e.message : String(e)})`,
    );
  }

  revalidatePath("/");
  return { leafId, syncedToHubspot: productId !== null, hubspotOutcome };
}

/**
 * Every write to an attempt is fenced by the version its worker claimed, so a
 * worker whose claim has been taken over cannot resolve or alter it.
 */
async function fencedAttemptUpdate(
  attemptId: string,
  version: number,
  set: Record<string, unknown>,
): Promise<boolean> {
  const rows = await db
    .update(leafEditAttempts)
    .set({ ...set, version: version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(leafEditAttempts.id, attemptId),
        eq(leafEditAttempts.version, version),
        isNull(leafEditAttempts.resolvedAt),
      ),
    )
    .returning({ id: leafEditAttempts.id });
  return rows.length > 0;
}

async function settleAttempt(
  attemptId: string,
  version: number,
  opts: { resolution: string; reason: string },
): Promise<boolean> {
  return fencedAttemptUpdate(attemptId, version, {
    resolvedAt: new Date(),
    resolution: opts.resolution,
    reason: opts.reason,
  });
}

async function markUnconfirmed(
  attemptId: string,
  version: number,
  observed: Record<string, string | null> | null,
  readable: boolean,
  detail: string,
): Promise<boolean> {
  return fencedAttemptUpdate(attemptId, version, {
    outcome: "unconfirmed",
    // NO ANSWER was received for this request. Sticky: a later request being
    // answered says nothing about this one, which may still be in flight.
    unanswered: true,
    observed,
    reason: readable
      ? `read-back did not match the requested state: ${detail}`
      : `read-back could not be performed: ${detail}`,
  });
}

/** A retry was rejected. The EARLIER uncertainty stands. */
async function keepUnconfirmed(
  attemptId: string,
  version: number,
  observed: Record<string, string | null> | null,
  detail: string,
): Promise<boolean> {
  return fencedAttemptUpdate(attemptId, version, {
    outcome: "unconfirmed",
    observed,
    reason: detail,
  });
}

async function markDiverged(
  attemptId: string,
  version: number,
  observed: Record<string, string | null>,
  detail: string,
): Promise<boolean> {
  return fencedAttemptUpdate(attemptId, version, {
    outcome: "diverged",
    observed,
    reason: `local write failed after HubSpot applied: ${detail}`,
  });
}

function readLeafEditValues(formData: FormData): LeafEditValues {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new ActionGuardError(ERR.VALIDATION, "Product name is required.");

  const skuRaw = String(formData.get("sku") ?? "").trim();
  const unitCostRaw = String(formData.get("unitCost") ?? "").trim();
  const unitCost = unitCostRaw === "" ? null : unitCostRaw;
  if (unitCost !== null && (unitCost.length > 20 || !/^\d+(\.\d+)?$/.test(unitCost))) {
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
    // other people's edits silently.
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
      retryOf: null,
    });
  });
}

/**
 * Retry a saved edit whose remote outcome was never confirmed.
 *
 * Sends EXACTLY what was originally submitted -- no amendments, no values from
 * the caller. That is what makes it safe regardless of whether the earlier
 * request is still in flight: whichever lands last, HubSpot holds the same
 * thing. It is also why a different edit is refused until this has run.
 *
 * The product is read back first, because the outstanding request may have
 * completed late. If HubSpot already holds the saved values, nothing is
 * re-sent and the local row simply catches up.
 */
export async function retryLeafEdit(
  formData: FormData,
): Promise<ActionResult<LeafEditOutcome>> {
  return runAction(async () => {
    const user = await ensureUser();
    await assertCanCreateLeaves();

    const leafId = String(formData.get("leafId") ?? "").trim();
    if (!leafId) throw new ActionGuardError(ERR.VALIDATION, "leafId is required.");

    const [open] = await db
      .select({ id: leafEditAttempts.id, version: leafEditAttempts.version })
      .from(leafEditAttempts)
      .where(
        and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)),
      )
      .limit(1);
    if (!open) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "There is no saved edit to retry for this product.",
      );
    }

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
      retryOf: { id: open.id, version: open.version },
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

/**
 * The evidence a controlled reconciliation would require before an unresolved
 * ordering could be released.
 *
 * None of these is available today, which is why nothing here releases the
 * hold. They are enumerated rather than described in prose so the requirement
 * is checkable: when one becomes available, it is added here and the release
 * path accepts it.
 */
