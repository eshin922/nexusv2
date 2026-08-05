import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
async function manifest(): Promise<FixtureManifest> {
  return JSON.parse(await readFile(path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"), "utf8")) as FixtureManifest;
}
async function openSection(page: import("@playwright/test").Page, id: string) {
  const trigger = page.locator(`button[aria-controls="section-${id}-drawer"]`);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
}

test("selected worksheet break saves actual freight and derives billable per unit", async ({ page }) => {
  const fixture = (await manifest()).operatorQuotes.oneSku;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const response = await page.goto(fixture.deepLinks.costs, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await openSection(page, "freight");
  await expect(page.getByText("Packaging from overseas · ocean container", { exact: true })).toBeVisible();
  await expect(page.getByText(/to Long Beach, CA/).first()).toBeVisible();
  await expect(page.getByText(/to Houston, TX/).first()).toBeVisible();
  await expect(page.locator(".sell", { hasText: "$5.46" }).first()).toBeVisible();

  const actual = page.getByPlaceholder("total cost").first();
  await actual.fill("4500");
  const saved = page.waitForResponse((result) => result.request().method() === "POST" && result.ok());
  await actual.press("Tab");
  await saved;
  await expect(page.locator(".sell", { hasText: "$5.85" }).first()).toBeVisible();
  const [row] = await sql<{ freight_amount: string }[]>`
    select fb.freight_amount
    from freight_destination_breaks fb
    join freight_destinations fd on fd.id = fb.freight_destination_id
    join freight_subcategories fs on fs.selected_destination_id = fd.id
    join quote_tiers qt on qt.id = fb.tier_id
    where fs.quote_id = ${fixture.quoteId}
    order by fs.display_order, qt.sort_order limit 1
  `;
  expect(row.freight_amount).toBe("4500.00");
  await sql.end();
});

test("unified Costs Workspace renders at 1, 6, and 10 SKU scales", async ({ page }) => {
  const fixtures = (await manifest()).operatorQuotes;
  const expectations = [
    [fixtures.oneSku, 1, 4, ["Packaging from overseas · ocean container"]],
    [fixtures.sixSku, 6, 8, ["Packaging from overseas · ocean container", "Launch stock · split air shipment"]],
    [fixtures.tenSku, 10, 12, ["Packaging from overseas · ocean container", "Launch stock · split air shipment", "Ocean arrival · domestic transfer"]],
  ] as const;
  for (const [fixture, skuCount, freightBreaks, shipments] of expectations) {
    const response = await page.goto(fixture.deepLinks.costs, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page.locator('button[aria-controls="section-packaging-drawer"]')).toBeVisible();
    await expect(page.locator('button[aria-controls="section-production-drawer"]')).toBeVisible();
    await expect(page.locator('button[aria-controls="section-freight-drawer"]')).toBeVisible();
    await expect(page.getByText("Other SKUs in this scenario", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Bulk Raw", { exact: true })).toHaveCount(0);
    await openSection(page, "packaging");
    const packaging = page.locator('button[aria-controls="section-packaging-drawer"]').locator("xpath=ancestor::article");
    await expect(packaging.getByRole("button", { name: /^Add line/ })).toHaveCount(skuCount);
    await openSection(page, "production");
    await expect(page.locator('[aria-controls="section-production-drawer"]')).toHaveAttribute("aria-expanded", "true");
    await openSection(page, "freight");
    await expect(page.getByPlaceholder("total cost")).toHaveCount(freightBreaks);
    for (const shipment of shipments) await expect(page.getByText(shipment, { exact: true })).toBeVisible();
  }
});

test("Freight worksheet matches the source-authoritative nested comparison surface", async ({ page }) => {
  const fixture = (await manifest()).operatorQuotes.sixSku;
  const response = await page.goto(fixture.deepLinks.costs, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await openSection(page, "freight");

  const freight = page.locator(".freight-authority");
  await expect(freight.locator(".fr-product-group")).toHaveCount(1);
  await expect(freight.locator(".fr-sc")).toHaveCount(2);
  await expect(freight.locator(".fr-dest")).toHaveCount(4);
  await expect(freight.getByText("in the price", { exact: true })).toHaveCount(2);
  await expect(freight.getByRole("button", { name: "+ Another destination" })).toHaveCount(2);
  await expect(freight).toHaveScreenshot("freight-source-authority-six-sku.png", {
    animations: "disabled",
  });
});
