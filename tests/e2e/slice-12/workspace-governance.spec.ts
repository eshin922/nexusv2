import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

function manifest(): FixtureManifest {
  return JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
}

test("workspace uses governed quote, owner, stage, and creation language", async ({
  page,
  networkLedger,
}, testInfo) => {
  const failures = { console: [] as string[], page: [] as string[], request: [] as string[] };
  page.on("console", (message) => {
    if (message.type() === "error" || /warning/i.test(message.type())) {
      failures.console.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.page.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const isExpectedSupersededProjectRsc =
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      /^\/projects\/[^/]+$/.test(url.pathname) &&
      url.searchParams.has("_rsc") &&
      request.failure()?.errorText === "net::ERR_ABORTED";
    // The succeeding explicit /import navigation supersedes the completed
    // project-page RSC receipt. The retained trace proves this exact Chromium
    // cancellation; every other failed request remains release-blocking.
    if (isExpectedSupersededProjectRsc) return;
    failures.request.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });

  await page.goto("/", { waitUntil: "networkidle" });
  const importLink = page.getByRole("link", { name: "Import from HubSpot" });
  await expect(importLink).toBeVisible();
  await expect(importLink).toHaveCSS("color", "rgb(255, 255, 255)");
  await importLink.focus();
  await expect(importLink).toBeFocused();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(importLink).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await testInfo.attach("after-deals-organizer-desktop.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(importLink).toBeInViewport();
  await expect(page.getByRole("button", { name: /new project/i })).toHaveCount(0);
  const draftRow = page.getByRole("row").filter({ hasText: "Validation draft deal" });
  await expect(draftRow).toContainText("Validation Sent");
  await expect(draftRow).toContainText("Rev. 1");
  await expect(draftRow).not.toContainText("validation_stage_sent");
  await testInfo.attach("after-deals-organizer-narrow.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await draftRow.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${manifest().quotes.draft.projectId}$`));
  await expect(page.getByText(/Sales:\s*Validation Owner/)).toBeVisible();
  await expect(page.getByText("validation_stage_sent", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Quote · Rev. 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Quote · Rev. 1" })).toBeVisible();
  await expect(page.getByText(/\bversion\b/i)).toHaveCount(0);
  await testInfo.attach("after-project-detail.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.goto("/import", { waitUntil: "networkidle" });
  await expect(page.getByRole("cell", { name: "Validation Sent" }).first()).toBeVisible();
  await expect(page.getByText("validation_stage_sent", { exact: true })).toHaveCount(0);
  await testInfo.attach("after-import.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await testInfo.attach("browser-diagnostics.json", {
    body: Buffer.from(JSON.stringify({ failures, networkLedger }, null, 2)),
    contentType: "application/json",
  });
  expect(failures.console, "console errors and warnings").toEqual([]);
  expect(failures.page, "uncaught page errors").toEqual([]);
  expect(failures.request, "failed browser requests").toEqual([]);
});
