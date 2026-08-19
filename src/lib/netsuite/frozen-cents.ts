/**
 * Exact integer cents from a frozen `numeric(14,2)` string.
 *
 * A leaf module on purpose: no database, no imports at all. It lives apart from
 * `projection-readiness` so a unit test can exercise the arithmetic without
 * dragging in `@/db` — and because a pure numeric helper has no business in a
 * module that queries.
 *
 * ── WHY NOT Number(s) * 100 ──────────────────────────────────────────────
 *
 * That routes an exact decimal through binary floating point and back:
 *
 *     Number("1234.56") * 100  ===  123455.99999999999
 *
 * REG-4 compares emitted Sales Order amounts to frozen ones EXACTLY. A float
 * round-trip makes that comparison need a tolerance, and a tolerance is where a
 * real discrepancy hides — the whole point of integer cents is that there is
 * nothing to tolerate.
 */
export function centsFromFrozen(value: string | null): number {
  if (value === null) return 0;
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const negative = trimmed.startsWith("-");
  const [whole, frac = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  // `numeric(14,2)` never carries more than two decimals, but truncating
  // rather than rounding a third is deliberate: rounding here would invent a
  // cent the frozen record does not contain.
  const cents =
    BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2) || "0");
  return Number(negative ? -cents : cents);
}
