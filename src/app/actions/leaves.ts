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
   * to end. `reconciled` means the call failed and a read-back proved it had
   * applied anyway; `recovered` means a previously unconfirmed attempt was
   * replayed and settled.
   */
  hubspotOutcome: "applied" | "reconciled" | "recovered" | "not_linked";
};

/**
 * An edit whose remote outcome was never confirmed, kept so it can be
 * recovered rather than guessed at later.
 */
type RecordableAttempt = {
  leafId: string;
  hubspotProductId: string | null;
  attempted: LeafEditValues;
  submitted: Record<string, string>;
  observed: Record<string, string | null> | null;
  outcome: "unconfirmed" | "diverged";
  reason: string;
};

function describeObservedSku(
  observed: Record<string, string | null> | null,
): string {
  if (!observed) return "";
  const remote = observed.hs_sku;
  if (!remote) return "";
  return ` HubSpot currently holds the SKU "${remote}" for this product.`;
}

async function recordAttempt(userId: string, a: RecordableAttempt): Promise<void> {
  // Its OWN transaction. The edit's transaction has rolled back by the time
  // this runs -- that is precisely why there is something to record -- so
  // writing the attempt inside it would roll the record back too.
  await db.transaction(async (tx) => {
    await tx
      .insert(leafEditAttempts)
      .values({
        leafId: a.leafId,
        hubspotProductId: a.hubspotProductId,
        attempted: a.attempted,
        submitted: a.submitted,
        observed: a.observed,
        outcome: a.outcome,
        reason: a.reason,
        createdBy: userId,
      })
      // One OPEN attempt per product. A second would mean two competing
      // records of what the product is supposed to be, and a recovery could
      // not say which it was recovering. The first one stands until resolved.
      .onConflictDoNothing();
    await writeAuditEntry(
      {
        userId,
        entityType: "leaf",
        entityId: a.leafId,
        action: "leaf_edit_unconfirmed",
        diffJson: {
          outcome: a.outcome,
          reason: a.reason,
          attempted: a.attempted,
          submitted: a.submitted,
          observed: a.observed,
          hubspot_product_id: a.hubspotProductId,
        },
      },
      tx,
    );
  });
}

/**
 * The core of an edit, shared by the operator's save and by the recovery of a
 * previously unconfirmed one.
 *
 * `recovery` is the open attempt being replayed. When it is set, the open
 * attempt does NOT block the write -- it is the thing being resolved.
 */
async function applyLeafEdit(opts: {
  userId: string;
  leafId: string;
  values: LeafEditValues;
  expectedVersion: string | null;
  recovery: { id: string } | null;
}): Promise<LeafEditOutcome> {
  const { userId, leafId, values, expectedVersion, recovery } = opts;
  const { name, sku, url, unitCost, hubspotProductType } = values;
  const { hubspot } = await getApplicationDependencies();

  let hubspotApplied = false;
  let hubspotReconciled = false;
  let attemptToRecord: RecordableAttempt | null = null;

  try {
    const result = await db.transaction(async (tx) => {
      // ── CONCURRENCY ─────────────────────────────────────────────────
      //
      // Two locks, in a fixed order (leaf, then SKU) so they cannot deadlock.
      //
      // The LEAF lock serialises the whole edit -- validation, the HubSpot
      // call and the local write -- and is what makes the version comparison
      // below and the write that follows it see the same row.
      //
      // The SKU lock covers the CLAIM. `leaves_sku_idx` is not unique, so the
      // uniqueness check is otherwise a read with nothing holding the value
      // between the check and the write: two products completing the same SKU
      // concurrently both pass and both commit.
      //
      // The cost is honest: a database connection is held across a HubSpot
      // round trip. At this pool size that is acceptable for an
      // operator-paced edit, and it is the price of not losing a claim.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`leaf:${leafId}`}, 0))`,
      );
      if (sku !== null) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`sku:${sku.toUpperCase()}`}, 0))`,
        );
      }

      // Re-read UNDER the lock. The row read before it is a row that may
      // already have moved.
      const [existing] = await tx
        .select()
        .from(leaves)
        .where(eq(leaves.id, leafId))
        .limit(1);
      if (!existing) throw new ActionGuardError(ERR.NOT_FOUND, "Product not found.");

      // ── AN UNRESOLVED ATTEMPT BLOCKS ORDINARY EDITING ───────────────
      //
      // The product has a remote state nobody has confirmed. Editing over it
      // would overwrite whatever is actually there -- including, specifically,
      // a SKU that HubSpot may have assigned or accepted while Nexus does not
      // know about it. Local state cannot answer that question, because local
      // state is exactly what failed to be written.
      const [open] = await tx
        .select()
        .from(leafEditAttempts)
        .where(
          and(
            eq(leafEditAttempts.leafId, leafId),
            isNull(leafEditAttempts.resolvedAt),
          ),
        )
        .limit(1);
      if (open && open.id !== recovery?.id) {
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

      // ── OPTIMISTIC CONCURRENCY ──────────────────────────────────────
      //
      // Checked INSIDE the lock, the only place the answer is stable. A
      // recovery skips it: it is replaying a recorded edit, not submitting
      // one written against a version of the row.
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

      const hadSku = hasUsableSku(existing.sku);
      if (hadSku && sku !== existing.sku) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `This product's SKU is already established as "${existing.sku}". ` +
            "Downstream identity may depend on it -- quotes already sent, and the " +
            "NetSuite item it resolves to -- so replacing it is a separate " +
            "controlled correction, not an ordinary edit.",
        );
      }

      if (sku !== null) {
        // Uniqueness on the COMPLETE NORMALIZED value, across the catalog. A
        // brand prefix is formatting; it is not the constraint.
        const normalized = sku.toUpperCase();
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
            `SKU "${sku}" already belongs to "${clash[0].name}". A SKU identifies ` +
              "one product; two products cannot share one.",
          );
        }
      }

      // ── HUBSPOT ─────────────────────────────────────────────────────
      const update = mapLeafToHubspotUpdate({
        name,
        sku,
        unitCost,
        url,
        hubspotProductType,
      });
      const submitted = toHubSpotProductUpdateProperties(update);

      if (existing.hubspotProductId) {
        const productId = existing.hubspotProductId;
        try {
          await hubspot.updateProduct(productId, update);
          hubspotApplied = true;
        } catch (e) {
          const outcome = hubspotWriteOutcomeOf(e);
          const detail = e instanceof Error ? e.message : String(e);

          if (outcome === "rejected") {
            // HubSpot answered and refused. "Nothing was changed" is
            // established here, so it is safe to say -- and there is nothing
            // unconfirmed to preserve.
            throw new ActionGuardError(
              ERR.HUBSPOT,
              `HubSpot refused the update, so nothing was changed. ${detail}`,
            );
          }

          // UNCERTAIN. Adjudicated against the product itself, BY ITS
          // EXISTING ID -- which is also what makes a retry safe: the update
          // is idempotent and cannot mint a second product.
          let snapshot: Awaited<ReturnType<typeof hubspot.getProduct>> | null = null;
          let readable = true;
          try {
            snapshot = await hubspot.getProduct(productId);
          } catch {
            readable = false;
          }

          if (readable && snapshot && hubspotUpdateLanded(snapshot, update)) {
            hubspotApplied = true;
            hubspotReconciled = true;
          } else {
            // NOT CONFIRMED -- which is all that has been established.
            //
            // This is NOT "nothing changed". The write may have applied in
            // part; the product may hold values something else put there;
            // the read may not have happened at all. Each of those is a
            // different fact and none of them is "unchanged", so the edit is
            // PRESERVED rather than discarded and the message says what is
            // actually known.
            attemptToRecord = {
              leafId,
              hubspotProductId: productId,
              attempted: values,
              submitted,
              observed: readable ? (snapshot?.properties ?? null) : null,
              outcome: "unconfirmed",
              reason: readable
                ? `read-back did not match the requested state: ${detail}`
                : `read-back could not be performed: ${detail}`,
            };
            throw new ActionGuardError(
              ERR.HUBSPOT,
              readable
                ? "HubSpot did not confirm this update. Reading the product back " +
                  "shows it does NOT hold the requested values -- it may have " +
                  "applied in part, or hold values from elsewhere. Nexus was not " +
                  "changed. Your edit has been kept: recover it to retry exactly " +
                  `what you asked for. (${detail})`
                : "HubSpot did not confirm this update and could not be read back, " +
                  "so whether it applied is UNKNOWN. Nexus was not changed. Your " +
                  "edit has been kept: recover it to retry exactly what you asked " +
                  `for. (${detail})`,
            );
          }
        }
      }

      // ── LOCAL, ATOMIC WITH ITS AUDIT ────────────────────────────────
      const before = {
        name: existing.name,
        sku: existing.sku,
        url: existing.url,
        unit_cost: existing.unitCost,
        hubspot_product_type: existing.hubspotProductType,
      };
      const after = {
        name,
        sku,
        url,
        unit_cost: unitCost,
        hubspot_product_type: hubspotProductType,
      };

      await tx
        .update(leaves)
        .set({ name, sku, url, unitCost, hubspotProductType, updatedAt: new Date() })
        .where(eq(leaves.id, leafId));

      if (recovery) {
        await tx
          .update(leafEditAttempts)
          .set({ resolvedAt: new Date(), resolution: "recovered" })
          .where(eq(leafEditAttempts.id, recovery.id));
      }

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
            sku_completed: !hadSku && sku !== null,
            hubspot_product_id: existing.hubspotProductId,
            synced_to_hubspot: hubspotApplied,
            hubspot_reconciled: hubspotReconciled,
            recovered_attempt_id: recovery?.id ?? null,
          },
        },
        tx,
      );

      return {
        leafId,
        syncedToHubspot: hubspotApplied,
        hubspotOutcome: (!existing.hubspotProductId
          ? "not_linked"
          : recovery
            ? "recovered"
            : hubspotReconciled
              ? "reconciled"
              : "applied") as LeafEditOutcome["hubspotOutcome"],
      };
    });

    revalidatePath("/");
    return result;
  } catch (e) {
    if (attemptToRecord) {
      await recordAttempt(userId, attemptToRecord);
      throw e;
    }
    // HubSpot moved and the local half did not. Reporting this as a plain
    // failure would tell the operator nothing changed while one of the two
    // catalogues already holds the new values -- and would leave the next
    // edit free to overwrite them.
    if (hubspotApplied && !(e instanceof ActionGuardError)) {
      await recordAttempt(userId, {
        leafId,
        hubspotProductId: null,
        attempted: values,
        submitted: toHubSpotProductUpdateProperties(
          mapLeafToHubspotUpdate({ name, sku, unitCost, url, hubspotProductType }),
        ),
        // HubSpot applied the requested values, so the requested state IS what
        // it holds. Recorded as observed because that is what was established.
        observed: Object.fromEntries(
          Object.entries(
            toHubSpotProductUpdateProperties(
              mapLeafToHubspotUpdate({ name, sku, unitCost, url, hubspotProductType }),
            ),
          ).map(([k, v]) => [k, v === "" ? null : v]),
        ),
        outcome: "diverged",
        reason: `local write failed after HubSpot applied: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
      throw new ActionGuardError(
        ERR.DATA_INTEGRITY,
        "HubSpot was updated but Nexus could not record it, so the two now " +
          "disagree about this product. Your edit has been kept: recover it to " +
          "bring Nexus into line. Editing this product normally is blocked until " +
          "then, so the values HubSpot already holds are not overwritten. " +
          `(${e instanceof Error ? e.message : String(e)})`,
      );
    }
    throw e;
  }
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
 * Replays THE RECORDED ATTEMPT. Not "PATCH the same product id again" -- the
 * values on screen may since have changed, and re-sending those would replace
 * an unconfirmed remote state with a different one rather than settling the
 * one that is actually outstanding.
 *
 * The product is read back FIRST, because the outstanding write may have
 * completed late: a request that timed out is not a request that stopped.
 * If HubSpot already holds the recorded values, nothing is re-sent and the
 * local row simply catches up.
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

    // ── THE SKU IS PINNED; THE REST MAY BE CORRECTED ────────────────────
    //
    // A recovery replays the RECORDED edit -- but a recorded edit can be
    // unrecoverable on its own terms. The local write may have failed
    // precisely because one of its values could not be stored, and replaying
    // it verbatim then fails identically every time, leaving the product
    // permanently locked behind its own unresolved attempt.
    //
    // So the correctable fields may be amended, and the IDENTITY-BEARING one
    // may not. The SKU comes from the record -- or from what HubSpot was
    // observed to hold, which outranks it -- and a recovery that tries to
    // change it is refused. That is the difference between recovering the
    // edit and re-PATCHing the same product id with different values.
    const pinnedSku = observed?.hs_sku ?? recorded.sku;
    const submittedSku = String(formData.get("sku") ?? "").trim();
    if (submittedSku !== "" && pinnedSku !== null && submittedSku !== pinnedSku) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Recovery cannot change the SKU. This product's unconfirmed edit is for ` +
          `"${pinnedSku}"${
            observed?.hs_sku ? " and HubSpot already holds it" : ""
          }; recovering settles that, and replacing it is a separate controlled ` +
          "correction.",
      );
    }

    const amend = (key: string, fallback: string | null): string | null => {
      const raw = formData.get(key);
      if (raw === null) return fallback;
      const v = String(raw).trim();
      return v === "" ? null : v;
    };
    const unitCost = amend("unitCost", recorded.unitCost);
    if (unitCost !== null && !/^\d+(\.\d+)?$/.test(unitCost)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${unitCost}" is not a unit cost. Enter a number, or leave it empty.`,
      );
    }

    const values: LeafEditValues = {
      name: String(formData.get("name") ?? "").trim() || recorded.name,
      sku: pinnedSku,
      url: amend("url", recorded.url),
      unitCost,
      hubspotProductType: amend(
        "hubspotProductType",
        recorded.hubspotProductType,
      ),
    };

    return applyLeafEdit({
      userId: user.id,
      leafId,
      values,
      expectedVersion: null,
      recovery: { id: open.id },
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
