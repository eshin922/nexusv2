/**
 * OD-025 — attribution must not change Freight economics.
 *
 * Pattern 58 governs: membership may determine ATTRIBUTION, but must never
 * determine COMMERCIAL ARITHMETIC. The implementation failed that standard, and
 * failed it more broadly than "two anchors disagree": freight was OVER-COUNTED
 * outright whenever the carrying leaf had BOM multiplicity ≠ 1, with a single
 * anchor and nothing to compare against.
 *
 * ROOT CAUSE — a dimensional error. `rollUpAssemblyPerTier` multiplied every
 * per-unit field by `qtyPerParent`. That is the correct CONVERSION for
 * component-unit values (packaging is $/component unit), and dimensionally
 * invalid for freight, which `computeShipmentContribution` had already divided
 * by `tierUnits` and so was already $/sellable unit.
 *
 * Test 1 is the one that matters most: it contains ONE leaf and no alternate
 * anchor, so it cannot be satisfied by making two anchors agree on a wrong
 * number. Anchor equality is necessary and NOT sufficient.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { computeQuoteCosting } from "../../src/lib/costing.ts";
import { buildQuoteCostingInputFromNewModel } from "../../src/lib/costing-adapter.ts";

const Q = "q-od25";
const T = "tier-a";
const ASY = "asy-1";
const SHIPMENT_AMOUNT = 500;
const TIER_UNITS = 1000;

const attach = (
  id: string,
  assemblyId: string | null,
  quantity: string,
  position = 0,
) => ({
  quoteLeafId: id,
  assemblyLeafId: assemblyId ? `al-${id}` : null,
  assemblyId,
  leafId: `lib-${id}`,
  quantity,
  position,
  leafName: id,
  leafSku: id,
});

const pkg = (id: string, unitCost: string) => ({
  quoteLeafId: id,
  tierId: T,
  lineGroupId: `lg-${id}`,
  pricingVendorHubspotCompanyId: null,
  pricingVendorNameSnapshot: null,
  unitCost,
  qtyPerSellableUnit: "1",
  category: "Primary",
  markupPct: null,
});

/** A fixed governed shipment. Only `ownerSkuId` ever varies. */
const ship = (ownerSkuId: string) => ({
  freightSubcategoryId: "sub-1",
  ownerSkuId,
  tierId: T,
  treatment: "bundled" as const,
  tierUnits: TIER_UNITS,
  freightAmount: SHIPMENT_AMOUNT,
  freightMarkupPct: 0,
  dutyAmount: 0,
  dutyMarkupPct: 0,
  tariffAmount: 0,
  tariffMarkupPct: 0,
});

function costed(opts: {
  attachments: ReturnType<typeof attach>[];
  packaging?: ReturnType<typeof pkg>[];
  shipments?: ReturnType<typeof ship>[];
  legCosts?: unknown[];
  assemblies?: Array<{ id: string; sku: string; name: string; position: number }>;
  markup?: number;
}) {
  return computeQuoteCosting(
    buildQuoteCostingInputFromNewModel({
      quote: { id: Q, globalPriceAdjPct: 0, targetMarginPct: null },
      firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
      markupDefaults: { Primary: opts.markup ?? 0 },
      tiers: [{ id: T, label: "T1", qty: TIER_UNITS, sortOrder: 0, tierPriceAdjPct: null }],
      assemblies: opts.assemblies ?? [{ id: ASY, sku: "ASY-1", name: "asy", position: 0 }],
      quoteLeafAttachments: opts.attachments,
      assemblyLeafInputs: opts.packaging ?? [],
      assemblyProductionInputs: [],
      assemblyLeafOverrides: [],
      assemblyLeafTargets: [],
      lifts: [],
      freightLegGroups: [],
      freightLegs: [],
      freightLegTiers: [],
      freightComponentTierCosts: opts.legCosts ?? [],
      freightShipmentBreaks: opts.shipments ?? [],
    } as never),
  );
}

const tierOf = (r: ReturnType<typeof costed>) =>
  r.quoteRollup.find((t) => t.tierId === T)!;
const quoteFreight = (r: ReturnType<typeof costed>) => tierOf(r).costBreakdown.freight;

// ---------------------------------------------------------------------------
// 1-4 · Absolute correctness. No alternate anchor exists in these fixtures.
// ---------------------------------------------------------------------------

test("1 · ONE leaf, no alternate anchor — a $500 shipment quotes $500", () => {
  // The decisive falsification. A repair that only equalised anchors would
  // still report $1000 here at qty 2 and would pass every anchor-comparison
  // test in this file. This one cannot be satisfied that way.
  for (const qty of ["1", "2", "3"]) {
    const r = costed({
      attachments: [attach("ql-a", ASY, qty)],
      packaging: [pkg("ql-a", "10")],
      shipments: [ship("ql-a")],
    });
    assert.equal(
      quoteFreight(r),
      SHIPMENT_AMOUNT,
      `qtyPerParent ${qty} must not scale an already-amortised shipment amount`,
    );
  }
});

test("2 · qtyPerParent = 1", () => {
  const r = costed({
    attachments: [attach("ql-a", ASY, "1")],
    packaging: [pkg("ql-a", "10")],
    shipments: [ship("ql-a")],
  });
  assert.equal(quoteFreight(r), 500);
});

test("3 · qtyPerParent = 2", () => {
  const r = costed({
    attachments: [attach("ql-a", ASY, "2")],
    packaging: [pkg("ql-a", "10")],
    shipments: [ship("ql-a")],
  });
  assert.equal(quoteFreight(r), 500);
});

test("4 · qtyPerParent = 3", () => {
  const r = costed({
    attachments: [attach("ql-a", ASY, "3")],
    packaging: [pkg("ql-a", "10")],
    shipments: [ship("ql-a")],
  });
  assert.equal(quoteFreight(r), 500);
});

// ---------------------------------------------------------------------------
// 5-9 · Attribution invariance. The anchor may move; the money may not.
// ---------------------------------------------------------------------------

const twoMembers = (qa: string, qb: string) => [
  attach("ql-a", ASY, qa, 0),
  attach("ql-b", ASY, qb, 1),
];
const twoPkg = [pkg("ql-a", "10"), pkg("ql-b", "20")];

test("5 · alternate anchor, EQUAL quantities — identical freight economics", () => {
  const a = costed({ attachments: twoMembers("1", "1"), packaging: twoPkg, shipments: [ship("ql-a")] });
  const b = costed({ attachments: twoMembers("1", "1"), packaging: twoPkg, shipments: [ship("ql-b")] });
  assert.equal(quoteFreight(a), 500);
  assert.equal(quoteFreight(a), quoteFreight(b));
});

test("6 · alternate anchor, UNEQUAL quantities — identical freight economics", () => {
  // The original reported failure: 1300 vs 650. Both must now be 500.
  for (const [qa, qb] of [["1", "2"], ["2", "3"], ["3", "7"]] as const) {
    const a = costed({ attachments: twoMembers(qa, qb), packaging: twoPkg, shipments: [ship("ql-a")] });
    const b = costed({ attachments: twoMembers(qa, qb), packaging: twoPkg, shipments: [ship("ql-b")] });
    assert.equal(quoteFreight(a), 500, `anchor A at (${qa},${qb})`);
    assert.equal(quoteFreight(b), 500, `anchor B at (${qa},${qb})`);
  }
});

test("7 · assembly-owned anchor vs membership-derived Direct anchor", () => {
  const mixed = [attach("ql-a", ASY, "2", 0), attach("ql-d", null, "3", 0)];
  const packaging = [pkg("ql-a", "10"), pkg("ql-d", "10")];
  const onMember = costed({ attachments: mixed, packaging, shipments: [ship("ql-a")] });
  const onDirect = costed({ attachments: mixed, packaging, shipments: [ship("ql-d")] });
  assert.equal(quoteFreight(onMember), 500);
  assert.equal(quoteFreight(onDirect), 500);
});

test("8 · Mixed shipment — one shipment, both leaf kinds present", () => {
  const mixed = [attach("ql-a", ASY, "2", 0), attach("ql-d", null, "3", 0)];
  const packaging = [pkg("ql-a", "10"), pkg("ql-d", "10")];
  // The shipment is one governed input; membership spans both kinds. Freight is
  // the same money whichever member carries it.
  const anchors = ["ql-a", "ql-d"].map((a) =>
    quoteFreight(costed({ attachments: mixed, packaging, shipments: [ship(a)] })),
  );
  assert.deepEqual(anchors, [500, 500]);
});

test("9 · quote TOTAL is invariant under attribution change", () => {
  const mixed = [attach("ql-a", ASY, "2", 0), attach("ql-d", null, "3", 0)];
  const packaging = [pkg("ql-a", "10"), pkg("ql-d", "10")];
  const run = (a: string) => tierOf(costed({ attachments: mixed, packaging, shipments: [ship(a)], markup: 0.4 }));
  const onMember = run("ql-a");
  const onDirect = run("ql-d");
  // Cost, revenue and every freight-bearing breakdown line.
  assert.equal(onMember.totalCost, onDirect.totalCost, "landed cost");
  assert.equal(onMember.totalRevenue, onDirect.totalRevenue, "quoted sell");
  assert.equal(onMember.costBreakdown.freight, onDirect.costBreakdown.freight);
  assert.equal(
    onMember.costBreakdown.freightContainer,
    onDirect.costBreakdown.freightContainer,
  );
  assert.equal(
    onMember.costBreakdown.dutyAndTariff,
    onDirect.costBreakdown.dutyAndTariff,
  );
});

test("10 · freight appears EXACTLY once", () => {
  // Stated as arithmetic, not as a count. Two members, one shipment: the quote
  // carries 500, not 1000, and not 500 x anybody's multiplicity.
  const r = costed({
    attachments: twoMembers("2", "3"),
    packaging: twoPkg,
    shipments: [ship("ql-a")],
  });
  assert.equal(quoteFreight(r), 500);
  // And two DISTINCT shipments do add up — otherwise this test would also pass
  // on a build that dropped freight entirely.
  const two = costed({
    attachments: twoMembers("2", "3"),
    packaging: twoPkg,
    shipments: [ship("ql-a"), { ...ship("ql-b"), freightSubcategoryId: "sub-2" }],
  });
  assert.equal(quoteFreight(two), 1000);
});

// ---------------------------------------------------------------------------
// 11-13 · Parity, preservation, and the identity.
// ---------------------------------------------------------------------------

test("11 · leg-model parity — freightComponentTierCosts fixed identically", () => {
  // The leg model has NO anchor concept: its cost is already per-leaf. That it
  // failed the same way is the proof this was never an attribution defect.
  const legCosts = (leafId: string) => [
    { freightLegId: "leg1", quoteLeafId: leafId, tierId: T, actualFreightCost: 500, effectiveUnits: TIER_UNITS },
  ];
  for (const qty of ["1", "2", "3"]) {
    const r = computeQuoteCosting(
      buildQuoteCostingInputFromNewModel({
        quote: { id: Q, globalPriceAdjPct: 0, targetMarginPct: null },
        firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
        markupDefaults: { Primary: 0 },
        tiers: [{ id: T, label: "T1", qty: TIER_UNITS, sortOrder: 0, tierPriceAdjPct: null }],
        assemblies: [{ id: ASY, sku: "ASY-1", name: "asy", position: 0 }],
        quoteLeafAttachments: [attach("ql-a", ASY, qty)],
        assemblyLeafInputs: [pkg("ql-a", "10")],
        assemblyProductionInputs: [],
        assemblyLeafOverrides: [],
        assemblyLeafTargets: [],
        lifts: [],
        freightLegGroups: [{ id: "g1", quoteId: Q, mode: "ocean", label: "L", sortOrder: 0 }],
        freightLegs: [{
          id: "leg1", freightLegGroupId: "g1", quoteId: Q, legOrder: 0,
          origin: "CN", destination: "US", customsEligible: true, treatment: "bundled",
          freightMarkupPct: "0", dutyMarkupPct: "0", tariffMarkupPct: "0",
        }],
        freightLegTiers: [],
        freightComponentTierCosts: legCosts("ql-a"),
        freightShipmentBreaks: [],
      } as never),
    );
    assert.equal(quoteFreight(r), 500, `leg model at qtyPerParent ${qty}`);
  }
});

test("12 · packaging/component quantity scaling is UNCHANGED", () => {
  // The repair must not flatten legitimate component economics. $10 per
  // component unit, N components per sellable unit, 1000 sellable units.
  for (const [qty, expected] of [["1", 10_000], ["2", 20_000], ["3", 30_000]] as const) {
    const r = costed({
      attachments: [attach("ql-a", ASY, qty)],
      packaging: [pkg("ql-a", "10")],
    });
    assert.equal(
      tierOf(r).costBreakdown.packaging,
      expected,
      `packaging must still scale by qtyPerParent (qty ${qty})`,
    );
  }
  // And it must still scale with freight present — the two dimensions coexist
  // in one fold, which is the whole point of the repair.
  const withFreight = costed({
    attachments: [attach("ql-a", ASY, "3")],
    packaging: [pkg("ql-a", "10")],
    shipments: [ship("ql-a")],
  });
  assert.equal(tierOf(withFreight).costBreakdown.packaging, 30_000);
  assert.equal(quoteFreight(withFreight), 500);
});

test("14 · at qtyPerParent = 1 the fold is EXACT identity, not approximate", () => {
  // Added after the first repair attempt moved money it had no business
  // moving. `(v − f) × 1 + f` is not exactly `v` in IEEE-754: when the freight
  // portion exceeds the composite — routine for a small adjDelta — the
  // subtraction cancels and the re-addition does not restore the original bits.
  // On the live population that noise shifted `blendedMarginPct` on three real
  // quotes, from a repair whose whole premise is that it moves no money.
  //
  // Every live attachment is quantity 1, so this is the entire production
  // population, and "approximately identity" is not good enough for it.
  const withFreight = costed({
    attachments: [attach("ql-a", ASY, "1")],
    packaging: [pkg("ql-a", "10")],
    shipments: [ship("ql-a")],
    markup: 0.4,
  });
  const noFold = costed({
    attachments: [attach("ql-a", null, "1")], // direct: never folded
    packaging: [pkg("ql-a", "10")],
    shipments: [ship("ql-a")],
    assemblies: [],
    markup: 0.4,
  });
  const asy = withFreight.skuRollups.find((s) => s.skuRole === "assembly")!
    .perTier.find((t) => t.tierId === T)!;
  const direct = noFold.skuRollups.find((s) => s.skuId === "ql-a")!
    .perTier.find((t) => t.tierId === T)!;

  // Bit-for-bit, not rounded: a folded assembly of one qty-1 child must equal
  // the same child computed with no fold at all.
  for (const field of [
    "contributionCostPerUnit",
    "requiredSellPerUnit",
    "computedSellPerUnit",
    "sellBeforeAdjustmentPerUnit",
    "sellAfterAdjustmentPerUnit",
    "sellAfterLiftPerUnit",
    "adjDeltaPerUnit",
    "liftDeltaPerUnit",
    "overrideDeltaPerUnit",
    "totalLandedFreightBeforeMarkup",
  ] as const) {
    assert.equal(asy[field], direct[field], `${field} must survive the fold exactly`);
  }
});

test("13 · the assembly reconciliation identity is exact", () => {
  // The fold stays linear in the component part. For an assembly, per-unit
  // contribution must equal its children's component parts scaled by
  // qtyPerParent, PLUS the freight part carried at x1 — which is the
  // dimension-aware fold stated as an equation.
  const qty = 3;
  const r = costed({
    attachments: [attach("ql-a", ASY, String(qty))],
    packaging: [pkg("ql-a", "10")],
    shipments: [ship("ql-a")],
    markup: 0.4,
  });
  const asy = r.skuRollups.find((s) => s.skuRole === "assembly")!;
  const leaf = r.skuRollups.find((s) => s.skuId === "ql-a")!;
  const a = asy.perTier.find((t) => t.tierId === T)!;
  const l = leaf.perTier.find((t) => t.tierId === T)!;

  const round = (n: number) => Number(n.toFixed(8));

  // Component-unit parts scale; the freight part does not.
  assert.equal(round(a.packagingCostPerUnit), round(l.packagingCostPerUnit * qty));
  assert.equal(
    round(a.totalLandedFreightBeforeMarkup),
    round(l.totalLandedFreightBeforeMarkup),
    "freight is carried at x1",
  );

  // And the composite obeys the same decomposition.
  assert.equal(
    round(a.contributionCostPerUnit),
    round(
      (l.contributionCostPerUnit - l.totalLandedFreightBeforeMarkup) * qty +
        l.totalLandedFreightBeforeMarkup,
    ),
    "contribution folds mixed",
  );
  assert.equal(
    round(a.sellBeforeAdjustmentPerUnit),
    round(
      (l.sellBeforeAdjustmentPerUnit - l.totalLandedFreightWithMarkup) * qty +
        l.totalLandedFreightWithMarkup,
    ),
    "sell-before folds mixed",
  );

  // The reconciliation that matters commercially: quote cost and revenue are
  // the assembly's per-unit figures times tier quantity, with nothing lost.
  const tier = tierOf(r);
  assert.equal(round(tier.totalCost), round(a.contributionCostPerUnit * TIER_UNITS));
  assert.equal(round(tier.totalRevenue), round(a.requiredSellPerUnit * TIER_UNITS));
});
