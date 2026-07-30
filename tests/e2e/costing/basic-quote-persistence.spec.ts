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
