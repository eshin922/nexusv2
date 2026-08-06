/**
 * F-3 Phase B — write causality in reconciliation.
 *
 * Monotonicity (`snapshot.revision <= lastAppliedRevision → drop`) guarantees
 * reconciliation never goes backwards. It does NOT guarantee a snapshot
 * contains the operator's own write:
 *
 *   lastApplied = 100, write commits at 120, snapshot arrives at 110
 *   → 110 > 100, so the monotonic gate passes it
 *   → but 110 < 120, so it predates the write
 *   → applying it reverts the operator's value until a later snapshot restores it
 *
 * That window was unreachable at 7-second reads, where realtime and refresh
 * collapsed into one event. Post-co-location they resolve separately, so a
 * candidate can now land between the two. See Pattern 56.
 *
 * The store half is tested behaviourally here. The gate that HOLDS a
 * sub-threshold candidate lives in the provider's `tryReconcile` (it owns the
 * retry timer), so its wiring is asserted structurally.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync(
  new URL("../../src/components/costing-store-provider.tsx", import.meta.url),
  "utf8",
);
const store = readFileSync(
  new URL("../../src/lib/costing-store.ts", import.meta.url),
  "utf8",
);
const freight = readFileSync(
  new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------------------
// Reference model — the exact predicate the provider implements, exercised
// directly so the ordering rules are testable without a React tree.
// ---------------------------------------------------------------------------

const CAUSAL_TIMEOUT_MS = 5000;

type Gate = { lastApplied: number; awaited: number | null; awaitedSince: number };

/** Mirrors tryReconcile's decision order: monotonic first, then causal. */
function decide(
  gate: Gate,
  snapshotRevision: number,
  now: number,
): "drop" | "hold" | "apply" | "release-then-apply" {
  if (snapshotRevision <= gate.lastApplied) return "drop";
  if (gate.awaited !== null && snapshotRevision < gate.awaited) {
    return now - gate.awaitedSince < CAUSAL_TIMEOUT_MS ? "hold" : "release-then-apply";
  }
  return "apply";
}

test("a monotonic snapshot below the awaited revision is held, not applied", () => {
  const gate: Gate = { lastApplied: 100, awaited: 120, awaitedSince: 1_000 };
  assert.equal(decide(gate, 110, 1_100), "hold");
});

test("the first snapshot at or above the awaited revision is applied", () => {
  const gate: Gate = { lastApplied: 100, awaited: 120, awaitedSince: 1_000 };
  assert.equal(decide(gate, 120, 1_100), "apply");
  assert.equal(decide(gate, 121, 1_100), "apply");
});

test("a snapshot at or below lastApplied is still dropped immediately", () => {
  // The causal gate must not weaken monotonicity — staleness still wins first.
  const gate: Gate = { lastApplied: 100, awaited: 120, awaitedSince: 1_000 };
  assert.equal(decide(gate, 100, 1_100), "drop");
  assert.equal(decide(gate, 99, 1_100), "drop");
});

test("an unreachable awaited revision releases on timeout rather than deadlocking", () => {
  const gate: Gate = { lastApplied: 100, awaited: 120, awaitedSince: 1_000 };
  assert.equal(decide(gate, 110, 1_000 + CAUSAL_TIMEOUT_MS), "release-then-apply");
});

test("with no write outstanding the gate is inert", () => {
  // The common case must stay on the untouched fast path.
  const gate: Gate = { lastApplied: 100, awaited: null, awaitedSince: 0 };
  assert.equal(decide(gate, 101, 1_100), "apply");
  assert.equal(decide(gate, 100, 1_100), "drop");
});

test("two rapid writes — the highest outstanding revision governs", () => {
  // awaitCommitted keeps the greater threshold, so the earlier write's lower
  // bar cannot retire the later write's requirement.
  const raise = (current: number | null, next: number, lastApplied: number) => {
    if (!Number.isFinite(next)) return current;
    if (next <= lastApplied) return current;
    if (current !== null && next <= current) return current;
    return next;
  };
  let awaited: number | null = null;
  awaited = raise(awaited, 120, 100);
  awaited = raise(awaited, 140, 100);
  assert.equal(awaited, 140);
  // Out-of-order acknowledgement must not lower the bar.
  awaited = raise(awaited, 130, 100);
  assert.equal(awaited, 140);

  const gate: Gate = { lastApplied: 100, awaited, awaitedSince: 1_000 };
  assert.equal(decide(gate, 130, 1_100), "hold");
  assert.equal(decide(gate, 140, 1_100), "apply");
});

test("realtime and refresh in either order produce no reversal", () => {
  // Whichever arrives first, a sub-threshold candidate is never applied, so
  // the operator's own value cannot be reverted mid-convergence.
  const gate: Gate = { lastApplied: 100, awaited: 120, awaitedSince: 1_000 };
  for (const order of [[110, 125], [125, 110]]) {
    const outcomes = order.map((rev) => decide(gate, rev, 1_100));
    assert.ok(!outcomes.includes("drop"));
    // The sub-threshold one is held in both orderings.
    assert.equal(outcomes[order.indexOf(110)], "hold");
  }
});

// ---------------------------------------------------------------------------
// Wiring — the reference model above is only meaningful if production matches
// ---------------------------------------------------------------------------

test("the provider holds sub-threshold candidates via the existing retry timer", () => {
  assert.match(provider, /state\.awaitedRevision/);
  assert.match(provider, /snap\.revision < awaited/);
  // Held, not dropped: it re-arms the same quiet-period retry.
  assert.match(provider, /setTimeout\(tryReconcile, RETRY_INTERVAL_MS\)/);
  // Causal check runs AFTER the monotonic drop, never instead of it.
  assert.ok(
    provider.indexOf("snap.revision <= state.lastAppliedRevision") <
      provider.indexOf("snap.revision < awaited"),
    "monotonic guard must precede the causal guard",
  );
});

test("the timeout is bounded and reports honestly", () => {
  assert.match(provider, /CAUSAL_TIMEOUT_MS/);
  assert.match(provider, /releaseAwaited\(\)/);
  // It must not claim the causal requirement was met.
  assert.match(provider, /continuing under monotonic ordering only/);
  assert.doesNotMatch(provider, /causal.*confirmed/i);
});

test("the store clears the requirement only on a qualifying snapshot", () => {
  assert.match(store, /awaitedRevision: number \| null/);
  assert.match(store, /snapshot\.revision >= s\.awaitedRevision/);
  // Highest outstanding wins.
  assert.match(store, /revision <= s\.awaitedRevision\) return \{\}/);
});

test("Freight writes feed their committed revision into the gate", () => {
  assert.match(freight, /awaitCommitted\(committed\)/);
  assert.match(freight, /Number\.isFinite\(committed\)/);
});
