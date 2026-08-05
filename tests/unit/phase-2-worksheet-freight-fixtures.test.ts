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
  for (const key of ["freight_subcategories: 6", "freight_destinations: 12", "freight_breaks: 24", "freight_memberships: 24", "freight_customs_breaks: 20", "invalid_tracking_destinations: 0"]) assert.match(validator, new RegExp(key));
});
