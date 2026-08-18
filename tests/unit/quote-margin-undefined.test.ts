/**
 * Quote-wide blended margin is UNDEFINED at zero revenue, not zero percent.
 *
 * THE DEFECT THIS LOCKS OUT
 *
 *   `blendedRevenue === 0` produced `blendedMarginPct = 0`. That synthetic zero
 *   went straight into `computeStatus`, which correctly reported that 0% is
 *   below a 25% floor — and so eight quotes stood accused of breaching the
 *   firm's margin policy because nobody had entered revenue on them yet. The
 *   firm-settings impact analysis then counted them, so a policy change was
 *   evaluated partly against quotes that had never been priced.
 *
 *   Every step downstream of the first was correct. That is what made it
 *   durable: nothing was broken except the premise.
 *
 * WHAT IS ASSERTED, AND WHY EACH IS SEPARATE
 *
 *   1. The scalar is null. (The quantity does not exist.)
 *   2. The status is UNAVAILABLE. (Nullability alone would have moved the
 *      fabrication one field over — a null margin banded by a status that
 *      still had to pick one of three.)
 *   3. `computeStatus` is never reached for it. Asserted structurally against
 *      the source, because a future edit could restore a `?? 0` and satisfy
 *      1 and 2 for one release while quietly re-fabricating the verdict.
 *   4. Banding EXCLUDES it, and the excluded count is reported rather than
 *      absorbed — so the portfolio arithmetic still closes.
 *   5. Revenue-bearing quotes are untouched. The correction must be confined
 *      to the undefined case; if it moved a real margin it would be a
 *      commercial change wearing a bug fix's clothes.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";

const TIER = "tier-1";
const LEAF = "leaf-1";

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.32, Manufacturing: 0.32, Primary: 0.4, Other: 0.3 },
    skus: [
      {
        id: LEAF,
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "leaf",
        skuLabel: "SKU-1",
        productName: "Test leaf",
        sortOrder: 0,
        retailBenchmark: null,
      },
    ],
    tiers: [{ id: TIER, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [],
    production: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: [],
    cellTargets: [],
    ...over,
  };
}

function pkg(over: Partial<CostingPackagingInput> = {}): CostingPackagingInput {
  return {
    quoteSkuId: LEAF,
    tierId: TIER,
    lineGroupId: "line-1",
    unitCost: 10,
    qtyPerSellableUnit: 1,
    category: "Primary",
    markupPct: null,
    ...over,
  };
}

/** No cost data anywhere: nothing to sell, so no revenue and no margin. */
const NO_REVENUE = input();

/** Ordinary priced quote — the control. */
const PRICED = input({ packaging: [pkg()] });

// ---------------------------------------------------------------- the scalar

test("zero blended revenue yields a null margin, not zero percent", () => {
  const r = computeQuoteCosting(NO_REVENUE);
  assert.equal(r.quoteSummary.blendedRevenue, 0);
  assert.equal(
    r.quoteSummary.blendedMarginPct,
    null,
    "0 would assert a margin of exactly zero on a quote that has none",
  );
});

test("the verdict is UNAVAILABLE, not a band", () => {
  const r = computeQuoteCosting(NO_REVENUE);
  assert.equal(r.quoteSummary.blendedMarginStatus, "UNAVAILABLE");
});

test("an undefined margin carries no suggestion", () => {
  const s = computeQuoteCosting(NO_REVENUE).quoteSummary;
  // There is no gap to close, so there is nothing to propose. A suggested
  // adjustment here would be advice about a quantity that does not exist.
  assert.equal(s.suggestedAdj, null);
  assert.equal(s.suggestionGoal, null);
  assert.equal(s.suggestionMicrocopy, "");
});

// ------------------------------------------------- the status is not computed

test("computeStatus is not called for an undefined margin", () => {
  // Structural, deliberately. Assertions 1 and 2 can both pass while the
  // status is derived from a stand-in — that is exactly the shape of the
  // original defect, where a fabricated number was banded correctly. This
  // pins the branch itself.
  const src = readFileSync(
    new URL("../../src/lib/costing.ts", import.meta.url),
    "utf8",
  );
  // The branch was later refined: the zero-revenue verdict is decided by
  // `zeroRevenueStatus`, which distinguishes an empty quote (UNAVAILABLE) from
  // one carrying cost with no revenue (COST_WITHOUT_REVENUE). What this test
  // pins is unchanged — computeStatus must not be reached with a placeholder.
  const guard =
    /blendedMarginPct === null\s*\?\s*zeroRevenueStatus\(blendedCost\)\s*:\s*computeStatus\(/;
  assert.ok(
    guard.test(src),
    "the UNAVAILABLE branch must short-circuit before computeStatus, " +
      "not pass it a placeholder margin",
  );
  assert.ok(
    !/blendedRevenue > 0 \? \(blendedRevenue - blendedCost\) \/ blendedRevenue : 0\b/.test(
      src,
    ),
    "the `: 0` fallback is back — that is the fabrication itself",
  );
});

// ------------------------------------------------------- the control is intact

test("a revenue-bearing quote is unaffected", () => {
  const s = computeQuoteCosting(PRICED).quoteSummary;
  assert.ok(s.blendedRevenue > 0);
  assert.equal(typeof s.blendedMarginPct, "number");
  assert.notEqual(s.blendedMarginStatus, "UNAVAILABLE");
  // The formula is unchanged for every quote that has one.
  assert.equal(
    s.blendedMarginPct,
    (s.blendedRevenue - s.blendedCost) / s.blendedRevenue,
  );
});

// ------------------------------------------------------------------- banding

/**
 * The banding contract, as the firm-settings portfolio applies it.
 *
 * Mirrored here rather than imported because `actions/firm-settings.ts` pulls
 * in the database and the Clerk admin guard. The structural test below pins
 * the production copy to this shape so the mirror cannot drift into being a
 * second, kinder implementation.
 */
function bucket(
  margins: Array<number | null>,
  target: number,
  floor: number,
): { good: number; belowTarget: number; belowFloor: number; unassessed: number } {
  let good = 0;
  let belowTarget = 0;
  let belowFloor = 0;
  let unassessed = 0;
  for (const m of margins) {
    if (m === null) unassessed++;
    else if (m >= target) good++;
    else if (m >= floor) belowTarget++;
    else belowFloor++;
  }
  return { good, belowTarget, belowFloor, unassessed };
}

test("unassessed quotes are excluded from every band", () => {
  const b = bucket([0.4, 0.3, 0.1, null, null], 0.35, 0.25);
  assert.deepEqual(b, {
    good: 1,
    belowTarget: 1,
    belowFloor: 1,
    unassessed: 2,
  });
  // The count that used to be wrong. Before the correction the two nulls were
  // zeroes and landed here, reporting three floor breaches where there is one.
  assert.equal(b.belowFloor, 1);
});

test("the bands and the exclusion account for the whole portfolio", () => {
  const margins = [0.5, 0.36, 0.35, 0.34, 0.25, 0.2, null, null, null];
  const b = bucket(margins, 0.35, 0.25);
  assert.equal(
    b.good + b.belowTarget + b.belowFloor + b.unassessed,
    margins.length,
    "excluding without reporting would make the portfolio smaller than itself",
  );
});

test("a zero margin is still a real margin and still bands", () => {
  // The distinction the whole correction rests on: 0% is a genuine, terrible
  // margin and belongs in belowFloor. `null` is the absence of one and does
  // not. Collapsing them is what went wrong.
  const b = bucket([0, null], 0.35, 0.25);
  assert.equal(b.belowFloor, 1);
  assert.equal(b.unassessed, 1);
});

test("the production banding matches this contract", () => {
  const src = readFileSync(
    new URL("../../src/app/actions/firm-settings.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /if \(q\.blendedMarginPct === null\) unassessed\+\+;/.test(src),
    "bucketQuotes must exclude null before comparing it to any threshold",
  );
  assert.ok(
    /if \(m === null\) continue;/.test(src),
    "the reband preview must skip unassessed quotes — a policy change cannot " +
      "move a quote that has no margin to move",
  );
  assert.ok(
    /unassessed: number;/.test(src),
    "the excluded count must be reported, not silently dropped",
  );
});

// ---------------------------------------------------- no second derivation

test("the classifier does not re-derive the blended margin", () => {
  const src = readFileSync(
    new URL(
      "../../src/components/pricing-surface/pricing-classifier-context.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  // Both the committed and the preview read used to compute
  // `1 - cost / revenue` locally. They agreed with the engine on every
  // revenue-bearing quote, which is precisely why they survived — and
  // disagreed on the eight that mattered.
  assert.ok(
    !/1 - cost \/ revenue/.test(src),
    "a local blended-margin formula is back in the classifier",
  );
  assert.ok(
    !/1 -\s*totalCost \/ totalRevenue/.test(src),
    "a local blended-margin formula is back in the classifier",
  );
  assert.ok(
    /const blendedMarginPct = quoteSummary\.blendedMarginPct;/.test(src),
    "the committed read must come from the engine's summary",
  );
  assert.ok(
    /return result\.quoteSummary\.blendedMarginPct;/.test(src),
    "the preview read must come from the preview run's summary",
  );
});
