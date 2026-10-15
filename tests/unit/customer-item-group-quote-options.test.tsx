import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomerViewLive } from "../../src/components/quote/customer-view-live.tsx";
import { PricingTable } from "../../src/components/pdf/customer-pdf-pricing-table.tsx";
import { TurnkeySummary } from "../../src/components/pdf/customer-pdf-turnkey-summary.tsx";
import { composeTierMoney } from "../../src/lib/customer-money.ts";
import type { CustomerView } from "../../src/types/quote.ts";
import type { CpdfSku, CpdfTier } from "../../src/components/pdf/customer-pdf-types.ts";

const group = {
  id: "group-1",
  name: "Finished kit",
  sku: "KIT-1",
  tierSummaries: [
    { unitPrice: 1.5, lineTotal: 150 },
    { unitPrice: 1.5, lineTotal: 300 },
  ],
};

const skus: CustomerView["skus"] = [
  { id: "member-a", itemGroup: group, label: "A-1", name: "Kit bottle", pack: null, unitsPerPack: 1, multiplicityPerUnit: null, tierPrices: [1, 1], tierLineTotals: [100, 200], tierQuantities: [100, 200], shape: "step↓" },
  { id: "member-b", itemGroup: group, label: "B-1", name: "Kit cap", pack: null, unitsPerPack: 1, multiplicityPerUnit: null, tierPrices: [0.5, 0.5], tierLineTotals: [50, 100], tierQuantities: [100, 200], shape: "step↓" },
  { id: "direct", itemGroup: null, label: "D-1", name: "Separate carton", pack: null, unitsPerPack: 1, multiplicityPerUnit: null, tierPrices: [0.25, 0.25], tierLineTotals: [25, 50], tierQuantities: [100, 200], shape: "step↓" },
];

const view: CustomerView = {
  vendor: { name: "The DPS", sub: "", address: "" },
  customer: { name: "Test customer", contact: null, role: null, email: null, address: null },
  quote: { quoteNumber: "DPS-TEST", projectTitle: null, sentDate: null, validUntil: null, paymentTerms: null, leadTime: null, customerFacingNotes: null, incoterms: null, tcs: null },
  preparedBy: null,
  tiers: [100, 200].map((quantity, index) => ({
    id: `tier-${index + 1}`,
    label: `Tier ${index + 1}`,
    quantity,
    money: composeTierMoney({ quantity, lineTotals: skus.map((sku) => sku.tierLineTotals[index]), feeAmounts: [], embeddedRecovery: null }),
  })),
  skus,
  serviceFees: [],
  freightLines: [],
  recommendedTierIdx: null,
  feeBasisTierIdx: 0,
  foldFeesIntoTotal: false,
  pdfLayout: "tier_table",
  detailLevel: "itemized",
  includeSpecAddendum: false,
  includeFeeLines: true,
  showItemGroupMembers: true,
  includeTerms: false,
  includeNote: false,
};

const count = (text: string, needle: string) => text.split(needle).length - 1;

function renderPreview(showItemGroupMembers: boolean) {
  return renderToStaticMarkup(<CustomerViewLive view={{ ...view, showItemGroupMembers }} />);
}

function renderPdfTable(showItemGroupMembers: boolean) {
  const tiers: CpdfTier[] = view.tiers.map((tier) => ({ ...tier, full: tier.label, recommended: false }));
  const pdfSkus: CpdfSku[] = skus.map((sku) => ({
    id: sku.id!, code: sku.label, name: sku.name, pack: sku.pack,
    item_group: sku.itemGroup ? { id: sku.itemGroup.id, name: sku.itemGroup.name, sku: sku.itemGroup.sku, tierSummaries: sku.itemGroup.tierSummaries } : null,
    included_services: [], multiplicity_per_unit: sku.multiplicityPerUnit,
    tier_prices: sku.tierPrices, tier_line_totals: sku.tierLineTotals,
    shape: sku.shape,
  })) as CpdfSku[];
  return renderToStaticMarkup(<PricingTable skus={pdfSkus} tiers={tiers} recommendedTierIdx={null} layout="tier_table" quoteNumber="DPS-TEST" showItemGroupMembers={showItemGroupMembers} />);
}

test("customer preview keeps one group total and direct item when member rows are hidden", () => {
  const shown = renderPreview(true);
  const hidden = renderPreview(false);
  for (const document of [shown, hidden]) {
    assert.equal(count(document, "Finished kit"), 1);
    assert.equal(count(document, "Group total $150.00"), 1);
    assert.equal(count(document, "Group total $300.00"), 1);
    assert.equal(count(document, "Separate carton"), 1);
    assert.ok(document.includes("$175.00"), "whole-quote tier total stays intact");
    assert.ok(document.includes("$350.00"), "second tier total stays intact");
  }
  assert.equal(count(shown, "Kit bottle"), 1);
  assert.equal(count(shown, "Kit cap"), 1);
  assert.equal(count(hidden, "Kit bottle"), 0);
  assert.equal(count(hidden, "Kit cap"), 0);
});

test("customer PDF table follows the same group-subitem option as the preview", () => {
  const shown = renderPdfTable(true);
  const hidden = renderPdfTable(false);
  for (const document of [shown, hidden]) {
    assert.equal(count(document, "Finished kit"), 1);
    assert.equal(count(document, "Group total $150.00"), 1);
    assert.equal(count(document, "Group total $300.00"), 1);
    assert.equal(count(document, "Separate carton"), 1);
  }
  assert.equal(count(shown, "Kit bottle"), 1);
  assert.equal(count(shown, "Kit cap"), 1);
  assert.equal(count(hidden, "Kit bottle"), 0);
  assert.equal(count(hidden, "Kit cap"), 0);
});

test("turnkey preview names the item group without exposing its members and leads with unit price", () => {
  const document = renderToStaticMarkup(<CustomerViewLive view={{ ...view, detailLevel: "turnkey_only" }} />);
  assert.equal(count(document, "Finished kit"), 1);
  assert.equal(count(document, "Separate carton"), 1);
  assert.equal(count(document, "Kit bottle"), 0);
  assert.equal(count(document, "Kit cap"), 0);
  assert.match(document, /pp-grand-num[^>]*>\$1\.75<span class="per"> \/unit<\/span>/);
  assert.match(document, /pp-grand-unit[^>]*>Order total \$175\.00/);
});

test("turnkey PDF names the group and standalone item without listing group members", () => {
  const tiers: CpdfTier[] = view.tiers.map((tier) => ({ ...tier, full: tier.label, recommended: false }));
  const pdfSkus: CpdfSku[] = skus.map((sku) => ({
    id: sku.id!, code: sku.label, name: sku.name, pack: sku.pack,
    item_group: sku.itemGroup ? { id: sku.itemGroup.id, name: sku.itemGroup.name, sku: sku.itemGroup.sku } : null,
    tier_prices: sku.tierPrices, tier_line_totals: sku.tierLineTotals, shape: sku.shape,
  }));
  const document = renderToStaticMarkup(<TurnkeySummary skuSet={pdfSkus} tiers={tiers} recommendedTierIdx={null} serviceFees={[]} layout="tier_table" foldFees={false} freightAtCost={false} allInUnit={true} partial={false} />);
  assert.equal(count(document, "Finished kit"), 1);
  assert.equal(count(document, "Separate carton"), 1);
  assert.equal(count(document, "Kit bottle"), 0);
  assert.equal(count(document, "Kit cap"), 0);
});
