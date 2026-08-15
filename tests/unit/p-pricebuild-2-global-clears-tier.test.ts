/**
 * P-PriceBuild-2 · a new global adjustment clears existing tier overrides.
 *
 * THE DEFECT WAS AN AUTHORITY MODEL, NOT ARITHMETIC. Precedence is
 * `tier ?? global`, so a tier carrying its own rate ignores the quote-wide one.
 * On the live walk quote every tier held a legacy Setup-origin rate, so the
 * operator applied 300%, saw `3.0000` persisted and "currently 300%" displayed,
 * and it moved nothing — 0.2911 and 0.1115 were in force instead.
 *
 * Traced end to end first: persisted 3.0 (correct decimal fraction), engine
 * consumes the same representation ($10 base + 0.1 → $11.00, + 3.0 → $40.00),
 * resolved rate 0.1115, adjustment node 0.4881, terminal 4.8654, PDF 4.8654.
 * Every boundary agreed. Two pricing authorities were live and the newer one
 * silently lost, which explanatory copy would have documented rather than
 * fixed.
 *
 * These test the PLAN, which is where the decision lives and is pure.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { planApply } from "../../src/lib/pricing-apply-plan.ts";

const NONE = new Map<string, string>();

function plan(over: {
  intendedTierAdj?: Map<string, string>;
  persistedTierAdj?: Map<string, string>;
  globalAdjFrom?: string;
  globalAdjTo?: string;
}) {
  return planApply({
    intendedLifts: NONE,
    intendedOverrides: NONE,
    persistedLifts: NONE,
    persistedOverrides: NONE,
    intendedTierAdj: over.intendedTierAdj ?? NONE,
    persistedTierAdj: over.persistedTierAdj ?? NONE,
    globalAdjFrom: over.globalAdjFrom ?? "0.0000",
    globalAdjTo: over.globalAdjTo ?? "0.0000",
  });
}

const legacy = () =>
  new Map([["t1", "0.2911"], ["t2", "0.1115"], ["t3", "0.1115"], ["t4", "0.1115"]]);

test("applying a global rate clears every stale tier override", () => {
  // Intended SEEDED FROM PERSISTED, as the staging context does. With an empty
  // intended map the normal diff already removes everything, so this test
  // passed with the rule deleted — vacuous, and only the falsification showed
  // it. Seeded, the removal can come from nothing but the sweep.
  const p = plan({
    persistedTierAdj: legacy(),
    intendedTierAdj: legacy(),
    globalAdjTo: "3.0000",
  });
  assert.deepEqual(p.tierAdjRemoved.map((c) => c.key).sort(), ["t1", "t2", "t3", "t4"]);
  assert.equal(p.globalAdj?.to, "3.0000");
  // Each removal carries the value it displaced, so the audit records what the
  // quote was priced at before the global took over.
  assert.deepEqual(
    p.tierAdjRemoved.find((c) => c.key === "t1"),
    { key: "t1", from: "0.2911" },
  );
});

test("a tier override set in the SAME apply survives", () => {
  // The operator asked for both in one gesture; that exception is deliberate.
  // Clearing it would make "global 20% and hold Tier 2 at 5%" impossible to
  // express in a single action.
  const seeded = legacy();
  seeded.set("t2", "0.0500"); // the one the operator changed in this apply
  const p = plan({
    persistedTierAdj: legacy(),
    intendedTierAdj: seeded,
    globalAdjTo: "0.2000",
  });
  assert.deepEqual(p.tierAdjSet, [{ key: "t2", from: "0.1115", to: "0.0500" }]);
  assert.deepEqual(p.tierAdjRemoved.map((c) => c.key).sort(), ["t1", "t3", "t4"]);
});

test("NOT applying a global leaves tier overrides alone", () => {
  // The clearing is a consequence of stating a quote-wide rate. An apply that
  // only stages a lift or an override must not silently reprice every tier.
  //
  // Intended is seeded from persisted — the working set is the COMPLETE
  // intended state, so an EMPTY intended map already means "remove all" and
  // would have proved nothing about this rule.
  const p = plan({ persistedTierAdj: legacy(), intendedTierAdj: legacy() });
  assert.deepEqual(p.tierAdjRemoved, []);
  assert.equal(p.globalAdj, null);
  assert.equal(p.changeCount, 0);
});

test("a global that does not MOVE is not an apply of a global", () => {
  // Re-submitting the same rate must not clear overrides — the operator changed
  // nothing about the quote-wide authority, so the exceptions stand.
  const p = plan({
    persistedTierAdj: legacy(),
    intendedTierAdj: legacy(),
    globalAdjFrom: "0.1000",
    globalAdjTo: "0.1000",
  });
  assert.equal(p.globalAdj, null);
  assert.deepEqual(p.tierAdjRemoved, []);
});

test("clearing is counted as change, so the apply is not treated as a no-op", () => {
  // `changeCount === 0` short-circuits before any write. If the removals were
  // not counted, a global whose only effect was to clear overrides would be
  // discarded — the exact defect, re-created one layer down.
  const p = plan({
    persistedTierAdj: legacy(),
    intendedTierAdj: legacy(),
    globalAdjTo: "0.2000",
  });
  assert.equal(p.changeCount, 5, "four removals plus the global itself");
});

test("an override the operator already cleared is not removed twice", () => {
  // t2 was cleared by hand, so the diff already lists it. The sweep then clears
  // t1 as well — it is carried unchanged from persisted state, which makes it
  // stale rather than a deliberate exception. Only a value CHANGED in this
  // apply counts as deliberate.
  const p = plan({
    persistedTierAdj: new Map([["t1", "0.2911"], ["t2", "0.1115"]]),
    intendedTierAdj: new Map([["t1", "0.2911"]]),
    globalAdjTo: "0.2000",
  });
  const keys = p.tierAdjRemoved.map((c) => c.key);
  assert.deepEqual(keys.sort(), ["t1", "t2"]);
  assert.equal(new Set(keys).size, keys.length, "no duplicate removals");
});

test("with no tier overrides at all, a global apply is unchanged", () => {
  const p = plan({ globalAdjTo: "0.1000" });
  assert.deepEqual(p.tierAdjRemoved, []);
  assert.equal(p.changeCount, 1);
});
