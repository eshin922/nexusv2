import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makeCostingStore, type HydrateSnapshot } from "../../src/lib/costing-store.ts";

// ============================================================================
// Costs reconciliation ordering (shared invariant)
// ============================================================================
//
// **A server snapshot generated before a newer operator edit must never
// overwrite that newer client state.**
//
// Reconciliation previously had no ordering guarantee. The provider cancelled
// a pending *timer*, but each scheduled call had already captured its own
// snapshot in closure, so whichever was scheduled last won by arrival order
// rather than freshness. A render that predated an operator's save could land
// after it and replace the whole slice — Packaging values disappearing after a
// tab-out, one returning later as a fresher snapshot arrived, and collapse and
// reopen restoring them because the remount re-derived from current state.
//
// These are behavioural: they drive the real store rather than reading source.

const EMPTY_COSTING = {
  tiers: [],
  skuRollups: [],
  quoteRollup: [],
} as unknown as HydrateSnapshot["costing"];

function snapshot(revision: number, unitCost: string): HydrateSnapshot {
  return {
    revision,
    quoteId: "q1",
    projectId: "p1",
    globalPriceAdjPct: 0,
    targetMarginPct: null,
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [],
    tiers: [],
    packaging: [
      { rowId: "r1", unitCost } as unknown as HydrateSnapshot["packaging"][number],
    ],
    production: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    freightCustomerArrangesMeta: [],
    cellOverrides: [],
    cellTargets: [],
    costing: EMPTY_COSTING,
    persistedWarnings: [],
  } as unknown as HydrateSnapshot;
}

const cost = (store: ReturnType<typeof makeCostingStore>) =>
  (store.getState().packaging[0] as unknown as { unitCost: string }).unitCost;

test("an older snapshot arriving last cannot overwrite newer values", () => {
  const store = makeCostingStore(snapshot(1_000, "1.00"));
  store.getState().reconcile(snapshot(2_000, "2.00"));
  assert.equal(cost(store), "2.00", "the newer snapshot applies");

  // The out-of-order arrival: a render generated BEFORE the one already
  // applied lands afterwards. This is the reported Packaging failure.
  store.getState().reconcile(snapshot(1_500, "STALE"));
  assert.equal(cost(store), "2.00", "a stale snapshot must be discarded");
  assert.equal(store.getState().lastAppliedRevision, 2_000);
});

test("a newer snapshot still reconciles successfully", () => {
  const store = makeCostingStore(snapshot(1_000, "1.00"));
  store.getState().reconcile(snapshot(1_001, "1.01"));
  assert.equal(cost(store), "1.01");
  assert.equal(store.getState().lastAppliedRevision, 1_001);
});

test("out-of-order delivery converges to the same state as in-order delivery", () => {
  const revisions: Array<[number, string]> = [
    [1_000, "a"],
    [2_000, "b"],
    [3_000, "c"],
  ];
  const inOrder = makeCostingStore(snapshot(500, "seed"));
  for (const [r, v] of revisions) inOrder.getState().reconcile(snapshot(r, v));

  const shuffled = makeCostingStore(snapshot(500, "seed"));
  for (const [r, v] of [revisions[2], revisions[0], revisions[1]]) {
    shuffled.getState().reconcile(snapshot(r, v));
  }

  assert.equal(cost(shuffled), cost(inOrder), "final state must not depend on arrival order");
  assert.equal(shuffled.getState().lastAppliedRevision, inOrder.getState().lastAppliedRevision);
  assert.equal(cost(shuffled), "c", "the newest revision wins regardless of order");
});

test("an equal revision is rejected, not re-applied", () => {
  // Two renders stamped in the same millisecond carry the same data, so
  // re-applying can only risk clobbering an optimistic edit made in between.
  const store = makeCostingStore(snapshot(1_000, "1.00"));
  store.getState().reconcile(snapshot(2_000, "2.00"));
  store.getState().updatePackagingCell("r1", { unitCost: 9.99 } as never);
  store.getState().reconcile(snapshot(2_000, "2.00"));
  assert.equal(
    (store.getState().packaging[0] as unknown as { unitCost: number }).unitCost,
    9.99,
    "an optimistic edit survives a same-revision snapshot",
  );
});

test("rapid edits across several cells remain visible against a stale snapshot", () => {
  // The reported sequence: several tier values entered, then a tab-out, then
  // the values vanish. Recovery required collapsing and reopening the section.
  const store = makeCostingStore(snapshot(1_000, "1.00"));
  store.getState().reconcile(snapshot(5_000, "5.00"));
  store.getState().updatePackagingCell("r1", { unitCost: 7.77 } as never);

  // Refresh amplification put several renders in flight at once; the losers
  // arrive afterwards carrying pre-save data.
  for (const stale of [2_000, 3_000, 4_000, 4_999]) {
    store.getState().reconcile(snapshot(stale, "0.00"));
  }

  assert.equal(
    (store.getState().packaging[0] as unknown as { unitCost: number }).unitCost,
    7.77,
    "entered values must stay visible without collapse/reopen",
  );
});

test("every Costs slice is protected, not only Packaging", async () => {
  // Production and Freight reconcile through the same guard: the store either
  // applies a whole snapshot or none of it, so no slice can be updated by a
  // stale render while another is protected.
  const store = await readFile(
    new URL("../../src/lib/costing-store.ts", import.meta.url),
    "utf8",
  );
  const start = store.indexOf("    reconcile: (snapshot) =>");
  assert.ok(start >= 0, "reconcile not found");
  const body = store.slice(start, store.indexOf("\n    update", start));
  assert.match(
    body,
    /if \(snapshot\.revision <= s\.lastAppliedRevision\) return \{\};/,
    "the guard must precede every slice assignment",
  );
  for (const slice of ["packaging", "production", "freightLegGroups", "freightLegs", "cellOverrides"]) {
    assert.ok(body.includes(`${slice}: snapshot.${slice}`), `${slice} must reconcile behind the guard`);
  }
});

test("freshness authority is server-stamped and lastReconcileAt is gone", async () => {
  const [action, store, provider] = await Promise.all([
    readFile(new URL("../../src/app/actions/costing.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/costing-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/costing-store-provider.tsx", import.meta.url), "utf8"),
  ]);
  // Stamped once, server-side, where every snapshot is built — so all
  // snapshots a client can receive share one clock domain.
  assert.match(action, /revision: Date\.now\(\)/);
  // The client never mints a revision.
  assert.ok(!/revision:\s*Date\.now\(\)/.test(provider), "the client must not stamp revisions");
  // Removed, not merely unused: a client-clock timestamp cannot order server
  // renders, so it could never have been the authority.
  const remaining = store.match(/lastReconcileAt/g) ?? [];
  assert.equal(remaining.length, 1, "only the explanatory comment may mention it");
  assert.match(store, /Replaces `lastReconcileAt`/);
  // The provider must not treat timer cancellation as a freshness guarantee.
  assert.match(provider, /snap\.revision <= state\.lastAppliedRevision/);
});
