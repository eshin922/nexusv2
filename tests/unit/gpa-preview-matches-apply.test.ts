/**
 * GPA-PREV-1 / GPA-PREV-2 · Preview projects exactly what Apply would persist.
 *
 * WHAT THE BROWSER SHOWED. Committed 1%, entered 10%: "Resulting adjustment
 * 11.1%" while Apply persisted 10% — and resulting prices FELL on three of four
 * tiers under a positive proposed lift. Two authorities, two answers.
 *
 * Cause: the projection treated the entered figure as a delta to compound
 * (`composePricingAdjustment`) and wrote the result into `tierPriceAdjPct` for
 * EVERY tier — the fan-out the pricing-authority disposition removed. It
 * projected a state Apply would never produce, by a rule Apply does not use.
 *
 * The repair is not reimplemented Apply math. The proposed state is built by
 * asking `planApply` — the same planner the action asks — and run through the
 * same engine. These tests assert the two AGREE, which is the only property
 * that matters and the one duplicated math could never guarantee.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";
import { buildGlobalPricingPreview } from "../../src/lib/pricing-lift.ts";
import { planApply } from "../../src/lib/pricing-apply-plan.ts";

const TIERS = [
  { id: "t1", label: "Tier 1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null },
  { id: "t2", label: "Tier 2", qty: 5000, sortOrder: 1, tierPriceAdjPct: null },
];

function snapshot(globalAdj: number, tierAdj: Record<string, number | null> = {}) {
  const tiers = TIERS.map((t) => ({ ...t, tierPriceAdjPct: tierAdj[t.id] ?? null }));
  const skus = [{
    id: "L", canonicalQuoteLeafId: "ql-L", parentSkuId: null, qtyPerParent: null,
    skuRole: "leaf" as const, skuLabel: "L", productName: "Product L",
    sortOrder: 0, retailBenchmark: null,
  }];
  const packaging = TIERS.map((t) => ({
    quoteSkuId: "L", tierId: t.id, lineGroupId: `g-${t.id}`,
    unitCost: 10, qtyPerSellableUnit: 1, category: "Primary", markupPct: 0,
  }));
  const base = {
    quoteId: "q", globalPriceAdjPct: globalAdj, targetMarginPct: null,
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {}, skus, tiers, packaging, production: [],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  };
  const costing = computeQuoteCosting({
    quote: { id: "q", globalPriceAdjPct: globalAdj, targetMarginPct: null },
    firmSettings: base.firmSettings, markupDefaults: {}, skus, tiers, packaging,
    production: [], freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  });
  return { ...base, costing } as never;
}

/** What Apply would actually persist and produce, via the same planner. */
function applyOutcome(globalAdj: number, tierAdj: Record<string, number | null>, proposed: number) {
  const persisted = new Map<string, string>();
  for (const [k, v] of Object.entries(tierAdj)) if (v !== null) persisted.set(k, String(v));
  const plan = planApply({
    intendedLifts: new Map(), intendedOverrides: new Map(),
    persistedLifts: new Map(), persistedOverrides: new Map(),
    intendedTierAdj: new Map(persisted), persistedTierAdj: persisted,
    globalAdjFrom: String(globalAdj), globalAdjTo: String(proposed),
  });
  const after = new Map(persisted);
  for (const r of plan.tierAdjRemoved) after.delete(r.key);
  for (const c of plan.tierAdjSet) after.set(c.key, c.to);
  const tiers = TIERS.map((t) => ({
    ...t,
    tierPriceAdjPct: after.has(t.id) ? Number(after.get(t.id)) : null,
  }));
  const r = computeQuoteCosting({
    quote: { id: "q", globalPriceAdjPct: proposed, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [{ id: "L", canonicalQuoteLeafId: "ql-L", parentSkuId: null, qtyPerParent: null, skuRole: "leaf", skuLabel: "L", productName: "Product L", sortOrder: 0, retailBenchmark: null }],
    tiers,
    packaging: TIERS.map((t) => ({ quoteSkuId: "L", tierId: t.id, lineGroupId: `g-${t.id}`, unitCost: 10, qtyPerSellableUnit: 1, category: "Primary", markupPct: 0 })),
    production: [], freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as QuoteCostingInput);
  return new Map(r.quoteRollup.map((t) => [t.tierId, t.totalRevenue / t.qty]));
}

test("the browser case · committed 1%, entered 10% previews 10%, not 11.1%", () => {
  const p = buildGlobalPricingPreview(snapshot(0.01), 0.10);
  for (const tier of p.tiers) {
    assert.equal(tier.currentAdjustment, 0.01);
    assert.equal(tier.resultingAdjustment, 0.10, "must SET, not compound");
    assert.notEqual(tier.resultingAdjustment, 0.111);
  }
});

test("the dispositioned case · committed 20%, entered 30% → proposed 30%, change +10 points", () => {
  const p = buildGlobalPricingPreview(snapshot(0.20), 0.30);
  for (const tier of p.tiers) {
    assert.equal(tier.currentAdjustment, 0.20);
    assert.equal(tier.resultingAdjustment, 0.30);
    assert.notEqual(tier.resultingAdjustment, 0.56, "56% was the compounded answer");
    // "Delta" now states the real change, in points, not the entered figure.
    assert.ok(Math.abs(tier.adjustmentDeltaPoints - 0.10) < 1e-12);
  }
});

test("a positive proposed lift never lowers a price", () => {
  // GPA-PREV-2 in one line. The old projection produced 8.77 -> 7.37.
  const p = buildGlobalPricingPreview(snapshot(0.01), 0.10);
  for (const tier of p.tiers) {
    assert.ok(
      tier.resultingCustomerPrice > tier.currentCustomerPrice,
      `${tier.label}: ${tier.currentCustomerPrice} -> ${tier.resultingCustomerPrice}`,
    );
  }
});

test("PREVIEW EQUALS APPLY across increases and decreases", () => {
  // The property the whole repair exists for, over transitions in both
  // directions and including a decrease to zero.
  for (const [from, to] of [[0, 0.10], [0.10, 0.50], [0.50, 0.25], [0.25, 0.60], [0.60, 0], [0.20, 0.30]]) {
    const preview = buildGlobalPricingPreview(snapshot(from), to);
    const applied = applyOutcome(from, {}, to);
    for (const tier of preview.tiers) {
      const actual = applied.get(tier.tierId)!;
      assert.ok(
        Math.abs(tier.resultingCustomerPrice - actual) < 1e-9,
        `${from}->${to} ${tier.label}: preview ${tier.resultingCustomerPrice} vs apply ${actual}`,
      );
      assert.equal(tier.resultingAdjustment, to);
    }
  }
});

test("preview reflects that a global Apply CLEARS tier overrides", () => {
  // A tier carrying its own rate prices at that rate today, and at the global
  // after Apply — because Apply clears it. A preview that showed the override
  // surviving would promise a quote Apply does not produce.
  const withOverride = snapshot(0.10, { t2: 0.05 });
  const p = buildGlobalPricingPreview(withOverride, 0.20);
  const t2 = p.tiers.find((t) => t.tierId === "t2")!;
  assert.equal(t2.currentAdjustment, 0.05, "today it prices at its own rate");
  assert.equal(t2.resultingAdjustment, 0.20, "after Apply it prices at the global");
  assert.equal(t2.priorPersistedAdjustment, "0.05");
  const applied = applyOutcome(0.10, { t2: 0.05 }, 0.20);
  assert.ok(Math.abs(t2.resultingCustomerPrice - applied.get("t2")!) < 1e-9);
});

test("the projection asks the planner rather than composing its own rate", () => {
  // Structural: duplicated math would agree today and drift on the first
  // change to either side. The point of the repair is that only one place
  // decides what Apply persists.
  const src = readFileSync("src/lib/pricing-lift.ts", "utf8");
  assert.match(src, /planApply\(/, "must use the same planner as Apply");
  assert.doesNotMatch(
    src.replace(/\/\*[\s\S]*?\*\//g, ""),
    /composePricingAdjustment/,
    "must not compound a rate of its own",
  );
});

test("the preview panel's accept stages rather than committing a second time", () => {
  // It called `applyGlobalAdj`, writing one tier row per tier from the
  // preview's own figures — a third commit path re-creating the competing
  // authority. Accepting a preview now puts it in the working set.
  const shell = readFileSync("src/components/pricing-surface/pricing-surface-shell.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const fn = shell.slice(shell.indexOf("function onApplyGlobalPreview"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /stageGlobalAdj\(globalPreview\.proposedGlobalAdj\)/);
  assert.doesNotMatch(body, /applyGlobalAdj/);
});
