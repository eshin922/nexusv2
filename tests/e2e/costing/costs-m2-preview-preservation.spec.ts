// Codex independent browser acceptance check; CC owns the preview implementation.
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

for (const fixtureName of ["sixSku", "r12Visual"] as const) {
test(`${fixtureName}: read-only preview preserves the cost stack and returns to the existing editor`, async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
  const manifest = JSON.parse(readFileSync(path.resolve(
    ".artifacts", "validation", runId, "fixture-manifest.json",
  ), "utf8")) as FixtureManifest;
  await page.setViewportSize({ width: 1728, height: 1080 });
  await page.goto(manifest.operatorQuotes[fixtureName].deepLinks.costs, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/tier=/);
  await expect(page.locator(".cm2")).toHaveCount(0);
  const originalUrl = new URL(page.url());
  let tier = originalUrl.searchParams.get("tier");
  const stack = page.locator(".r6-stack");
  const originalStack = await stack.innerText();
  const tierCount = await stack.locator(".r6-tier-col").count();
  expect(tierCount).toBeGreaterThan(1);
  if (fixtureName === "r12Visual") expect(tierCount).toBe(4);
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) writes += 1;
  });
  originalUrl.searchParams.set("preview", "costs-m2");
  await page.goto(originalUrl.toString(), { waitUntil: "networkidle" });
  const preview = page.locator(".cm2");
  await expect(preview).toBeVisible();
  for (const name of ["Spreadsheet", "By product", "By module"]) {
    await preview.getByRole("button", { name, exact: true }).click();
    expect(
      await preview.evaluate((root) =>
        root.lastElementChild?.matches(".cm2-freight") === true,
      ),
      `${name}: Freight summary stays below the selected cost view`,
    ).toBe(true);
    await expect(stack).toHaveText(originalStack, { useInnerText: true });
    await expect(stack.locator(".r6-tier-col")).toHaveCount(tierCount);
    // Read-only field footprints and tier navigation are legitimate here.
    // Check authoring capability, not the implementation's choice of HTML tag.
    await expect(preview.locator(
      "input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not(#cm2-tier-select):not([disabled])",
    )).toHaveCount(0);
    // Real tier names can already contain quantities. They must stay inside
    // their column rather than running into the next tier or markup header.
    const overflowingHeaders = await preview.locator(".cm2-tierhead").evaluateAll(
      (heads) => heads.filter((head) => head.scrollWidth > head.clientWidth + 1)
        .map((head) => head.textContent),
    );
    expect(overflowingHeaders, `${name}: tier headers must fit their tracks`).toEqual([]);
    if (name === "By product") {
      const picker = preview.locator(".cm2-pick").first();
      const nameBox = await picker.locator(".cm2-pick-name").boundingBox();
      const skuBox = await picker.locator(".cm2-pick-meta").boundingBox();
      expect(nameBox).not.toBeNull();
      expect(skuBox).not.toBeNull();
      expect(skuBox!.y, "SKU belongs below the product name").toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height);
    }
    await page.screenshot({ path: testInfo.outputPath(`${name.replaceAll(" ", "-")}.png`), fullPage: true });
  }
  // The stack and entry views share one selected alternative. Selecting a
  // different tier must change emphasis, never the all-SKU totals or row set.
  await stack.locator(".r6-tier-col").last().click();
  await expect(stack.locator(".r6-tier-col").last()).toHaveAttribute("aria-selected", "true");
  await expect(page).not.toHaveURL(originalUrl.toString());
  tier = new URL(page.url()).searchParams.get("tier");
  for (const name of ["Spreadsheet", "By module"]) {
    await preview.getByRole("button", { name, exact: true }).click();
    await expect(preview.locator(".cm2-fieldhead").first().locator(".cm2-tierhead").nth(tierCount - 1))
      .toHaveClass(/cm2-hl/);
    await expect(stack).toHaveText(originalStack, { useInnerText: true });
  }
  await page.setViewportSize({ width: 909, height: 900 });
  for (const name of ["Spreadsheet", "By product", "By module"]) {
    await preview.getByRole("button", { name, exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`${name.replaceAll(" ", "-")}-909.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1728, height: 1080 });
  expect(writes, "view changes must not write").toBe(0);
  // The preview banner and its exit control were retired; leave the preview
  // explicitly through the route so this test covers the surface itself.
  await page.goto(originalUrl.toString().replace(/[?&]preview=[^&]+/, ""));
  await expect(preview).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("tier")).toBe(tier);
  await expect(stack).toHaveText(originalStack, { useInnerText: true });
  await expect(page.locator(".r6-dt.pkg .cell-num input").first()).toBeVisible();
});
}
