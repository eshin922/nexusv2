/**
 * The organizer's time thresholds and ranking, in one place.
 *
 * ── WHY THESE ARE NOT LITERALS AT THE CALL SITE ──────────────────────────
 *
 * "48 hours" appearing in a loader query and again in a UI label is two
 * definitions of one policy, and they agree only until someone edits one. The
 * organizer states these numbers to operators in words ("silent for 3 days"),
 * so drift between the predicate and the sentence is a surface that lies about
 * its own rule.
 *
 * None of these is a governed business threshold the way the margin floor is —
 * they are queue-hygiene settings owned by this surface. That is exactly why
 * they need a named home: settings with no other authority are the ones that
 * get copied.
 */

export const TASK_POLICY = {
  /** A delivered approval request is worth chasing after this long. */
  approvalStaleAfterMs: 1 * 60 * 60 * 1000,
  /** A sent quote with no acceptance is "with the customer" until this long. */
  customerSilentAfterMs: 48 * 60 * 60 * 1000,
  /** A sent quote's validity is "expiring" inside this window. */
  quoteExpiringWithinMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * The complete V1 task vocabulary. EIGHT kinds, pinned.
 *
 * Pinned because the organizer's whole claim is that it surfaces governed state
 * and invents nothing: a ninth kind appearing without a governed predicate
 * behind it is the failure this list exists to make visible. A test asserts
 * this array and the rank map agree, so a kind cannot be added in one place and
 * forgotten in the other.
 *
 * ── WHAT V1 DELIBERATELY DOES NOT CARRY ──────────────────────────────────
 *
 * Every kind here reads state Nexus has ALREADY PERSISTED — a status, a
 * timestamp, an approval row. None requires computing commercial state.
 *
 * Four kinds were designed, proven against live data, and then REMOVED from V1
 * rather than approximated:
 *
 *   pricing_blocked            needs `evaluateProgression`
 *   costs_unresolved_quote     needs `loadUnresolvedQuoteCosts`
 *   costs_unresolved_freight   needs `loadUnresolvedQuoteCosts`
 *   (unresolved configuration) folded into the above
 *
 * Measured: computing them live for the 43 draft quotes across 21 real projects
 * costs 44.8s and ~344 queries against a `max: 3` pool — on a DEFAULT LANDING
 * ROUTE. Serving them from a persisted projection is the right answer and is
 * designed in `docs/organizer-read-model-proposal.md`, but that is a read model
 * with its own writer registry and refresh system, and it is not this slice.
 *
 * They are DEFERRED, NOT APPROXIMATED. A cheaper stand-in for the floor
 * predicate would be a second implementation of a governed rule — the exact
 * two-bases defect (Pattern 50) that the below-floor work existed to close —
 * and it would be wrong in the direction that matters: telling an operator a
 * quote is fine when the SEND gate will refuse it.
 *
 * The visible consequence is that role/capability work queues ("Cally — 3
 * freight costs need your attention") do not exist in V1. That is a real
 * capability being held back, not an oversight.
 *
 * `customer_responded` is absent for a different reason — see `tasks.ts`.
 */
export const TASK_KINDS = [
  "approval_rejected",
  "approval_approved",
  "approval_undelivered",
  "push_failed",
  "approval_decision",
  "approval_stale",
  "customer_silent",
  "quote_expiring",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * Ranking — lower is more urgent. ORDERING ONLY; never a semantic. It decides
 * which item is read first, never whether an item exists.
 *
 * The design source ranks the surviving kinds explicitly:
 *
 *   approval returned → push failed → approval pending → customer silent
 *
 * and that relative order is preserved below. Three kinds the source does not
 * rank are placed with stated reasons:
 *
 *   `approval_rejected` before `approval_approved` — both are "returned", but
 *     a rejection is work to redo and an approval is work now unblocked.
 *   `approval_undelivered` above `push_failed` — the request reached nobody, so
 *     no clock has started and nothing is in flight; that outranks a failure of
 *     something that at least ran.
 *   `quote_expiring` last — the slowest decay, and the one with a date on it.
 *
 * It is also what removes the old page's contradiction, where a red "check
 * inbox first" warning sat directly above a "Resume pricing" button. With one
 * ranking, the inbox item either outranks the resume or it does not.
 */
export const TASK_RANK: Record<TaskKind, number> = {
  // Someone else acted; it is back with you.
  approval_rejected: 1,
  approval_approved: 2,
  approval_undelivered: 3,
  push_failed: 4,
  // Waiting on others, decaying with time.
  approval_decision: 5,
  approval_stale: 6,
  customer_silent: 7,
  quote_expiring: 8,
};
