import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { expect, test } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "pvs020";
const artifact = (...parts: string[]) => path.resolve(process.cwd(), ".artifacts", "validation", runId, ...parts);
const manifest = () => JSON.parse(readFileSync(artifact("fixture-manifest.json"), "utf8")) as FixtureManifest;

test("PVS-020 production-shaped refresh is responsive, singular, and complete", async ({ page, networkLedger }, testInfo) => {
  test.setTimeout(180_000);
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
  const fixture = manifest().quotes.draft;
  const metrics: Record<string, unknown>[] = [];
  const metricReads: Promise<void>[] = [];
  page.on("console", (message) => {
    if (message.type() === "info" && message.text().includes("hubspot_product_refresh")) {
      metricReads.push(Promise.all(message.args().map((arg) => arg.jsonValue())).then((args) => {
        metrics.push({ event: args[0], ...(typeof args[1] === "object" && args[1] ? args[1] as Record<string, unknown> : {}) });
      }));
    }
  });

  try {
    await sql`
      delete from audit_log
      where caused_by_audit_id in (
        select id from audit_log
        where action = 'hubspot_pull_batch' and entity_id = ${fixture.projectId}
      )
    `;
    await sql`delete from audit_log where action = 'hubspot_pull_batch' and entity_id = ${fixture.projectId}`;
    await sql`delete from leaves where hubspot_product_id like '996%' or hubspot_product_id like '997%'`;
    await sql`
      insert into leaves (name, sku, hubspot_product_id, archived)
      select
        case when n = 1 then 'Stale Product Name' else 'Validation Catalog Product ' || lpad(n::text, 4, '0') end,
        'PVS020-P-' || lpad(n::text, 4, '0'),
        '996' || lpad(n::text, 12, '0'), false
      from generate_series(1, 1030) n
    `;

    await page.goto(fixture.deepLinks.setup, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /add component/i }).click();
    const library = page.getByRole("dialog", { name: /library/i });
    await expect(library.locator(".lib-row").first()).toBeVisible();
    const visibleBefore = await library.locator(".lib-row").count();
    const refresh = library.getByRole("button", { name: /refresh from hubspot/i }).first();

    const clickedAt = await page.evaluate(() => performance.now());
    await refresh.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(library.getByText(/Refreshing catalog from HubSpot/)).toBeVisible();
    const feedbackAt = await page.evaluate(() => performance.now());
    await expect(refresh).toBeDisabled();
    const disabledAt = await page.evaluate(() => performance.now());
    expect(await library.locator(".lib-row").count()).toBe(visibleBefore);
    const search = library.getByRole("textbox", { name: "Search library" });
    await search.fill("Validation Catalog Product 0002");
    await expect(search).toHaveValue("Validation Catalog Product 0002");

    await expect(library.getByText(/Pulled 1,?035 HubSpot products/)).toBeVisible({ timeout: 180_000 });
    const completedAt = await page.evaluate(() => performance.now());
    await Promise.all(metricReads);
    const calls = readFileSync(artifact("fake-hubspot-calls.jsonl"), "utf8")
      .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { operation: string });
    const listCalls = calls.filter((call) => call.operation === "product-list");

    const [catalog] = await sql<{
      active: number; archived: number; refreshed_name: string; audits: number; processed: number;
    }[]>`
      select
        count(*) filter (where hubspot_product_id like '996%')::int active,
        count(*) filter (where hubspot_product_id like '997%' and archived)::int archived,
        max(name) filter (where hubspot_product_id = '996000000000001') refreshed_name,
        (select count(*)::int from audit_log where action = 'hubspot_pull_batch' and entity_id = ${fixture.projectId}) audits,
        (select coalesce(sum((diff_json ->> 'processed')::int), 0)::int from audit_log where action = 'hubspot_pull_batch' and entity_id = ${fixture.projectId}) processed
      from leaves
    `;

    const evidence = {
      firstVisibleFeedbackMs: Math.round(feedbackAt - clickedAt),
      buttonDisabledMs: Math.round(disabledAt - clickedAt),
      totalRefreshMs: Math.round(completedAt - clickedAt),
      refreshRequests: listCalls.length,
      visibleRowsBefore: visibleBefore,
      rowsStayedVisible: true,
      catalog,
      metrics,
      blockedOutbound: networkLedger.filter((entry) => entry.blocked),
    };
    mkdirSync(artifact(), { recursive: true });
    writeFileSync(artifact("pvs-020-browser-timing.json"), JSON.stringify(evidence, null, 2));
    await testInfo.attach("pvs-020-browser-timing.json", { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: "application/json" });
    expect(evidence.firstVisibleFeedbackMs).toBeLessThan(200);
    expect(listCalls).toHaveLength(12);
    expect(catalog.active).toBe(1032);
    expect(catalog.archived).toBe(3);
    expect(catalog.refreshed_name).toBe("Validation Catalog Product 0001");
    expect(catalog.audits).toBe(12);
    expect(catalog.processed).toBe(1035);
    expect(evidence.blockedOutbound).toEqual([]);
  } finally {
    await sql.end();
  }
});

test("PVS-020 failed product mutation rolls back its batch and exposes an exact retry cursor", async ({ page }) => {
  test.setTimeout(60_000);
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
  const fixture = manifest().quotes.draft;
  const ledgerPath = artifact("fake-hubspot-calls.jsonl");
  const productListCalls = () => (existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "")
    .trim().split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { operation: string })
    .filter((call) => call.operation === "product-list").length;

  try {
    await sql`update leaves set name = 'Rollback Sentinel' where hubspot_product_id = '996000000000001'`;
    await sql.unsafe(`
      create or replace function pvs020_fail_product_mutation() returns trigger
      language plpgsql as $$
      begin
        if new.hubspot_product_id = '996000000000050' then
          raise exception 'PVS-020 injected batch failure';
        end if;
        return new;
      end $$;
      drop trigger if exists pvs020_fail_product_mutation on leaves;
      create trigger pvs020_fail_product_mutation
      before update on leaves for each row execute function pvs020_fail_product_mutation();
    `);
    const callsBefore = productListCalls();
    const [{ audits: auditsBefore }] = await sql<{ audits: number }[]>`
      select count(*)::int audits from audit_log
      where action = 'hubspot_pull_batch' and entity_id = ${fixture.projectId}
    `;

    await page.goto(fixture.deepLinks.setup, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /add component/i }).click();
    const library = page.getByRole("dialog", { name: /library/i });
    await library.getByRole("button", { name: /refresh from hubspot/i }).first().click();
    await expect(library.getByRole("button", { name: "Retry from batch 1" })).toBeVisible();

    const [{ name, audits: auditsAfter }] = await sql<{ name: string; audits: number }[]>`
      select
        max(name) filter (where hubspot_product_id = '996000000000001') name,
        (select count(*)::int from audit_log where action = 'hubspot_pull_batch' and entity_id = ${fixture.projectId}) audits
      from leaves
    `;
    expect(name).toBe("Rollback Sentinel");
    expect(auditsAfter).toBe(auditsBefore);
    expect(productListCalls() - callsBefore).toBe(1);
  } finally {
    await sql.unsafe("drop trigger if exists pvs020_fail_product_mutation on leaves; drop function if exists pvs020_fail_product_mutation();");
    await sql.end();
  }
});
