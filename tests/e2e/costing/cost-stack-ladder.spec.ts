/**
 * P3-017 — the Cost Stack renders a price ladder that reconciles.
 *
 * WHY THIS EXISTS
 *
 * The unit suite pins two halves. `p3-017-tier-ladder-authority` proves the
 * engine publishes eight governed quantities at tier scope and derives each
 * contribution from its own lever's RATE, so the identity is capable of
 * failing. `p3-017-cost-stack-reconciliation` proves the predicate reports a
 * corrupted column.
 *
 * Neither touches the rendered surface, and the gap between them is exactly
 * where the R6 shape lived for months: a Cost Stack that showed the ladder's
 * two ENDS and none of the levers between them, so no operator could see that
 * a column added up and no test could tell them it did.
 *
 * WHAT THIS ASSERTS
 *
 *   1. the ladder renders in its canonical order, top to bottom
 *   2. EVERY COLUMN RECONCILES AS RENDERED — read from the DOM and summed
 *      here, not read from the component's own predicate. That distinction is
 *      the whole value: asking the strip whether it agrees with itself proves
 *      nothing, and a display that rounds its rows to two decimals would pass
 *      such a check while visibly not adding up.
 *   3. the strip's verdict agrees with that independent sum
 *   4. unit cost and margin render, and the cells are traceable
 *
 * SCOPE. This walks the committed state of a fixture quote. Staged levers move
 * the same nodes through the same reconciliation, and `bulk-pricing-lift` and
 * `pricing-recommendation-staging` already walk the staging path; duplicating
 * that here would test the staging model twice and the ladder once.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

/** `$1,234.5678` / `+$0.0035` / `−$0.2500` → a signed number. `—` → null. */
function money(text: string): number | null {
  const t = text.trim();
  if (t === "" || t === "—") return null;
  // U+2212 MINUS SIGN is what the contribution cells render, not ASCII hyphen.
  const negative = t.startsWith("−") || t.startsWith("-");
  const digits = t.replace(/[^0-9.]/g, "");
  if (digits === "") return null;
  const n = Number.parseFloat(digits);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** The figure in column `i` of the row whose slab reads `label`. */
async function rowValues(stack: Locator, label: string): Promise<(number | null)[]> {
  const row = stack.locator(".r11-srow").filter({
    has: stack.page().locator(".r11-slab .n", { hasText: new RegExp(`^${label}$`) }),
  });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  const cells = row.locator(".r11-scell");
  const n = await cells.count();
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    // The value span is `.sell` for a level, `.delta` for a contribution.
    const v = cells.nth(i).locator(".sell, .delta").first();
    out.push((await v.count()) === 0 ? null : money(await v.innerText()));
  }
  return out;
}

async function rowExists(stack: Locator, label: string): Promise<boolean> {
  return (
    (await stack
      .locator(".r11-srow")
      .filter({
        has: stack.page().locator(".r11-slab .n", { hasText: new RegExp(`^${label}$`) }),
      })
      .count()) > 0
  );
}

test("P3-017 the Cost Stack ladder renders and every column reconciles", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;

  // r3Volume: 6 SKUs × 4 tiers — the widest fixture, so the stack renders four
  // columns and the reconciliation is asserted four times rather than once.
  const fixture = manifest.operatorQuotes.r3Volume;

  const pageFailures: string[] = [];
  page.on("pageerror", (error) => pageFailures.push(error.message));

  await page.goto(`/projects/${fixture.projectId}/quotes/${fixture.quoteId}/pricing`);

  const stack = page.locator(".psr-detail-section--cost-stack .r11-stack");
  await expect(stack).toBeVisible({ timeout: 30_000 });

  // ── 1 · the ladder, in canonical order ──────────────────────────────────
  //
  // Order is asserted as a SEQUENCE, not as a set of present labels. The rows
  // are a running total; "all present, some transposed" is a different and
  // wrong statement about the money.
  const slabs = await stack.locator(".r11-srow .r11-slab .n").allInnerTexts();
  const ladder = slabs.map((s) => s.trim());
  const expectedPrefix = [
    "Packaging",
    "Production",
    "Bulk raw",
    "Freight",
    "Duty + tariff",
    "Sell before adjustment",
    "Price adjustment",
    "Sell after adjustment",
  ];
  expect(ladder.slice(0, expectedPrefix.length)).toEqual(expectedPrefix);
  expect(ladder.slice(-3)).toEqual(["Quoted sell", "Unit cost", "Margin"]);

  // ── 2 · every column reconciles AS RENDERED ─────────────────────────────
  const sellBefore = await rowValues(stack, "Sell before adjustment");
  const adj = await rowValues(stack, "Price adjustment");
  const quoted = await rowValues(stack, "Quoted sell");
  expect(sellBefore.length).toBeGreaterThan(0);
  expect(adj.length).toBe(sellBefore.length);
  expect(quoted.length).toBe(sellBefore.length);

  // The two conditional rows exist only when a lever was pulled somewhere.
  // Absent means the contribution is zero for every column — which is what
  // makes omitting them honest rather than lossy.
  const hasLifts = await rowExists(stack, "Surgical lifts");
  const hasOverrides = await rowExists(stack, "PM overrides");
  const lifts = hasLifts ? await rowValues(stack, "Surgical lifts") : sellBefore.map(() => 0);
  const overrides = hasOverrides
    ? await rowValues(stack, "PM overrides")
    : sellBefore.map(() => 0);

  let reconciled = 0;
  for (let i = 0; i < sellBefore.length; i++) {
    const before = sellBefore[i];
    const end = quoted[i];
    // An unreadable column renders em-dashes throughout and is not asserted —
    // it is also not counted as reconciling. See the strip's own wording.
    if (before === null || end === null) continue;
    const sum = before + (adj[i] ?? 0) + (lifts[i] ?? 0) + (overrides[i] ?? 0);
    // TOLERANCE IS THE DISPLAY'S ROUNDING BUDGET, and it is not a fudge factor.
    //
    // Five figures are read here, each independently rounded to four decimals:
    // the four addends and the total. Every one can be off the true value by up
    // to half a ten-thousandth, so the sum of the rendered addends can differ
    // from the rendered total by up to 5 x 0.00005 no matter how exactly the
    // underlying quantities reconcile. That is a property of showing rounded
    // numbers at all, not of this ladder — the Design Authority has it too,
    // which is why its strip asserts over the VALUES while the rows render
    // `money(v, 4)`.
    //
    // A real break is orders of magnitude larger: the smallest commercially
    // meaningful discrepancy is a hundredth of a cent, four times this budget.
    // And the strip below, which reads the values rather than their rendering,
    // is the exact check — this one is here to catch a column whose ROWS do not
    // add up to what the operator reads at its foot.
    const ROUNDING_BUDGET = 5 * 0.00005;
    expect(
      Math.abs(sum - end),
      `column ${i}: ${before} + ${adj[i]} + ${lifts[i]} + ${overrides[i]} = ${sum}, but Quoted sell renders ${end}`,
    ).toBeLessThanOrEqual(ROUNDING_BUDGET);
    reconciled++;
  }
  expect(reconciled, "no column was readable — the ladder asserted nothing").toBeGreaterThan(0);

  // ── 3 · the strip agrees with that independent sum ──────────────────────
  const strip = stack.locator(".r11-recon");
  await expect(strip).toBeVisible();
  await expect(strip).not.toHaveClass(/\bbad\b/);
  await expect(strip).toContainText("✓");
  await expect(strip).toContainText("reconciles");

  // ── 4 · unit cost and margin render, and the cells are traceable ────────
  const cost = await rowValues(stack, "Unit cost");
  expect(cost.length).toBe(sellBefore.length);
  expect(cost.some((v) => v !== null)).toBe(true);

  const marginRow = stack.locator(".r11-srow").filter({
    has: page.locator(".r11-slab .n", { hasText: /^Margin$/ }),
  });
  await expect(marginRow.locator(".r11-scell .mg").first()).toBeVisible();

  // Pressing a level opens the trace AT that node. The stack is one row per
  // quantity, so the panel lands beneath the stack rather than inside it.
  const firstSellCell = stack
    .locator(".r11-srow")
    .filter({ has: page.locator(".r11-slab .n", { hasText: /^Quoted sell$/ }) })
    .locator("button.r11-scell")
    .first();
  await expect(firstSellCell).toBeVisible();
  await firstSellCell.click();
  await expect(page.locator(".psr-stack-tracewrap")).toBeVisible({ timeout: 15_000 });

  expect(pageFailures, "the pricing surface threw").toEqual([]);
});
