import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

async function readManifest(): Promise<FixtureManifest> {
  const contents = await readFile(
    path.resolve(
      process.cwd(),
      ".artifacts",
      "validation",
      runId,
      "fixture-manifest.json",
    ),
    "utf8",
  );
  return JSON.parse(contents) as FixtureManifest;
}

test.describe.configure({ mode: "serial" });

test("draft Preview to Send to Client to Client Review", async ({
  page,
  networkLedger,
}, testInfo) => {
  test.setTimeout(90_000);
  const manifest = await readManifest();
  const fixture = manifest.quotes.draft;
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
    const isExpectedCustomerPdfDownloadAbort =
      request.method() === "GET" &&
      request.resourceType() === "document" &&
      /^\/api\/quotes\/[^/]+\/customer-pdf$/.test(
        url.pathname,
      ) &&
      failure === "net::ERR_ABORTED";
    // Headless Chromium hands an inline PDF iframe response to its download
    // manager, then reports the superseded document load as ERR_ABORTED.
    if (isExpectedCustomerPdfDownloadAbort) return;

    const isExpectedSupersededQuoteRscAbort =
      request.method() === "GET" &&
      request.resourceType() === "fetch" &&
      /^\/projects\/[^/]+\/quotes\/[^/]+\/quote$/.test(url.pathname) &&
      url.searchParams.has("_rsc") &&
      failure === "net::ERR_ABORTED";
    // Next cancels an in-flight quote RSC payload when router.refresh() or the
    // next sub-tab navigation supersedes it; the trace shows these returned
    // HTTP 200 text/x-component responses before Chromium reported the abort.
    if (isExpectedSupersededQuoteRscAbort) return;

    const isExpectedSupersededSendActionReceipt =
      request.method() === "POST" &&
      request.resourceType() === "fetch" &&
      /^\/projects\/[^/]+\/quotes\/[^/]+\/quote$/.test(url.pathname) &&
      url.searchParams.get("tab") === "send" &&
      request.headers()["next-action"] !== undefined &&
      failure === "net::ERR_ABORTED";
    // This trace recorded HTTP 200 text/x-component for the send Server Action
    // before the successful transition to Client Review superseded its RSC
    // receipt. Scope this to the quote send action; other POST aborts still fail.
    if (isExpectedSupersededSendActionReceipt) return;

    requestFailures.push(
      `${request.method()} ${request.url()} ${failure}`,
    );
  });

  const response = await page.goto(fixture.deepLinks.quote, {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("tab", { name: /Preview Quote/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("tab", { name: /Send to Client/ }).click();
  await expect(page.getByTestId("send-quote-button")).toBeEnabled();
  await page.getByTestId("send-quote-button").click();
  await expect(page.getByText("Send this quote?")).toBeVisible();
  await page.getByTestId("send-quote-confirm").click();
  await expect(page.getByText("Sent ✓")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("send-quote-success-close").click();

  await expect(page.getByText(/quote state · sent · awaiting customer/i))
    .toBeVisible();
  await page.getByRole("button", { name: /Open Client Review/ }).click();
  await expect(page.getByRole("tab", { name: /Client Review/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Quote v1 sent to owner@nexus-validation.invalid"),
  ).toBeVisible();

  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  try {
    const [quote] = await sql<{
      status: string;
      quote_number: string | null;
      sent_at: Date | null;
      pdf_url: string | null;
    }[]>`
      select status, quote_number, sent_at, pdf_url
      from quotes where id = ${fixture.quoteId}
    `;
    expect(quote?.status).toBe("sent");
    expect(quote?.quote_number).toMatch(/^VAL-\d+$/);
    expect(quote?.sent_at).toBeInstanceOf(Date);
    expect(quote?.pdf_url).toContain("/quote-pdfs/");

    const snapshots = await sql<{
      id: string;
      version_number: number;
      quote_number: string;
      pdf_url: string;
      superseded_at: Date | null;
    }[]>`
      select id, version_number, quote_number, pdf_url, superseded_at
      from quote_snapshots where quote_id = ${fixture.quoteId}
    `;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      version_number: 1,
      quote_number: quote?.quote_number,
      pdf_url: quote?.pdf_url,
      superseded_at: null,
    });

    const pins = await sql<{
      quote_snapshot_id: string;
      target_margin_pct: string;
      floor_margin_pct: string;
      primary_packaging_outcomes: number;
      invalid_attachment_outcomes: number;
    }[]>`
      select
        p.quote_snapshot_id,
        p.target_margin_pct,
        p.floor_margin_pct,
        count(*) filter (
          where mp.category = 'primary_packaging'
            and mp.chosen_rung = 'primary_packaging'
            and mp.markup_pct = 0.2000
        )::int as primary_packaging_outcomes,
        count(*) filter (
          where ql.quote_id <> p.quote_id or qt.quote_id <> p.quote_id
        )::int as invalid_attachment_outcomes
      from quote_commercial_settings_pins p
      join quote_commercial_markup_pins mp on mp.pin_id = p.id
      join quote_leaves ql on ql.id = mp.quote_leaf_id
      join quote_tiers qt on qt.id = mp.tier_id
      where p.quote_id = ${fixture.quoteId}
        and p.superseded_at is null
      group by p.id
    `;
    expect(pins).toEqual([{
      quote_snapshot_id: snapshots[0].id,
      target_margin_pct: "0.3500",
      floor_margin_pct: "0.2500",
      primary_packaging_outcomes: 6,
      invalid_attachment_outcomes: 0,
    }]);

    const reviewEvents = await sql<{
      event_type: string;
      version_number: number;
      note: string | null;
      system: boolean;
    }[]>`
      select event_type, version_number, note, system
      from quote_review_events where quote_id = ${fixture.quoteId}
    `;
    expect(reviewEvents).toEqual([
      {
        event_type: "sent",
        version_number: 1,
        note: "Quote v1 sent to owner@nexus-validation.invalid",
        system: true,
      },
    ]);

    const [audit] = await sql<{ diff_json: Record<string, unknown> }[]>`
      select diff_json from audit_log
      where entity_type = 'quote'
        and entity_id = ${fixture.quoteId}
        and action = 'quote_sent'
      order by created_at desc
      limit 1
    `;
    const pdf = audit?.diff_json?.pdf as
      | { bucket?: string; storagePath?: string }
      | undefined;
    expect(pdf?.bucket).toBe("quote-pdfs");
    expect(pdf?.storagePath).toMatch(
      new RegExp(
        `^${fixture.quoteId}/[0-9a-f]{8}-[0-9a-f-]{27}\\.pdf$`,
      ),
    );

    const artifactRoot = process.env.NEXUS_VALIDATION_ARTIFACT_ROOT;
    expect(artifactRoot, "validation artifact root").toBeTruthy();
    const artifactPath = path.resolve(
      artifactRoot!,
      pdf!.bucket!,
      pdf!.storagePath!,
    );
    expect((await stat(artifactPath)).size).toBeGreaterThan(100);
    expect((await readFile(artifactPath)).subarray(0, 4).toString()).toBe("%PDF");
  } finally {
    await sql.end();
  }

  const ledgerPath = process.env.NEXUS_FAKE_HUBSPOT_LEDGER;
  expect(ledgerPath, "fake HubSpot ledger path").toBeTruthy();
  const hubSpotCalls = (await readFile(path.resolve(ledgerPath!), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      operation: string;
      input: Record<string, unknown>;
    });
  expect(hubSpotCalls).toContainEqual(
    expect.objectContaining({
      operation: "owner-by-id",
      input: { ownerId: "validation_hs_owner_pm" },
    }),
  );

  await testInfo.attach("browser-diagnostics.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          consoleFailures,
          pageFailures,
          requestFailures,
          networkLedger,
          hubSpotCalls,
        },
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
