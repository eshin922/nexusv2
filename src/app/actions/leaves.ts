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
  type LibraryBrowseRow,
} from "@/lib/library-browse-loader";
import { ensureUser } from "@/lib/auth/ensure-user";
import { revalidatePath } from "next/cache";

// Phase A.1 v2 impl-4 — server actions for the leaves library table.
//
// `createLeaf(formData)` — Creates a globally-scoped library leaf.
// No quote_id (leaves are scenario-spanning per the library
// concept). Permission gated by users.can_create_leaves; admin
// role implicit-passes via assertCanCreateLeaves.
//
// Audit: emits `leaf_create` per CLAUDE.md namespace
// (banked impl-1, first wire impl-4). diff_json carries the
// identity + initial commercial fields.
//
// No attach action — impl-4 LEAF mode creates library leaves; the
// "Add to {ASY}" attach flow lands in impl-5 (Phase 5 library
// browse) via the assembly_leaf_attach audit action.

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

    const inserted = await db
      .insert(leaves)
      .values({
        name,
        sku,
        productTypeId,
        unitCost: unitCostRaw === "" ? null : unitCostRaw,
        ownerId: ownerIdRaw === "" ? null : ownerIdRaw,
        url,
        archived: false,
      })
      .returning();
    const newRow = inserted[0];

    // Audit: `leaf_create` per CLAUDE.md namespace (banked impl-1).
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
): Promise<ActionResult<{ rows: LibraryBrowseRow[]; total: number }>> {
  return runAction(async () => {
    // Auth check (server-only context); throws if signed out.
    await ensureUser();
    const result = await loadLibraryBrowse(filters);
    return result;
  });
}
