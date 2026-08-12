// V1 handoff/retry correctness — a closed attempt must not own the snapshot's
// future retry payload.
//
// THE DEFECT. The durable-payload selector matched on (quote, snapshot,
// payload IS NOT NULL) and took the OLDEST row. `status` was not a predicate.
// So a terminal validation rejection permanently pinned its own invalid body:
// every later retry replayed the known-bad payload, and no code repair could
// ever reach NetSuite. Found when the Class repair could not take effect on the
// Case B retry — the frozen payload still carried class:{"id":"3"}.
//
// THE RULE. Only `failed + validation` is released, because only that state is
// conclusively terminal AND measured side-effect-free. Everything else still
// pins, because its outcome is not conclusively known.
//
// The predicate lives in TWO places that must agree — the selector in
// mark-complete.ts and the partial unique index (migration 0065). An attempt
// that stops pinning the payload must also release the snapshot, or the
// re-elected attempt has nowhere to be written.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0065_durable_attempt_lifecycle.sql", "utf8");

// The rule, as a function — mirrors the SQL predicate exactly.
// A row is ELECTABLE (pins the payload, holds the snapshot) unless it is a
// terminal validation failure.
type Attempt = { status: string; errorClass: string | null };
const pins = (a: Attempt): boolean =>
  !(a.status === "failed" && a.errorClass === "validation");

test("1 · pending / in-flight attempt still pins — a later caller reuses it", () => {
  assert.equal(pins({ status: "pending", errorClass: null }), true);
  // This is the concurrency guarantee: a second caller arriving mid-flight
  // must replay the winner's payload, never build its own.
  assert.match(
    markComplete,
    /payload = durableAttempt\.payloadSnapshot as Record<string, unknown>/,
    "the loser replays the elected payload",
  );
});

test("2 · a succeeded attempt stays pinned and immutable", () => {
  assert.equal(pins({ status: "succeeded", errorClass: null }), true);
  // Belt and braces: success is also unique per quote AND per snapshot.
  assert.match(schema, /netsuite_so_pushes_success_unique_idx[\s\S]*?status = 'succeeded'/);
  assert.match(
    schema,
    /netsuite_so_pushes_snapshot_success_unique_idx[\s\S]*?status = 'succeeded' AND quote_snapshot_id IS NOT NULL/,
  );
});

test("3 · outcome-unknown failures CANNOT generate a different payload", () => {
  // The whole reason this is not a blanket `status <> 'failed'`. Each of these
  // may have created a Sales Order we never heard about; re-electing a
  // different payload could produce a second, materially different order.
  for (const errorClass of ["server", "network", "unknown", "rate_limit", "auth", "forbidden", "not_found", null]) {
    assert.equal(
      pins({ status: "failed", errorClass }),
      true,
      `failed+${String(errorClass)} must keep pinning`,
    );
  }
});

test("4 · deterministic validation rejection is preserved but does NOT pin", () => {
  assert.equal(pins({ status: "failed", errorClass: "validation" }), false);
  // "Does not pin" is about ELECTION, not deletion. Nothing in the repair
  // removes or rewrites the row — see test 6.
});

test("5 · the next attempt after a terminal validation failure builds fresh", () => {
  // With the only prior attempt excluded, election finds nothing and the
  // caller falls back to the payload built from CURRENT code.
  const priorAttempts: Attempt[] = [{ status: "failed", errorClass: "validation" }];
  const elected = priorAttempts.filter(pins);
  assert.equal(elected.length, 0, "nothing elected");
  assert.match(
    markComplete,
    /durableAttempt\?\.payloadSnapshot \?\? builtPayloadWithPlan/,
    "falls back to the freshly built payload",
  );
});

test("6 · historical attempt rows are never cleared or rewritten", () => {
  // The repair is a SELECT predicate plus an index predicate. No DELETE, no
  // payload overwrite. Deleting the row would have made the fixture pass by
  // removing evidence instead of repairing retry semantics.
  assert.doesNotMatch(migration, /\bDELETE\b/i);
  assert.doesNotMatch(migration, /\bUPDATE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.match(migration, /DROP INDEX IF EXISTS "netsuite_so_pushes_snapshot_attempt_unique_idx"/);
  // mark-complete must never overwrite a stored payload_snapshot.
  assert.doesNotMatch(markComplete, /set\(\{[^}]*payloadSnapshot:[^}]*\}\)/s);
});

test("7 · CLASS-REPAIR SCENARIO — new attempt carries no class though the old row does", () => {
  // Reconstructs Walk 1 exactly: one failed+validation row whose frozen body
  // still contains the pre-repair class.
  const walk1 = {
    status: "failed",
    errorClass: "validation",
    payloadSnapshot: { class: { id: "3" }, cseg_dps_bus_seg: { id: "3" }, entity: { id: "72173" } },
  };
  assert.deepEqual(walk1.payloadSnapshot.class, { id: "3" }, "the old row does carry class");

  const elected = [walk1].filter(pins);
  assert.equal(elected.length, 0, "it is not elected");

  // So the payload actually sent is built by current code, which cannot emit
  // class at all — proven exhaustively in netsuite-class-item-authority.test.ts.
  const sales = readFileSync("src/lib/netsuite/sales-orders.ts", "utf8");
  assert.doesNotMatch(sales, /body\.class\s*=/);

  // Under the OLD selector the same row WAS elected — the defect, stated.
  const oldSelector = (rows: Array<{ payloadSnapshot: unknown }>) => rows[0];
  assert.deepEqual(
    (oldSelector([walk1]).payloadSnapshot as { class: unknown }).class,
    { id: "3" },
    "the old selector replayed the invalid body",
  );
});

test("8 · concurrency and idempotency guarantees are intact", () => {
  // Idempotency key is still derived from (quote, snapshot) — unchanged, so a
  // retry cannot become a second distinct CREATE at the provider.
  assert.match(markComplete, /computeIdempotencyKey\(quoteId, acceptedSnapshotId\)/);
  // Prior-success convergence still runs before any create.
  assert.match(markComplete, /retryOutcome = "converged_from_prior_success"/);
  // Exactly one LIVE attempt per snapshot is still enforced.
  assert.match(
    schema,
    /netsuite_so_pushes_snapshot_attempt_unique_idx[\s\S]*?quote_snapshot_id IS NOT NULL AND NOT \(status = 'failed' AND error_class = 'validation'\)/,
  );
});

test("9 · selector and index state the SAME predicate", () => {
  // One rule expressed twice. If these drift, an attempt could stop pinning
  // the payload while still occupying the snapshot — the re-elected attempt
  // would then have nowhere to be written.
  const inSelector =
    /NOT \(\$\{netsuiteSoPushes\.status\} = 'failed' AND \$\{netsuiteSoPushes\.errorClass\} = 'validation'\)/;
  assert.match(markComplete, inSelector);
  assert.match(schema, /NOT \(status = 'failed' AND error_class = 'validation'\)/);
  assert.match(migration, /NOT \(status = 'failed' AND error_class = 'validation'\)/);
});

test("10 · FALSIFICATION — the old selector against every attempt state", () => {
  // The old rule ignored status entirely: everything with a payload pinned.
  const oldPins = (_a: Attempt) => true;
  const states: Attempt[] = [
    { status: "pending", errorClass: null },
    { status: "succeeded", errorClass: null },
    { status: "failed", errorClass: "server" },
    { status: "failed", errorClass: "network" },
    { status: "failed", errorClass: "validation" },
  ];
  // Old and new agree everywhere EXCEPT the one state with measured evidence.
  const divergent = states.filter((s) => oldPins(s) !== pins(s));
  assert.equal(divergent.length, 1, "exactly one state changes behaviour");
  assert.deepEqual(divergent[0], { status: "failed", errorClass: "validation" });
});
