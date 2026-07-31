import type { QuoteStatus } from "@/db/schema";

export const QUOTE_STATUS_PRESENTATION = {
  draft: { label: "DRAFT", editable: true, active: true },
  sent: { label: "SENT", editable: false, active: true },
  accepted: { label: "ACCEPTED", editable: false, active: false },
  superseded: { label: "SUPERSEDED", editable: false, active: false },
  lost: { label: "LOST", editable: false, active: false },
  complete: { label: "COMPLETE · LOCKED", editable: false, active: false },
} as const satisfies Record<
  QuoteStatus,
  { label: string; editable: boolean; active: boolean }
>;

export function quoteStatusPresentation(status: QuoteStatus) {
  return QUOTE_STATUS_PRESENTATION[status];
}

export function isKnownQuoteStatus(status: string): status is QuoteStatus {
  return Object.prototype.hasOwnProperty.call(QUOTE_STATUS_PRESENTATION, status);
}

export function organizerStatusPresentation(status: string) {
  if (!isKnownQuoteStatus(status)) {
    return { label: "UNKNOWN", editable: false, active: false } as const;
  }
  return quoteStatusPresentation(status);
}
