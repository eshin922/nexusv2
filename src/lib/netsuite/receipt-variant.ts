/**
 * Push status -> Sales Order receipt variant. PURE, and TOTAL.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
 *
 * The receipt chose its variant with a ternary chain ending in an open `else`:
 *
 *     isComplete    ? "record"
 *   : hasFailedPush ? "failed"
 *   :                 "pending"
 *
 * where `hasFailedPush` covered `failed` and `awaiting_rates`. Five push
 * states, three variants, and no branch for `needs_reconciliation` -- so it
 * fell through to `pending`, the one variant whose entire purpose is to invite
 * the operator to send.
 *
 * Two production quotes sat there: DPS-1055 and DPS-1062, each carrying a push
 * row that says an order MAY already exist for the deal, each rendering a
 * surface that offers to create another.
 *
 * It was never a missing `case`. It was an open `else`, which is why adding a
 * fifth state to the machine did not force anyone to handle it here.
 *
 * ── WHY THIS IS A SWITCH WITH NO DEFAULT ────────────────────────────────
 *
 * A `default` would restore the exact failure in a new shape. With the switch
 * exhaustive over `AttemptStatus` and the function's return type fixed, a sixth
 * state added to the machine fails to COMPILE here rather than rendering as
 * something plausible. That is the property being bought: presentation cannot
 * silently lag the state machine.
 *
 * The `never` binding makes it explicit rather than incidental -- if the switch
 * stops being exhaustive, the assignment is the error.
 */
import type { AttemptStatus } from "./attempt-lifecycle-rules";

/**
 * `reconcile` is new. The other three are the pre-existing variants and their
 * meanings are unchanged.
 */
export type ReceiptVariant = "pending" | "awaiting" | "reconcile" | "failed" | "record";

/**
 * Quote status is authoritative for the terminal case: a `complete` quote
 * shows the record regardless of what the last attempt row says, because the
 * order exists and the commercial commitment is made.
 *
 * `null` push status means no attempt has been made -- genuinely pending.
 */
export function receiptVariantFor(
  pushStatus: AttemptStatus | string | null | undefined,
  isComplete: boolean,
): ReceiptVariant {
  if (isComplete) return "record";
  if (pushStatus === null || pushStatus === undefined) return "pending";

  const status = pushStatus as AttemptStatus;
  switch (status) {
    case "pending":
      return "pending";
    case "awaiting_rates":
      // The order EXISTS. Distinct from `failed`, whose copy ("the order did
      // not reach NetSuite") is simply untrue here.
      return "awaiting";
    case "needs_reconciliation":
      return "reconcile";
    case "failed":
      return "failed";
    case "succeeded":
      // Succeeded on the attempt but the quote is not yet `complete`: the
      // freeze transaction has not committed. Showing the record would claim a
      // commercial commitment that does not exist yet, so this reads as still
      // in flight rather than done.
      return "awaiting";
    default: {
      // Not a fallback. This is unreachable while the switch is exhaustive,
      // and the assignment is what makes a new enum member a COMPILE error
      // instead of a silent `pending`.
      const unhandled: never = status;
      throw new Error(`[receipt-variant] unhandled push status: ${String(unhandled)}`);
    }
  }
}

/**
 * Whether the variant describes an order that EXISTS at the provider.
 *
 * Used to decide whether Send may be offered. `reconcile` is included
 * deliberately: an order may exist and could not be matched, and "may exist"
 * is exactly the condition under which a second CREATE must not be offered --
 * the same reasoning `mustNotCreate` applies on the write side.
 */
export function variantImpliesOrderMayExist(v: ReceiptVariant): boolean {
  return v === "awaiting" || v === "reconcile" || v === "record";
}
