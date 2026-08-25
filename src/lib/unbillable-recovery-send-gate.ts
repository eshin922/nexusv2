import { db } from "@/db";
import { ActionGuardError, ERR } from "@/lib/action-result";
import { getCostingBundle } from "@/app/actions/costing";
import {
  describeUnbillablePlacements,
  findUnbillablePlacements,
} from "@/lib/commercial-recovery/unbillable-placements";

/**
 * Refuses a send that would bill the customer less than the quote's own revenue.
 *
 * A Direct Service's recovery placed on a separate line is counted by the engine
 * and billed by nothing (see `unbillable-placements`). Electing that is now
 * refused, but quotes carrying the state from before the refusal still exist,
 * and their margin math is reading revenue the customer will never be invoiced.
 *
 * Placed beside `requireBelowFloorAuthorizedToSend` for the same reason that
 * gate sits where it does: a refusal must leave no PDF, no snapshot, no pin, no
 * audit and no status change.
 *
 * It REFUSES; it does not repair. Correcting one of these changes what a real
 * customer owes, and that is an operator's decision, not a deployment's.
 */
export async function requireNoUnbillableRecoveryToSend(input: {
  quoteId: string;
}): Promise<void> {
  const bundle = await getCostingBundle(input.quoteId);
  if (!bundle.ok) return; // the costs gate ahead of this one owns that refusal

  const costing = bundle.data.costing;
  const tierLabels = new Map(costing.quoteRollup.map((r) => [r.tierId, r.label] as const));
  const rows = findUnbillablePlacements({
    skuRollups: costing.skuRollups as never,
    tierLabels,
  });
  if (rows.length === 0) return;

  throw new ActionGuardError(
    ERR.VALIDATION,
    "This quote bills the customer less than its own revenue:\n" +
      describeUnbillablePlacements(rows).join("\n"),
  );
}
