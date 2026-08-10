/**
 * What an Apply changes.
 *
 * Package 1's central claim is that a persisted adjustment behaves like a fact
 * about the quote rather than a fact about the session — that removing one is a
 * change, that re-applying an unchanged one is not, and that a reload does not
 * reset any of it. All three reduce to this diff being right, so it is a pure
 * function and tested as one, without a database.
 *
 * The property that keeps needing to be defended: THE SET IS COMPLETE. An
 * absent cell is a removal, not an omission. A delta-shaped call cannot express
 * "this is gone", and removal is exactly the change an operator most needs to
 * survive navigation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCellId,
  parseApplyCellId,
  planApply,
  sameStoredNumber,
} from "../../src/lib/pricing-apply-plan.ts";

const A = applyCellId("ql-A", "tier-1");
const B = applyCellId("ql-B", "tier-1");

const NOTHING = {
  intendedLifts: new Map<string, string>(),
  intendedOverrides: new Map<string, string>(),
  persistedLifts: new Map<string, string>(),
  persistedOverrides: new Map<string, string>(),
  globalAdjFrom: "0.0000",
  globalAdjTo: "0.0000",
};

// ── the empty case ────────────────────────────────────────────────────────

test("a quote with nothing, applying nothing, changes nothing", () => {
  const plan = planApply(NOTHING);
  assert.equal(plan.changeCount, 0);
  assert.equal(plan.globalAdj, null);
});

test("re-applying exactly what is already in effect is not a change", () => {
  // Without this the APPLIED bar would write a row and an audit entry every
  // time an operator pressed Apply, and tell them something happened.
  const plan = planApply({
    ...NOTHING,
    intendedLifts: new Map([[A, "0.0770"]]),
    persistedLifts: new Map([[A, "0.0770"]]),
  });
  assert.equal(plan.changeCount, 0);
});

test("stored numerics compare as numbers, not as text", () => {
  // `numeric` round-trips as a string, and `"0.077"` is the same lift as
  // `"0.0770"`. Text comparison would report a change on every single Apply.
  assert.ok(sameStoredNumber("0.0770", "0.077"));
  const plan = planApply({
    ...NOTHING,
    intendedLifts: new Map([[A, "0.077"]]),
    persistedLifts: new Map([[A, "0.0770"]]),
  });
  assert.equal(plan.changeCount, 0);
});

// ── setting, changing, removing ───────────────────────────────────────────

test("a lift on a cell that had none is a set, with a null from", () => {
  const plan = planApply({ ...NOTHING, intendedLifts: new Map([[A, "0.0770"]]) });
  assert.deepEqual(plan.liftsSet, [{ key: A, from: null, to: "0.0770" }]);
  assert.deepEqual(plan.liftsRemoved, []);
  assert.equal(plan.changeCount, 1);
});

test("replacing a lift is ONE change, not a removal plus a set", () => {
  const plan = planApply({
    ...NOTHING,
    intendedLifts: new Map([[A, "0.1200"]]),
    persistedLifts: new Map([[A, "0.0770"]]),
  });
  assert.equal(plan.changeCount, 1);
  assert.deepEqual(plan.liftsSet, [{ key: A, from: "0.0770", to: "0.1200" }]);
  assert.deepEqual(plan.liftsRemoved, []);
});

test("ABSENCE FROM THE INTENDED SET IS A REMOVAL", () => {
  // The whole reason the wire shape carries the end state rather than a delta.
  const plan = planApply({ ...NOTHING, persistedLifts: new Map([[A, "0.0770"]]) });
  assert.deepEqual(plan.liftsRemoved, [{ key: A, from: "0.0770" }]);
  assert.equal(plan.changeCount, 1);
});

test("removing one lift leaves its sibling alone", () => {
  const plan = planApply({
    ...NOTHING,
    intendedLifts: new Map([[B, "0.0500"]]),
    persistedLifts: new Map([
      [A, "0.0770"],
      [B, "0.0500"],
    ]),
  });
  assert.deepEqual(plan.liftsRemoved, [{ key: A, from: "0.0770" }]);
  assert.deepEqual(plan.liftsSet, []);
  assert.equal(plan.changeCount, 1);
});

test("return to baseline removes every lever at once", () => {
  const plan = planApply({
    ...NOTHING,
    persistedLifts: new Map([
      [A, "0.0770"],
      [B, "0.0500"],
    ]),
    persistedOverrides: new Map([[A, "12.5000"]]),
    globalAdjFrom: "0.1000",
    globalAdjTo: "0.0000",
  });
  assert.equal(plan.liftsRemoved.length, 2);
  assert.equal(plan.overridesRemoved.length, 1);
  assert.deepEqual(plan.globalAdj, { from: "0.1000", to: "0.0000" });
  assert.equal(plan.changeCount, 4);
});

// ── the two levers do not contaminate each other ──────────────────────────

test("a lift and a direct price on the same cell key are separate entries", () => {
  // They share an address and are mutually exclusive commercially, but the diff
  // is not where that is decided — the engine refuses the lift, and the action
  // refuses the combination before writing. Here they are simply two maps.
  const plan = planApply({
    ...NOTHING,
    intendedLifts: new Map([[A, "0.0770"]]),
    intendedOverrides: new Map([[A, "12.5000"]]),
  });
  assert.equal(plan.liftsSet.length, 1);
  assert.equal(plan.overridesSet.length, 1);
  assert.equal(plan.changeCount, 2);
});

test("an override the intended set cannot address is NOT removed", () => {
  // The caller passes only the canonically-addressable persisted overrides. One
  // on a junction with no canonical row never reaches this function, so it
  // cannot be diffed away. Asserted from the caller's side: what is absent from
  // `persistedOverrides` produces no removal.
  const plan = planApply({ ...NOTHING, intendedOverrides: new Map() });
  assert.deepEqual(plan.overridesRemoved, []);
  assert.equal(plan.changeCount, 0);
});

// ── the quote-wide adjustment ─────────────────────────────────────────────

test("the adjustment counts as exactly one change however far it moved", () => {
  const plan = planApply({ ...NOTHING, globalAdjFrom: "0.0000", globalAdjTo: "0.2500" });
  assert.equal(plan.changeCount, 1);
  assert.deepEqual(plan.globalAdj, { from: "0.0000", to: "0.2500" });
});

test("an adjustment that did not move is null, not a zero-width change", () => {
  const plan = planApply({ ...NOTHING, globalAdjFrom: "0.10", globalAdjTo: "0.1000" });
  assert.equal(plan.globalAdj, null);
});

// ── the address ───────────────────────────────────────────────────────────

test("the entity id round-trips", () => {
  const id = applyCellId("ql-A", "tier-1");
  assert.deepEqual(parseApplyCellId(id), { quoteLeafId: "ql-A", tierId: "tier-1" });
});

test("the durable address does NOT share the staging separator", () => {
  // `::` is a browser-session address; `:` is a durable one. A shared separator
  // invites one to be parsed as the other, and the two are not interchangeable:
  // one is discarded on navigation and the other is evidence.
  assert.ok(!applyCellId("ql-A", "tier-1").includes("::"));
});
