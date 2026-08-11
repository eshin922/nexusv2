// slice-pricing-surface-redesign Step 4 — shared formatters.
//
// Mirrors CD prototype formatters from
// docs/design-prototypes/dist/pricing_surface_bundle/app/pricing_surface/pricing_surface.jsx
// lines 16-20 (production canonical). PSR components import from here
// instead of redefining inline so output stays consistent across the
// STATE / ACTION / DETAIL zones.

export const fmtPct = (v: number | null | undefined): string =>
  v == null ? "—" : (v * 100).toFixed(1);

export const fmtPct0 = (v: number | null | undefined): string =>
  v == null ? "—" : (v * 100).toFixed(0);

export const fmtUsd = (v: number | null | undefined): string =>
  v == null ? "—" : "$" + Math.round(v).toLocaleString();

export const fmtUsd2 = (v: number | null | undefined): string =>
  v == null ? "—" : "$" + v.toFixed(2);

/**
 * Four decimals, for the Cost Stack's price ladder.
 *
 * NOT a cosmetic preference. The ladder's rows are meant to be read as a
 * running total, and the Design Authority renders every one of them at
 * `money(v, 4)`. At two decimals a $0.0035 surgical lift displays as `+$0.00`
 * and the visible column stops adding up — while the reconciliation strip,
 * reading the underlying values, still says it does. A correct assertion
 * sitting under numbers that appear to contradict it is worse than either
 * alone.
 */
export const fmtUsd4 = (v: number | null | undefined): string =>
  v == null ? "—" : "$" + v.toFixed(4);

export const fmtQty = (v: number | null | undefined): string =>
  v == null ? "—" : v.toLocaleString();
