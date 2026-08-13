/**
 * C-1 · the Production markup the operator reads is the one the quote is priced at.
 *
 * WHAT WAS WRONG
 *
 * The Costs page rendered `—` in the Production Markup column while the engine
 * applied `markupDefaults["Manufacturing"]` to every production cost and
 * carried it into quoted price. Not a wrong number — a cell asserting a false
 * one, in the same column where packaging shows a real resolved rate.
 *
 * WHAT THESE ASSERT
 *
 *   1. the column renders a PERCENTAGE, not an em-dash  (fails at `1d78e32`)
 *   2. that percentage equals the GOVERNED Manufacturing default, read from
 *      `markup_defaults` — the same row the engine reads
 *   3. changing that governed default moves BOTH the display and the
 *      calculation, through their own authority paths
 *
 * (3) is the one that makes (2) more than a coincidence. Two things agreeing on
 * one value could be two constants; two things that MOVE TOGETHER when the
 * authority moves are reading it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import type { Page } from "@playwright/test";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
const CATEGORY = "Manufacturing";

async function fixture() {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
  return manifest.operatorQuotes.r3Volume;
}

async function withSql<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** The governed rate, straight from the table the engine resolves against. */
async function governedManufacturingPct(): Promise<number> {
  const rows = await withSql(
    (sql) => sql`select default_markup_pct::text as pct from markup_defaults where category = ${CATEGORY}`,
  );
  expect(rows.length, `no governed '${CATEGORY}' markup default to read`).toBe(1);
  return Number.parseFloat((rows[0] as { pct: string }).pct);
}

async function setManufacturingPct(pct: number): Promise<void> {
  await withSql(
    (sql) => sql`update markup_defaults set default_markup_pct = ${pct} where category = ${CATEGORY}`,
  );
}

/**
 * The Production markup cells, AS A LOCATOR.
 *
 * Was `page.evaluate` + `querySelectorAll`, which matches hidden elements — so
 * the drawer-opening helper saw cells inside a COLLAPSED accordion, returned
 * early, and the assertions ran against text no operator could see. On a
 * finding whose entire substance is "the operator cannot see the markup", that
 * is the wrong thing to assert. Playwright locators carry visibility, so
 * `toBeVisible` means what it says here.
 */
function markupCells(page: Page) {
  return page.locator("#section-production-drawer .r6-dt-row .num .markup");
}

async function markupTexts(page: Page): Promise<string[]> {
  return (await markupCells(page).allTextContents()).map((t) => t.trim());
}

/** The section's marked-up production figure, for the calculation half. */
async function productionSectionValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    // The section HEADER's own figure — rendered outside the drawer, from the
    // engine's rollup, so it is independent of the markup cell under test.
    const row = document.querySelector("#section-production-drawer")
      ?.previousElementSibling;
    return row?.textContent?.trim() ?? "";
  });
}

/** Expand the Production section, and wait for cells to be genuinely VISIBLE. */
async function openProductionDrawer(page: Page): Promise<void> {
  const first = markupCells(page).first();
  if (await first.isVisible().catch(() => false)) return;
  await page
    .locator("#section-production-drawer")
    .locator("xpath=preceding-sibling::*[1]")
    .click();
  await expect(first).toBeVisible({ timeout: 20_000 });
}

async function openCosts(page: Page): Promise<void> {
  const f = await fixture();
  await page.goto(`/projects/${f.projectId}/quotes/${f.quoteId}/costs`);
  await expect(page.locator("#section-production-drawer")).toBeAttached({ timeout: 30_000 });
  await openProductionDrawer(page);
}

test("C-1 the Production markup column shows the governed rate, not an em-dash", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openCosts(page);

  const cells = await markupTexts(page);
  expect(cells.length, "no Production markup cells rendered at all").toBeGreaterThan(0);
  // Visible, not merely present. See `markupCells`.
  await expect(markupCells(page).first()).toBeVisible();

  // 1 · FAILS AT `1d78e32`, where every one of these is "—".
  for (const c of cells) {
    expect(c, `Production markup cell renders "${c}" — a markup IS applied`).not.toBe("—");
    expect(c, `Production markup cell "${c}" is not a percentage`).toMatch(/^\d+(\.\d+)?%$/);
  }

  // 2 · and it is the governed rate the engine reads, not some other number.
  const governed = await governedManufacturingPct();
  const shown = Number.parseFloat(cells[0].replace("%", "")) / 100;
  expect(
    Math.abs(shown - governed),
    `displayed ${cells[0]} but the governed ${CATEGORY} default is ${(governed * 100).toFixed(1)}%`,
  ).toBeLessThan(0.0001);

  // Production markup is firm-wide, so every PRODUCTION row shows one rate. The
  // set may hold a second value legitimately: `Bulk raw cost` renders inside
  // this table but is priced off the RAW category, and showing it the
  // production rate would be C-1's own defect one row lower.
  expect(
    new Set(cells).size,
    `more than two distinct rates in the column: ${cells.join(", ")}`,
  ).toBeLessThanOrEqual(2);
});

test("C-1 moving the governed default moves both the display and the calculation", async ({
  page,
}) => {
  /**
   * THIS TEST HAS TO CREATE ITS OWN CONDITION, and that is worth stating.
   *
   * No quote in the validation estate carries any production cost — the
   * section reads "0 lines" and every tier renders an em-dash. With zero cost,
   * `cost × (1 + markup)` is zero at every rate, so there is nothing for the
   * calculation to move and the assertion would pass vacuously against any
   * implementation. So a cost is entered first, through the operator's own
   * input rather than by writing rows behind the UI, and removed afterwards.
   */
  test.setTimeout(180_000);
  const f = await fixture();
  const original = await governedManufacturingPct();

  try {
    await openCosts(page);

    // Give production something to mark up, the way an operator would.
    const cell = page
      .locator("#section-production-drawer")
      .locator('input[aria-label*="Filling"]')
      .first();
    await expect(cell).toBeVisible({ timeout: 15_000 });
    await cell.fill("1000");
    await cell.blur();

    // CONFIRM THE WRITE LANDED before drawing any conclusion from the figures.
    // Without this the next steps could compare two zeroes and pass.
    await expect
      .poll(
        async () =>
          (
            await withSql(
              (sql) => sql`select count(*)::int as n from assembly_production_inputs
                 where filling_blending_cost is not null and assembly_id in (
                   select id from assemblies where quote_id = ${f.quoteId})`,
            )
          )[0] as unknown as { n: number },
        { timeout: 30_000, message: "the production cost never persisted" },
      )
      .toMatchObject({ n: 1 });

    // Re-read from a fresh render: the section sublabel and its rollup are
    // server-rendered, so the baseline has to come from after the write.
    await page.reload();
    await expect(page.locator("#section-production-drawer")).toBeAttached({ timeout: 30_000 });
    await openProductionDrawer(page);

    const before = (await markupTexts(page))[0];
    const beforeValue = await productionSectionValue(page);
    expect(
      beforeValue,
      "production still reads as empty after a cost was entered — nothing to move",
    ).not.toContain("0 lines");

    // Move the authority — the same row the engine resolves against.
    const moved = Number((original + 0.11).toFixed(4));
    await setManufacturingPct(moved);

    await page.reload();
    await expect(page.locator("#section-production-drawer")).toBeAttached({ timeout: 30_000 });
    await openProductionDrawer(page);

    // 3a · the DISPLAY followed.
    await expect
      .poll(async () => (await markupTexts(page))[0], { timeout: 20_000 })
      .toBe(`${(moved * 100).toFixed(1)}%`);
    expect((await markupTexts(page))[0]).not.toBe(before);

    // 3b · the CALCULATION followed. Read from the section header's own rollup,
    // which is rendered outside the drawer and never consults the markup cell —
    // so the two halves are separate evidence, not one fact stated twice.
    await expect
      .poll(async () => await productionSectionValue(page), { timeout: 30_000 })
      .not.toBe(beforeValue);
  } finally {
    // Firm-wide policy, shared by every quote in the estate. Always restored.
    await setManufacturingPct(original);
    // And the cost this test entered goes with it.
    await withSql(
      (sql) => sql`delete from assembly_production_inputs where assembly_id in (
        select id from assemblies where quote_id = ${f.quoteId})`,
    );
  }
});
