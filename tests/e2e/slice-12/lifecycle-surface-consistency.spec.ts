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

test("PB-001/PB-005 completion updates canonical status and activity surfaces", async ({
  page,
  networkLedger,
}, testInfo) => {
  const fixture = manifest().quotes.accepted;
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
    const isExpectedSupersededCompletionReceipt =
      request.method() === "POST" &&
      request.resourceType() === "fetch" &&
      /^\/projects\/[^/]+\/quotes\/[^/]+\/quote$/.test(url.pathname) &&
      url.searchParams.get("tab") === "tier" &&
      request.headers()["next-action"] !== undefined &&
      failure === "net::ERR_ABORTED";
    // The retained PB-005 trace shows the successful completion UI before
    // router.refresh() supersedes the Server Action's RSC receipt.
    if (isExpectedSupersededCompletionReceipt) return;

    const isExpectedSupersededLifecycleRsc =
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      url.searchParams.has("_rsc") &&
      (url.pathname === "/" ||
        /^\/projects\/[^/]+$/.test(url.pathname) ||
        /^\/projects\/[^/]+\/quotes\/[^/]+\/quote$/.test(url.pathname)) &&
      failure === "net::ERR_ABORTED";
    // Client navigation cancels prefetched lifecycle RSC payloads after the
    // succeeding destination wins. Scope this to the three surfaces traversed
    // by this trace; any other aborted request remains a test failure.
    if (isExpectedSupersededLifecycleRsc) return;

    requestFailures.push(
      `${request.method()} ${request.url()} ${failure}`,
    );
  });

  await page.goto(`${fixture.deepLinks.quote}?tab=tier`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "Send order to NetSuite" }).click();
  await page.getByTestId("send-order-modal-confirm").click();
  await expect(page.getByText("Order placed", { exact: true })).toBeVisible();
  await expect(page.getByText(/quote state · complete/i)).toBeVisible();

  // Client-side navigation is intentional: PB-005 protects against requiring
  // a hard browser reload to observe lifecycle status and activity.
  await page.locator('a[href="/"]').first().click();
  // Wait for the client-side transition to COMMIT before asserting on the
  // destination. Without this the assertion races the RSC render and its
  // 5s expect timeout decides the outcome -- the same inputs then pass or
  // fail run to run. PB-005 is about not needing a HARD RELOAD; it is not a
  // claim about how fast the soft navigation streams, so waiting for the URL
  // asserts the same behaviour deterministically.
  await page.waitForURL((url) => url.pathname === "/");
  const dealRow = page
    .getByRole("row")
    .filter({ hasText: "Validation accepted deal" });
  await expect(dealRow).toContainText("COMPLETE · LOCKED");
  await expect(dealRow).not.toContainText("DRAFT");
  await dealRow.getByRole("link").click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  await expect(page.getByText("COMPLETE", { exact: true })).toBeVisible();
  await expect(page.getByText(/quote completed/i).first()).toBeVisible();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [quote] = await sql<Array<{ status: string }>>`
      select status from quotes where id = ${fixture.quoteId}
    `;
    const [activity] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from audit_log
      where entity_id = ${fixture.quoteId}
        and action = 'quote_completed'
    `;
    expect(quote?.status).toBe("complete");
    expect(activity?.count).toBe(1);
  } finally {
    await sql.end();
  }

  await testInfo.attach("browser-diagnostics.json", {
    body: Buffer.from(
      JSON.stringify(
        { consoleFailures, pageFailures, requestFailures, networkLedger },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
  expect(pageFailures, "uncaught page errors").toEqual([]);
  expect(consoleFailures, "console errors and warnings").toEqual([]);
  expect(requestFailures, "failed browser requests").toEqual([]);
});
