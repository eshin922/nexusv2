/**
 * How a date is written on the customer document.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────
 *
 * `CustomerView` carries dates as ISO strings — `2026-09-20`. That is the
 * right shape for a projection: unambiguous, sortable, locale-free. It is not
 * what either document shows the customer.
 *
 * The PDF ran them through a `longDate` helper of its own and printed
 * "September 20, 2026". The live renderer printed the ISO string. Both were
 * internally consistent, neither was wrong on its own terms, and together they
 * made the same quote read as two different documents in three places — the
 * masthead's issue date, the masthead's validity date, and the Valid until
 * cell in the commercial terms grid.
 *
 * Found on a sent production quote, by reading the rendered text back rather
 * than by looking at it: at preview scale, "2026-09-20" and "September 20,
 * 2026" are both just a date in the right place.
 *
 * This is the same fix as `customer-money.ts` — the formatting is composed
 * ONCE and both renderers read it, so the two documents cannot drift apart
 * again by each being reasonable separately. Presentation, not commerce: no
 * amount, rate or policy is decided here.
 */

/**
 * "September 20, 2026" — or an em dash where the projection has no date.
 *
 * The em dash is deliberate and matches the artifact of record. A date the
 * firm has not set must not be invented, and must not be silently blank
 * either: a blank Valid until cell reads as an oversight, an em dash reads as
 * "not set", which is what it is.
 */
export function longDate(s: string | null | undefined): string {
  if (s == null || s === "" || s === "Invalid Date") return "—";
  // Anchored to local midnight. Parsing a bare `YYYY-MM-DD` as UTC and then
  // formatting it locally moves the date back a day for anyone west of
  // Greenwich — which is everyone reading this one.
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
