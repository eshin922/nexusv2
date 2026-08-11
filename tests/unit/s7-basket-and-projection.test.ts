/**
 * S-7 · the basket rule and the baseline projection.
 *
 * WHY THIS EXISTS
 *
 * Both pieces are governance logic that can only ever fail in one direction:
 * they can make the preservation check WEAKER without making it red. A basket
 * that quietly drops a real quote, or a projection that quietly sets aside a
 * moved value as though it were a new field, would both report `ok` over an
 * estate that had drifted — and S-7's entire purpose is to be the thing that
 * cannot happen.
 *
 * So the tests here are mostly about what must NOT be tolerated. The permissive
 * cases are two lines; the rest asserts that permissiveness stops exactly where
 * Amendment A-1 draws the line: *exposing computation structure is permitted,
 * changing an existing number is not.*
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  VALIDATION_NAMESPACE,
  baselineEntryInBasket,
  isValidationInstrument,
} from "../../scripts/gate-1b/basket.ts";
import { projectOntoBaseline } from "../../scripts/gate-1b/projection.ts";

// ───────────────────────────────────────────────────────── the basket rule

test("the validation namespace is excluded, and it is a namespace not an id", () => {
  assert.equal(isValidationInstrument("ZZ-VALIDATION-tier-propagation"), true);
  assert.equal(isValidationInstrument("ZZ-VALIDATION-anything-at-all"), true);
  // The point of excluding a NAMESPACE rather than an id: a validation quote
  // created tomorrow must not join the basket either.
  assert.equal(isValidationInstrument(VALIDATION_NAMESPACE + "created-later"), true);
});

test("ordinary scenarios stay in, including ones that merely mention validation", () => {
  for (const label of [
    "Base",
    "Alt 1",
    "validation",
    "Validation run",
    "zz-validation-lowercase",
    "PRE-ZZ-VALIDATION-tier",
  ]) {
    assert.equal(isValidationInstrument(label), false, `${label} must remain in the basket`);
  }
});

test("a quote with no scenario label is a real quote and stays in", () => {
  assert.equal(isValidationInstrument(null), false);
  assert.equal(isValidationInstrument(undefined), false);
});

test("baseline entries are matched on the SCENARIO half of the label", () => {
  // Entry labels are `{deal name} / {scenario label}`. A deal name is customer
  // data and cannot be allowed to decide basket membership.
  assert.equal(
    baselineEntryInBasket("Smart Pressed Juice - Juice Cleanse Reorder 2026 / ZZ-VALIDATION-tier-propagation"),
    false,
  );
  assert.equal(baselineEntryInBasket("Some Deal / Base"), true);
  // The unlucky deal name: it must NOT exclude a real quote.
  assert.equal(baselineEntryInBasket("ZZ-VALIDATION-Widgets Inc / Base"), true);
});

// ───────────────────────────────────────────── the projection: what it allows

test("a field absent at capture is set aside and reported", () => {
  const added: string[] = [];
  const out = projectOntoBaseline({ a: 1 }, { a: 1, b: 2 }, added) as Record<string, unknown>;
  assert.deepEqual(out, { a: 1 }, "the addition must not enter the compared payload");
  assert.deepEqual(added, ["b"], "and it must be named, not silently dropped");
});

test("additions are reported with their full path", () => {
  const added: string[] = [];
  projectOntoBaseline(
    { rollups: [{ x: 1 }, { x: 2 }] },
    { rollups: [{ x: 1, y: 9 }, { x: 2, y: 9 }] },
    added,
  );
  assert.deepEqual(added, ["rollups[0].y", "rollups[1].y"]);
});

// ──────────────────────────────────── the projection: what it must NOT allow

test("A MOVED VALUE SURVIVES PROJECTION — this is the one that matters", () => {
  const added: string[] = [];
  const out = projectOntoBaseline(
    { a: 1, nested: { deep: 2 } },
    { a: 1.0000000001, nested: { deep: 2 }, brandNew: 5 },
    added,
  ) as Record<string, unknown>;
  assert.equal(out.a, 1.0000000001, "the moved value must reach the comparison unchanged");
  assert.deepEqual(added, ["brandNew"], "the addition alongside it must not launder it");
});

test("a moved value nested under an array survives projection", () => {
  const added: string[] = [];
  const out = projectOntoBaseline(
    { r: [{ m: 0.2275 }] },
    { r: [{ m: 0.5072, extra: 1 }] },
    added,
  ) as { r: { m: number }[] };
  assert.equal(out.r[0].m, 0.5072);
});

test("a REMOVED field is not an addition — it survives as undefined and fails", () => {
  // A captured scalar disappearing is the opposite of exposing structure.
  const added: string[] = [];
  const out = projectOntoBaseline({ a: 1, b: 2 }, { a: 1 }, added) as Record<string, unknown>;
  assert.ok("b" in out, "the baseline key must still be present in the projection");
  assert.equal(out.b, undefined);
  assert.deepEqual(added, []);
});

test("a null captured value moving to a number is a MOVEMENT, not an addition", () => {
  // The exact confusion that made the raw digest unable to see A-1's line:
  // `canonical(undefined)` and `canonical(null)` are the same string. A key the
  // baseline HELD, at null, is a captured scalar.
  const added: string[] = [];
  const out = projectOntoBaseline({ m: null }, { m: 4.5 }, added) as Record<string, unknown>;
  assert.equal(out.m, 4.5, "must reach the comparison and fail there");
  assert.deepEqual(added, []);
});

test("an array whose length changed is left intact so the shape change is reported", () => {
  const added: string[] = [];
  const out = projectOntoBaseline({ r: [1, 2] }, { r: [1, 2, 3] }, added) as { r: number[] };
  assert.deepEqual(out.r, [1, 2, 3], "truncating here would hide a coverage change");
});

test("an object replaced by a scalar is left intact rather than projected away", () => {
  // The scalar reaches the comparison at the position the object occupied, so
  // `firstDifference` reports the shape change. Projecting it away would hide a
  // structural regression as though it were a permitted addition.
  const added: string[] = [];
  const out = projectOntoBaseline({ a: { b: 1 } }, { a: 7 }, added) as Record<string, unknown>;
  assert.deepEqual(out, { a: 7 });
  assert.deepEqual(added, []);
});

test("an array swapped for an object is left intact", () => {
  const added: string[] = [];
  const out = projectOntoBaseline([1, 2], { 0: 1, 1: 2 }, added);
  assert.deepEqual(out, { 0: 1, 1: 2 });
});
