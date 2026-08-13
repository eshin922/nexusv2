// Grouped-SO attempt lifecycle — PURE RULES.
//
// Deliberately free of `server-only`, the database client and every other
// import, so the rules that decide "may this attempt create an order?" are
// testable without a database. `attempt-lifecycle.ts` performs the writes and
// imports its decisions from here.
//
// Design: docs/validation/od-004-grouped-so-recovery-contract.md

export type AttemptStatus =
  | "pending"
  | "awaiting_rates"
  | "succeeded"
  | "failed"
  // An external Sales Order MAY exist for this attempt and reconciliation could
  // not establish which one. Terminal until a human resolves it, and — unlike
  // `failed + validation` — it KEEPS the snapshot, so no sibling attempt row can
  // be inserted and no fresh CREATE can be issued behind it.
  | "needs_reconciliation";

export interface AttemptIdentity {
  status: string;
  netsuiteSoId: string | null;
}

/** A post-CREATE attempt is resumable when the SO identity is durable. */
export function isResumable(attempt: AttemptIdentity): boolean {
  return attempt.status === "awaiting_rates" && attempt.netsuiteSoId !== null;
}

/**
 * True when this attempt must NOT issue a Sales Order CREATE.
 *
 * A test of POSSIBILITY, not of knowledge. Two ways an order can exist:
 *
 *   1. its id is known — creating another is never correct, whatever status
 *      the row carries;
 *   2. one MAY exist and reconciliation could not say which — `DUPLICATED DEAL`
 *      with an unverifiable candidate, or several candidates.
 *
 * Case 2 is the one the older id-presence-only rule could not express, and it
 * is the live defect: a CREATE that committed and lost its response leaves no
 * id to key on, so knowledge-based suppression never engages. Provider-header
 * idempotency does not cover it either — measured absent on this account.
 *
 * MUST stay in lockstep with `ownsSnapshot`, the durable-payload selector in
 * mark-complete.ts, and migration 0065's partial unique index. They are one
 * rule expressed four times.
 */
export function mustNotCreate(attempt: AttemptIdentity): boolean {
  return (
    attempt.netsuiteSoId !== null || attempt.status === "needs_reconciliation"
  );
}

/**
 * THE INVARIANT, as a decision.
 *
 * Post-CREATE (SO id known) can never be `failed`; it holds `awaiting_rates`
 * with the identity retained. Pre-CREATE keeps migration 0065's terminal
 * semantics exactly, including `failed + validation` releasing snapshot
 * ownership so a repaired payload can be re-elected.
 */
export function failureStatusFor(attempt: AttemptIdentity): {
  status: AttemptStatus;
  terminal: boolean;
} {
  return attempt.netsuiteSoId !== null
    ? { status: "awaiting_rates", terminal: false }
    : { status: "failed", terminal: true };
}

/**
 * Mirrors the predicate shared by migration 0065's snapshot-attempt unique
 * index and the durable-payload selector in `mark-complete.ts`.
 *
 * An attempt that satisfies this keeps owning its snapshot — which is what
 * makes a second attempt row, and therefore a second CREATE, impossible.
 */
export function ownsSnapshot(attempt: {
  status: string;
  errorClass: string | null;
}): boolean {
  return !(attempt.status === "failed" && attempt.errorClass === "validation");
}

/** Operator-facing copy for the resumable state. Displays the tranid when known. */
export function awaitingRatesOperatorMessage(tranid: string | null): string {
  return tranid
    ? `Sales Order ${tranid} created · pricing completion pending · safe to retry`
    : "Sales Order created · pricing completion pending · safe to retry";
}
