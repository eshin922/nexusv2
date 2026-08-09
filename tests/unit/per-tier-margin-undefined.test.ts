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
    markupDefaults: { Manufacturing: 0.32, Primary: 0.4, Other: 0.3 },
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
    /marginPct === null\s*\n?\s*\?\s*"UNAVAILABLE"/.test(src),
    "the per-tier UNAVAILABLE branch must short-circuit before computeStatus",
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
  for (const option of ranked.options) {
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
  const withPreview = ranked.options.filter((o) => o.preview !== null);
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
      /marginStatus === "UNAVAILABLE" \? "incomplete" : marginStatus/,
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
