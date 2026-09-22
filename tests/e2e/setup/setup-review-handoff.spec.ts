import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { expect, test } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

async function loadManifest(): Promise<FixtureManifest> {
  return JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
}

test("Setup freight intention persists and hands directly off to Costs", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = (await loadManifest()).quotes.draft;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [original] = await sql<{ freight_intent: string }[]>`
    select freight_intent from quotes where id = ${fixture.quoteId}
  `;
  expect(original).toBeTruthy();

  try {
    const setupResponse = await page.goto(fixture.deepLinks.setup, { waitUntil: "networkidle" });
    expect(setupResponse?.status()).toBe(200);
    const intent = page.getByRole("group", { name: "Freight intention" });
    await expect(intent).toBeVisible();
    await intent.getByRole("button", { name: "Include", exact: true }).click();

    await expect.poll(async () => {
      const [row] = await sql<{ freight_intent: string }[]>`
        select freight_intent from quotes where id = ${fixture.quoteId}
      `;
      return row?.freight_intent;
    }).toBe("include");

    const openCosts = page.getByRole("link", { name: /Continue to Costs/ });
    await expect(openCosts).toBeVisible();
    await expect(openCosts).toHaveAttribute(
      "href",
      `${fixture.deepLinks.costs}?preview=costs-m3`,
    );

    await Promise.all([
      page.waitForURL((url) => url.pathname === fixture.deepLinks.costs),
      openCosts.click(),
    ]);
    await expect(page.getByRole("main")).toBeVisible();

    const pricingHref = fixture.deepLinks.costs.replace(/\/costs$/, "/pricing");
    const pricingResponse = await page.goto(pricingHref, { waitUntil: "networkidle" });
    expect(pricingResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Tune price & review." })).toBeVisible();
  } finally {
    await sql`
      update quotes set freight_intent = ${original.freight_intent}
      where id = ${fixture.quoteId}
    `;
    await sql.end();
  }
});

test("adding and removing a Setup tier preserves the original tier identities", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = (await loadManifest()).quotes.draft;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const originalTiers = await sql<{
    id: string;
    label: string;
    qty: number | null;
    sort_order: number;
  }[]>`
    select id, label, qty, sort_order
    from quote_tiers where quote_id = ${fixture.quoteId}
    order by sort_order, created_at
  `;
  const originalCostCells = await sql<{
    id: string;
    quote_leaf_id: string;
    tier_id: string;
    line_group_id: string;
    unit_cost: string | null;
    markup_pct: string | null;
    qty_per_sellable_unit: string | null;
    purchase_qty: string | null;
    category: string | null;
  }[]>`
    select ali.id, ali.quote_leaf_id, ali.tier_id, ali.line_group_id,
      ali.unit_cost, ali.markup_pct, ali.qty_per_sellable_unit,
      ali.purchase_qty, ali.category
    from assembly_leaf_inputs ali
    join quote_leaves ql on ql.id = ali.quote_leaf_id
    where ql.quote_id = ${fixture.quoteId}
    order by ali.id
  `;
  let temporaryTierId: string | null = null;

  try {
    const setupResponse = await page.goto(fixture.deepLinks.setup, { waitUntil: "networkidle" });
    expect(setupResponse?.status()).toBe(200);
    const addTier = page.getByRole("button", { name: /Add tier/i });
    await expect(addTier).toBeVisible();
    await addTier.click();

    await expect.poll(async () => {
      const rows = await sql<{ id: string; label: string }[]>`
        select id, label from quote_tiers where quote_id = ${fixture.quoteId}
        order by sort_order, created_at
      `;
      if (rows.length !== originalTiers.length + 1) return null;
      temporaryTierId = rows.at(-1)!.id;
      return rows.at(-1)!.label;
    }).toBe(`Tier ${originalTiers.length + 1}`);

    const newTierCells = await sql<{ unit_cost: string | null }[]>`
      select unit_cost from assembly_leaf_inputs where tier_id = ${temporaryTierId}
    `;
    expect(newTierCells.length).toBeGreaterThan(0);
    expect(newTierCells.every((cell) => cell.unit_cost === null)).toBe(true);

    const tierLabels = page.getByRole("textbox", { name: "Tier label" });
    await expect(tierLabels).toHaveCount(originalTiers.length + 1);
    await tierLabels.last().fill("Validation temp tier");
    await tierLabels.last().press("Tab");
    await expect.poll(async () => {
      const [tier] = await sql<{ label: string }[]>`
        select label from quote_tiers where id = ${temporaryTierId}
      `;
      return tier?.label;
    }).toBe("Validation temp tier");

    const openCosts = page.getByRole("link", { name: /Continue to Costs/ });
    await Promise.all([
      page.waitForURL((url) => url.pathname === fixture.deepLinks.costs),
      openCosts.click(),
    ]);
    await expect(page.getByRole("main")).toBeVisible();

    await page.goto(fixture.deepLinks.setup, { waitUntil: "networkidle" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete tier Validation temp tier" }).click();
    await expect.poll(async () => {
      const rows = await sql<{ id: string }[]>`
        select id from quote_tiers where quote_id = ${fixture.quoteId}
        order by sort_order, created_at
      `;
      return rows.map((row) => row.id);
    }).toEqual(originalTiers.map((tier) => tier.id));

    const restored = await sql<{ id: string; label: string; qty: number | null; sort_order: number }[]>`
      select id, label, qty, sort_order
      from quote_tiers where quote_id = ${fixture.quoteId}
      order by sort_order, created_at
    `;
    expect(restored).toEqual(originalTiers);

    const restoredCostCells = await sql`
      select ali.id, ali.quote_leaf_id, ali.tier_id, ali.line_group_id,
        ali.unit_cost, ali.markup_pct, ali.qty_per_sellable_unit,
        ali.purchase_qty, ali.category
      from assembly_leaf_inputs ali
      join quote_leaves ql on ql.id = ali.quote_leaf_id
      where ql.quote_id = ${fixture.quoteId}
      order by ali.id
    `;
    expect(restoredCostCells).toEqual(originalCostCells);
  } finally {
    // Safety net for a failed browser assertion: remove only the tier this test
    // created, leaving the validation fixture's original records untouched.
    if (temporaryTierId) {
      await sql`delete from quote_tiers where id = ${temporaryTierId} and quote_id = ${fixture.quoteId}`;
    }
    await sql.end();
  }
});
