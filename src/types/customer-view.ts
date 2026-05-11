// Slice RI.6 — Customer-view schema slice.
//
// This module defines the customer-VISIBLE shape passed into the
// `<PdfPage>` subtree (src/components/pdf/). Fields explicitly
// EXCLUDED — and the boundary-guard verifier rejects any pdf/* file
// that imports them — include: version_number, scenario_label,
// target_margin_pct, markup_pct, duty_pct, tariff_pct, cbm_per_unit,
// supplier names, audit_log fields, internal_notes,
// global_price_adj_pct, sell_price_override, blended_margin_pct.
//
// See CLAUDE.md "Customer-view boundary guard" + Designer memory
// reference_ri6_boundary_guard.md.

export type CustomerViewVendor = {
  /** Firm-level identity. RI.7 promotes these three fields to firm_settings. */
  name: string;
  sub: string;
  address: string;
  // Contact (name/email/phone) intentionally omitted at the firm level —
  // it's per-deal data derived from the HubSpot deal owner. PdfHeader
  // renders QUOTE_STUBS.preparedBy as a visible-synthetic stub until
  // RI.7 wires `projects.salesRepUserId → users` + the new `users.phone`
  // column. See UX_BACKLOG "PreparedBy contact derivation (RI.7)".
};

export type CustomerViewCustomer = {
  name: string;
  contact: string | null;
  role: string | null;
  address: string | null;
};

export type CustomerViewQuote = {
  /** Customer-facing friendly id (HG-2418). NEVER renders versionNumber or scenarioLabel. */
  quoteNumber: string;
  /** ISO date the version was sent. Null = preview not yet sent. */
  sentDate: string | null;
  /** Computed from sentDate + 30d (or stored). */
  validUntil: string | null;
  paymentTerms: string;
  leadTime: string;
  customerFacingNotes: string | null;
  incoterms: string;
};

export type CustomerViewSku = {
  /** Customer-visible friendly label (e.g. "GLW-30"). */
  label: string;
  /** Product family name (e.g. "Hydra-Glow Serum"). */
  name: string;
  /** Pack-format string (e.g. "30 ml glass dropper"). */
  pack: string;
  unitsPerPack: number;
  /** Optional MSRP context. NULL hides retail column for this row. */
  retailBenchmark: number | null;
  /**
   * Per-tier unit prices in tier-sort order.
   * NULL element = "quote on request" (NOT $0.00, NOT em-dash).
   */
  tierPrices: ReadonlyArray<number | null>;
  /** "step↓" | "flat" | "partial" | other shape descriptor. Drives flat-row treatment. */
  shape: "step↓" | "flat" | "partial" | string;
};

export type CustomerViewTier = {
  id: string;
  /** "Tier 1" — never the internal label. */
  label: string;
  quantity: number;
};

export type CustomerViewServiceFee = {
  id: string;
  scope: "project" | "sku";
  /** Required when scope === "sku". */
  skuLabel?: string;
  label: string;
  sub: string;
  amount: number;
  qtyLabel: string;
};

export type CustomerViewFreightLine = {
  id: string;
  label: string;
  sub: string;
  qtyLabel: string;
  /** Per-tier pass-through unit cost in tier-sort order. */
  tierAmounts: ReadonlyArray<number>;
};

export type CustomerViewPdfLayout = "tier_table" | "single_tier";

export type CustomerView = {
  vendor: CustomerViewVendor;
  customer: CustomerViewCustomer;
  quote: CustomerViewQuote;
  tiers: ReadonlyArray<CustomerViewTier>;
  skus: ReadonlyArray<CustomerViewSku>;
  serviceFees: ReadonlyArray<CustomerViewServiceFee>;
  freightLines: ReadonlyArray<CustomerViewFreightLine>;
  /** Index into `tiers` of the recommended tier (visual ★). */
  recommendedTierIdx: number | null;
  pdfLayout: CustomerViewPdfLayout;
};
