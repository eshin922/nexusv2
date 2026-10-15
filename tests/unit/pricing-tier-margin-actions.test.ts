import assert from "node:assert/strict";
import test from "node:test";
import type { Cell } from "../../src/lib/pricing-classifier.ts";
import { tierExactMarginPrices, tierTargetLifts } from "../../src/lib/pricing-tier-margin-actions.ts";

function cell(overrides: Partial<Cell>): Cell {
  return {
    sku_id: "bottle", tier_id: 1, margin_pct: 0.2, sell_unit: 10, cost_unit: 8,
    recovery_unit: 0, lift_applied_pct: null, override_applied: false,
    ...overrides,
  } as Cell;
}

test("target lift stages only the chosen tier and leaves direct prices alone", () => {
  const actions = tierTargetLifts([
    cell({}), cell({ sku_id: "box", tier_id: 2 }),
    cell({ sku_id: "manual", override_applied: true }),
    cell({ sku_id: "already", sell_unit: 16, margin_pct: 0.5 }),
  ], 1, 0.3);
  assert.deepEqual(actions.map(({ cell }) => cell.sku_id), ["bottle"]);
  assert.ok(actions[0].value >= 8 / (1 - 0.3) / 10 - 1);
});

test("an existing lift is composed rather than replaced with an incremental percentage", () => {
  const [action] = tierTargetLifts([cell({ sell_unit: 11, margin_pct: 1 - 8 / 11, lift_applied_pct: 0.1 })], 1, 0.4);
  assert.ok(action.value > 0.1);
  assert.ok((10 * (1 + action.value)) >= 8 / (1 - 0.4));
});

test("custom margin sets each selected-tier direct price at storage precision", () => {
  const actions = tierExactMarginPrices([
    cell({}), cell({ sku_id: "box", cost_unit: 1.078, sell_unit: 1.5 }),
    cell({ sku_id: "other-tier", tier_id: 2 }),
  ], 1, 0.35);
  assert.equal(actions.length, 2);
  for (const { cell, value } of actions) {
    assert.ok(1 - cell.cost_unit! / value >= 0.35);
    assert.equal(value, Number(value.toFixed(4)));
  }
});
