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
  // The r12Visual fixture moved three of them again, and instructively: the
  // rates that held were fitted to a leg mix three of four fixtures happened
  // to share. Shipments follow the SPEC FLAGS (`1 + air + domestic`), and
  // destinations and breaks follow the shipments — so those are derivations
  // now in the honest sense rather than averages that survived one more
  // fixture by luck.
  //
  // Two stay literals on purpose, and the validator says why in place:
  // membership follows SKU count AND shipment mix, and customs follows each
  // fixture's destination mix. A formula covering five fixtures would be a
  // curve through five points — worse than a number that is honestly a number.
  for (const key of [
    /const SUBCATS = OPERATORS\.reduce/,
    /freight_subcategories: SUBCATS/,
    /freight_destinations: SUBCATS \* 2/,
    /freight_breaks: OPERATORS\.reduce/,
    /freight_memberships: \d+/,
    /freight_customs_breaks: \d+/,
    /invalid_tracking_destinations: 0/,
  ]) {
    assert.match(validator, key);
  }
});
