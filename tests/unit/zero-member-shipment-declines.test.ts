/**
 * A priced shipment with no recorded members declines, and is refused at send.
 *
 * THE REGRESSION THIS FIXES. The V1 freight distribution policy replaced
 * single-owner attribution with an equal split across the shipment's recorded
 * members. The first implementation threw when that set was empty — and one
 * live quote (`9af5fe52`, a $500 ocean shipment) had never had its membership
 * recorded, because under the previous rule it did not need to be: an assembly
 * leaf absorbed the cost. So a policy change turned a loadable quote into a
 * server error on every surface that costs it.
 *
 * WHY DECLINING IS NOT THE SAME AS IGNORING. Contributing nothing understates
 * the quote's freight, which would be a worse defect than the crash if it were
 * silent. It is not silent: it is a missing operator input, and it is refused
 * by the same gate that refuses an unentered freight amount. The pair is the
 * fix — either half alone is a defect, so both are asserted here together.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const loader = stripComments(readFileSync("src/app/actions/costing.ts", "utf8"));
const gate = stripComments(readFileSync("src/lib/quote-cost-completeness.ts", "utf8"));

test("neither loader path throws on an empty membership", () => {
  // Comments stripped first: the explanation of the removed throw quotes the
  // message it removed, and a check that reads its own rationale as evidence
  // of the defect would fail forever no matter what the code did.
  assert.doesNotMatch(
    loader,
    /members\.length === 0\s*\)?\s*\n?\s*throw/,
    "an empty membership must not throw — it takes the whole quote's costing with it",
  );
  // Both paths — draft and snapshot. Asserting the count is what stops a
  // partial revert passing: fixing the draft loader and leaving the historical
  // read to throw would make sent quotes unreadable while looking repaired.
  const declines = loader.match(/if \(members\.length === 0\) return \[\];/g) ?? [];
  assert.equal(declines.length, 2, "both the draft and snapshot paths must decline");
});

test("the send gate refuses a selected shipment with no members", () => {
  // Without this, declining is silent understatement — the quote prices as if
  // the freight did not exist and could be sent to a customer that way.
  assert.match(
    gate,
    // Bounded gap, not `[^)]*` — the arrow parameter `(row)` closes a paren
    // inside the call, so the negated class stopped before reaching the test.
    /memberships\.every\([\s\S]{0,60}?freightSubcategoryId !== subcategory\.id/,
    "the completeness gate must test membership",
  );
  // And it must be reachable: inside the per-subcategory loop, after the
  // destination check that `continue`s past unselected shipments.
  const loopBody = gate.slice(gate.indexOf("for (const subcategory of workbook.subcategories)"));
  assert.ok(
    loopBody.indexOf("memberships.every") > loopBody.indexOf("select exactly one valid destination"),
    "the membership check must sit after the destination guard, inside the loop",
  );
});

test("declining contributes no freight rather than a partial or zero-priced one", () => {
  // The engine's side of the contract. A shipment that reaches it with no
  // breaks must leave freight absent — not present and zero, which would read
  // to an operator as 'freight was considered and came to nothing'.
  const base: QuoteCostingInput = {
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [{ id: "leaf", canonicalQuoteLeafId: "ql", parentSkuId: null, qtyPerParent: null, skuRole: "leaf", skuLabel: "SKU", productName: "Product", sortOrder: 0, retailBenchmark: null }],
    tiers: [{ id: "tier", label: "100", qty: 100, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [], production: [],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    freightShipmentBreaks: [],
    cellOverrides: [], cellTargets: [],
  };

  const declined = computeQuoteCosting(base).skuRollups[0].perTier[0];
  assert.equal(declined.totalLandedFreightBeforeMarkup, 0);
  assert.equal(declined.freightLegs.length, 0);

  // And the control: the SAME quote with one member does carry the freight, so
  // the assertion above is about the empty membership and not about a fixture
  // that could never have shown freight in the first place.
  const withMember = computeQuoteCosting({
    ...base,
    freightShipmentBreaks: [{
      freightSubcategoryId: "ship", memberSkuId: "leaf", memberCount: 1,
      tierId: "tier", tierUnits: 100, treatment: "bundled",
      freightAmount: 500, freightMarkupPct: 0,
      dutyAmount: null, dutyMarkupPct: 0, tariffAmount: null, tariffMarkupPct: 0,
    }],
  }).skuRollups[0].perTier[0];
  assert.equal(withMember.totalLandedFreightBeforeMarkup, 5);
});
