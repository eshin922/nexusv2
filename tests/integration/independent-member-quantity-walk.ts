import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { assertRuntimeSafety } from "../../src/lib/config/runtime-config.ts";

async function main() {
  assert.equal(assertRuntimeSafety().mode, "isolated");
  const manifest = JSON.parse(await readFile(path.resolve(".artifacts", "validation", process.env.NEXUS_VALIDATION_RUN_ID!, "fixture-manifest.json"), "utf8"));
  const source = manifest.quotes.draft;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const { db } = await import("../../src/db/index.ts");
  const { cloneQuoteGraph } = await import("../../src/app/actions/quotes.ts");
  const { setProductTierQuantity } = await import("../../src/app/actions/product-quantities.ts");
  const { getCostingBundle } = await import("../../src/app/actions/costing.ts");
  const { projectCommercial } = await import("../../src/lib/commercial-projection.ts");
  const { resolveCustomerView } = await import("../../src/lib/customer-view-resolver.ts");
  let cloneId: string | undefined;
  try {
    const cloned = await db.transaction((tx) => cloneQuoteGraph(tx, { sourceQuoteId: source.quoteId, targetProjectId: source.projectId, newScenarioLabel: "Independent member proof", intentNote: null, customerTargetTierLabel: null, createdByUserId: manifest.users.pm }));
    cloneId = cloned.newQuoteId;
    const [tier] = await sql`select id from quote_tiers where quote_id=${cloneId} order by sort_order limit 1`;
    await sql`update quote_tiers set qty=500 where id=${tier.id}`;
    const [group] = await sql`select id from assemblies where quote_id=${cloneId} order by position limit 1`;
    const members = await sql`select id from quote_leaves where assembly_id=${group.id} order by position`;
    assert.ok(members.length > 1);
    const form = new FormData();
    form.set("kind", "leaf"); form.set("ownerId", members[0].id); form.set("tierId", tier.id); form.set("quantity", "200");
    const saved = await setProductTierQuantity(form);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const bundle = await getCostingBundle(cloneId);
    assert.equal(bundle.ok, true, JSON.stringify(bundle));
    if (!bundle.ok) throw new Error("Costing unavailable");
    const rollup = (id: string) => bundle.data.costing.skuRollups.find((sku) => sku.skuId === id)!.perTier.find((pt) => pt.tierId === tier.id)!;
    assert.equal(rollup(members[0].id).orderQuantity, 200);
    assert.equal(rollup(members[0].id).independentMemberQuantity, true);
    assert.equal(rollup(members[1].id).orderQuantity, 500);
    assert.equal(rollup(group.id).orderQuantity, 500);
    const projected = projectCommercial(bundle.data);
    const memberLine = projected.lines.find((line) => line.quoteLeafId === members[0].id);
    assert.ok(memberLine);
    const tierIndex = projected.tiers.findIndex((value) => value.tierId === tier.id);
    const cell = memberLine.cells[tierIndex];
    assert.equal(cell?.state, "priced");
    if (cell?.state === "priced") assert.equal(cell.quantity, 200);
    const customer = await resolveCustomerView({ quoteId: cloneId });
    assert.equal(customer.ok, true);
    if (customer.ok) {
      const customerLine = customer.commercial.lines.find((line) => line.quoteLeafId === members[0].id);
      const customerCell = customerLine?.cells[tierIndex];
      assert.equal(customerCell?.state, "priced");
      if (customerCell?.state === "priced") assert.equal(customerCell.quantity, 200);
    }
    console.log(JSON.stringify({ groupedWriter: "pass", memberQuantity: 200, siblingQuantity: 500, groupQuantity: 500, commercialProjection: "pass", customerResolver: "pass", limitation: "Cache invalidation stubbed; no real NetSuite posting" }));
  } finally {
    if (cloneId) await sql`delete from quotes where id=${cloneId}`;
    await sql.end();
  }
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
