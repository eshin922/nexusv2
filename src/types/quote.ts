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
  /** Firm-level identity. Lives in firm_settings since RI.7; falls back
   * to VENDOR_FIXTURE constant when those columns are NULL. */
  name: string;
  sub: string;
  address: string;
  // Contact (name/email/phone) is per-deal data — see CustomerViewPreparedBy
  // below.
};

/**
 * Slice RI.7 — per-deal "Prepared by" contact for the customer-facing PDF.
 * Derives from the HubSpot deal owner (`projects.salesRepUserId → users`,
 * with HubSpot one-shot fallback for un-signed-in-reps). Snapshot at
 * sendQuote (DEC-8); customer view of an already-sent quote always
 * renders the snapshot. Drafts render live resolution as preview.
 *
 * `phone` is nullable — HubSpot Owners API has no phone (verified
 * against `@hubspot/api-client` PublicOwner schema), so phone is
 * exclusively admin-managed manual entry on `users.phone`. When NULL,
 * PdfHeader OMITS the phone line entirely (graceful degradation;
 * email is the canonical CDM contact).
 */
export type CustomerViewPreparedBy = {
  name: string;
  email: string;
  phone: string | null;
};

export type CustomerViewCustomer = {
  name: string;
  contact: string | null;
  role: string | null;
  address: string | null;
};

export type CustomerViewQuote = {
  /**
   * Customer-facing friendly id (`DPS-1042`). Assigned at sendQuote
   * from `quote_number_seq` with `firm_settings.quote_number_prefix`.
   * Null for drafts — PdfHeader renders `.pdf-stub` placeholder.
   * NEVER renders versionNumber or scenarioLabel.
   */
  quoteNumber: string | null;
  /** ISO date the version was sent. Null = preview not yet sent. */
  sentDate: string | null;
  /** ISO date; sendQuote computes `sent_at + days_valid_default` days. */
  validUntil: string | null;
  /**
   * Drafts: live read from `firm_settings.payment_terms_default`.
   * Sent+: read from `quote.payment_terms_snapshot` (frozen at send).
   * Null in either case → PdfTerms renders `.pdf-stub` placeholder.
   */
  paymentTerms: string | null;
  leadTime: string | null;
  customerFacingNotes: string | null;
  incoterms: string | null;
  /**
   * Multi-paragraph T&Cs legal text. Same live/snapshot split as
   * `paymentTerms`. Null pending Edward's canonical text → PdfTerms
   * renders `.pdf-stub` placeholder (hold gate before RI.7 PR-to-main).
   */
  tcs: string | null;
};

export type CustomerViewSku = {
  /** Customer-visible friendly label (e.g. "GLW-30"). */
  label: string;
  /** Product family name (e.g. "Hydra-Glow Serum"). */
  name: string;
  /** Pack-format string (e.g. "30 ml glass dropper"). NULL when the
   * field isn't populated yet (Slice 11 schema add); PdfPricingTable
   * suppresses the caption entirely rather than rendering a synthetic
   * placeholder string (Pattern 45 — customer-facing render data-
   * source verification). */
  pack: string | null;
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
  /**
   * Per-deal sales-rep contact (RI.7). Null when neither
   * `projects.sales_rep_user_id` nor `projects.hubspot_owner_id`
   * resolves (rare — every imported deal carries hubspot_owner_id).
   * PdfHeader renders `.pdf-stub` placeholder when null.
   */
  preparedBy: CustomerViewPreparedBy | null;
  tiers: ReadonlyArray<CustomerViewTier>;
  skus: ReadonlyArray<CustomerViewSku>;
  serviceFees: ReadonlyArray<CustomerViewServiceFee>;
  freightLines: ReadonlyArray<CustomerViewFreightLine>;
  /** Index into `tiers` of the recommended tier (visual ★). */
  recommendedTierIdx: number | null;
  pdfLayout: CustomerViewPdfLayout;
};
