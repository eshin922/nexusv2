/**
 * S-7's Pattern 58 exception, falsified in both directions.
 *
 * The exception permits ONE thing: a freight contribution attributed to a
 * different product. The risk in writing it was that "permit attribution
 * movement" quietly becomes "ignore per-SKU differences", which would retire
 * the preservation gate while leaving it green.
 *
 * So the bar is not "the permitted case passes". It is that the permitted case
 * passes AND every neighbouring case — the ones a broad exemption would also
 * have waved through — still fails. Each FAIL below is a mutation of the SAME
 * per-SKU fields the PASS case is allowed to move.
 *
 * Fixture mirrors the shape that produced the finding: two leaves under one
 * assembly, one tier, a shipment worth 0.4/unit that either leaf may carry.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  allDifferences,
  attributionViolations,
  strictHalf,
  type Diff,
} from "../../scripts/gate-1b/preservation-compare.ts";

const TIER = "tier-1";
const QTY = 10_000;

/** Freight per unit, and the sell it becomes at a 40% freight markup. */
const F_COST = 0.4;
const F_SELL = 0.56;

type Cell = Record<string, unknown>;

/** One leaf's per-tier row. `freight` decides whether the shipment sits here. */
function cell(packaging: number, freight: boolean): Cell {
  const fc = freight ? F_COST : 0;
  const fs = freight ? F_SELL : 0;
  const contribution = packaging + fc;
  const sellBefore = packaging * 1.4 + fs;
  const required = sellBefore;
  return {
    tierId: TIER,
    packagingCostPerUnit: packaging,
    productionCostPerUnit: 0,
    rawCostPerUnit: 0,
    factoryCostPerUnit: packaging,
    totalLandedFreightBeforeMarkup: fc,
    totalLandedFreightWithMarkup: fs,
    totalContainerFreightBeforeMarkup: fc,
    totalDutyTariffBeforeMarkup: 0,
    freightContainerMarkupSumPerUnit: fs,
    freightDutyTariffMarkupSumPerUnit: 0,
    contributionCostPerUnit: contribution,
    sellBeforeAdjustmentPerUnit: sellBefore,
    adjDeltaPerUnit: 0,
    sellAfterAdjustmentPerUnit: sellBefore,
    liftDeltaPerUnit: 0,
    sellAfterLiftPerUnit: sellBefore,
    overrideDeltaPerUnit: 0,
    computedSellPerUnit: required,
    requiredSellPerUnit: required,
    revenue: required * QTY,
    cost: contribution * QTY,
    marginPct: (required - contribution) / required,
    marginStatus: "GOOD",
    competitiveStatus: null,
    sellSource: "computed",
    customsLegCount: 0,
    freightLegs: [],
    separateServiceFeesPerUnit: 0,
    separateServicesMarkupSumPerUnit: 0,
    packagingMarkupSumPerUnit: packaging * 0.4,
    productionMarkupSumPerUnit: 0,
    rawMarkupSumPerUnit: 0,
  };
}

/** `owner` names the leaf the shipment is attributed to. */
function payload(owner: "A" | "B") {
  const a = cell(2.0, owner === "A");
  const b = cell(1.0, owner === "B");
  const asy = cell(3.0, false);
  // The assembly's own row folds both children, freight included exactly once.
  asy.contributionCostPerUnit = Number(a.contributionCostPerUnit) + Number(b.contributionCostPerUnit);
  asy.requiredSellPerUnit = Number(a.requiredSellPerUnit) + Number(b.requiredSellPerUnit);
  asy.sellBeforeAdjustmentPerUnit = Number(a.sellBeforeAdjustmentPerUnit) + Number(b.sellBeforeAdjustmentPerUnit);
  asy.sellAfterAdjustmentPerUnit = asy.sellBeforeAdjustmentPerUnit;
  asy.sellAfterLiftPerUnit = asy.sellBeforeAdjustmentPerUnit;
  asy.computedSellPerUnit = asy.requiredSellPerUnit;
  asy.totalLandedFreightBeforeMarkup = F_COST;
  asy.totalLandedFreightWithMarkup = 0;
  asy.totalContainerFreightBeforeMarkup = F_COST;
  asy.freightContainerMarkupSumPerUnit = F_SELL;
  asy.packagingCostPerUnit = 3.0;
  asy.packagingMarkupSumPerUnit = 3.0 * 0.4;
  asy.factoryCostPerUnit = 3.0;
  asy.revenue = Number(asy.requiredSellPerUnit) * QTY;
  asy.cost = Number(asy.contributionCostPerUnit) * QTY;
  asy.marginPct =
    (Number(asy.requiredSellPerUnit) - Number(asy.contributionCostPerUnit)) /
    Number(asy.requiredSellPerUnit);

  return {
    quote: { id: "q1", globalPriceAdjPct: 0 },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    tiers: [{ tierId: TIER, label: "Tier 1", qty: QTY }],
    skuRollups: [
      { skuId: "asy", skuRole: "assembly", parentSkuId: null, canonicalQuoteLeafId: null, perTier: [asy] },
      { skuId: "leaf-A", skuRole: "leaf", parentSkuId: "asy", canonicalQuoteLeafId: "ql-A", perTier: [a] },
      { skuId: "leaf-B", skuRole: "leaf", parentSkuId: "asy", canonicalQuoteLeafId: "ql-B", perTier: [b] },
    ],
    quoteRollup: [
      {
        tierId: TIER,
        label: "Tier 1",
        qty: QTY,
        totalRevenue: Number(asy.revenue),
        totalCost: Number(asy.cost),
        blendedMarginPct: Number(asy.marginPct),
      },
    ],
    quoteSummary: {
      blendedRevenue: Number(asy.revenue),
      blendedCost: Number(asy.cost),
      blendedMarginPct: Number(asy.marginPct),
    },
  };
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** The verifier's two halves, run exactly as the gate runs them. */
function judge(base: unknown, cur: unknown) {
  const diffs: Diff[] = [];
  allDifferences(strictHalf(base), strictHalf(cur), diffs);
  return { strict: diffs, attribution: attributionViolations(base, cur) };
}
const green = (v: ReturnType<typeof judge>) =>
  v.strict.length === 0 && v.attribution.length === 0;

/** Reach into one leaf's per-tier row. */
const row = (p: ReturnType<typeof payload>, skuId: string) =>
  p.skuRollups.find((s) => s.skuId === skuId)!.perTier[0] as Cell;

// ---------------------------------------------------------------------------
// PASS · the permitted case
// ---------------------------------------------------------------------------

test("PASS · freight changes owner and every aggregate is conserved", () => {
  const before = payload("A");
  const after = payload("B");

  // Precondition of the test itself: the per-SKU rows really did move, so a
  // green verdict below is the exception being exercised rather than a fixture
  // in which nothing happened.
  const moved: Diff[] = [];
  allDifferences(before, after, moved);
  assert.ok(moved.length > 0, "the fixture must actually reattribute something");
  assert.equal(row(before, "leaf-A").totalLandedFreightBeforeMarkup, F_COST);
  assert.equal(row(after, "leaf-A").totalLandedFreightBeforeMarkup, 0);
  assert.equal(row(after, "leaf-B").totalLandedFreightBeforeMarkup, F_COST);

  const v = judge(before, after);
  assert.deepEqual(v.attribution, [], "reattribution must not be a violation");
  assert.deepEqual(
    v.strict.map((d) => d.path),
    [],
    "no governed scalar moved",
  );
  assert.ok(green(v));
});

test("PASS · an unchanged quote is still green", () => {
  assert.ok(green(judge(payload("A"), payload("A"))));
});

// ---------------------------------------------------------------------------
// FAIL · the neighbours. Each mutates a field the PASS case is allowed to move.
// ---------------------------------------------------------------------------

test("FAIL · a per-SKU value moves without its aggregate being conserved", () => {
  // The exact shape the exception must not admit: one of the SAME fields
  // reattribution is permitted to move, moved WITHOUT the matching movement
  // elsewhere. Sum over leaves no longer conserved.
  const after = payload("B");
  (row(after, "leaf-B") as Cell).requiredSellPerUnit = 99;
  const v = judge(payload("A"), after);
  assert.ok(v.attribution.length > 0, "unconserved redistribution must fail");
  assert.ok(
    v.attribution.some((s) => s.includes("conserve") || s.includes("account")),
    `expected a conservation violation, got: ${v.attribution.join(" | ")}`,
  );
});

test("FAIL · tier revenue is altered", () => {
  const after = payload("B");
  after.quoteRollup[0].totalRevenue += 5880;
  const v = judge(payload("A"), after);
  assert.ok(
    v.strict.some((d) => d.path.includes("totalRevenue")),
    "tier revenue is governed and must fail strictly",
  );
});

test("FAIL · tier cost is altered", () => {
  const after = payload("B");
  after.quoteRollup[0].totalCost += 1;
  assert.ok(judge(payload("A"), after).strict.some((d) => d.path.includes("totalCost")));
});

test("FAIL · blended margin is altered", () => {
  const after = payload("B");
  after.quoteRollup[0].blendedMarginPct += 0.01;
  assert.ok(
    judge(payload("A"), after).strict.some((d) => d.path.includes("blendedMarginPct")),
  );
});

test("FAIL · quote-level revenue is altered", () => {
  const after = payload("B");
  after.quoteSummary.blendedRevenue += 100;
  assert.ok(
    judge(payload("A"), after).strict.some((d) => d.path.includes("blendedRevenue")),
  );
});

test("FAIL · the freight AMOUNT changes rather than its owner", () => {
  // Same owner movement, but the shipment is worth more on arrival. The
  // multiset check is what separates this from the permitted case, and it is
  // the difference between "who carries it" and "how much it is".
  const after = payload("B");
  const b = row(after, "leaf-B");
  b.totalLandedFreightBeforeMarkup = 0.5;
  b.contributionCostPerUnit = 1.0 + 0.5;
  b.cost = 1.5 * QTY;
  const v = judge(payload("A"), after);
  assert.ok(
    v.attribution.some((s) => s.includes("multiset")),
    `expected a multiset violation, got: ${v.attribution.join(" | ")}`,
  );
});

test("FAIL · a packaging edit hides inside a reattributed row", () => {
  // The subtle one, and the reason each row is checked against ITS OWN freight
  // movement rather than only against the tier sums. Leaf B legitimately gains
  // the shipment; it also quietly gains 0.1 of packaging cost. A rule that
  // only summed would still see a plausible total on this row.
  const after = payload("B");
  const b = row(after, "leaf-B");
  b.packagingCostPerUnit = 1.1;
  b.contributionCostPerUnit = 1.1 + F_COST;
  b.cost = (1.1 + F_COST) * QTY;
  const v = judge(payload("A"), after);
  assert.ok(
    v.attribution.length > 0 || v.strict.length > 0,
    "a non-freight movement inside a reattributed row must fail",
  );
  assert.ok(
    v.strict.some((d) => d.path.includes("packagingCostPerUnit")),
    "packaging carries no freight, so it is in the strict half",
  );
  assert.ok(
    v.attribution.some((s) => s.includes("account")),
    `the row moved by more than its freight: ${v.attribution.join(" | ")}`,
  );
});

test("FAIL · a per-SKU field outside the attribution set moves", () => {
  // Proves the exemption is scoped to the enumerated fields and did not become
  // a blanket "per-SKU differences are fine".
  const after = payload("A");
  (row(after, "leaf-A") as Cell).factoryCostPerUnit = 99;
  assert.ok(
    judge(payload("A"), after).strict.some((d) => d.path.includes("factoryCostPerUnit")),
  );
});

test("FAIL · identity or membership changes", () => {
  const after = payload("B");
  after.skuRollups[2].canonicalQuoteLeafId = "ql-SOMETHING-ELSE";
  assert.ok(
    judge(payload("A"), after).strict.some((d) => d.path.includes("canonicalQuoteLeafId")),
  );
});

test("FAIL · a product disappears", () => {
  const after = payload("B");
  after.skuRollups.pop();
  const v = judge(payload("A"), after);
  assert.ok(v.strict.length > 0 || v.attribution.length > 0);
});

test("FAIL · margin stops following from its own sell and cost", () => {
  const after = payload("B");
  (row(after, "leaf-B") as Cell).marginPct = 0.99;
  const v = judge(payload("A"), after);
  assert.ok(
    v.attribution.some((s) => s.includes("does not follow")),
    `expected a ratio-consistency violation, got: ${v.attribution.join(" | ")}`,
  );
});

// ---------------------------------------------------------------------------
// The report, which is half the repair.
// ---------------------------------------------------------------------------

test("the report surfaces every difference, not the first one found", () => {
  // The failure this replaces: one line per quote, chosen by walk order, so a
  // 1.7e-16 margin difference on tier 1 stood in front of a 5,880 revenue
  // movement on tier 2. Both must now be present, and the material one must
  // rank first.
  const after = payload("B");
  after.quoteRollup[0].blendedMarginPct += 1e-16;
  after.quoteRollup[0].totalRevenue += 5880;

  const diffs = judge(payload("A"), after).strict;
  const paths = diffs.map((d) => d.path);
  assert.ok(paths.some((p) => p.includes("totalRevenue")), "the material one is reported");
  assert.ok(diffs.length >= 1);

  const worst = diffs.reduce((m, d) => ((d.delta ?? 0) > (m.delta ?? 0) ? d : m));
  assert.ok(
    worst.path.includes("totalRevenue"),
    `the largest movement must be findable, got ${worst.path}`,
  );
});

test("float noise below the aggregate quantum is not a movement", () => {
  // The other half of the same judgement: reattribution reorders the summation,
  // so tier totals differ in the last bits. Quantizing at 12 significant digits
  // absorbs that and nothing else — this asserts the absorption is real, and
  // the 5,880 case above asserts it is not too wide.
  const after = payload("B");
  after.quoteRollup[0].totalRevenue += 5.82e-11;
  after.quoteSummary.blendedMarginPct += 1.67e-16;
  assert.ok(green(judge(payload("A"), after)));
});
