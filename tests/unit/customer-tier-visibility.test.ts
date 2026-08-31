import assert from "node:assert/strict";
import test from "node:test";

import { applyTierVisibility } from "../../src/lib/customer-tier-visibility.ts";
import type { CustomerView } from "../../src/types/quote.ts";

/**
 * Hiding a tier removes a COLUMN. It must not move a number.
 *
 * The danger is not the missing column — it is the wrong one. `CustomerView` is
 * index-aligned across six arrays and two index fields, so a filter that drops
 * a tier without dropping the same position everywhere prints one tier's price
 * under another tier's heading: a price the customer reads as belonging to a
 * quantity they were never quoted.
 */

const tier = (id: string, quantity: number, goods: number) => ({
  id,
  label: id.toUpperCase(),
  quantity,
  money: {
    goodsTotal: goods,
    feesTotal: 100,
    turnkeyTotal: goods + 100,
    perUnitGoods: goods / quantity,
    perUnitTurnkey: (goods + 100) / quantity,
    hasUnpricedLine: false,
    // Distinct per tier, so the filter is proven to carry each tier's OWN
    // disclosure rather than any tier's.
    embeddedRecovery: goods / 10,
  },
});

const view = (): CustomerView =>
  ({
    vendor: { name: "V", sub: "", address: "" },
    customer: { name: "C", contact: null, role: null, email: null, address: null },
    quote: {
      quoteNumber: null, projectTitle: null, sentDate: null, validUntil: null,
      paymentTerms: null, leadTime: null, customerFacingNotes: null,
      incoterms: null, tcs: null,
    },
    preparedBy: null,
    tiers: [tier("t1", 1000, 1000), tier("t2", 2000, 1800), tier("t3", 4000, 3200)],
    skus: [
      {
        label: "A", name: "A", pack: null, unitsPerPack: 1,
    multiplicityPerUnit: null,
        tierPrices: [1, 2, 3], tierLineTotals: [10, 20, 30], shape: "step↓",
      },
      {
        label: "B", name: "B", pack: null, unitsPerPack: 1,
    multiplicityPerUnit: null,
        tierPrices: [4, null, 6], tierLineTotals: [40, null, 60], shape: "partial",
      },
    ],
    serviceFees: [
      { id: "f", scope: "project", label: "F", sub: "", tierAmounts: [7, 8, 9], qtyLabel: "one-time" },
    ],
    freightLines: [
      { id: "fr", label: "FR", sub: "", qtyLabel: "per unit", tierAmounts: [0.1, 0.2, 0.3] },
    ],
    recommendedTierIdx: 1,
    feeBasisTierIdx: 1,
    foldFeesIntoTotal: true,
    pdfLayout: "tier_table",
    detailLevel: "itemized",
    includeSpecAddendum: false,
    includeFeeLines: true,
    includeTerms: true,
    includeNote: true,
  }) as CustomerView;

test("every index-aligned array drops the same position", () => {
  const out = applyTierVisibility(view(), ["t2"]);

  assert.deepEqual(out.tiers.map((t) => t.id), ["t1", "t3"]);
  assert.deepEqual(out.skus[0].tierPrices, [1, 3]);
  assert.deepEqual(out.skus[0].tierLineTotals, [10, 30]);
  assert.deepEqual(out.skus[1].tierPrices, [4, 6]);
  assert.deepEqual(out.skus[1].tierLineTotals, [40, 60]);
  assert.deepEqual(out.serviceFees[0].tierAmounts, [7, 9]);
  assert.deepEqual(out.freightLines[0].tierAmounts, [0.1, 0.3]);
});

test("a surviving tier's money is the object it was, untouched", () => {
  const before = view();
  const out = applyTierVisibility(before, ["t2"]);
  // Identity, not equality: proving no arithmetic happened is stronger than
  // proving the arithmetic produced the same answer.
  assert.equal(out.tiers[0].money, before.tiers[0].money);
  assert.equal(out.tiers[1].money, before.tiers[2].money);
});

test("the recommendation follows its tier, and vanishes with it", () => {
  // t2 is recommended (idx 1). Hiding t1 shifts it to 0.
  assert.equal(applyTierVisibility(view(), ["t1"]).recommendedTierIdx, 0);
  // Hiding t2 itself leaves no recommendation — not a stale index pointing at
  // whatever tier happens to sit there now, which is how a customer ends up
  // reading a star against a tier nobody recommended.
  assert.equal(applyTierVisibility(view(), ["t2"]).recommendedTierIdx, null);
});

test("the fee basis never points at a tier the customer cannot see", () => {
  // Fees are quoted FOR a column. If that column is hidden the amounts would be
  // quoted against a tier absent from the document.
  const out = applyTierVisibility(view(), ["t2"]);
  assert.equal(out.feeBasisTierIdx !== null, true);
  assert.ok(out.feeBasisTierIdx < out.tiers.length, "the basis must be a visible column");
  // t2 was both the recommendation and the basis; with both gone it falls back
  // to the first surviving column rather than a dangling index.
  assert.equal(out.feeBasisTierIdx, 0);
});

test("hiding nothing returns the projection unchanged", () => {
  const before = view();
  assert.equal(applyTierVisibility(before, []), before);
});

test("hiding every tier is refused rather than obeyed", () => {
  // A customer document with no priced column is not a quote. The action layer
  // refuses it too; this is the second line, because this function cannot know
  // who called it and an empty document is worse than a whole one.
  const before = view();
  const out = applyTierVisibility(before, ["t1", "t2", "t3"]);
  assert.equal(out, before);
  assert.equal(out.tiers.length, 3);
});

test("an unknown tier id changes nothing", () => {
  // A stale hidden-row for a tier that has since been deleted must not silently
  // drop a different column by position.
  const before = view();
  const out = applyTierVisibility(before, ["gone"]);
  assert.deepEqual(out.tiers.map((t) => t.id), ["t1", "t2", "t3"]);
  assert.equal(out.recommendedTierIdx, 1);
});
