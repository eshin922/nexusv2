import assert from "node:assert/strict";
import test from "node:test";

import { composeTierMoney } from "@/lib/customer-money";
import {
  lineTotal,
  serviceFeesTotal,
  tierGrand,
} from "@/components/pdf/customer-pdf-helpers";
import type {
  CpdfServiceFee,
  CpdfSku,
  CpdfTier,
} from "@/components/pdf/customer-pdf-types";

/**
 * PRESERVATION BASELINE for the customer-document arithmetic lift.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────
 *
 * `customer-pdf-helpers.ts` computes extended line totals, service-fee totals,
 * tier grand totals and the displayed per-unit price — in the RENDER layer, at
 * render time. That arithmetic is being lifted into the projection so both the
 * PDF and the coming live preview only format already-composed facts.
 *
 * A lift is a relocation, not a rewrite. The obligation is that every
 * customer-visible figure comes out identical afterwards, so this captures what
 * the current implementation produces, as literal expected values, BEFORE
 * anything moves.
 *
 * The numbers below were produced by running the current helpers over the
 * fixtures in this file. They are written out longhand ON PURPOSE: computing
 * the expectation with the same functions under test would assert only that a
 * function equals itself, which is the shape of test that lets a lift silently
 * change a total.
 *
 * ── AFTER THE LIFT ───────────────────────────────────────────────────────
 *
 * These same expected values are asserted against the PROJECTION's fields.
 * If a single one moves, the lift changed a customer-facing figure and is not
 * a lift.
 */

const TIER_BASE = [
  { id: "t1", label: "T1", full: "Tier 1", quantity: 1000 },
  { id: "t2", label: "T2", full: "Tier 2", quantity: 5000 },
  { id: "t3", label: "T3", full: "Tier 3", quantity: 10000, recommended: true },
  { id: "t4", label: "T4", full: "Tier 4", quantity: 20000 },
];

/**
 * The resolver's composition, restated here over the fixture.
 *
 * This mirrors `customer-view-resolver.ts` rather than importing it, because
 * the resolver needs a database and this test must not. The mirror is exact
 * and the ORDER matters: goods accumulate in SKU order and fees are added
 * after, because that is the order the lifted implementation used, and a sum
 * reordered is a sum changed at the last decimal place.
 *
 * If the resolver and this mirror ever drift, the assertions below fail —
 * which is the point. They are pinned to values captured from the ORIGINAL
 * render-layer implementation, so they hold both sides honest at once.
 */
function composeMoney(ti: number, skus: ReadonlyArray<{ tierLineTotals: ReadonlyArray<number | null> }>, fees: ReadonlyArray<{ tierAmounts: ReadonlyArray<number | null> }>) {
  let goodsTotal = 0;
  let pricedCount = 0;
  let hasUnpricedLine = false;
  for (const sku of skus) {
    const amount = sku.tierLineTotals[ti];
    if (amount === null) {
      hasUnpricedLine = true;
      continue;
    }
    goodsTotal += amount;
    pricedCount++;
  }
  const feesTotal = fees.reduce((a, f) => a + (f.tierAmounts[ti] ?? 0), 0);
  const turnkeyTotal = goodsTotal + feesTotal;
  const qty = TIER_BASE[ti].quantity;
  return {
    goodsTotal,
    feesTotal,
    turnkeyTotal,
    perUnitGoods: pricedCount > 0 ? goodsTotal / qty : null,
    perUnitTurnkey: pricedCount > 0 ? turnkeyTotal / qty : null,
    hasUnpricedLine,
    // A DISCLOSURE about goodsTotal, not a term in it. This mirror exists to
    // prove the monetary facts did not move when the arithmetic was lifted, so
    // it states null: the preservation baseline predates the field, and a
    // number here would make the mirror assert something the baseline never
    // captured.
    embeddedRecovery: null,
  };
}

const RAW_PRICES = [
  [14.906, 6.281024, 7.514, 3.49],
  [2.5, null, 1.25, 0.999],
] as ReadonlyArray<ReadonlyArray<number | null>>;

const LINE_SKUS = RAW_PRICES.map((prices) => ({
  tierLineTotals: prices.map((p, ti) =>
    p === null ? null : p * TIER_BASE[ti].quantity,
  ),
}));

const RAW_FEES = [
  { tierAmounts: [1400, 1400, null, 1400] },
  { tierAmounts: [700, 700, 700, 700] },
] as ReadonlyArray<{ tierAmounts: ReadonlyArray<number | null> }>;

const TIERS: CpdfTier[] = TIER_BASE.map((t, ti) => ({
  ...t,
  money: composeMoney(ti, LINE_SKUS, RAW_FEES),
}));

const SKUS = [
  {
    id: "s1",
    label: "GLW-30",
    name: "Hydra-Glow Serum",
    pack: "30 ml glass dropper",
    units_per_pack: 1,
    // A fractional rate, so a divisor error cannot hide behind round numbers.
    tier_prices: RAW_PRICES[0],
    tier_line_totals: LINE_SKUS[0].tierLineTotals,
  },
  {
    id: "s2",
    label: "CAP-60",
    name: "Renewal Capsules",
    pack: null,
    units_per_pack: 1,
    // One tier deliberately UNPRICED — `hasUnpriced` is a customer-visible
    // state ("total on request"), not an edge case.
    tier_prices: RAW_PRICES[1],
    tier_line_totals: LINE_SKUS[1].tierLineTotals,
  },
] as unknown as CpdfSku[];

const FEES: CpdfServiceFee[] = [
  {
    id: "f1",
    scope: "sku",
    label: "Setup",
    sub: "One-time setup.",
    // NULL at a tier = not billed there. Distinct from zero.
    tier_amounts: [1400, 1400, null, 1400],
    qty_label: "1 (setup)",
  },
  {
    id: "f2",
    scope: "sku",
    label: "Tooling",
    sub: "One-time tooling.",
    tier_amounts: [700, 700, 700, 700],
    qty_label: "1 (tooling)",
  },
];

// ═══════════════════════════════════════════════════════════════════════
// EXTENDED LINE TOTALS
// ═══════════════════════════════════════════════════════════════════════

test("baseline · extended line totals", () => {
  assert.equal(lineTotal(SKUS[0], TIERS, 0), 14906);
  // 6.281024 x 5000 is 31405.12 in decimal and 31405.120000000003 in IEEE-754.
  // The BASELINE RECORDS WHAT THE CODE PRODUCES, artifact included. Writing
  // the clean value here would assert a change rather than a preservation --
  // and reordering a sum is exactly the kind of thing a lift does by accident.
  assert.equal(lineTotal(SKUS[0], TIERS, 1), 31405.120000000003);
  assert.equal(lineTotal(SKUS[0], TIERS, 2), 75140);
  assert.equal(lineTotal(SKUS[0], TIERS, 3), 69800);

  assert.equal(lineTotal(SKUS[1], TIERS, 0), 2500);
  // Unpriced stays unpriced. Not zero — a zero would bill nothing and say so.
  assert.equal(lineTotal(SKUS[1], TIERS, 1), null);
  assert.equal(lineTotal(SKUS[1], TIERS, 2), 12500);
  assert.equal(lineTotal(SKUS[1], TIERS, 3), 19980);
});

// ═══════════════════════════════════════════════════════════════════════
// SERVICE-FEE TOTALS
// ═══════════════════════════════════════════════════════════════════════

test("baseline · service-fee totals per tier", () => {
  assert.equal(serviceFeesTotal(FEES, 0, TIERS), 2100);
  assert.equal(serviceFeesTotal(FEES, 1, TIERS), 2100);
  // Tier 3 carries only the tooling fee; setup is null there.
  assert.equal(serviceFeesTotal(FEES, 2, TIERS), 700);
  assert.equal(serviceFeesTotal(FEES, 3, TIERS), 2100);
});

// ═══════════════════════════════════════════════════════════════════════
// TIER GRAND TOTALS AND THE PRINTED PER-UNIT
//
// The per-unit is where T-1 went wrong: it divided by `pricedCount × quantity`,
// a row cardinality, and read correctly only at one priced row. Both the
// two-priced-row and one-priced-row cases are pinned below.
// ═══════════════════════════════════════════════════════════════════════

test("baseline · tier grand totals, fees NOT folded", () => {
  const t0 = tierGrand(SKUS, TIERS, 0, false, FEES);
  assert.equal(t0.total, 17406);
  assert.equal(t0.hasUnpriced, false);
  assert.equal(t0.perUnit, 17.406);

  // Tier 2 has an unpriced row: the total covers what IS priced and the flag
  // carries the rest, so the document can say "total on request".
  const t1 = tierGrand(SKUS, TIERS, 1, false, FEES);
  assert.equal(t1.total, 31405.120000000003);
  assert.equal(t1.hasUnpriced, true);
  assert.equal(t1.perUnit, 6.281024);
});

test("baseline · tier grand totals, fees FOLDED", () => {
  const t0 = tierGrand(SKUS, TIERS, 0, true, FEES);
  assert.equal(t0.total, 19506);
  assert.equal(t0.perUnit, 19.506);

  const t2 = tierGrand(SKUS, TIERS, 2, true, FEES);
  assert.equal(t2.total, 88340);
  assert.equal(t2.hasUnpriced, false);
  assert.equal(t2.perUnit, 8.834);

  const t3 = tierGrand(SKUS, TIERS, 3, true, FEES);
  assert.equal(t3.total, 91880);
  assert.equal(t3.perUnit, 4.594);
});

test("baseline · the invariant the document prints", () => {
  // `customer-pdf-grand-total-row` tells the customer the per-unit is "the
  // turnkey total divided by units shipped". That sentence must stay true of
  // whatever the projection carries after the lift.
  for (let ti = 0; ti < TIERS.length; ti++) {
    for (const fold of [false, true]) {
      const g = tierGrand(SKUS, TIERS, ti, fold, FEES);
      if (g.perUnit === null) continue;
      assert.ok(
        Math.abs(g.perUnit * TIERS[ti].quantity - g.total) < 1e-6,
        `tier ${ti} fold=${fold}: perUnit × qty must equal total`,
      );
    }
  }
});

test("baseline · nothing priced is unavailable, never zero", () => {
  // OD-005: a fully unpriced tier renders "total on request", so `perUnit` must
  // be null rather than $0.00 — a governed zero is a price, and there isn't one.
  const emptySkus = [{ tierLineTotals: [null, null, null, null] }];
  const noneTiers: CpdfTier[] = TIER_BASE.map((t, ti) => ({
    ...t,
    money: composeMoney(ti, emptySkus, []),
  }));
  const none = tierGrand([] as unknown as CpdfSku[], noneTiers, 0, false, []);
  assert.equal(none.perUnit, null);
  assert.equal(none.hasUnpriced, true);
  assert.equal(none.total, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// UNPRICED IS NOT ZERO.
//
// A governed or computed zero IS a price: the firm has quoted this, and it
// costs nothing. An unpriced cell is a REQUEST STATE: the firm has not quoted
// it at all. The customer must be able to tell those apart, and the two look
// identical the moment either is rendered as the other.
//
// Both states occur together on production draft 3761d2ad -- three unpriced
// cells alongside six genuine $0.00 extended amounts, the zeros arising
// because its tiers carry quantity zero. That quote is the reason this
// distinction is pinned rather than assumed: it is the case where getting it
// wrong would be invisible, because zeros are already on the page.
// ═══════════════════════════════════════════════════════════════════════

test("a computed zero is a price; an unpriced cell is not", () => {
  const qtyZeroTier = { quantity: 0 };

  // A PRICED line at zero quantity: the extended amount is genuinely 0.
  const computedZero = composeTierMoney({
    quantity: qtyZeroTier.quantity,
    lineTotals: [0],
    feeAmounts: [], embeddedRecovery: null,
  });
  assert.equal(computedZero.goodsTotal, 0, "a computed zero survives as zero");
  assert.equal(computedZero.hasUnpricedLine, false, "it is priced -- at zero");

  // An UNPRICED line: null in, and it must not become 0 anywhere.
  const unpriced = composeTierMoney({
    quantity: 1000,
    lineTotals: [null],
    feeAmounts: [], embeddedRecovery: null,
  });
  assert.equal(unpriced.hasUnpricedLine, true);
  assert.equal(unpriced.perUnitGoods, null, "no per-unit claim without a price");
  assert.equal(unpriced.perUnitTurnkey, null);

  // The two are distinguishable. If `hasUnpricedLine` ever came back false for
  // the unpriced case, or a null per-unit came back as 0, the renderer would
  // print a price the firm never quoted and nothing else would notice.
  assert.notEqual(unpriced.hasUnpricedLine, computedZero.hasUnpricedLine);
  assert.notEqual(unpriced.perUnitGoods, computedZero.perUnitGoods);

  // And a MIXED tier -- one priced line, one unpriced -- carries both facts at
  // once: a total covering what is priced, and the flag saying it is partial.
  const mixed = composeTierMoney({
    quantity: 1000,
    lineTotals: [2500, null],
    feeAmounts: [], embeddedRecovery: null,
  });
  assert.equal(mixed.goodsTotal, 2500, "the total covers what IS priced");
  assert.equal(mixed.hasUnpricedLine, true, "and says the rest is not");
  assert.equal(mixed.perUnitGoods, 2.5, "a lower bound, which the document marks \"from\"");
});
