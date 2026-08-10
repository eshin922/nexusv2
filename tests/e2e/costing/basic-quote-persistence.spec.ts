import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

async function manifest(): Promise<FixtureManifest> {
  return JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
}

test.describe.configure({ mode: "serial" });

async function openProduction(page: import("@playwright/test").Page) {
  const trigger = page.locator(
    'button[aria-controls="section-production-drawer"]',
  );
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
}

test("VAL-101 creates and persists basic production pricing inputs", async ({
  page,
  networkLedger,
}) => {
  test.setTimeout(90_000);
  const fixture = (await manifest()).quotes.draft;
  const consoleFailures: string[] = [];
  const pageFailures: string[] = [];
  const requestFailures: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error" || /warning/i.test(message.type())) {
      consoleFailures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageFailures.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    const url = new URL(request.url());
    const expectedSupersededRsc =
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      /^\/projects\/[^/]+\/quotes\/[^/]+\/costs$/.test(url.pathname) &&
      url.searchParams.has("_rsc") &&
      failure === "net::ERR_ABORTED";
    if (!expectedSupersededRsc) {
      requestFailures.push(`${request.method()} ${request.url()} ${failure}`);
    }
  });

  const response = await page.goto(fixture.deepLinks.costs, {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(200);
  await openProduction(page);

  const values = {
    "Filling / blending tier total": {
      value: "100.00",
      column: "filling_blending_cost",
    },
    "CM assembly tier total": { value: "50.00", column: "cm_assembly_total" },
    "Setup fee total": { value: "10.00", column: "setup_fee_total" },
    "Tooling / artwork total": {
      value: "10.00",
      column: "tooling_artwork_total",
    },
    "R&D fee total": { value: "10.00", column: "rd_total" },
    "Other service fee total": {
      value: "10.00",
      column: "other_service_total",
    },
  };
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  for (const [label, expected] of Object.entries(values)) {
    const actionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          new URL(fixture.deepLinks.costs, "http://127.0.0.1").pathname &&
        response.ok(),
    );
    await page
      .getByRole("spinbutton", { name: `${label} · Validation 100` })
      .first()
      .fill(expected.value);
    await actionResponse;
    await expect.poll(async () => {
      const [row] = await sql`
        select filling_blending_cost, cm_assembly_total, setup_fee_total,
               tooling_artwork_total, rd_total, other_service_total
        from assembly_production_inputs
        where tier_id = ${fixture.tierIds[0]}
      `;
      return row?.[expected.column] ?? null;
    }).toBe(expected.value);
  }

  try {
    await expect
      .poll(async () => {
        const [row] = await sql`
          select filling_blending_cost, cm_assembly_total, setup_fee_total,
                 tooling_artwork_total, rd_total, other_service_total
          from assembly_production_inputs
          where tier_id = ${fixture.tierIds[0]}
        `;
        return row ?? null;
      })
      .toEqual({
        filling_blending_cost: "100.00",
        cm_assembly_total: "50.00",
        setup_fee_total: "10.00",
        tooling_artwork_total: "10.00",
        rd_total: "10.00",
        other_service_total: "10.00",
      });
  } finally {
    await sql.end();
  }

  await page.reload({ waitUntil: "networkidle" });
  await openProduction(page);
  for (const [label, expected] of Object.entries(values)) {
    await expect(
      page
        .getByRole("spinbutton", { name: `${label} · Validation 100` })
        .first(),
    ).toHaveValue(expected.value);
  }
  await expect(page.getByText("→ $1.00/u", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("→ $0.50/u", { exact: true }).first()).toBeVisible();

  const rejectionSql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  try {
    const [{ count: auditCountBefore }] = await rejectionSql<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where action = 'assembly_production_input_updated'
    `;
    const rejectedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          new URL(fixture.deepLinks.costs, "http://127.0.0.1").pathname,
    );
    await page
      .getByRole("spinbutton", {
        name: "Filling / blending tier total · Validation 100",
      })
      .first()
      .fill("-1");
    await rejectedResponse;
    await expect(
      page.getByRole("alert").filter({ hasText: /must be at least 0/i }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("spinbutton", {
          name: "Filling / blending tier total · Validation 100",
        })
        .first(),
    ).toHaveValue("100.00");
    const [rejectedState] = await rejectionSql<{
      filling_blending_cost: string;
      audit_count: number;
    }[]>`
      select api.filling_blending_cost,
        (select count(*)::int from audit_log
          where action = 'assembly_production_input_updated') as audit_count
      from assembly_production_inputs api
      where api.tier_id = ${fixture.tierIds[0]}
    `;
    expect(rejectedState.filling_blending_cost).toBe("100.00");
    expect(rejectedState.audit_count).toBe(auditCountBefore);
  } finally {
    await rejectionSql.end();
  }

  expect(consoleFailures, "unexpected console failures").toEqual([]);
  expect(pageFailures, "unexpected page errors").toEqual([]);
  expect(requestFailures, "unexpected failed requests").toEqual([]);
  expect(networkLedger.filter((entry) => entry.blocked)).toEqual([]);
});

test("VAL-103 concurrent debounced cost edits persist without save loss", async ({
  page,
  networkLedger,
}) => {
  test.setTimeout(90_000);
  const fixture = (await manifest()).quotes.draft;
  const costPath = new URL(
    fixture.deepLinks.costs,
    "http://127.0.0.1",
  ).pathname;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [assembly] = await sql<{ id: string }[]>`
    select id from assemblies
    where quote_id = ${fixture.quoteId}
    order by position, id
    limit 1
  `;
  const [baseline] = await sql<{ id: string }[]>`
    insert into assembly_production_inputs (
      assembly_id, tier_id, filling_blending_cost, cm_assembly_total
    ) values (${assembly.id}, ${fixture.tierIds[0]}, 100.00, 50.00)
    on conflict (assembly_id, tier_id) do update set
      filling_blending_cost = excluded.filling_blending_cost,
      cm_assembly_total = excluded.cm_assembly_total
    returning id
  `;
  await sql`
    delete from audit_log
    where entity_id = ${baseline.id}
      and action = 'assembly_production_input_updated'
  `;

  const consoleFailures: string[] = [];
  const pageFailures: string[] = [];
  const requestFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /warning/i.test(message.type())) {
      consoleFailures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageFailures.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    const url = new URL(request.url());
    const expectedSupersededRsc =
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      url.pathname === costPath &&
      url.searchParams.has("_rsc") &&
      failure === "net::ERR_ABORTED";
    if (!expectedSupersededRsc) {
      requestFailures.push(`${request.method()} ${request.url()} ${failure}`);
    }
  });

  const response = await page.goto(fixture.deepLinks.costs, {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(200);
  await openProduction(page);

  const actionResponses: Array<{
    status: number;
    requestBody: string;
    responseBody: string;
  }> = [];
  page.on("response", async (actionResponse) => {
    if (
      actionResponse.request().method() !== "POST" ||
      new URL(actionResponse.url()).pathname !== costPath
    ) {
      return;
    }
    actionResponses.push({
      status: actionResponse.status(),
      requestBody: actionResponse.request().postData() ?? "",
      responseBody: await actionResponse.text(),
    });
  });

  const filling = page
    .getByRole("spinbutton", {
      name: /Filling \/ blending tier total.*Validation 100/,
    })
    .first();
  const assemblyCost = page
    .getByRole("spinbutton", {
      name: /CM assembly tier total.*Validation 100/,
    })
    .first();

  // Both edits occur before either cell's 500 ms debounce can complete.
  await filling.fill("125");
  await assemblyCost.fill("75");

  await expect
    .poll(() => actionResponses.length, {
      message: "both debounced Server Actions reached the browser",
    })
    .toBe(2);
  expect(actionResponses.map((entry) => entry.status)).toEqual([200, 200]);
  expect(
    actionResponses.some(
      (entry) =>
        entry.requestBody.includes("fillingBlendingCost") &&
        entry.requestBody.includes("125"),
    ),
    "filling edit reached the production action",
  ).toBe(true);
  expect(
    actionResponses.some(
      (entry) =>
        entry.requestBody.includes("cmAssemblyTotal") &&
        entry.requestBody.includes("75"),
    ),
    "CM edit reached the production action",
  ).toBe(true);
  const receipts = actionResponses.map((entry) => entry.responseBody).join("\n");
  expect(receipts).toContain("125.00");
  expect(receipts).toContain("75.00");

  await expect(filling).toHaveValue("125.00");
  await expect(assemblyCost).toHaveValue("75.00");

  await expect.poll(async () => {
    const [row] = await sql<{
      filling_blending_cost: string;
      cm_assembly_total: string;
    }[]>`
      select filling_blending_cost, cm_assembly_total
      from assembly_production_inputs
      where id = ${baseline.id}
    `;
    return row;
  }).toEqual({
    filling_blending_cost: "125.00",
    cm_assembly_total: "75.00",
  });

  const auditRows = await sql<{
    diff_json: Record<string, { from: string; to: string }>;
  }[]>`
    select diff_json from audit_log
    where entity_id = ${baseline.id}
      and action = 'assembly_production_input_updated'
    order by created_at, id
  `;
  expect(auditRows).toHaveLength(2);
  expect(
    auditRows.filter((row) => row.diff_json.fillingBlendingCost),
  ).toEqual([
    {
      diff_json: {
        fillingBlendingCost: { from: "100.00", to: "125.00" },
      },
    },
  ]);
  expect(auditRows.filter((row) => row.diff_json.cmAssemblyTotal)).toEqual([
    {
      diff_json: {
        cmAssemblyTotal: { from: "50.00", to: "75.00" },
      },
    },
  ]);

  await page.reload({ waitUntil: "networkidle" });
  await openProduction(page);
  await expect(
    page
      .getByRole("spinbutton", {
        name: /Filling \/ blending tier total.*Validation 100/,
      })
      .first(),
  ).toHaveValue("125.00");
  await expect(
    page
      .getByRole("spinbutton", {
        name: /CM assembly tier total.*Validation 100/,
      })
      .first(),
  ).toHaveValue("75.00");

  await sql.end();
  expect(consoleFailures, "unexpected console failures").toEqual([]);
  expect(pageFailures, "unexpected page errors").toEqual([]);
  expect(requestFailures, "unexpected failed requests").toEqual([]);
  expect(networkLedger.filter((entry) => entry.blocked)).toEqual([]);
});

test("VAL-104 governed Pricing Vendor persists without exposing dormant Pricing Date", async ({
  page,
  networkLedger,
}) => {
  test.setTimeout(90_000);
  const fixtures = await manifest();
  const draft = fixtures.quotes.draft;
  const setupSql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  const [fixtureLine] = await setupSql<{ line_group_id: string }[]>`
    select ali.line_group_id
    from assembly_leaf_inputs ali
    join assembly_leaves al on al.id = ali.assembly_leaf_id
    join assemblies a on a.id = al.assembly_id
    where a.quote_id = ${draft.quoteId}
    order by ali.sort_order, ali.line_group_id
    limit 1
  `;
  const lineGroupId = fixtureLine.line_group_id;
  await setupSql`
    delete from audit_log
    where entity_type = 'assembly_leaf_input_line'
      and entity_id = ${lineGroupId}
      and action = 'assembly_leaf_input_line_updated'
  `;
  await setupSql`
    update assembly_leaf_inputs
    set pricing_date = '2026-07-15'::date
    where line_group_id = ${lineGroupId}
  `;
  await setupSql.end();
  const consoleFailures: string[] = [];
  const pageFailures: string[] = [];
  const requestFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /warning/i.test(message.type())) {
      consoleFailures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageFailures.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    const url = new URL(request.url());
    const expectedSupersededRsc =
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      /^\/projects\/[^/]+\/quotes\/[^/]+\/costs$/.test(url.pathname) &&
      url.searchParams.has("_rsc") &&
      failure === "net::ERR_ABORTED";
    if (!expectedSupersededRsc) {
      requestFailures.push(`${request.method()} ${request.url()} ${failure}`);
    }
  });

  const response = await page.goto(draft.deepLinks.costs, {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(200);

  // PB-006/PB-007: component identity comes from the cost-bearing LEAF,
  // while the scenario selector exposes only other eligible LEAFs.
  const firstPackagingRow = page.locator(".r6-dt.pkg .r6-dt-row").first();
  await expect(firstPackagingRow.locator(".name .lab")).toHaveText(
    "Validation Leaf 1",
  );
  await expect(firstPackagingRow.locator(".name .sub")).toContainText(
    // Derived, not written down. The fixture builds this code from the runId
    // (`VAL-{RUNID}-1`), so the literal `VAL-SLICE12-1` asserted a value that
    // only exists when NEXUS_VALIDATION_RUN_ID happens to be `slice12` — and
    // every run under any other runId failed here on the spec's own hardcoding
    // rather than on anything the product did. Pattern 53 for the assertion
    // side: read from the same source the fixture read.
    `VAL-${runId.toUpperCase()}-1`,
  );
  await expect(firstPackagingRow.locator(".name .lab")).not.toHaveText(
    "Validation Packaging Vendor",
  );
  await page
    .getByText("Other SKUs in this scenario (2)", { exact: false })
    .click();
  const scenarioContext = page.getByRole("region", {
    name: "SKU + scenario context",
  });
  await expect(scenarioContext.getByText("Validation Leaf 2")).toBeVisible();
  await expect(scenarioContext.getByText("Validation Leaf 3")).toBeVisible();
  await expect(
    scenarioContext.getByText("Validation draft assembly"),
  ).toHaveCount(0);

  await expect(page.getByText("Selected vendor").first()).toBeVisible();
  await expect(page.getByText("Validation Packaging Vendor").first()).toBeVisible();
  await expect(firstPackagingRow.getByText("Historical supplier")).toHaveCount(0);
  await expect(page.getByLabel("Pricing Date")).toHaveCount(0);

  const clearReceipt = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      candidate.url().includes(`/quotes/${draft.quoteId}/costs`) &&
      candidate.ok(),
  );
  await page.getByRole("button", { name: "Clear Pricing Vendor" }).first().click();
  await (await clearReceipt).finished();
  const vendorInput = page
    .getByRole("searchbox", { name: "Pricing Vendor" })
    .first();
  await expect(vendorInput).toHaveValue("");
  await expect(
    firstPackagingRow.getByText("Historical supplier"),
  ).toBeVisible();
  await expect(firstPackagingRow.getByText("Validation Supplier")).toBeVisible();

  const emptySearchReceipt = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      candidate.url().includes(`/quotes/${draft.quoteId}/costs`) &&
      candidate.ok(),
  );
  await vendorInput.fill("No Matching Vendor");
  await (await emptySearchReceipt).finished();
  await expect(
    page.getByText('No eligible HubSpot Vendors match “No Matching Vendor”.'),
  ).toBeVisible();

  const searchReceipt = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      candidate.url().includes(`/quotes/${draft.quoteId}/costs`) &&
      candidate.ok(),
  );
  await vendorInput.fill("Contract");
  await (await searchReceipt).finished();
  const saveVendorReceipt = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      candidate.url().includes(`/quotes/${draft.quoteId}/costs`) &&
      candidate.ok(),
  );
  await page
    .getByRole("option", { name: "Validation Contract Manufacturer" })
    .click();
  await (await saveVendorReceipt).finished();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql<{
      line_group_id: string;
      pricing_vendor_hubspot_company_id: string;
      pricing_vendor_name_snapshot: string;
      pricing_date: string;
      supplier: string;
    }[]>`
      select ali.line_group_id, ali.pricing_vendor_hubspot_company_id,
             ali.pricing_vendor_name_snapshot, ali.pricing_date::text,
             ali.supplier
      from assembly_leaf_inputs ali
      join assembly_leaves al on al.id = ali.assembly_leaf_id
      join assemblies a on a.id = al.assembly_id
      where a.quote_id = ${draft.quoteId}
      order by ali.sort_order, ali.line_group_id, ali.tier_id
      limit 2
    `;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.line_group_id))).toEqual(
      new Set([lineGroupId]),
    );
    for (const row of rows) {
      expect(row).toEqual({
        line_group_id: lineGroupId,
        pricing_vendor_hubspot_company_id: "900000000000002",
        pricing_vendor_name_snapshot: "Validation Contract Manufacturer",
        pricing_date: "2026-07-15",
        supplier: "Validation Supplier",
      });
    }
    const audits = await sql<{ diff_json: Record<string, unknown> }[]>`
      select diff_json from audit_log
      where entity_type = 'assembly_leaf_input_line'
        and entity_id = ${lineGroupId}
        and action = 'assembly_leaf_input_line_updated'
      order by created_at
    `;
    expect(
      audits.filter((audit) =>
        Object.hasOwn(
          audit.diff_json,
          "pricing_vendor_hubspot_company_id",
        ),
      ),
    ).toHaveLength(2);
    expect(
      audits.filter((audit) => Object.hasOwn(audit.diff_json, "pricing_date")),
    ).toHaveLength(0);
  } finally {
    await sql.end();
  }

  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByText("Validation Contract Manufacturer").first(),
  ).toBeVisible();
  await expect(page.getByLabel("Pricing Date")).toHaveCount(0);

  const sent = fixtures.quotes.sent;
  await page.goto(sent.deepLinks.costs, { waitUntil: "networkidle" });
  await expect(page.getByLabel("Pricing Date")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear Pricing Vendor" })).toHaveCount(0);

  const complete = fixtures.quotes.complete;
  await page.goto(complete.deepLinks.costs, { waitUntil: "networkidle" });
  await expect(page.getByLabel("Pricing Date")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear Pricing Vendor" })).toHaveCount(0);

  const ledgerPath = process.env.NEXUS_FAKE_HUBSPOT_LEDGER;
  expect(ledgerPath).toBeTruthy();
  const ledger = (await readFile(path.resolve(ledgerPath!), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { operation: string; input: object });
  expect(
    ledger.some(
      (entry) =>
        entry.operation === "vendor-search" &&
        (entry.input as { query?: string }).query === "Contract",
    ),
  ).toBe(true);
  expect(
    ledger.some(
      (entry) =>
        entry.operation === "vendor-resolve" &&
        (entry.input as { companyId?: string }).companyId ===
          "900000000000002",
    ),
  ).toBe(true);

  expect(consoleFailures, "unexpected console failures").toEqual([]);
  expect(pageFailures, "unexpected page errors").toEqual([]);
  expect(requestFailures, "unexpected failed requests").toEqual([]);
  expect(networkLedger.filter((entry) => entry.blocked)).toEqual([]);
});

test("PHASE2 Packaging targets each SKU and omits the Bulk Raw surface", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const draft = (await manifest()).quotes.draft;
  const response = await page.goto(draft.deepLinks.costs, {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("button", { name: /^Add line · VAL-/ })).toHaveCount(3);
  await expect(page.getByText("Bulk Raw", { exact: true })).toHaveCount(0);
  await expect(
    page.locator('button[aria-controls="section-freight-drawer"]'),
  ).toHaveCount(1);

  const targetSku = `VAL-${runId.toUpperCase()}-3`;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [{ count: before }] = await sql<{ count: number }[]>`
      select count(distinct ali.line_group_id)::int as count
      from assembly_leaf_inputs ali
      join assembly_leaves al on al.id = ali.assembly_leaf_id
      join assemblies a on a.id = al.assembly_id
      join leaves l on l.id = al.leaf_id
      where a.quote_id = ${draft.quoteId} and l.sku = ${targetSku}
    `;

    const actionResponse = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().includes(`/quotes/${draft.quoteId}/costs`) &&
        candidate.ok(),
    );
    await page.getByRole("button", { name: `Add line · ${targetSku}` }).click();
    await actionResponse;

    await expect.poll(async () => {
      const [{ count }] = await sql<{ count: number }[]>`
        select count(distinct ali.line_group_id)::int as count
        from assembly_leaf_inputs ali
        join assembly_leaves al on al.id = ali.assembly_leaf_id
        join assemblies a on a.id = al.assembly_id
        join leaves l on l.id = al.leaf_id
        where a.quote_id = ${draft.quoteId} and l.sku = ${targetSku}
      `;
      return count;
    }).toBe(before + 1);
  } finally {
    await sql.end();
  }

  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.locator(".r6-dt.pkg .r6-dt-row .name .sub", { hasText: targetSku }),
  ).toHaveCount(2);
});
