import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("send completeness follows worksheet authority and not superseded component freight", async () => {
  const source = await readFile(new URL("../../src/lib/quote-cost-completeness.ts", import.meta.url), "utf8");
  assert.match(source, /loadFreightWorkbook/);
  assert.match(source, /subcategory\.selectedDestinationId/);
  assert.match(source, /workbook\.breaks\.filter/);
  assert.match(source, /workbook\.customsBreaks\.filter/);
  assert.match(source, /crossesInternationalBorder/);
  assert.doesNotMatch(source, /freightLegComponentTierCosts/);
  assert.doesNotMatch(source, /freightLegs/);
});
