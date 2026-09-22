import assert from "node:assert/strict";
import test from "node:test";
import { freightSummaryShipments } from "../../src/lib/costs/freight-summary.ts";
import type { FreightWorkbook } from "../../src/lib/freight-workbook";

function workbook() {
  return {
    subcategories: [{ id: "s", label: "Ocean shipment", selectedDestinationId: "chosen", crossesInternationalBorder: true }],
    memberships: [{ freightSubcategoryId: "s" }],
    destinations: [{ id: "other", freightSubcategoryId: "s", destination: "Wrong destination" }, { id: "chosen", freightSubcategoryId: "s", destination: "Los Angeles" }],
    breaks: [
      { freightDestinationId: "other", tierId: "a", freightAmount: "999", freightMarkupPct: "0.5" },
      { freightDestinationId: "chosen", tierId: "b", freightAmount: "200.00", freightMarkupPct: "0.2" },
      { freightDestinationId: "chosen", tierId: "a", freightAmount: "0.00", freightMarkupPct: "0" },
    ],
    customsEntries: [{ id: "customs", freightSubcategoryId: "s" }],
    customsBreaks: [{ freightCustomsEntryId: "customs", tierId: "a", chargeType: "duty", amount: "10", markupPct: null }],
    tracking: [], costingContext: {},
  } as unknown as FreightWorkbook;
}

test("Freight summary selects recorded destination and aligns unequal costs by tier ID", () => {
  const [shipment] = freightSummaryShipments(workbook(), ["a", "b", "c"]);
  assert.equal(shipment.destination, "Los Angeles");
  assert.deepEqual(shipment.rows[0].cells.map((c) => c.amount), ["0.00", "200.00", null]);
  assert.equal(shipment.rows[0].cells[0].state, "priced");
  assert.equal(shipment.rows[0].cells[2].state, "unpriced");
  assert.equal(shipment.rows[1].cells[0].amount, "10");
  assert.equal(shipment.rows[1].cells[0].state, "unpriced", "missing markup remains unresolved");
});

test("Freight summary does not select an alternative or declare domestic customs zero", () => {
  const w = workbook();
  w.subcategories[0].selectedDestinationId = null;
  w.subcategories[0].crossesInternationalBorder = false;
  const [shipment] = freightSummaryShipments(w, ["a"]);
  assert.equal(shipment.destination, null);
  assert.equal(shipment.needsInput, true);
  assert.equal(shipment.rows[0].cells[0].state, "selection-needed");
  assert.equal(shipment.rows[0].cells[0].amount, null);
  assert.equal(shipment.rows[1].cells[0].state, "not-applicable");
  assert.equal(shipment.rows[1].cells[0].amount, null);
});

test("Freight summary flags missing membership even with priced freight", () => {
  const w = workbook();
  w.memberships = [];
  w.subcategories[0].crossesInternationalBorder = false;
  assert.equal(freightSummaryShipments(w, ["a"])[0].needsInput, true);
});

test("Freight summary exposes one aligned markup track and preserves tier-specific rates", () => {
  const w = workbook();
  w.customsBreaks = [
    { freightCustomsEntryId: "customs", tierId: "a", chargeType: "duty", amount: "10", markupPct: "0.1" },
    { freightCustomsEntryId: "customs", tierId: "b", chargeType: "duty", amount: "20", markupPct: "0.2" },
    { freightCustomsEntryId: "customs", tierId: "c", chargeType: "duty", amount: "30", markupPct: "0.1" },
  ] as unknown as FreightWorkbook["customsBreaks"];
  const [shipment] = freightSummaryShipments(w, ["a", "b", "c"]);
  assert.equal(shipment.rows[1].markupSummary, "10.0% · 20.0% · 10.0%");
  assert.equal(shipment.rows[1].markupDetail, "a: 10.0% · b: 20.0% · c: 10.0%");
  const domestic = workbook();
  domestic.subcategories[0].crossesInternationalBorder = false;
  assert.equal(freightSummaryShipments(domestic, ["a"])[0].rows[1].markupSummary, "Not applicable");
});
