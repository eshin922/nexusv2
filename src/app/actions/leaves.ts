"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, leaves, productTypes } from "@/db/schema";
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
import { mapLeafToHubspotCreate } from "@/lib/hubspot-mapper";
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
