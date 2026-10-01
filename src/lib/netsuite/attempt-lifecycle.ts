import "server-only";
import { desc, eq } from "drizzle-orm";

/**
 * A database handle, so these writers can run inside a transaction a
 * falsification rolls back. Same convention as `readExistingComponentCharges`:
 * behaviour that can only be exercised against the live client is behaviour
 * that can only be asserted by prose.
 */
type Exec = typeof db;
import { db } from "@/db";
import { netsuiteSoPushes, quotes as quotesTable } from "@/db/schema";
import {
  failureStatusFor,
  isResumable,
  mirrorFieldsFor,
  type AttemptStatus,
} from "./attempt-lifecycle-rules";

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
  mirrorFieldsFor,
  needsReconciliationOperatorMessage,
  isResumable,
  mustNotCreate,
  ownsSnapshot,
  type AttemptStatus,
} from "./attempt-lifecycle-rules";


/**
 * Project the attempt row onto the quote mirror.
 *
 * Reads the row it is mirroring rather than taking fields from the caller: a
 * caller that supplies the fields can supply the wrong ones, which is exactly
 * how the mirror came to disagree in the first place. Every push-row writer in
 * this module calls it as its last act.
 *
 * NON-FATAL by design. `netsuite_so_pushes` is the source of truth for
 * retry-idempotency; the mirror is a read convenience. A failure to mirror must
 * never unwind a recorded provider outcome -- losing the record of a created
 * Sales Order is strictly worse than a stale mirror.
 */
export async function syncQuoteMirror(attemptId: string, exec: Exec = db): Promise<void> {
  try {
    const [row] = await exec
      .select({
        quoteId: netsuiteSoPushes.quoteId,
        status: netsuiteSoPushes.status,
        netsuiteSoId: netsuiteSoPushes.netsuiteSoId,
        netsuiteSoTranid: netsuiteSoPushes.netsuiteSoTranid,
        errorDetail: netsuiteSoPushes.errorDetail,
      })
      .from(netsuiteSoPushes)
      .where(eq(netsuiteSoPushes.id, attemptId))
      .limit(1);
    if (!row) return;
    await exec
      .update(quotesTable)
      .set({
        ...mirrorFieldsFor({
          status: row.status as AttemptStatus,
          netsuiteSoId: row.netsuiteSoId,
          netsuiteSoTranid: row.netsuiteSoTranid,
          errorDetail: row.errorDetail,
        }),
        updatedAt: new Date(),
      })
      .where(eq(quotesTable.id, row.quoteId));
  } catch {
    // deliberate: see the contract above
  }
}

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
},
  exec: Exec = db,
): Promise<void> {
  await exec
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
  await syncQuoteMirror(args.attemptId, exec);
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
export async function recordAttemptFailure(
  args: {
    attemptId: string;
    netsuiteSoId: string | null;
    errorClass: string;
    errorDetail: string;
  },
  exec: Exec = db,
): Promise<{ terminal: boolean; status: AttemptStatus }> {
  const decision = failureStatusFor({ status: "", netsuiteSoId: args.netsuiteSoId });
  const postCreate = !decision.terminal;

  if (postCreate) {
    await exec
      .update(netsuiteSoPushes)
      .set({
        status: "awaiting_rates",
        errorClass: args.errorClass,
        errorDetail: args.errorDetail,
      })
      .where(eq(netsuiteSoPushes.id, args.attemptId));
    await syncQuoteMirror(args.attemptId, exec);
    return { terminal: false, status: "awaiting_rates" };
  }

  await exec
    .update(netsuiteSoPushes)
    .set({
      status: "failed",
      errorClass: args.errorClass,
      errorDetail: args.errorDetail,
      completedAt: new Date(),
    })
    .where(eq(netsuiteSoPushes.id, args.attemptId));
  await syncQuoteMirror(args.attemptId, exec);
  return { terminal: true, status: "failed" };
}

/**
 * Promote a verified attempt to `succeeded`.
 *
 * Only reachable once the full verification gate has passed. Refuses without
 * an SO id — `succeeded` without an order is not a representable state.
 */
export async function recordAttemptSucceeded(
  args: {
    attemptId: string;
    netsuiteSoId: string;
    netsuiteSoTranid: string | null;
    amountPushed: number;
  },
  exec: Exec = db,
): Promise<void> {
  if (!args.netsuiteSoId) {
    throw new Error(
      "[attempt-lifecycle] refusing to mark an attempt succeeded without a NetSuite Sales Order id",
    );
  }
  await exec
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
  await syncQuoteMirror(args.attemptId, exec);
}


/**
 * Attach the display identifier to an attempt whose SO id is already durable.
 *
 * A SEPARATE write, deliberately. The internal id is the recovery key and must
 * be persisted before anything that can fail; the tranid is diagnostic and is
 * attached afterwards. Folding the lookup into `recordSalesOrderCreated` would
 * put a network call in front of the one write that must not be delayed -- a
 * process death during the GET would leave a created Sales Order that no retry
 * can find.
 *
 * Refuses to clear a value: a null result from a failed lookup must not erase
 * a tranid an earlier attempt already established.
 */
export async function recordSalesOrderTranid(
  args: { attemptId: string; netsuiteSoTranid: string },
  exec: Exec = db,
): Promise<void> {
  if (!args.netsuiteSoTranid) return;
  await exec
    .update(netsuiteSoPushes)
    .set({ netsuiteSoTranid: args.netsuiteSoTranid })
    .where(eq(netsuiteSoPushes.id, args.attemptId));
  await syncQuoteMirror(args.attemptId, exec);
}

/**
 * The resume BINDING, as a decision.
 *
 * Resume must continue one specific order on one specific attempt against one
 * specific frozen snapshot. `isResumable` alone says only that the row looks
 * continuable; it does not say the caller is continuing the thing they think
 * they are. If the snapshot the attempt froze is no longer the quote's current
 * snapshot, the plan has moved and continuing would apply today's intent to
 * yesterday's order.
 *
 * Returns a refusal rather than throwing, so the caller can render it as a
 * governed business refusal instead of a fault.
 */
export type ResumeBinding =
  | { ok: true; attemptId: string; netsuiteSoId: string; quoteSnapshotId: string | null }
  | { ok: false; reason: string };

export async function bindResume(
  args: { quoteId: string; currentSnapshotId: string | null },
  exec: Exec = db,
): Promise<ResumeBinding> {
  const [attempt] = await exec
    .select({
      id: netsuiteSoPushes.id,
      status: netsuiteSoPushes.status,
      netsuiteSoId: netsuiteSoPushes.netsuiteSoId,
      quoteSnapshotId: netsuiteSoPushes.quoteSnapshotId,
    })
    .from(netsuiteSoPushes)
    .where(eq(netsuiteSoPushes.quoteId, args.quoteId))
    .orderBy(desc(netsuiteSoPushes.createdAt))
    .limit(1);

  if (!attempt) {
    return {
      ok: false,
      reason:
        "There is no Sales Order attempt on this quote to continue. Use Send order to NetSuite.",
    };
  }
  if (!isResumable({ status: attempt.status, netsuiteSoId: attempt.netsuiteSoId })) {
    return {
      ok: false,
      reason: attempt.netsuiteSoId
        ? `This order is ${attempt.status}, not awaiting rate completion, so there is nothing to continue.`
        : "No Sales Order exists for this quote yet, so there is nothing to continue. Use Send order to NetSuite.",
    };
  }
  // The snapshot the order was built from must still be the quote's current
  // one. A revision since the push means the order in NetSuite reflects a plan
  // the quote no longer holds.
  if (
    args.currentSnapshotId !== null &&
    attempt.quoteSnapshotId !== null &&
    attempt.quoteSnapshotId !== args.currentSnapshotId
  ) {
    return {
      ok: false,
      reason:
        "This quote has been revised since the Sales Order was created, so continuing would apply the current plan to an order built from the previous one. Review the order in NetSuite before continuing.",
    };
  }
  return {
    ok: true,
    attemptId: attempt.id,
    netsuiteSoId: attempt.netsuiteSoId as string,
    quoteSnapshotId: attempt.quoteSnapshotId,
  };
}

/**
 * Park an attempt whose CREATE outcome could not be reconciled.
 *
 * Written when an external Sales Order MAY exist and provider reconciliation
 * could not establish which one — `DUPLICATED DEAL` with an unverifiable or
 * contradictory candidate set, or several candidates for one deal.
 *
 * WHY NOT `failed`. `failed + validation` is the one state `ownsSnapshot`
 * excludes, so writing it here would release the snapshot, admit a sibling
 * attempt row, and let a fresh CREATE proceed behind an order that already
 * exists — the exact sequence this repair removes. `needs_reconciliation`
 * keeps the snapshot AND satisfies `mustNotCreate`, so the attempt is inert
 * until a human resolves it.
 *
 * `netsuiteSoId` stays whatever it was: in the response-loss case it is null
 * precisely because the id was never learned, and inventing one here would be
 * worse than recording the ambiguity honestly.
 */
export async function recordNeedsReconciliation(
  args: { attemptId: string; errorDetail: string },
  exec: Exec = db,
): Promise<void> {
  await exec
    .update(netsuiteSoPushes)
    .set({
      status: "needs_reconciliation",
      errorClass: "duplicate_deal",
      errorDetail: args.errorDetail,
      completedAt: new Date(),
    })
    .where(eq(netsuiteSoPushes.id, args.attemptId));
  await syncQuoteMirror(args.attemptId, exec);
}
