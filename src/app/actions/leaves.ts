"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, leaves, productTypes } from "@/db/schema";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
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
    const productTypeIdRaw =
      String(formData.get("productTypeId") ?? "").trim();
    const productTypeId = productTypeIdRaw === "" ? null : productTypeIdRaw;
    const unitCostRaw = String(formData.get("unitCost") ?? "").trim();
    const unitCost = unitCostRaw === "" ? null : unitCostRaw;
    const ownerIdRaw = String(formData.get("ownerId") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim() || null;

    if (!name)
      throw new ActionGuardError(ERR.VALIDATION, "name required");

    // Permission gate (Path B per Architect Gate 5).
    const user = await assertCanCreateLeaves();

    // Validate product type if provided (must be leaf-scope).
    if (productTypeId) {
      const typeRows = await db
        .select()
        .from(productTypes)
        .where(eq(productTypes.id, productTypeId))
        .limit(1);
      if (typeRows.length === 0)
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Selected product type not found.",
        );
      if (typeRows[0].scope !== "leaf")
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Selected type is not a leaf-scope type.",
        );
    }

    // HubSpot-first write-back. Push mapping per Concern C
    // disposition: name + sku + unit_cost + url + technical catalog price.
    // Price defaults to 0.00 at the mapper/provider boundary and is never a
    // Nexus quote or Sales Order transaction rate. Other
    // HubSpot product attributes (description, owner, FSC fields,
    // image_url) stay HubSpot-empty until pull-back or HubSpot UI
    // edit.
    const hubspotInput = mapLeafToHubspotCreate({
      name,
      sku,
      unitCost,
      url,
    });

    let hubspotProductId: string;
    try {
      const { hubspot } = await getApplicationDependencies();
      const result = await hubspot.createProduct(hubspotInput);
      hubspotProductId = result.id;
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

    const inserted = await db
      .insert(leaves)
      .values({
        name,
        sku,
        productTypeId,
        unitCost,
        ownerId: ownerIdRaw === "" ? null : ownerIdRaw,
        url,
        archived: false,
        hubspotProductId,
      })
      .returning();
    const newRow = inserted[0];

    // Audit: `leaf_create` per CLAUDE.md namespace. `source:
    // 'nexus_authored'` distinguishes PM-driven creates from
    // pull-driven creates (which carry source='hubspot_pull' via
    // the pullProductsBatch executor in src/lib/hubspot-pull.ts).
    await db.insert(auditLog).values({
      userId: user.id,
      entityType: "leaf",
      entityId: newRow.id,
      action: "leaf_create",
      diffJson: {
        name: newRow.name,
        sku: newRow.sku,
        product_type_id: newRow.productTypeId,
        unit_cost: newRow.unitCost,
        owner_id: newRow.ownerId,
        url: newRow.url,
        hubspot_product_id: newRow.hubspotProductId,
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

    await db.insert(auditLog).values({
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
