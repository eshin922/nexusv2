/**
 * BV-010 — one answer to "blended margin".
 *
 * Three quantities shipped under that name. Two of them are the same governed
 * figure expressed twice; the third was a different number wearing the label.
 *
 *   A · engine `QuotePerTierRollup.blendedMarginPct` — (ΣR − ΣC) / ΣR
 *   B · graph `quote/{tier}/margin` — the OD-019 ratio
 *   C · classifier's former unweighted mean of per-cell margin PERCENTAGES
 *
 * A and B agreed on all 37 measurable tiers in production. C disagreed with
 * them on 18 of 37, by up to 2.29pp, while rendering under the heading
 * "BLENDED" — and none of that was visible, because each of the three was
 * individually plausible and no fixture made them disagree about anything that
 * mattered.
 *
 * That last clause is what this file is for. Agreement on today's data is not
 * the property worth pinning; a case where the three produce DIFFERENT POLICY
 * VERDICTS is, because it is the only kind of case that can tell a correct
 * implementation from one that merely inherits the old behaviour.
 *
 * THE FIXTURE ASSIGNS NO MARGINS. Every input is one an operator supplies: the
 * firm's real markup schedule, a global price adjustment, and a single
 * negotiated price on the hero component. The margins are whatever the engine
 * makes of them — which is the point, since a fixture that stated its outputs
 * could not have discovered that the straddle exists at all.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { quoteScopeKey, readNodeValue } from "../../src/lib/costing-nodes.ts";
import { classify } from "../../src/lib/pricing-classifier.ts";

const TIER = "tier-10k";
const TARGET = 0.35;
const FLOOR = 0.25;

/**
 * The firm's schedule as of 2026-08-10, not invented rates.
 *
 * Primary 0.45 and Secondary 0.50 are what `markup_defaults` actually holds,
 * and they are what makes the straddle reachable: cheap secondary components
 * carry a fatter markup than the expensive primary one, so an unweighted mean
 * of their margins sits well above a revenue-weighted blend.
 */
const MARKUPS = {
  Primary: 0.45,
  Secondary: 0.5,
  "Soft Goods": 0.35,
  Manufacturing: 0.3,
  Other: 0.3,
};

/**
 * A 50 ml serum. One expensive glass bottle carrying most of the revenue, and
 * five cheap secondary components — the ordinary shape of a cosmetics bill of
 * materials, and the reason the three quantities can diverge.
 */
const LEAVES = [
  { id: "bottle", name: "Glass bottle · 50ml amber", cost: 3.9, category: "Primary" },
  { id: "dropper", name: "Glass dropper · 50ml", cost: 0.15, category: "Primary" },
  { id: "label", name: "Wraparound label · 50ml", cost: 0.1, category: "Secondary" },
  { id: "carton", name: "Folding carton · 50ml", cost: 0.3, category: "Secondary" },
  { id: "insert", name: "Insert card", cost: 0.1, category: "Secondary" },
  { id: "band", name: "Shrink band", cost: 0.2, category: "Secondary" },
];

/**
 * @param negotiatedBottleSell a per-cell sell override — the PM affordance, used
 *   the way a PM uses it. $5.10 on a $3.90 bottle is a 30.8% markup where the
 *   schedule says 45%: the concession someone makes on a hero component.
 */
function input(negotiatedBottleSell: number | null, gpa: number): QuoteCostingInput {
  return {
    quote: { id: "q-straddle", globalPriceAdjPct: gpa, targetMarginPct: null },
    firmSettings: { targetMarginPct: TARGET, floorMarginPct: FLOOR },
    markupDefaults: MARKUPS,
    skus: LEAVES.map((l, i) => ({
      id: l.id,
      parentSkuId: null,
      qtyPerParent: null,
      skuRole: "leaf" as const,
      skuLabel: l.id.toUpperCase(),
      productName: l.name,
      sortOrder: i,
      retailBenchmark: null,
    })),
    tiers: [
      { id: TIER, label: "10K", qty: 10_000, sortOrder: 0, tierPriceAdjPct: null },
    ],
    packaging: LEAVES.map(
      (l) =>
        ({
          quoteSkuId: l.id,
          tierId: TIER,
          lineGroupId: `lg-${l.id}`,
          unitCost: l.cost,
          qtyPerSellableUnit: 1,
          category: l.category,
          // Schedule, not a manual override. The spread is the schedule's own.
          markupPct: null,
        }) satisfies CostingPackagingInput,
    ),
    production: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides:
      negotiatedBottleSell === null
        ? []
        : [
            {
              quoteSkuId: "bottle",
              tierId: TIER,
              sellPriceOverride: negotiatedBottleSell,
            },
          ],
    cellTargets: [],
  };
}

const R = computeQuoteCosting(input(5.1, 0.1), "committed");
const tier = R.quoteRollup[0];

const cellMargins = R.skuRollups
  .map((sr) => sr.perTier.find((p) => p.tierId === TIER)!.marginPct)
  .filter((m): m is number => m !== null);

const governed = tier.blendedMarginPct!;
const meanOfCells =
  cellMargins.reduce((s, m) => s + m, 0) / cellMargins.length;
const worstCell = Math.min(...cellMargins);

/** The policy reading of a margin. Floor and target, nothing else. */
function verdict(m: number): "below floor" | "below target" | "above target" {
  if (m < FLOOR) return "below floor";
  if (m < TARGET) return "below target";
  return "above target";
}

// ── the straddle ──────────────────────────────────────────────────────────

test("the three quantities produce three different policy verdicts", () => {
  // The whole point of the fixture. If this ever collapses to fewer than three
  // distinct verdicts, the fixture has stopped being adversarial and the tests
  // below are no longer proving what they claim.
  assert.equal(verdict(worstCell), "below floor");
  assert.equal(verdict(governed), "below target");
  assert.equal(verdict(meanOfCells), "above target");
});

test("the straddle has margin on both thresholds, so it is not knife-edge", () => {
  // A fixture that sits 0.1pp from a boundary passes today and flakes on any
  // change to markup defaults. These gaps are ~1.9pp and ~1.4pp.
  assert.ok(governed - FLOOR > 0.01, `governed ${governed} too close to floor`);
  assert.ok(TARGET - governed > 0.01, `governed ${governed} too close to target`);
  assert.ok(meanOfCells - TARGET > 0.01, `mean ${meanOfCells} too close to target`);
  assert.ok(FLOOR - worstCell > 0.01, `worst ${worstCell} too close to floor`);
});

test("nothing about the fixture was asserted into existence", () => {
  // Every margin is the engine's answer to costs, a schedule and one
  // negotiated price. Remove the negotiation and the divergence goes with it —
  // which is the evidence that the inputs, not the expectations, produced it.
  const plain = computeQuoteCosting(input(null, 0.1), "committed");
  const plainMargins = plain.skuRollups
    .map((sr) => sr.perTier.find((p) => p.tierId === TIER)!.marginPct)
    .filter((m): m is number => m !== null);
  const plainGoverned = plain.quoteRollup[0].blendedMarginPct!;
  const plainMean =
    plainMargins.reduce((s, m) => s + m, 0) / plainMargins.length;
  const distinct = new Set([
    verdict(plainGoverned),
    verdict(plainMean),
    verdict(Math.min(...plainMargins)),
  ]);
  assert.equal(distinct.size, 1, "unnegotiated, all three agree");
});

// ── A and B are one quantity ──────────────────────────────────────────────

test("the graph ratio and the engine rollup are the same governed number", () => {
  // Measured identical on all 37 readable production tiers. Pinned here so it
  // stays a property rather than a coincidence — the Cost Stack displays B and
  // takes its verdict from A, which is only sound while this holds.
  const fromGraph = readNodeValue(R.graph, quoteScopeKey(TIER, "margin"));
  assert.ok(fromGraph !== null);
  assert.ok(
    Math.abs(fromGraph - governed) < 1e-9,
    `graph ${fromGraph} vs rollup ${governed}`,
  );
});

test("and they agree on the adversarial case specifically", () => {
  // Not just on quiet data. This is the tier where the third quantity is 9.5pp
  // away and on the other side of the target.
  assert.ok(Math.abs(meanOfCells - governed) > 0.05);
  const fromGraph = readNodeValue(R.graph, quoteScopeKey(TIER, "margin"))!;
  assert.ok(Math.abs(fromGraph - governed) < 1e-9);
});

// ── the classifier no longer derives its own ──────────────────────────────

test("the classifier carries the engine's blend rather than averaging cells", () => {
  // Fed cells whose mean is nowhere near the supplied blend. Before BV-010 the
  // classifier computed the mean and called it blended; now it forwards what
  // it is given, so the output must be the input.
  const state = classify(
    {
      skus: [
        {
          id: "a",
          name: "A",
          cells: { 1: { margin_pct: 0.1, sell_unit: 1, cost_unit: 0.9 } },
        },
        {
          id: "b",
          name: "B",
          cells: { 1: { margin_pct: 0.9, sell_unit: 1, cost_unit: 0.1 } },
        },
      ],
      tiers: [
        {
          id: 1,
          qty: 1000,
          blended_margin_pct: 0.22,
          blended_status: "below_floor",
          blended_no_margin_reason: null,
        },
      ],
      blended_margin_pct: 0.22,
      recommended_tier_id: 1,
    },
    {
      target_margin_pct: TARGET,
      floor_margin_pct: FLOOR,
      allow_override: true,
      allow_accept_risk: true,
    },
  );
  const t = state.tiers[0];
  assert.equal(t.blended_margin_pct, 0.22, "forwarded, not averaged");
  assert.notEqual(t.blended_margin_pct, 0.5, "0.5 is the mean of the cells");
  assert.equal(t.blended_status, "below_floor");
  // Worst-cell compliance is untouched: the Per-tier table owns it and its
  // status pill still bands the worst cell, which is 10%.
  assert.equal(t.min_margin_pct, 0.1);
  assert.equal(t.status, "below_floor");
});

test("a tier with no engine blend reports unknown rather than a band", () => {
  const state = classify(
    {
      skus: [
        {
          id: "a",
          name: "A",
          cells: { 1: { margin_pct: 0.4, sell_unit: 1, cost_unit: 0.6 } },
        },
      ],
      tiers: [{ id: 1, qty: 1000 }],
      blended_margin_pct: null,
      recommended_tier_id: 1,
    },
    {
      target_margin_pct: TARGET,
      floor_margin_pct: FLOOR,
      allow_override: true,
      allow_accept_risk: true,
    },
  );
  // Absent is not zero and not a verdict. The old code would have reported the
  // single cell's 40% here, which is a different quantity entirely.
  assert.equal(state.tiers[0].blended_margin_pct, null);
  assert.equal(state.tiers[0].blended_status, "unknown");
});
