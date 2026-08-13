// T-1 regression coverage — customer-facing per-unit price basis.
//
// The defect: `tierGrand` divided by `pricedCount * tiers[ti].quantity`,
// where `pricedCount` is a ROW CARDINALITY (priced SKU rows), not a
// quantity. The printed per-unit came out at 1/N of the true value,
// N = priced row count. It was correct only at N = 1.
//
// Observed on Nemah quote f544128a (turnkey_only, 1,000 units, 3 priced
// leaf rows): total $12,000 correct, per-unit printed $4.00 where $12.00
// was owed.
//
// The invariant under test is the one the PDF prints for the customer in
// `customer-pdf-grand-total-row.tsx` ("the turnkey total divided by units
// shipped"):
//
//     perUnit × governed shipped quantity === total
//
// These tests assert the BASIS, not a golden number. A test that only
// checked `perUnit === 12` would also pass under a mean-component-price
// implementation on a symmetric fixture — hence the unequal-price and
// falsification cases below.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { tierGrand } from "../../src/components/pdf/customer-pdf-helpers.ts";
import type {
  CpdfServiceFee,
  CpdfSku,
  CpdfTier,
} from "../../src/components/pdf/customer-pdf-types.ts";

const NO_FEES: ReadonlyArray<CpdfServiceFee> = [];

const tier = (quantity: number, id = "t1"): CpdfTier => ({
  id,
  label: id.toUpperCase(),
  full: "Tier 1",
  quantity,
});

const sku = (id: string, ...tier_prices: Array<number | null>): CpdfSku => ({
  id,
  code: id,
  name: id,
  pack: null,
  tier_prices,
  shape: "flat",
});

/** The contract, stated once. Every case below asserts through this. */
function assertBasis(
  skus: ReadonlyArray<CpdfSku>,
  tiers: ReadonlyArray<CpdfTier>,
  ti: number,
  opts: { foldFees?: boolean; fees?: ReadonlyArray<CpdfServiceFee> } = {}
): { total: number; perUnit: number | null } {
  const { total, perUnit } = tierGrand(
    skus,
    tiers,
    ti,
    opts.foldFees ?? false,
    opts.fees ?? NO_FEES
  );
  assert.notEqual(perUnit, null, "priced tier must produce a per-unit");
  assert.ok(
    Math.abs(perUnit! * tiers[ti].quantity - total) < 1e-9,
    `perUnit × quantity must equal total — got ${perUnit} × ${tiers[ti].quantity} = ${perUnit! * tiers[ti].quantity}, total ${total}`
  );
  return { total, perUnit };
}

test("1 · N=1 priced row — the previously-correct case still holds", () => {
  const tiers = [tier(1000)];
  const { total, perUnit } = assertBasis([sku("A", 7.5)], tiers, 0);
  assert.equal(total, 7500);
  assert.equal(perUnit, 7.5);
});

test("2 · N>1 priced rows — the cardinality defect", () => {
  // The Nemah instance, exactly: 3 priced rows, 1,000 units, $12,000.
  // Pre-repair this returned 4 (12000 / (3 × 1000)).
  const tiers = [tier(1000)];
  const { total, perUnit } = assertBasis(
    [sku("bottle-A", 4), sku("box-A", 6), sku("bottle-B", 2)],
    tiers,
    0
  );
  assert.equal(total, 12_000);
  assert.equal(perUnit, 12, "12000 / 1000 — not 12000 / (3 × 1000)");
});

test("3 · unequal component prices — a mean-of-rows implementation must fail", () => {
  // Guards the specific wrong implementation the defect was algebraically
  // equivalent to: the mean of the per-row unit prices.
  const rows = [sku("a", 1), sku("b", 2), sku("c", 9)];
  const tiers = [tier(500)];
  const { perUnit } = assertBasis(rows, tiers, 0);
  const mean =
    rows.reduce((a, r) => a + (r.tier_prices[0] as number), 0) / rows.length;
  assert.equal(perUnit, 12, "sum of per-unit prices = 1 + 2 + 9");
  assert.notEqual(perUnit, mean, "must not be the mean of row prices (4)");
});

test("4 · multiple assemblies — leaves flatten, quantity stays shared", () => {
  // skuSet is leaf-level; leaves from different assemblies are flattened
  // into one list. Assembly count must not enter the denominator.
  const tiers = [tier(2500)];
  const { total, perUnit } = assertBasis(
    [
      sku("asmA-leaf1", 3),
      sku("asmA-leaf2", 5),
      sku("asmB-leaf1", 1),
      sku("asmB-leaf2", 1),
    ],
    tiers,
    0
  );
  assert.equal(perUnit, 10);
  assert.equal(total, 25_000);
});

test("5 · itemized — grand-total row basis (no folded fees)", () => {
  // `itemized` renders tierGrand via customer-pdf-grand-total-row.
  const tiers = [tier(1000), tier(5000, "t2")];
  const skus = [sku("a", 2, 1.8), sku("b", 3, 2.7)];
  const t0 = assertBasis(skus, tiers, 0);
  const t1 = assertBasis(skus, tiers, 1);
  assert.equal(t0.perUnit, 5);
  assert.equal(t1.perUnit, 4.5, "per-tier basis, not the first tier's");
  assert.equal(t1.total, 22_500);
});

test("6 · turnkey_only — same helper, fees folded into the all-in unit", () => {
  // `turnkey_only` renders tierGrand via customer-pdf-turnkey-summary with
  // foldFees true. One-time fees amortize across units shipped — which is
  // exactly what "blended all-in unit price" claims.
  const tiers = [tier(1000)];
  const fees: CpdfServiceFee[] = [
    { id: "f1", scope: "project", label: "Setup", sub: "", amount: 2000, qty_label: "" },
  ];
  const { total, perUnit } = assertBasis(
    [sku("a", 4), sku("b", 6), sku("c", 2)],
    tiers,
    0,
    { foldFees: true, fees }
  );
  assert.equal(total, 14_000);
  assert.equal(perUnit, 14, "(12000 + 2000) / 1000");
});

test("7 · non-integer currency result — rounding is display-only", () => {
  // 10,000 / 3,000 = 3.333… The BASIS must stay exact; only the formatter
  // rounds. Asserting the invariant here proves no rounding leaks into the
  // computation.
  const tiers = [tier(3000)];
  const { total, perUnit } = assertBasis(
    [sku("a", 1), sku("b", 1), sku("c", 1.333_333_333_333_333_3)],
    tiers,
    0
  );
  assert.ok(Math.abs(total - 10_000) < 1e-6);
  assert.ok(
    Math.abs(perUnit! - 3.333_333_333_333_333_3) < 1e-12,
    "unrounded basis"
  );
  assert.equal(perUnit!.toFixed(2), "3.33", "rounding happens at display");
});

test("8 · FALSIFICATION — the pre-repair denominator is provably different", () => {
  // Reconstructs `pricedCount × quantity`. If the repair were reverted,
  // `actual` would equal `preRepair` and this test would fail — which is
  // the point. Uses N > 1 and unequal prices so neither a cardinality nor
  // a mean implementation can slip through.
  const rows = [sku("a", 4), sku("b", 6), sku("c", 2)];
  const tiers = [tier(1000)];
  const { total, perUnit } = tierGrand(rows, tiers, 0, false, NO_FEES);

  const pricedCount = rows.filter((r) => r.tier_prices[0] != null).length;
  const preRepair = total / (pricedCount * tiers[0].quantity);

  assert.equal(preRepair, 4, "pre-repair produced $4.00 on this fixture");
  assert.equal(perUnit, 12, "post-repair produces $12.00");
  assert.notEqual(perUnit, preRepair);
  assert.equal(perUnit! / preRepair, pricedCount, "off by exactly N");
});

test("9 · no rows priced — stays null, never a governed $0.00", () => {
  // `perUnit === null` is the "total on request" signal read by
  // customer-pdf-grand-total-row.tsx:82. Preserved through the repair:
  // without the pricedCount guard, a fully-unpriced tier carrying folded
  // fees would print "from $0.00 /unit".
  const tiers = [tier(1000)];
  const fees: CpdfServiceFee[] = [
    { id: "f1", scope: "project", label: "Setup", sub: "", amount: 2000, qty_label: "" },
  ];
  const r = tierGrand([sku("a", null), sku("b", null)], tiers, 0, true, fees);
  assert.equal(r.hasUnpriced, true);
  assert.equal(r.perUnit, null, "no priced rows ⇒ no per-unit claim");
});

test("10 · partially priced — 'from $X' is a lower bound over all units", () => {
  // total covers priced rows only; quantity covers the whole tier. The
  // "from " prefix makes this a lower bound, which the invariant still
  // holds against. Semantics tracked as T-2.
  const tiers = [tier(1000)];
  const { total, perUnit } = assertBasis(
    [sku("a", 4), sku("b", null), sku("c", 2)],
    tiers,
    0
  );
  assert.equal(total, 6000);
  assert.equal(perUnit, 6);
});

test("11 · zero shipped quantity — no division", () => {
  const r = tierGrand([sku("a", 4)], [tier(0)], 0, false, NO_FEES);
  assert.equal(r.perUnit, null);
});
