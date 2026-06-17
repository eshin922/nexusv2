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

export const fmtQty = (v: number | null | undefined): string =>
  v == null ? "—" : v.toLocaleString();
