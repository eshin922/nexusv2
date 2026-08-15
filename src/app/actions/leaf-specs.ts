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
import { quoteByIdDraft } from "@/lib/quote-guards";
import {
  decodePinnedSchema,
  resolveSpecSchema,
  SPEC_SCHEMA_PRODUCT_TYPE_ID,
} from "@/lib/product-structure/spec-schema-mapping";
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
    //
    // Resolved HERE rather than just before the write, because Step 4.4 made
    // validation scope-dependent too: which schema governs the value is a
    // property of the authority being edited.
    const scope = readScope(formData);
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

    // OD-023 · a QUOTE-scoped spec value is customer-visible: it renders in the
    // PDF specification addendum. Editing one after Send would change an
    // artifact the customer already has, which is the whole defect OD-023
    // exists to close.
    //
    // LIBRARY scope is deliberately NOT gated. That row is a template owning no
    // quote's values, so there is no quote whose draft-ness could be asserted —
    // and requiring one would make master data uneditable whenever any quote
    // happened to be sent. The pin at attachment is what stops a later library
    // edit from reaching an already-sent quote; this guard covers the other
    // direction, which the pin does not.
    //
    // The only unguarded commercial writer the per-function classification
    // found. Every other module in the sweep already enforced draft through a
    // loader guard, which the earlier count missed because it searched for a
    // helper NAME rather than for the property.
    if ("quoteId" in scope) await quoteByIdDraft(scope.quoteId);

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
    // Step 4.4 · validate against the PINNED Spec Schema. Never against
    // `leaves.product_type_id`, the retired Nexus taxonomy.
    //
    // In quote scope the pin is this quote's own, frozen at attachment, so the
    // fields accepted here are exactly the fields the operator was shown — a
    // HubSpot reclassification mid-edit cannot start rejecting a key that was
    // valid when the surface rendered.
    //
    // In Library scope there is no pin, because that row is a TEMPLATE and
    // owns no quote's values; its schema resolves live from authoritative
    // classification, which is what a future attachment will inherit.
    const [scopedSpec] = await db
      .select()
      .from(leafSpecs)
      .where(scopeWhere(leafId, scope))
      .limit(1);
    const resolution =
      "quoteId" in scope
        ? decodePinnedSchema(
            scopedSpec?.specSchema,
            scopedSpec?.schemaDerivedFromType,
          )
        : resolveSpecSchema(leaf.hubspotProductType);
    if (resolution === null)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "This product has no Product Type in HubSpot, so no specification " +
          "schema applies. Classify it in HubSpot first.",
      );
    if (resolution.kind === "no_schema")
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Specifications do not apply to this product category.",
      );
    if (resolution.kind === "unmapped")
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${resolution.value}" has no governed specification schema. ` +
          "The Product Type mapping needs extending.",
      );

    const typeRows = await db
      .select()
      .from(productTypes)
      .where(eq(productTypes.id, SPEC_SCHEMA_PRODUCT_TYPE_ID[resolution.schemaId]))
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
          // Step 8 · the SCHEMA these values were authored under, which is
          // what a forensic reader needs. The retired Nexus type recorded
          // neither what governed the values nor what the product is.
          spec_schema: scopedSpec?.specSchema ?? null,
          schema_derived_from_type: scopedSpec?.schemaDerivedFromType ?? null,
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
 * Step 8 · assignLeafProductType and changeLeafProductType are RETIRED.
 *
 * They were the only operator paths that could give a leaf a Nexus Product
 * Type independently of HubSpot, and that independence is the second authority
 * this migration removes. Classification now comes from HubSpot; the Spec
 * Schema is derived from it through the governed mapping and pinned per quote.
 *
 * Deleted rather than deprecated. A server action left in place is reachable
 * by anyone holding a saved page's action id, so leaving them would have kept
 * the write path open while the UI merely stopped offering it.
 */


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
