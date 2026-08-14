import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
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

export type ProductTypeRef = {
  id: string;
  name: string;
  scope: "assembly" | "leaf";
  placeholder: boolean;
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
  productType: ProductTypeRef | null;
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
  | { kind: "no_type" } // leaf has no product_type_id
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
  productType: ProductTypeRef | null;
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
  const [junctionRows, allTypes] = await Promise.all([
    asmIds.length > 0
      ? db
          .select()
          .from(assemblyLeaves)
          .where(inArray(assemblyLeaves.assemblyId, asmIds))
          .orderBy(asc(assemblyLeaves.position), asc(assemblyLeaves.createdAt))
      : Promise.resolve([] as (typeof assemblyLeaves.$inferSelect)[]),
    db.select().from(productTypes),
  ]);

  const typeMap = new Map(allTypes.map((t) => [t.id, t] as const));

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
    return assembleTree(asmRows, junctionRows, directRows, [], [], new Map(), typeMap);
  }

  // Third wave: library leaves + current spec rows for those leaves
  // + global ref count per leaf.
  const [leafRows, specRows, globalRefRows] = await Promise.all([
    db.select().from(leaves).where(inArray(leaves.id, leafIds)),
    db
      .select()
      .from(leafSpecs)
      .where(
        and(inArray(leafSpecs.leafId, leafIds), eq(leafSpecs.isCurrent, true)),
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
    const leafType = leaf.productTypeId ? typeMap.get(leaf.productTypeId) : null;
    return {
      leafId: leaf.id,
      name: leaf.name,
      sku: leaf.sku,
      productType: leafType
        ? {
            id: leafType.id,
            name: leafType.name,
            scope: leafType.scope as "assembly" | "leaf",
            placeholder: leafType.placeholder,
          }
        : null,
      unitCost: leaf.unitCost,
      archived: leaf.archived,
      globalRefCount: refCountMap.get(leaf.id) ?? 1,
      specCompleteness: computeSpecCompleteness(leafType, specMap.get(leaf.id)),
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

    const asmType = asm.productTypeId ? typeMap.get(asm.productTypeId) : null;
    const productType: ProductTypeRef | null = asmType
      ? {
          id: asmType.id,
          name: asmType.name,
          scope: asmType.scope as "assembly" | "leaf",
          placeholder: asmType.placeholder,
        }
      : null;

    return {
      id: asm.id,
      sku: asm.sku,
      name: asm.name,
      packLabel: asm.packLabel,
      productType,
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
function computeSpecCompleteness(
  type: typeof productTypes.$inferSelect | undefined | null,
  spec: typeof leafSpecs.$inferSelect | undefined,
): SpecCompleteness | null {
  if (!type) return { kind: "no_type" };
  if (type.placeholder) return { kind: "placeholder", typeName: type.name };
  const schema = type.fieldSchema as
    | { fields: { key: string }[] }
    | null
    | undefined;
  if (!schema || !Array.isArray(schema.fields)) {
    return { kind: "placeholder", typeName: type.name };
  }
  const total = schema.fields.length;
  if (total === 0) return { kind: "placeholder", typeName: type.name };
  const values = (spec?.specValues as Record<string, unknown> | undefined) ?? {};
  const filled = schema.fields.filter((f) => {
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
