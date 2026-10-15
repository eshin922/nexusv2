import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("landed logistics is one per-SKU line when separately billed", () => {
  const resolver = readFileSync("src/lib/customer-view-resolver.ts", "utf8");
  const costing = readFileSync("src/lib/costing.ts", "utf8");
  const projection = readFileSync("src/lib/commercial-projection.ts", "utf8");

  assert.match(resolver, /landedPresentation/);
  assert.match(projection, /key: `landed:\$\{rollup\.skuId\}`/);
  assert.match(projection, /bv011Destination: "otc_freight_duties_tariffs"/);
  assert.doesNotMatch(resolver, /treatment === "pass_through"/);
  assert.match(costing, /containerFreightWithMarkupPerUnit/);
  assert.match(costing, /dutyWithMarkupPerUnit/);
  assert.match(costing, /tariffWithMarkupPerUnit/);
});
