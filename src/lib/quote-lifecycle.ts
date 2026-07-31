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

export type OrganizerQuoteCandidate = {
  id: string;
  scenarioLabel: string;
  versionNumber: number;
  status: QuoteStatus;
  createdAt: Date;
};

/**
 * Mirrors the organizer query's chronology contract for tests and non-SQL
 * consumers. Version is meaningful only inside a scenario. Across scenario
 * representatives, immutable creation time is authoritative; version breaks
 * equal creation timestamps. An exact unresolved tie is rejected rather than
 * silently introducing status, array, or identifier precedence.
 */
export function selectLatestOrganizerQuote<T extends OrganizerQuoteCandidate>(
  candidates: readonly T[],
): T | null {
  const latestByScenario = new Map<string, T>();
  for (const candidate of candidates) {
    const current = latestByScenario.get(candidate.scenarioLabel);
    if (
      !current ||
      candidate.versionNumber > current.versionNumber ||
      (candidate.versionNumber === current.versionNumber &&
        candidate.createdAt.getTime() > current.createdAt.getTime())
    ) {
      latestByScenario.set(candidate.scenarioLabel, candidate);
    }
  }

  const representatives = [...latestByScenario.values()].sort((a, b) => {
    const createdDelta = b.createdAt.getTime() - a.createdAt.getTime();
    if (createdDelta !== 0) return createdDelta;
    return b.versionNumber - a.versionNumber;
  });
  const first = representatives[0] ?? null;
  const second = representatives[1];
  if (
    first &&
    second &&
    first.createdAt.getTime() === second.createdAt.getTime() &&
    first.versionNumber === second.versionNumber
  ) {
    throw new Error(
      "Organizer quote chronology is ambiguous: scenario representatives share creation time and version.",
    );
  }
  return first;
}
