/**
 * B-2 · every lever that changes the quoted price has a visible row.
 *
 * THE CONTRACT (R11 §4, marked load-bearing)
 *
 *   Every lever that can change a quoted price owes the cost stack a row. If it
 *   cannot be shown as a row, the stack cannot assert reconciliation, and the
 *   assertion is the thing that makes the stack trustworthy.
 *
 * WHY THE RECONCILIATION STRIP DID NOT CATCH THIS
 *
 * The strip reads GOVERNED NODE VALUES. It reconciles `sellBefore + adjDelta +
 * liftDelta + overrideDelta === sell` whether or not any of those four was ever
 * rendered — so at `81de6bb` it printed ✓ over a stack that was silently
 * missing `Surgical lifts`, while a staged lift moved `Quoted sell` by $0.1331
 * with nothing on screen accounting for it.
 *
 * THE DETECTOR, AND WHY IT IS NOT CIRCULAR
 *
 * This asserts a property of the RENDERED DOM, in movement:
 *
 *   Δ(Quoted sell) === Δ(Sell before adjustment) + Δ(Price adjustment)
 *                      + Δ(Surgical lifts) + Δ(PM overrides)
 *
 * where every term is read from the staged-delta chips the page actually
 * painted, and a row that does not exist contributes nothing — which is exactly
 * how it fails. It never consults the row-generation logic it is checking, and
 * it never re-reads the governed values the strip already reconciles. It asks
 * one question the strip structurally cannot: *does what the operator can see
 * account for what the operator can see moving?*
 *
 * At `81de6bb` the left side is 0.1331 and the right side is 0. It fails there
 * and passes here, which is the whole point of writing it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import type { Page } from "@playwright/test";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
const STACK = ".psr-detail-section--cost-stack";

async function fixture() {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
  return manifest.operatorQuotes.r3Volume;
}

/**
 * This spec WRITES, so it cleans up after itself — twice over.
 *
 * 1 · COMMITTED LIFTS. One test applies a lift, which persists. A later test
 *     asserting that discarding a STAGED lift removes the row would then
 *     inherit a committed one and fail on the wrong premise; and the residue
 *     would change what the next operator walkthrough sees.
 *
 * 2 · AUDIT ROWS, and this one was found the hard way. Applying writes a
 *     `pricing_adjustments_applied` row. VAL-209 counts those rows for this same
 *     fixture quote and asserts exactly one — so leaving mine behind made
 *     VAL-209 fail with `Expected: 1, Received: 2` while passing in isolation.
 *     Its own teardown is bounded to rows created after IT started, so it can
 *     never clear a row this spec left earlier. Bounded the same way here: this
 *     deletes only what appeared while this file was running.
 */
let quoteUnderTest: string | null = null;
let startedAt: Date | null = null;

async function withSql<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

async function clearCommittedLifts(quoteId: string) {
  await withSql((sql) => sql`delete from quote_leaf_lifts where quote_leaf_id in (
    select id from quote_leaves where quote_id = ${quoteId})`);
}

test.beforeAll(async () => {
  quoteUnderTest = (await fixture()).quoteId;
  startedAt = new Date();
});
test.beforeEach(async () => {
  if (quoteUnderTest) await clearCommittedLifts(quoteUnderTest);
});
test.afterAll(async () => {
  if (!quoteUnderTest || !startedAt) return;
  await clearCommittedLifts(quoteUnderTest);
  const q = quoteUnderTest;
  const since = startedAt;
  await withSql(
    (sql) => sql`delete from audit_log
       where created_at >= ${since}
         and (entity_id = ${q}
              or entity_id in (select id::text from quote_tiers where quote_id = ${q})
              or entity_id in (select id::text from quote_leaves where quote_id = ${q}))`,
  );
});

async function openPricing(page: Page): Promise<void> {
  const f = await fixture();
  await page.goto(`/projects/${f.projectId}/quotes/${f.quoteId}/pricing`);
  await expect(page.locator(`${STACK} .r11-stack`)).toBeVisible({ timeout: 30_000 });
  const reset = page.getByRole("button", { name: /^Reset all$/ });
  if (await reset.count()) await reset.first().click();
  await expect(page.locator(".r12-staging:not(.applied)")).toHaveCount(0, { timeout: 10_000 });
}

/** Row labels currently rendered in the stack, top to bottom. */
async function rowLabels(page: Page): Promise<string[]> {
  return page
    .locator(`${STACK} .r11-srow .r11-slab .n`)
    .allInnerTexts()
    .then((t) => t.map((x) => x.trim()));
}

/** `$1.2345` / `+$0.13` / `−$0.25` → signed number; `—`/absent → null. */
function money(text: string | null): number | null {
  if (text === null) return null;
  const t = text.trim();
  if (t === "" || t === "—") return null;
  const negative = t.startsWith("−") || t.startsWith("-");
  const digits = t.replace(/[^0-9.]/g, "");
  if (digits === "") return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

interface Column {
  /** The row's own figure, per column. */
  value: (number | null)[];
  /** The staged-delta chip on that row, per column. Absent chip = no movement. */
  delta: (number | null)[];
}

/**
 * Read one row's figures and its staged-delta chips, straight from the DOM.
 *
 * A row that is not rendered comes back empty rather than throwing, because an
 * ABSENT ROW IS THE DEFECT UNDER TEST — the caller has to be able to sum over
 * it and come up short.
 */
async function readRow(page: Page, label: string): Promise<Column> {
  return page.evaluate(
    ([stackSel, rowLabel]) => {
      const rows = Array.from(document.querySelectorAll(`${stackSel} .r11-srow`));
      const row = rows.find(
        (r) => r.querySelector(".r11-slab .n")?.textContent?.trim() === rowLabel,
      );
      if (!row) return { value: [], delta: [] };
      const cells = Array.from(row.querySelectorAll(".r11-scell"));
      return {
        value: cells.map((c) => c.querySelector(".sell, .delta, .mg")?.textContent ?? null),
        // KEYED ON `title`, not on `.delta`.
        //
        // `DeltaChip` renders `.delta.pos|neg` — and so does a CONTRIBUTION
        // row's own value, because a contribution is signed. Selecting on the
        // class matched the value on those rows and nothing at all on level
        // rows, which made the decomposition below sum zero against zero and
        // pass vacuously. It passed against the unrepaired build, which is how
        // that was caught. `title="was X · staged Y"` belongs to the staged
        // chip alone and says what it is.
        delta: cells.map(
          (c) => c.querySelector('span[title^="was "]')?.textContent ?? null,
        ),
      };
    },
    [STACK, label] as const,
  ).then((raw) => ({
    value: raw.value.map(money),
    delta: raw.delta.map(money),
  }));
}

/** THE DETECTOR. Movement of the total must be explained by visible parts. */
async function assertRenderedDecomposition(page: Page, context: string): Promise<void> {
  const quoted = await readRow(page, "Quoted sell");
  const parts = await Promise.all(
    ["Sell before adjustment", "Price adjustment", "Surgical lifts", "PM overrides"].map((l) =>
      readRow(page, l),
    ),
  );
  expect(quoted.value.length, `${context}: no Quoted sell row at all`).toBeGreaterThan(0);

  for (let i = 0; i < quoted.value.length; i++) {
    const total = quoted.delta[i] ?? 0;
    // A row that is not rendered contributes 0 — which is precisely how an
    // omitted lever row makes this fail.
    const explained = parts.reduce((sum, p) => sum + (p.delta[i] ?? 0), 0);
    expect(
      Math.abs(total - explained),
      `${context}: column ${i} — Quoted sell moved ${total.toFixed(4)} but the visible ` +
        `contribution rows account for ${explained.toFixed(4)}. A lever moved the price ` +
        `with no row on screen. Rows present: ${(await rowLabels(page)).join(", ")}`,
    ).toBeLessThanOrEqual(0.00025);
  }
}

// ─────────────────────────────────────────────────────── staged → applied

test("B-2 a staged lift renders its rows and explains the movement it caused", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openPricing(page);

  // 1 · no committed lift on this quote, so neither row is present at rest.
  expect(await rowLabels(page)).not.toContain("Surgical lifts");

  // 2 + 3 · stage one, and BOTH rows must appear from the working state.
  await page.getByRole("button", { name: /Lift all \d+ to floor/ }).first().click();
  await expect(page.locator(".r12-staging:not(.applied) .r12-chip")).toHaveCount(1, {
    timeout: 10_000,
  });
  const staged = await rowLabels(page);
  expect(staged, "Surgical lifts did not appear for a STAGED lift").toContain("Surgical lifts");
  expect(staged, "Sell after lifts did not appear with it").toContain("Sell after lifts");

  // Order is part of the contract — a running total read top to bottom.
  expect(staged.indexOf("Surgical lifts")).toBeGreaterThan(staged.indexOf("Sell after adjustment"));
  expect(staged.indexOf("Sell after lifts")).toBe(staged.indexOf("Surgical lifts") + 1);
  expect(staged.indexOf("Quoted sell")).toBeGreaterThan(staged.indexOf("Sell after lifts"));

  // 4 · the displayed contribution explains the displayed movement.
  await assertRenderedDecomposition(page, "staged lift");

  // 5 · apply, and the rows must remain correct from COMMITTED state.
  await page
    .locator(".r12-staging:not(.applied)")
    .getByRole("button", { name: /^Apply \d+ change/ })
    .click();
  await expect(page.locator(".r12-staging:not(.applied)")).toHaveCount(0, { timeout: 30_000 });
  const applied = await rowLabels(page);
  expect(applied, "Surgical lifts vanished once the lift was APPLIED").toContain("Surgical lifts");
  expect(applied).toContain("Sell after lifts");
  // Polled, not read once: Apply persists and then the store reconciles, so the
  // committed graph carrying the lift arrives after the staging bar clears.
  await expect
    .poll(
      async () => (await readRow(page, "Surgical lifts")).value.some((v) => v !== null && Math.abs(v) > 0),
      { timeout: 30_000, message: "an applied lift contributes nothing anywhere" },
    )
    .toBe(true);
  await assertRenderedDecomposition(page, "applied lift");
});

test("B-2 removing the lift releases the rows and the stack stays truthful", async ({ page }) => {
  test.setTimeout(120_000);
  await openPricing(page);

  await page.getByRole("button", { name: /Lift all \d+ to floor/ }).first().click();
  await expect(page.locator(".r12-staging:not(.applied) .r12-chip")).toHaveCount(1, {
    timeout: 10_000,
  });
  expect(await rowLabels(page)).toContain("Surgical lifts");

  // 6 · discard it. Existence follows the governing set in BOTH directions.
  await page.getByRole("button", { name: /^Reset all$/ }).first().click();
  await expect(page.locator(".r12-staging:not(.applied)")).toHaveCount(0, { timeout: 10_000 });
  expect(
    await rowLabels(page),
    "the lift row outlived the lift — existence is not following the working set",
  ).not.toContain("Surgical lifts");
  await assertRenderedDecomposition(page, "after discard");
});

// ──────────────────────────────────── existence-over-delta, preserved

test("B-2 a lift superseded by a direct price keeps its row at zero", async ({ page }) => {
  // §13.3: an override supersedes the computed chain, so a lift underneath it
  // moves the price by nothing. The contribution is legitimately zero — and the
  // row must STILL be there, because the lever exists and the operator needs to
  // see that it was refused rather than silently absent. This is the case that
  // makes existence-over-delta a rule rather than a preference.
  test.setTimeout(120_000);
  await openPricing(page);

  await page.getByRole("button", { name: /Lift all \d+ to floor/ }).first().click();
  await expect(page.locator(".r12-staging:not(.applied) .r12-chip")).toHaveCount(1, {
    timeout: 10_000,
  });
  const chip = await page.locator(".r12-staging:not(.applied) .r12-chip").first().innerText();
  // "Lift {SKU} · {tier} by x%" — act on that same cell.
  const sku = chip.replace(/^Lift\s+/, "").split(" · ")[0].trim();

  const cell = page
    .locator(".r11-brow")
    .filter({ has: page.locator(".r11-bsku .n", { hasText: sku }) })
    .locator(".r11-bcell.act")
    .first();
  await cell.click();
  const openDirect = page.getByRole("button", { name: /Set price directly/ }).first();
  await expect(openDirect).toBeVisible({ timeout: 10_000 });
  await openDirect.click();
  await page.locator(".r12-direct input").first().fill("25.00");
  await page.locator(".r12-direct").getByRole("button", { name: /^Set$/ }).first().click();
  await expect(page.locator(".r12-staging:not(.applied) .r12-chip")).toHaveCount(2, {
    timeout: 10_000,
  });

  const labels = await rowLabels(page);
  expect(labels, "the lift row disappeared once an override superseded it").toContain(
    "Surgical lifts",
  );
  expect(labels).toContain("PM overrides");
  await assertRenderedDecomposition(page, "lift refused by an override");
});

// ───────────────────────────── the detection gap, isolated from row names

test("B-2 the rendered stack decomposes the movement it shows — detector only", async ({
  page,
}) => {
  /**
   * Deliberately NAMES NO ROW.
   *
   * The tests above assert `Surgical lifts` is present, which is a statement
   * about this specific defect. This one asserts only that whatever moved
   * `Quoted sell` is accounted for by rows the operator can see — so it catches
   * ANY future lever that changes the price without earning a row, including
   * one that does not exist yet and has no name to assert.
   *
   * It is also the assertion the reconciliation strip structurally cannot make.
   * The strip reconciles governed node values and would print ✓ here regardless;
   * this reads only what was painted. Verified failing at `81de6bb` with the
   * repair reverted: Quoted sell moved 0.1331, visible rows accounted for 0.
   */
  test.setTimeout(120_000);
  await openPricing(page);
  await page.getByRole("button", { name: /Lift all \d+ to floor/ }).first().click();
  await expect(page.locator(".r12-staging:not(.applied) .r12-chip")).toHaveCount(1, {
    timeout: 10_000,
  });
  await assertRenderedDecomposition(page, "staged lift, detector only");
});
