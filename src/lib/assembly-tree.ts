import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  decodePinnedSchema,
  SPEC_SCHEMA_PRODUCT_TYPE_ID,
  type PinnedSpecSchema,
} from "@/lib/product-structure/spec-schema-mapping";
import { loadHubspotProductTypeOptions } from "@/lib/hubspot-product-type-vocabulary";
import {
  assemblies,
  assemblyLeaves,
  itemGroupCategories,
  leafSpecs,
  leaves,
  productTypes,
  quoteLeaves,
} from "@/db/schema";

// Phase A.1 v2 — Setup IA tree shape + loader.
//
// Two-level tree per CD's Quote Workflow A.1 v2 designer notes:
//
//   ASY (assemblies) parent rows
//     └── LEAF children (via assembly_leaves junction; references
//         globally-scoped `leaves` library rows)
//
// v1 invariant: assembly_leaves.parent_assembly_leaf_id IS NULL on
// every row. Deeper nesting (leaves under leaves) is schema-supported
// but app-side-guarded out (per Architect Gate 3 + Edward §15
// disposition). This helper renders one indent level; deeper levels
// trigger an assertion in dev to surface invariant violations.

/**
 * Step 7 · how a quote-local Item Group is classified.
 *
 * Its own registry, not `product_types`. These nine have no HubSpot origin and
 * no field schema; sharing a table with the leaf Spec Schemas is what let an
 * Item Group be presented as carrying a competing leaf Product Type. Nothing
 * about the categories themselves changed — only which authority owns them.
 */
export type ItemGroupCategoryRef = {
  id: string;
  name: string;
};

/**
 * A leaf's AUTHORITATIVE Product Type — HubSpot's `hs_product_type`. Step 4.5.
 *
 * Deliberately NOT a `ProductTypeRef`. That shape names a `product_types` row,
 * and a leaf's Product Type is no longer one: it is HubSpot's classification,
 * read live, so the Library and Setup cannot disagree about what a product is.
 * Giving it its own type made the compiler find every consumer during the
 * cutover instead of letting a field quietly change meaning underneath them.
 *
 * `ProductTypeRef` survives for ASSEMBLIES, whose classification is genuinely
 * a Nexus-local `product_types` row (Item Group Category).
 */
export type AuthoritativeProductType = {
  /** HubSpot internal value. What is stored and what filters match. */
  value: string;
  /** What the operator reads. Falls back to `value` when unresolvable. */
  label: string;
};

/**
 * The PINNED Spec Schema governing this quote's spec values. Step 4.4.
 *
 * Pinned at attachment, so a later HubSpot reclassification cannot retroactively
 * reinterpret values already authored. Distinct from the Product Type above:
 * that one is live, this one is frozen, and conflating them is the defect.
 */
export type SpecSchemaRef = {
  pin: PinnedSpecSchema;
  /** `product_types.id` carrying the field schema — null when none applies. */
  typeId: string | null;
  typeName: string | null;
};

export type AssemblyLeafNode = {
  // Junction row identity (the row in assembly_leaves)
  junctionId: string;
  // OD-017 CANONICAL COST-INPUT IDENTITY (the row in quote_leaves).
  //
  // This is the id the math layer keys `skuRollups` on, so ANY consumer
  // joining a tree node to costing output must match on this — never on
  // `junctionId`, which is the legacy grouped-membership identity and lives in
  // a different id space. Both are `string`, so the compiler cannot tell them
  // apart; OD-028 is the third consumer found matching on the wrong one.
  quoteLeafId: string;
  position: number;
  quantity: string;
  // Library leaf identity (the row in leaves)
  leafId: string;
  name: string;
  sku: string | null;
  /** LIVE HubSpot authority. Same value the Library shows. Step 4.5. */
  productType: AuthoritativeProductType | null;
  /** PINNED behaviour. What `spec_values` are validated against. Step 4.4. */
  specSchema: SpecSchemaRef | null;
  unitCost: string | null;
  archived: boolean;
  // Global reference count — total assembly_leaves rows pointing at
  // this leaf across all quotes. Drives "+ N other ASYs" vs "this
  // scenario only" caption per CD designer notes §3.4. Includes the
  // current junction; consumers subtract 1 for "other refs".
  globalRefCount: number;
  // Spec completeness — derived from current leaf_specs row + the
  // product type's field_schema. Null when no product_type assigned.
  specCompleteness: SpecCompleteness | null;
};

export type SpecCompleteness =
  // Step 4.5 · the authoritative Product Type is MISSING. Before the cutover
  // this fired whenever nobody had run the Nexus TypePicker, which was ~1,051
  // of 1,077 products and therefore told an operator nothing.
  | { kind: "no_type" }
  // Specifications intentionally do not apply — freight, services, one-time
  // charges. A finished answer, and kept distinct from `no_type` because that
  // one is an unanswered question. Collapsing them is what made a classified
  // product and an unclassified one look identical.
  | { kind: "no_schema"; typeLabel: string }
  | { kind: "placeholder"; typeName: string } // type is placeholder (Soft goods, Tertiary)
  | { kind: "empty"; typeName: string; total: number } // type has schema; zero filled
  | {
      kind: "partial";
      typeName: string;
      filled: number;
      total: number;
    }
  | { kind: "complete"; typeName: string; total: number };

export type AssemblyNode = {
  id: string;
  sku: string;
  name: string;
  packLabel: string | null;
  /** Step 7 · the Item Group's CATEGORY. Never a leaf Product Type. */
  category: ItemGroupCategoryRef | null;
  unitPrice: string | null;
  unitCost: string | null;
  position: number;
  internalNotes: string | null;
  description: string | null;
  imageUrl: string | null;
  children: AssemblyLeafNode[];
  rollup: AssemblyCompletenessRollup;
};

// Per scenario ④ (ASY rollup completeness states): "All complete ·
// partial · no leaves · mixed". The rollup is computed across the
// assembly's children's individual completeness states.
export type AssemblyCompletenessRollup =
  | { kind: "no_leaves" } // empty children array
  | { kind: "all_complete"; count: number }
  | { kind: "partial"; complete: number; total: number }
  | { kind: "mixed_with_placeholders"; complete: number; total: number; placeholders: number };

// A product attached directly to the quote — `quote_leaves.assembly_id IS NULL`.
//
// Structurally identical to an assembly member MINUS `junctionId`, because a
// Direct Product has no `assembly_leaves` row at all. The omission is the point:
// the legacy junction is what makes something a group member, so a type that
// cannot carry one cannot accidentally be treated as grouped.
export type DirectProductNode = Omit<AssemblyLeafNode, "junctionId">;

export type AssemblyTree = {
  assemblies: AssemblyNode[];
  // Products attached at quote level. PEER to `assemblies`, never a member of
  // one — the Design Authority holds that Add Product and Add Item Group are
  // independent operator choices, and SO2704 proves the distinction survives
  // into the customer document (a one-product Item Group prints as a named
  // container with a nested line; a Direct Product prints as one line).
  //
  // Consumers must therefore never collapse a single-member assembly into this
  // collection, nor wrap a member of this collection into an assembly.
  directProducts: DirectProductNode[];
  // Headline counts for the header counter ("N SKUs · M assemblies").
  // SKU count = leaf count across all assemblies PLUS direct products;
  // assembly count = top-level ASY count.
  totalSkus: number;
  totalAssemblies: number;
  totalDirectProducts: number;
};

/**
 * Loads the Phase A.1 v2 assembly tree for a quote.
 *
 * canonical-scenario-create-flow change — always returns non-null
 * (empty tree on zero-assembly state instead of null). The legacy
 * read-path branching to `quote_skus` is removed in this slice;
 * every quote routes to the new ASY/LEAF tree (with empty-state
 * affordance when no assemblies exist).
 *
 * Nullable return type signature is PRESERVED (per CA disposition
 * "non-breaking refactor") for future flexibility, but the
 * function never returns null in practice.
 *
 * Single-pass: 4 parallel queries (assemblies, junctions, leaves,
 * current leaf_specs) + 1 product_types fetch. No N+1.
 */
/**
 * Operator-facing labels for the authoritative Product Type values. Step 4.5.
 *
 * FAIL-SOFT BY CONSTRUCTION. The vocabulary is HubSpot-side and cached for the
 * process lifetime, but the first call in a cold process is a network request,
 * and Setup must not stop rendering because HubSpot is slow or unreachable.
 * On failure every type falls back to its internal value — still authoritative,
 * still correct, merely less polished than the label.
 *
 * The label is presentation ONLY. `value` is what is stored, filtered and
 * mapped; a reader that matched on the label would miss the three divergent
 * options, which is roughly half the catalogue.
 */
async function loadTypeLabels(): Promise<Map<string, string>> {
  try {
    const options = await loadHubspotProductTypeOptions();
    return new Map(options.map((o) => [o.value, o.label] as const));
  } catch {
    return new Map();
  }
}

export async function loadAssemblyTree(
  quoteId: string,
): Promise<AssemblyTree | null> {
  // First wave: assemblies AND quote-level Direct Products. Both are
  // top-level structure, so neither may gate the other — an early return on
  // zero assemblies would have made a Direct-only quote render as empty, which
  // is the shape of the OD-017 defect (structure that exists and is never seen).
  const [asmRows, directRows] = await Promise.all([
    db
      .select()
      .from(assemblies)
      .where(eq(assemblies.quoteId, quoteId))
      .orderBy(asc(assemblies.position), asc(assemblies.createdAt)),
    db
      .select()
      .from(quoteLeaves)
      .where(and(eq(quoteLeaves.quoteId, quoteId), isNull(quoteLeaves.assemblyId)))
      .orderBy(asc(quoteLeaves.position), asc(quoteLeaves.createdAt)),
  ]);

  // canonical-scenario-create-flow — empty-state return (was
  // `return null` triggering legacy fallback; now returns empty
  // tree so AssemblyTreeView renders its "No assemblies yet"
  // empty state). Now gated on BOTH collections being empty.
  if (asmRows.length === 0 && directRows.length === 0) {
    return {
      assemblies: [],
      directProducts: [],
      totalSkus: 0,
      totalAssemblies: 0,
      totalDirectProducts: 0,
    };
  }

  const asmIds = asmRows.map((r) => r.id);

  // Second wave: junction rows + product types in parallel. Junction
  // rows give us leafIds; product types we deref via the assembly's
  // productTypeId (one fetch covers both ASY-scope + leaf-scope).
  const [junctionRows, allTypes, allCategories] = await Promise.all([
    asmIds.length > 0
      ? db
          .select()
          .from(assemblyLeaves)
          .where(inArray(assemblyLeaves.assemblyId, asmIds))
          .orderBy(asc(assemblyLeaves.position), asc(assemblyLeaves.createdAt))
      : Promise.resolve([] as (typeof assemblyLeaves.$inferSelect)[]),
    db.select().from(productTypes),
    db.select().from(itemGroupCategories),
  ]);
  // Loaded here rather than inside the projection so one lookup covers the
  // whole tree, and so a HubSpot outage degrades the LABEL only — never the
  // structure or the classification itself.
  const typeLabels = await loadTypeLabels();

  const typeMap = new Map(allTypes.map((t) => [t.id, t] as const));
  const categoryMap = new Map(allCategories.map((c) => [c.id, c] as const));

  // Dev-mode invariant: v1 forbids non-NULL parent_assembly_leaf_id.
  // Schema allows it; app-side guard rejects writes. Surface any
  // surprise rows so the invariant violation is loud, not silent.
  if (process.env.NODE_ENV !== "production") {
    const nested = junctionRows.filter(
      (r) => r.parentAssemblyLeafId !== null,
    );
    if (nested.length > 0) {
      console.warn(
        `[assembly-tree] v1 invariant violation: ${nested.length} assembly_leaves rows have non-NULL parent_assembly_leaf_id. Rendering ignores nesting; review attach-action guard.`,
      );
    }
  }

  // Library rows are needed for BOTH grouped members and Direct Products, so
  // the id set spans both. One query pair serves the whole tree.
  const leafIds = Array.from(
    new Set([
      ...junctionRows.map((r) => r.leafId),
      ...directRows.map((r) => r.leafId),
    ]),
  );
  if (leafIds.length === 0) {
    // Edge case: ASYs exist but no junction rows and no Direct Products — all
    // assemblies have empty children. Skip leaf + spec queries.
    return assembleTree(asmRows, junctionRows, directRows, [], [], new Map(), typeMap, typeLabels, categoryMap);
  }

  // Third wave: library leaves + current spec rows for those leaves
  // + global ref count per leaf.
  const [leafRows, specRows, globalRefRows] = await Promise.all([
    db.select().from(leaves).where(inArray(leaves.id, leafIds)),
    db
      .select()
      .from(leafSpecs)
      // B-3 — QUOTE-SCOPED. Resolves this quote's own authority. There is no
      // `is_current` fallback: after B-3 an attached leaf always owns a row, so
      // a fallback could only serve Library state to a quote, which is the
      // defect this replaced.
      .where(
        and(inArray(leafSpecs.leafId, leafIds), eq(leafSpecs.quoteId, quoteId)),
      ),
    // How many QUOTES use this library product — not how many attachment rows
    // exist.
    //
    // Counted on `quote_leaves`, the CANONICAL attachment table, not the legacy
    // junction: a Direct Product has no junction row, so the old basis reported
    // "this scenario only" for a product used elsewhere.
    //
    // COUNT(DISTINCT quote_id), because a raw COUNT(*) counts ATTACHMENTS. 20
    // (quote, leaf) pairs currently hold more than one attachment — the same
    // library product in two Item Groups of one quote — and a row-count basis
    // reports those siblings as "other uses", which reads as other quotes.
    db
      .select({
        leafId: quoteLeaves.leafId,
        n: sql<number>`count(distinct ${quoteLeaves.quoteId})::int`,
      })
      .from(quoteLeaves)
      .where(inArray(quoteLeaves.leafId, leafIds))
      .groupBy(quoteLeaves.leafId),
  ]);

  const refCountMap = new Map(globalRefRows.map((r) => [r.leafId, r.n] as const));

  return assembleTree(
    asmRows,
    junctionRows,
    directRows,
    leafRows,
    specRows,
    refCountMap,
    typeMap,
    typeLabels,
    categoryMap,
  );
}

function assembleTree(
  asmRows: (typeof assemblies.$inferSelect)[],
  junctionRows: (typeof assemblyLeaves.$inferSelect)[],
  directRows: (typeof quoteLeaves.$inferSelect)[],
  leafRows: (typeof leaves.$inferSelect)[],
  specRows: (typeof leafSpecs.$inferSelect)[],
  refCountMap: Map<string, number>,
  typeMap: Map<string, typeof productTypes.$inferSelect>,
  typeLabels: Map<string, string>,
  categoryMap: Map<string, typeof itemGroupCategories.$inferSelect>,
): AssemblyTree {
  const leafMap = new Map(leafRows.map((r) => [r.id, r] as const));
  const specMap = new Map(specRows.map((r) => [r.leafId, r] as const));

  // Shared projection so a Direct Product and an assembly member are described
  // identically wherever they are genuinely the same thing. The ONLY difference
  // between them is membership, and membership is expressed by which collection
  // the node lands in — never by differing field semantics.
  const describeLeaf = (
    leaf: typeof leaves.$inferSelect,
  ): Omit<DirectProductNode, "quoteLeafId" | "position" | "quantity"> => {
    // Step 4.5 · TWO authorities, deliberately not one.
    //
    // The displayed Product Type is HubSpot's, read LIVE, so the Library and
    // Setup can never disagree about what a product is — that divergence was
    // the B-4/B-10 finding, where a product typed in the Library read `untyped`
    // here because Nexus kept a second taxonomy nobody populated.
    //
    // The Spec Schema is PINNED on this quote's own authority, so a later
    // HubSpot reclassification changes what future attachments resolve without
    // reinterpreting values an operator already authored.
    //
    // Neither reads `leaves.product_type_id`. There is no fallback to it: an
    // unlinked product has no authoritative classification, and inventing one
    // from the retired taxonomy is what this cutover removes.
    const spec = specMap.get(leaf.id);
    const schema = describeSpecSchema(spec, typeMap);
    const typeValue = leaf.hubspotProductType;
    return {
      leafId: leaf.id,
      name: leaf.name,
      sku: leaf.sku,
      productType: typeValue
        ? { value: typeValue, label: typeLabels.get(typeValue) ?? typeValue }
        : null,
      specSchema: schema,
      unitCost: leaf.unitCost,
      archived: leaf.archived,
      globalRefCount: refCountMap.get(leaf.id) ?? 1,
      specCompleteness: computeSpecCompleteness(schema, spec, typeMap),
    };
  };

  // Group junctions by assemblyId. Pre-ordered by (position, createdAt).
  const junctionsByAsm = new Map<string, typeof junctionRows>();
  for (const jct of junctionRows) {
    const list = junctionsByAsm.get(jct.assemblyId) ?? [];
    list.push(jct);
    junctionsByAsm.set(jct.assemblyId, list);
  }

  const assemblyNodes: AssemblyNode[] = asmRows.map((asm) => {
    const junctions = junctionsByAsm.get(asm.id) ?? [];
    const children: AssemblyLeafNode[] = junctions
      // v1 invariant: render only top-level junctions; nesting deferred.
      .filter((j) => j.parentAssemblyLeafId === null)
      .map((j) => {
        const leaf = leafMap.get(j.leafId);
        if (!leaf) {
          // Shouldn't happen given the FK; log loudly so debugging is
          // straightforward if it does.
          throw new Error(
            `[assembly-tree] leafId ${j.leafId} referenced by junction ${j.id} but no leaf row found`,
          );
        }
        return {
          junctionId: j.id,
          quoteLeafId: j.quoteLeafId,
          position: j.position,
          quantity: j.quantity,
          ...describeLeaf(leaf),
        } satisfies AssemblyLeafNode;
      });

    // Step 7 · read from the Item Group Category registry. Never from
    // `product_types`. The legacy `assemblies.product_type_id` it replaced was
    // removed in Step 9.
    const asmCategory = asm.itemGroupCategoryId
      ? categoryMap.get(asm.itemGroupCategoryId)
      : null;
    const category: ItemGroupCategoryRef | null = asmCategory
      ? { id: asmCategory.id, name: asmCategory.name }
      : null;

    return {
      id: asm.id,
      sku: asm.sku,
      name: asm.name,
      packLabel: asm.packLabel,
      category,
      unitPrice: asm.unitPrice,
      unitCost: asm.unitCost,
      position: asm.position,
      internalNotes: asm.internalNotes,
      description: asm.description,
      imageUrl: asm.imageUrl,
      children,
      rollup: computeRollup(children),
    } satisfies AssemblyNode;
  });

  const directProducts: DirectProductNode[] = directRows.map((row) => {
    const leaf = leafMap.get(row.leafId);
    if (!leaf) {
      throw new Error(
        `[assembly-tree] leafId ${row.leafId} referenced by quote_leaf ${row.id} but no leaf row found`,
      );
    }
    return {
      quoteLeafId: row.id,
      position: row.position,
      quantity: row.quantity,
      ...describeLeaf(leaf),
    } satisfies DirectProductNode;
  });

  return {
    assemblies: assemblyNodes,
    directProducts,
    // Both collections are SKUs on the quote. A Direct Product is a product the
    // customer is being quoted, so omitting it here would under-report the
    // quote's own size.
    totalSkus:
      assemblyNodes.reduce((acc, a) => acc + a.children.length, 0) +
      directProducts.length,
    totalAssemblies: assemblyNodes.length,
    totalDirectProducts: directProducts.length,
  };
}

/**
 * Per scenario ⑤-⑩ in CD prototype (spec-entry surface lands in
 * impl-3, but the completeness chip on the tree row is impl-2 scope).
 *
 * Rules per designer notes §3 "Edit specs is type-aware":
 * - leaf has no product_type → `no_type` (drives type-picker empty state on Edit specs)
 * - type is placeholder (Soft goods, Tertiary) → `placeholder`
 * - type has field_schema but spec row missing → `empty`
 * - spec_values has SOME but not ALL keys from field_schema → `partial`
 * - spec_values has ALL keys → `complete`
 *
 * "Filled" is non-empty-string, non-null value. Empty strings count
 * as not-filled (a PM clearing a field shouldn't count toward complete).
 */
/**
 * Resolve the pinned Spec Schema into the `product_types` row carrying its
 * field definitions. Step 4.4.
 *
 * The three schema rows keep their field definitions; what changed is how a
 * leaf arrives at one. It is no longer an operator-authored assignment — it is
 * derived from authoritative classification and frozen at attachment.
 */
function describeSpecSchema(
  spec: typeof leafSpecs.$inferSelect | undefined,
  typeMap: Map<string, typeof productTypes.$inferSelect>,
): SpecSchemaRef | null {
  if (!spec) return null;
  const resolution = decodePinnedSchema(
    spec.specSchema,
    spec.schemaDerivedFromType,
  );
  // `null` covers both `no_type` and an unpinned row: no schema is established
  // either way. The two stay distinguishable in the table, where the difference
  // is diagnosable, rather than in every branch that consumes this.
  if (resolution === null)
    return { pin: "no_type", typeId: null, typeName: null };
  if (resolution.kind === "schema") {
    const typeId = SPEC_SCHEMA_PRODUCT_TYPE_ID[resolution.schemaId];
    return {
      pin: resolution.schemaId,
      typeId,
      typeName: typeMap.get(typeId)?.name ?? null,
    };
  }
  // An `unmapped` pin is NOT folded into `no_schema`. CI is meant to make it
  // unreachable, so if one renders, that is the signal it exists.
  return {
    pin: resolution.kind === "no_schema" ? "no_schema" : "unmapped",
    typeId: null,
    typeName: null,
  };
}

function computeSpecCompleteness(
  schema: SpecSchemaRef | null,
  spec: typeof leafSpecs.$inferSelect | undefined,
  typeMap: Map<string, typeof productTypes.$inferSelect>,
): SpecCompleteness | null {
  if (!schema || schema.pin === "no_type") return { kind: "no_type" };
  if (schema.pin === "no_schema" || schema.pin === "unmapped")
    return {
      kind: "no_schema",
      typeLabel: spec?.schemaDerivedFromType ?? "",
    };
  const type = schema.typeId ? typeMap.get(schema.typeId) : null;
  if (!type) return { kind: "no_type" };
  if (type.placeholder) return { kind: "placeholder", typeName: type.name };
  const fieldSchema = type.fieldSchema as
    | { fields: { key: string }[] }
    | null
    | undefined;
  if (!fieldSchema || !Array.isArray(fieldSchema.fields)) {
    return { kind: "placeholder", typeName: type.name };
  }
  const total = fieldSchema.fields.length;
  if (total === 0) return { kind: "placeholder", typeName: type.name };
  const values = (spec?.specValues as Record<string, unknown> | undefined) ?? {};
  const filled = fieldSchema.fields.filter((f) => {
    const v = values[f.key];
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  }).length;
  if (filled === 0) return { kind: "empty", typeName: type.name, total };
  if (filled < total) return { kind: "partial", typeName: type.name, filled, total };
  return { kind: "complete", typeName: type.name, total };
}

/**
 * ASY-level rollup of child completeness states. Scenario ④ visual:
 *
 *   - no_leaves         — empty ASY, "Add leaves" callout
 *   - all_complete      — every leaf fully filled per its type
 *   - partial           — leaves exist; some complete, some not (no
 *                         placeholders mixed in)
 *   - mixed_with_placeholders
 *                       — leaves exist; at least one placeholder type
 *                         (Soft goods / Tertiary) — the rollup
 *                         can't be "complete" because placeholder
 *                         field-schemas haven't been authored
 */
function computeRollup(children: AssemblyLeafNode[]): AssemblyCompletenessRollup {
  if (children.length === 0) return { kind: "no_leaves" };
  let complete = 0;
  let placeholders = 0;
  for (const c of children) {
    const sc = c.specCompleteness;
    if (!sc) continue;
    if (sc.kind === "complete") complete++;
    if (sc.kind === "placeholder") placeholders++;
  }
  const total = children.length;
  if (placeholders > 0) {
    return { kind: "mixed_with_placeholders", complete, total, placeholders };
  }
  if (complete === total) return { kind: "all_complete", count: total };
  return { kind: "partial", complete, total };
}

// canonical-scenario-create-flow removed `quoteUsesNewSchema`
// helper. The Setup page no longer branches on schema; every quote
// renders the new ASY/LEAF tree. Removal is surgical — zero
// callers depended on this helper (verified via grep at slice
// kickoff Investigation #5).
