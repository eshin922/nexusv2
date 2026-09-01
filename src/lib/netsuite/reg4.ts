import { POSTED_RATE_SCALE } from "@/lib/commercial-rate";
import { centsFromFrozen } from "@/lib/netsuite/frozen-cents";
import { postedAmountCents, centsToDecimal } from "@/lib/netsuite/posted-amount";

/**
 * REG-4 — the emitted Sales Order sums exactly to the frozen accepted total.
 *
 * Two links, both in integer cents, both reading frozen amounts only:
 *
 *   A   Σ frozen priced line amounts (accepted tier)  ==  tier_commercial_total
 *   B   Σ emitted SO line amounts                     ==  that same frozen sum
 *
 * Link A is already guaranteed twice over — a DB CHECK on the totals row, and
 * `verifyProjectionTotals` refusing the freeze at send. Checking it again here
 * is not redundant: those guarantee the record was CONSISTENT WHEN WRITTEN, and
 * this asserts it is still consistent at the moment an order is built from it.
 *
 * ── THE HAZARD LINK B ACTUALLY GUARDS ────────────────────────────────────
 *
 * `SalesOrderLine` sends `quantity` and `rate`. It does NOT send `amount` —
 * NetSuite computes that itself, as `ROUND_HALF_UP(quantity × rate, 2)`.
 *
 * The rounding half of that sentence was missing until 2026-09-01, and its
 * absence is what made this gate stricter than the thing it models. Sending an
 * `amount` would not help either: the sandbox showed a supplied amount is
 * IGNORED. See `posted-amount.ts` for the measurement.
 *
 * So "never recompute rate × qty" cannot be enforced by refusing to do the
 * multiplication: NetSuite does it regardless, on the other side of the wire.
 * What CAN be enforced is that its result reproduces the frozen amount exactly,
 * checked before the POST, with a refusal when it does not.
 *
 * A quantity-1 line is safe by construction — rate equals amount. A product
 * line is not: `rate × qty` can land on a fraction of a cent that NetSuite then
 * rounds, and the order would be off by pennies against a total we had already
 * frozen and shown the customer. That is not hypothetical — at scale 4 it cost
 * the ABH quote $0.04 at 10,000 units and $0.86 at 20,000, and this check is
 * what refused those sends.
 *
 * The rate is now DERIVED from the frozen amount at `POSTED_RATE_SCALE` (see
 * commercial-rate.ts), so the multiplication reproduces the accepted cents by
 * construction. This check is still not redundant: it verifies the
 * construction held, on the numbers actually about to be transmitted, rather
 * than trusting that it did.
 *
 * Both gates now call the SAME `postedAmountCents`. They must: if the freeze
 * and this check implement the provider rule separately they can drift apart,
 * and the failure mode is the worst available — a line admitted at freeze and
 * refused at push, leaving a quote un-sendable after it was frozen and shown.
 */

export type Reg4Line = {
  sourceLineId: string;
  description: string;
  quantity: number;
  /** Per-unit rate as the posted decimal string, e.g. "3.05030400". */
  rate: string;
  /** The frozen line amount as a decimal string, e.g. "10875.00". */
  amount: string;
};

export type Reg4Failure =
  | {
      kind: "link_a_mismatch";
      frozenLineSumCents: number;
      tierCommercialTotalCents: number;
      detail: string;
    }
  | {
      kind: "link_b_mismatch";
      emittedSumCents: number;
      frozenSumCents: number;
      detail: string;
    }
  | {
      kind: "rate_times_quantity_inexact";
      sourceLineId: string;
      description: string;
      detail: string;
    };

const RATE_UNIT = 10n ** BigInt(POSTED_RATE_SCALE);
const RATE_PER_CENT = RATE_UNIT / 100n;

/**
 * What NetSuite will store for this line, in cents.
 *
 * BigInt throughout. The rate's decimals are held as an integer scaled by
 * 10^POSTED_RATE_SCALE, multiplied by the integer quantity, then reduced to
 * cents by the PROVIDER's own rule — half-up — rather than by this module's
 * opinion of what a sub-cent remainder ought to mean.
 *
 * `exact` no longer means "no remainder". It means the rate could be READ at
 * the posted scale at all; a rate finer than the scale is still refused,
 * because reshaping a caller's input and then testifying about the reshaped
 * value is what a checker must never do.
 *
 * The scale is READ FROM the posted-rate module rather than repeated here. It
 * was previously hardcoded to 4, which silently TRUNCATED anything finer: given
 * an 8dp rate it would have discarded four digits and then reported the
 * resulting disagreement as the provider's fault. A checker that quietly
 * reshapes its input cannot testify about it.
 */
export function exactRateTimesQuantity(
  rate: string,
  quantity: number,
): { cents: number; exact: boolean } {
  const trimmed = rate.trim();
  const negative = trimmed.startsWith("-");
  const [whole, frac = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  // Refuse rather than truncate: a rate finer than the posted scale is not
  // something this function may quietly round on the provider's behalf.
  if (frac.length > POSTED_RATE_SCALE) return { cents: 0, exact: false };
  const padded = (frac + "0".repeat(POSTED_RATE_SCALE)).slice(0, POSTED_RATE_SCALE);
  const scaled = BigInt(whole || "0") * RATE_UNIT + BigInt(padded || "0");
  const product = scaled * BigInt(Math.trunc(quantity)); // scaled by 10^SCALE
  const signed = postedAmountCents(negative ? -scaled : scaled, BigInt(Math.trunc(quantity)));
  return { cents: Number(signed), exact: true };
}

/** Link A. Empty result means it holds. */
export function checkLinkA(
  frozenLines: ReadonlyArray<Reg4Line>,
  tierCommercialTotal: string,
): Reg4Failure[] {
  const sum = frozenLines.reduce((a, l) => a + centsFromFrozen(l.amount), 0);
  const total = centsFromFrozen(tierCommercialTotal);
  if (sum === total) return [];
  return [
    {
      kind: "link_a_mismatch",
      frozenLineSumCents: sum,
      tierCommercialTotalCents: total,
      detail: `The frozen lines for the accepted tier sum to ${fmt(sum)} but the frozen tier total is ${fmt(total)}. The record disagrees with itself; nothing was posted.`,
    },
  ];
}

/**
 * Link B, plus the per-line exactness NetSuite's own arithmetic requires.
 *
 * `emittedSumCents` is the sum of the frozen amounts we intend. The per-line
 * check asks a different question: whether `quantity × rate` — what NetSuite
 * will actually compute — lands on that same amount.
 */
export function checkLinkB(
  emitted: ReadonlyArray<Reg4Line>,
  frozenSumCents: number,
): Reg4Failure[] {
  const failures: Reg4Failure[] = [];

  for (const line of emitted) {
    const amountCents = centsFromFrozen(line.amount);
    const product = exactRateTimesQuantity(line.rate, line.quantity);
    if (!product.exact || product.cents !== amountCents) {
      failures.push({
        kind: "rate_times_quantity_inexact",
        sourceLineId: line.sourceLineId,
        description: line.description,
        detail:
          `"${line.description}": NetSuite computes amount as quantity × rate ` +
          `rounded to cents, and ${line.quantity} × ${line.rate} would post as ${
            product.exact
              ? centsToDecimal(BigInt(product.cents))
              : "an unreadable rate"
          }, not the frozen ${fmt(amountCents)}. Posting it would put the order ` +
          `out of step with the total the customer was quoted.`,
      });
    }
  }

  const emittedSum = emitted.reduce((a, l) => a + centsFromFrozen(l.amount), 0);
  if (emittedSum !== frozenSumCents) {
    failures.push({
      kind: "link_b_mismatch",
      emittedSumCents: emittedSum,
      frozenSumCents,
      detail: `The emitted Sales Order lines sum to ${fmt(emittedSum)} but the frozen accepted total is ${fmt(frozenSumCents)}. Difference ${fmt(emittedSum - frozenSumCents)}; nothing was posted.`,
    });
  }
  return failures;
}

function fmt(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
