/**
 * DIAGNOSTIC PROBE — vendor-selection boundary. Not a governed scenario.
 *
 * VAL-104 reaches `spec:537` and times out waiting for the save response after
 * selecting a Pricing Vendor. Four boundaries could produce that, with
 * different owners, and the failure artifact cannot separate them:
 *
 *   option not actionable        → harness / rendering / interaction
 *   click fires, no save request → product defect in vendor-save wiring
 *   save request fails           → server / save-path defect
 *   save succeeds, UI stale      → client state-sync defect
 *
 * This walks them in order and reports the FIRST one that fails, using the same
 * interaction driver VAL-104 uses. A previous raw-JS attempt was discarded: the
 * searchbox is a controlled React input, a native value setter did not stick,
 * and every observation downstream of that was worthless.
 *
 * **No force-clicks, no native setters, no synthetic events, no selector
 * workarounds, no timeout inflation.** The point is to find out why the normal
 * interaction cannot complete, and any of those would hide it.
 *
 * REMOVE once the boundary is classified. It is an instrument, not coverage.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
const VENDOR = "Validation Contract Manufacturer";

test("PROBE vendor selection — report the first failing boundary", async ({ page }) => {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
  const draft = manifest.quotes.draft;
  const costsPath = `/projects/${draft.projectId}/quotes/${draft.quoteId}/costs`;

  // Recorders attached BEFORE any interaction, so nothing is missed.
  const posts: string[] = [];
  const responses: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === costsPath) {
      posts.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  page.on("response", (r) => {
    if (r.request().method() === "POST" && new URL(r.url()).pathname === costsPath) {
      responses.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });

  await page.goto(costsPath, { waitUntil: "networkidle" });

  // Reach the searchable state the same way VAL-104 does.
  const clear = page.getByRole("button", { name: "Clear Pricing Vendor" }).first();
  await expect(clear, "BOUNDARY 0 · Clear Pricing Vendor control").toBeVisible();
  await clear.click();

  const box = page.getByRole("searchbox", { name: "Pricing Vendor" }).first();
  await expect(box, "BOUNDARY 0 · searchbox present").toBeVisible();

  // ── BOUNDARY 1 · does the input retain what was typed ────────────────────
  // VAL-104's own term. A full-name query returned no option, and using a
  // different search string than the scenario would answer a different
  // question than the one being classified.
  const QUERY = "Contract";
  await box.fill(QUERY);
  await expect(box, "BOUNDARY 1 · input retains the typed value").toHaveValue(QUERY);

  // ── BOUNDARY 2 · does the option exist ──────────────────────────────────
  const option = page.getByRole("option", { name: VENDOR });
  await expect(option, "BOUNDARY 2 · matching vendor option exists").toHaveCount(1);

  // ── BOUNDARY 3 · is it actionable ───────────────────────────────────────
  await expect(option, "BOUNDARY 3a · option visible").toBeVisible();
  await expect(option, "BOUNDARY 3b · option enabled").toBeEnabled();
  const rect = await option.boundingBox();
  expect(rect, "BOUNDARY 3c · option has geometry").not.toBeNull();
  expect(rect!.width, "BOUNDARY 3c · option width > 0").toBeGreaterThan(0);
  expect(rect!.height, "BOUNDARY 3c · option height > 0").toBeGreaterThan(0);
  console.log(`[probe] option box ${JSON.stringify(rect)}`);

  const postsBefore = posts.length;

  // ── BOUNDARY 4 · does a normal click emit a save request ────────────────
  await option.click();

  // Give the request a bounded chance to appear WITHOUT inflating any timeout:
  // this waits for the observable effect, and its absence is the finding.
  const emitted = await page
    .waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === costsPath,
      { timeout: 10_000 },
    )
    .then((r) => ({ ok: r.ok(), status: r.status() }))
    .catch(() => null);

  console.log(`[probe] posts before=${postsBefore} after=${posts.length}`);
  console.log(`[probe] responses=${JSON.stringify(responses)}`);
  console.log(`[probe] save response=${JSON.stringify(emitted)}`);

  expect(
    posts.length,
    "BOUNDARY 4 · the click emitted a POST to the costs route",
  ).toBeGreaterThan(postsBefore);

  // ── BOUNDARY 5 · did the save succeed ───────────────────────────────────
  expect(emitted, "BOUNDARY 5 · a save response was received").not.toBeNull();
  expect(emitted!.ok, `BOUNDARY 5 · save responded ok (status ${emitted?.status})`).toBe(true);

  // ── BOUNDARY 6 · is the selection reflected in the UI ───────────────────
  await expect(
    page.getByText(VENDOR).first(),
    "BOUNDARY 6 · selected vendor is reflected in the UI",
  ).toBeVisible();
});
