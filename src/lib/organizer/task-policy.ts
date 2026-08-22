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
  /**
   * A delivered approval request is worth chasing after this long.
   *
   * DORMANT in V1: `approval_stale` is fingerprint-gated and fails quiet (see
   * TASK_KINDS). Kept because the threshold is policy, not a by-product of the
   * kind — it returns unchanged when a freshness signal exists.
   */
  approvalStaleAfterMs: 1 * 60 * 60 * 1000,
  /** A sent quote with no acceptance is "with the customer" until this long. */
  customerSilentAfterMs: 48 * 60 * 60 * 1000,
  /** A sent quote's validity is "expiring" inside this window. */
  quoteExpiringWithinMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * The complete V1 task vocabulary. FOUR kinds, pinned.
 *
 * Pinned because the organizer's whole claim is that it surfaces governed state
 * and invents nothing: a fifth kind appearing without a governed predicate
 * behind it is the failure this list exists to make visible. A test asserts
 * this array and the rank map agree, so a kind cannot be added in one place and
 * forgotten in the other.
 *
 * ── WHAT V1 DELIBERATELY DOES NOT CARRY ──────────────────────────────────
 *
 * Every kind here reads state Nexus has ALREADY PERSISTED, and — critically —
 * state whose CURRENT VALIDITY is provable from that persistence alone.
 *
 * Four COMPUTED kinds were designed, proven against live data, and removed
 * rather than approximated:
 *
 *   pricing_blocked            needs `evaluateProgression`
 *   costs_unresolved_quote     needs `loadUnresolvedQuoteCosts`
 *   costs_unresolved_freight   needs `loadUnresolvedQuoteCosts`
 *   (unresolved configuration) folded into the above
 *
 * Computing them live for the 43 draft quotes across 21 real projects costs
 * 44.8s and ~344 queries against a `max: 3` pool — on a DEFAULT LANDING ROUTE.
 * Serving them from a persisted projection is the right answer and is designed
 * in `docs/organizer-read-model-proposal.md`; that is not this slice.
 *
 * Four APPROVAL kinds were then removed for a different and sharper reason:
 *
 *   approval_approved          "approved below floor and ready to send"
 *   approval_decision          "Review approval"
 *   approval_undelivered       "Contact approver"
 *   approval_stale             "Chase approval"
 *
 * Each of those is FINGERPRINT-GATED. `projectApprovalTierState` returns
 * `approved` only when a live authorization's `stateFingerprint` equals the
 * fingerprint of CURRENT economics, and `pending` only when the request's
 * fingerprint does; otherwise both collapse to `superseded`, because the SEND
 * gate will refuse them. Computing that fingerprint needs the costing bundle —
 * the read this surface must not make.
 *
 * And there is no durable substitute. `below_floor_authorizations.invalidated_at`
 * looks like one, but NOTHING WRITES IT: it is read in six places across the
 * codebase and set by none, so it is permanently NULL and proves nothing.
 *
 * So the organizer CANNOT establish that an approval is still live, and a task
 * saying "Review approval" or "ready to send" about a request Pricing considers
 * superseded is worse than no task — it is a positive instruction to do work
 * that cannot succeed. These fail QUIET.
 *
 * `approval_rejected` SURVIVES, and the distinction is the whole point: the
 * rejected branch of `projectApprovalTierState` never consults the fingerprint.
 * It reads a terminal `status` and `decided_at`. A rejection is durable, final,
 * and true regardless of where the economics have since moved.
 *
 * `customer_responded` is absent for a third reason — see `tasks.ts`.
 */
export const TASK_KINDS = [
  "approval_rejected",
  "push_failed",
  "customer_silent",
  "quote_expiring",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * Ranking — lower is more urgent. ORDERING ONLY; never a semantic. It decides
 * which item is read first, never whether an item exists.
 *
 * The design source's order is preserved for the kinds that survive:
 * returned → push failed → customer silent, with `quote_expiring` last as the
 * slowest decay and the only one carrying a date.
 *
 * It is also what removes the old page's contradiction, where a red "check
 * inbox first" warning sat directly above a "Resume pricing" button. With one
 * ranking, the inbox item either outranks the resume or it does not.
 */
export const TASK_RANK: Record<TaskKind, number> = {
  // Someone else acted; it is back with you.
  approval_rejected: 1,
  push_failed: 2,
  // Waiting on others, decaying with time.
  customer_silent: 3,
  quote_expiring: 4,
};
