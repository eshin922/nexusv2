/**
 * W1 · the push-recovery contract, falsified over the whole state space.
 *
 * Every assertion here is exhaustive over `AttemptStatus` x {id known, id
 * unknown} rather than over the four combinations production happens to
 * contain. The fifth state is precisely the one that broke, so a test that
 * enumerates the observed cases would have passed against the defect.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  failureStatusFor,
  isResumable,
  mirrorFieldsFor,
  mustNotCreate,
  needsReconciliationOperatorMessage,
  ownsSnapshot,
  type AttemptStatus,
} from "../../src/lib/netsuite/attempt-lifecycle-rules.ts";
import {
  receiptVariantFor,
  variantImpliesOrderMayExist,
} from "../../src/lib/netsuite/receipt-variant.ts";

const ALL_STATES: AttemptStatus[] = [
  "pending",
  "awaiting_rates",
  "succeeded",
  "failed",
  "needs_reconciliation",
];

/** The whole space: five states x id known / unknown. */
const SPACE = ALL_STATES.flatMap((status) =>
  [null, "364141"].map((netsuiteSoId) => ({ status, netsuiteSoId })),
);

// ══════════════════════════════════════════════════════════════════════
// 1 · the mirror is a TOTAL projection
// ══════════════════════════════════════════════════════════════════════

test("every governed state projects a mirror — no state is unmirrored", () => {
  // The defect: `needs_reconciliation` had no quote-side writer at all, so two
  // production quotes carried a push row saying it and a quote saying NULL.
  for (const status of ALL_STATES) {
    const m = mirrorFieldsFor({
      status,
      netsuiteSoId: "364141",
      netsuiteSoTranid: "SO2736",
      errorDetail: "detail",
    });
    assert.equal(m.netsuiteSoPushStatus, status, `${status} must mirror its own status`);
  }
});

test("the identity is projected for EVERY state, not only the successful one", () => {
  // The sharper half of the defect: `awaiting_rates` mirrored status and
  // message while omitting the SO id, so the operator was told an order
  // existed and given nothing to find it with.
  for (const status of ALL_STATES) {
    const m = mirrorFieldsFor({
      status,
      netsuiteSoId: "364141",
      netsuiteSoTranid: "SO2736",
      errorDetail: null,
    });
    assert.equal(m.netsuiteSoId, "364141", `${status} must carry the SO id`);
    assert.equal(m.netsuiteSoTranid, "SO2736", `${status} must carry the tranid`);
  }
});

test("a known tranid survives every state — including the two that strand", () => {
  for (const status of ALL_STATES) {
    const m = mirrorFieldsFor({
      status,
      netsuiteSoId: "364141",
      netsuiteSoTranid: "SO2707",
      errorDetail: null,
    });
    assert.equal(m.netsuiteSoTranid, "SO2707", status);
  }
});

test("an unknown identity mirrors as null rather than being invented", () => {
  for (const status of ALL_STATES) {
    const m = mirrorFieldsFor({
      status,
      netsuiteSoId: null,
      netsuiteSoTranid: null,
      errorDetail: null,
    });
    assert.equal(m.netsuiteSoId, null, status);
    assert.equal(m.netsuiteSoTranid, null, status);
  }
});

test("needs_reconciliation explains the conflict and names the order when known", () => {
  const withId = mirrorFieldsFor({
    status: "needs_reconciliation",
    netsuiteSoId: "362341",
    netsuiteSoTranid: null,
    errorDetail: "DUPLICATED DEAL",
  });
  assert.match(String(withId.netsuiteSoPushError), /362341/);
  assert.match(String(withId.netsuiteSoPushError), /may already exist/i);
  // and degrades honestly when the id was never learned
  const withoutId = needsReconciliationOperatorMessage(null, null);
  assert.match(withoutId, /may already exist/i);
  assert.doesNotMatch(withoutId, /null|undefined/);
});

test("awaiting_rates copy does not claim a failure that did not happen", () => {
  const m = mirrorFieldsFor({
    status: "awaiting_rates",
    netsuiteSoId: "364141",
    netsuiteSoTranid: "SO2736",
    errorDetail: "some provider noise",
  });
  assert.match(String(m.netsuiteSoPushError), /SO2736/);
  assert.doesNotMatch(String(m.netsuiteSoPushError), /did ?n[o']t reach|failed/i);
});

// ══════════════════════════════════════════════════════════════════════
// 3 · receipt selection is TOTAL
// ══════════════════════════════════════════════════════════════════════

test("needs_reconciliation never renders as pending", () => {
  // The live defect: an open `else` sent it to `pending`, the one variant
  // whose purpose is to invite the operator to create an order -- while the
  // push row said one may already exist.
  assert.equal(receiptVariantFor("needs_reconciliation", false), "reconcile");
  assert.notEqual(receiptVariantFor("needs_reconciliation", false), "pending");
});

test("only genuine pending states render pending", () => {
  const pendingStates = ALL_STATES.filter(
    (s) => receiptVariantFor(s, false) === "pending",
  );
  assert.deepEqual(pendingStates, ["pending"], "exactly one state may read as pending");
  // No attempt at all is also pending, and that is the only other route in.
  assert.equal(receiptVariantFor(null, false), "pending");
  assert.equal(receiptVariantFor(undefined, false), "pending");
});

test("a complete quote reads as the record whatever the attempt says", () => {
  for (const status of ALL_STATES) {
    assert.equal(receiptVariantFor(status, true), "record", status);
  }
});

test("every state maps to a variant, and the mapping has no usable default", () => {
  for (const status of ALL_STATES) {
    const v = receiptVariantFor(status, false);
    assert.ok(
      ["pending", "awaiting", "reconcile", "failed", "record"].includes(v),
      `${status} -> ${v}`,
    );
  }
  // The exhaustiveness is enforced by a `never` binding, not by a comment.
  const src = readFileSync("src/lib/netsuite/receipt-variant.ts", "utf8");
  assert.match(src, /const unhandled: never = status/);
});

test("a variant implying an order may exist never offers creation", () => {
  // `reconcile` is included deliberately: "may exist" is exactly the condition
  // under which a second CREATE must not be offered -- the same reasoning
  // `mustNotCreate` applies on the write side.
  assert.equal(variantImpliesOrderMayExist("reconcile"), true);
  assert.equal(variantImpliesOrderMayExist("awaiting"), true);
  assert.equal(variantImpliesOrderMayExist("record"), true);
  assert.equal(variantImpliesOrderMayExist("pending"), false);
  assert.equal(variantImpliesOrderMayExist("failed"), false);
});

// ══════════════════════════════════════════════════════════════════════
// 4 · resume is a continuation, and cannot become a creation
// ══════════════════════════════════════════════════════════════════════

test("RESUME CANNOT REACH CREATE — isResumable implies mustNotCreate, everywhere", () => {
  // The load-bearing falsification, proven over the whole space rather than
  // asserted for the happy case. Resume is offered only where `isResumable`
  // holds; if that ever failed to imply `mustNotCreate`, the resume path could
  // issue a second CREATE against an order that already exists.
  let resumableCount = 0;
  for (const a of SPACE) {
    if (isResumable(a)) {
      resumableCount++;
      assert.equal(mustNotCreate(a), true, `resumable but creatable: ${JSON.stringify(a)}`);
    }
  }
  assert.ok(resumableCount > 0, "the implication must not hold vacuously");
});

test("resume is offered for exactly one state, and only with an id", () => {
  const resumable = SPACE.filter(isResumable);
  assert.deepEqual(resumable, [{ status: "awaiting_rates", netsuiteSoId: "364141" }]);
});

test("repeated resume stays suppressed — idempotent by the same rule", () => {
  // After a resume the row is either still awaiting_rates or succeeded. Both
  // retain the id, so both continue to suppress creation.
  for (const status of ["awaiting_rates", "succeeded"] as AttemptStatus[]) {
    assert.equal(mustNotCreate({ status, netsuiteSoId: "364141" }), true, status);
  }
});

test("another interruption mid-resume remains safely resumable", () => {
  // A post-CREATE failure can never be recorded as terminal `failed`; it holds
  // awaiting_rates with the identity retained, which is what makes the next
  // attempt a resume rather than a create.
  const d = failureStatusFor({ status: "awaiting_rates", netsuiteSoId: "364141" });
  assert.equal(d.status, "awaiting_rates");
  assert.equal(d.terminal, false);
  assert.equal(isResumable({ status: d.status, netsuiteSoId: "364141" }), true);
});

test("a pre-CREATE failure stays terminal and is NOT resumable", () => {
  const d = failureStatusFor({ status: "pending", netsuiteSoId: null });
  assert.equal(d.status, "failed");
  assert.equal(d.terminal, true);
  assert.equal(isResumable({ status: "failed", netsuiteSoId: null }), false);
});

// ══════════════════════════════════════════════════════════════════════
// C3 · earlier persistence is not CREATE authority
// ══════════════════════════════════════════════════════════════════════

test("C3 · knowing the identity sooner does not change duplicate suppression", () => {
  // W1 persists the tranid at the recovery boundary instead of at completion.
  // The suppression rules key on the SO ID and the status -- never on the
  // tranid -- so an earlier display identifier cannot move any decision.
  for (const a of SPACE) {
    for (const tranid of [null, "SO2736"]) {
      const withTranid = { ...a, netsuiteSoTranid: tranid };
      assert.equal(
        mustNotCreate(a),
        mustNotCreate(withTranid as typeof a),
        `tranid moved mustNotCreate: ${JSON.stringify(withTranid)}`,
      );
      assert.equal(
        isResumable(a),
        isResumable(withTranid as typeof a),
        `tranid moved isResumable: ${JSON.stringify(withTranid)}`,
      );
    }
  }
});

test("C3 · ownsSnapshot is unchanged — only failed+validation releases", () => {
  for (const status of ALL_STATES) {
    for (const errorClass of [null, "validation", "verification", "duplicate_deal"]) {
      const expected = !(status === "failed" && errorClass === "validation");
      assert.equal(ownsSnapshot({ status, errorClass }), expected, `${status}/${errorClass}`);
    }
  }
});

test("C3 · the SO id is persisted BEFORE any tranid lookup", () => {
  // ORDERING, and a correction to this repair's own first attempt.
  //
  // The first version fetched the tranid BEFORE `recordSalesOrderCreated`, so
  // a process death during the GET would have left a created Sales Order whose
  // internal id was never persisted -- unreachable by any retry, which the code
  // itself calls the one thing worse than a failed create. A diagnostic lookup
  // had been moved ahead of the recovery key.
  const src = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  const created = src.indexOf("await recordSalesOrderCreated({");
  const tranid = src.indexOf("const boundaryTranid = await netsuite.fetchSalesOrderTranid");
  assert.ok(created > 0, "the boundary write must exist");
  assert.ok(tranid > 0, "the boundary tranid fetch must exist");
  assert.ok(
    created < tranid,
    "the SO id must be persisted before any tranid lookup is attempted",
  );
});

test("C3 · the boundary tranid lookup cannot fail the create", () => {
  // Non-blocking is the load-bearing property: an inability to read the display
  // identifier must never turn a valid awaiting_rates recovery into a failed
  // CREATE, and must never unwind the id just saved.
  const src = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  const start = src.indexOf("const boundaryTranid = await netsuite.fetchSalesOrderTranid");
  // Bounded to the enclosing try/catch. A first version sliced to the next
  // "STEP 2" occurrence, 12,000 characters away, and swept in unrelated code
  // that legitimately throws -- an assertion that big is not about the thing
  // it names.
  const end = src.indexOf("} // end CREATE branch", start);
  assert.ok(end > start, "the CREATE branch terminator must follow the fetch");
  const block = src
    .slice(start, end)
    // Strip comments: an earlier version asserted `doesNotMatch(/throw/)`
    // against raw source and matched the word inside this repair's own prose.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(block, /throw/, "a failed lookup must not propagate");
});

test("C3 · the completion fetch is a backfill that cannot erase the boundary value", () => {
  // The old code assigned null on failure unconditionally. After the repair
  // that would DISCARD a tranid the boundary had already captured.
  const src = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  assert.match(src, /if \(salesOrderTranid === null\) \{\s*\n\s*const fresh = await netsuite\.fetchSalesOrderTranid/);
});
