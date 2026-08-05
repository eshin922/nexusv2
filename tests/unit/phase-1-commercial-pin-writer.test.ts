import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/actions/quotes.ts", "utf8");
const resolver = readFileSync("src/lib/commercial-settings.ts", "utf8");
const send = source.slice(
  source.indexOf("export async function sendQuote"),
  source.indexOf("export async function reviseQuote"),
);
const revise = source.slice(
  source.indexOf("export async function reviseQuote"),
  source.indexOf("export async function", source.indexOf("export async function reviseQuote") + 30),
);

test("send writes snapshot, linked settings header, and markup outcomes in one transaction", () => {
  const transaction = send.slice(send.indexOf("db.transaction"));
  const snapshotWrite = transaction.indexOf("tx.insert(quoteSnapshots)");
  // Whitespace-tolerant: the original matched "tx\n        .insert(...)"
  // exactly, which fails on a CRLF working tree even though the write
  // ordering is correct. The ordering is the invariant; the formatting is not.
  const headerWrite = transaction.indexOf(".insert(quoteCommercialSettingsPins)");
  const outcomeWrite = transaction.indexOf("tx.insert(quoteCommercialMarkupPins)");

  assert.ok(snapshotWrite >= 0, "snapshot write is absent");
  assert.ok(headerWrite > snapshotWrite, "settings header must follow snapshot");
  assert.ok(outcomeWrite > headerWrite, "markup outcomes must follow settings header");
  assert.match(transaction, /returning\(\{ id: quoteSnapshots\.id \}\)/);
  assert.match(transaction, /quoteSnapshotId: snapshot\.id/);
  assert.match(transaction, /pinId: settingsPin\.id/);
  assert.doesNotMatch(send.slice(0, send.indexOf("db.transaction")), /insert\(quoteCommercial(?:Settings|Markup)Pins\)/);
});

test("revision supersedes snapshot and its commercial pin in the same transaction", () => {
  const transaction = revise.slice(revise.indexOf("db.transaction"));
  assert.match(transaction, /update\(quoteSnapshots\)[\s\S]*?supersededAt: revisedAt/);
  assert.match(
    transaction,
    /update\(quoteCommercialSettingsPins\)[\s\S]*?supersededAt: revisedAt/,
  );
});

test("send resolves canonical identity before creating the PDF artifact", () => {
  assert.ok(
    send.indexOf("prepareQuoteCommercialPin(quoteId)") <
      send.indexOf("renderToBuffer(doc)"),
  );
  assert.match(send, /canonical quote_leaves\.id/);
  assert.match(send, /commercialSettingsOverride: sendCommercialSettings/);
});

test("pin writer records requested category, selected rung, and provenance", () => {
  assert.match(resolver, /defaultByCategory\.get\(category\) \?\? defaultByCategory\.get\("Other"\)/);
  assert.match(resolver, /category,\s*chosenRung: setting\.category/);
  assert.match(resolver, /sourceUserId: setting\.updatedByUserId/);
  assert.match(resolver, /sourceSetAt: setting\.updatedAt/);
  assert.match(resolver, /neither an exact setting nor a provenance-bearing Other fallback/);
});

test("clone starts as a new unpinned Quote", () => {
  const clone = source.slice(
    source.indexOf("async function cloneQuoteGraph"),
    source.indexOf("export async function copyScenarioWithinProject"),
  );
  assert.match(clone, /status: "draft"/);
  assert.match(clone, /copiedFromQuoteId: args\.sourceQuoteId/);
  assert.doesNotMatch(clone, /quoteCommercial(?:Settings|Markup)Pins/);
  assert.doesNotMatch(clone, /quoteSnapshots/);
});
