"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { loadLeafForSpecEntry, type LeafSpecEntryData } from "@/lib/leaf-spec-loader";
import { db } from "@/db";
import { auditLog, leafSpecs, leaves, productTypes } from "@/db/schema";
import { writeAuditEntries, writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { assertCanEditSpecs } from "@/lib/spec-permission-guard";
import { ensureUser } from "@/lib/auth/ensure-user";
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

/**
 * Which authority a spec write targets. B-3 · A.
 *
 * REQUIRED, with no default. The two candidates are "this quote" and "the
 * template every future quote starts from", and a wrong guess is silent in both
 * directions — so the caller states it rather than the action inferring it.
 */
function readScope(formData: FormData): { library: true } | { quoteId: string } {
  const scope = String(formData.get("scope") ?? "").trim();
  if (scope === "library") return { library: true };
  if (scope === "quote" || scope === "") {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    // Fail closed. An empty id would produce a predicate that matches no row,
    // so the write would succeed and change nothing — the worst outcome
    // available, because the operator is told it saved.
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    return { quoteId };
  }
  throw new ActionGuardError(ERR.VALIDATION, `unknown scope "${scope}"`);
}

/** Row selector for the resolved scope. Library = the current default row. */
function scopeWhere(
  leafId: string,
  scope: { library: true } | { quoteId: string },
) {
  return "library" in scope
    ? and(
        eq(leafSpecs.leafId, leafId),
        isNull(leafSpecs.quoteId),
        eq(leafSpecs.isCurrent, true),
      )
    : and(eq(leafSpecs.leafId, leafId), eq(leafSpecs.quoteId, scope.quoteId));
}

export async function updateLeafSpec(
  formData: FormData,
): Promise<ActionResult<UpdateLeafSpecResult>> {
  return runAction(async () => {
    const leafId = String(formData.get("leafId") ?? "").trim();
    // B-3 — which authority is being edited. Required: an edit with no scope
    // has no safe default, because the two candidates are "this quote" and
    // "every future quote", and guessing wrong is silent either way.
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

    const scope = readScope(formData);
    // Load the addressed authority. Not the Library default — a quote-side edit
    // must never reach master data or another quote.
    const currentRows = await db
      .select()
      .from(leafSpecs)
      .where(scopeWhere(leafId, scope))
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
          ...("library" in scope
            ? { isCurrent: true }
            : { quoteId: scope.quoteId }),
          specValues: initialValues,
          versionNumber: 1,
          // Library-scope concept; quote rows opt out. Authority for a quote
          // is the pointer on quote_leaves, never a flag.
          ...("library" in scope ? {} : { isCurrent: false }),
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
      await writeAuditEntry({
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
    await writeAuditEntry({
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
    // B-3 — the Product Type IS the schema spec_values are validated against,
    // so it belongs to the same authority as the values.
    const assignScope = readScope(formData);

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

    // Writes THIS QUOTE's authority. `leaves.product_type_id` is the Library
    // default for FUTURE attachments and is deliberately untouched — changing
    // it here would retype every other quote using this product.
    await db
      .update(leafSpecs)
      .set({ productTypeId, updatedAt: new Date(), updatedBy: user.id })
      .where(scopeWhere(leafId, assignScope));

    // No `leaf_spec_type_change` audit on initial assignment —
    // that action is reserved for actual type SWITCHES (Step 9).
    // Use a generic write on the leaf entity.
    await writeAuditEntry({
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

/**
 * Phase A.1 v2 impl-3 Step 9 — change a leaf's Product Type
 * (destructive; clears spec_values).
 *
 * Per CD designer notes §4.10: type changes discard prior
 * spec_values since fields don't translate across types. PM must
 * confirm via the modal before this action fires.
 *
 * Cascade audit pattern (per CLAUDE.md namespace + Phase A.1 v2):
 *   - Root audit row: `leaf_spec_type_change` on entity_id=leaves.id
 *     with diff_json carrying {from_type, to_type, cleared_field_count}
 *   - Derived audit rows: one `leaf_spec_field_edit` per non-null
 *     spec value cleared, with caused_by_audit_id pointing at the
 *     root row
 */
export async function changeLeafProductType(
  formData: FormData,
): Promise<
  ActionResult<{
    leafId: string;
    fromTypeId: string;
    toTypeId: string;
    clearedFieldCount: number;
  }>
> {
  return runAction(async () => {
    const leafId = String(formData.get("leafId") ?? "").trim();
    const toTypeId = String(formData.get("productTypeId") ?? "").trim();
    // B-3 — same authority as the values, for the same reason.
    const changeScope = readScope(formData);

    if (!leafId)
      throw new ActionGuardError(ERR.VALIDATION, "leafId required");
    if (!toTypeId)
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

    if (!leaf.productTypeId)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Leaf has no current product type. Use the type-picker assign flow instead.",
      );
    if (leaf.productTypeId === toTypeId)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Target type matches the current type — nothing to change.",
      );

    const typeRows = await db
      .select()
      .from(productTypes)
      .where(eq(productTypes.id, toTypeId))
      .limit(1);
    if (typeRows.length === 0)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Target product type not found.",
      );
    if (typeRows[0].scope !== "leaf")
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Target type is not a leaf-scope type.",
      );

    const fromTypeId = leaf.productTypeId;

    // Load current spec row + extract cleared fields for cascade audit.
    const currentRows = await db
      .select()
      .from(leafSpecs)
      // Quote-scoped: the prior values being transformed are this quote's.
      .where(scopeWhere(leafId, changeScope))
      .limit(1);
    const current = currentRows[0];
    const priorValues = (current?.specValues as
      | Record<string, unknown>
      | undefined) ?? {};
    const clearedFields = Object.entries(priorValues).filter(
      ([, v]) =>
        v !== null &&
        v !== undefined &&
        !(typeof v === "string" && v.trim() === ""),
    );

    // Transaction: retype the addressed authority + clear its spec_values +
    // emit cascade audit rows atomically. `leaves.product_type_id` stays as
    // the Library default for future attachments.
    await db.transaction(async (tx) => {
      await tx
        .update(leafSpecs)
        .set({ productTypeId: toTypeId, updatedAt: new Date(), updatedBy: user.id })
        .where(scopeWhere(leafId, changeScope));

      if (current) {
        await tx
          .update(leafSpecs)
          .set({
            specValues: sql`'{}'::jsonb`,
            updatedAt: new Date(),
            updatedBy: user.id,
          })
          .where(eq(leafSpecs.id, current.id));
      }

      // Root audit row.
      const rootId = await writeAuditEntryReturningId(
        {
          userId: user.id,
          entityType: "leaf",
          entityId: leafId,
          action: "leaf_spec_type_change",
          diffJson: {
            from_type_id: fromTypeId,
            to_type_id: toTypeId,
            cleared_field_count: clearedFields.length,
            current_spec_id: current?.id ?? null,
          },
        },
        tx,
      );

      // Derived audit rows per cleared field (cascade pattern).
      if (current && clearedFields.length > 0) {
        await writeAuditEntries(
          clearedFields.map(([fieldKey, value]) => ({
            userId: user.id,
            entityType: "leaf_spec",
            entityId: current.id,
            action: "leaf_spec_field_edit",
            causedByAuditId: rootId,
            diffJson: {
              leaf_id: leafId,
              field: fieldKey,
              from: value,
              to: null,
              source: "type_change_clear",
            },
          })),
          tx,
        );
      }
    });

    revalidatePath(
      "/projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs",
      "page",
    );

    return {
      leafId,
      fromTypeId,
      toTypeId,
      clearedFieldCount: clearedFields.length,
    };
  });
}

/**
 * Library-default specification data, for the stacked editor.
 *
 * B-3 · Step 3. Loads LIBRARY scope explicitly — `quote_id IS NULL`. There is
 * no quote branch here on purpose: this action exists to serve the Library
 * sub-flow, and a scope parameter would let a quote-context caller reach master
 * data through a door that was built for the other room.
 */
export async function fetchLibraryDefaultSpecs(
  leafId: string,
): Promise<ActionResult<LeafSpecEntryData | null>> {
  return runAction(async () => {
    await ensureUser();
    return loadLeafForSpecEntry(leafId, { library: true });
  });
}
