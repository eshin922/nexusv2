/**
 * The complete commercial state of a quote, as JSON, for before/after comparison.
 *
 * Written for the downstream regression certification
 * (`docs/validation/downstream-regression-gate.md`): the pre-Finalize capture is
 * the baseline every downstream figure is reconciled against, so it has to hold
 * everything the certification names, not a summary of it.
 *
 * Captures, per tier: quantity, governed revenue and cost, margin and status,
 * the operator-facing unit-price sell and its operands, the separately-billed
 * charges by charge and owner, any unbillable placement, and the customer
 * document's own line projection.
 *
 * Plus the persisted recovery elections, and the quote's identity fields.
 *
 * READ ONLY. It writes one output file and touches nothing else.
 *
 * Usage: ... capture-commercial-state.ts <quoteId> <out.json>
 */
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";

const quoteId = process.argv[2];
const out = process.argv[3];
if (!quoteId || !out) {
  console.error("usage: capture-commercial-state.ts <quoteId> <out.json>");
  process.exit(2);
}

const bundle = await getCostingBundle(quoteId);
if (!bundle.ok) {
  console.error("bundle failed:", bundle.error.code);
  process.exit(1);
}
const costing: any = (bundle.data as any).costing;
const projection: any = projectCommercial(bundle.data as any);

const quoteRow: any[] = (await db.execute(sql`
  select id, status, version_number, quote_number, sent_at, pdf_url,
         global_price_adj_pct, target_margin_pct, scenario_label
    from quotes where id = ${quoteId}`)) as any;

const elections: any[] = (await db.execute(sql`
  select charge_key, mode from quote_charge_recovery
   where quote_id = ${quoteId} order by charge_key`)) as any;

const node = (tierId: string, key: string) =>
  costing.graph.nodes.find((n: any) => n.key === `quote/${tierId}/${key}`);

const tiers = (costing.quoteRollup.perTier ?? costing.quoteRollup).map((t: any, i: number) => {
  const ups = node(t.tierId, "per-unit/unit-price-sell");
  const sep = node(t.tierId, "separate-charges");
  const bad = node(t.tierId, "unbillable-recovery");
  return {
    tierId: t.tierId,
    label: t.label,
    qty: t.qty,
    governed: {
      totalRevenue: t.totalRevenue,
      totalCost: t.totalCost,
      blendedMarginPct: t.blendedMarginPct,
      blendedMarginStatus: t.blendedMarginStatus,
    },
    operatorReadModel: {
      unitPriceSell: ups?.value ?? null,
      operands: (ups?.operands ?? []).map((o: any) => ({ key: o.key, label: o.label, value: o.value })),
      separateChargesTotal: sep?.value ?? null,
      separateCharges: (sep?.operands ?? []).map((o: any) => ({ label: o.label, value: o.value })),
      unbillableTotal: bad?.value ?? null,
      unbillable: (bad?.operands ?? []).map((o: any) => ({ label: o.label, value: o.value })),
    },
    customerDocument: {
      unitSubtotal: projection.tiers[i]?.unitSubtotal ?? null,
      otcSubtotal: projection.tiers[i]?.otcSubtotal ?? null,
      tierCommercialTotal: projection.tiers[i]?.tierCommercialTotal ?? null,
    },
  };
});

const lines = projection.lines.map((l: any) => ({
  key: l.key,
  kind: l.kind,
  displayName: l.displayName,
  displaySku: l.displaySku,
  quoteLeafId: l.quoteLeafId,
  owningAssemblyId: l.owningAssemblyId,
  bv011Destination: l.bv011Destination,
  serviceIdentity: l.serviceIdentity,
  cells: (l.cells ?? []).map((c: any) => ({
    state: c.state,
    unitRate: c.unitRate,
    quantity: c.quantity,
    lineAmount: c.lineAmount,
  })),
}));

const skuRollups = costing.skuRollups.map((s: any) => ({
  skuId: s.skuId,
  skuLabel: s.skuLabel,
  productName: s.productName,
  skuRole: s.skuRole,
  parentSkuId: s.parentSkuId,
  qtyPerParent: s.qtyPerParent,
  perTier: s.perTier.map((p: any) => ({
    tierId: p.tierId,
    computedSellPerUnit: p.computedSellPerUnit,
    requiredSellPerUnit: p.requiredSellPerUnit,
    contributionCostPerUnit: p.contributionCostPerUnit,
    sellSource: p.sellSource,
    embeddedRecoveryTotal: p.embeddedRecoveryTotal,
  })),
}));

const snapshot = {
  capturedAtIso: new Date().toISOString(),
  quote: quoteRow[0],
  elections,
  tiers,
  lines,
  skuRollups,
};

writeFileSync(out, JSON.stringify(snapshot, null, 2));
console.log(`captured -> ${out}`);
console.log(`  quote ${quoteRow[0].id.slice(0, 8)} status=${quoteRow[0].status} v${quoteRow[0].version_number} number=${quoteRow[0].quote_number ?? "(none)"}`);
console.log(`  ${elections.length} election(s): ${elections.map((e) => `${e.charge_key}=${e.mode}`).join(" ")}`);
for (const t of tiers)
  console.log(
    `  ${String(t.label).padEnd(7)} qty=${String(t.qty).padStart(6)} revenue=${t.governed.totalRevenue}` +
      ` cost=${t.governed.totalCost} unitPriceSell=${t.operatorReadModel.unitPriceSell}` +
      ` sep=${t.operatorReadModel.separateChargesTotal} doc=${t.customerDocument.tierCommercialTotal}`,
  );
console.log(`  ${lines.length} projected line(s)`);
process.exit(0);
