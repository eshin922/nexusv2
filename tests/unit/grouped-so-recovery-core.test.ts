// Grouped-SO push — Step 1 recovery core.
//
// Design: docs/validation/od-004-grouped-so-recovery-contract.md
//
// The state this protects against:
//
//   Sales Order created -> groups expanded -> member-rate PATCHes incomplete
//
// A real SO exists, members may still be $0.00, the duplicate-deal SuiteScript
// forbids a second CREATE, and a crash can precede any final assertion.
//
// THE INVARIANT under test:
//   once netsuite_so_id is non-null, the attempt may NEVER become 'failed'.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// Imports the PURE rules module — no `server-only`, no database client — so
// the decisions that govern "may this attempt create an order?" are provable
// without a live DB. The write module re-exports these same functions.
import {
  awaitingRatesOperatorMessage,
  failureStatusFor,
  isResumable,
  mustNotCreate,
  ownsSnapshot as ownsSnapshotRule,
} from "../../src/lib/netsuite/attempt-lifecycle-rules.ts";

const lifecycle = readFileSync("src/lib/netsuite/attempt-lifecycle.ts", "utf8");
const rules = readFileSync("src/lib/netsuite/attempt-lifecycle-rules.ts", "utf8");
const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
const client = readFileSync("src/lib/netsuite/client.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const tab = readFileSync("src/components/quote-umbrella/tab-sales-order.tsx", "utf8");

// The index/selector predicate shared by migration 0065. `awaiting_rates`
// must SATISFY it so the row keeps owning the snapshot.
const ownsSnapshot = (status: string, errorClass: string | null) =>
  ownsSnapshotRule({ status, errorClass });

test("1 · crash right after CREATE, before any PATCH → SO id persists, retry issues no CREATE", () => {
  // The recovery boundary: identity is written BEFORE anything else can fail.
  const boundary = markComplete.indexOf("*** THE RECOVERY BOUNDARY ***");
  const createCall = markComplete.indexOf("await netsuite.createSalesOrder(");
  const tranidFetch = markComplete.indexOf("post-create tranid fetch");
  assert.ok(boundary > createCall, "boundary is after CREATE");
  assert.ok(boundary < tranidFetch, "boundary is BEFORE the tranid fetch");
  assert.match(markComplete, /await recordSalesOrderCreated\(\{/);

  // A row in that state refuses CREATE on the next invocation.
  const crashed = { status: "awaiting_rates", netsuiteSoId: "361141" };
  assert.equal(mustNotCreate(crashed), true);
  assert.equal(isResumable(crashed), true);
});

test("2 · crash after SOME future member PATCHes → still resumable against the same SO", () => {
  // Step 2 will patch member rates; a partial sequence must not change the
  // recovery state. Any post-CREATE error routes to awaiting_rates, so the
  // row looks identical whether zero or N-1 patches landed.
  const partial = { status: "awaiting_rates", netsuiteSoId: "361141" };
  assert.equal(isResumable(partial), true);
  assert.equal(mustNotCreate(partial), true);
  assert.deepEqual(failureStatusFor(partial), {
    status: "awaiting_rates",
    terminal: false,
  });
});

test("3 · an attempt with an SO id cannot be marked failed — any error class", () => {
  // The invariant, at the only place that can write `failed`.
  for (const errorClass of ["validation", "server", "network", "unknown", "rate_limit"]) {
    // recordAttemptFailure branches on SO-id presence, NOT on error class and
    // NOT on caller intent.
    assert.deepEqual(
      failureStatusFor({ status: "awaiting_rates", netsuiteSoId: "361141" }),
      { status: "awaiting_rates", terminal: false },
      `post-CREATE ${errorClass} never yields failed`,
    );
  }
  // And `failed` is only reachable in the non-postCreate arm.
  const postCreateArm = lifecycle.slice(
    lifecycle.indexOf("if (postCreate) {"),
    lifecycle.indexOf("return { terminal: false"),
  );
  assert.doesNotMatch(postCreateArm, /status: "failed"/);
});

test("4 · retry of awaiting_rates cannot insert a second attempt row", () => {
  // awaiting_rates satisfies the 0065 index predicate, so the unique index on
  // quote_snapshot_id still binds and a second row for the snapshot is
  // rejected by the database.
  assert.equal(ownsSnapshot("awaiting_rates", null), true);
  assert.equal(ownsSnapshot("awaiting_rates", "server"), true);
  assert.equal(ownsSnapshot("pending", null), true);
  assert.equal(ownsSnapshot("succeeded", null), true);
  assert.match(
    schema,
    /netsuite_so_pushes_snapshot_attempt_unique_idx[\s\S]*?NOT \(status = 'failed' AND error_class = 'validation'\)/,
  );
});

test("5 · retry of awaiting_rates cannot invoke Sales Order CREATE", () => {
  assert.equal(mustNotCreate({ status: "awaiting_rates", netsuiteSoId: "361141" }), true);
  // Guarded at the call site, and the guard is on id presence so a row
  // carrying an id under any status still cannot create.
  assert.match(
    markComplete,
    /if \(mustNotCreate\(\{ status: durableAttempt\?\.status \?\? "", netsuiteSoId: resumeSoId \}\)\) \{/,
  );
  const guardIdx = markComplete.indexOf("if (mustNotCreate({ status:");
  const createIdx = markComplete.indexOf("await netsuite.createSalesOrder(");
  assert.ok(guardIdx < createIdx, "the guard precedes the CREATE call");

  // The rule was widened from a test of KNOWLEDGE to a test of POSSIBILITY when
  // the provider header was measured not to be honoured — an order can exist
  // without its id ever having been learned. Asserted behaviourally rather than
  // by pinning the literal expression, which is what this line used to do and
  // what broke when the rule correctly grew stronger.
  assert.equal(mustNotCreate({ status: "pending", netsuiteSoId: null }), false);
  assert.equal(
    mustNotCreate({ status: "needs_reconciliation", netsuiteSoId: null }),
    true,
    "an unresolved ambiguous outcome must also suppress CREATE",
  );
  assert.match(rules, /attempt\.netsuiteSoId !== null/);
});

test("6 · awaiting_rates → succeeded is permitted, and requires an SO id", () => {
  assert.match(lifecycle, /export async function recordAttemptSucceeded/);
  assert.match(lifecycle, /status: "succeeded"/);
  assert.match(
    lifecycle,
    /refusing to mark an attempt succeeded without a NetSuite Sales Order id/,
    "succeeded without an order is not representable",
  );
});

test("7 · FALSIFICATION — the old handler would release the snapshot and permit a duplicate", () => {
  // Reconstruct what the pre-Step-1 handler did on ANY create-path error:
  // set status='failed' + error_class, unconditionally.
  const oldHandler = (errorClass: string) => ({ status: "failed", errorClass });

  // A post-CREATE validation error under the old handler:
  const poisoned = oldHandler("validation");
  assert.equal(
    ownsSnapshot(poisoned.status, poisoned.errorClass),
    false,
    "failed+validation RELEASES snapshot ownership",
  );
  // Released ownership means: excluded from the durable-payload selector AND
  // from the unique index -> a retry inserts a NEW attempt row -> a SECOND
  // CREATE is attempted against a deal that already has an order.
  // Only the duplicate-deal SuiteScript would stop it, surfacing as
  // DUPLICATED DEAL with the real SO id orphaned.

  // Under Step 1 the same error keeps ownership:
  assert.equal(ownsSnapshot("awaiting_rates", "validation"), true);

  // And `failed + so_id` is unreachable by construction.
  const postCreateArm = lifecycle.slice(
    lifecycle.indexOf("if (postCreate) {"),
    lifecycle.indexOf("return { terminal: false"),
  );
  assert.doesNotMatch(postCreateArm, /status: "failed"/);
});

test("8 · pre-CREATE failed+validation semantics from 0065 are UNCHANGED", () => {
  // The release behaviour must survive exactly for genuine pre-CREATE
  // rejections — that is what let the Class repair reach NetSuite.
  assert.equal(ownsSnapshot("failed", "validation"), false, "still released");
  assert.equal(ownsSnapshot("failed", "server"), true, "still pinned");
  assert.equal(ownsSnapshot("failed", "network"), true, "still pinned");
  // recordAttemptFailure's pre-CREATE arm writes terminal failed + completedAt.
  const preCreateArm = lifecycle.slice(lifecycle.indexOf("return { terminal: false"));
  assert.match(preCreateArm, /status: "failed"/);
  assert.match(preCreateArm, /completedAt: new Date\(\)/);
  assert.match(preCreateArm, /return \{ terminal: true, status: "failed" \}/);
});

test("9 · patchSalesOrderLine uses the Probe 7d single-line shape", () => {
  assert.match(
    client,
    /\/record\/v1\/salesOrder\/\$\{encodeURIComponent\(soId\)\}\/item\/\$\{lineIdx\}/,
    "per-line endpoint",
  );
  assert.match(client, /method: "PATCH"/);

  // The body was `const body = { rate: patch.rate };` until the cost-projection
  // repair (2026-08-13) added the Accounting cost basis. The single-literal
  // assertion tracked the SYNTAX; what it existed to protect is that every key
  // reaching the wire is named literally in this function and none is derived
  // from caller-supplied structure.
  //
  // So this now enumerates the COMPLETE allowlist instead. That is stricter,
  // not looser: the old form could not have detected a fourth key being added
  // beside it, and this fails the moment one is.
  const fn = client
    .split("export async function patchSalesOrderLine")[1]
    .split("export async function")[0];
  const assigned = [...fn.matchAll(/\bbody\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(assigned)].sort(),
    [
      // NetSuite's "Unit Cost" column — the one Accounting reported blank.
      "custcol_dps_unit_cost",
      // NetSuite's "Est. Rate" column, plus the type that makes it authoritative.
      "costEstimateRate",
      "costEstimateType",
      "rate",
    ].sort(),
    "exactly the four governed scalar keys — nothing else may be written",
  );
  // Never assembled from the argument object.
  assert.doesNotMatch(fn, /\.\.\.patch/, "body is not spread from the argument");
  assert.doesNotMatch(fn, /Object\.assign/, "body is not merged from the argument");
});

test("10 · patchSalesOrderLine CANNOT perform a full-sublist PATCH", () => {
  // Hazard 1: full-sublist PATCH returns 204 and silently DUPLICATES the group
  // expansion. The narrow shape must be structural, not conventional.
  // Comments are stripped first: the function's own prose explains the hazard
  // it prevents (and names `item.items` while doing so). The assertion is
  // about reachable CODE, not about what the code says about itself.
  const fn = client
    .slice(
      client.indexOf("export async function patchSalesOrderLine"),
      client.indexOf("export async function createRecord"),
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(fn, /item\.items/, "no sublist collection");
  assert.doesNotMatch(fn, /\.\.\.patch/, "body is not spread from the argument");
  assert.doesNotMatch(fn, /items:/, "no items array can be constructed");
  // The URL always carries a line index — there is no record-level PATCH path.
  assert.doesNotMatch(
    fn,
    /salesOrder\/\$\{encodeURIComponent\(soId\)\}`/,
    "no record-level PATCH URL",
  );
  // lineIdx is validated, so an undefined index cannot silently build one.
  assert.match(fn, /Number\.isInteger\(lineIdx\)/);
});

test("11 · line indices are not persisted as durable authority", () => {
  // A stale index is how a 'safe' single-line PATCH writes the wrong line.
  assert.doesNotMatch(schema, /line_idx|lineIdx|line_index/i);
  assert.match(
    client,
    /MUST come from a fresh structural read-back/,
    "the contract is stated at the primitive",
  );
});

test("12 · operator surface states the resumable case truthfully and shows the tranid", () => {
  assert.equal(
    awaitingRatesOperatorMessage("SO2701"),
    "Sales Order SO2701 created · pricing completion pending · safe to retry",
  );
  assert.equal(
    awaitingRatesOperatorMessage(null),
    "Sales Order created · pricing completion pending · safe to retry",
  );
  // The surface must NOT reuse the failed copy — the order did reach NetSuite.
  assert.match(tab, /const isAwaitingRates =\s*soPushMirror\.pushStatus === "awaiting_rates"/);
  assert.match(tab, /pricing completion pending/);
  assert.match(tab, /retrying continues the same order rather than creating a second one/);
  // And it renders the tranid when known.
  assert.match(tab, /Sales Order \$\{soPushMirror\.soTranid\} created/);
});

test("13 · markComplete mirrors the resumable variant, not 'failed', when an SO exists", () => {
  assert.match(
    markComplete,
    /netsuiteSoPushStatus: resumeSoId \? "awaiting_rates" : "failed"/,
  );
  assert.match(
    markComplete,
    /netsuiteSoPushError: resumeSoId\s*\?\s*awaitingRatesOperatorMessage\(resumeSoTranid\)/,
  );
});

test("14 · a created SO whose identity cannot be persisted fails loudly", () => {
  // Worse than a failed create: an order no retry can ever find.
  assert.match(
    markComplete,
    /was created but its identity could not be persisted/,
  );
  assert.match(markComplete, /manual reconciliation required/);
});
