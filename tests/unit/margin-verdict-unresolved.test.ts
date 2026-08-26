import assert from "node:assert/strict";
import test from "node:test";

import {
  computeQuoteCosting,
  type CostingProductionInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";

/**
 * A quote carrying recovery the customer document cannot bill must show the
 * margin as UNRESOLVED — and must not have a single number moved.
 *
 * ── WHY A FIXTURE AND NOT A REAL QUOTE ──────────────────────────────────
 *
 * The estate contains zero live unbillable placements: creation is refused
 * (#416), and the instances that predated the refusal have been resolved. So
 * there is nothing real to observe, and manufacturing one on a production quote
 * would mean writing an invalid commercial state onto a customer's record to
 * watch a verdict change.
 *
 * ── THE FALSIFICATION ───────────────────────────────────────────────────
 *
 * The two inputs below differ in exactly ONE field: `ownerKind` on the
 * production row. `assembly` is billable, `direct_service` is not — a Direct
 * Service leaf has no parent assembly, and the customer projection keys
 * one-time lines per assembly, so it has no key to bill under.
 *
 * `ownerKind` is documented as an input slot on which "nothing in the math
 * branches", so every governed figure must come out IDENTICAL across the pair.
 * That is what makes this a falsification rather than a demonstration: if the
 * repair had re-based revenue, the two would diverge and these assertions fail.
 *
 * Same money. Different verdict. Nothing else.
 */

const TIER = "tier-10k";
const OWNER = "fx-owner";

function input(ownerKind: "assembly" | "direct_service"): QuoteCostingInput {
  const production: CostingProductionInput = {
    quoteSkuId: OWNER,
    tierId: TIER,
    ownerKind,
    allocateServiceFeesToCost: false,
    fillingBlendingCost: null,
    cmAssemblyTotal: null,
    setupFeeTotal: null,
    toolingArtworkTotal: null,
    toolingTotal: null,
    artworkTotal: null,
    rdTotal: 5_000,
    testingMicrosTotal: null,
    otherServiceTotal: null,
    bulkRawTotal: null,
    actualUnitsProduced: null,
  } as unknown as CostingProductionInput;

  return {
    quote: { id: "q-unresolved", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    // "Production" is PRODUCTION_MARKUP_CATEGORY — the schedule entry that
    // prices a one-time charge. Without it the engine correctly declines to
    // state an amount (BV-013: no governed rate, no price), the charge carries
    // no separate invoice amount, and the unbillable case never arises. That
    // is right behaviour, and it would have made this fixture silently prove
    // nothing.
    markupDefaults: { Primary: 0.45, Production: 0.3, Manufacturing: 0.3, Other: 0.3 },
    // Placed on its own line — the placement that is unbillable for a Direct
    // Service and perfectly ordinary for an assembly.
    chargeElections: [{ chargeKey: "rd_formulation", mode: "separate" }],
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

const billable = computeQuoteCosting(input("assembly"), "committed");
const unbillable = computeQuoteCosting(input("direct_service"), "committed");

test("the control is a real band, not already unresolved", () => {
  // Without this the test below could pass because EVERYTHING is UNRESOLVED,
  // which would prove nothing at all.
  assert.notEqual(billable.quoteSummary.marginVerdict, "UNRESOLVED");
  assert.equal(
    billable.quoteSummary.marginVerdict,
    billable.quoteSummary.blendedMarginStatus,
    "with nothing unbillable, the verdict and the band must agree",
  );
  assert.ok(
    ["GOOD", "BELOW_TARGET", "BELOW_FLOOR"].includes(
      billable.quoteSummary.blendedMarginStatus,
    ),
    `control landed on a non-band status: ${billable.quoteSummary.blendedMarginStatus}`,
  );
});

test("an unbillable placement makes the operator verdict UNRESOLVED", () => {
  assert.equal(unbillable.quoteSummary.marginVerdict, "UNRESOLVED");
});

test("every tier says so, not only the ones carrying the charge", () => {
  for (const t of unbillable.quoteRollup) {
    assert.equal(
      t.marginVerdict,
      "UNRESOLVED",
      `tier ${t.label} still shows a band while the quote is unsendable`,
    );
  }
});

test("THE GATE GUARD — the governed band is untouched", () => {
  // The send gate, the below-floor authorization path and the acceptance guard
  // all ask `blendedMarginStatus === "BELOW_FLOOR"`. Overwriting it would have
  // made a below-floor quote carrying an unbillable placement stop reading as
  // below floor, weakening the guard that catches it.
  assert.equal(
    unbillable.quoteSummary.blendedMarginStatus,
    billable.quoteSummary.blendedMarginStatus,
    "the band moved — every gate reading it has changed behaviour",
  );
  assert.notEqual(unbillable.quoteSummary.blendedMarginStatus, "UNRESOLVED");
  for (const t of unbillable.quoteRollup) {
    assert.notEqual(t.blendedMarginStatus, "UNRESOLVED");
  }
});

test("NOT A RE-BASING — no governed figure moved", () => {
  // The whole disposition was: correct the verdict, not the formula.
  assert.equal(
    unbillable.quoteSummary.blendedMarginPct,
    billable.quoteSummary.blendedMarginPct,
    "blendedMarginPct moved — this became a margin formula change",
  );
  assert.equal(
    unbillable.quoteSummary.blendedRevenue,
    billable.quoteSummary.blendedRevenue,
    "blendedRevenue moved — totalRevenue was re-based",
  );
  assert.equal(
    unbillable.quoteSummary.blendedCost,
    billable.quoteSummary.blendedCost,
  );

  const money = (r: (typeof billable.quoteRollup)[number]) => ({
    revenue: r.totalRevenue,
    cost: r.totalCost,
    pct: r.blendedMarginPct,
  });
  assert.deepEqual(
    unbillable.quoteRollup.map(money),
    billable.quoteRollup.map(money),
    "per-tier money moved between the two inputs",
  );
});

test("the engine also separates it in the graph, from the same test", () => {
  // The verdict and the Price Build's "Not billable" band must agree about
  // which charges qualify — they read the same predicate, and this pins that
  // they fire together rather than independently.
  const node = unbillable.graph.nodes.find((n) =>
    n.key.endsWith("/unbillable-recovery"),
  );
  assert.ok(node, "no unbillable-recovery node while the verdict says UNRESOLVED");
  assert.ok((node.value ?? 0) > 0);

  const control = billable.graph.nodes.find((n) =>
    n.key.endsWith("/unbillable-recovery"),
  );
  assert.equal(control, undefined, "control emitted an unbillable node");
});
