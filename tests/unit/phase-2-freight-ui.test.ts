import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Costs exposes selected worksheet breaks and derived freight sell per unit", async () => {
  const page = await read("src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx");
  const drilldown = await read("src/components/costs/freight-drilldown.tsx");

  assert.match(page, /workbook=\{freightWorkbook\}/);
  assert.match(drilldown, /Another destination/);
  assert.match(drilldown, /total cost/);
  assert.match(drilldown, /Freight sell per unit/);
  assert.match(drilldown, /updateFreightDestinationBreakGroup/);
  assert.doesNotMatch(drilldown, /updateFreightComponentTierCost/);
  assert.doesNotMatch(drilldown, /updateQuoteFreightMarkup/);
});

test("new Quotes retain the existing firm-default initialization contract", async () => {
  const quotes = await read("src/app/actions/quotes.ts");

  assert.match(quotes, /activeFreightMarkupDefault/);
  assert.match(quotes, /firmSettings\.freightMarkupPctDefault/);
  assert.match(quotes, /freightMarkupPct,/);
});
