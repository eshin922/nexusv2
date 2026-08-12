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
  | "failed";

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
 * Keyed on SO-id presence, not on status: if an id is known, an order exists
 * at the provider and creating another is never correct — whatever status the
 * row happens to carry.
 */
export function mustNotCreate(attempt: AttemptIdentity): boolean {
  return attempt.netsuiteSoId !== null;
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
