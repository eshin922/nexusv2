import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Costs exposes the worksheet hierarchy in business language", async () => {
  const source = await readFile(new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url), "utf8");
  for (const concept of ["Freight", "what ships", "Another destination", "one value, all breaks", "Customs entry", "Duty", "Tariff", "shipment"]) {
    assert.match(source, new RegExp(concept));
  }
  for (const persistenceConcept of ["quote_leaf", "junction", "foreign key", "freight_subcategories", "freight_destination_breaks"]) {
    assert.doesNotMatch(source.toLowerCase(), new RegExp(persistenceConcept));
  }
});

test("membership inherits Setup context and never becomes allocation", async () => {
  const source = await readFile(new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url), "utf8");
  assert.match(source, /Commercial structure from Setup/);
  assert.match(source, /Shipment contents from Setup/);
  assert.doesNotMatch(source, /allocation method|allocation value|CBM allocation/i);
});

test("Costs page loads worksheet authority rather than superseded freight UI rows", async () => {
  const source = await readFile(new URL("../../src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx", import.meta.url), "utf8");
  assert.match(source, /loadFreightWorkbook\(quote\.id\)/);
  assert.match(source, /workbook=\{freightWorkbook\}/);
  assert.doesNotMatch(source, /freightComponentCostRows/);
  assert.doesNotMatch(source, /freightLegList/);
});
