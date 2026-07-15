// Slice 11 Step 6 FU — timezone-safe date derivation.
//
// Nexus is single-tenant (The DPS, based in California). All
// customer-facing dates render in PDT/PST — NOT UTC.
//
// The bug this fixes: `date.toISOString().slice(0, 10)` returns the
// UTC calendar date. When a PM sends a quote late-evening PDT
// (e.g., 9:44 PM on 2026-07-14 PDT = 2026-07-15 04:44 UTC),
// `.toISOString().slice(0, 10)` returns "2026-07-15" — a day
// ahead of what the PM intended. The customer-facing PDF then
// shows the wrong Issued date + wrong Valid-until date.
//
// Fix: explicit timezone conversion via Intl.DateTimeFormat
// with `en-CA` locale, which produces YYYY-MM-DD format
// natively. Server-side (Vercel Node runtime) has full Intl
// support.
//
// Post-v1 direction: if Nexus expands beyond single-tenant, the
// tz could come from `firm_settings.timezone`. For now, hardcode
// California per the operating context.

const NEXUS_TIMEZONE = "America/Los_Angeles";

/**
 * Format a Date as an ISO date string (YYYY-MM-DD) in the Nexus
 * operational timezone (PST/PDT).
 *
 * Prefer this over `date.toISOString().slice(0, 10)` for any
 * customer-visible date derivation.
 */
export function toLocalIsoDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NEXUS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Add N days to an ISO date string (YYYY-MM-DD). Returns
 * YYYY-MM-DD.
 *
 * Used by sendQuote to compute valid_until = sent date + N days,
 * where N is `firm_settings.days_valid_default`. Timezone-safe
 * because it operates on the ISO date parts directly (no UTC
 * conversion via Date arithmetic).
 */
export function addDaysToIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Construct in local timezone at noon to avoid DST edge cases at
  // midnight boundaries, then extract the ISO date via
  // toLocalIsoDate to guarantee tz consistency.
  const dt = new Date(y, m - 1, d + days, 12, 0, 0, 0);
  return toLocalIsoDate(dt);
}
