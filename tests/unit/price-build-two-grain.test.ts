import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
const ZONE = "src/components/pricing-surface/detail-zone.tsx";
const SHELL = "src/components/pricing-surface/pricing-surface-shell.tsx";

/**
 * Two grains, because a unit price and an order-level charge are not the same
 * kind of fact.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * The Price Build ended at "Final quoted sell", which was quoted revenue per
 * unit — tier revenue divided by tier quantity. That divides separately-billed
 * one-time charges by the quantity and so states the customer pays them per
 * unit. They are billed ONCE, at the order, and the customer document says so.
 *
 * On 4781e4bb Tier 1 the difference is not cosmetic: the unit price is $13.82
 * and Final quoted sell read $23.2476, of which $9.4276 was order-level charges
 * amortised — including $1.7276 the quote cannot bill at all.
 *
 * Beneath it sat a "One-time charges $6,734" row reading
 * `costBreakdown.serviceFees` — the firm's COST, on a sell-side surface —
 * captioned "excluded from the per-unit figure above" while the figure above
 * included their amortised revenue. Both halves of that caption were false.
 */

test("Unit-price sell replaces Final quoted sell as the result", async () => {
  const src = codeOnly(await read(ZONE));
  assert.match(src, /band\("eq-result", "Unit-price sell", "result"\)/);
  assert.match(src, /<span className="n">Unit-price sell<\/span>/);
  // The row that carried quoted revenue per unit is gone from this build.
  assert.doesNotMatch(src, /row\("eq-quoted"/);
});

test("the per-SKU table keeps its own Final quoted sell, correctly", async () => {
  // Scoped deliberately. The per-SKU table's "Final quoted sell" reads the
  // ladder's terminal sell for one unit of that product — a genuine unit price,
  // with no tier-total division and so none of the amortisation this change
  // exists to remove.
  //
  // A check that forbade the phrase file-wide flagged that correct row, which is
  // the same over-broad-pattern error as forbidding `$0.00` in a comment: it
  // would have driven a rename of something that was already right.
  const src = codeOnly(await read(ZONE));
  assert.match(src, /band\("band-result", "Final quoted sell", "result"\)/);
  assert.match(src, /\(c\) => level\(c, "sell"\)/);
});

test("the cost-side One-time charges row is gone, field and all", async () => {
  const zone = codeOnly(await read(ZONE));
  const shell = codeOnly(await read(SHELL));
  for (const src of [zone, shell]) {
    assert.doesNotMatch(
      src,
      /oneTimeCharges/,
      "cost-side data must not feed a sell-side surface",
    );
  }
  assert.doesNotMatch(zone, /excluded from the per-unit figure above/);
  assert.doesNotMatch(zone, /costBreakdown\.serviceFees/);
});

test("separate charges are stated at tier amounts, never per unit", async () => {
  const src = codeOnly(await read(ZONE));
  const block = src.slice(src.indexOf('band("eq-sep"'), src.indexOf('band("eq-order"'));
  assert.match(block, /tier amounts, not per unit/);
  // Money at 2dp is the order-grain format; 4dp is the per-unit one. A charge
  // shown in the per-unit format would read as a rate.
  assert.match(block, /fmtUsd2\(/);
  assert.doesNotMatch(block, /fmtUsd4\(/);
  // And nothing divides them by quantity.
  assert.doesNotMatch(block, /\/\s*(qty|quantity)/);
});

test("the order bridge multiplies the GOVERNED figure, not the rounded one", async () => {
  // 5.8610 x 5,000 is 29,305.00 where the governed product is 29,305.12. An
  // order total disagreeing with the customer document by twelve cents would
  // be worse than a multiplicand carrying more precision than the row shows.
  const src = codeOnly(await read(ZONE));
  assert.match(src, /\(t\?\.unitPriceSell \?\? 0\) \* \(t\?\.qty \?\? 0\)/);
  const shell = codeOnly(await read(SHELL));
  assert.match(shell, /orderTotal: \(upsNode\?\.value \?\? 0\) \* qty \+ \(sepNode\?\.value \?\? 0\)/);
});

test("the surface reads the governed nodes and recomposes nothing", async () => {
  const shell = codeOnly(await read(SHELL));
  assert.match(shell, /findNode\("per-unit\/unit-price-sell"\)/);
  assert.match(shell, /findNode\("separate-charges"\)/);
  assert.match(shell, /findNode\("unbillable-recovery"\)/);
  // The lever rows ARE the node's operands — the surface does not decide which
  // levers acted, so a lever that did not act cannot produce a row.
  const zone = codeOnly(await read(ZONE));
  assert.match(zone, /unitPriceParts/);
  assert.doesNotMatch(zone, /adjDeltaPerUnit|liftDeltaPerUnit|overrideDeltaPerUnit/);
});

test("unbillable revenue is an error, and sums into nothing", async () => {
  const zone = codeOnly(await read(ZONE));
  assert.match(zone, /band\("eq-unbillable", "Not billable"/);
  assert.match(zone, /excluded from the totals above/);

  // Structural, not just copy: the engine keeps it out of the billed sum.
  const costing = codeOnly(await read("src/lib/costing.ts"));
  assert.match(costing, /isUnbillablePlacement\(ch\)\s*\?\s*unbillableChargeOperands\s*:\s*separateChargeOperands/);
});

test("one authority decides what is unbillable", async () => {
  // The engine states the fact and the resolver detects it for the send gate.
  // Two copies of the condition would be two authorities on whether a quote may
  // go out, free to disagree.
  const costing = codeOnly(await read("src/lib/costing.ts"));
  assert.match(costing, /import \{ isUnbillablePlacement \}/);
  assert.doesNotMatch(
    costing,
    /ownerKind === "direct_service" && \w+\.placement === "separate_line"/,
    "the rule must not be restated here",
  );
});
