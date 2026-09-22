import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("opening a new Setup draft is one idempotent quote-and-tier transaction", async () => {
  const actions = await readFile(
    new URL("../../src/app/actions/quotes.ts", import.meta.url),
    "utf8",
  );
  const projectsPage = await readFile(
    new URL("../../src/app/projects/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const setupPage = await readFile(
    new URL("../../src/app/projects/[id]/quotes/[quoteId]/page.tsx", import.meta.url),
    "utf8",
  );
  const surfaceRoutes = await readFile(
    new URL("../../src/lib/nav/surface-routes.ts", import.meta.url),
    "utf8",
  );
  const create = actions.slice(
    actions.indexOf("export async function createQuote"),
    actions.indexOf("export async function createScenario"),
  );

  assert.match(projectsPage, /name="idempotencyKey"[\s\S]*value=\{randomUUID\(\)\}/);
  assert.match(setupPage, /className="setup-wizard-frame"/);
  assert.doesNotMatch(setupPage, /setup-wizard-progress/);
  assert.doesNotMatch(setupPage, /step 1 of 2/);
  assert.match(setupPage, /Continue to Costs/);
  assert.match(setupPage, /COSTS_M3_PREVIEW_VALUE/);
  assert.match(setupPage, /href=\{costsUrl\}/);
  assert.match(surfaceRoutes, /setup:\s*\{\s*routePattern:\s*"\/projects\/:id\/quotes\/:qid\/setup"/);
  assert.match(create, /if \(!idempotencyKey\)/);
  assert.match(create, /db\.transaction\(async \(tx\)/);
  assert.match(create, /\.insert\(actionIdempotency\)[\s\S]*\.values\(\{ key: idempotencyKey, action \}\)/);
  assert.match(create, /\.for\("update"\)/);
  assert.match(create, /tx[\s\S]*?\.insert\(quotes\)/);
  assert.match(create, /tx\.insert\(quoteTiers\)/);
  assert.match(create, /writeAuditEntry\([\s\S]*?\}, tx\)/);
  assert.match(create, /\.set\(\{ result: \{ quoteId: quote\.id, projectId \} \}\)/);
  assert.match(create, /redirect\(`\/projects\/\$\{projectId\}\/quotes\/\$\{quoteId\}\/setup`\)/);
  assert.doesNotMatch(create, /await logAudit\(/);
});

test("legacy Setup review links redirect directly to Costs", async () => {
  const review = await readFile(
    new URL("../../src/app/projects/[id]/quotes/[quoteId]/setup/review/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(review, /redirect/);
  assert.match(review, /COSTS_M3_PREVIEW_VALUE/);
  assert.match(review, /\/costs\?preview=/);
  assert.doesNotMatch(review, /loadAssemblyTree/);
  assert.doesNotMatch(review, /Open the Costs page/);
});
