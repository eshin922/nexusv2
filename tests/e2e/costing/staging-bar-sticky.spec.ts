/**
 * B-1 · pending state stays visible from below the fold.
 *
 * WHY THIS EXISTS
 *
 * Every staging affordance on the Pricing surface reports into ONE bar at the
 * top of the page. Operated from below the fold, all of them were silent —
 * measured at 1196px between the grid's bulk lift control and its own
 * confirmation — and the product owner read a working control as broken across
 * three rounds of evidence. Nothing was missing except the ability to see it.
 *
 * WHAT IS ASSERTED, AND WHY IT IS NOT "THE BAR EXISTS"
 *
 * The bar always existed. A test asserting its presence passed BEFORE the
 * repair and would pass after, which makes it worthless as evidence. Each path
 * here asserts four things together:
 *
 *   1. the bar is fully INSIDE THE VIEWPORT after the action;
 *   2. THE GRID DID NOT MOVE — measured in viewport coordinates, not `scrollY`;
 *   3. the control that was operated is still in view;
 *   4. FALSIFICATION — with `position` forced back to `static` on that same
 *      element at that same instant, the bar must leave the viewport.
 *
 * (4) is what makes (1) evidence about the repair rather than about the page
 * happening to be short.
 *
 * WHY THE GRID AND NOT `scrollY`. Inserting the bar adds height above the fold
 * and Chrome's scroll anchoring RAISES `scrollY` to compensate — so a changed
 * `scrollY` is the browser holding the view still, and an UNCHANGED one would
 * mean the content slid. Asserting `scrollY` equality would have been asserting
 * the opposite of the property. Measured against the viewport instead.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
const BAR = ".r12-staging:not(.applied)";
/** The compliance grid — "the operator's working position", stable across renders. */
const GRID = ".r11-stack";

async function openPricing(page: Page): Promise<void> {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
  const f = manifest.operatorQuotes.r3Volume;
  await page.goto(`/projects/${f.projectId}/quotes/${f.quoteId}/pricing`);
  await expect(page.locator(GRID).first()).toBeVisible({ timeout: 30_000 });
  const reset = page.getByRole("button", { name: /^Reset all$/ });
  if (await reset.count()) await reset.first().click();
  await expect(page.locator(BAR)).toHaveCount(0, { timeout: 10_000 });
}

interface Probe {
  present: boolean;
  top: number | null;
  fullyVisible: boolean;
  /** Where the bar would sit with the repair disabled, same instant. */
  topIfStatic: number | null;
  gridTop: number | null;
  scrollY: number;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(
    ([sel, gridSel]) => {
      const grid = document.querySelector(gridSel) as HTMLElement | null;
      const gridTop = grid ? grid.getBoundingClientRect().top : null;
      const el = document.querySelector(sel) as HTMLElement | null;
      const scrollY = window.scrollY;
      if (!el) {
        return { present: false, top: null, fullyVisible: false, topIfStatic: null, gridTop, scrollY };
      }
      const r = el.getBoundingClientRect();
      const prior = el.style.position;
      el.style.position = "static";
      const topIfStatic = el.getBoundingClientRect().top;
      el.style.position = prior;
      return {
        present: true,
        top: r.top,
        fullyVisible: r.top >= 0 && r.bottom <= window.innerHeight,
        topIfStatic,
        gridTop,
        scrollY,
      };
    },
    [BAR, GRID] as const,
  );
}

/**
 * Open the cell-action panel on a cell.
 *
 * Deselects first: the grid toggles (`setSelected(isSel ? null : key)`), so
 * clicking a cell that is already open CLOSES it and the caller silently gets
 * no panel.
 */
async function openCellAction(page: Page, cell: Locator): Promise<void> {
  const selected = page.locator(".r11-bcell.sel");
  if (await selected.count()) await selected.first().click();
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
}

/** Scroll the control below the fold, act, and prove the four properties. */
async function provePath(
  page: Page,
  name: string,
  control: Locator,
  act: () => Promise<void>,
  /**
   * What must still be in view afterwards, when it is not the control itself.
   *
   * Some controls legitimately disappear on use — the direct-price editor
   * collapses back to its opener once a price is committed — so asserting the
   * button is still visible would be asserting the wrong thing. The witness is
   * whatever the operator was working ON, rather than what they pressed.
   */
  witness?: Locator,
): Promise<Probe> {
  await control.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  const before = await probe(page);
  expect(before.present, `${name}: something was already staged`).toBe(false);
  expect(before.scrollY, `${name}: must start scrolled past the bar's home`).toBeGreaterThan(200);

  await act();
  await expect(page.locator(BAR)).toHaveCount(1, { timeout: 10_000 });
  const after = await probe(page);

  expect(after.fullyVisible, `${name}: bar at top=${after.top}, not fully in view`).toBe(true);
  expect(
    Math.abs((after.gridTop ?? 0) - (before.gridTop ?? 0)),
    `${name}: the grid moved ${((after.gridTop ?? 0) - (before.gridTop ?? 0)).toFixed(0)}px ` +
      `(${before.gridTop?.toFixed(0)} → ${after.gridTop?.toFixed(0)}; scrollY ${before.scrollY} → ${after.scrollY})`,
  ).toBeLessThanOrEqual(4);
  expect(
    after.topIfStatic,
    `${name}: unstuck the bar would sit at top=${after.topIfStatic} — still on screen, so this path proves nothing`,
  ).toBeLessThan(0);
  const stillThere = witness ?? control;
  expect(await stillThere.isVisible(), `${name}: the operator's working context left the view`).toBe(true);
  return after;
}

// ───────────────────────────────────────────────── the five staging paths

test("B-1 bulk lift-to-floor", async ({ page }) => {
  test.setTimeout(90_000);
  await openPricing(page);
  const bulk = page.getByRole("button", { name: /Lift all \d+ to floor/ }).first();
  const r = await provePath(page, "bulk lift-to-floor", bulk, () => bulk.click());
  console.log(`  bulk: bar top ${r.top} · unstuck would be ${r.topIfStatic}`);
});

test("B-1 per-cell lift", async ({ page }) => {
  test.setTimeout(90_000);
  await openPricing(page);
  await openCellAction(page, page.locator(".r11-bcell.act").filter({ hasText: /needs/ }).first());
  const lift = page.getByRole("button", { name: /^Lift .+ to floor$/ }).first();
  await expect(lift).toBeVisible({ timeout: 10_000 });
  const r = await provePath(page, "per-cell lift", lift, () => lift.click());
  console.log(`  per-cell lift: bar top ${r.top} · unstuck would be ${r.topIfStatic}`);
});

test("B-1 direct price", async ({ page }) => {
  test.setTimeout(90_000);
  await openPricing(page);
  await openCellAction(page, page.locator(".r11-bcell.act").first());
  const open = page.getByRole("button", { name: /Set price directly/ }).first();
  await expect(open).toBeVisible({ timeout: 10_000 });
  await open.click();
  const input = page.locator(".r12-direct input").first();
  await expect(input).toBeVisible();
  await input.fill("9.99");
  const set = page.locator(".r12-direct").getByRole("button", { name: /^Set$/ }).first();
  // Witness is the selected cell: the `Set` button collapses on commit.
  const r = await provePath(page, "direct price", set, () => set.click(), page.locator(".r11-bcell.sel").first());
  console.log(`  direct price: bar top ${r.top} · unstuck would be ${r.topIfStatic}`);
});

test("B-1 recommendation CTA — which is the per-tier adjustment path", async ({ page }) => {
  // Paths 3 and 4 of the disposition are ONE mechanism in this build:
  // `stageTierAdj` has exactly one caller, the shell's `onApply`, reached from
  // the recommendation CTA. Recorded rather than presented as two proofs.
  test.setTimeout(90_000);
  await openPricing(page);
  const cta = page.getByRole("button", { name: /^Apply →$/ }).first();
  await expect(cta, "no recommendation CTA on this fixture — path unproven").toBeVisible({
    timeout: 10_000,
  });
  // The CTA sits ABOVE the grid, so scroll past it to put the bar off-screen.
  await page.locator(GRID).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const before = await probe(page);
  expect(before.present).toBe(false);
  expect(before.scrollY).toBeGreaterThan(200);
  await cta.click({ force: true });
  await expect(page.locator(BAR)).toHaveCount(1, { timeout: 10_000 });
  const after = await probe(page);
  expect(after.fullyVisible, `recommendation CTA: bar at top=${after.top}`).toBe(true);
  expect(after.topIfStatic, "unstuck the bar would still be on screen").toBeLessThan(0);
  console.log(`  recommendation CTA: bar top ${after.top} · unstuck would be ${after.topIfStatic}`);
});

test("B-1 quote-wide adjustment", async ({ page }) => {
  test.setTimeout(90_000);
  await openPricing(page);
  const stage = page.getByRole("button", { name: /^Stage this adjustment$/ }).first();
  await expect(stage).toBeVisible({ timeout: 10_000 });
  await stage.scrollIntoViewIfNeeded();
  const pct = page
    .locator("div")
    .filter({ hasText: /sell-price lift/ })
    .locator("input")
    .first();
  await pct.fill("7");
  const r = await provePath(page, "quote-wide adjustment", stage, () => stage.click());
  console.log(`  quote-wide adj: bar top ${r.top} · unstuck would be ${r.topIfStatic}`);
});

// ──────────────────────────────── apply, removal, and release from sticky

test("B-1 apply, removal and release all work from the pinned state", async ({ page }) => {
  test.setTimeout(120_000);
  await openPricing(page);

  // Stage two changes from below the fold so removal has something to leave.
  const bulk = page.getByRole("button", { name: /Lift all \d+ to floor/ });
  await bulk.first().scrollIntoViewIfNeeded();
  await bulk.nth(0).click();
  await bulk.nth(1).click();
  await expect(page.locator(`${BAR} .r12-chip`)).toHaveCount(2, { timeout: 10_000 });

  const pinned = await probe(page);
  expect(pinned.fullyVisible, "bar not pinned while staged").toBe(true);

  // REMOVAL from the pinned state — one chip goes, the bar stays.
  await page.locator(`${BAR} .r12-chip button`).first().click();
  await expect(page.locator(`${BAR} .r12-chip`)).toHaveCount(1, { timeout: 10_000 });
  expect((await probe(page)).fullyVisible, "bar left the viewport after a partial removal").toBe(true);

  // APPLY from the pinned state.
  const apply = page.locator(BAR).getByRole("button", { name: /^Apply \d+ change/ });
  await expect(apply).toBeVisible();
  await apply.click();

  // RELEASE. `isStaged` goes false, the sticky element stops being rendered,
  // and whatever replaces it must not be pinned — nothing is pending.
  await expect(page.locator(BAR)).toHaveCount(0, { timeout: 30_000 });
  const applied = page.locator(".r12-staging.applied");
  if (await applied.count()) {
    expect(
      await applied.first().evaluate((el) => getComputedStyle(el).position),
      "the applied bar must not be sticky — nothing is pending",
    ).toBe("static");
  }

  // And a full discard releases it too.
  await page.reload();
  await expect(page.locator(GRID).first()).toBeVisible({ timeout: 30_000 });
  await bulk.first().scrollIntoViewIfNeeded();
  await bulk.first().click();
  await expect(page.locator(BAR)).toHaveCount(1, { timeout: 10_000 });
  await page.getByRole("button", { name: /^Reset all$/ }).first().click();
  await expect(page.locator(BAR)).toHaveCount(0, { timeout: 10_000 });
});

// ─────────────────────────────────────── the hazard the disposition named

test("B-1 the pinned bar does not collide with the inline cost-stack trace", async ({ page }) => {
  // R11 released `.r10-anchor` from `position: sticky` inside `.r11-tracewrap`
  // precisely because two elements pinned at `top: 0` overlay each other. The
  // inline trace shipped under R-1 keeps that release; this proves it, with the
  // bar pinned at the same time.
  test.setTimeout(120_000);
  await openPricing(page);

  const bulk = page.getByRole("button", { name: /Lift all \d+ to floor/ }).first();
  await bulk.scrollIntoViewIfNeeded();
  await bulk.click();
  await expect(page.locator(BAR)).toHaveCount(1, { timeout: 10_000 });

  const stackCell = page
    .locator(".psr-detail-section--cost-stack .r11-srow")
    .filter({ has: page.locator(".r11-slab .n", { hasText: /^Packaging$/ }) })
    .locator("button.r11-scell")
    .first();
  await stackCell.scrollIntoViewIfNeeded();
  await stackCell.click();
  const trace = page.locator(".r11-tracewrap");
  await expect(trace).toHaveCount(1, { timeout: 15_000 });

  const geometry = await page.evaluate(
    ([barSel]) => {
      const bar = document.querySelector(barSel) as HTMLElement | null;
      const wrap = document.querySelector(".r11-tracewrap") as HTMLElement | null;
      const anchor = wrap?.querySelector(".r10-anchor") as HTMLElement | null;
      return {
        barVisible: bar ? bar.getBoundingClientRect().top >= 0 : false,
        barZ: bar ? Number(getComputedStyle(bar).zIndex) : null,
        anchorPosition: anchor ? getComputedStyle(anchor).position : "no anchor",
        anchorZ: anchor ? Number(getComputedStyle(anchor).zIndex) : null,
        overlap:
          bar && anchor
            ? !(
                bar.getBoundingClientRect().bottom <= anchor.getBoundingClientRect().top ||
                bar.getBoundingClientRect().top >= anchor.getBoundingClientRect().bottom
              )
            : false,
      };
    },
    [BAR] as const,
  );

  expect(geometry.barVisible, "the bar stopped being pinned once a trace opened").toBe(true);
  expect(
    geometry.anchorPosition,
    "the trace anchor is sticky again — two elements pinned at top:0 will overlay",
  ).not.toBe("sticky");
  if (geometry.overlap) {
    expect(
      (geometry.barZ ?? 0) > (geometry.anchorZ ?? 0),
      `bar z=${geometry.barZ} does not clear the trace anchor z=${geometry.anchorZ} where they overlap`,
    ).toBe(true);
  }
  console.log(
    `  trace interaction: bar z=${geometry.barZ}, anchor position=${geometry.anchorPosition} z=${geometry.anchorZ}, overlap=${geometry.overlap}`,
  );
});
