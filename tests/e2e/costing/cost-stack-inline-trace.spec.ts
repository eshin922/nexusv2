/**
 * R-1 · the Cost Stack trace opens INLINE, beneath the row it explains.
 *
 * WHY THIS EXISTS
 *
 * This is a deliberate divergence from the Design Authority, which renders the
 * stack trace after the whole stack (`pricing-page.jsx:978`). Edward's
 * operator-acceptance review dispositioned inline: transposed, the stack is
 * thirteen rows tall, so a panel at its foot sat ~1200px from the cell that
 * opened it and read as an unrelated block.
 *
 * A divergence held by convention drifts back. This pins it — and pins the
 * property that actually matters, which is not "a panel exists somewhere" but
 * **the panel is adjacent to the row whose cell was pressed**. The previous
 * placement would satisfy any test that only asserted the panel was visible.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

test("R-1 the stack trace opens directly beneath the pressed cell's row", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
  const f = manifest.operatorQuotes.r3Volume;

  const pageFailures: string[] = [];
  page.on("pageerror", (e) => pageFailures.push(e.message));

  await page.goto(`/projects/${f.projectId}/quotes/${f.quoteId}/pricing`);
  const stack = page.locator(".psr-detail-section--cost-stack .r11-stack");
  await expect(stack).toBeVisible({ timeout: 30_000 });

  // Press a cell on the FIRST row — the one furthest from the foot of the
  // stack, so the old placement and the new one are maximally distinguishable.
  const packagingRow = stack.locator(".r11-srow").filter({
    has: page.locator(".r11-slab .n", { hasText: /^Packaging$/ }),
  });
  const cell = packagingRow.locator("button.r11-scell").first();
  await expect(cell).toBeVisible();

  await expect(stack.locator(".r11-tracewrap")).toHaveCount(0);
  await cell.click();

  const trace = stack.locator(".r11-tracewrap");
  await expect(trace).toHaveCount(1, { timeout: 15_000 });

  // ADJACENCY, not mere presence. The panel must be the next thing after the
  // row — asserted through the DOM rather than by pixel distance, which would
  // pass for any panel that happened to be near.
  const isNextSibling = await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll(".psr-detail-section--cost-stack .r11-stack > *"),
    );
    const i = rows.findIndex((el) =>
      el.classList.contains("r11-srow") &&
      el.querySelector(".r11-slab .n")?.textContent?.trim() === "Packaging",
    );
    if (i < 0) return "packaging row not found";
    const next = rows[i + 1];
    if (!next) return "nothing follows the packaging row";
    return next.classList.contains("r11-tracewrap")
      ? true
      : `next sibling is ${next.className}`;
  });
  expect(isNextSibling, "the trace must be the element immediately after its row").toBe(true);

  // And it must be within a screen of the cell that opened it — the operator
  // property the disposition was about.
  const cellBox = await cell.boundingBox();
  const traceBox = await trace.boundingBox();
  expect(cellBox && traceBox).toBeTruthy();
  const gap = (traceBox!.y - cellBox!.y);
  expect(gap, `trace is ${gap.toFixed(0)}px from the pressed cell`).toBeLessThan(200);

  // Pressing again closes it, and nothing is left behind at the foot.
  await cell.click();
  await expect(stack.locator(".r11-tracewrap")).toHaveCount(0);
  await expect(page.locator(".psr-stack-tracewrap")).toHaveCount(0);

  expect(pageFailures, "the pricing surface threw").toEqual([]);
});
