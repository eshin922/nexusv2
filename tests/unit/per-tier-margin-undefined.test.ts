/**
 * Per-tier blended margin is UNDEFINED at zero tier revenue.
 *
 * The twin of `quote-margin-undefined.test.ts`, carved from it deliberately:
 * two zero-revenue tiers sit inside quotes that are otherwise fully priced, so
 * correcting this moves quotes the quote-wide S-7 proof asserts do not move.
 * Folding them together would have made the two corrections inseparable in the
 * digest, and neither independently attributable.
 *
 * WHAT THIS ADDS BEYOND THE QUOTE-WIDE CASE
 *
 * The scalar and the status are the same shape. The interesting assertions are
 * the ones the quote-wide correction did not have to make:
 *
 *   - **The solver.** An unpriced tier used to arrive at `worstBelowTarget` as
 *     a fabricated 0%, which made it the worst below-target tier on any quote
 *     that had one. The lift was then sized to rescue a tier with no revenue
 *     to lift — a suggestion computed for, and named after, the wrong tier.
 *   - **The guards.** `markAccepted` and `markComplete` blocked such tiers via
 *     the floor check, on a fabricated verdict. Correcting the verdict would
 *     have RELEASED them as a side effect. They stay blocked on their own
 *     grounds, and that is asserted, because a correctness fix must not
 *     quietly loosen a guard.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { rankPricingSuggestions } from "../../src/lib/pricing-suggestions.ts";

const PRICED = "tier-priced";
const EMPTY = "tier-empty";
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
    tiers: [
      { id: PRICED, label: "Priced", qty: 1000, sortOrder: 0, tierPriceAdjPct: null },
      { id: EMPTY, label: "Empty", qty: 0, sortOrder: 1, tierPriceAdjPct: null },
    ],
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
    tierId: PRICED,
    lineGroupId: "line-1",
    unitCost: 10,
    qtyPerSellableUnit: 1,
    category: "Primary",
    markupPct: null,
    ...over,
  };
}

/**
 * One priced tier, one with no revenue — the production shape that made this
 * its own package. `52bd0077` "Tier 4" and `93a5d4bb` "Tier 2" are real
 * instances of exactly this: an empty tier inside a quote that sells.
 */
const MIXED = computeQuoteCosting(input({ packaging: [pkg()] }));

const tier = (id: string) => MIXED.quoteRollup.find((t) => t.tierId === id)!;

// ---------------------------------------------------------------- the scalar

test("a zero-revenue tier reports a null margin, not zero percent", () => {
  const t = tier(EMPTY);
  assert.equal(t.totalRevenue, 0);
  assert.equal(t.blendedMarginPct, null);
  assert.equal(t.blendedMarginStatus, "UNAVAILABLE");
});

test("the priced tier in the same quote is unaffected", () => {
  const t = tier(PRICED);
  assert.ok(t.totalRevenue > 0);
  assert.equal(typeof t.blendedMarginPct, "number");
  assert.notEqual(t.blendedMarginStatus, "UNAVAILABLE");
  assert.equal(
    t.blendedMarginPct,
    (t.totalRevenue - t.totalCost) / t.totalRevenue,
  );
});

test("computeStatus is not called for an undefined tier margin", () => {
  const src = readFileSync(
    new URL("../../src/lib/costing.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /marginPct === null\s*\n?\s*\?\s*zeroRevenueStatus\(cost\)/.test(src),
    "the per-tier zero-revenue branch must short-circuit before computeStatus",
  );
  assert.ok(
    /function zeroRevenueStatus\(cost: number\): QuoteMarginStatus \{\s*\n\s*return cost > 0 \? "COST_WITHOUT_REVENUE" : "UNAVAILABLE";/.test(
      src,
    ),
    "one helper must decide the zero-revenue verdict for both scopes, so they " +
      "cannot disagree about what zero revenue means",
  );
  assert.ok(
    !/const marginPct = revenue > 0 \? \(revenue - cost\) \/ revenue : 0;/.test(src),
    "the `: 0` fallback is back — that is the fabrication itself",
  );
});

// ----------------------------------------------------------------- the solver

test("an unpriced tier is not the worst below-target tier", () => {
  // The defect this prevents: at a fabricated 0%, the empty tier was the
  // lowest margin in the quote, so every suggestion was sized to lift it — a
  // tier whose revenue is zero and stays zero under any multiplicative lift.
  const ranked = rankPricingSuggestions({
    rollup: MIXED.quoteRollup,
    target: 0.35,
    floor: 0.25,
    recommendedTierId: null,
  });
  assert.notEqual(ranked, null, "expected suggestions to inspect");
  for (const option of ranked!.options) {
    assert.ok(
      !option.applyTo.includes(EMPTY) || option.applyTo.length > 1,
      `suggestion "${option.id}" targets the unpriced tier alone`,
    );
    assert.ok(
      !option.description.includes("Empty"),
      `suggestion "${option.id}" is named after the unpriced tier: ${option.description}`,
    );
  }
});

test("a tier with no margin previews as no margin, and as not having moved", () => {
  const ranked = rankPricingSuggestions({
    rollup: MIXED.quoteRollup,
    target: 0.9, // force a below-target state on the priced tier
    floor: 0.25,
    recommendedTierId: null,
  });
  assert.notEqual(ranked, null, "expected suggestions to inspect");
  const withPreview = ranked!.options.filter((o) => o.preview !== null);
  assert.ok(withPreview.length > 0, "no option produced a preview to check");
  for (const option of withPreview) {
    const row = option.preview!.find((p) => p.tierId === EMPTY)!;
    assert.equal(row.newMarginPct, null, "a lift cannot give an empty tier a margin");
    // Zero revenue times any lift is zero revenue. The tier does not move,
    // and 0 here is the true delta rather than a stand-in for an unknown.
    assert.equal(row.deltaPp, 0);
  }
});

test("a compliant quote with an unpriced tier suggests nothing at all", () => {
  // The clearest statement of the defect, and the reason it was not merely
  // cosmetic. With the priced tier above target, this quote has no problem —
  // so the engine returns null, meaning no banner, no options, nothing.
  const args = {
    rollup: MIXED.quoteRollup,
    target: 0.01,
    floor: 0.001,
    recommendedTierId: null,
  };
  assert.equal(rankPricingSuggestions(args), null);

  // The same quote as it looked BEFORE the correction: the empty tier
  // carrying a fabricated 0% and a BELOW_FLOOR verdict. The engine then finds
  // a below-floor tier, ranks surgical first, and proposes a lift — advice
  // about a tier with no revenue, on a quote that is already compliant.
  const asBefore = rankPricingSuggestions({
    ...args,
    rollup: MIXED.quoteRollup.map((t) =>
      t.tierId === EMPTY
        ? { ...t, blendedMarginPct: 0, blendedMarginStatus: "BELOW_FLOOR" as const }
        : t,
    ),
  });
  assert.notEqual(
    asBefore,
    null,
    "the pre-correction shape must still reproduce the defect, or this test " +
      "is not measuring the thing it claims to",
  );
  assert.equal(asBefore!.ranking, "surgical_first");
});

// ------------------------------------------------------------------ the guards

test("acceptance and completion stay blocked for an unpriced tier", () => {
  // Before this correction both guards caught these tiers via the floor check,
  // on a fabricated verdict. Correcting the verdict removes them from that
  // check — so each guard gained an explicit UNAVAILABLE clause. Without it,
  // a correctness fix would have silently made an unpriced tier acceptable.
  const accepted = readFileSync(
    new URL("../../src/app/actions/quotes.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /blendedMarginStatus === "UNAVAILABLE"[\s\S]{0,400}nothing to accept/.test(
      accepted,
    ),
    "markAccepted must reject an unassessable tier on its own grounds",
  );
  const complete = readFileSync(
    new URL("../../src/lib/netsuite/mark-complete.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /blendedMarginStatus === "UNAVAILABLE"[\s\S]{0,400}Cannot advance to complete/.test(
      complete,
    ),
    "markComplete must reject an unassessable tier on its own grounds",
  );
});

// ------------------------------------------------------- the display registers

test("UNAVAILABLE never takes the failing register", () => {
  // Four surfaces derived a colour or class with an else-branch that landed on
  // `bad`. A new member added to a union flows straight into every one of
  // those, and the result is legible, plausible, and says the opposite of the
  // truth: measured-and-failing where nothing was measured.
  const checks: Array<[string, RegExp, string]> = [
    [
      "src/components/costs/cost-stack-header.tsx",
      /marginStatus === "UNAVAILABLE"\s*\n?\s*\?\s*"incomplete"/,
      "the Costs header must route UNAVAILABLE to the incomplete register",
    ],
    [
      "src/components/quote-umbrella/tab-sales-order.tsx",
      /blendedMarginStatus === "UNAVAILABLE"\s*\n?\s*\?\s*"var\(--ink-3\)"/,
      "the sales-order tier list must not colour UNAVAILABLE as bad",
    ],
    [
      "src/app/projects/[id]/quotes/[quoteId]/mark-accepted/page.tsx",
      /blendedMarginStatus === "UNAVAILABLE"\s*\n?\s*\?\s*"none"/,
      "tier cards must not class UNAVAILABLE as bad",
    ],
    [
      "src/components/pricing/margin-verdict-pill.tsx",
      /UNAVAILABLE: ""/,
      "the verdict pill must use the neutral chip, not the bad tone",
    ],
  ];
  for (const [file, pattern, message] of checks) {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.ok(pattern.test(src), message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// The SECOND zero-revenue state: cost incurred, nothing priced against it
// ═══════════════════════════════════════════════════════════════════════════
//
// Zero revenue has two meanings, and only one of them is "nothing entered".
//
//   revenue = 0, cost = 0  →  UNAVAILABLE           · no commercial judgement
//   revenue = 0, cost > 0  →  COST_WITHOUT_REVENUE  · a certain loss
//
// The margin PERCENTAGE is undefined in both — no arithmetic recovers a ratio
// with zero in the denominator. What differs is what that says commercially,
// and the reason this is a distinct status rather than a flavour of the first
// is that the difference has to survive every consumer.
//
// Collapsing it into UNAVAILABLE files a loss under "nothing entered yet".
// Collapsing it into BELOW_FLOOR is wrong in the other direction: that label
// asserts a computed margin was compared against the floor and lost, and no
// such comparison happened. Both mislead; neither is available.

/**
 * Cost with no revenue: real quantity, real cost, sell price overridden to 0.
 *
 * Zero QUANTITY cannot produce this state — revenue and cost are both per-unit
 * figures times tier quantity, so qty = 0 zeroes them together. The state
 * needs quantity present and the price driven to nothing, which is exactly
 * what a per-cell override of 0 does: an override is terminal and bypasses
 * cost-plus-markup entirely.
 *
 * So this is not "an empty tier that happens to carry a fee". It is a tier
 * somebody has priced at zero while it still costs money to make.
 */
const LOSS = computeQuoteCosting(
  input({
    tiers: [
      { id: PRICED, label: "Priced", qty: 1000, sortOrder: 0, tierPriceAdjPct: null },
      { id: EMPTY, label: "Empty", qty: 1000, sortOrder: 1, tierPriceAdjPct: null },
    ],
    packaging: [pkg(), pkg({ tierId: EMPTY })],
    cellOverrides: [
      { quoteSkuId: LEAF, tierId: EMPTY, sellPriceOverride: 0 },
    ],
  }),
);

const lossTier = () => LOSS.quoteRollup.find((t) => t.tierId === EMPTY)!;

test("the fixture actually produces cost without revenue", () => {
  // Guarding the guard. If the fixture stopped generating cost on the empty
  // tier, every assertion below would pass against the UNAVAILABLE path and
  // report success for a state it never reached.
  const t = lossTier();
  assert.equal(t.totalRevenue, 0);
  assert.ok(t.totalCost > 0, `expected cost on the empty tier, got ${t.totalCost}`);
});

test("cost without revenue is its own status, and the margin is still undefined", () => {
  const t = lossTier();
  assert.equal(t.blendedMarginPct, null, "no ratio exists with zero revenue");
  assert.equal(t.blendedMarginStatus, "COST_WITHOUT_REVENUE");
  assert.notEqual(t.blendedMarginStatus, "UNAVAILABLE");
  assert.notEqual(t.blendedMarginStatus, "BELOW_FLOOR");
});

test("the two zero-revenue states are distinguished by cost alone", () => {
  // Identical on every observable the margin is built from — zero revenue, an
  // undefined margin — and different in verdict. Cost is the only thing
  // separating them, which is the discrimination the contract rests on.
  const empty = tier(EMPTY);
  const loss = lossTier();
  assert.equal(empty.totalRevenue, 0);
  assert.equal(loss.totalRevenue, 0);
  assert.equal(empty.blendedMarginPct, null);
  assert.equal(loss.blendedMarginPct, null);
  assert.equal(empty.totalCost, 0);
  assert.ok(loss.totalCost > 0);
  assert.equal(empty.blendedMarginStatus, "UNAVAILABLE");
  assert.equal(loss.blendedMarginStatus, "COST_WITHOUT_REVENUE");
});

// ------------------------------------------------------------------ solver

test("a loss tier gets no suggestion — no multiple of zero is anything else", () => {
  const ranked = rankPricingSuggestions({
    rollup: LOSS.quoteRollup,
    target: 0.35,
    floor: 0.25,
    recommendedTierId: null,
  });
  if (ranked) {
    for (const option of ranked.options) {
      assert.ok(
        !option.applyTo.includes(EMPTY) || option.applyTo.length > 1,
        `suggestion "${option.id}" targets the loss tier alone`,
      );
    }
  }
});

// ------------------------------------------------------------------ gating

test("a loss tier blocks accept-risk outright", () => {
  // The check must sit BEFORE the "nothing below target" early return.
  // Otherwise a quote whose only problem is an unpriced cost reports itself
  // clean — the gate's most dangerous possible answer.
  const ranked = rankPricingSuggestions({
    rollup: LOSS.quoteRollup,
    target: 0.01, // priced tier comfortably above target
    floor: 0.001,
    recommendedTierId: null,
  });
  assert.notEqual(ranked, null, "a loss tier must not produce a clean quote");
  assert.equal(ranked!.acceptRiskGating.available, false);
  assert.match(String(ranked!.acceptRiskGating.reason), /cost with no revenue/i);
});

test("the reason names the offending tier", () => {
  const ranked = rankPricingSuggestions({
    rollup: LOSS.quoteRollup,
    target: 0.35,
    floor: 0.25,
    recommendedTierId: null,
  });
  assert.match(String(ranked!.acceptRiskGating.reason), /Empty/);
});

test("a recommended tier in loss blocks accept-risk with its own reason", () => {
  const ranked = rankPricingSuggestions({
    rollup: LOSS.quoteRollup,
    target: 0.35,
    floor: 0.25,
    recommendedTierId: EMPTY,
  });
  assert.equal(ranked!.acceptRiskGating.available, false);
  assert.match(String(ranked!.acceptRiskGating.reason), /cost with no revenue/i);
});

// ------------------------------------------------------------------- guards

test("acceptance and completion block a loss tier on loss grounds", () => {
  const accepted = readFileSync(
    new URL("../../src/app/actions/quotes.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /blendedMarginStatus === "COST_WITHOUT_REVENUE"[\s\S]{0,500}certain loss/.test(
      accepted,
    ),
    "markAccepted must reject a loss tier and say why",
  );
  const complete = readFileSync(
    new URL("../../src/lib/netsuite/mark-complete.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /blendedMarginStatus === "COST_WITHOUT_REVENUE"[\s\S]{0,500}certain loss/.test(
      complete,
    ),
    "markComplete must reject a loss tier and say why",
  );
});

// ------------------------------------------------------------------ banding

/** The portfolio contract, mirrored — see the sibling in the quote-wide test. */
function bucket(
  rows: Array<{ blendedMarginPct: number | null; marginStatus: string }>,
  target: number,
  floor: number,
) {
  let good = 0, belowTarget = 0, belowFloor = 0, unassessed = 0, costWithoutRevenue = 0;
  for (const q of rows) {
    if (q.marginStatus === "COST_WITHOUT_REVENUE") costWithoutRevenue++;
    else if (q.blendedMarginPct === null) unassessed++;
    else if (q.blendedMarginPct >= target) good++;
    else if (q.blendedMarginPct >= floor) belowTarget++;
    else belowFloor++;
  }
  return { good, belowTarget, belowFloor, unassessed, costWithoutRevenue };
}

test("the two no-margin states are counted apart, and the portfolio still closes", () => {
  const rows = [
    { blendedMarginPct: 0.4, marginStatus: "GOOD" },
    { blendedMarginPct: 0.1, marginStatus: "BELOW_FLOOR" },
    { blendedMarginPct: null, marginStatus: "UNAVAILABLE" },
    { blendedMarginPct: null, marginStatus: "COST_WITHOUT_REVENUE" },
    { blendedMarginPct: null, marginStatus: "COST_WITHOUT_REVENUE" },
  ];
  const b = bucket(rows, 0.35, 0.25);
  assert.deepEqual(b, {
    good: 1,
    belowTarget: 0,
    belowFloor: 1,
    unassessed: 1,
    costWithoutRevenue: 2,
  });
  assert.equal(
    b.good + b.belowTarget + b.belowFloor + b.unassessed + b.costWithoutRevenue,
    rows.length,
  );
  // The specific mistake this prevents: two losing quotes filed under
  // "nothing entered yet" on the page the firm sets its margin policy from.
  assert.notEqual(b.unassessed, 3);
});

test("the production banding tells the two states apart", () => {
  const src = readFileSync(
    new URL("../../src/app/actions/firm-settings.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    /if \(q\.marginStatus === "COST_WITHOUT_REVENUE"\) costWithoutRevenue\+\+;/.test(src),
    "bucketQuotes must count the loss state separately, before the null check",
  );
  assert.ok(
    /costWithoutRevenue: number;/.test(src),
    "the loss count must be reported",
  );
});

// ------------------------------------------------------------------ display

test("no surface labels a loss as BELOW FLOOR or as merely unassessed", () => {
  // The label is the load-bearing part. `bad` tone is correct — it IS bad news
  // — but "below floor" asserts a comparison that never happened, and "not
  // assessed" understates a certain loss.
  const checks: Array<[string, RegExp, string]> = [
    [
      "src/components/pricing/margin-verdict-pill.tsx",
      /COST_WITHOUT_REVENUE: "COST, NO REVENUE"/,
      "the verdict pill must not reuse a band label",
    ],
    [
      "src/components/pricing/verdict-band.tsx",
      /cost with no revenue — every dollar is a loss/,
      "the Pricing verdict band must state the loss, not the floor",
    ],
    [
      "src/components/mark-accepted/margin-verdict.tsx",
      /COST, NO REVENUE/,
      "Mark-Accepted must distinguish the loss from UNAVAILABLE",
    ],
    [
      "src/components/costs/cost-stack-header.tsx",
      /cost_no_revenue/,
      "the Costs header must not route the loss to the incomplete register",
    ],
    [
      "src/components/quote-umbrella/tab-mark-accepted.tsx",
      /case "COST_WITHOUT_REVENUE": return "bad";/,
      "the umbrella chip must not give the loss a neutral token",
    ],
  ];
  for (const [file, pattern, message] of checks) {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.ok(pattern.test(src), message);
  }
});
