import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Project Detail exposes refresh, and still omits the undefined archive control", () => {
  // SUBJECT SPLIT. This asserted that Project Detail exposed NEITHER control,
  // which was a deliberate V1 omission resting on `/import` being the re-sync
  // path. The corpus disproved that half: `importDeal` resolves an existing
  // project by deal id and returns BEFORE `syncDealById`, so re-importing
  // refreshes nothing and a re-associated deal stayed stale with no operator
  // remedy. Refresh is now reachable; archive remains genuinely undefined.
  const page = source("src/app/projects/[id]/page.tsx");

  assert.match(page, /RefreshProjectButton/);
  assert.doesNotMatch(page, /archiveProject|Archive this project/);
  assert.match(page, /View deal in HubSpot/);
});

test("the refresh control calls the existing action and adds no second writer", () => {
  const button = source("src/app/projects/[id]/refresh-project-button.tsx");
  const actions = source("src/app/actions/projects.ts");

  // One write authority. The control is an affordance over the governed
  // action, not a new path to the same rows.
  assert.match(button, /import \{ refreshFromHubspot \} from "@\/app\/actions\/projects"/);
  assert.match(button, /await refreshFromHubspot\(fd\)/);
  // No IMPORT of a data layer and no direct sync call. Those names may appear
  // in the comment explaining why this control exists; what must not appear is
  // a second way to write the same rows.
  assert.doesNotMatch(button, /from "@\/db"|drizzle-orm|syncDealById\(/);

  // Operator-initiated only. A background refresh would move client name and
  // deal stage under a quote someone is reading, and both feed the document.
  assert.doesNotMatch(button, /useEffect|setInterval|setTimeout/);

  // Success and failure are both visible, and "changed nothing" is reported
  // as its own outcome rather than as a bare success.
  assert.match(button, /role="status"/);
  assert.match(button, /role="alert"/);
  assert.match(button, /up to date/);

  // The action it calls remains the sole writer, unchanged.
  assert.match(actions, /export async function refreshFromHubspot/);
  assert.match(actions, /await syncDealById\(project\.hubspotDealId\)/);
});

test("refresh cannot reach commercial state", () => {
  // The reason it needs no draft/frozen guard: it writes five HubSpot-derived
  // project fields plus a timestamp, and touches no table a freeze protects.
  const actions = source("src/app/actions/projects.ts");
  const start = actions.indexOf("export async function refreshFromHubspot");
  const body = actions.slice(start, actions.indexOf("export async function", start + 1));

  for (const table of [
    "quotes", "assemblies", "assemblyLeaves", "assemblyLeafInputs",
    "assemblyProductionInputs", "quoteTiers", "quoteChargeRecovery",
    "quoteSnapshot", "assemblyLeafOverrides",
  ]) {
    assert.ok(!body.includes(table), `refreshFromHubspot must not touch ${table}`);
  }
  // What it DOES write, stated so a future edit widening it fails here.
  assert.match(body, /\.update\(projects\)/);
  assert.match(body, /lastHubspotRefreshAt: new Date\(\)/);
  assert.match(body, /action: "refreshed"/);
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
  // Import stays a FORM-less entry point on this page: the refresh control
  // calls the action directly from a client component, never as a form action
  // on Project Detail.
  assert.doesNotMatch(projectPage, /action=\{refreshFromHubspot\}/);

  // FALSIFIES THE DEFECT THAT MOTIVATED THE CONTROL. `importDeal` returns for
  // an existing project BEFORE it syncs, so `/import` cannot refresh one. If
  // this ever stops being true, the refresh control's justification changes
  // and this test should be the thing that says so.
  const importStart = actions.indexOf("export async function importDeal");
  const importBody = actions.slice(importStart, actions.indexOf("export async function", importStart + 1));
  const earlyReturn = importBody.indexOf("redirect(`/projects/${existing[0].id}`)");
  const sync = importBody.indexOf("await syncDealById(dealId)");
  assert.ok(earlyReturn > 0 && sync > earlyReturn,
    "import must still early-return before syncing — that is the gap the refresh control fills");
});

test("archived projects remain directly readable by project ID", () => {
  const page = source("src/app/projects/[id]/page.tsx");

  assert.match(page, /\.where\(eq\(projects\.id, id\)\)/);
  assert.doesNotMatch(page, /and\(eq\(projects\.id, id\), eq\(projects\.status, "active"\)\)/);
  assert.match(page, /project\.status === "archived"/);
});
