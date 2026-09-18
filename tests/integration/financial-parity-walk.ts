/** Isolated-only Setup identity -> Costs writer -> snapshot/store -> Pricing guard. */
import assert from "node:assert/strict";
import postgres from "postgres";
import { assertRuntimeSafety } from "../../src/lib/config/runtime-config.ts";

const safety = assertRuntimeSafety();
assert.equal(safety.mode, "isolated", "this walk never runs against production");
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
let chargeId: string | undefined;
try {
  const { createComponentChargesAs } = await import("../../src/lib/component-charges/create.ts");
  const { updateComponentChargeCostAs } = await import("../../src/lib/component-charges/update.ts");
  const { getCostingBundle } = await import("../../src/app/actions/costing.ts");
  const { applyPricingAdjustments } = await import("../../src/app/actions/pricing-lifts.ts");
  const { computeQuoteCosting } = await import("../../src/lib/costing.ts");
  const { buildCostingInput, costingInputFromSnapshot, makeCostingStore } = await import("../../src/lib/costing-store.ts");
  const { costBaseFingerprint } = await import("../../src/lib/pricing-cost-base.ts");
  const [actor] = await sql`select id from users where clerk_user_id = 'validation_clerk_pm'`;
  assert.ok(actor, "isolated PM fixture required");
  const [owner] = await sql`
    select q.id as quote_id, ql.id as leaf_id from quotes q
    join quote_leaves ql on ql.quote_id=q.id
    where q.status='draft' and (select count(*) from quote_tiers t where t.quote_id=q.id) >= 2
    order by q.id, ql.id limit 1`;
  assert.ok(owner, "draft quote with two tiers required");
  const tiers = await sql`select id from quote_tiers where quote_id=${owner.quote_id} order by sort_order,id`;
  const created = await createComponentChargesAs(actor.id, { quoteId: owner.quote_id,
    quoteLeafId: owner.leaf_id, charges: [{ chargeKey: "print_plates", label: "Financial parity isolated walk" }] });
  assert.ok(created.ok, JSON.stringify(created));
  assert.equal(created.data.created.length, 1);
  const charge = { id: created.data.created[0].chargeInstanceId };
  chargeId = charge.id;
  for (const [i, tier] of tiers.entries()) {
    const saved = await updateComponentChargeCostAs(actor.id, { quoteId: owner.quote_id,
      chargeInstanceId: charge.id, tierId: tier.id, cost: String(100 + i * 25) });
    assert.ok(saved.ok, JSON.stringify(saved));
  }
  const loaded = await getCostingBundle(owner.quote_id);
  assert.ok(loaded.ok, JSON.stringify(loaded));
  const snapshot = loaded.data;
  assert.equal(snapshot.componentCharges.filter(c => c.chargeInstanceId === charge.id).length, tiers.length);
  const fromSnapshot = costingInputFromSnapshot(snapshot);
  assert.deepEqual(computeQuoteCosting(fromSnapshot), snapshot.costing, "server and snapshot engine outputs");
  const store = makeCostingStore(snapshot);
  assert.deepEqual(computeQuoteCosting(buildCostingInput(store.getState())), snapshot.costing, "server and store outputs");
  const staged = costBaseFingerprint(fromSnapshot);
  const before = await sql`select global_price_adj_pct from quotes where id=${owner.quote_id}`;
  const changed = await updateComponentChargeCostAs(actor.id, { quoteId: owner.quote_id,
    chargeInstanceId: charge.id, tierId: tiers[0].id, cost: "800" });
  assert.ok(changed.ok, JSON.stringify(changed));
  const fresh = await getCostingBundle(owner.quote_id);
  assert.ok(fresh.ok, JSON.stringify(fresh));
  assert.notEqual(costBaseFingerprint(costingInputFromSnapshot(fresh.data)), staged);
  const applied = await applyPricingAdjustments({ quoteId: owner.quote_id, lifts: [], overrides: [],
    tierAdjustments: [], globalAdjPct: .1234, intent: "apply", economicFingerprint: staged });
  assert.equal(applied.ok, false, "stale Pricing must be refused");
  if (!applied.ok) assert.equal(applied.error.code, "COSTS_STALE", JSON.stringify(applied));
  assert.deepEqual(await sql`select global_price_adj_pct from quotes where id=${owner.quote_id}`, before);
  console.log(JSON.stringify({ setupAuthoring: "pass", tierCostWrites: tiers.length,
    serverSnapshotStoreParity: "pass", stalePricingRefusal: "pass", pricingUnchanged: "pass",
    limitation: "cache revalidation stubbed by script loader; browser and concurrency not exercised" }));
} finally {
  if (chargeId) {
    await sql`delete from quote_charge_instances where id=${chargeId}`;
    const [remaining] = await sql`select count(*)::int as n from quote_charge_instances where id=${chargeId}`;
    assert.equal(remaining.n, 0);
  }
  await sql.end();
}
// Drizzle's shared pool has no exported close handle. This standalone walk ends here.
process.exit(0);
