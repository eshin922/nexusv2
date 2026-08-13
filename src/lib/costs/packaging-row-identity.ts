/**
 * COSTS-RENDER-1 — which governed component is this Packaging cost row costing?
 *
 * Extracted from `packaging-drilldown.tsx` so the binding is provable. It is
 * domain logic, not presentation: an operator entering per-component costs must
 * be able to see which component each row governs, and that resolution has to
 * be assertable without rendering React or reading props through devtools.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE. The defect it fixes was a join across two
 * id spaces. OD-017 re-keyed cost rows from `assembly_leaf_id` to
 * `quote_leaf_id`, but the Costs page kept building its lookup map on
 * `assembly_leaf_id`. Both are `string`, so the compiler saw nothing wrong, and
 * every row fell through to `UNIDENTIFIED_COMPONENT`.
 *
 * WHY TOTALS COULD NOT CATCH IT. Where two components carry equal markups,
 * swapping their costs produces the identical subtotal, sell, margin and
 * turnkey. Completeness checking is structurally incapable of detecting the
 * misattribution — only per-row identity can. See the standing rule "exact
 * reconciliation is necessary but not sufficient".
 */

/** The identity-bearing subset of a Costs-page synthetic SKU. */
export type PackagingIdentitySku = {
  /** assembly_leaf id — the assembly tree / production anchor identity. */
  id: string;
  /**
   * OD-017 governed cost-input identity: the id every `assembly_leaf_inputs`
   * row carries. NOT NULL on `assembly_leaves` (unique index
   * `assembly_leaves_quote_leaf_idx`); null for an assembly, which owns no
   * cost row.
   */
  quoteLeafId: string | null;
  skuLabel: string;
  productName: string;
};

export type PackagingRowIdentity = {
  /** Primary visible label. */
  componentName: string;
  /** Secondary visible label — the SKU, shown as row sub-text. */
  skuLabel: string;
  /** False only when the bound leaf genuinely carries no governed identity. */
  resolved: boolean;
};

export const UNIDENTIFIED_COMPONENT = "Unknown component";

/**
 * Keyed on the GOVERNED COST-INPUT IDENTITY, because that is what a packaging
 * line carries in `quoteSkuId`.
 *
 * Deliberately does NOT also key on `id`. A permissive map would silently
 * re-absorb the next re-key rather than surface it, which is precisely the
 * defect this module exists to prevent. Entries without a governed identity
 * (assemblies) are excluded — they own no cost row, so nothing can look them up.
 */
export function buildPackagingIdentityMap(
  skus: readonly PackagingIdentitySku[],
): Map<string, PackagingIdentitySku> {
  return new Map(
    skus.flatMap((s) => (s.quoteLeafId ? [[s.quoteLeafId, s] as const] : [])),
  );
}

/**
 * Resolve the visible identity for a packaging line.
 *
 * `quoteSkuId` is the line's governed cost-input identity — despite the legacy
 * field name, post-OD-017 it holds a `quote_leaf_id`.
 *
 * Whitespace-only values are treated as absent: a label of " " identifies
 * nothing to an operator, and letting it satisfy the resolver would reintroduce
 * indistinguishable rows through a different door.
 */
export function resolvePackagingRowIdentity(
  identityMap: ReadonlyMap<string, PackagingIdentitySku>,
  quoteSkuId: string,
): PackagingRowIdentity {
  const sku = identityMap.get(quoteSkuId);
  const productName = sku?.productName?.trim() ?? "";
  const skuLabel = sku?.skuLabel?.trim() ?? "";
  const componentName = productName || skuLabel;
  return {
    componentName: componentName || UNIDENTIFIED_COMPONENT,
    skuLabel,
    resolved: componentName.length > 0,
  };
}
