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

test("Product creation hierarchy preserves the approved ASY default", async ({
  page,
}) => {
  await page.goto(manifest().quotes.draft.deepLinks.setup, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: /add component/i }).click();
  const library = page.getByRole("dialog", { name: /library/i });
  await library
    .getByRole("button", { name: "+ Create new product", exact: true })
    .first()
    .click();

  const modal = page.getByRole("dialog", { name: /add product/i });
  const modes = modal.locator(".a1v2-mode-toggle > button");
  await expect(modes).toHaveCount(2);
  await expect(modes.nth(0)).toContainText("LEAF");
  await expect(modes.nth(1)).toContainText("ASY");
  await expect(modes.nth(1)).toHaveClass(/active/);
  await expect(modes.nth(0)).toBeEnabled();
  await expect(modes.nth(1)).toBeEnabled();
  await modes.nth(0).focus();
  await expect(modes.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(modes.nth(1)).toBeFocused();
  await modal.screenshot({
    path: ".artifacts/validation/product-library-hierarchy-after.png",
  });
});

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
      -- Idempotent because cleanup is not guaranteed to have run: a scenario
      -- that fails partway leaves this row behind, and the NEXT run then died
      -- on a primary-key collision during SETUP -- reporting an error that had
      -- nothing to do with what it was testing. Setup should be able to start
      -- from the debris of a previous failure.
      insert into product_types (
        id, name, scope, placeholder, hidden
      ) values (
        ${productTypeId}, 'Validation component', 'leaf', true, false
      )
      on conflict (id) do update set
        name = excluded.name,
        scope = excluded.scope,
        placeholder = excluded.placeholder,
        hidden = excluded.hidden
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

    // Loaded state: the catalog renders components. This asserted a specific
    // name until the governed catalog grew past a page -- the library now
    // shows "50 of 1048", ordered alphabetically, so `Validation Leaf 1` is
    // simply off the first page and its absence says nothing about loading.
    //
    // The intent is kept in two halves rather than dropped: the list is
    // populated, and the governed leaf is genuinely IN the catalog -- which
    // searching proves more strongly than first-page presence ever did.
    await expect(library.getByRole("button", { name: "Attach" }).first()).toBeVisible();
    const search = library.getByRole("textbox", { name: "Search library" });
    await search.fill("Validation Leaf 1");
    await expect(library.getByText("Validation Leaf 1", { exact: true })).toBeVisible();
    await search.fill("");
    await expect(library.getByRole("button", { name: "Attach" }).first()).toBeVisible();
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

    // Governed post-create contract: creation is immediately CONFIRMED and
    // deterministically DISCOVERABLE. It does not imply first-page placement
    // in an alphabetically paginated catalog -- this library is 50 of 1000+,
    // so a new name lands wherever it sorts. Asserting unfiltered first-page
    // visibility tested the alphabet, not the product.
    //
    // Two independent facts instead, neither of which is database existence:

    // 1. Immediate confirmation -- the toast names what was actually created.
    //    It has to name it: the confirmation is the only evidence the operator
    //    gets on this branch, and a confirmation that cannot say what it
    //    confirms is not one. The name is captured before onClose() resets the
    //    form, or this reads Added "" to the library.
    await expect(
      page.getByText(`Added "${successfulName}" to the library`, { exact: false }),
    ).toBeVisible();

    // 2. Catalog discoverability -- exact-name search returns it.
    //
    //    The library does not close on create, and it runs the search itself:
    //    onSuccess refocuses the catalog on the created name. So assert the
    //    state the operator is actually left in. An earlier revision reopened
    //    the library first and hung for 24s, because it was clicking a page
    //    button sitting behind the library's own backdrop -- the modal it
    //    meant to open had never closed.
    //
    //    Deliberately not asserted: unfiltered first-page visibility. This
    //    catalog is 1049 components paginated alphabetically, so that would
    //    test the alphabet rather than the product.
    await expect(
      library.getByRole("textbox", { name: "Search library" }),
    ).toHaveValue(successfulName);
    // Exactly one, not merely at least one. The name is deterministic across
    // runs, so leftovers from a run that died mid-scenario would otherwise
    // satisfy a visibility check and quietly pass on someone else's component.
    await expect(
      library.locator(".lib-row").filter({ hasText: successfulName }),
    ).toHaveCount(1);
    const [createdLeaf] = await sql<{ id: string; hubspot_product_id: string }[]>`
      select id, hubspot_product_id
      from leaves
      where name = ${successfulName}
    `;
    expect(createdLeaf?.hubspot_product_id).toMatch(/^998\d{12}$/);
    createdLeafId = createdLeaf.id;
    const productCreateCalls = readFileSync(
      path.resolve(
        process.cwd(),
        ".artifacts",
        "validation",
        runId,
        "fake-hubspot-calls.jsonl",
      ),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { operation: string; input: Record<string, unknown> })
      .filter(
        (call) =>
          call.operation === "product-create" && call.input.name === successfulName,
      );
    expect(productCreateCalls).toHaveLength(1);
    expect(productCreateCalls[0]?.input.price).toBe("0.00");
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
    // Clean up by fixture IDENTITY, not by the id captured mid-scenario.
    //
    // `createdLeafId` is only assigned after the discoverability assertions, so
    // a run that failed before them left its component behind. The name is
    // deterministic, so the NEXT run then found several identically-named
    // components, and the exact-name assertion failed on ambiguity -- reporting
    // a discoverability defect that was really the previous run's debris. Three
    // accumulated before the pattern was visible.
    //
    // Anything carrying this scenario's SKU that did not exist at entry was
    // created by this run, whether or not it got as far as being recorded.
    const priorIds = new Set(priorLeaves.map((leaf) => leaf.id));
    const mine = (await sql<{ id: string }[]>`
      select id from leaves where sku = ${successfulSku} or name = ${successfulName}
    `).map((leaf) => leaf.id).filter((id) => !priorIds.has(id));
    if (createdLeafId && !mine.includes(createdLeafId)) mine.push(createdLeafId);
    for (const leafId of mine) {
      // Attaching writes BOTH junctions. Removing only assembly_leaves left
      // quote_leaves pointing at the row, and Postgres refused the delete --
      // an FK violation raised from cleanup, which reads like a scenario
      // failure and is not one.
      await sql`delete from assembly_leaves where leaf_id = ${leafId}`;
      await sql`delete from quote_leaves where leaf_id = ${leafId}`;
      await sql`
        delete from audit_log
        where (entity_type = 'leaf' and entity_id = ${leafId})
           or (entity_type = 'assembly_leaf' and diff_json ->> 'leaf_id' = ${leafId})
      `;
      await sql`delete from leaves where id = ${leafId}`;
    }
    for (const leaf of priorLeaves) {
      await sql`update leaves set archived = ${leaf.archived} where id = ${leaf.id}`;
    }
    // Detach before dropping the type. Cleanup only ever removed the leaf it
    // created, so a type assigned to an EXISTING governed leaf during the run
    // was still referenced at drop time and Postgres correctly refused --
    // surfacing as an FK violation from the cleanup rather than from the
    // scenario, which is a confusing place to read a failure.
    //
    // Null rather than delete: this product type is test-scoped, so anything
    // still pointing at it was typed BY this run, and the fixture default for
    // these leaves is untyped. Clearing restores that; deleting would destroy
    // a governed fixture leaf.
    await sql`
      update leaves set product_type_id = null where product_type_id = ${productTypeId}
    `;
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
