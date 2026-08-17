import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("snapshot authority stores the complete worksheet graph without mutable freight FKs", async () => {
  const [schema, loader] = await Promise.all([
    readFile(new URL("../../src/db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/freight-workbook.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /quoteSnapshotFreightWorkbooks = pgTable/);
  assert.match(schema, /workbook: jsonb\("workbook"\)\.notNull\(\)/);
  for (const grain of ["subcategories", "memberships", "destinations", "breaks", "customsEntries", "customsBreaks", "tracking"]) assert.match(loader, new RegExp(grain));
  assert.match(loader, /ownerSkuByAssembly/);
  assert.match(loader, /tierUnitsByTier/);
});

test("sent costing consumes immutable worksheet context instead of live freight rows", async () => {
  const costing = await readFile(new URL("../../src/app/actions/costing.ts", import.meta.url), "utf8");
  assert.match(costing, /quoteSnapshotFreightWorkbooks/);
  assert.match(costing, /projectSnapshotWorkbook/);
  assert.match(costing, /workbook\.costingContext\.tierUnitsByTier/);
  // V1 freight distribution policy · a SENT version distributes across the
  // membership frozen in its own workbook, not across an anchor resolved from
  // the assembly. The snapshot already carried `memberships`; it is now what
  // the sent path reads, so a historical re-read spreads the freight over
  // exactly the products that shipment contained at send.
  assert.match(costing, /workbook\.memberships/);
  assert.doesNotMatch(
    costing,
    /costingContext\.ownerSkuByAssembly/,
    "the sent path must not resolve a single owner from the assembly either",
  );
});

test("workbook snapshot is transactionally inseparable from the Quote snapshot", async () => {
  const action = await readFile(new URL("../../src/app/actions/quotes.ts", import.meta.url), "utf8");
  const transactionStart = action.indexOf("const result = await db.transaction(async (tx) =>", action.indexOf("export async function sendQuote"));
  const snapshotWrite = action.indexOf("tx.insert(quoteSnapshots)", transactionStart);
  const workbookRead = action.indexOf("loadFreightWorkbook(quoteId, tx)", snapshotWrite);
  const workbookWrite = action.indexOf("tx.insert(quoteSnapshotFreightWorkbooks)", workbookRead);
  const quoteWrite = action.indexOf(".update(quotes)", workbookWrite);
  assert.ok(transactionStart >= 0 && snapshotWrite > transactionStart);
  assert.ok(workbookRead > snapshotWrite && workbookWrite > workbookRead);
  assert.ok(quoteWrite > workbookWrite, "Quote cannot become sent before its workbook snapshot exists");
});

test("clone preserves worksheet structure through remapped identities and resets tracking", async () => {
  const action = await readFile(new URL("../../src/app/actions/quotes.ts", import.meta.url), "utf8");
  const start = action.indexOf("async function cloneFreightWorksheet");
  const end = action.indexOf("async function cloneQuoteGraph", start);
  const clone = action.slice(start, end);
  for (const map of ["assemblyIdMap", "assemblyLeafIdMap", "tierIdMap", "subcategoryIdMap", "destinationIdMap", "customsEntryIdMap"]) assert.match(clone, new RegExp(map));
  assert.match(clone, /selectedDestinationId: null/);
  assert.match(clone, /Tracking is operational execution state and intentionally starts empty/);
  assert.doesNotMatch(clone, /insert\(freightDestinationTracking\)/);
});

test("revision preserves the closed workbook snapshot and existing working worksheet", async () => {
  const action = await readFile(new URL("../../src/app/actions/quotes.ts", import.meta.url), "utf8");
  const start = action.indexOf("export async function reviseQuote");
  const end = action.indexOf("export async function markAccepted", start);
  const revise = action.slice(start, end);
  assert.match(revise, /supersededAt: revisedAt/);
  assert.doesNotMatch(revise, /delete\(quoteSnapshotFreightWorkbooks\)/);
  assert.doesNotMatch(revise, /delete\(freightSubcategories\)/);
});

test("create then edit flows into snapshot and clone while revision preserves the evidence", async () => {
  const [actions, workbook, quotes] = await Promise.all([
    readFile(new URL("../../src/app/actions/freight-worksheet.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/freight-workbook.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/actions/quotes.ts", import.meta.url), "utf8"),
  ]);
  assert.match(actions, /updateFreightSubcategory/);
  assert.match(actions, /updateFreightDestination/);
  assert.match(actions, /mergeProvenance/);
  assert.match(workbook, /select\(\)\.from\(freightSubcategories\)/);
  assert.match(workbook, /select\(\)\.from\(freightSubcategoryItems\)/);
  assert.match(workbook, /select\(\)\.from\(freightDestinations\)/);
  const clone = quotes.slice(quotes.indexOf("async function cloneFreightWorksheet"), quotes.indexOf("async function cloneQuoteGraph"));
  assert.match(clone, /fieldProvenance: row\.fieldProvenance/);
  assert.match(clone, /source: row\.source/);
  assert.match(clone, /freightSubcategoryItems/);
  const revise = quotes.slice(quotes.indexOf("export async function reviseQuote"), quotes.indexOf("export async function markAccepted"));
  assert.doesNotMatch(revise, /delete\(freightSubcategories\)|delete\(freightSubcategoryItems\)|delete\(freightDestinations\)/);
});
