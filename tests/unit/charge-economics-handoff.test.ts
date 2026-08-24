import assert from "node:assert/strict";
import test from "node:test";

import {
  computeQuoteCosting,
  type ChargeEconomics,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { OTC_COLUMN_TO_CHARGE } from "../../src/lib/commercial-recovery/registry.ts";

// ═══════════════════════════════════════════════════════════════════════
// THE EXPLICIT CHARGE HANDOFF.
//
// The cost layer states what a charge COSTS and what it WOULD RECOVER. The
// constructor decides where the recovery lives. Nothing here says anything
// about placement — that separation is the whole point, and these assert it
// rather than describe it.
//
// docs/commercial-sell-construction-design.md §3.
// ═══════════════════════════════════════════════════════════════════════

const FEES = {
  setupFeeTotal: 1000,
  toolingArtworkTotal: 2000,
  toolingTotal: 300,
  artworkTotal: 400,
  rdTotal: 500,
  testingMicrosTotal: 600,
  otherServiceTotal: 700,
};

function input(
  overrides: Partial<QuoteCostingInput["production"][number]> = {},
  markupDefaults: Record<string, number> = { Other: 0, Production: 0.4 },
): QuoteCostingInput {
  return {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults,
    skus: [
      {
        id: "leaf", parentSkuId: null, qtyPerParent: null, skuRole: "leaf" as const,
        skuLabel: "SKU", productName: "Product", sortOrder: 0, retailBenchmark: null,
      },
    ],
    tiers: [{ id: "tier", label: "100", qty: 100, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      {
        quoteSkuId: "leaf", tierId: "tier", lineGroupId: "packaging",
        unitCost: 2, qtyPerSellableUnit: 3, category: "Other", markupPct: 0,
      },
    ],
    production: [
      {
        quoteSkuId: "leaf", tierId: "tier",
        allocateServiceFeesToCost: true,
        fillingBlendingCost: 100, cmAssemblyTotal: 50, bulkRawCost: 200,
        actualUnitsProduced: null,
        ...FEES,
        ...overrides,
      },
    ],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } satisfies QuoteCostingInput;
}

const charges = (allocate: boolean, markups?: Record<string, number>): ChargeEconomics[] =>
  computeQuoteCosting(input({ allocateServiceFeesToCost: allocate }, markups))
    .skuRollups[0].perTier[0].chargeEconomics;

const byKey = (cs: ChargeEconomics[]) => new Map(cs.map((c) => [c.chargeKey, c]));

// ── emitted unconditionally ─────────────────────────────────────────────

test("charges are emitted identically at BOTH allocation states", () => {
  // A record that appeared only when the boolean was set would let a
  // constructor read PLACEMENT out of the presence of a row — the same
  // coupling recovery exists to break.
  const on = charges(true);
  const off = charges(false);
  assert.deepEqual(on, off, "the allocation boolean changed the charge handoff");
  assert.equal(on.length, Object.keys(FEES).length);
});

test("every governed column is represented, including one the projection never renders", () => {
  const m = byKey(charges(true));
  for (const [column, key] of Object.entries(OTC_COLUMN_TO_CHARGE)) {
    const c = m.get(key);
    assert.ok(c, `${key} (${column}) is absent from the handoff`);
    assert.equal(c.sourceColumn, column);
  }
  // `testingMicrosTotal` is not an OTC line in the projection. The cost layer
  // still has to hand its identity over: what is RENDERED and what a charge IS
  // are different questions.
  assert.equal(m.get("testing_micros")?.cost, FEES.testingMicrosTotal);
});

// ── cost and recovery, both stated ──────────────────────────────────────

test("cost is the governed column, unscaled and unamortised", () => {
  const m = byKey(charges(true));
  assert.equal(m.get("project_setup")?.cost, 1000);
  assert.equal(m.get("tooling_artwork_legacy")?.cost, 2000);
  assert.equal(m.get("tooling")?.cost, 300);
  // Not divided by the tier's 100 units. A one-time charge is billed once, and
  // amortising here only to multiply back out is the round trip that fails to
  // return the amount when qty_per_parent != 1.
});

test("recoverableSell is stated, not left to be derived", () => {
  const m = byKey(charges(true));
  for (const c of m.values()) {
    assert.equal(c.recoverableSell, c.cost * 1.4);
    assert.equal(c.rateCategory, "Production");
    assert.equal(c.ratePct, 0.4);
  }
  // Both numbers carried because neither follows from the other without the
  // rate — and a consumer that knows the rate is one that can drift from it.
});

test("an unresolvable rate gives NULL recovery, never zero", () => {
  // Zero would say the charge recovers nothing. The truth is that nothing
  // governs what it recovers (BV-013), and a constructor must be able to tell
  // those apart — it is the OD-027 distinction in the pricing layer.
  const m = byKey(charges(true, { Other: 0 }));
  for (const c of m.values()) {
    assert.equal(c.recoverableSell, null);
    assert.equal(c.rateCategory, null);
    assert.equal(c.ratePct, null);
    assert.ok(c.cost > 0, "cost is still known even when the rate is not");
  }
});

test("a column with no amount is not a charge", () => {
  const m = byKey(charges(true));
  const zeroed = computeQuoteCosting(
    input({ allocateServiceFeesToCost: true, rdTotal: 0, artworkTotal: null }),
  ).skuRollups[0].perTier[0].chargeEconomics;
  assert.ok(m.has("rd_formulation"));
  assert.equal(byKey(zeroed).has("rd_formulation"), false);
  assert.equal(byKey(zeroed).has("artwork_plate"), false);
  assert.equal(zeroed.length, Object.keys(FEES).length - 2);
});

// ── the handoff must not have changed anything ──────────────────────────

test("emitting charges moved no existing number", () => {
  // The increment is additive by construction: nothing reads chargeEconomics.
  // Asserted against the aggregates it is derived alongside, so a future edit
  // that wires it in without saying so fails here.
  const r = computeQuoteCosting(input({ allocateServiceFeesToCost: false }));
  const pt = r.skuRollups[0].perTier[0];
  const total = Object.values(FEES).reduce((a, b) => a + b, 0);

  // The pre-existing per-unit aggregate still equals the same total over the
  // tier's units, computed by the path that always computed it.
  assert.equal(Math.round(pt.separateServiceFeesPerUnit * 100 * 100) / 100, total);

  // And the handoff's costs sum to the same figure — two derivations of one
  // fact agreeing, which is what makes the handoff trustworthy to build on.
  const summed = pt.chargeEconomics.reduce((a, c) => a + c.cost, 0);
  assert.equal(summed, total);
});

test("the handoff carries no placement, by construction", () => {
  // If a placement field ever appears here, the cost layer has started
  // deciding something that belongs to the constructor.
  for (const c of charges(true)) {
    const keys = Object.keys(c).sort();
    assert.deepEqual(keys, [
      "chargeKey", "cost", "ratePct", "rateCategory", "recoverableSell", "sourceColumn",
    ].sort());
  }
});
