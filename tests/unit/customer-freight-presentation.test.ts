import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("bundled freight stays out of the customer line projection", () => {
  const resolver = readFileSync("src/lib/customer-view-resolver.ts", "utf8");
  const costing = readFileSync("src/lib/costing.ts", "utf8");

  assert.match(resolver, /const freightLines: \[\] = \[\]/);
  assert.doesNotMatch(resolver, /treatment === "pass_through"/);
  assert.match(costing, /containerFreightWithMarkupPerUnit/);
  assert.match(costing, /dutyWithMarkupPerUnit/);
  assert.match(costing, /tariffWithMarkupPerUnit/);
});
