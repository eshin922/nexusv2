/**
 * Sandbox write-probe helper — a diagnostic Sales Order that does not lie.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * SO2731 was created by a diagnostic that called `createRecord` directly to
 * answer a question about line amounts. It was a correct probe and it produced
 * a MISLEADING artifact: NetSuite defaults this customer's lines to CA_CA at
 * 6%, so the order came back carrying $1,873.60 of tax under the certification
 * customer. Anyone reading it — including the person who did — has to weigh
 * whether Nexus had violated its own non-taxable rule.
 *
 * It had not. `tax-policy.ts` is the governing rule ("every Sales Order Nexus
 * creates is NON-TAXABLE"), `markComplete` patches every line to `-8` after
 * NetSuite builds the order, and it fails closed if a taxable line remains.
 * Measured across 21 Nexus-created orders, exactly one ever carried tax:
 * SO2716, the 2026-08-19 incident that caused the policy.
 *
 * The defect was in the INSTRUMENT. A diagnostic that writes to the same
 * account as the certification fixture must not manufacture a state that reads
 * as a product defect.
 *
 * ── WHAT THIS DOES, AND DELIBERATELY DOES NOT ────────────────────────────
 *
 * It stamps `taxCode: { id: "-8" }` on every probe line, which is the same
 * code `markComplete` enforces and for the same reason. That is all.
 *
 * It does NOT route probes through `markComplete`. Diagnostics must stay
 * independent of the lifecycle they are used to investigate — a probe that ran
 * the governed push could not be used to ask questions ABOUT the governed push,
 * and would tell you only that the system agrees with itself. The rule is:
 * keep diagnostics independent, and do not let them fabricate a taxable order
 * while doing it.
 *
 * Use `markComplete` when the full lifecycle is itself the subject. Use this
 * when it is not.
 */

import { createRecord } from "@/lib/netsuite/client";
import { NON_TAXABLE_TAX_CODE_ID } from "@/lib/netsuite/tax-policy";

export type ProbeLine = {
  /** NetSuite item internal id. */
  itemId: string;
  quantity: number;
  rate: number;
  /**
   * An explicit amount, for probes asking whether the provider honours one.
   * It is ignored by NetSuite — that is itself a measured fact (SO2731) — but
   * the field stays available so the question can still be asked.
   */
  amount?: number;
};

/**
 * Create a disposable sandbox Sales Order whose lines are governed
 * non-taxable, so the artifact cannot be mistaken for a policy violation.
 *
 * `memo` should say what the probe is for and that it is disposable; it is the
 * only thing telling a future reader why the order exists.
 */
export async function createProbeSalesOrder(args: {
  customerId: string;
  memo: string;
  lines: ProbeLine[];
}): Promise<{ internalId: string }> {
  return createRecord({
    recordType: "salesOrder",
    body: {
      entity: { id: args.customerId },
      memo: args.memo,
      item: {
        items: args.lines.map((l) => ({
          item: { id: l.itemId },
          quantity: l.quantity,
          rate: l.rate,
          ...(l.amount === undefined ? {} : { amount: l.amount }),
          // The governed code, from the governing module rather than repeated
          // as a literal here. If the policy ever changes its code, probes
          // follow it instead of drifting.
          taxCode: { id: NON_TAXABLE_TAX_CODE_ID },
        })),
      },
    },
  });
}
