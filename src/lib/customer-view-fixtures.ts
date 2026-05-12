// Slice RI.6 — Customer-view fixture text. Slice RI.7 promoted vendor
// identity + customer-facing commercial defaults to `firm_settings`
// table columns + per-quote snapshot columns at sendQuote. The
// customer-view page resolves the right value per quote status:
//   - drafts: live read from firm_settings.*_default
//   - sent+:  read from quote.*_snapshot (frozen at send)
//
// When the resolved value is NULL (firm setting not configured, or
// pre-snapshot draft for status-only fields like quote_number),
// PdfHeader / PdfTerms render `.pdf-stub` placeholders from
// `QUOTE_STUBS` below. The stub text is visible-synthetic so PM
// smoke catches unplumbed surfaces (RI.6 Q1 discipline).
//
// `VENDOR_FIXTURE` remains as graceful-degradation fallback for the
// firm-level identity block when firm_settings.vendor_* columns are
// NULL (shouldn't happen in production after the RI.7 migration
// seed, but keeps the customer view from rendering empty vendor on
// a misconfigured admin state).

import type { CustomerViewVendor } from "@/types/customer-view";

// Graceful-degradation fallback for firm-level identity. Used by the
// customer-view page when `firm_settings.vendor_*` columns are NULL.
// Post-migration the active firm_settings row carries these values
// (seeded by migration 0020); the constant is the safety net.
export const VENDOR_FIXTURE: CustomerViewVendor = {
  name: "The DPS",
  sub: "Turnkey product development & manufacturing for beauty, health & wellness brands",
  address: "3943 Irvine Blvd, #1129 Irvine, CA 92602",
};

/**
 * Visible-synthetic placeholder strings rendered with `.pdf-stub`
 * dashed-underline styling. PdfHeader / PdfTerms / PdfFooter look up
 * these when the resolved field is NULL.
 *
 * `quoteNumber` stub: pre-send drafts (number assigns at sendQuote).
 * `paymentTerms` / `leadTime` / `incoterms` / `tcs` stubs: firm
 * setting not configured, or sent quote snapshotted while a default
 * was unset.
 * `preparedBy` stub: rare — neither `projects.sales_rep_user_id`
 * nor a HubSpot owner resolution succeeded.
 */
export const QUOTE_STUBS = {
  quoteNumber: "{quote-number-pending}",
  paymentTerms: "{payment-terms-pending}",
  leadTime: "{lead-time-pending}",
  incoterms: "{incoterms-pending}",
  tcs: "{tcs-pending — configure on /admin/firm-settings}",
  preparedBy: "{prepared-by-pending — deal owner unresolved}",
} as const;
