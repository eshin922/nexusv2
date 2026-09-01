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
  /**
   * Customer contact email. Nullable — no source exists in v1
   * (not on `projects`, not on `hubspot_deals_cache`; siblings
   * `contact` / `role` / `address` are also nullable for the same
   * reason). Rendered JSX null-guards uniformly. Slice 11 Step 4
   * adapter disposition Q-A: option (b) column+backfill on
   * `projects` banked for future — v1 keeps the field surface
   * available so adapter output shape is stable.
   */
  email: string | null;
  address: string | null;
};

export type CustomerViewQuote = {
  /**
   * Customer-facing friendly id (`DPS-1042`). Governed by the publication
   * claim in `sendQuote`, from `quote_number_seq` with
   * `firm_settings.quote_number_prefix`, BEFORE the artifact is rendered --
   * so the document carries the number that is persisted beside it.
   *
   * Null for drafts, and the document renders that absence by OMITTING the
   * line. This previously said `PdfHeader renders a .pdf-stub placeholder`,
   * which was not true of the react-pdf tree: no `PdfHeader` participates in
   * it and no stub is rendered there. `.pdf-stub` belongs to the earlier DOM
   * lineage in `quote-fixtures.ts`. Omission is this tree's own grammar for
   * absence -- what the sibling project-title line does, and what
   * `CustomerViewLive` does on the HTML twin.
   *
   * NEVER renders versionNumber or scenarioLabel.
   */
  quoteNumber: string | null;
  /**
   * What the quote is *for* — projected from `projects.deal_name`
   * (the HubSpot deal title, e.g. "Lumen & Co. — Q3 skincare
   * relaunch"). Customer-safe (customers already know the deal
   * name from HubSpot correspondence). Pattern 45 clean —
   * carries no cost / margin / supplier data.
   *
   * Nullable for defensive rendering, though `projects.deal_name`
   * is NOT NULL in schema (always populated at deal import).
   *
   * Live projection is fine for v1 (project name stable); snapshot
   * lift banked to post-v1 if title-drift-after-send matters.
   */
  projectTitle: string | null;
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
  /** C.1 — how much authority the rendered term carries.
   *  `frozen` = the promise made at Send (sent quotes).
   *  `governed` = the customer's NetSuite Terms record (drafts).
   *  `provisional` = firm-wide default; NOT authority for a commitment, and
   *  `sendQuote` refuses to freeze it. */
  paymentTermsSource?: "frozen" | "governed" | "provisional";
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
  /**
   * How many of this component one finished unit consumes, when that is more
   * than one. NULL when there is no multiplicity to explain — a Direct Product,
   * or a member at 1.
   *
   * Presentation-only. It explains a quantity the customer can already see; it
   * never participates in the arithmetic that produced it.
   */
  multiplicityPerUnit: number | null;
  /**
   * Per-tier unit prices in tier-sort order.
   * NULL element = "quote on request" (NOT $0.00, NOT em-dash).
   */
  tierPrices: ReadonlyArray<number | null>;
  /**
   * The extended amount per tier, consumed from the governed projection —
   * `CommercialLine.cells[i].lineAmount`, which is the line's own quantity
   * (`tierQty × qtyPerParent`) times its rate.
   *
   * This previously read "`tierPrices[i] × tiers[i].quantity`", and the code
   * matched it. That is the TIER's quantity, correct only while every member
   * carries multiplicity 1, and it under-billed the first member that did not.
   * NULL where the unit price is null, and never 0: an unpriced line is not a
   * free one.
   */
  tierLineTotals: ReadonlyArray<number | null>;
  /** "step↓" | "flat" | "partial" | other shape descriptor. Drives flat-row treatment. */
  shape: "step↓" | "flat" | "partial" | string;
};

/**
 * The customer-facing monetary facts for one tier.
 *
 * ── WHY THESE LIVE ON THE PROJECTION ────────────────────────────────────
 *
 * They used to be computed in the PDF renderer, at render time
 * (`customer-pdf-helpers.ts`). That made the renderer an authority over
 * customer economics, and it has already cost a customer-facing defect: the
 * T-1 repair found the displayed per-unit divided by a ROW CARDINALITY,
 * printing $4.00 where $12.00 was owed, correct only at one priced row.
 *
 * The litmus for what belongs here: if the PDF disappeared tomorrow, would the
 * fact still need to exist? A tier's total, its displayed unit price, its
 * one-time-fee total and whether it is fully priced all answer yes. Pagination
 * and column widths answer no, and stay in the renderer.
 *
 * ── THIS IS COMPOSITION, NOT PRICING ────────────────────────────────────
 *
 * Every value here is a sum or a quotient of figures the projection ALREADY
 * carries. No rate is looked up, no markup is decided, no recovery treatment is
 * resolved — all of that happened upstream, in governed code, and arrives here
 * already settled. Adding any of it to this layer would make a second costing
 * engine out of a projection.
 */
export type CustomerViewTierMoney = {
  /** Σ (unit price × tier quantity) across priced SKUs. Products only. */
  goodsTotal: number;
  /** Σ one-time fees billed AT THIS TIER. A fee null at a tier is not billed there. */
  feesTotal: number;
  /** `goodsTotal + feesTotal` — the all-in figure, fees folded. */
  turnkeyTotal: number;
  /**
   * The two displayed unit prices: goods-only, and all-in.
   *
   * NULL when nothing is priced at this tier. Not zero — the document says
   * "total on request" there, and a governed $0.00 is a price the firm has not
   * quoted (OD-005).
   */
  perUnitGoods: number | null;
  perUnitTurnkey: number | null;
  /** Any SKU unpriced at this tier. Drives "total on request". */
  hasUnpricedLine: boolean;
  /**
   * How much in-unit-price recovery is ALREADY INSIDE `goodsTotal`.
   *
   * ── A DISCLOSURE, NOT AN ADDEND ────────────────────────────────────────
   *
   * This is not added to anything. The recovery is already in the unit prices,
   * so the document says so - "Unit-price subtotal ... includes recovery $X" -
   * rather than presenting a pre-recovery subtotal plus a recovery line. There
   * is no governed pre-recovery subtotal to present, and inventing one would
   * put a figure on a customer document that nothing computes.
   *
   * ── NULL IS AN ANSWER ──────────────────────────────────────────────────
   *
   * NULL when a final sell override replaces the ladder result for any cell in
   * the tier. An override discards the rungs beneath it, so there is no fact
   * about how much of the operator's price "is" recovery. The document shows an
   * em dash and says why. A number there would reconcile only because it had
   * been chosen to.
   *
   * Also NULL when a recovery amount itself is ungoverned (BV-013).
   */
  embeddedRecovery: number | null;
};

export type CustomerViewTier = {
  id: string;
  /** "Tier 1" — never the internal label. */
  label: string;
  quantity: number;
  /** Composed once, upstream of every renderer. See `CustomerViewTierMoney`. */
  money: CustomerViewTierMoney;
};

export type CustomerViewServiceFee = {
  id: string;
  /**
   * The charge this fee bills, when it is a component-owned one — OD-032.
   *
   * Carried as IDENTITY so nothing downstream reconstructs it from `id`, the
   * label, or a position in the array. `id` is a display key and has been two
   * different shapes already; this is the same value the elections and the
   * frozen instructions use.
   *
   * Null for legacy column-shaped fees, which have no instance.
   */
  chargeInstanceId?: string | null;
  scope: "project" | "sku";
  /** Required when scope === "sku". */
  skuLabel?: string;
  label: string;
  sub: string;
  /**
   * Per tier, aligned to `CustomerView.tiers`. NULL = not billed at this tier
   * (allocated into unit price, or no fee entered).
   *
   * Was a single `amount`, which made "the fee is the same at every tier" a
   * property of the TYPE rather than of the data. A fee entered against one
   * tier was then billed at all of them. Same per-tier shape as
   * `CustomerViewFreightLine.tierAmounts`.
   */
  tierAmounts: ReadonlyArray<number | null>;
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

/**
 * Detail-level axis (Addendum 1 — Slice 11 Step 4). Mirrors
 * `pdfLayout` in draft-live vs sent-snapshot round-trip semantics:
 * draft reads a searchParam override + firm/quote default; sent
 * reads the snapshot column added in migration 0022.
 *
 * `itemized` renders SKU rows in the pricing table.
 * `turnkey_only` collapses to a single all-in figure per tier
 * (compositional refactor Step 4.5).
 */
export type CustomerViewDetailLevel = "itemized" | "turnkey_only";

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
  /**
   * Which tier's amounts the one-time fee section quotes.
   *
   * The fee matrix has one column per tier and the document prints one of
   * them. Which one is a customer-facing presentation fact, so it is decided
   * ONCE here rather than by each renderer.
   *
   * It was not, and the parity pass caught it: the PDF used
   * `recommendedTierIdx ?? 0` while the live renderer used the first shown
   * tier, so the two quoted different columns and a fee line appeared in one
   * document and not the other. Two renderers making the same decision
   * separately is the defect, not the disagreement it produced.
   *
   * The recommended tier when there is one; otherwise the first tier that
   * exists — which is a basis, not a recommendation, and the document says so.
   */
  feeBasisTierIdx: number;
  /**
   * Whether the tier total is the ALL-IN figure with one-time fees folded in.
   *
   * True when the quote carries separately-stated charges: the fee lines are
   * itemised AND included in the tier total, so "Turnkey total · all-in for
   * this tier's order" means what it says.
   *
   * A presentation fact about the document, decided once. The second parity
   * defect of this exact shape: the PDF folded whenever charges existed while
   * the live renderer folded only in the turnkey-only layout, so the two
   * printed tier totals differing by the whole fee amount -- $23,247.60
   * against $16,807.60 on the same tier of the same quote.
   *
   * Every presentation decision left to the renderers is a parity defect
   * waiting to happen. They belong here.
   */
  foldFeesIntoTotal: boolean;
  /**
   * Governed landed logistics for the recommended tier, from
   * `landed-logistics.ts` — the SAME rollup Pricing renders, selected and
   * named rather than recomputed.
   *
   * Two consumers: the operator's final-validation panel, and one sentence in
   * the customer document's pricing lede. Both read this so they cannot
   * disagree about whether freight is inside the price.
   *
   * Optional because callers that predate it — and fixtures — legitimately do
   * not carry it; absent means the document says nothing, which is the right
   * default for an ungoverned claim.
   */
  landedLogistics?: {
    freight: number;
    dutyAndTariff: number;
    total: number;
    included: boolean;
  };
  pdfLayout: CustomerViewPdfLayout;
  detailLevel: CustomerViewDetailLevel;
  /**
   * Toggle for the spec addendum pages (Step 3b port). Draft
   * reads searchParam ?? firm default (Edward Option A —
   * "include specs all the time when requested"); sent reads
   * the snapshot column. Adapter output; render decides whether
   * the addendum block ships based on this + impl-6's
   * `hasMeaningfulContent` guard.
   */
  includeSpecAddendum: boolean;
  /**
   * Whether one-time charges are ENUMERATED line by line.
   *
   * ── DISCLOSURE, NEVER ECONOMICS ────────────────────────────────────────
   *
   * `false` collapses the itemization and never removes the charge: the total
   * is still stated, still inside the turnkey figure, and still disclosed in
   * words. "Hide the fee lines" and "omit the fees" are one edit apart, and the
   * second is a customer-facing misstatement — a quote that charges for
   * something it does not mention.
   *
   * Every renderer honouring this must keep saying what the money IS.
   * Falsified in the tests: for either value the printed total is identical and
   * the fee total is still disclosed on the document.
   */
  includeFeeLines: boolean;
  /** Whether the commercial terms block prints. */
  includeTerms: boolean;
  /** Whether the customer note prints. Its TEXT is `quote.customerFacingNotes`. */
  includeNote: boolean;
};
