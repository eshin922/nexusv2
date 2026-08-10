/**
 * Regression — a shipment with at least one destination must not crash Costs.
 *
 * `85d8d1f` (Gate 1B, PR #221) routed freight's governed reads through the
 * canonical graph: `shipReads` is resolved in `FreightDrilldown`, declared by
 * `ShipmentLedger`, and consumed by `DestinationRow` and `CustomsLedger`. The
 * `<ShipmentLedger>` call site was not updated, so `shipReads` arrived
 * `undefined` and `shipReads.get(...)` threw inside `cells.map`.
 *
 * The consequence was disproportionate to the cause and is what this guards:
 * the throw took the **whole Costs page**, not just Freight. React's error
 * boundary replaced the tree, and the completed SSR chunk was never revealed —
 * it stayed parked in `div#S:0` (`hidden`). Every section's markup was
 * therefore present in the DOM and laid out at 0 × 0, which reads as a layout
 * fault and is not one.
 *
 * So this asserts the blast radius rather than the arithmetic: no error
 * surface, and a Packaging trigger with real geometry — the cheapest
 * unambiguous proof that the live tree is the page and not the holding pen.
 * `toBeVisible()` alone would not have caught it; Playwright reports an
 * orphaned-but-present node as hidden, which is the same signal as a
 * legitimately collapsed section.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
async function manifest(): Promise<FixtureManifest> {
  return JSON.parse(await readFile(path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"), "utf8")) as FixtureManifest;
}

test("Costs renders a shipment with at least one destination without entering the error boundary", async ({ page }) => {
  const fixture = (await manifest()).operatorQuotes.oneSku;

  // The precondition is the defect's trigger condition. Asserted rather than
  // assumed: a fixture that lost its destinations would still pass every
  // assertion below while proving nothing.
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [precondition] = await sql<{ destinations: string }[]>`
    select count(*) as destinations
    from freight_destinations fd
    join freight_subcategories fs on fs.id = fd.freight_subcategory_id
    where fs.quote_id = ${fixture.quoteId}
  `;
  await sql.end();
  expect(Number(precondition.destinations)).toBeGreaterThan(0);

  const response = await page.goto(fixture.deepLinks.costs, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  await expect(page.getByText("Costs · runtime error", { exact: true })).toHaveCount(0);

  const packaging = page.locator('button[aria-controls="section-packaging-drawer"]');
  await expect(packaging).toBeVisible();
  const box = await packaging.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // Freight itself renders: the section, the shipment, and a destination row —
  // the three levels the throw sat inside.
  const freight = page.locator('button[aria-controls="section-freight-drawer"]');
  if ((await freight.getAttribute("aria-expanded")) !== "true") await freight.click();
  await expect(page.getByText("Packaging from overseas · ocean container", { exact: true })).toBeVisible();
  await expect(page.getByText(/to Long Beach, CA/).first()).toBeVisible();
});
