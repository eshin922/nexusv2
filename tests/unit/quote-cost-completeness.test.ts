import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertQuoteCostsResolved,
  UnresolvedQuoteCostsError,
  type UnresolvedQuoteCost,
} from "../../src/lib/quote-cost-completeness-contract.ts";

const unresolved: UnresolvedQuoteCost = {
  quoteLeafId: "quote-leaf-1",
  assemblyLeafId: "assembly-leaf-1",
  tierId: "tier-1",
  tierLabel: "5,000 units",
  lineGroupId: "line-1",
  leafSku: "BOTTLE-30",
  leafName: "30ml bottle",
};

test("draft completeness accepts an empty unresolved-cost set", () => {
  assert.doesNotThrow(() => assertQuoteCostsResolved([]));
});

test("commercial boundary failure names attachment, tier, line, and SKU", () => {
  assert.throws(
    () => assertQuoteCostsResolved([unresolved]),
    (error: unknown) => {
      assert.ok(error instanceof UnresolvedQuoteCostsError);
      assert.match(error.message, /quote-leaf-1/);
      assert.match(error.message, /5,000 units \(tier-1\)/);
      assert.match(error.message, /line-1/);
      assert.match(error.message, /BOTTLE-30/);
      return true;
    },
  );
});

test("legacy compatibility context is named when canonical identity is absent", () => {
  assert.throws(
    () =>
      assertQuoteCostsResolved([
        { ...unresolved, quoteLeafId: null, assemblyLeafId: "legacy-leaf-9" },
      ]),
    /legacy-leaf-9/,
  );
});

test("customer and NetSuite sends both call the permanent completeness guard", () => {
  const sendSource = readFileSync("src/app/actions/quotes.ts", "utf8");
  const completionSource = readFileSync(
    "src/lib/netsuite/mark-complete.ts",
    "utf8",
  );

  const sendGuard = sendSource.indexOf("await requireResolvedQuoteCosts(quoteId)");
  const render = sendSource.indexOf("const resolved = await resolveCustomerView", sendGuard);
  const upload = sendSource.indexOf("await artifacts.put", sendGuard);
  assert.ok(sendGuard >= 0 && sendGuard < render && sendGuard < upload);

  const completionGuard = completionSource.indexOf(
    "await requireResolvedQuoteCosts(quoteId)",
  );
  const costing = completionSource.indexOf("await getCostingBundle(quoteId)");
  const externalResolution = completionSource.indexOf(
    "await netsuite.resolveItem(sku)",
  );
  assert.ok(
    completionGuard >= 0 &&
      completionGuard < costing &&
      completionGuard < externalResolution,
  );
});
