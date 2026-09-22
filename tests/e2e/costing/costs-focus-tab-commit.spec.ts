// Codex independent regression check. Repair brief: focus-tab-regression-review.md
// in C:/Code/nexus-validation-runs/financial-parity-diagnosis-20260918.
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

// A real keyboard traversal, including a save response arriving while the next
// cell is being edited. Programmatic blur alone cannot prove focus preservation.
test("Tab saves a cost without stealing focus or replacing the next draft", async ({ page }) => {
  test.setTimeout(90_000);
  const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
  const manifest = JSON.parse(readFileSync(path.resolve(
    ".artifacts", "validation", runId, "fixture-manifest.json",
  ), "utf8")) as FixtureManifest;
  const fixture = manifest.operatorQuotes.sixSku;
  await page.goto(fixture.deepLinks.costs, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/tier=/);
  const toggle = page.locator('button[aria-controls="section-packaging-drawer"]');
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const cells = page.locator(".r6-dt.pkg .cell-num input");
  expect(await cells.count(), "fixture must have adjacent tier cost cells").toBeGreaterThan(1);
  const first = cells.nth(0);
  const second = cells.nth(1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  let firstReceived = false;
  let responses = 0;
  const costsPath = new URL(page.url()).pathname;
  await page.route((url) => url.pathname === costsPath, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      await route.fallback();
      return;
    }
    const ordinal = ++requests;
    const response = await route.fetch();
    if (ordinal === 1) {
      firstReceived = true;
      await gate;
    }
    await route.fulfill({ response });
    responses += 1;
  });
  try {
    await first.focus();
    await first.press("ControlOrMeta+A");
    await first.pressSequentially("1.2345", { delay: 40 });
    await expect(first).toBeFocused();
    await expect(first).toHaveValue("1.2345");
    expect(requests, "typing must not commit").toBe(0);
    await first.press("Tab");
    await expect(second).toBeFocused();
    await expect.poll(() => firstReceived).toBe(true);
    await expect(second).toBeEnabled();
    await second.press("ControlOrMeta+A");
    await second.pressSequentially("2.3456", { delay: 40 });
    await expect(second).toHaveValue("2.3456");
    release();
    await expect.poll(() => responses).toBe(1);
    // Covers the store's quiet reconciliation window while this draft is open.
    await page.waitForTimeout(2_000);
    await expect(second).toBeFocused();
    await expect(second).toHaveValue("2.3456");
    expect(requests, "the focused draft must remain uncommitted").toBe(1);
    await second.press("Tab");
    await expect.poll(() => responses).toBe(2);
    expect(requests, "one commit per edited cell").toBe(2);
    await page.reload({ waitUntil: "networkidle" });
    await expect(cells.nth(0)).toHaveValue("1.2345");
    await expect(cells.nth(1)).toHaveValue("2.3456");
  } finally {
    release();
    // The harness owns/reset these isolated fixture rows; no production writes.
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("an earlier save receipt cannot clear a newer draft in the same cost cell", async ({ page }) => {
  test.setTimeout(90_000);
  const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
  const manifest = JSON.parse(readFileSync(path.resolve(
    ".artifacts", "validation", runId, "fixture-manifest.json",
  ), "utf8")) as FixtureManifest;
  await page.goto(manifest.operatorQuotes.sixSku.deepLinks.costs, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/tier=/);
  const cell = page.locator(".r6-dt.pkg .cell-num input").first();
  await expect(cell).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let received = false;
  let requests = 0;
  let responses = 0;
  const costsPath = new URL(page.url()).pathname;
  await page.route((url) => url.pathname === costsPath, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      await route.fallback();
      return;
    }
    const ordinal = ++requests;
    const response = await route.fetch();
    if (ordinal === 1) {
      received = true;
      await gate;
    }
    await route.fulfill({ response });
    responses += 1;
  });
  try {
    await cell.fill("3.4567");
    await cell.press("Enter");
    await expect.poll(() => received).toBe(true);
    await cell.focus();
    await cell.press("ControlOrMeta+A");
    await cell.pressSequentially("4.5678", { delay: 40 });
    release();
    await expect.poll(() => responses).toBe(1);
    await page.waitForTimeout(2_000);
    await expect(cell).toBeFocused();
    await expect(cell).toHaveValue("4.5678");
    expect(requests).toBe(1);
    await cell.press("Tab");
    await expect.poll(() => responses).toBe(2);
    await page.reload({ waitUntil: "networkidle" });
    await expect(cell).toHaveValue("4.5678");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
