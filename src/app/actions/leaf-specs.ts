"use server";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, leafSpecs, leaves, productTypes } from "@/db/schema";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { assertCanEditSpecs } from "@/lib/spec-permission-guard";
import { revalidatePath } from "next/cache";

// Phase A.1 v2 impl-3 — server actions for leaf_specs.
//
// `updateLeafSpec(formData)` — Per-field UPSERT on the current
// leaf_specs row. UPDATEs spec_values jsonb in-place per CLAUDE.md
// "Versioning semantics": edits during quote authoring do NOT bump
// version_number; quote-pin events (impl-7) own the version bump.
//
// If the leaf has no current spec row, the action INSERTs one
// (version_number=1, is_current=true) AND emits a
// `leaf_spec_create` audit row in addition to the field-edit row.
//
// Schema validation: keys not in the product_type's field_schema
// are rejected. Empty-string values normalize to null in jsonb so
// the completeness check (filled = non-null, non-empty) stays
// consistent with the loader's computeSpecCompleteness logic.

type UpdateLeafSpecResult = {
  leafId: string;
  specId: string;
  specValues: Record<string, unknown>;
  versionNumber: number;
};

export async function updateLeafSpec(
  formData: FormData,
): Promise<ActionResult<UpdateLeafSpecResult>> {
  return runAction(async () => {
    const leafId = String(formData.get("leafId") ?? "").trim();
    const fieldKey = String(formData.get("fieldKey") ?? "").trim();
    // Raw value preserved as string; jsonb stores strings. Future
    // expansion to typed fields (number, boolean, select) maps here.
    const rawValue = String(formData.get("value") ?? "");

    if (!leafId)
      throw new ActionGuardError(ERR.VALIDATION, "leafId required");
    if (!fieldKey)
      throw new ActionGuardError(ERR.VALIDATION, "fieldKey required");

    // Permission gate (Path B per Architect Gate 5; impl-1 helper).
    const user = await assertCanEditSpecs();

    // Load leaf + verify product_type and schema validates the key.
    const leafRows = await db
      .select()
      .from(leaves)
      .where(eq(leaves.id, leafId))
      .limit(1);
    if (leafRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Leaf not found");
    const leaf = leafRows[0];
    if (leaf.archived)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Archived leaves can't be edited.",
      );
    if (!leaf.productTypeId)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Leaf has no Product Type assigned. Pick a type first.",
      );

    const typeRows = await db
      .select()
      .from(productTypes)
      .where(eq(productTypes.id, leaf.productTypeId))
      .limit(1);
    const type = typeRows[0];
    if (!type)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Leaf's product type doesn't exist.",
      );
    if (type.placeholder)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Placeholder types don't accept spec values yet — field schema pending.",
      );

    const schema = type.fieldSchema as
      | { fields: { key: string }[] }
      | null
      | undefined;
    if (!schema || !Array.isArray(schema.fields))
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Product type has no field schema configured.",
      );
    if (!schema.fields.some((f) => f.key === fieldKey))
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Field '${fieldKey}' is not in this type's schema.`,
      );

    // Normalize empty string → null (jsonb null; completeness reads
    // non-null + non-empty as "filled").
    const trimmed = rawValue.trim();
    const nextValue: string | null = trimmed.length === 0 ? null : rawValue;

    // Load current spec row (is_current = true).
    const currentRows = await db
      .select()
      .from(leafSpecs)
      .where(and(eq(leafSpecs.leafId, leafId), eq(leafSpecs.isCurrent, true)))
      .limit(1);
    const current = currentRows[0];

    let specId: string;
    let specValues: Record<string, unknown>;
    let versionNumber: number;
    let isFirstCreate = false;

    if (!current) {
      // First-time spec entry — INSERT + audit `leaf_spec_create`.
      const initialValues: Record<string, unknown> = {};
      if (nextValue !== null) initialValues[fieldKey] = nextValue;

      const inserted = await db
        .insert(leafSpecs)
        .values({
          leafId,
          specValues: initialValues,
          versionNumber: 1,
          isCurrent: true,
          createdBy: user.id,
        })
        .returning();
      specId = inserted[0].id;
      specValues = (inserted[0].specValues as Record<string, unknown>) ?? {};
      versionNumber = inserted[0].versionNumber;
      isFirstCreate = true;
    } else {
      // In-place UPDATE — jsonb merge or jsonb_set semantics.
      // Use jsonb update with sql expression so we don't read+write
      // the full object (avoids race on concurrent edits).
      const updated = await db
        .update(leafSpecs)
        .set({
          specValues:
            nextValue === null
              ? sql`(${leafSpecs.specValues} - ${fieldKey})`
              : sql`jsonb_set(${leafSpecs.specValues}, ${`{${fieldKey}}`}, ${JSON.stringify(nextValue)}::jsonb)`,
          updatedAt: new Date(),
          updatedBy: user.id,
        })
        .where(eq(leafSpecs.id, current.id))
        .returning();
      specId = updated[0].id;
      specValues = (updated[0].specValues as Record<string, unknown>) ?? {};
      versionNumber = updated[0].versionNumber;
    }

    // Audit log:
    // - If first-time create, emit `leaf_spec_create` root row.
    // - Always emit `leaf_spec_field_edit` row for the field change.
    // Future multi-field saves (e.g., type-change cascade) can use
    // the caused_by_audit_id pattern; per-field saves don't need
    // a root since each save is atomic.
    if (isFirstCreate) {
      await db.insert(auditLog).values({
        userId: user.id,
        entityType: "leaf_spec",
        entityId: specId,
        action: "leaf_spec_create",
        diffJson: {
          leaf_id: leafId,
          product_type_id: leaf.productTypeId,
          initial_field: fieldKey,
          initial_value: nextValue,
        },
      });
    }
    await db.insert(auditLog).values({
      userId: user.id,
      entityType: "leaf_spec",
      entityId: specId,
      action: "leaf_spec_field_edit",
      diffJson: {
        leaf_id: leafId,
        field: fieldKey,
        from: current?.specValues
          ? (current.specValues as Record<string, unknown>)[fieldKey] ?? null
          : null,
        to: nextValue,
      },
    });

    // Revalidate the leaf-specs route. Future: also revalidate any
    // Setup surface that renders this leaf (for completeness chip
    // updates) — handled by realtime + the Setup page's own
    // revalidation cycle.
    revalidatePath(
      "/projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs",
      "page",
    );

    return { leafId, specId, specValues, versionNumber };
  });
}

/**
 * Phase A.1 v2 impl-3 Step 7 — set/change Product Type on a leaf.
 *
 * Two modes:
 *   - Initial assignment: leaf had no product_type_id → assigning a
 *     type just writes the column; no spec_values impact since no
 *     spec row exists yet. Audit: no `leaf_spec_type_change` (there
 *     was no prior type); `leaves` table gets the column write.
 *   - Type change: leaf already had a type → switching discards
 *     prior spec_values (per CD designer notes §4.10 — fields don't
 *     translate across types). The current leaf_spec row's
 *     spec_values is cleared to `{}` in-place. Audit emits both
 *     `leaf_spec_type_change` (root, on leaves.id entity) AND a
 *     derived `leaf_spec_field_edit` row clearing spec_values
 *     (caused_by_audit_id linking).
 *
 * Step 7 wires Mode 1 (initial assignment). Mode 2 (type change with
 * destructive clear) wires in Step 9 with the confirmation modal —
 * we explicitly reject type changes here so PMs can't bypass the
 * modal by re-submitting.
 */
export async function assignLeafProductType(
  formData: FormData,
): Promise<ActionResult<{ leafId: string; productTypeId: string }>> {
  return runAction(async () => {
    const leafId = String(formData.get("leafId") ?? "").trim();
    const productTypeId = String(formData.get("productTypeId") ?? "").trim();

    if (!leafId)
      throw new ActionGuardError(ERR.VALIDATION, "leafId required");
    if (!productTypeId)
      throw new ActionGuardError(ERR.VALIDATION, "productTypeId required");

    const user = await assertCanEditSpecs();

    const leafRows = await db
      .select()
      .from(leaves)
      .where(eq(leaves.id, leafId))
      .limit(1);
    if (leafRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Leaf not found");
    const leaf = leafRows[0];

    // Step 7 covers initial assignment only. Type-change requires
    // confirmation modal (Step 9). Reject here if the leaf already
    // has a type to prevent bypass.
    if (leaf.productTypeId)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "This leaf already has a product type. Use the type-change flow (impl-3 Step 9) to switch.",
      );

    // Validate target type exists and is leaf-scope.
    const typeRows = await db
      .select()
      .from(productTypes)
      .where(eq(productTypes.id, productTypeId))
      .limit(1);
    if (typeRows.length === 0)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Product type not found.",
      );
    if (typeRows[0].scope !== "leaf")
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Selected type is not a leaf-scope type.",
      );

    await db
      .update(leaves)
      .set({ productTypeId, updatedAt: new Date() })
      .where(eq(leaves.id, leafId));

    // No `leaf_spec_type_change` audit on initial assignment —
    // that action is reserved for actual type SWITCHES (Step 9).
    // Use a generic write on the leaf entity.
    await db.insert(auditLog).values({
      userId: user.id,
      entityType: "leaf",
      entityId: leafId,
      action: "leaf_product_type_assigned",
      diffJson: {
        from: null,
        to: productTypeId,
      },
    });

    revalidatePath(
      "/projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs",
      "page",
    );

    return { leafId, productTypeId };
  });
}
