import { centsFromFrozen } from "@/lib/netsuite/frozen-cents";

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
 * NetSuite computes that itself, as `quantity × rate`.
 *
 * So "never recompute rate × qty" cannot be enforced by refusing to do the
 * multiplication: NetSuite does it regardless, on the other side of the wire.
 * What CAN be enforced is that its result reproduces the frozen amount exactly,
 * checked before the POST, with a refusal when it does not.
 *
 * A quantity-1 line is safe by construction — rate equals amount. A product
 * line is not: `rate` is `numeric(14,4)`, so `rate × qty` can land on a
 * fraction of a cent that NetSuite then rounds, and the order would be off by
 * pennies against a total we had already frozen and shown the customer.
 */

export type Reg4Line = {
  sourceLineId: string;
  description: string;
  quantity: number;
  /** Per-unit rate as the frozen decimal string, e.g. "2.1750". */
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

/**
 * `quantity × rate` in exact decimal arithmetic, returned in cents.
 *
 * BigInt throughout. The rate's four decimals are held as an integer scaled by
 * 10^4, multiplied by the integer quantity, then reduced to cents — so nothing
 * passes through a float, and a result that is NOT a whole number of cents is
 * reported rather than rounded away.
 */
export function exactRateTimesQuantity(
  rate: string,
  quantity: number,
): { cents: number; exact: boolean } {
  const trimmed = rate.trim();
  const negative = trimmed.startsWith("-");
  const [whole, frac = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  const scaled = BigInt(whole || "0") * 10_000n + BigInt((frac + "0000").slice(0, 4) || "0");
  const product = scaled * BigInt(Math.trunc(quantity)); // scaled by 10^4
  // 10^4 → 10^2. A remainder means the product is not a whole number of cents.
  const cents = product / 100n;
  const remainder = product % 100n;
  const signed = negative ? -cents : cents;
  return { cents: Number(signed), exact: remainder === 0n };
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
          `"${line.description}": NetSuite computes amount as quantity × rate, ` +
          `and ${line.quantity} × ${line.rate} gives ${
            product.exact ? fmt(product.cents) : "a fraction of a cent"
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
