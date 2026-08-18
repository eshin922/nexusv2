// Step 8 — sku-tree library uses a structural SkuRow shape, not
// the OLD `quote_skus` $inferSelect type. Callers (synthetic Costs
// page shape post-Step 3 + remaining OLD-model code paths in
// quotes.ts) pass row objects matching the shape below.

export type SkuRoleValue = "leaf" | "assembly";

export type SkuRow = {
  id: string;
  /**
   * The CANONICAL quote_leaf id, when this row came from a canonical
   * attachment. Distinct from `id`, which is the assembly_leaf junction id for
   * a member — and identical to it for a top-level leaf, which is exactly what
   * lets the two be confused.
   *
   * Declared because the Costs page already sets it and a consumer needed it:
   * the production markup node is keyed by this id, not by `id`, and reading
   * the wrong one fails closed to an em-dash indistinguishable from "no rate".
   */
  quoteLeafId?: string | null;
  skuLabel: string;
  productName: string;
  skuRole: SkuRoleValue;
  parentSkuId: string | null;
  qtyPerParent: string | null;
  sortOrder: number;
  createdAt: Date;
  // Optional fields read by toSnapshot for the audit-log subtree
  // snapshot path; synthetic callers (Costs page + Pricing surface)
  // pass null/defaults.
  hubspotProductId: string | null;
  unitsPerPack: number;
  retailBenchmark: string | null;
  notes: string | null;
  // validateAssemblyOperation references parent.quoteId for the
  // cross-quote rejection check.
  quoteId: string;
};

/**
 * Slice 5.5 — assembly tree helpers. Validation lives here; actions
 * call validateAssemblyOperation before mutating, then snapshot the
 * affected subtree via getDescendants for the audit log.
 *
 * Tree rules:
 *   - leaf: terminal. Cannot have children.
 *   - assembly: can have children. Can also be a child of another assembly.
 *   - parent and child must belong to the same quote.
 *   - cycles forbidden: a SKU's parent chain must not loop back to it.
 *   - qty_per_parent is required when parent_sku_id is set; null otherwise.
 */

export function canHaveChildren(role: SkuRoleValue): boolean {
  return role === "assembly";
}

/**
 * All descendants (children + grandchildren + …) of skuId, breadth-first.
 * Caller passes the full SKU set for the quote (avoids N round trips
 * during cascading operations).
 */
export function getDescendants(skuId: string, allSkus: SkuRow[]): SkuRow[] {
  const childrenByParent = new Map<string, SkuRow[]>();
  for (const s of allSkus) {
    if (s.parentSkuId) {
      const arr = childrenByParent.get(s.parentSkuId) ?? [];
      arr.push(s);
      childrenByParent.set(s.parentSkuId, arr);
    }
  }
  const out: SkuRow[] = [];
  const queue: string[] = [skuId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const kids = childrenByParent.get(id) ?? [];
    for (const k of kids) {
      out.push(k);
      queue.push(k.id);
    }
  }
  return out;
}

/**
 * Direct children of skuId (one level only).
 */
export function getChildren(skuId: string, allSkus: SkuRow[]): SkuRow[] {
  return allSkus.filter((s) => s.parentSkuId === skuId);
}

/**
 * Walk up from descendant via parent_sku_id; return true if
 * potentialAncestor appears in the chain. Used to prevent cycles when
 * assigning a parent (a SKU cannot become a child of one of its own
 * descendants).
 */
export function isAncestor(
  potentialAncestor: string,
  descendant: string,
  allSkus: SkuRow[],
): boolean {
  const byId = new Map(allSkus.map((s) => [s.id, s]));
  let cursor = byId.get(descendant);
  const seen = new Set<string>();
  while (cursor?.parentSkuId) {
    if (seen.has(cursor.parentSkuId)) return false; // safety, shouldn't happen
    seen.add(cursor.parentSkuId);
    if (cursor.parentSkuId === potentialAncestor) return true;
    cursor = byId.get(cursor.parentSkuId);
  }
  return false;
}

export type AssemblyValidation =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Validate that a proposed (parent_sku_id, qty_per_parent, sku_role)
 * assignment is legal given the current tree state. Used by all
 * assembly-mutating actions (addSkuFromHubspotProduct, addAssemblySku,
 * assignSkuToParent, convertSkuRole).
 *
 * Role rules:
 *   - Demoting assembly → leaf is blocked if the SKU has children. PM
 *     must detach or delete them explicitly. No auto-detach.
 *   - Promoting leaf → assembly is always allowed (parent state preserved).
 *   - Both assemblies and leaves can have parents (assembly nesting is
 *     supported — an assembly can be a child of another assembly).
 */
export function validateAssemblyOperation(args: {
  skuId: string | null; // null when creating; existing id when modifying
  newParentId: string | null;
  newQtyPerParent: number | string | null;
  newRole: SkuRoleValue;
  quoteId: string;
  allSkus: SkuRow[];
}): AssemblyValidation {
  const { skuId, newParentId, newQtyPerParent, newRole, quoteId, allSkus } = args;

  // Old role (null at creation) — needed for transition checks.
  const oldRole: SkuRoleValue | null = skuId
    ? ((allSkus.find((s) => s.id === skuId)?.skuRole as SkuRoleValue | undefined) ?? null)
    : null;

  // Parent must be in same quote, can have children, no cycle, qty>0.
  if (newParentId) {
    const parent = allSkus.find((s) => s.id === newParentId);
    if (!parent)
      return {
        ok: false,
        code: "PARENT_NOT_FOUND",
        message: "Parent SKU does not exist in this quote.",
      };
    if (parent.quoteId !== quoteId)
      return {
        ok: false,
        code: "PARENT_DIFFERENT_QUOTE",
        message: "Parent SKU must belong to the same quote.",
      };
    if (!canHaveChildren(parent.skuRole))
      return {
        ok: false,
        code: "PARENT_NOT_ASSEMBLY",
        message: "Parent SKU is a leaf; only assemblies can have children.",
      };
    if (skuId && newParentId === skuId)
      return {
        ok: false,
        code: "CYCLE_SELF",
        message: "A SKU cannot be its own parent.",
      };
    if (skuId && isAncestor(skuId, newParentId, allSkus))
      return {
        ok: false,
        code: "CYCLE_DESCENDANT",
        message:
          "Cannot assign this SKU under one of its own descendants — that would create a cycle.",
      };
    if (
      newQtyPerParent === null ||
      newQtyPerParent === undefined ||
      newQtyPerParent === "" ||
      Number(newQtyPerParent) <= 0
    )
      return {
        ok: false,
        code: "QTY_REQUIRED",
        message: "qty_per_parent must be greater than zero when assigning a parent.",
      };
  } else {
    if (newQtyPerParent !== null && newQtyPerParent !== undefined && newQtyPerParent !== "")
      return {
        ok: false,
        code: "QTY_WITHOUT_PARENT",
        message: "qty_per_parent only applies when the SKU has a parent.",
      };
  }

  // Demoting assembly → leaf is refused if SKU has children. PM detaches
  // or deletes them explicitly. No auto-detach.
  if (skuId && newRole === "leaf" && oldRole === "assembly") {
    const kids = getChildren(skuId, allSkus);
    if (kids.length > 0) {
      return {
        ok: false,
        code: "HAS_CHILDREN",
        message: `This assembly has ${kids.length} component${
          kids.length === 1 ? "" : "s"
        }. Detach or delete ${kids.length === 1 ? "it" : "them"} before converting to a leaf.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Build a forensic snapshot of a SKU + its full subtree, used by
 * cascading actions (deleteSku, assignSkuToParent that orphans, etc.)
 * to capture state in audit log diff_json BEFORE the cascade fires.
 *
 * Includes only fields that meaningfully describe the SKU. Excludes
 * created_at/updated_at noise.
 */
export function snapshotSkuSubtree(rootId: string, allSkus: SkuRow[]): {
  root: SkuSnapshot | null;
  descendants: SkuSnapshot[];
} {
  const root = allSkus.find((s) => s.id === rootId) ?? null;
  const descendants = getDescendants(rootId, allSkus);
  return {
    root: root ? toSnapshot(root) : null,
    descendants: descendants.map(toSnapshot),
  };
}

/**
 * Flatten a SKU list into render order (DFS) annotated with depth so the
 * UI can indent children under their parents. Roots = parentSkuId is null.
 * Within a sibling group, sorted by sortOrder then createdAt.
 */
export function buildTreeRenderOrder(
  skus: SkuRow[],
): Array<{ sku: SkuRow; depth: number; isLastSibling: boolean }> {
  const childrenByParent = new Map<string, SkuRow[]>();
  const roots: SkuRow[] = [];
  for (const s of skus) {
    if (s.parentSkuId) {
      const arr = childrenByParent.get(s.parentSkuId) ?? [];
      arr.push(s);
      childrenByParent.set(s.parentSkuId, arr);
    } else {
      roots.push(s);
    }
  }
  const cmp = (a: SkuRow, b: SkuRow) =>
    a.sortOrder - b.sortOrder ||
    (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  roots.sort(cmp);
  for (const kids of childrenByParent.values()) kids.sort(cmp);

  const out: Array<{ sku: SkuRow; depth: number; isLastSibling: boolean }> = [];
  function walk(node: SkuRow, depth: number, isLastSibling: boolean) {
    out.push({ sku: node, depth, isLastSibling });
    const kids = childrenByParent.get(node.id) ?? [];
    kids.forEach((k, i) => walk(k, depth + 1, i === kids.length - 1));
  }
  roots.forEach((r, i) => walk(r, 0, i === roots.length - 1));
  return out;
}

/**
 * Which sku_role targets are allowed for a given SKU's current state?
 * Mirrors validateAssemblyOperation's transition rules so the role
 * selector only ever offers valid options. Server still validates as
 * defense in depth.
 *
 * With the simplified two-value enum:
 *   - leaf → assembly: always allowed
 *   - assembly → leaf: blocked if has children
 */
export function eligibleRoleTargets(
  currentRole: SkuRoleValue,
  _hasParent: boolean,
  hasChildren: boolean,
): SkuRoleValue[] {
  const out: SkuRoleValue[] = [currentRole];
  for (const target of ["leaf", "assembly"] as const) {
    if (target === currentRole) continue;
    if (target === "leaf" && currentRole === "assembly" && hasChildren) continue;
    out.push(target);
  }
  return out;
}

/**
 * Eligible parents: assembly SKUs in the same quote. Excludes the SKU
 * itself and its descendants (cycle prevention).
 */
export function getEligibleParents(
  skus: SkuRow[],
  excludeSkuId: string | null,
): SkuRow[] {
  const excluded = new Set<string>();
  if (excludeSkuId) {
    excluded.add(excludeSkuId);
    for (const d of getDescendants(excludeSkuId, skus)) excluded.add(d.id);
  }
  return skus.filter((s) => !excluded.has(s.id) && s.skuRole === "assembly");
}

export type SkuSnapshot = {
  id: string;
  sku_label: string;
  product_name: string;
  sku_role: SkuRoleValue;
  parent_sku_id: string | null;
  qty_per_parent: string | null;
  hubspot_product_id: string | null;
  units_per_pack: number;
  retail_benchmark: string | null;
  notes: string | null;
  sort_order: number;
};

function toSnapshot(s: SkuRow): SkuSnapshot {
  return {
    id: s.id,
    sku_label: s.skuLabel,
    product_name: s.productName,
    sku_role: s.skuRole as SkuRoleValue,
    parent_sku_id: s.parentSkuId,
    qty_per_parent: s.qtyPerParent,
    hubspot_product_id: s.hubspotProductId,
    units_per_pack: s.unitsPerPack,
    retail_benchmark: s.retailBenchmark,
    notes: s.notes,
    sort_order: s.sortOrder,
  };
}
