import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("customer send snapshots component freight inputs in the commercial transaction", async () => {
  const source = await read("src/app/actions/quotes.ts");
  const transaction = source.slice(
    source.indexOf("await db.transaction(async (tx)"),
    source.indexOf("async function cloneQuoteGraph"),
  );

  assert.match(transaction, /insert\(quoteSnapshots\)/);
  assert.match(transaction, /quoteSnapshotId: snapshot\.id/);
  assert.match(transaction, /insert\(quoteSnapshotFreightInputs\)/);
  assert.match(transaction, /quoteSnapshotId: snapshot\.id/);
  assert.match(transaction, /actualFreightCost: input\.actualFreightCost/);
  assert.match(transaction, /effectiveUnits/);
});

test("clone carries Quote markup and remaps component inputs through canonical identities", async () => {
  const source = await read("src/app/actions/quotes.ts");
  const clone = source.slice(source.indexOf("async function cloneQuoteGraph"));

  assert.match(clone, /freightMarkupPct: source\.freightMarkupPct/);
  assert.match(clone, /quoteLeafIdMap\.set\(sourceJunction\.quoteLeafId, attached\.quoteLeafId\)/);
  assert.match(clone, /insert\(freightLegComponentTierCosts\)/);
  assert.match(clone, /actualFreightCost: row\.actualFreightCost/);
  assert.match(clone, /component freight input has unmapped canonical identity/);
});

test("draft writes fail closed on unresolved or cross-Quote freight identity", async () => {
  const source = await read("src/app/actions/freight.ts");

  assert.match(source, /updateFreightComponentTierCost/);
  assert.match(source, /Freight component identity did not resolve exactly once/);
  assert.match(source, /Freight component identity crosses Quotes/);
  assert.match(source, /values\(\{ freightLegId, quoteLeafId, tierId, actualFreightCost \}\)/);
  assert.match(source, /onConflictDoUpdate/);
});

test("sent costing reads pinned markup and freight-input snapshot", async () => {
  const settings = await read("src/lib/commercial-settings.ts");
  const costing = await read("src/app/actions/costing.ts");

  assert.match(settings, /freightMarkupPct: Number\(pin\.freightMarkupPct\)/);
  assert.match(costing, /lifecycle\.status !== "draft" && lifecycle\.snapshotId/);
  assert.match(costing, /from\(quoteSnapshotFreightInputs\)/);
  assert.match(costing, /effectiveUnits: input\.effectiveUnits/);
  assert.match(costing, /freightMarkupPct: commercial\.freightMarkupPct/);
});

test("customer and NetSuite boundaries validate selected worksheet commercial inputs", async () => {
  const completeness = await read("src/lib/quote-cost-completeness.ts");

  assert.match(completeness, /loadFreightWorkbook\(quoteId\)/);
  assert.match(completeness, /select exactly one valid destination/);
  assert.match(completeness, /enter Freight and Freight Markup/);
  assert.match(completeness, /crossesInternationalBorder/);
  assert.match(completeness, /"duty", "tariff"/);
  assert.match(completeness, /return \[\.\.\.packaging, \.\.\.freight\]/);
});
