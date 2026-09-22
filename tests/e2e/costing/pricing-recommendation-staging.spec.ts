/** VAL-209: current floor offers must stage, discard, and commit exactly once.
 * The former ActionCard was removed from the Pricing shell. Exercise the
 * governed per-cell floor offer now rendered by ComplianceGrid instead.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

test("VAL-209 a floor recommendation stages, discards, and applies once", async ({ page, networkLedger }) => {
  test.setTimeout(90_000);
  const manifest = JSON.parse(await readFile(path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"), "utf8")) as FixtureManifest;
  const fixture = manifest.operatorQuotes.r3Volume;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const startedAt = new Date();
  const pageFailures: string[] = [];
  page.on("pageerror", error => pageFailures.push(error.message));
  const lifts = () => sql`
    select l.quote_leaf_id, l.tier_id, l.lift_pct from quote_leaf_lifts l
    join quote_leaves q on q.id = l.quote_leaf_id
    where q.quote_id = ${fixture.quoteId} order by l.quote_leaf_id, l.tier_id`;
  const audits = async () => {
    const [row] = await sql`select count(*)::int as count from audit_log
      where action = 'pricing_adjustments_applied' and entity_id = ${fixture.quoteId}`;
    return row.count as number;
  };
  const otherLevers = async () => ({
    tiers: await sql`select id, tier_price_adj_pct from quote_tiers where quote_id = ${fixture.quoteId} order by id`,
    overrides: await sql`select o.quote_leaf_id, o.tier_id, o.sell_price_override
      from assembly_leaf_overrides o join quote_tiers t on t.id = o.tier_id
      where t.quote_id = ${fixture.quoteId} order by o.quote_leaf_id, o.tier_id`,
  });
  let ownsLifts = false;
  const originalOverrides = await sql`select o.* from assembly_leaf_overrides o
    join quote_tiers t on t.id = o.tier_id where t.quote_id = ${fixture.quoteId}`;
  const [originalCost] = await sql`select i.id, i.unit_cost from assembly_leaf_inputs i
    join quote_tiers t on t.id = i.tier_id where t.quote_id = ${fixture.quoteId}
    and i.unit_cost is not null order by i.id limit 1`;
  try {
    expect(await lifts()).toHaveLength(0);
    ownsLifts = true;
    const auditBefore = await audits();
    const leversBefore = await otherLevers();
    const response = await page.goto(`/projects/${fixture.projectId}/quotes/${fixture.quoteId}/pricing`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    const cta = page.locator(".r11-brow").getByRole("button", { name: "Lift all 1 to floor", exact: true }).first();
    await expect(cta).toBeVisible();
    await cta.click();
    const chips = page.locator(".r12-chip");
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText(/^Lift /);
    const staged = await chips.first().innerText();
    await expect(page.locator(".r12-staging")).toContainText("Staged · not yet applied");
    expect(await lifts()).toHaveLength(0);
    expect(await audits()).toBe(auditBefore);
    await cta.click();
    await expect(chips).toHaveCount(1);
    expect(await chips.first().innerText()).toBe(staged);
    expect(await lifts()).toHaveLength(0);
    await chips.first().getByRole("button").click();
    await expect(chips).toHaveCount(0);
    expect(await lifts()).toHaveLength(0);
    expect(await audits()).toBe(auditBefore);
    await cta.click();
    await page.locator(".r12-staging").getByRole("button", { name: "Apply 1 change", exact: true }).click();
    await expect.poll(async () => (await lifts()).length).toBe(1);
    expect(await audits()).toBe(auditBefore + 1);

    const persisted = await lifts();
    expect(Number(persisted[0].lift_pct)).toBeGreaterThan(0);
    expect(await otherLevers()).toEqual(leversBefore);
    await page.reload({ waitUntil: "networkidle" });
    await expect(chips).toHaveCount(0);
    await expect(page.locator(".r12-staging")).toContainText("Applied");
    expect(await lifts()).toEqual(persisted);
    expect(await audits()).toBe(auditBefore + 1);

    // An already-open Pricing page must refuse when a persisted cost changes.
    // The SQL mutation models another writer; the real action path is covered
    // by the financial-parity integration walk.
    await cta.click();
    await sql`update assembly_leaf_inputs set unit_cost = unit_cost + 1 where id = ${originalCost.id}`;
    await page.locator(".r12-staging").getByRole("button", { name: "Apply 1 change", exact: true }).click();
    await expect(page.locator(".r12-staging [role=alert]")).toContainText("The costs behind this quote changed");
    expect(await lifts()).toEqual(persisted);
    expect(await audits()).toBe(auditBefore + 1);
    await sql`update assembly_leaf_inputs set unit_cost = ${originalCost.unit_cost} where id = ${originalCost.id}`;
    await page.getByRole("button", { name: "Reset all", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });

    // Likewise a competing pricing decision cannot be overwritten by an old tab.
    await cta.click();
    await sql`update quote_leaf_lifts set lift_pct = lift_pct + 0.01
      where quote_leaf_id = ${persisted[0].quote_leaf_id} and tier_id = ${persisted[0].tier_id}`;
    const competing = await lifts();
    await page.locator(".r12-staging").getByRole("button", { name: "Apply 1 change", exact: true }).click();
    await expect(page.locator(".r12-staging [role=alert]")).toContainText("Pricing on this quote changed");
    expect(await lifts()).toEqual(competing);
    expect(await audits()).toBe(auditBefore + 1);
    await page.getByRole("button", { name: "Reset all", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });

    // This intentional action removes all pricing levers, including the
    // fixture's original direct price, but never touches the source costs.
    await page.getByRole("button", { name: "Return to computed baseline", exact: true }).click();
    await expect.poll(async () => (await lifts()).length).toBe(0);
    expect((await otherLevers()).overrides).toHaveLength(0);
    expect((await otherLevers()).tiers.every(t => t.tier_price_adj_pct === null)).toBe(true);
    const [costAfter] = await sql`select unit_cost from assembly_leaf_inputs where id = ${originalCost.id}`;
    expect(costAfter.unit_cost).toBe(originalCost.unit_cost);

    expect(pageFailures).toEqual([]);
    expect(networkLedger.filter(entry => entry.blocked)).toEqual([]);
  } finally {
    if (ownsLifts) {
      await sql`update assembly_leaf_inputs set unit_cost = ${originalCost.unit_cost} where id = ${originalCost.id}`;
      await sql`delete from assembly_leaf_overrides where tier_id in (select id from quote_tiers where quote_id = ${fixture.quoteId})`;
      if (originalOverrides.length) await sql`insert into assembly_leaf_overrides ${sql(originalOverrides)}`;
      await sql`delete from quote_leaf_lifts where quote_leaf_id in (select id from quote_leaves where quote_id = ${fixture.quoteId})`;
      await sql`delete from audit_log where created_at >= ${startedAt} and (
        (action in ('pricing_adjustments_applied', 'pricing_adjustments_cleared') and entity_id = ${fixture.quoteId})
        or (action in ('pricing_lift_applied', 'pricing_lift_removed', 'assembly_leaf_sell_override_updated') and entity_id in (
          select q.id::text || ':' || t.id::text from quote_leaves q
          join quote_tiers t on t.quote_id = q.quote_id where q.quote_id = ${fixture.quoteId})))`;
    }
    await sql.end();
  }
});
