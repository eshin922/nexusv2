import type { CustomerView } from "@/types/quote";

/**
 * Remove hidden tiers from the projection, before either renderer sees it.
 *
 * ── WHY THIS IS ONE FUNCTION AND NOT A FLAG ──────────────────────────────
 *
 * `CustomerView` is INDEX-ALIGNED: `tiers[i]` is described by `sku.tierPrices[i]`,
 * `sku.tierLineTotals[i]`, `fee.tierAmounts[i]`, `freight.tierAmounts[i]`, and
 * pointed at by `recommendedTierIdx` and `feeBasisTierIdx`.
 *
 * Handing renderers a `shown` flag would make every one of those consumers
 * responsible for skipping the same positions in the same way — six places to
 * get right, in two renderers, forever. The first one to iterate `tierPrices`
 * without the filter would print a hidden tier's price under a visible tier's
 * heading: not a missing column, a WRONG column, with the customer reading a
 * price that belongs to a quantity they were never shown.
 *
 * So the filter happens once, here, and both renderers receive a projection in
 * which the hidden tiers do not exist. There is no flag to forget.
 *
 * ── WHAT THIS IS NOT ALLOWED TO DO ───────────────────────────────────────
 *
 * No arithmetic. Every figure that survives is the same object it was: this
 * selects positions and re-points two indices. Hiding a tier must not change
 * what any remaining tier costs, and the only way to guarantee that is to
 * never recompute anything.
 */
export function applyTierVisibility(
  view: CustomerView,
  hiddenTierIds: ReadonlyArray<string>,
): CustomerView {
  if (hiddenTierIds.length === 0) return view;

  const hidden = new Set(hiddenTierIds);
  const keep: number[] = [];
  view.tiers.forEach((t, i) => {
    if (!hidden.has(t.id)) keep.push(i);
  });

  // Every tier hidden is refused by the action layer, and would be a customer
  // document with no prices on it. Defended here as well because this function
  // cannot know who called it, and returning an empty document is worse than
  // returning the whole one.
  if (keep.length === 0) return view;
  if (keep.length === view.tiers.length) return view;

  const pick = <T,>(arr: ReadonlyArray<T>): T[] => keep.map((i) => arr[i]);

  /** Where a pre-filter index lands afterwards, or null when it was hidden. */
  const remap = (idx: number | null): number | null => {
    if (idx === null) return null;
    const at = keep.indexOf(idx);
    return at === -1 ? null : at;
  };

  const recommendedTierIdx = remap(view.recommendedTierIdx);

  // The fee basis names the column the fee amounts are quoted for. If that
  // column is gone the fees would be quoted against a tier the customer cannot
  // see, so it falls back the same way the projection's own default does:
  // the recommendation, else the first surviving column.
  const feeBasisTierIdx = remap(view.feeBasisTierIdx) ?? recommendedTierIdx ?? 0;

  return {
    ...view,
    tiers: pick(view.tiers),
    skus: view.skus.map((s) => ({
      ...s,
      tierPrices: pick(s.tierPrices),
      tierLineTotals: pick(s.tierLineTotals),
    })),
    serviceFees: view.serviceFees.map((f) => ({
      ...f,
      tierAmounts: pick(f.tierAmounts),
    })),
    freightLines: view.freightLines.map((f) => ({
      ...f,
      tierAmounts: pick(f.tierAmounts),
    })),
    recommendedTierIdx,
    feeBasisTierIdx,
  };
}
