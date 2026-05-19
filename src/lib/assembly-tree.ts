import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  leafSpecs,
  leaves,
  productTypes,
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
  position: number;
  quantity: string;
  // Library leaf identity (the row in leaves)
  leafId: string;
  name: string;
  sku: string | null;
  productType: ProductTypeRef | null;
  unitCost: string | null;
  archived: boolean;
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

export type AssemblyTree = {
  assemblies: AssemblyNode[];
  // Headline counts for the header counter ("N SKUs · M assemblies").
  // SKU count = leaf count across all assemblies; assembly count =
  // top-level ASY count.
  totalSkus: number;
  totalAssemblies: number;
};

/**
 * Loads the Phase A.1 v2 assembly tree for a quote. Returns null when
 * the quote has zero `assemblies` rows — caller uses that signal to
 * fall back to the legacy `quote_skus` render path (read-path
 * branching per brief §4.2 Step 6).
 *
 * Single-pass: 4 parallel queries (assemblies, junctions, leaves,
 * current leaf_specs) + 1 product_types fetch. No N+1.
 */
export async function loadAssemblyTree(
  quoteId: string,
): Promise<AssemblyTree | null> {
  // First query: assemblies for this quote, ordered by position.
  const asmRows = await db
    .select()
    .from(assemblies)
    .where(eq(assemblies.quoteId, quoteId))
    .orderBy(asc(assemblies.position), asc(assemblies.createdAt));

  // Read-path branching trigger: zero assemblies → legacy path.
  if (asmRows.length === 0) return null;

  const asmIds = asmRows.map((r) => r.id);

  // Second wave: junction rows + product types in parallel. Junction
  // rows give us leafIds; product types we deref via the assembly's
  // productTypeId (one fetch covers both ASY-scope + leaf-scope).
  const [junctionRows, allTypes] = await Promise.all([
    db
      .select()
      .from(assemblyLeaves)
      .where(inArray(assemblyLeaves.assemblyId, asmIds))
      .orderBy(asc(assemblyLeaves.position), asc(assemblyLeaves.createdAt)),
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

  const leafIds = Array.from(new Set(junctionRows.map((r) => r.leafId)));
  if (leafIds.length === 0) {
    // Edge case: ASYs exist but no junction rows — all assemblies
    // have empty children. Skip leaf + spec queries.
    return assembleTree(asmRows, junctionRows, [], [], typeMap);
  }

  // Third wave: library leaves + current spec rows for those leaves.
  const [leafRows, specRows] = await Promise.all([
    db.select().from(leaves).where(inArray(leaves.id, leafIds)),
    db
      .select()
      .from(leafSpecs)
      .where(
        and(inArray(leafSpecs.leafId, leafIds), eq(leafSpecs.isCurrent, true)),
      ),
  ]);

  return assembleTree(asmRows, junctionRows, leafRows, specRows, typeMap);
}

function assembleTree(
  asmRows: (typeof assemblies.$inferSelect)[],
  junctionRows: (typeof assemblyLeaves.$inferSelect)[],
  leafRows: (typeof leaves.$inferSelect)[],
  specRows: (typeof leafSpecs.$inferSelect)[],
  typeMap: Map<string, typeof productTypes.$inferSelect>,
): AssemblyTree {
  const leafMap = new Map(leafRows.map((r) => [r.id, r] as const));
  const specMap = new Map(specRows.map((r) => [r.leafId, r] as const));

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
        const leafType = leaf.productTypeId
          ? typeMap.get(leaf.productTypeId)
          : null;
        const productType: ProductTypeRef | null = leafType
          ? {
              id: leafType.id,
              name: leafType.name,
              scope: leafType.scope as "assembly" | "leaf",
              placeholder: leafType.placeholder,
            }
          : null;
        return {
          junctionId: j.id,
          position: j.position,
          quantity: j.quantity,
          leafId: leaf.id,
          name: leaf.name,
          sku: leaf.sku,
          productType,
          unitCost: leaf.unitCost,
          archived: leaf.archived,
          specCompleteness: computeSpecCompleteness(leafType, specMap.get(leaf.id)),
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

  return {
    assemblies: assemblyNodes,
    totalSkus: assemblyNodes.reduce((acc, a) => acc + a.children.length, 0),
    totalAssemblies: assemblyNodes.length,
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

/**
 * Lightweight "does this quote use the new schema?" check. Used by
 * the Setup page to decide read-path branching without paying the
 * cost of loading the full tree if the answer is no.
 *
 * Falls through to count-only; cheaper than loadAssemblyTree when the
 * caller only needs the boolean.
 */
export async function quoteUsesNewSchema(quoteId: string): Promise<boolean> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assemblies)
    .where(eq(assemblies.quoteId, quoteId));
  return (rows[0]?.n ?? 0) > 0;
}
