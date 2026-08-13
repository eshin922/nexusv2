/**
 * Track A · proof 9 — the below-floor warning at the Send decision.
 *
 * Edward's disposition: WARN, DO NOT BLOCK. The three regressions this must
 * hold, and why each one is a separate assertion rather than a detail of the
 * others:
 *
 *   1. Send stays AVAILABLE on a below-floor quote. The failure this guards
 *      against is a warning that quietly grows into a gate — the most natural
 *      way for "warn" to drift into "block" is for someone to add `disabled`
 *      to the button next to it and call it consistency.
 *
 *   2. The warning is VISIBLE AT THE DECISION. Text that exists in the DOM
 *      below the fold is not a warning; it is a record that one was written.
 *      Asserted as position relative to the Send control, not as presence.
 *
 *   3. A compliant quote does NOT show it. The third is the one that would be
 *      easiest to leave untested and is the most important commercially: a
 *      warning that fires on every quote teaches operators that the exception
 *      is routine, which is precisely what this control exists to prevent.
 *
 * PRESENTATION ONLY. `sendQuote` carries no floor gate — verified in
 * src/app/actions/quotes.ts, where the below-floor gate sits in `markAccepted`
 * (line ~2346) and has no counterpart in the send path. This spec therefore
 * asserts the Send control is offered and enabled; it deliberately does NOT
 * click it, because sending destroys the draft fixture other scenarios depend
 * on (VAL-208). What is proven is that Send is not blocked and not gated —
 * not that a below-floor send transaction completes end to end.
 *
 * FIXTURES ARE CHOSEN, NOT MANUFACTURED. `operatorQuotes.sixSku` carries a flat
 * 0.20 packaging markup and lands both tiers below the 0.25 floor; `quotes.draft`
 * clears it on both. Neither is adjusted here — Pattern 53.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

async function readManifest(): Promise<FixtureManifest> {
  const contents = await readFile(
    path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
    "utf8",
  );
  return JSON.parse(contents) as FixtureManifest;
}

test("proof 9 · a below-floor quote warns at Send without blocking it", async ({ page }) => {
  test.setTimeout(90_000);
  const manifest = await readManifest();

  await page.goto(`${manifest.operatorQuotes.sixSku.deepLinks.quote}?tab=send`, {
    waitUntil: "domcontentloaded",
  });

  const warning = page.getByTestId("send-below-floor-warning");
  const sendButton = page.getByRole("button", { name: /Send to client/i });

  // ── 1 · Send remains available ───────────────────────────────────────
  await expect(sendButton).toBeVisible();
  await expect(sendButton).toBeEnabled();

  // ── 2 · The warning is visible, and above the decision ───────────────
  await expect(warning).toBeVisible();

  const warningBox = await warning.boundingBox();
  const buttonBox = await sendButton.boundingBox();
  expect(warningBox, "warning has no layout box").not.toBeNull();
  expect(buttonBox, "send button has no layout box").not.toBeNull();
  expect(
    warningBox!.y,
    "the warning must sit above the Send control, not after it",
  ).toBeLessThan(buttonBox!.y);

  // Both within the viewport at the moment of the decision — an operator who
  // has not scrolled sees the warning and the button together.
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(
    buttonBox!.y + buttonBox!.height,
    "the Send control is below the fold; the warning cannot be said to accompany the decision",
  ).toBeLessThan(viewport!.height);

  // ── The warning has to be ACTIONABLE, not merely present ─────────────
  // Naming the tiers is the difference between a warning an operator can act
  // on and an alarm they learn to dismiss.
  const text = (await warning.textContent()) ?? "";
  expect(text).toMatch(/below the margin floor/i);
  expect(text, "must state that sending is still permitted").toMatch(/not blocked/i);
  expect(text, "must name the downstream consequence").toMatch(/Commercial Approver/i);
});

test("proof 9 · a compliant quote shows no exception language at Send", async ({ page }) => {
  test.setTimeout(90_000);
  const manifest = await readManifest();

  await page.goto(`${manifest.quotes.draft.deepLinks.quote}?tab=send`, {
    waitUntil: "domcontentloaded",
  });

  // The Send surface is genuinely rendered — otherwise "no warning" would pass
  // on a blank page, which is the vacuous-detector failure this guards against.
  await expect(page.getByRole("button", { name: /Send to client/i })).toBeVisible();

  await expect(page.getByTestId("send-below-floor-warning")).toHaveCount(0);
  await expect(page.getByText(/Commercial Approver/i)).toHaveCount(0);
  await expect(page.getByText(/below the margin floor/i)).toHaveCount(0);
});
