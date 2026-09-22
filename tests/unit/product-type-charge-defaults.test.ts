import { test } from "node:test";
import assert from "node:assert/strict";
import {
  indexProductTypeChargeRules,
  suggestionsForProductType,
} from "../../src/lib/product-type-charge-defaults-contract.ts";

test("charge suggestions match HubSpot's raw Product Type value, not its label", () => {
  // HubSpot displays Primary Packaging but stores Primary. The configured rule
  // must be found through the stored value carried by the attached product.
  const rules = indexProductTypeChargeRules([
    { productTypeValue: "Primary", chargeKey: "tooling" },
    { productTypeValue: "Ingestibles", chargeKey: "samples" },
  ]);

  assert.deepEqual(suggestionsForProductType(rules, "Primary"), ["tooling"]);
  assert.deepEqual(suggestionsForProductType(rules, "Primary Packaging"), []);
  assert.deepEqual(suggestionsForProductType(rules, "Ingestibles"), ["samples"]);
});

test("an unconfigured or missing Product Type stays needs-review with no suggestions", () => {
  const rules = indexProductTypeChargeRules([
    { productTypeValue: "Secondary", chargeKey: "print_plates" },
  ]);

  assert.deepEqual(suggestionsForProductType(rules, "Topicals"), []);
  assert.deepEqual(suggestionsForProductType(rules, null), []);
});
