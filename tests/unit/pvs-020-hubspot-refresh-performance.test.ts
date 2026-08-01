import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookPath = "src/components/assembly-tree/use-pull-from-hubspot.ts";
const pullPath = "src/lib/hubspot-pull.ts";
const actionPath = "src/app/actions/hubspot-pull.ts";

test("PVS-020 publishes visible pending state before starting server work", async () => {
  const source = await readFile(hookPath, "utf8");
  const start = source.slice(source.indexOf("function handleStart()"), source.indexOf("function handleRetry()"));
  assert.ok(start.indexOf('setPhase("pulling-active")') < start.indexOf("startTransition("));
  assert.match(start, /if \(pullInFlightRef\.current\) return/);
});

test("PVS-020 pipelines independent catalog mutations inside the governed transaction", async () => {
  const source = await readFile(pullPath, "utf8");
  assert.match(source, /await Promise\.all\(mappedEntries\.map\(async \(\{ mapped \}\) => \{/);
  assert.match(source, /await db\.transaction\(async \(tx\) => \{/);
});

test("PVS-020 records provider, lookup, database, revalidation, and total timing", async () => {
  const pull = await readFile(pullPath, "utf8");
  const action = await readFile(actionPath, "utf8");
  for (const field of ["hubspotMs", "lookupMs", "databaseMs", "totalMs"]) {
    assert.match(pull, new RegExp(field));
  }
  assert.match(action, /revalidationMs/);
  assert.match(pull, /hubspot_product_refresh_batch/);
  const hook = await readFile(hookPath, "utf8");
  assert.match(hook, /hubspot_product_refresh_click/);
  assert.match(hook, /hubspot_product_refresh_first_visible_feedback/);
  assert.match(hook, /clientRoundTripMs/);
});
