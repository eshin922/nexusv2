import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Project Detail omits undefined V1 refresh and archive controls", () => {
  const page = source("src/app/projects/[id]/page.tsx");

  assert.doesNotMatch(page, /RefreshProjectButton|refreshFromHubspot/);
  assert.doesNotMatch(page, /archiveProject|Archive this project/);
  assert.match(page, /View deal in HubSpot/);
});

test("underlying synchronization and archive compatibility remain intact", () => {
  const actions = source("src/app/actions/projects.ts");
  const cache = source("src/lib/hubspot-cache.ts");
  const schema = source("src/db/schema.ts");

  assert.match(actions, /export async function refreshFromHubspot/);
  assert.match(actions, /export async function archiveProject/);
  assert.match(actions, /await syncDealById\(project\.hubspotDealId\)/);
  assert.match(cache, /export async function syncDealById/);
  assert.match(schema, /pgEnum\("project_status", \["active", "archived"\]\)/);
});

test("HubSpot import remains the governed synchronization entry point", () => {
  const actions = source("src/app/actions/projects.ts");
  const projectPage = source("src/app/projects/[id]/page.tsx");

  assert.match(actions, /export async function importDeal/);
  assert.match(actions, /const cacheRow = await syncDealById\(dealId\)/);
  assert.doesNotMatch(projectPage, /action=\{refreshFromHubspot\}/);
});

test("archived projects remain directly readable by project ID", () => {
  const page = source("src/app/projects/[id]/page.tsx");

  assert.match(page, /\.where\(eq\(projects\.id, id\)\)/);
  assert.doesNotMatch(page, /and\(eq\(projects\.id, id\), eq\(projects\.status, "active"\)\)/);
  assert.match(page, /project\.status === "archived"/);
});
