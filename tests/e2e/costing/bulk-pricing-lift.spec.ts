import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

test("VAL-208 previews, applies, and exactly undoes a bulk pricing lift", async ({
  page,
  networkLedger,
}) => {
  test.setTimeout(90_000);
  const manifest = JSON.parse(await readFile(
    path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
    "utf8",
  )) as FixtureManifest;
  const fixture = manifest.quotes.draft;
  const pricingUrl =
    `/projects/${fixture.projectId}/quotes/${fixture.quoteId}/pricing`;
  const failures = { console: [] as string[], page: [] as string[], request: [] as string[] };
  page.on("console", (message) => {
    if (message.type() === "error") failures.console.push(message.text());
  });
  page.on("pageerror", (error) => failures.page.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const failure = request.failure()?.errorText ?? "";
    const expectedRsc =
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      url.pathname === pricingUrl &&
      url.searchParams.has("_rsc") &&
      failure === "net::ERR_ABORTED";
    const expectedSupersededActionReceipt =
      request.method() === "POST" &&
      request.resourceType() === "fetch" &&
      url.pathname === pricingUrl &&
      request.headers()["next-action"] !== undefined &&
      failure === "net::ERR_ABORTED";
    // The retained VAL-208 trace shows the successful action result and
    // persisted/audited state before the following action or reload supersedes
    // only that Server Action's RSC receipt.
    if (!expectedRsc && !expectedSupersededActionReceipt) {
      failures.request.push(`${request.method()} ${request.url()} ${failure}`);
    }
  });

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    // Fixture precondition (VAL-208, 2026-08-10). This scenario needs an
    // EDITABLE quote. When it previously shared `quotes.draft` with the send
    // lifecycle -- which runs in a different Playwright project, concurrently,
    // against the same database -- a lost race surfaced eleven assertions later
    // as a UI timeout waiting for a status message, with nothing on screen
    // pointing at lifecycle state. Assert it here so contamination fails at the
    // harness boundary, naming its own cause.
    const [precondition] = await sql<{ status: string }[]>`
      select status from quotes where id = ${fixture.quoteId}
    `;
    expect(
      precondition?.status,
      "VAL-208 requires a draft quote; something advanced its lifecycle first",
    ).toBe("draft");

    const before = await sql`
      select id, tier_price_adj_pct::text as adjustment
      from quote_tiers where quote_id = ${fixture.quoteId} order by sort_order
    `;
    const [auditBefore] = await sql`
      select count(*)::int as count from audit_log
      where entity_id = ${fixture.quoteId}
         or entity_id in (select id::text from quote_tiers where quote_id = ${fixture.quoteId})
    `;
    await page.goto(pricingUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Global lift percentage").fill("5");
    await page.getByRole("button", { name: "Preview Changes" }).click();
    const preview = page.getByLabel("Bulk pricing preview");
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("row")).toHaveCount(fixture.tierIds.length + 1);
    await expect(preview).toContainText("Current adjustment");
    await expect(preview).toContainText("Current price");
    await expect(preview).toContainText("Resulting price");

    expect(await sql`
      select id, tier_price_adj_pct::text as adjustment
      from quote_tiers where quote_id = ${fixture.quoteId} order by sort_order
    `).toEqual(before);
    const [auditAfterPreview] = await sql`
      select count(*)::int as count from audit_log
      where entity_id = ${fixture.quoteId}
         or entity_id in (select id::text from quote_tiers where quote_id = ${fixture.quoteId})
    `;
    expect(auditAfterPreview.count).toBe(auditBefore.count);
    await preview.getByRole("button", { name: "Cancel" }).click();
    await expect(preview).toBeHidden();

    await page.getByRole("button", { name: "Preview Changes" }).click();
    await page.getByLabel("Bulk pricing preview").getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("status")).toContainText("Pricing updated.");
    await expect.poll(async () => (await sql`
      select tier_price_adj_pct::text as adjustment from quote_tiers
      where quote_id = ${fixture.quoteId} order by sort_order
    `).map((row) => row.adjustment)).toEqual(["0.0500", "0.0500"]);
    await expect.poll(async () => (await sql`
      select count(*)::int as count from audit_log
      where entity_id = ${fixture.quoteId}
        and action = 'pricing_suggestion_global_applied'
    `)[0].count).toBe(1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("status")).toContainText("Pricing restored.");
    await expect.poll(async () => await sql`
      select id, tier_price_adj_pct::text as adjustment
      from quote_tiers where quote_id = ${fixture.quoteId} order by sort_order
    `).toEqual(before);
    expect((await sql`
      select count(*)::int as count from audit_log
      where entity_id = ${fixture.quoteId}
        and action = 'pricing_suggestion_global_undone'
    `)[0].count).toBe(1);

    await page.getByRole("button", { name: "Preview Changes" }).click();
    await page.getByLabel("Bulk pricing preview").getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("status")).toContainText("Pricing updated.");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByLabel("Global lift percentage").fill("0");
    await page.getByRole("button", { name: "Preview Changes" }).click();
    await expect(page.getByLabel("Bulk pricing preview")).toContainText("5.0%");
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

    expect(failures.console).toEqual([]);
    expect(failures.page).toEqual([]);
    expect(failures.request).toEqual([]);
    expect(networkLedger.filter((entry) => entry.blocked)).toEqual([]);
  } finally {
    await sql.end();
  }
});
