import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
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

  const projectUrl = new RegExp(`/projects/${manifest().quotes.draft.projectId}$`);
  await Promise.all([
    page.waitForURL(projectUrl, { timeout: 15_000 }),
    draftRow.getByRole("link").click(),
  ]);
  await expect(page.getByText(/Sales:\s*Validation Owner/)).toBeVisible();
  await expect(page.getByText("validation_stage_sent", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Quote · Rev. 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Quote · Rev. 1" })).toBeVisible();
  await expect(page.getByText(/\bversion\b/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh from HubSpot" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archive", exact: true })).toHaveCount(0);
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

test("PVS-017 Organizer excludes dropped history from current selection", async ({
  page,
  networkLedger,
}, testInfo) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const projectIds = {
    mixed: "71000000-0000-4000-8000-000000000001",
    multiple: "71000000-0000-4000-8000-000000000002",
    dropped: "71000000-0000-4000-8000-000000000003",
  } as const;
  const failures = { console: [] as string[], page: [] as string[], request: [] as string[] };
  page.on("console", (message) => {
    if (message.type() === "error" || /warning/i.test(message.type())) {
      failures.console.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.page.push(error.message));
  page.on("requestfailed", (request) => {
    failures.request.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });

  try {
    await sql`
      insert into projects (id, hubspot_deal_id, deal_name, client_name, status, deal_stage)
      values
        (${projectIds.mixed}, '971000000001', 'PVS mixed scenario deal', 'PVS Customer', 'active', 'validation_stage_sent'),
        (${projectIds.multiple}, '971000000002', 'PVS multiple active deal', 'PVS Customer', 'active', 'validation_stage_sent'),
        (${projectIds.dropped}, '971000000003', 'PVS all dropped deal', 'PVS Customer', 'active', 'validation_stage_sent')
    `;
    await sql`
      insert into quotes (
        id, project_id, scenario_label, scenario_status, version_number,
        status, created_at, updated_at
      ) values
        ('72000000-0000-4000-8000-000000000001', ${projectIds.mixed}, 'Current Sent', 'active', 1, 'sent', '2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z'),
        ('72000000-0000-4000-8000-000000000002', ${projectIds.mixed}, 'Dropped Draft', 'dropped', 1, 'draft', '2026-07-01T11:00:00Z', '2026-07-02T10:00:00Z'),
        ('72000000-0000-4000-8000-000000000003', ${projectIds.multiple}, 'Older Active', 'active', 1, 'draft', '2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z'),
        ('72000000-0000-4000-8000-000000000004', ${projectIds.multiple}, 'Newer Active', 'active', 2, 'sent', '2026-07-01T11:00:00Z', '2026-07-02T10:00:00Z'),
        ('72000000-0000-4000-8000-000000000005', ${projectIds.dropped}, 'Dropped Draft', 'dropped', 1, 'draft', '2026-07-01T10:00:00Z', '2026-07-02T10:00:00Z'),
        ('72000000-0000-4000-8000-000000000006', ${projectIds.dropped}, 'Dropped Sent', 'dropped', 2, 'sent', '2026-07-01T11:00:00Z', '2026-07-03T10:00:00Z')
    `;

    await page.goto("/", { waitUntil: "networkidle" });

    const mixed = page.getByRole("row").filter({ hasText: "PVS mixed scenario deal" });
    await expect(mixed).toContainText("Current Sent");
    await expect(mixed).toContainText("Rev. 1");
    await expect(mixed).toContainText("SENT");
    await expect(mixed).not.toContainText("Dropped Draft");

    const multiple = page.getByRole("row").filter({ hasText: "PVS multiple active deal" });
    await expect(multiple).toContainText("Newer Active");
    await expect(multiple).toContainText("Rev. 2");
    await expect(multiple).toContainText("SENT");

    const dropped = page.getByRole("row").filter({ hasText: "PVS all dropped deal" });
    await expect(dropped).toContainText("No Active Scenario");
    await expect(dropped).not.toContainText("Dropped Draft");
    await expect(dropped).not.toContainText("Dropped Sent");
    await expect(dropped).not.toContainText("DRAFT");
    await expect(dropped).not.toContainText("SENT");

    await testInfo.attach("pvs-017-organizer.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await sql`
      delete from projects
      where id in (${projectIds.mixed}, ${projectIds.multiple}, ${projectIds.dropped})
    `;
    await sql.end();
  }

  await testInfo.attach("pvs-017-browser-diagnostics.json", {
    body: Buffer.from(JSON.stringify({ failures, networkLedger }, null, 2)),
    contentType: "application/json",
  });
  expect(failures.console, "console errors and warnings").toEqual([]);
  expect(failures.page, "uncaught page errors").toEqual([]);
  expect(failures.request, "failed browser requests").toEqual([]);
});
