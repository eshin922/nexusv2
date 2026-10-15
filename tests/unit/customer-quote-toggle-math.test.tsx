import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CustomerViewLive } from "../../src/components/quote/customer-view-live.tsx";
import { includeAssociatedServicesInProductRows } from "../../src/lib/associated-service-presentation.ts";
import { composeTierMoney } from "../../src/lib/customer-money.ts";
import type { CommercialLine } from "../../src/lib/commercial-projection.ts";
import type { CustomerView, CustomerViewSku } from "../../src/types/quote.ts";

const quantities = [100, 200];
const rates = [
  [10, 9],   // product
  [2, 1.5],  // service associated with that product
  [3, 2.5],  // standalone service
];
const names = ["Finished bottle", "Filling / Blending", "Quality inspection"];
const identities = ["product", "associated-service", "standalone-service"];

const rows: CustomerViewSku[] = identities.map((id, index) => ({
  id,
  label: id.toUpperCase(),
  name: names[index],
  pack: null,
  unitsPerPack: 1,
  multiplicityPerUnit: null,
  tierPrices: rates[index],
  tierLineTotals: rates[index].map((rate, tier) => rate * quantities[tier]),
  tierQuantities: quantities,
  shape: "step↓",
}));
const lines: CommercialLine[] = identities.map((id, index) => ({
  key: id,
  quoteLeafId: id,
  kind: index === 0 ? "direct_product" : "direct_service",
  associatedProductQuoteLeafId: index === 1 ? "product" : null,
  displayName: names[index],
  cells: rates[index].map((rate, tier) => ({
    state: "priced" as const,
    unitRate: rate,
    quantity: quantities[tier],
    lineAmount: rate * quantities[tier],
  })),
} as CommercialLine));

function quote(includeAssociated: boolean, detailLevel: CustomerView["detailLevel"], includeFeeLines: boolean): CustomerView {
  const skus = includeAssociated ? includeAssociatedServicesInProductRows(lines, rows) : rows;
  return {
    vendor: { name: "The DPS", sub: "", address: "" },
    customer: { name: "Customer", contact: null, role: null, email: null, address: null },
    quote: { quoteNumber: "DPS-TEST", projectTitle: null, sentDate: null, validUntil: null, paymentTerms: null, leadTime: null, customerFacingNotes: null, incoterms: null, tcs: null },
    preparedBy: null,
    tiers: quantities.map((quantity, tier) => ({
      id: `tier-${tier}`,
      label: `Tier ${tier + 1}`,
      quantity,
      money: composeTierMoney({
        quantity,
        lineTotals: skus.map((sku) => sku.tierLineTotals[tier]),
        feeAmounts: [tier === 0 ? 50 : 75],
        embeddedRecovery: null,
      }),
    })),
    skus,
    serviceFees: [{ id: "setup", scope: "project", label: "Setup fee", sub: "", tierAmounts: [50, 75], qtyLabel: "1" }],
    freightLines: [],
    recommendedTierIdx: null,
    feeBasisTierIdx: 0,
    foldFeesIntoTotal: true,
    pdfLayout: "tier_table",
    detailLevel,
    includeSpecAddendum: false,
    includeFeeLines,
    showItemGroupMembers: true,
    includeTerms: false,
    includeNote: false,
  };
}

test("turnkey, fee-itemization, and associated-service toggles preserve both tier totals", () => {
  const expectedTotals = [1550, 2675];
  const expectedPerUnit = [15.5, 13.375];
  for (const includeAssociated of [false, true]) {
    for (const detail of ["itemized", "turnkey_only"] as const) {
      for (const includeFees of [false, true]) {
        const view = quote(includeAssociated, detail, includeFees);
        for (let tier = 0; tier < 2; tier++) {
          assert.equal(view.tiers[tier].money.turnkeyTotal, expectedTotals[tier]);
          assert.equal(view.tiers[tier].money.perUnitTurnkey, expectedPerUnit[tier]);
        }
        const document = renderToStaticMarkup(<CustomerViewLive view={view} />);
        assert.ok(document.includes("Order total $1,550.00"), `${detail}, associated=${includeAssociated}, fees=${includeFees}`);
        assert.ok(document.includes("Order total $2,675.00"), `${detail}, associated=${includeAssociated}, fees=${includeFees}`);
        assert.ok(document.includes("$15.50"), "first tier per-unit price is visible");
        assert.ok(document.includes("$13.38"), "second tier per-unit price is visible");
        if (includeFees) assert.ok(document.includes("Setup fee"));
        else assert.ok(!document.includes("<span class=\"t\">Setup fee</span>"));
      }
    }
  }
});
