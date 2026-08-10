import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("operator fixtures cover 1, 6, and 10 SKU worksheet scenarios", async () => {
  const world = await readFile(new URL("../../tests/harness/fixtures/world.ts", import.meta.url), "utf8");
  assert.match(world, /name: "oneSku", skuCount: 1/);
  assert.match(world, /name: "sixSku", skuCount: 6/);
  assert.match(world, /name: "tenSku", skuCount: 10/);
  assert.match(world, /Packaging from overseas · ocean container/);
  assert.match(world, /Launch stock · split air shipment/);
  assert.match(world, /Ocean arrival · domestic transfer/);
  assert.match(world, /Retained as forwarder comparison evidence/);
});

test("fixture harness validates worksheet cardinality and selected-only tracking", async () => {
  const validator = await readFile(new URL("../../scripts/validation/fixtures.ts", import.meta.url), "utf8");
  // Four of these were literals — 6 / 12 / 24 / 24 — and a fourth operator
  // fixture invalidated every one of them simultaneously while the seed was
  // correct. They are derivations now, so what this asserts is that each count
  // is still CHECKED and still derived from the fixture definitions, not what
  // it happens to evaluate to today.
  //
  // `freight_customs_breaks` stays a literal on purpose: its per-tier rate
  // differs between fixtures, so any formula covering all of them would be
  // fitted rather than derived. It is asserted as a bare presence for that
  // reason, and the validator says why in place.
  for (const key of [
    /freight_subcategories: OPERATORS\.length \* 2/,
    /freight_destinations: OPERATORS\.length \* 4/,
    /freight_breaks: OPERATOR_TIER_TOTAL \* 4/,
    /freight_memberships: OPERATORS\.length \* 8/,
    /freight_customs_breaks: \d+/,
    /invalid_tracking_destinations: 0/,
  ]) {
    assert.match(validator, key);
  }
});
