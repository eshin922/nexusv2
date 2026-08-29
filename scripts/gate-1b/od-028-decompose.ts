/** READ-ONLY. The per-operand decomposition behind the OD-028 population
 *  failure. Changes nothing; runs on `main` and on the branch and the two
 *  outputs are bridged.
 *
 *  Two implementations of the assembly-grain fold have been rejected by the
 *  53-quote control, which means the model of what the old anchor was doing is
 *  incomplete. The member cost delta is ~6.30/unit while the production it
 *  carried is ~0.2018/unit, so the anchor was coupling something else as well.
 *  This dumps the operands that feed cost and sell at every level rather than
 *  the finished breakdown, so the residual can be named.
 *
 *    usage: od-028-decompose <quoteId> <out.json>
 */
import { getCostingBundle } from "@/app/actions/costing";
import { writeFileSync } from "node:fs";

const quoteId = process.argv[2];
const out = process.argv[3];
if (!quoteId || !out) {
  console.error("usage: od-028-decompose <quoteId> <out.json>");
  process.exit(1);
}

const b = await getCostingBundle(quoteId);
if (!b.ok) {
  console.error("bundle failed");
  process.exit(1);
}
const c = b.data.costing;

const n = (v: unknown) => (typeof v === "number" ? Number(v.toFixed(8)) : v ?? null);

type Cell = Record<string, unknown>;
const cells: Cell[] = [];

for (const sku of c.skuRollups) {
  for (const pt of sku.perTier) {
    const con = (pt as unknown as { constructed?: Record<string, unknown> }).constructed;
    cells.push({
      skuId: sku.skuId,
      role: sku.skuRole,
      parent: sku.parentSkuId,
      qtyPerParent: sku.qtyPerParent,
      tierId: pt.tierId,

      // ---- cost operands ----
      packagingCostPerUnit: n(pt.packagingCostPerUnit),
      productionCostPerUnit: n(pt.productionCostPerUnit),
      rawCostPerUnit: n(pt.rawCostPerUnit),
      separateServiceFeesPerUnit: n(
        (pt as unknown as { separateServiceFeesPerUnit?: number }).separateServiceFeesPerUnit,
      ),
      factoryCostPerUnit: n(pt.factoryCostPerUnit),
      contributionCostPerUnit: n(pt.contributionCostPerUnit),

      // ---- markup operands ----
      packagingMarkupSumPerUnit: n(pt.packagingMarkupSumPerUnit),
      productionMarkupSumPerUnit: n(pt.productionMarkupSumPerUnit),
      rawMarkupSumPerUnit: n(pt.rawMarkupSumPerUnit),
      separateServicesMarkupSumPerUnit: n(pt.separateServicesMarkupSumPerUnit),

      // ---- the sell ladder ----
      sellBeforeAdjustmentPerUnit: n(pt.sellBeforeAdjustmentPerUnit),
      adjDeltaPerUnit: n(pt.adjDeltaPerUnit),
      sellAfterAdjustmentPerUnit: n(pt.sellAfterAdjustmentPerUnit),
      liftDeltaPerUnit: n(pt.liftDeltaPerUnit),
      sellAfterLiftPerUnit: n(pt.sellAfterLiftPerUnit),
      overrideDeltaPerUnit: n(pt.overrideDeltaPerUnit),
      requiredSellPerUnit: n(pt.requiredSellPerUnit),
      computedSellPerUnit: n(pt.computedSellPerUnit),
      sellSource: (pt as unknown as { sellSource?: string }).sellSource ?? null,

      // ---- recovery operands ----
      amortizedRecoveryPerUnit: n(pt.amortizedRecoveryPerUnit),
      amortizedCostPerUnit: n(pt.amortizedCostPerUnit),
      embeddedRecoveryTotal: n(pt.embeddedRecoveryTotal),

      // ---- the construction, which is the thing under suspicion ----
      unitPriceCostLegacy: n(con?.unitPriceCostLegacy),
      unitPriceCost: n(con?.unitPriceCost),
      unitPriceRecovery: n(con?.unitPriceRecovery),
      separateLineCost: n(con?.separateLineCost),
      separateLineRecovery: n(con?.separateLineRecovery),

      // ---- the charge population handed to that construction ----
      charges: ((con?.charges ?? []) as Array<Record<string, unknown>>).map((ch) => ({
        chargeKey: ch.chargeKey,
        chargeInstanceId: ch.chargeInstanceId ?? null,
        ownerRef: ch.ownerRef ?? null,
        ownerKind: ch.ownerKind ?? null,
        sourceColumn: ch.sourceColumn ?? null,
        placement: ch.placement,
        source: ch.source,
        cost: n(ch.cost),
        recoverableSell: n(ch.recoverableSell),
        totalRecovered: n(ch.totalRecovered),
      })),

      revenue: n(pt.revenue),
      cost: n(pt.cost),
    });
  }
}

const tiers = c.quoteRollup.map((r) => ({
  tierId: r.tierId,
  label: r.label,
  qty: r.qty,
  totalRevenue: n(r.totalRevenue),
  totalCost: n(r.totalCost),
  blendedMarginPct: n(r.blendedMarginPct),
  breakdown: Object.fromEntries(
    Object.entries(r.costBreakdown).map(([k, v]) => [k, n(v as number)]),
  ),
}));

cells.sort((x, y) => `${x.skuId}${x.tierId}`.localeCompare(`${y.skuId}${y.tierId}`));
writeFileSync(out, JSON.stringify({ quoteId, tiers, cells }, null, 2));
console.log(`[decompose] ${quoteId} · ${cells.length} cells · ${tiers.length} tiers -> ${out}`);
process.exit(0);
