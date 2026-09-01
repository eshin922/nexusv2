// Slice 11 Step 4.5 — CustomerView → CpdfData translator.
//
// The customer-PDF render tree (`src/components/pdf/customer-pdf-*`)
// was ported Pattern-30-verbatim against CD's fixture shape
// (snake_case, single-string incoterms, `contact_*` on vendor).
// Production emits `CustomerView` (camelCase, per-deal preparedBy,
// tier + SKU projections from the costing bundle).
//
// This translator is the boundary: takes a `CustomerView` and
// produces a `CpdfData` the render tree consumes, plus the two
// composition flags per CA Step 4 disposition (hasCharges +
// hasUnpriced — modified Option 1 orthogonal flags).
//
// Pattern 45 boundary safe: consumes and returns pure types
// (`CustomerView` + `CpdfData`); no costing-surface imports, no
// DB reads, no HubSpot calls. Pure function of the adapter output.
//
// **Compute rules (from CA disposition):**
//
//   hasCharges = view.serviceFees.length > 0
//                || view.freightLines.length > 0
//
//   Note: `CustomerViewFreightLine` type doc says "per-tier
//   PASS-THROUGH unit cost" — the projection only surfaces
//   pass-through legs, so `freightLines.length > 0` IS the
//   "any pass-through freight legs" check. No raw freight-leg
//   inspection needed here.
//
//   hasUnpriced = view.skus.some(s => s.tierPrices.some(p => p === null))
//
// **Vendor.contact_* projection:**
//
// Per brief §5 / DEC-8: the parties "Prepared by" contact
// resolves per-deal (draft = live, sent+ = snapshot). The adapter
// already computes `view.preparedBy`; this translator maps it to
// the render tree's `vendor.contact_*` slots. Vendor identity
// (name/tagline/address) stays firm-level per brief §4.
//
// When preparedBy is null (rare — neither salesRepUserId nor
// hubspotOwnerId resolves), contact_* fall back to empty strings.
// The render tree's per-field null-guards already handle this
// gracefully.

import type {
  CpdfData,
  CpdfCustomer,
  CpdfFreightLine,
  CpdfQuote,
  CpdfServiceFee,
  CpdfSku,
  CpdfTier,
  CpdfVendor,
} from "@/components/pdf/customer-pdf-types";
import type { CustomerView } from "@/types/quote";

export type CpdfTranslationResult = {
  data: CpdfData;
  /** Which SKUs to render — filtered / ordered set (v1: all leaf SKUs). */
  skuSet: ReadonlyArray<CpdfSku>;
  /** Composition flag: charges block visible? */
  hasCharges: boolean;
  /** Composition flag: any SKU has null tier price? */
  hasUnpriced: boolean;
};

export function customerViewToCpdf(
  view: CustomerView,
  opts: {
    /** ISO date the render is happening. Used for `issued_date` when quote.sentDate is null (draft preview). */
    todayIso: string;
    /**
     * The governed quote number for THIS render, when publication has
     * established one.
     *
     * `view.quote.quoteNumber` cannot supply it at send time: the resolver
     * gates that field on `isSent`, and the artifact is deliberately rendered
     * while the quote is still a draft so that a rejected send leaves no
     * external file. The number is allocated by the publication claim before
     * the render, and threaded here so the document carries the number that
     * is about to be persisted beside it.
     *
     * Omitted for previews, which correctly show no number.
     */
    quoteNumber?: string | null;
  },
): CpdfTranslationResult {
  const vendor: CpdfVendor = {
    name: view.vendor.name,
    sub: view.vendor.sub,
    address: view.vendor.address,
    // DEC-8 preparedBy projection — Vendor identity is firm-level
    // (name/sub/address); contact is per-deal.
    contact_name: view.preparedBy?.name ?? "",
    contact_email: view.preparedBy?.email ?? "",
    contact_phone: view.preparedBy?.phone ?? null,
  };

  const customer: CpdfCustomer = {
    name: view.customer.name,
    contact: view.customer.contact,
    role: view.customer.role,
    email: view.customer.email,
    address: view.customer.address,
  };

  const quote: CpdfQuote = {
    // The publication's number when one governs this render, else whatever the
    // view resolved (a number for a re-render of a sent quote, null for a
    // draft). Never coerced: null means "not yet governed" and the document
    // says so by omission.
    quote_number: opts.quoteNumber ?? view.quote.quoteNumber ?? null,
    project_title: view.quote.projectTitle,
    // TODO(bounded-cleanup, Gate B cutover 2026-08-24): a draft has NOT been
    // issued, and this prints today's date as its issue date. Edward's
    // disposition during the Gate B production walk: the truthful V1 behaviour
    // is draft -> no issue date, sent/frozen -> the actual sentDate, unset
    // governed date -> an em dash. `CustomerViewLive` already does that; this
    // is the legacy inconsistency, recorded rather than rewritten because the
    // artifact of record is not this slice's to change and the cutover was not
    // to be held for it.
    //
    // The repair is to drop the `?? opts.todayIso` fallback and let the PDF's
    // masthead omit the line the way the live renderer does — which also
    // removes `todayIso` from the adapter's options if nothing else wants it.
    issued_date: view.quote.sentDate ?? opts.todayIso,
    valid_until: view.quote.validUntil ?? "",
    payment_terms: view.quote.paymentTerms ?? "",
    lead_time: view.quote.leadTime ?? "",
    incoterms: view.quote.incoterms ?? "",
    customer_facing_notes: view.quote.customerFacingNotes,
    // Carried, not defaulted.
    //
    // This line is the repair: the projection has always resolved T&Cs from
    // Admin Settings (draft) or the quote's snapshot (sent), and this adapter
    // silently dropped them, so the customer's artifact of record has never
    // printed a clause the firm configured.
    //
    // NULL passes through as null rather than "" — the renderer must be able
    // to tell "no T&Cs configured" from "empty T&Cs", and an empty string
    // would render an empty Terms heading over nothing.
    tcs: view.quote.tcs,
    // Carried, not re-derived. The preview and the artifact must make the same
    // presentation decisions from the same record.
    include_fee_lines: view.includeFeeLines,
    include_terms: view.includeTerms,
    include_note: view.includeNote,
  };

  const tiers: CpdfTier[] = view.tiers.map((t, idx) => ({
    id: t.id,
    label: t.label,
    // Q-B: derive `full` at adapter — "Tier N".
    full: `Tier ${idx + 1}`,
    quantity: t.quantity,
    // Q-C: normalize `recommendedTierIdx` → per-tier boolean.
    recommended: view.recommendedTierIdx === idx,
    // Carried, not recomputed. The adapter's job is layout shaping.
    money: t.money,
  }));

  const skus: CpdfSku[] = view.skus.map((s) => ({
    id: s.label,
    code: s.label,
    name: s.name,
    pack: s.pack,
    multiplicity_per_unit: s.multiplicityPerUnit,
    tier_prices: s.tierPrices,
    tier_line_totals: s.tierLineTotals,
    shape: s.shape,
  }));

  const serviceFees: CpdfServiceFee[] = view.serviceFees.map((f) => ({
    id: f.id,
    scope: f.scope,
    sku_id: f.skuLabel,
    label: f.label,
    sub: f.sub,
    tier_amounts: f.tierAmounts,
    qty_label: f.qtyLabel,
  }));

  const freightLines: CpdfFreightLine[] = view.freightLines.map((f) => ({
    id: f.id,
    label: f.label,
    sub: f.sub,
    qty_label: f.qtyLabel,
    tier_amounts: f.tierAmounts,
  }));

  const data: CpdfData = {
    vendor,
    customer,
    quote,
    tiers,
    // NULL PASSES THROUGH. This coerced to 0 — Tier 1 — on the reasoning that
    // the ★ is gated by the per-tier boolean above, so a bad index was
    // harmless. It was not: the charges block reads this index to choose which
    // tier's freight to quote per unit, AND names that tier in a sentence to
    // the customer. So a quote with no recommendation printed freight "for
    // Tier 1" on the strength of a fallback, and the second fabrication of the
    // same value sat one layer under the first.
    recommendedTierIdx: view.recommendedTierIdx,
    // Governed flag only — the AMOUNTS stay out of the customer document
    // deliberately. The customer is told that freight is included, not how
    // much of their price it is; that figure is operator-internal and lives on
    // the validation panel.
    freightIncludedInUnitPrice: view.landedLogistics?.included === true,
    // Carried, not re-derived. Both renderers quote the same column.
    feeBasisTierIdx: view.feeBasisTierIdx,
    skus,
    serviceFees,
    freightLines,
  };

  // Compose flags per CA disposition (modified Option 1 —
  // orthogonal, not mutually exclusive).
  // Read from the projection, not re-derived. One rule, one place.
  const hasCharges = view.foldFeesIntoTotal;
  const hasUnpriced = view.skus.some((s) =>
    s.tierPrices.some((p) => p === null),
  );

  // Default skuSet: all SKUs the view carries (leaf-filtered
  // upstream at page.tsx). Future refinements (e.g., filter to
  // "in scope for this render" per single_tier collapse) live
  // here.
  const skuSet = skus;

  return { data, skuSet, hasCharges, hasUnpriced };
}
