import assert from "node:assert/strict";
import test from "node:test";

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

const TIERS: CpdfTier[] = [
  { id: "t1", label: "Tier 1", quantity: 1000 },
  { id: "t2", label: "Tier 2", quantity: 5000 },
  { id: "t3", label: "Tier 3", quantity: 10000, recommended: true },
  { id: "t4", label: "Tier 4", quantity: 20000 },
];

const SKUS = [
  {
    id: "s1",
    label: "GLW-30",
    name: "Hydra-Glow Serum",
    pack: "30 ml glass dropper",
    units_per_pack: 1,
    // A fractional rate, so a divisor error cannot hide behind round numbers.
    tier_prices: [14.906, 6.281024, 7.514, 3.49],
  },
  {
    id: "s2",
    label: "CAP-60",
    name: "Renewal Capsules",
    pack: null,
    units_per_pack: 1,
    // One tier deliberately UNPRICED — `hasUnpriced` is a customer-visible
    // state ("total on request"), not an edge case.
    tier_prices: [2.5, null, 1.25, 0.999],
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
  assert.equal(lineTotal(SKUS[0].tier_prices[0], TIERS, 0), 14906);
  // 6.281024 x 5000 is 31405.12 in decimal and 31405.120000000003 in IEEE-754.
  // The BASELINE RECORDS WHAT THE CODE PRODUCES, artifact included. Writing
  // the clean value here would assert a change rather than a preservation --
  // and reordering a sum is exactly the kind of thing a lift does by accident.
  assert.equal(lineTotal(SKUS[0].tier_prices[1], TIERS, 1), 31405.120000000003);
  assert.equal(lineTotal(SKUS[0].tier_prices[2], TIERS, 2), 75140);
  assert.equal(lineTotal(SKUS[0].tier_prices[3], TIERS, 3), 69800);

  assert.equal(lineTotal(SKUS[1].tier_prices[0], TIERS, 0), 2500);
  // Unpriced stays unpriced. Not zero — a zero would bill nothing and say so.
  assert.equal(lineTotal(SKUS[1].tier_prices[1], TIERS, 1), null);
  assert.equal(lineTotal(SKUS[1].tier_prices[2], TIERS, 2), 12500);
  assert.equal(lineTotal(SKUS[1].tier_prices[3], TIERS, 3), 19980);
});

// ═══════════════════════════════════════════════════════════════════════
// SERVICE-FEE TOTALS
// ═══════════════════════════════════════════════════════════════════════

test("baseline · service-fee totals per tier", () => {
  assert.equal(serviceFeesTotal(FEES, 0), 2100);
  assert.equal(serviceFeesTotal(FEES, 1), 2100);
  // Tier 3 carries only the tooling fee; setup is null there.
  assert.equal(serviceFeesTotal(FEES, 2), 700);
  assert.equal(serviceFeesTotal(FEES, 3), 2100);
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
  const none = tierGrand(
    [{ ...SKUS[0], tier_prices: [null, null, null, null] }] as unknown as CpdfSku[],
    TIERS,
    0,
    false,
    [],
  );
  assert.equal(none.perUnit, null);
  assert.equal(none.hasUnpriced, true);
  assert.equal(none.total, 0);
});
