// Divergent allocation policy is modelled end to end at the math layer.
//
// `assembly_production_inputs.allocate_service_fees_to_cost` is keyed by
// `assembly_id`; costing consumes it per assembly and so does the customer-view
// resolver. These tests pin the CONSEQUENCE: each assembly's fee follows its
// own value, and one assembly's policy cannot move another's unit sell.
//
// AUTHORING is a separate question from MODELLING, and only the first was
// settled on 2026-08-17: for V1, `Allocate service fees to unit cost` is
// QUOTE-WIDE operator authority, set once from the Production section header
// and applied across all assemblies. V1 does not need operators to create new
// divergence.
//
// These tests are unaffected by that and are deliberately kept, because
// divergent rows may still exist and must not be silently misrepresented or
// destroyed. They are the proof that such a row still costs correctly. The
// per-assembly persistence itself is deferred architecture/accounting cleanup
// for the bounded Production/OTC workstream — nothing here presumes its
// outcome.
//
// THE OBSERVABLE IS UNIT SELL, not `separateServiceFeesPerUnit`.
// `computeLeafPerTier` sets `separateServiceFees = 0` unconditionally
// (`costing.ts`), because allocation-OFF fees are projected exactly once by the
// customer-view resolver, OUTSIDE unit cost and unit sell. So at this layer
// "did the fee allocate?" is answered by whether unit sell moves when the fee
// is present. The separate-charge projection is a resolver concern, covered by
// rendered proof 7 — not here.
import assert from "node:assert/strict";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type CostingProductionInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";

const A_LEAF = "leaf-a";
const B_LEAF = "leaf-b";
const A_ASM = "asm-a";
const B_ASM = "asm-b";
const TIER = "tier-1";
const QTY = 1000;

/** Magnitudes match docs/validation §2c so the two records agree. */
const FEE_A = 11_000; // allocation ON
const FEE_B = 17_000; // allocation OFF

const leaf = (id: string, parent: string) => ({
  id,
  parentSkuId: parent,
  qtyPerParent: 1,
  skuRole: "leaf" as const,
  skuLabel: id,
  productName: id,
  sortOrder: 0,
  retailBenchmark: null,
});
const asm = (id: string) => ({
  id,
  parentSkuId: null,
  qtyPerParent: null,
  skuRole: "assembly" as const,
  skuLabel: id,
  productName: id,
  sortOrder: 0,
  retailBenchmark: null,
});
const pkg = (leafId: string, cost: number): CostingPackagingInput =>
  ({
    id: `p-${leafId}`,
    quoteSkuId: leafId,
    tierId: TIER,
    lineGroupId: `lg-${leafId}`,
    category: "Primary",
    supplier: null,
    unitCost: cost,
    qtyPerSellableUnit: 1,
    markupPct: 0.4,
    markupPctSource: "manual_override",
    inventoryEligible: false,
    purchaseQty: null,
    notes: null,
    sortOrder: 0,
  }) as CostingPackagingInput;
const prod = (
  leafId: string,
  alloc: boolean,
  setup: number
): CostingProductionInput => ({
  quoteSkuId: leafId,
  tierId: TIER,
  customerShipsRaws: false,
  allocateServiceFeesToCost: alloc,
  fillingBlendingCost: 0,
  cmAssemblyTotal: 0,
  setupFeeTotal: setup,
  toolingArtworkTotal: 0,
  rdTotal: 0,
  otherServiceTotal: 0,
  bulkRawCost: null,
  actualUnitsProduced: null,
});

function input(
  allocA: boolean,
  allocB: boolean,
  feeA = FEE_A,
  feeB = FEE_B
): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.32, Manufacturing: 0.32, Primary: 0.4, Other: 0.3 },
    skus: [asm(A_ASM), leaf(A_LEAF, A_ASM), asm(B_ASM), leaf(B_LEAF, B_ASM)],
    tiers: [
      { id: TIER, label: "T1", qty: QTY, sortOrder: 0, tierPriceAdjPct: null },
    ],
    packaging: [pkg(A_LEAF, 3), pkg(B_LEAF, 5)],
    production: [prod(A_LEAF, allocA, feeA), prod(B_LEAF, allocB, feeB)],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: [],
    cellTargets: [],
  };
}

const sell = (i: QuoteCostingInput, leafId: string) =>
  computeQuoteCosting(i)
    .skuRollups.find((s) => s.skuId === leafId)!
    .perTier.find((p) => p.tierId === TIER)!.requiredSellPerUnit;

/** Did THIS leaf's fee reach unit sell? Present-vs-absent, same policy. */
const feeInSell = (a: boolean, b: boolean, leafId: string) => {
  const withFee = sell(input(a, b), leafId);
  const without =
    leafId === A_LEAF
      ? sell(input(a, b, 0, FEE_B), A_LEAF)
      : sell(input(a, b, FEE_A, 0), B_LEAF);
  return withFee - without > 1e-9;
};

const shape = (a: boolean, b: boolean) => [
  feeInSell(a, b, A_LEAF),
  feeInSell(a, b, B_LEAF),
];

test("1 · A=true and B=false are modelled simultaneously", () => {
  // The storage model expresses this whether or not any UI does. V1 authoring
  // is quote-wide, so a divergent pair now arrives only from existing data —
  // and it still has to cost correctly when it does.
  assert.deepEqual(shape(true, false), [true, false]);
});

test("2 · A's allocated fee enters A's unit sell exactly once", () => {
  const withFee = sell(input(true, false), A_LEAF);
  const without = sell(input(true, false, 0, FEE_B), A_LEAF);
  const delta = withFee - without;
  const amortised = FEE_A / QTY;
  assert.ok(delta > 0, `allocating should raise A's sell, got ${delta}`);
  assert.ok(
    delta >= amortised - 1e-6,
    `at least cost (${amortised}), got ${delta}`
  );
  assert.ok(
    delta <= amortised * 2,
    `entered more than once — ${delta} vs ${amortised}`
  );
});

test("3 · B's non-allocated fee stays out of unit sell", () => {
  assert.equal(
    sell(input(true, false), B_LEAF),
    sell(input(true, false, FEE_A, 0), B_LEAF),
    "removing B's unallocated fee must not move B's unit sell"
  );
});

test("4 · toggling A does not change B", () => {
  assert.equal(
    sell(input(true, false), B_LEAF),
    sell(input(false, false), B_LEAF),
    "B's sell unchanged when only A's policy flips"
  );
  assert.equal(feeInSell(true, false, B_LEAF), feeInSell(false, false, B_LEAF));
});

test("5 · toggling B does not change A", () => {
  assert.equal(
    sell(input(true, false), A_LEAF),
    sell(input(true, true), A_LEAF),
    "A's sell unchanged when only B's policy flips"
  );
  assert.equal(feeInSell(true, false, A_LEAF), feeInSell(true, true, A_LEAF));
});

test("6 · uniform quotes are untouched", () => {
  // Both-ON and both-OFF are the only shapes V1 authoring can produce, so they
  // are the everyday path as well as the regression surface.
  assert.deepEqual(shape(true, true), [true, true]);
  assert.deepEqual(shape(false, false), [false, false]);
});

test("7 · FALSIFICATION — no uniform value reproduces the divergent shape", () => {
  // Why a divergent row cannot be approximated by the quote-wide value: neither
  // all-ON nor all-OFF produces what A=ON/B=OFF produces. So a display that
  // rounded `mixed` to either one would be stating something false about money,
  // which is what `mixed by product` exists to prevent.
  const divergent = shape(true, false);
  assert.notDeepEqual(shape(true, true), divergent);
  assert.notDeepEqual(shape(false, false), divergent);
});
