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

test("owned one-time production fees reach the matching Product Type picker", () => {
  const rules = indexProductTypeChargeRules([
    { productTypeValue: "Ingestibles", chargeKey: "project_setup" },
    { productTypeValue: "Ingestibles", chargeKey: "rd_formulation" },
    { productTypeValue: "Ingestibles", chargeKey: "filling_blending" },
    { productTypeValue: "Ingestibles", chargeKey: "cm_assembly_packout" },
    { productTypeValue: "Ingestibles", chargeKey: "testing_micros" },
    { productTypeValue: "Topicals", chargeKey: "rd_formulation" },
  ]);

  assert.deepEqual(suggestionsForProductType(rules, "Ingestibles"), [
    "project_setup",
    "rd_formulation",
  ]);
  assert.deepEqual(suggestionsForProductType(rules, "Topicals"), ["rd_formulation"]);
  assert.deepEqual(suggestionsForProductType(rules, "Turnkey"), []);
});
