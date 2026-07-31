import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

function manifest(): FixtureManifest {
  return JSON.parse(
    readFileSync(
      path.resolve(
        process.cwd(),
        ".artifacts",
        "validation",
        runId,
        "fixture-manifest.json",
      ),
      "utf8",
    ),
  ) as FixtureManifest;
}

test("PVS-018 Product Library preserves creation through every catalog state", async ({
  page,
  networkLedger,
}, testInfo) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const successfulName = `Validation PVS-018 Component ${runId}`;
  const successfulSku = `VAL-PVS018-${runId.toUpperCase()}`;
  const productTypeId = `validation-pvs-018-${runId}-leaf`;
  const failedName = "Validation Product Provider Failure";
  const setupPath = manifest().quotes.draft.deepLinks.setup;
  const failures = {
    console: [] as string[],
    page: [] as string[],
    request: [] as string[],
  };
  page.on("console", (message) => {
    if (message.type() === "error" || /warning/i.test(message.type())) {
      failures.console.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.page.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const failure = request.failure()?.errorText ?? "";
    const expectedSupersededRsc =
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      url.pathname === setupPath &&
      url.searchParams.has("_rsc") &&
      failure === "net::ERR_ABORTED";
    const expectedSupersededActionReceipt =
      request.method() === "POST" &&
      request.resourceType() === "fetch" &&
      url.pathname === setupPath &&
      request.headers()["next-action"] !== undefined &&
      failure === "net::ERR_ABORTED";
    // The retained PVS-018 trace and database assertions prove the Server
    // Actions completed before React superseded only their RSC receipts.
    if (!expectedSupersededRsc && !expectedSupersededActionReceipt) {
      failures.request.push(`${request.method()} ${request.url()} ${failure}`);
    }
  });

  const priorLeaves = await sql<{ id: string; archived: boolean }[]>`
    select id, archived from leaves
  `;
  let createdLeafId: string | null = null;

  try {
    await sql`
      insert into product_types (
        id, name, scope, placeholder, hidden
      ) values (
        ${productTypeId}, 'Validation component', 'leaf', true, false
      )
    `;
    await page.goto(manifest().quotes.draft.deepLinks.setup, {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: /add component/i }).click();

    const library = page.getByRole("dialog", { name: /library/i });
    const persistentCreate = library
      .getByRole("button", { name: "+ Create new product", exact: true })
      .first();
    await expect(library.getByText("Loading components", { exact: true })).toBeVisible();
    await expect(library.getByText("Your library is empty", { exact: true })).toHaveCount(0);
    await expect(persistentCreate).toBeVisible();

    await expect(library.getByText("Validation Leaf 1", { exact: true })).toBeVisible();
    await expect(persistentCreate).toBeVisible();
    await testInfo.attach("pvs-018-loaded-state.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await library.getByRole("textbox", { name: "Search library" }).fill("pvs018-no-match");
    await expect(library.getByText("No components match", { exact: true })).toBeVisible();
    await expect(persistentCreate).toBeVisible();
    await testInfo.attach("pvs-018-no-results-state.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await library.getByRole("button", { name: "Close library" }).click();
    await sql`update leaves set archived = true`;
    await page.getByRole("button", { name: /add component/i }).click();
    await expect(library.getByText("Loading components", { exact: true })).toBeVisible();
    await expect(library.getByText("Your library is empty", { exact: true })).toHaveCount(0);
    await expect(library.getByText("Your library is empty", { exact: true })).toBeVisible();
    await expect(persistentCreate).toBeVisible();
    await testInfo.attach("pvs-018-empty-state.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await persistentCreate.click();
    const addProduct = page.getByRole("dialog", { name: /add product/i });
    await addProduct.getByRole("button", { name: /LEAF/ }).click();
    await addProduct.getByRole("textbox", { name: "Leaf name" }).fill(successfulName);
    await addProduct.getByRole("combobox", { name: "Leaf Product Type" }).selectOption({ index: 1 });
    await addProduct.getByRole("textbox", { name: "SKU" }).fill(successfulSku);
    await addProduct.getByRole("button", { name: /Add leaf/ }).click();

    const createdRow = library.getByText(successfulName, { exact: true });
    await expect(createdRow).toBeVisible();
    const [createdLeaf] = await sql<{ id: string; hubspot_product_id: string }[]>`
      select id, hubspot_product_id
      from leaves
      where name = ${successfulName}
    `;
    expect(createdLeaf?.hubspot_product_id).toMatch(/^998\d{12}$/);
    createdLeafId = createdLeaf.id;
    const beforeAttach = await sql<{ n: number }[]>`
      select count(*)::int as n from assembly_leaves where leaf_id = ${createdLeafId}
    `;
    expect(beforeAttach[0]?.n).toBe(0);

    const createdLibraryRow = library.locator(".lib-row").filter({ hasText: successfulName });
    await createdLibraryRow.getByRole("button", { name: "Attach" }).click();
    await expect(createdLibraryRow).toContainText("Attached");
    const afterAttach = await sql<{ n: number }[]>`
      select count(*)::int as n from assembly_leaves where leaf_id = ${createdLeafId}
    `;
    expect(afterAttach[0]?.n).toBe(1);

    await persistentCreate.click();
    await addProduct.getByRole("button", { name: /LEAF/ }).click();
    await addProduct.getByRole("textbox", { name: "Leaf name" }).fill(failedName);
    await addProduct.getByRole("combobox", { name: "Leaf Product Type" }).selectOption({ index: 1 });
    await addProduct.getByRole("button", { name: /Add leaf/ }).click();
    await expect(addProduct.getByRole("alert")).toContainText(
      "Could not create product in HubSpot",
    );
    const failedRows = await sql<{ n: number }[]>`
      select count(*)::int as n from leaves where name = ${failedName}
    `;
    expect(failedRows[0]?.n).toBe(0);

    await testInfo.attach("pvs-018-created-and-attached.png", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    if (createdLeafId) {
      await sql`delete from assembly_leaves where leaf_id = ${createdLeafId}`;
      await sql`
        delete from audit_log
        where (entity_type = 'leaf' and entity_id = ${createdLeafId})
           or (entity_type = 'assembly_leaf' and diff_json ->> 'leaf_id' = ${createdLeafId})
      `;
      await sql`delete from leaves where id = ${createdLeafId}`;
    }
    for (const leaf of priorLeaves) {
      await sql`update leaves set archived = ${leaf.archived} where id = ${leaf.id}`;
    }
    await sql`delete from product_types where id = ${productTypeId}`;
    await sql.end();
  }

  await testInfo.attach("pvs-018-browser-diagnostics.json", {
    body: Buffer.from(JSON.stringify({ failures, networkLedger }, null, 2)),
    contentType: "application/json",
  });
  expect(failures.console, "console errors and warnings").toEqual([]);
  expect(failures.page, "uncaught page errors").toEqual([]);
  expect(failures.request, "failed browser requests").toEqual([]);
  expect(
    networkLedger.filter((entry) => entry.blocked),
    "unexpected outbound network traffic",
  ).toEqual([]);
});
