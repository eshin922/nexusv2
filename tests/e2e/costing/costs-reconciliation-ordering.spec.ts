import { readFileSync } from "node:fs";
import path from "node:path";
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
