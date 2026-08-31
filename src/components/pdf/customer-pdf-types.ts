// Slice 11 Step 3 — Pattern-30 verbatim port: prop type definitions.
//
// These types mirror CD's `data.js` fixture shape verbatim so the
// component tree's prop reads match CD's source 1:1. The adapter
// (Step 4) projects production `CustomerView` onto these types —
// adapter contract decisions live in the Step 4 PR, not here.
//
// Pattern 30 discipline: these types describe what CD's JSX READS.
// They don't aspire to be the production source-of-truth shape —
// `@/types/quote` carries that. The adapter bridges the two.
//
// Pattern 45 boundary: zero costing imports, zero schema imports.
// Pure prop type definitions.
//
// Naming convention: snake_case mirroring CD's `data.js` field
// names (e.g. `tier_prices`, `contact_name`). NOT camelCase. This
// is the load-bearing fidelity — the JSX reads `sku.tier_prices[ti]`
// verbatim per CD `pdf-render.jsx:125`. Adapter handles snake↔camel.

import type { CustomerViewTierMoney } from "@/types/quote";

export type CpdfVendor = {
  name: string;
  sub: string;
  address: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
};

export type CpdfCustomer = {
  name: string;
  contact: string | null;
  role: string | null;
  email: string | null;
  address: string | null;
};

export type CpdfQuote = {
  /**
   * NULL until publication governs one. Not `""`.
   *
   * This was `string`, which is a claim the document could not honour: a
   * draft has no number, so absence was coerced to an empty string at the
   * adapter and the masthead rendered a blank where a number belongs. The
   * type asserted a fact rather than describing one, and the render was
   * silent about it -- the same shape as a cast that stops the compiler
   * asking.
   *
   * Every consumer now decides explicitly what absence looks like, using the
   * grammar already in this tree: the line is omitted rather than emptied.
   */
  quote_number: string | null;
  /**
   * What the quote is *for* — projected from `projects.deal_name`
   * (adapter, Step 4). Renders under `quote_number` in the masthead.
   * Nullable for defensive rendering. NOT in CD's canonical fixture
   * — Nexus extension per Pattern 39 (customer needed to see what
   * the quote is *for*, absent from CD's masthead grammar).
   */
  project_title: string | null;
  issued_date: string;
  valid_until: string;
  payment_terms: string;
  lead_time: string;
  /**
   * Single incoterms string. Production has one column
   * (`firm_settings.incoterms_default` / `quotes.incoterms_snapshot`).
   * Step 4.5 collapse: fixture-only `incoterms_bundled` /
   * `incoterms_passthrough` split retired — the three State
   * compositions that consumed the split are unified into one
   * flag-composed `CustomerPdfDocument` (Step 4.5c) that reads
   * this single field regardless of hasCharges branch.
   */
  incoterms: string;
  customer_facing_notes: string | null;
  /**
   * Customer Terms & Conditions.
   *
   * Content authority is Admin Settings (`firm_settings.tcs_default`) on a
   * draft, and the quote's own `tcs_snapshot` once sent — so a later change to
   * the firm default cannot restate a quote the customer already has.
   *
   * NULL means genuinely unconfigured, and renders as nothing. It does not mean
   * "not shown": whether the block appears is a presentation choice and lives
   * elsewhere. Content authority and presentation choice are different
   * questions, and conflating them is how a configured clause goes missing.
   */
  tcs: string | null;
  /**
   * Presentation decisions, carried so the ARTIFACT honours them too.
   *
   * A control that changes the preview and not the PDF is worse than no
   * control: the operator sees the document they asked for and the customer
   * receives a different one.
   *
   * `include_fee_lines = false` collapses the ITEMIZATION only. The total is
   * still stated and still disclosed in words — the charge never disappears.
   */
  include_fee_lines: boolean;
  include_terms: boolean;
  include_note: boolean;
};

export type CpdfTier = {
  id: string;
  /** Short form ("T1"). */
  label: string;
  /** Long form ("Tier 1"). Derived at adapter per brief §3.B. */
  full: string;
  quantity: number;
  recommended?: boolean;
  /**
   * The tier's monetary facts, composed upstream on `CustomerView` and carried
   * here unchanged. The adapter reshapes for layout; it does not compute
   * economics, and this type exists so that stays visible.
   */
  money: CustomerViewTierMoney;
};

export type CpdfSku = {
  /** Extended amounts per tier, composed on `CustomerView`. */
  tier_line_totals?: ReadonlyArray<number | null>;
  id: string;
  code: string;
  name: string;
  pack: string | null;
  /**
   * Components consumed per finished unit, when greater than one. NULL when
   * there is nothing to explain. Rendered as a caption qualifier; never used
   * in arithmetic.
   */
  multiplicity_per_unit?: number | null;
  /** Per-tier unit prices in tier-sort order.
   * NULL element = "quote on request" (NOT $0.00). */
  tier_prices: ReadonlyArray<number | null>;
  /** "step" | "flat" | "partial" — drives render treatment.
   * Per audit §3: shape is treatment-flag, NOT a forbidden field. */
  shape: "step" | "flat" | "partial" | string;
};

export type CpdfServiceFee = {
  id: string;
  scope: "project" | "sku";
  sku_id?: string;
  label: string;
  sub: string;
  /** Per tier, aligned to `tiers`. NULL = not separately billed at this tier. */
  tier_amounts: ReadonlyArray<number | null>;
  qty_label: string;
};

export type CpdfFreightLine = {
  id: string;
  label: string;
  sub: string;
  qty_label: string;
  /** Per-tier landed unit cost in tier-sort order. */
  tier_amounts: ReadonlyArray<number>;
};

/** Layout axis — "tier_table" shows all tiers as columns;
 * "single_tier" collapses to recommended tier only. */
export type CpdfPdfLayout = "tier_table" | "single_tier";

/** Detail axis (Addendum 1) — "itemized" renders SKU rows;
 * "turnkey_only" drops them for an all-in figure. */
export type CpdfDetailLevel = "itemized" | "turnkey_only";

/** Aggregate data shape — mirrors CD's `NXCPDF` window export. */
export type CpdfData = {
  vendor: CpdfVendor;
  customer: CpdfCustomer;
  quote: CpdfQuote;
  tiers: ReadonlyArray<CpdfTier>;
  /**
   * Index of the recommended tier, or NULL when the firm has recommended none.
   *
   * Was non-null with a middle-tier fallback upstream, which meant the document
   * could not represent "no recommendation" and therefore always made one.
   */
  recommendedTierIdx: number | null;
  /** Which tier's amounts the fee section quotes. Composed on CustomerView. */
  feeBasisTierIdx?: number;
  skus: ReadonlyArray<CpdfSku>;
  serviceFees: ReadonlyArray<CpdfServiceFee>;
  freightLines: ReadonlyArray<CpdfFreightLine>;
};
