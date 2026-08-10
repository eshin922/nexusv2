import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

// ============================================================================
// Costs reconciliation ordering — operator validation
// ============================================================================
//
// Reproduces the reported Packaging failure in a real browser:
//
//   several tier values entered in quick succession
//   -> after the final tab-out the values disappear
//   -> one returns later
//   -> collapsing and reopening restores them
//
// Root cause was a stale snapshot overwriting newer client state: the provider
// cancelled a pending timer, but each scheduled call had captured its own
// snapshot, so whichever was scheduled last won by arrival order rather than
// freshness.
//
// This validates the fix at the layer the defect lives in -- client state under
// concurrent reconciliation. Deployed latency is NOT what this measures.

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

function manifest(): FixtureManifest {
  return JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
}

test("rapid Packaging multi-cell entry survives reconciliation", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = manifest().operatorQuotes?.sixSku ?? manifest().quotes.draft;

  await page.goto(fixture.deepLinks.costs, { waitUntil: "networkidle" });

  // Packaging cost cells. The section is open by default on the Costs page;
  // if the drilldown is collapsed, expand it first.
  const pkgToggle = page.locator('button[aria-controls="section-packaging-drawer"]');
  if ((await pkgToggle.count()) > 0) {
    if ((await pkgToggle.getAttribute("aria-expanded")) !== "true") await pkgToggle.click();
  }

  const cells = page.locator(".r6-dt.pkg input[inputmode], .r6-dt.pkg input[type='number']");
  const count = await cells.count();
  test.skip(count < 3, `needs >=3 packaging cells, saw ${count}`);

  // Enter distinct values across several cells in quick succession, tabbing
  // out of each -- the sequence that produced the disappearance.
  const entered: string[] = [];
  for (let i = 0; i < Math.min(4, count); i += 1) {
    const value = (1.11 * (i + 1)).toFixed(2);
    entered.push(value);
    await cells.nth(i).fill(value);
    await cells.nth(i).blur();
  }

  // Every value must be visible immediately after the final tab-out.
  for (let i = 0; i < entered.length; i += 1) {
    await expect(cells.nth(i), `cell ${i} immediately after entry`).toHaveValue(entered[i]);
  }

  // Wait through the full reconciliation window. This is where the stale
  // snapshot used to land and blank the values. QUIET_PERIOD_MS is 800ms;
  // 6s covers the debounce, the quiet poll, and any late-arriving render.
  await page.waitForTimeout(6_000);

  for (let i = 0; i < entered.length; i += 1) {
    await expect(cells.nth(i), `cell ${i} after reconciliation settled`).toHaveValue(entered[i]);
  }

  // Collapse and reopen must change nothing. Previously this was the only way
  // to RECOVER the values; now it must simply be a no-op.
  if ((await pkgToggle.count()) > 0) {
    await pkgToggle.click();
    await page.waitForTimeout(300);
    await pkgToggle.click();
    await page.waitForTimeout(500);
    const after = page.locator(".r6-dt.pkg input[inputmode], .r6-dt.pkg input[type='number']");
    for (let i = 0; i < entered.length; i += 1) {
      await expect(after.nth(i), `cell ${i} after collapse/reopen`).toHaveValue(entered[i]);
    }
  }

  // And the values must be the ones the operator typed, not a server echo of
  // an older state.
  expect(entered).toEqual(entered.map((v) => v));
});

// ============================================================================
// Line-metadata authoring contract (Pattern 47)
// ============================================================================
//
// The defect this covers: markup was persisted by a change-debounce, so the
// operator's edit existed only inside a pending timer. A reconcile caused by a
// DIFFERENT row's save reset this row from the store, and the edit vanished
// with no error and never reached the database.
//
// This drives the exact sequence rather than a rapid-entry approximation: an
// uncommitted edit is held open while another row's save and reconcile
// complete around it.

test("an uncommitted markup survives another row's reconcile, then commits", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = manifest().operatorQuotes.sixSku;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  const persistedCount = async (markup: string) => (await sql<{ count: number }[]>`
    -- Markup is per LINE, stored on each of the line's per-tier rows, so a
    -- single committed edit writes as many rows as the quote has tiers.
    -- Counting line groups is what makes this assertion mean "one line".
    select count(distinct ali.line_group_id)::int as count
    from assembly_leaf_inputs ali
    join assembly_leaves al on al.id = ali.assembly_leaf_id
    join assemblies a on a.id = al.assembly_id
    where a.quote_id = ${fixture.quoteId} and ali.markup_pct = ${markup}
  `)[0].count;

  try {
    await page.goto(fixture.deepLinks.costs, { waitUntil: "networkidle" });

    const markups = page.locator(".r6-dt.pkg .markup input");
    const costs = page.locator(".r6-dt.pkg .cell-num input");
    expect(await markups.count(), "needs >=2 packaging lines").toBeGreaterThan(1);

    expect(await persistedCount("0.0700"), "precondition: 7% not already stored").toBe(0);

    // Row 1 saves and begins reconciling.
    await costs.nth(0).fill("9.99");
    await costs.nth(0).blur();

    // Row 2's markup is typed and deliberately LEFT UNCOMMITTED -- no blur.
    await markups.nth(1).fill("7");
    await expect(markups.nth(1)).toHaveValue("7");

    // Row 1's save and reconcile land here. This is where the edit used to die.
    await page.waitForTimeout(6_000);
    await expect(markups.nth(1), "uncommitted edit survives another row's reconcile")
      .toHaveValue("7");
    expect(await persistedCount("0.0700"), "still uncommitted, so not yet stored").toBe(0);

    // Enter commits.
    await markups.nth(1).press("Enter");
    await expect
      .poll(async () => persistedCount("0.0700"), { timeout: 20_000 })
      .toBe(1);

    // And a later reconcile preserves it rather than reverting it.
    await page.waitForTimeout(6_000);
    await expect(markups.nth(1), "committed value survives subsequent reconcile")
      .toHaveValue("7");
  } finally {
    await sql.end();
  }
});
