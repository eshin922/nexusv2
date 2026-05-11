// Slice RI.6 — Customer-view fixture text for not-yet-schema fields.
//
// Per Q1+Q2 of the RI.6 PM-call resolution: fields that don't yet exist
// on `quotes` (quote_number, payment_terms, lead_time, incoterms) and
// the firm-level vendor block render against placeholder text that
// reads as OBVIOUSLY placeholder. Slice 11 fills the quote-level
// fields; RI.7 firm_settings extension fills the vendor block.
//
// Stub-text discipline (Edward's Q1 follow-up): placeholder values
// must be visibly synthetic — "{quote-number-pending}",
// "{prepared-by-pending · derives from deal owner in RI.7}" — not
// fake-real ("Maya Okafor · maya@halcyongoods.co · +1 562 555 0184").
// Otherwise smoke misses that the surface isn't plumbed and we carry
// the lie into Slice 11 review.
//
// VENDOR_FIXTURE carries FIRM-LEVEL identity only (name, tagline,
// address — single-tenant v1 scope, promotes to firm_settings in RI.7).
// PREPARED BY contact (name/email/phone) is per-deal data and derives
// from the HubSpot deal owner — see UX_BACKLOG "PreparedBy contact
// derivation (RI.7)". Until that lands, PdfHeader renders
// QUOTE_STUBS.preparedBy as the visible-synthetic stub.

import type {
  CustomerViewVendor,
  CustomerViewQuote,
} from "@/types/customer-view";

// TODO(RI.7): move to firm_settings table once admin UI extension lands;
// keep this fallback constant in place for graceful degradation when
// firm_settings vendor identity columns are NULL.
export const VENDOR_FIXTURE: CustomerViewVendor = {
  name: "The DPS",
  sub: "Turnkey product development & manufacturing for beauty, health & wellness brands",
  address: "3943 Irvine Blvd, #1129 Irvine, CA 92602",
};

/**
 * Stub strings for fields not yet plumbed. Render against the
 * `.pdf-stub` dashed-underline visual marker so PM smoke catches
 * un-plumbed surfaces. Resolutions:
 *   - quoteNumber / paymentTerms / leadTime / incoterms → Slice 11
 *     (real columns on `quotes`)
 *   - preparedBy → RI.7 (deal-owner derivation + firm_settings vendor
 *     extension; see UX_BACKLOG "PreparedBy contact derivation")
 */
export const QUOTE_STUBS = {
  quoteNumber: "{quote-number-pending}",
  paymentTerms: "{payment-terms-pending · stub copy until Slice 11}",
  leadTime: "{lead-time-pending · stub copy until Slice 11}",
  incoterms: "{incoterms-pending · stub copy until Slice 11}",
  preparedBy: "{prepared-by-pending · derives from deal owner in RI.7}",
} as const;

/**
 * Compose a CustomerViewQuote from a quote row + stubs. customerFacingNotes
 * + sentAt + validUntil are real columns; the rest are placeholder strings.
 */
export function buildQuoteFixture(args: {
  customerFacingNotes: string | null;
  sentAt: Date | null;
  validUntil: string | null;
}): CustomerViewQuote {
  return {
    quoteNumber: QUOTE_STUBS.quoteNumber,
    sentDate: args.sentAt ? args.sentAt.toISOString().slice(0, 10) : null,
    validUntil: args.validUntil,
    paymentTerms: QUOTE_STUBS.paymentTerms,
    leadTime: QUOTE_STUBS.leadTime,
    customerFacingNotes: args.customerFacingNotes,
    incoterms: QUOTE_STUBS.incoterms,
  };
}
