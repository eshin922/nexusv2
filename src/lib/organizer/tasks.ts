import { TASK_POLICY, TASK_RANK, type TaskKind } from "./task-policy";

/**
 * The Deal Organizer's task model — PURE.
 *
 * ── WHAT THE ORGANIZER IS ────────────────────────────────────────────────
 *
 * A projection. It reads governed state that other surfaces own and ranks it.
 * It never infers a workflow semantic no surface already owns, and it never
 * writes.
 *
 * The rule that keeps it honest:
 *
 *   A task exists only when a REAL unresolved governed state exists, AND
 *   either the work is assigned to that user, or it is unassigned and the
 *   user's capability permits them to do it.
 *
 *   Capability alone NEVER creates a task. An approver with nothing pending has
 *   an empty queue. The unresolved state comes first, always.
 *
 * ── V1 READS ONLY STATE WHOSE VALIDITY IS PROVABLE ───────────────────────
 *
 * Every kind below reads state Nexus has already persisted AND whose CURRENT
 * validity follows from that persistence alone. Two different failures are ruled
 * out by that one sentence, and `task-policy.ts` carries both:
 *
 *   - four COMPUTED kinds (pricing blocked, the unresolved-cost kinds) would
 *     need a 44.8s / ~344-query read on a landing route;
 *   - four APPROVAL kinds are fingerprint-gated, and the organizer cannot
 *     establish the fingerprint without that same read.
 *
 * The second is the sharper one: a task saying "Review approval" about a request
 * Pricing considers superseded is not merely uninformative, it is a positive
 * instruction to do work that cannot succeed. Those fail QUIET.
 *
 * ── WHY `customer_responded` IS NOT HERE ─────────────────────────────────
 *
 * The handoff proposes it as `customer_response_channel is not null AND
 * accepted_at is null`. Traced before implementing, and the field does not mean
 * what the predicate assumes.
 *
 * `customerResponseChannel` has exactly ONE writer: `markAccepted`, in the same
 * UPDATE that sets `status = 'accepted'` and `acceptedAt`. It is provenance of
 * an acceptance ALREADY RECORDED — how the customer said yes — not a signal
 * that an inbound response is waiting to be handled.
 *
 * The predicate is satisfiable, which is the trap. Two production quotes match
 * it, and both are acceptances that were REVERTED: `unmarkAccepted` clears
 * `status` and `acceptedAt` but leaves the channel populated. The kind would
 * have surfaced two rolled-back acceptances as unhandled customer responses —
 * inventing unresolvedness out of stale provenance.
 *
 * SUPPRESSED, and the missing state reported rather than approximated: nothing
 * in Nexus records "the customer responded and nobody has actioned it yet". No
 * replacement predicate is manufactured. When a field for that lands, this is
 * where the kind goes.
 */

export type TaskOwnership =
  /** Belongs to one person: the quote's creator. */
  | { kind: "assigned"; userId: string }
  /**
   * No durable assignee. Visible to whoever holds the capability.
   *
   * `capability` is a REQUIREMENT, not a source: it filters who may see an
   * unresolved state, and can never conjure one.
   *
   * Reached by no V1 kind — `approval_decision` was the only capability-owned
   * task and it fails quiet on freshness. Retained because this variant IS the
   * governing rule ("unassigned, and the viewer's capability permits it"), which
   * `visibleToViewer` still implements and tests still exercise; it carries the
   * approval kinds back the moment a freshness signal exists.
   */
  | { kind: "capability"; capability: "commercial_approver" }
  /**
   * The quote has no creator of record and no capability covers the work.
   *
   * VISIBLE TO NOBODY, deliberately. The alternative — handing it to whoever
   * holds some role — is capability creating an assignment, which is the one
   * thing the rule forbids. Kept as a first-class variant rather than dropped
   * at construction so the gap is COUNTABLE: the loader can report "N tasks
   * have no owner" instead of the tasks silently not existing.
   *
   * Four live quotes have no `created_by_user_id` (1 draft, 1 accepted, 2
   * complete). None is `sent`, so no `customer_silent` or `quote_expiring` task
   * can land here today.
   */
  | { kind: "unowned" };

export interface Task {
  kind: TaskKind;
  /** Stable per (kind, quote, discriminator) so a task can be counted and deduped. */
  id: string;
  projectId: string;
  quoteId: string;
  /** Which scenario this came from — a project row may aggregate several. */
  scenarioLabel: string;
  ownership: TaskOwnership;
  /** One sentence, stating the governed fact. Never a recommendation. */
  reason: string;
  cta: string;
  href: string;
  /** Oldest-first tiebreak. */
  updatedAt: Date;
}

// ── the inputs, all durable columns or approval rows ──────────────────────

export interface QuoteFacts {
  quoteId: string;
  projectId: string;
  scenarioLabel: string;
  /** `quotes.created_by_user_id` — scopes quote-derived work to its creator. */
  createdByUserId: string | null;
  status: string;
  sentAt: Date | null;
  acceptedAt: Date | null;
  validUntil: Date | null;
  updatedAt: Date;
  /** From `projectApprovalTierState` over persisted request/authorization rows. */
  approvals: ApprovalFacts[];
  /** `quotes.netsuite_so_push_status === "failed"`. */
  pushFailed: boolean;
}

/**
 * One tier's approval state as the organizer is able to know it.
 *
 * `kind` keeps the full union `projectApprovalTierState` returns, because the
 * loader passes through whatever that function decided — narrowing the type
 * here would hide, rather than handle, the states this surface cannot act on.
 * Only `rejected` produces a task; everything else falls through.
 */
export interface ApprovalFacts {
  tierId: string;
  tierLabel: string;
  kind: "none" | "pending" | "approved" | "rejected" | "superseded";
  rejectionReason: string | null;
}

const href = (f: QuoteFacts, surface: string) =>
  `/projects/${f.projectId}/quotes/${f.quoteId}/${surface}`;

/**
 * Every task a quote currently raises.
 *
 * Order of construction is irrelevant — ranking happens once, in `rankTasks`.
 * Each branch is a governed unresolved state and nothing else.
 */
export function tasksForQuote(f: QuoteFacts, now: Date): Task[] {
  const out: Task[] = [];
  const owner: TaskOwnership = f.createdByUserId
    ? { kind: "assigned", userId: f.createdByUserId }
    : { kind: "unowned" };

  const add = (
    kind: TaskKind,
    discriminator: string,
    reason: string,
    cta: string,
    surface: string,
    ownership: TaskOwnership = owner,
  ) =>
    out.push({
      kind,
      id: `${kind}:${f.quoteId}:${discriminator}`,
      projectId: f.projectId,
      quoteId: f.quoteId,
      scenarioLabel: f.scenarioLabel,
      ownership,
      reason,
      cta,
      href: href(f, surface),
      updatedAt: f.updatedAt,
    });

  // ── approvals · ONLY the branch that does not depend on freshness ───────
  //
  // `projectApprovalTierState` gates `approved` and `pending` on the request or
  // authorization's `stateFingerprint` matching the fingerprint of CURRENT
  // economics — which needs the costing bundle, the read this surface must not
  // make. Nor is there a durable substitute: `invalidated_at` is read in six
  // places and written by none, so it proves nothing.
  //
  // So those FAIL QUIET. A "Review approval" or "ready to send" task about a
  // request Pricing considers superseded is worse than no task — it instructs
  // an operator to do work the SEND gate will refuse.
  //
  // A rejection consults no fingerprint. It is a terminal `status` and a
  // `decided_at`: durable, final, and true regardless of where the economics
  // have since moved.
  for (const a of f.approvals) {
    if (a.kind !== "rejected") continue;
    add(
      "approval_rejected",
      a.tierId,
      a.rejectionReason
        ? `${a.tierLabel} was declined — ${a.rejectionReason}`
        : `${a.tierLabel} was declined below floor`,
      "Re-price or re-request",
      "pricing",
    );
  }

  if (f.pushFailed) {
    add("push_failed", "ns", "The NetSuite sales-order push failed", "Retry push", "quote");
  }

  // ── time decay ──────────────────────────────────────────────────────────
  if (
    f.status === "sent" &&
    f.acceptedAt === null &&
    f.sentAt &&
    now.getTime() - f.sentAt.getTime() > TASK_POLICY.customerSilentAfterMs
  ) {
    const days = Math.floor((now.getTime() - f.sentAt.getTime()) / 86_400_000);
    add(
      "customer_silent",
      "q",
      `Sent ${days} day${days === 1 ? "" : "s"} ago with no response`,
      "Follow up",
      "quote",
    );
  }

  // `valid_until` is populated at send from firm settings, and 3 of the 11 sent
  // quotes predate it. A null is NOT an expiry — no task, rather than a
  // fabricated date.
  if (
    f.status === "sent" &&
    f.validUntil !== null &&
    f.validUntil.getTime() - now.getTime() <= TASK_POLICY.quoteExpiringWithinMs &&
    f.validUntil.getTime() >= now.getTime()
  ) {
    const days = Math.ceil((f.validUntil.getTime() - now.getTime()) / 86_400_000);
    add(
      "quote_expiring",
      "q",
      `Valid for ${days} more day${days === 1 ? "" : "s"}`,
      "Follow up",
      "quote",
    );
  }

  return out;
}

/** Who can see a task — the second half of the rule, never the first. */
export interface Viewer {
  userId: string;
  commercialApprover: boolean;
  role: string;
}

export function visibleToViewer(task: Task, viewer: Viewer): boolean {
  if (task.ownership.kind === "assigned") {
    return task.ownership.userId === viewer.userId;
  }
  if (task.ownership.kind === "unowned") {
    // No assignee, no covering capability. Surfacing it to a role would BE
    // role-creating-work.
    return false;
  }
  // Reached only because an unresolved approval row already produced this task.
  return viewer.commercialApprover === true;
}

/** Most urgent first; ties oldest-first. */
export function rankTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      TASK_RANK[a.kind] - TASK_RANK[b.kind] ||
      a.updatedAt.getTime() - b.updatedAt.getTime(),
  );
}

export type ProjectGroup = "needs_you" | "with_customer" | "no_action";

/**
 * One row per project; the highest-ranked task the VIEWER can act on decides
 * its group. The queue behind it keeps every task.
 */
export function groupForProject(input: {
  visibleTasks: readonly Task[];
  anySent: boolean;
  anyUnaccepted: boolean;
}): ProjectGroup {
  if (input.visibleTasks.length > 0) return "needs_you";
  if (input.anySent && input.anyUnaccepted) return "with_customer";
  return "no_action";
}

export { TASK_POLICY, TASK_RANK };
export type { TaskKind };
