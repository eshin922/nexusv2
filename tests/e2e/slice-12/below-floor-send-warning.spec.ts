import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

async function readManifest(): Promise<FixtureManifest> {
  const contents = await readFile(
    path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
    "utf8",
  );
  return JSON.parse(contents) as FixtureManifest;
}

test("a below-floor quote explains the refusal at Finalize", async ({ page }) => {
  const manifest = await readManifest();
  await page.goto(manifest.operatorQuotes.sixSku.deepLinks.quote, {
    waitUntil: "domcontentloaded",
  });

  const footer = page.getByTestId("cv-finalize-footer");
  await expect(footer).toContainText(/below the margin floor/i);
  await expect(page.getByTestId("cv-primary")).toBeDisabled();
  await expect(page.getByRole("tab", { name: /Send to Client/ })).toHaveCount(0);
});

test("a compliant quote can finalize directly from Preview", async ({ page }) => {
  const manifest = await readManifest();
  await page.goto(manifest.quotes.draft.deepLinks.quote, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByRole("tab", { name: /Preview Quote/ })).toHaveAttribute(
    "aria-selected", "true",
  );
  await expect(page.getByTestId("cv-primary")).toBeEnabled();
  await expect(page.getByRole("tab", { name: /Send to Client/ })).toHaveCount(0);
});
