import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { netsuiteSoPushes } from "@/db/schema";
import { failureStatusFor, type AttemptStatus } from "./attempt-lifecycle-rules";

// Grouped-SO push attempt lifecycle.
//
// Design: docs/validation/od-004-grouped-so-recovery-contract.md
//
// The dangerous state this exists for:
//
//   Sales Order created -> groups expanded -> member-rate PATCHes incomplete
//
// A real SO exists, members may still sit at $0.00, the duplicate-deal
// SuiteScript forbids a second CREATE, and a crash can precede any final
// assertion. So the attempt row must be able to say "the order exists but is
// not commercially complete" durably, and a retry must resume rather than
// create.
//
// STATES — (status, netsuite_so_id)
//
//   pending        + null    payload frozen; nothing conclusively created
//   pending        + null    POST in flight (response-loss window; unchanged)
//   awaiting_rates + so_id   SO EXISTS. Rate completion/verification outstanding.
//   succeeded      + so_id   complete and verified
//   failed         + null    terminal PRE-CREATE rejection only
//   failed         + so_id   *** FORBIDDEN ***
//
// THE INVARIANT
//
//   Once netsuite_so_id is non-null, the attempt may NEVER transition to
//   'failed'.
//
// Why it is load-bearing rather than tidy. Migration 0065 made the
// snapshot-attempt unique index and the durable-payload selector share one
// predicate:
//
//   quote_snapshot_id IS NOT NULL
//     AND NOT (status = 'failed' AND error_class = 'validation')
//
// A post-CREATE PATCH that threw a `validation` error and was recorded as
// failed+validation would therefore be EXCLUDED from both the index and the
// selector. The retry would insert a NEW attempt row and attempt a SECOND
// CREATE — caught fail-closed by the duplicate-deal SuiteScript, but surfacing
// as DUPLICATED DEAL with the real SO id orphaned. The invariant is what stops
// a correct-looking retry path from becoming a duplicate-order path.
//
// `awaiting_rates` deliberately SATISFIES that predicate, so the row keeps
// owning the snapshot and a second attempt row cannot be inserted at all.
//
// Centralised here, rather than in each error handler, because "remember not
// to mark this failed" is exactly the kind of rule that survives review and
// then gets forgotten by the next handler someone adds.

// Pure decisions live in attempt-lifecycle-rules.ts so they are testable
// without a database. This module owns the WRITES only.
export {
  awaitingRatesOperatorMessage,
  failureStatusFor,
  isResumable,
  mustNotCreate,
  ownsSnapshot,
  type AttemptStatus,
} from "./attempt-lifecycle-rules";

/**
 * THE RECOVERY BOUNDARY.
 *
 * Persist the SO identity and move the attempt to `awaiting_rates` — called
 * IMMEDIATELY after a successful CREATE and BEFORE any member-rate PATCH.
 *
 * Everything after this point is resumable. Nothing before it can strand an
 * SO the row does not know about.
 */
export async function recordSalesOrderCreated(args: {
  attemptId: string;
  netsuiteSoId: string;
  netsuiteSoTranid: string | null;
  amountPushed: number;
}): Promise<void> {
  await db
    .update(netsuiteSoPushes)
    .set({
      status: "awaiting_rates",
      netsuiteSoId: args.netsuiteSoId,
      netsuiteSoTranid: args.netsuiteSoTranid,
      amountPushed: String(args.amountPushed),
      errorClass: null,
      errorDetail: null,
    })
    .where(eq(netsuiteSoPushes.id, args.attemptId));
}

/**
 * Record an attempt failure, ENFORCING the invariant.
 *
 * Pre-CREATE (no SO id): terminal `failed`, preserving the 0065 semantics
 * exactly — including `failed + validation` releasing snapshot ownership so a
 * repaired payload can be re-elected.
 *
 * Post-CREATE (SO id known): CANNOT be `failed`. Held at `awaiting_rates` with
 * the SO identity retained and the reason recorded, so the next invocation
 * resumes against the same order.
 *
 * The branch is on SO-id presence, not on the caller's intent — callers do not
 * get to choose, which is the point of centralising it.
 */
export async function recordAttemptFailure(args: {
  attemptId: string;
  netsuiteSoId: string | null;
  errorClass: string;
  errorDetail: string;
}): Promise<{ terminal: boolean; status: AttemptStatus }> {
  const decision = failureStatusFor({ status: "", netsuiteSoId: args.netsuiteSoId });
  const postCreate = !decision.terminal;

  if (postCreate) {
    await db
      .update(netsuiteSoPushes)
      .set({
        status: "awaiting_rates",
        errorClass: args.errorClass,
        errorDetail: args.errorDetail,
      })
      .where(eq(netsuiteSoPushes.id, args.attemptId));
    return { terminal: false, status: "awaiting_rates" };
  }

  await db
    .update(netsuiteSoPushes)
    .set({
      status: "failed",
      errorClass: args.errorClass,
      errorDetail: args.errorDetail,
      completedAt: new Date(),
    })
    .where(eq(netsuiteSoPushes.id, args.attemptId));
  return { terminal: true, status: "failed" };
}

/**
 * Promote a verified attempt to `succeeded`.
 *
 * Only reachable once the full verification gate has passed. Refuses without
 * an SO id — `succeeded` without an order is not a representable state.
 */
export async function recordAttemptSucceeded(args: {
  attemptId: string;
  netsuiteSoId: string;
  netsuiteSoTranid: string | null;
  amountPushed: number;
}): Promise<void> {
  if (!args.netsuiteSoId) {
    throw new Error(
      "[attempt-lifecycle] refusing to mark an attempt succeeded without a NetSuite Sales Order id",
    );
  }
  await db
    .update(netsuiteSoPushes)
    .set({
      status: "succeeded",
      netsuiteSoId: args.netsuiteSoId,
      netsuiteSoTranid: args.netsuiteSoTranid,
      amountPushed: String(args.amountPushed),
      errorClass: null,
      errorDetail: null,
      completedAt: new Date(),
    })
    .where(eq(netsuiteSoPushes.id, args.attemptId));
}
