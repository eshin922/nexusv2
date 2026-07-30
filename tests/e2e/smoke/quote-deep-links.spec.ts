import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
function readManifest(): FixtureManifest {
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

for (const state of ["draft", "sent", "accepted", "failed", "complete"] as const) {
  test(`${state} quote deep link renders without browser failures`, async ({
    page,
    networkLedger,
  }, testInfo) => {
    const manifest = readManifest();
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
      const isExpectedCustomerPdfDownloadAbort =
        request.method() === "GET" &&
        request.resourceType() === "document" &&
        /^\/api\/quotes\/[^/]+\/customer-pdf$/.test(
          new URL(request.url()).pathname,
        ) &&
        failure === "net::ERR_ABORTED";
      // Headless Chromium hands an inline PDF iframe response to its download
      // manager, then reports the superseded document load as ERR_ABORTED.
      if (isExpectedCustomerPdfDownloadAbort) return;

      requestFailures.push(
        `${request.method()} ${request.url()} ${failure}`,
      );
    });

    const response = await page.goto(manifest.quotes[state].deepLinks.quote, {
      waitUntil: "networkidle",
    });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Preview Quote/ })).toBeVisible();

    await testInfo.attach("browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify(
        { state, consoleFailures, pageFailures, requestFailures, networkLedger },
        null,
        2,
      )),
      contentType: "application/json",
    });
    expect(pageFailures, "uncaught page errors").toEqual([]);
    expect(consoleFailures, "console errors and warnings").toEqual([]);
    expect(requestFailures, "failed browser requests").toEqual([]);
  });
}
