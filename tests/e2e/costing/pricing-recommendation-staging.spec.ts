/**
 * VAL-209 — a recommendation stages; it does not write.
 *
 * WHY THIS EXISTS
 *
 * Nothing pressed a recommendation CTA. Not in the unit suite, and not in any
 * e2e scenario — `bulk-pricing-lift.spec.ts` walks the governed bulk path and
 * stops there. So the R12 interaction contract was asserted in prose and in a
 * source comment, and no test ever put a finger on the button.
 *
 * P3-016 is what that cost. Both recommendation CTAs wrote
 * `quote_tiers.tier_price_adj_pct` at click time, outside the staging model,
 * and it reached production: two writes 727ms apart on a live quote, `null` →
 * `0.1884` → `0.4123`, because the first press produced no chip, no preview and
 * no confirmation, so it was pressed again.
 *
 * The unit guard pins the contract at source level. This walks it — the half a
 * source guard cannot reach, because "the database did not move" is not a
 * statement about source.
 *
 * WHAT IT ASSERTS, IN ORDER
 *
 *   1. pressing the CTA stages — a chip appears
 *   2. the preview moves — a delta appears
 *   3. NOTHING IS WRITTEN — the tier is untouched and no audit row exists
 *   4. pressing again is IDEMPOTENT — the chip does not compound
 *   5. discard restores the committed state, still with nothing written
 *   6. page-level Apply persists EXACTLY ONCE
 *   7. it survives a reload
 *
 * 3, 4 and 6 are the ones with production evidence behind them.
 *
 * SCOPE. This walks the SURGICAL recommendation, which is the only kind any
 * fixture renders. A global recommendation needs a quote reaching
 * `suggestion_led` with more than one tier below target, and no fixture builds
 * one — recorded in the P3-016 record as remaining coverage, since adding it
 * reshapes the fixture world and therefore the baseline.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

test("VAL-209 a pricing recommendation stages, does not write, and applies once", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;

  // r3Volume: 6 SKUs x 4 tiers, SKU 0 at 0.2 markup so every tier breaches the
  // floor. The one fixture that reliably renders a surgical recommendation.
  const fixture = manifest.operatorQuotes.r3Volume;
  const pricingUrl = `/projects/${fixture.projectId}/quotes/${fixture.quoteId}/pricing`;

  const pageFailures: string[] = [];
  page.on("pageerror", (error) => pageFailures.push(error.message));

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  // Bounds the teardown's audit deletion to rows this run produced.
  const startedAt = new Date();
  const tierAdjustments = async () => {
    const rows = await sql<{ id: string; adj: string | null }[]>`
      select id, tier_price_adj_pct as adj from quote_tiers
      where quote_id = ${fixture.quoteId} order by sort_order`;
    return rows.map((r) => r.adj);
  };
  const adjustmentAudits = async () => {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where action = 'tier_price_adj_updated'
        and entity_id in (
          select id::text from quote_tiers where quote_id = ${fixture.quoteId})`;
    return row.count;
  };

  try {
    // The fixture must start with no per-tier adjustment, or "nothing was
    // written" proves nothing. Pattern 53: assert the precondition rather than
    // assume the seed.
    expect(await tierAdjustments()).toEqual([null, null, null, null]);
    expect(
      await adjustmentAudits(),
      "a previous VAL-209 run left its applied adjustment behind; teardown should have restored it",
    ).toBe(0);

    const response = await page.goto(pricingUrl, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);

    // The CTA an operator actually presses. The SuggestionCard's own button does
    // not render in this state, which the P3-016 observation established — so
    // the ActionCard is the path under test, not the one that reads first.
    const cta = page.locator(".psr-action-card button.cta", { hasText: "Apply →" });
    await expect(cta).toBeVisible();

    // The label names ONE tier. It used to list every tier below floor while
    // adjusting one.
    await expect(page.locator(".psr-action-card", { hasText: "Apply Surgical" })).toContainText(
      /Apply Surgical · lift Tier \d+ /,
    );

    // ── 1 · pressing stages ────────────────────────────────────────────────
    await cta.click();
    const chips = page.locator(".r12-chip");
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText(/^Adjust /);
    const staged = (await chips.first().innerText()).replace("✕", "").trim();

    // ── 2 · the preview moves ──────────────────────────────────────────────
    await expect(page.locator(".r12-staging")).toContainText("Staged · not yet applied");
    await expect(page.locator(".delta").first()).toBeVisible();

    // ── 3 · nothing is written ─────────────────────────────────────────────
    expect(await tierAdjustments()).toEqual([null, null, null, null]);
    expect(await adjustmentAudits()).toBe(0);

    // ── 4 · a second press does not compound ───────────────────────────────
    // AM-005: two presses 727ms apart composed 0.1884 into 0.4123 in
    // production. The recommendation is computed from committed state, so it
    // must compose from committed state.
    await cta.click();
    await expect(chips).toHaveCount(1);
    expect((await chips.first().innerText()).replace("✕", "").trim()).toBe(staged);
    expect(await tierAdjustments()).toEqual([null, null, null, null]);

    // ── 5 · discard restores committed, still unwritten ────────────────────
    await chips.first().getByRole("button").click();
    await expect(chips).toHaveCount(0);
    expect(await tierAdjustments()).toEqual([null, null, null, null]);
    expect(await adjustmentAudits()).toBe(0);
    await expect(cta).toBeVisible();

    // ── 6 · page-level Apply persists exactly once ─────────────────────────
    await cta.click();
    await expect(chips).toHaveCount(1);
    await page.locator(".r12-staging button", { hasText: /^Apply 1 change$/ }).click();

    await expect
      .poll(async () => (await tierAdjustments()).filter((a) => a !== null).length)
      .toBe(1);
    // EXACTLY once. A recommendation that wrote at click time AND on Apply
    // would still end with one adjusted tier and two audit rows.
    expect(await adjustmentAudits()).toBe(1);
    const [applied] = await sql<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where action = 'pricing_adjustments_applied' and entity_id = ${fixture.quoteId}`;
    expect(applied.count).toBe(1);

    // ── 7 · it survives a reload ───────────────────────────────────────────
    const persisted = await tierAdjustments();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".r12-chip")).toHaveCount(0);
    await expect(page.locator("[class*='staging']").first()).toContainText("Applied");
    expect(await tierAdjustments()).toEqual(persisted);

    expect(pageFailures, "no uncaught page errors").toEqual([]);
  } finally {
    // Step 6 persists on purpose -- that is the assertion. So this scenario
    // ends by having mutated a governed fixture quote, and it had no teardown
    // at all, which made it a scenario that could pass exactly once.
    //
    // The column was recoverable: a reseed resets tier_price_adj_pct. The
    // audit row was not. audit_log is append-only and survives reseeding, so
    // the `no adjustment audits` precondition could never be met again -- and
    // it failed as a precondition, before the browser opened, reading as
    // though the fixture were wrong rather than as this scenario's own
    // residue. One row from a prior session was enough.
    //
    // Restore both. Deleting audit rows is teardown of data this run created,
    // scoped by time and by this quote's tiers -- the same shape PVS-018's
    // cleanup already uses for the leaf it creates.
    await sql`
      update quote_tiers set tier_price_adj_pct = null
      where quote_id = ${fixture.quoteId}
    `;
    await sql`
      delete from audit_log
      where created_at >= ${startedAt}
        and (
          (action = 'tier_price_adj_updated' and entity_id in (
            select id::text from quote_tiers where quote_id = ${fixture.quoteId}))
          or (action = 'pricing_adjustments_applied' and entity_id = ${fixture.quoteId})
        )
    `;
    await sql.end();
  }
});
