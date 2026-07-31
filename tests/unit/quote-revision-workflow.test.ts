import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("revision updates the existing quote while a new scenario starts at Rev. 1", async () => {
  const source = await readFile(
    new URL("../../src/app/actions/quotes.ts", import.meta.url),
    "utf8",
  );
  const revise = source.slice(source.indexOf("export async function reviseQuote"));
  assert.match(revise, /\.update\(quotes\)/);
  assert.match(revise, /versionNumber: newVersion/);
  assert.match(revise, /\.where\(eq\(quotes\.id, quoteId\)\)/);
  assert.doesNotMatch(revise.slice(0, revise.indexOf("return result")), /\.insert\(quotes\)/);

  const create = source.slice(
    source.indexOf("export async function createScenario"),
    source.indexOf("export async function", source.indexOf("export async function createScenario") + 30),
  );
  assert.match(create, /\.insert\(quotes\)/);
  assert.match(create, /versionNumber: 1/);
  assert.match(create, /newQuoteId = row\.id/);
});
