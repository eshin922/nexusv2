/**
 * The NetSuite-representable rate, DERIVED FROM the accepted amount.
 *
 * ── WHY THE RATE IS DERIVED AND NOT STORED-AND-READ ──────────────────────
 *
 * NetSuite is sent `quantity` and `rate`; it computes the amount itself. So
 * the rate is not an independent commercial fact — it is a REPRESENTATION of
 * the frozen amount, chosen so the provider's own multiplication reproduces
 * that amount exactly.
 *
 * Treating it as an independent fact is what broke. The projection computes
 * `lineAmount = rate × qty` at full precision; the freeze then rounded the
 * two INDEPENDENTLY — rate to 4dp, amount to 2dp from the unrounded product.
 * The stored pair could therefore disagree by up to `5×10⁻⁵ × quantity`:
 *
 *     ABH tier 1   5,000 × 6.7696 = 33,848.00   frozen 33,848.09   -$0.09
 *     ABH tier 2  10,000 × 3.0503 = 30,503.00   frozen 30,503.04   -$0.04
 *     ABH tier 3  20,000 × 1.5712 = 31,424.00   frozen 31,424.86   -$0.86
 *
 * REG-4 refused those sends. It was right to: posting them would have put the
 * order out of step with the total the customer accepted.
 *
 * ── THE INVARIANT ────────────────────────────────────────────────────────
 *
 *     ROUND_HALF_UP(quantity × postedRate, 2) === frozenLineAmount
 *
 * EXACT integer cents. No tolerance — a near-miss is a refusal, because a
 * tolerance would be a decision to post a different number than the accepted
 * one, and that decision is not ours to make.
 *
 * The rounding is the PROVIDER's, measured rather than assumed — see
 * `netsuite/posted-amount.ts`. This is not a tolerance: the comparison is
 * still exact integer cents. What changed is WHICH quantity is compared, from
 * the raw product to the product NetSuite will actually store.
 *
 * CORRECTED 2026-09-01. This header already stated the rule correctly; the
 * implementation below required something stricter — a residue of exactly
 * zero at scale 8 — and refused lines the provider would have posted at the
 * accepted amount. DPS-1073 at 2,100 units was refused for a residue of
 * 0.00001, and a real 15,000-unit draft with it. The sandbox settled it: the
 * supplied amount is ignored and the computed one is rounded half-up to
 * cents, so 2100 × 6.00633810 = 12613.31001000 stores as 12613.31.
 *
 * The frozen amount is never adjusted to fit. It is the accepted commercial
 * authority; if it cannot be represented, the send stops.
 *
 * ── WHY SCALE 8 ──────────────────────────────────────────────────────────
 *
 * Guaranteed exactness needs `d > 2 + log10(quantity)`: 6 digits at 5,000, 7
 * at 10,000–50,000, 8 at 100,000. Scale 8 covers the quantity range Nexus
 * quotes and leaves headroom.
 *
 * Proven against the provider rather than assumed. A sandbox Sales Order
 * posted 1.00000001 and 1.00000002 at quantity 1,000,000 — differing only in
 * the 8th decimal, worth exactly one cent there — and NetSuite returned both
 * rates intact with amounts one cent apart. A 6dp control and a 4dp negative
 * control (which reproduced the $0.04 shortfall) ran on the same order.
 *
 * `exactness` is still CHECKED rather than assumed from that proof: scale is a
 * coverage question, and the check is what turns insufficient coverage into a
 * refusal instead of a wrong number.
 */

import {
  POSTED_RATE_SCALE,
  postedAmountCents,
  centsToDecimal,
} from "@/lib/netsuite/posted-amount";

/**
 * Re-exported for the consumers that have always read it from here. The
 * constant itself now lives with the provider contract in `posted-amount.ts`;
 * defining it here and importing that module created a circular import.
 */
export { POSTED_RATE_SCALE };

const RATE_UNIT = 10n ** BigInt(POSTED_RATE_SCALE); // 1e8
const CENT_UNIT = 100n;
const RATE_PER_CENT = RATE_UNIT / CENT_UNIT; // 1e6

export type DerivedRate =
  | { ok: true; rate: string }
  | { ok: false; reason: string };

/** Integer cents from a frozen decimal string, exactly. No float. */
function centsOf(amount: string): bigint | null {
  const t = amount.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const neg = t.startsWith("-");
  const [whole, frac = ""] = (neg ? t.slice(1) : t).split(".");
  // More than 2 decimals in a frozen AMOUNT would mean the column changed
  // shape; refuse rather than silently truncate someone's money.
  if (frac.length > 2) return null;
  const v = BigInt(whole || "0") * CENT_UNIT + BigInt((frac + "00").slice(0, 2) || "0");
  return neg ? -v : v;
}

/** Round-half-away-from-zero, in exact integer arithmetic. */
function divRound(num: bigint, den: bigint): bigint {
  const neg = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (a * 2n + b) / (b * 2n);
  return neg ? -q : q;
}

/** The exact product, scaled by 1e8. Kept for the refusal message. */
function product(scaled: bigint, q: bigint): bigint {
  return scaled * q;
}

/** Render a rate scaled by 1e8 as a fixed-scale decimal string. */
function renderRate(scaled: bigint): string {
  const neg = scaled < 0n;
  const a = neg ? -scaled : scaled;
  const whole = a / RATE_UNIT;
  const frac = (a % RATE_UNIT).toString().padStart(POSTED_RATE_SCALE, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/**
 * `round(amount / quantity, 8)`, and a proof that posting it reproduces the
 * amount. Never returns a rate it could not verify.
 */
export function derivePostedRate(amount: string, quantity: number): DerivedRate {
  const cents = centsOf(amount);
  if (cents === null) {
    return { ok: false, reason: `amount "${amount}" is not a frozen decimal amount` };
  }
  if (!Number.isInteger(quantity) || quantity === 0) {
    return {
      ok: false,
      reason: `quantity ${String(quantity)} cannot carry a per-unit rate`,
    };
  }
  const q = BigInt(quantity);

  // rate×1e8 = (cents/100)/qty × 1e8 = cents × 1e6 / qty
  const scaled = divRound(cents * RATE_PER_CENT, q);

  // The check, not an assumption: does the provider's own arithmetic land on
  // the accepted cents? `postedAmountCents` IS that arithmetic, measured
  // against the sandbox — quantity × rate, rounded half-up to cents.
  //
  // Not "with nothing left over". That was the previous rule and it was
  // stricter than the provider: a residue NetSuite rounds away is not a
  // discrepancy, and refusing it made ordinary quantities unpublishable.
  const posted = postedAmountCents(scaled, q);
  if (posted !== cents) {
    // Rendered at the FULL posted scale, deliberately.
    //
    // A shorter rendering rounds the shortfall away and prints a number that
    // reads as equal to the accepted amount — "3 × 0.00333333 gives 0.0100,
    // not the accepted 0.01", which is nonsense to whoever has to act on it.
    // A message about a sub-cent discrepancy has to be able to show one.
    //
    // Both figures are now shown: the exact product AND the cents NetSuite
    // would store, because the second is what actually disagrees.
    return {
      ok: false,
      reason:
        `${quantity} × ${renderRate(scaled)} gives ${renderRate(product(scaled, q))}, ` +
        `which NetSuite would post as ${centsToDecimal(posted)} — not the ` +
        `accepted ${amount}.`,
    };
  }
  return { ok: true, rate: renderRate(scaled) };
}
