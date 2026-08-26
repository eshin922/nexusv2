import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  computeQuoteCosting,
  type CostingProductionInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

/**
 * The Pricing lift preview shows `totalRevenue / qty`, and must say so.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────
 *
 * Not an arithmetic repair. The figure is correct and customer-facing: it is
 * the number the customer document prints beside the turnkey total. It was
 * investigated as a suspected amortization defect and is not one.
 *
 * The defect was the LABEL. This surface now leads with Unit-price sell, and a
 * column called "price" beside it left an operator holding two figures that
 * look like disagreeing answers to one question when they are correct answers
 * to two.
 *
 * ── WHY THE FIXTURE CARRIES A SEPARATE FEE ──────────────────────────────
 *
 * With no separately-billed charge the two quantities are EQUAL, and a test
 * built on such a quote would pass whatever the column was called — proving
 * the distinction exists is the whole point, so the fixture has to be one where
 * it does.
 */

const TIER = "tier-10k";
const OWNER = "fx-owner";

function inputWithSeparateFee(): QuoteCostingInput {
  const production: CostingProductionInput = {
    quoteSkuId: OWNER,
    tierId: TIER,
    // `assembly`, so the charge is legitimately billable and lands as an
    // ordinary separate line rather than the unbillable case.
    ownerKind: "assembly",
    allocateServiceFeesToCost: false,
    fillingBlendingCost: null,
    cmAssemblyTotal: null,
    setupFeeTotal: 5_000,
    toolingArtworkTotal: null,
    toolingTotal: null,
    artworkTotal: null,
    rdTotal: null,
    testingMicrosTotal: null,
    otherServiceTotal: null,
  } as unknown as CostingProductionInput;

  return {
    quote: { id: "q-turnkey", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Primary: 0.45, Production: 0.3, Manufacturing: 0.3, Other: 0.3 },
    chargeElections: [{ chargeKey: "project_setup", mode: "separate" }],
    skus: [
      {
        id: OWNER,
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "leaf" as const,
        skuLabel: "FX-OWNER",
        productName: "FIXTURE · owner",
        sortOrder: 0,
        retailBenchmark: null,
      },
    ],
    tiers: [
      { id: TIER, label: "10K", qty: 10_000, sortOrder: 0, tierPriceAdjPct: null },
    ],
    packaging: [
      {
        quoteSkuId: OWNER,
        tierId: TIER,
        lineGroupId: "lg-owner",
        unitCost: 2.0,
        qtyPerSellableUnit: 1,
        category: "Primary",
        markupPct: null,
      },
    ],
    production: [production],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: [],
    cellTargets: [],
  } as unknown as QuoteCostingInput;
}

const result = computeQuoteCosting(inputWithSeparateFee(), "committed");
const tier = result.quoteRollup[0]!;
const nodeValue = (key: string) =>
  result.graph.nodes.find((n) => n.key === `quote/${TIER}/${key}`)?.value ?? null;

test("the fixture actually separates a fee — otherwise this proves nothing", () => {
  const separate = nodeValue("separate-charges");
  assert.ok(
    separate !== null && separate > 0,
    "no separate charge was constructed, so the two per-unit figures cannot differ",
  );
});

test("turnkey per unit and Unit-price sell are DIFFERENT numbers", () => {
  const turnkeyPerUnit = tier.totalRevenue / tier.qty;
  const unitPriceSell = nodeValue("per-unit/unit-price-sell");
  assert.ok(unitPriceSell !== null, "no unit-price-sell node to compare against");

  assert.notEqual(
    turnkeyPerUnit,
    unitPriceSell,
    "the two are equal here, so the label distinction would be untestable",
  );

  // And the gap is exactly the separately-billed charge spread over the tier —
  // which is what makes the turnkey figure legitimate rather than wrong.
  const separate = nodeValue("separate-charges")!;
  assert.ok(
    Math.abs(turnkeyPerUnit - unitPriceSell - separate / tier.qty) < 1e-9,
    "the gap is not the separate charge per unit; the premise of the label is wrong",
  );
});

test("the lift preview names the quantity it shows", async () => {
  const src = await read("src/components/pricing-surface/detail-zone.tsx");

  assert.match(src, /<th>Current turnkey \/ unit<\/th>/);
  assert.match(src, /<th>Proposed turnkey \/ unit<\/th>/);

  // The bare "price" headers must be gone: they are what made two correct
  // figures read as one contested one.
  assert.doesNotMatch(src, /<th>Current price<\/th>/);
  assert.doesNotMatch(src, /<th>Proposed price<\/th>/);
});

test("the arithmetic was NOT re-based", async () => {
  // The disposition was explicit: keep totalRevenue / qty. A future change that
  // "fixes" this by switching the preview to Unit-price sell would be the
  // re-basing that was rejected, and would silently disagree with the customer
  // document's own per-unit figure.
  const src = await read("src/lib/pricing-lift.ts");
  assert.match(src, /currentCustomerPrice:.*totalRevenue \/ now\.qty/s);
  assert.match(src, /resultingCustomerPrice:.*totalRevenue \/ next\.qty/s);
});
