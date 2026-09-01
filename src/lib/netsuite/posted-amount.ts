/**
 * The provider's own arithmetic, measured — not assumed.
 *
 * ── WHAT NETSUITE ACTUALLY DOES ──────────────────────────────────────────
 *
 * Established 2026-09-01 against the sandbox, on two disposable Sales Orders,
 * read back three ways (REST record, SuiteQL over `transactionline`, and the
 * order total):
 *
 *     posted amount = ROUND_HALF_UP(quantity x rate, 2)
 *
 * with the supplied 8dp rate preserved intact, and a separately supplied
 * `amount` IGNORED.
 *
 * The ignoring was probed directly (SO2731 / internalId 363641): two lines with
 * identical quantity and rate, one carrying `amount: 12613.31` and one carrying
 * no amount at all, both stored 12613.31. So the amount NetSuite holds is the
 * one it computes, and nothing Nexus sends can override it.
 *
 * The ROUNDING was probed separately (internalId 363741), because a single
 * observation cannot tell rounding from truncation — the residue there was
 * 0.00001, which discards to the same cent either way:
 *
 *     1000 x 0.00000900 = 0.00900  ->  0.01     rounds  (truncation: 0.00)
 *     1000 x 0.00000400 = 0.00400  ->  0.00
 *     1000 x 0.00000500 = 0.00500  ->  0.01     ties go UP
 *     1000 x 0.00001500 = 0.01500  ->  0.02
 *     1000 x 0.00002500 = 0.02500  ->  0.03     half-UP, not half-even
 *
 * ── WHY THIS MODULE EXISTS RATHER THAN THE RULE BEING INLINED ────────────
 *
 * Two gates test this same provider contract — the freeze's representability
 * check (`commercial-rate.ts`) and REG-4 Link B (`reg4.ts`). If they implement
 * the rounding separately they can disagree, and the failure mode is the worst
 * available: the freeze admits a line that the push then refuses, so a quote
 * becomes un-sendable AFTER it has been frozen and shown. One rule, one
 * implementation, both callers.
 *
 * ── WHY THIS CORRECTED A REFUSAL ─────────────────────────────────────────
 *
 * The freeze previously required a residue of exactly zero at 8dp — that
 * `quantity x rate` reproduce the accepted cents with nothing left over. That
 * is STRICTER than the provider, and it refused ordinary work: DPS-1073 at
 * 2,100 units, and a real 15,000-unit draft, because
 * 2100 x 6.00633810 = 12613.31001000 has a residue of 0.00001 — which NetSuite
 * rounds away to exactly the accepted 12613.31.
 *
 * `commercial-rate.ts`'s own header had documented the correct invariant all
 * along ("round(quantity x postedRate, 2) === frozenLineAmount"); only the
 * implementation was tighter than its stated contract.
 *
 * ── WHAT IS STILL REFUSED, AND MUST BE ───────────────────────────────────
 *
 * A product that rounds to a DIFFERENT cent. That is the historical ABH
 * defect — rate at scale 4 against a 2dp amount, disagreeing by up to
 * `5e-5 x quantity`: $0.04 at 10,000 units, $0.86 at 20,000. Those are whole
 * cents apart and stay refused. The relaxation is from "no residue" to "no
 * residue that survives the provider's own rounding", which is a different
 * claim, not a weaker version of the same one.
 *
 * ── SIGN ─────────────────────────────────────────────────────────────────
 *
 * Ties round AWAY FROM ZERO, which is HALF_UP in the accounting sense and what
 * the probe measured on positive values. Negative line amounts were NOT
 * measured; away-from-zero is the conventional reading and is applied
 * symmetrically here. If negative amounts ever become reachable, measure them
 * before relying on this half of the rule.
 */

/**
 * Decimal places carried on a posted rate. Also `unit_rate`'s scale.
 *
 * Lives HERE, with the provider contract it belongs to, and is re-exported by
 * `commercial-rate.ts` for its existing consumers. It was briefly the other
 * way round and that was a circular import: `commercial-rate` imported this
 * module while this module read the constant back, so whichever loaded first
 * hit a temporal dead zone. The unit suite caught it on the first run.
 */
export const POSTED_RATE_SCALE = 8;

const RATE_UNIT = 10n ** BigInt(POSTED_RATE_SCALE); // 1e8
const RATE_PER_CENT = RATE_UNIT / 100n; // 1e6

/**
 * `ROUND_HALF_UP(quantity x rate, 2)` in exact integer arithmetic, returned as
 * integer cents.
 *
 * `rateScaled` is the rate multiplied by 10^POSTED_RATE_SCALE — an integer, so
 * nothing here passes through a float. That matters: the residues this rule
 * exists to adjudicate are at the eighth decimal, which is precisely where
 * binary floating point stops being able to represent the decision.
 */
export function postedAmountCents(rateScaled: bigint, quantity: bigint): bigint {
  const product = rateScaled * quantity; // scaled by 10^POSTED_RATE_SCALE
  const negative = product < 0n;
  const magnitude = negative ? -product : product;

  // Half-up on the magnitude: add half a cent's worth of scale before the
  // integer division, so a remainder of exactly half rounds away from zero.
  const cents = (magnitude * 2n + RATE_PER_CENT) / (RATE_PER_CENT * 2n);
  return negative ? -cents : cents;
}

/**
 * Does the provider's arithmetic land on the accepted amount?
 *
 * The whole representability question, in one place. `true` means NetSuite
 * will store exactly `acceptedCents` when sent this quantity and rate.
 */
export function reproducesAcceptedCents(
  rateScaled: bigint,
  quantity: bigint,
  acceptedCents: bigint,
): boolean {
  return postedAmountCents(rateScaled, quantity) === acceptedCents;
}

/** Render integer cents as a decimal string, for messages. */
export function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const a = negative ? -cents : cents;
  return `${negative ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
