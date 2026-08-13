/**
 * D-1 · the rendered tile shows the recommended tier's margin, and says so.
 *
 * The unit test pins the classifier. This pins the SURFACE, which is where the
 * defect was observed: two different commercial quantities rendering under one
 * `Blended margin` label, one in the "What you're sending" card and one in the
 * compliance grid.
 *
 * The assertion that matters is not "the tile shows a number" — it is that the
 * tile's number IS the grid's number for the recommended tier. Those are two
 * independently rendered elements reading two different paths (`summary_card`
 * and `TierRollup`), so their agreement is a real check rather than a value
 * compared with itself.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

async function openPricing(page: Page): Promise<void> {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
  const f = manifest.operatorQuotes.r3Volume;
  await page.goto(`/projects/${f.projectId}/quotes/${f.quoteId}/pricing`);
  await expect(page.locator(".r11-stack").first()).toBeVisible({ timeout: 30_000 });
}

test("D-1 the summary tile shows the recommended tier's margin, scoped in its label", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openPricing(page);

  const read = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll(".psr-summary-cell"));
    const marginCell = cells.find((c) =>
      c.querySelector(".lab")?.textContent?.includes("Blended margin"),
    );
    const recCell = cells.find((c) =>
      c.querySelector(".lab")?.textContent?.trim().startsWith("Recommended tier"),
    );

    // The grid's per-tier row, and which column is the recommended one.
    const gridRow = Array.from(document.querySelectorAll(".r11-brow")).find(
      (r) => r.querySelector(".r11-slab .n")?.textContent?.trim() === "Blended margin",
    );
    const gridValues = gridRow
      ? Array.from(gridRow.querySelectorAll(".r11-scell .mg")).map(
          (e) => e.textContent?.trim() ?? "",
        )
      : [];
    // The header row of the grid marks the recommended tier with a star.
    const headerCells = Array.from(
      document.querySelectorAll(".r11-stack .r11-srow.head .r11-scell, .r11-stack .r11-brow.head .r11-scell"),
    );
    const starIndex = headerCells.findIndex((c) => (c.textContent ?? "").includes("★"));

    return {
      tileLabel: marginCell?.querySelector(".lab")?.textContent?.trim() ?? null,
      tileValue: marginCell?.querySelector(".val")?.textContent?.trim() ?? null,
      recLabel: recCell?.querySelector(".lab")?.textContent?.trim() ?? null,
      gridValues,
      starIndex,
    };
  });

  // 1 · the tile names its scope — it is no longer a bare "Blended margin"
  //     sharing a label with the grid's per-tier row.
  expect(read.tileLabel, "no Blended margin tile found").not.toBeNull();
  expect(
    read.tileLabel,
    `tile label is "${read.tileLabel}" — indistinguishable from the grid's per-tier row`,
  ).not.toBe("Blended margin");
  expect(read.tileLabel).toMatch(/Blended margin · T\d+/);

  // 2 · and its VALUE is the recommended tier's, matched against the grid —
  //     a separately rendered element reading a different path.
  expect(read.starIndex, "no recommended tier marked in the grid header").toBeGreaterThanOrEqual(0);
  const fromGrid = read.gridValues[read.starIndex];
  expect(fromGrid, "no grid margin for the recommended tier").toBeTruthy();

  const tileNum = Number.parseFloat((read.tileValue ?? "").replace("%", ""));
  const gridNum = Number.parseFloat(fromGrid.replace("%", ""));
  expect(
    Math.abs(tileNum - gridNum),
    `tile reads ${read.tileValue} but the recommended tier reads ${fromGrid} in the grid — ` +
      `the tile is not on the recommended-tier basis`,
  ).toBeLessThan(0.05);

  // 3 · the grid keeps its own label; the two are now distinguishable by name.
  const gridLabels = await page
    .locator(".r11-brow .r11-slab .n")
    .allInnerTexts()
    .then((t) => t.map((x) => x.trim()));
  expect(gridLabels).toContain("Blended margin");
  expect(
    read.tileLabel,
    "the tile and the grid row still render the identical label",
  ).not.toBe("Blended margin");
});
