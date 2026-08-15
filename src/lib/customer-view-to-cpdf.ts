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
    quote_number: view.quote.quoteNumber ?? "",
    project_title: view.quote.projectTitle,
    // Draft render uses today; sent renders the frozen date.
    issued_date: view.quote.sentDate ?? opts.todayIso,
    valid_until: view.quote.validUntil ?? "",
    payment_terms: view.quote.paymentTerms ?? "",
    lead_time: view.quote.leadTime ?? "",
    incoterms: view.quote.incoterms ?? "",
    customer_facing_notes: view.quote.customerFacingNotes,
  };

  const tiers: CpdfTier[] = view.tiers.map((t, idx) => ({
    id: t.id,
    label: t.label,
    // Q-B: derive `full` at adapter — "Tier N".
    full: `Tier ${idx + 1}`,
    quantity: t.quantity,
    // Q-C: normalize `recommendedTierIdx` → per-tier boolean.
    recommended: view.recommendedTierIdx === idx,
  }));

  const skus: CpdfSku[] = view.skus.map((s) => ({
    id: s.label,
    code: s.label,
    name: s.name,
    pack: s.pack,
    tier_prices: s.tierPrices,
    shape: s.shape,
  }));

  const serviceFees: CpdfServiceFee[] = view.serviceFees.map((f) => ({
    id: f.id,
    scope: f.scope,
    sku_id: f.skuLabel,
    label: f.label,
    sub: f.sub,
    amount: f.amount,
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
    skus,
    serviceFees,
    freightLines,
  };

  // Compose flags per CA disposition (modified Option 1 —
  // orthogonal, not mutually exclusive).
  const hasCharges =
    view.serviceFees.length > 0 || view.freightLines.length > 0;
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
