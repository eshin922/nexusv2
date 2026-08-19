import { centsFromFrozen } from "@/lib/netsuite/frozen-cents";
import { exactRateTimesQuantity } from "@/lib/netsuite/reg4";
import type { Reg4Failure } from "@/lib/netsuite/reg4";

/**
 * REG-4 over the order NetSuite will actually calculate.
 *
 * ── WHY THE PRE-GROUP CHECK IS NOT ENOUGH ────────────────────────────────
 *
 * A turnkey order does not post the flat line list. It posts Item Group HEADER
 * lines carrying a quantity and no rate; NetSuite expands each group into its
 * members, and the member rates arrive afterwards by PATCH. The amounts that
 * end up on the order are therefore
 *
 *     member amount = (group quantity × member qty-per-group) × patched rate
 *
 * computed by NetSuite, from an expansion we never send explicitly. Checking
 * the flat intermediate would verify a representation that is not what gets
 * posted — the exact "reconciles internally while being wrong" shape this
 * whole slice exists to remove.
 *
 * So the expansion is reproduced here, in integer cents, and compared line by
 * line against the frozen amounts. A mismatch refuses before the POST.
 */

export type PostGroupingMember = {
  /** The frozen line this member came from. */
  sourceLineId: string;
  description: string;
  netsuiteItemId: string;
  /** How many of this member ONE group contains. */
  qtyPerGroup: number;
  /** The rate that will be POSTed or PATCHed, as a decimal string. */
  rate: string;
  /** The frozen amount this member must reproduce. */
  frozenAmount: string;
};

export type PostGroupingGroup = {
  /** The group header quantity — how many groups the tier buys. */
  groupQuantity: number;
  members: PostGroupingMember[];
};

export type PostGroupingFlatLine = {
  sourceLineId: string;
  description: string;
  netsuiteItemId: string;
  quantity: number;
  rate: string;
  frozenAmount: string;
};

/**
 * Reconcile the post-expansion order against the frozen accepted column.
 *
 * `flatLines` covers Direct Products and every quantity-1 accounting line;
 * `groups` covers the members NetSuite will expand. Both are required — an
 * order checked on one half would balance against whichever half was checked.
 */
export function checkPostGroupingReg4(input: {
  groups: ReadonlyArray<PostGroupingGroup>;
  flatLines: ReadonlyArray<PostGroupingFlatLine>;
  frozenAcceptedTotal: string;
}): Reg4Failure[] {
  const failures: Reg4Failure[] = [];
  let orderTotalCents = 0;

  for (const group of input.groups) {
    for (const member of group.members) {
      // Exactly what NetSuite does: expand, then multiply by the patched rate.
      const expandedQty = group.groupQuantity * member.qtyPerGroup;
      const product = exactRateTimesQuantity(member.rate, expandedQty);
      const frozenCents = centsFromFrozen(member.frozenAmount);

      if (!product.exact || product.cents !== frozenCents) {
        failures.push({
          kind: "rate_times_quantity_inexact",
          sourceLineId: member.sourceLineId,
          description: member.description,
          detail:
            `"${member.description}" is an Item Group member. NetSuite will expand it to ` +
            `${group.groupQuantity} × ${member.qtyPerGroup} = ${expandedQty} units and compute ` +
            `${expandedQty} × ${member.rate}, giving ${
              product.exact ? fmt(product.cents) : "a fraction of a cent"
            } — not the frozen ${fmt(frozenCents)}. Posting it would put the order out of ` +
            `step with the total the customer accepted.`,
        });
        continue;
      }
      orderTotalCents += product.cents;
    }
  }

  for (const line of input.flatLines) {
    const product = exactRateTimesQuantity(line.rate, line.quantity);
    const frozenCents = centsFromFrozen(line.frozenAmount);
    if (!product.exact || product.cents !== frozenCents) {
      failures.push({
        kind: "rate_times_quantity_inexact",
        sourceLineId: line.sourceLineId,
        description: line.description,
        detail:
          `"${line.description}": NetSuite computes ${line.quantity} × ${line.rate}, giving ${
            product.exact ? fmt(product.cents) : "a fraction of a cent"
          }, not the frozen ${fmt(frozenCents)}.`,
      });
      continue;
    }
    orderTotalCents += product.cents;
  }

  const frozenTotalCents = centsFromFrozen(input.frozenAcceptedTotal);
  if (orderTotalCents !== frozenTotalCents) {
    failures.push({
      kind: "link_b_mismatch",
      emittedSumCents: orderTotalCents,
      frozenSumCents: frozenTotalCents,
      detail:
        `The Sales Order NetSuite will calculate totals ${fmt(orderTotalCents)}, but the frozen ` +
        `accepted commercial total is ${fmt(frozenTotalCents)}. Difference ` +
        `${fmt(orderTotalCents - frozenTotalCents)}; nothing was posted.`,
    });
  }

  return failures;
}

function fmt(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
