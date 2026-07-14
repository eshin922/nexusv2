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
  quote_number: string;
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
  incoterms_bundled: string;
  incoterms_passthrough: string;
  customer_facing_notes: string | null;
};

export type CpdfTier = {
  id: string;
  /** Short form ("T1"). */
  label: string;
  /** Long form ("Tier 1"). Derived at adapter per brief §3.B. */
  full: string;
  quantity: number;
  recommended?: boolean;
};

export type CpdfSku = {
  id: string;
  code: string;
  name: string;
  pack: string | null;
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
  amount: number;
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
  recommendedTierIdx: number;
  skus: ReadonlyArray<CpdfSku>;
  serviceFees: ReadonlyArray<CpdfServiceFee>;
  freightLines: ReadonlyArray<CpdfFreightLine>;
};
