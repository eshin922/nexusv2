/** READ-ONLY. Placement neutrality at assembly grain, reconciled field by field.
 *
 *  The 29 Class-A fixtures test a property the 53-quote population control
 *  cannot: they hold the economics fixed and MOVE the placement. The population
 *  compares main against branch at each quote's current placement, so a
 *  placement-dependent total is invisible to it.
 *
 *  Same Item Group, same money, twice: fees absorbed into unit cost, and fees
 *  billed separately. Every constructor field, every rollup operand and the
 *  document result are printed for both, so the delta can be attributed rather
 *  than guessed at.
 */
import { computeQuoteCosting } from "@/lib/costing";
import { projectCommercial } from "@/lib/commercial-projection";
import type { QuoteCostingInput } from "@/lib/costing";

const TIER = "t1";
const QTY = 1000;
const SETUP = 1000;

function input(allocate: boolean): QuoteCostingInput {
  return {
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null, freightMarkupPct: 0 },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections: [],
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const,
        skuLabel: "IG", productName: "Group", sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const,
        skuLabel: "L", productName: "Leaf", sortOrder: 0, retailBenchmark: null },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: QTY, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      { quoteSkuId: "leaf", tierId: TIER, lineGroupId: "pkg",
        unitCost: 1, qtyPerSellableUnit: 1, category: "Production", markupPct: 0 },
    ],
    production: [],
    assemblyProduction: [
      {
        assemblyId: "asm", tierId: TIER,
        allocateServiceFeesToCost: allocate,
        setupFeeTotal: SETUP,
        toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
        rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
        fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
        actualUnitsProduced: null,
      },
    ],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as unknown as QuoteCostingInput;
}

const f = (v: unknown) => (typeof v === "number" ? v.toFixed(4) : String(v ?? "-"));

for (const allocate of [true, false]) {
  const inp = input(allocate);
  const costing = computeQuoteCosting(inp);
  const asm = costing.skuRollups.find((r) => r.skuId === "asm")!;
  const leaf = costing.skuRollups.find((r) => r.skuId === "leaf")!;
  const a = asm.perTier[0];
  const l = leaf.perTier[0];
  const con = (a as unknown as { constructed?: Record<string, unknown> }).constructed ?? {};
  const qr = costing.quoteRollup[0];

  const bundle = {
    markupDefaults: inp.markupDefaults,
    skus: inp.skus,
    production: inp.production,
    assemblyProduction: inp.assemblyProduction,
    costing,
  } as never;
  const doc = projectCommercial(bundle);
  const docTier = doc.tiers.find((t) => t.tierId === TIER)!;

  console.log(`\n${"=".repeat(66)}`);
  console.log(`allocateServiceFeesToCost = ${allocate}   (setup fee ${SETUP}, qty ${QTY})`);
  console.log("=".repeat(66));
  console.log("CONSTRUCTOR (assembly)");
  for (const k of [
    "unitPriceCostLegacy", "unitPriceCostElected",
    "unitPriceRecoveryLegacy", "unitPriceRecoveryElected",
    "separateLineCost", "separateLineRecovery",
  ]) console.log(`   %-28s %s`.replace("%-28s", k.padEnd(28)), f(con[k] as number));
  const charges = (con.charges ?? []) as Array<Record<string, unknown>>;
  for (const ch of charges)
    console.log(`   placed ${ch.chargeKey} placement=${ch.placement} source=${ch.source} cost=${f(ch.cost as number)} rec=${f(ch.recoverableSell as number)}`);

  console.log("ASSEMBLY ROLLUP");
  for (const k of [
    "productionCostPerUnit", "rawCostPerUnit", "separateServiceFeesPerUnit",
    "amortizedCostPerUnit", "amortizedRecoveryPerUnit",
    "contributionCostPerUnit", "sellBeforeAdjustmentPerUnit",
    "requiredSellPerUnit", "cost", "revenue",
  ]) console.log(`   ${k.padEnd(30)} ${f((a as unknown as Record<string, number>)[k])}`);

  console.log("LEAF ROLLUP");
  for (const k of ["contributionCostPerUnit", "requiredSellPerUnit", "cost", "revenue"])
    console.log(`   ${k.padEnd(30)} ${f((l as unknown as Record<string, number>)[k])}`);

  console.log("QUOTE TIER");
  console.log(`   totalCost                      ${f(qr.totalCost)}`);
  console.log(`   totalRevenue                   ${f(qr.totalRevenue)}`);

  console.log("DOCUMENT");
  const lines = (docTier as unknown as { lines?: Array<Record<string, unknown>> }).lines ?? [];
  console.log(`   tier total                     ${f((docTier as unknown as Record<string, number>).total)}`);
  for (const [k, v] of Object.entries(docTier)) {
    if (typeof v === "number") console.log(`   ${k.padEnd(30)} ${f(v)}`);
  }
  for (const ln of lines)
    console.log(`   line ${ln.key ?? ln.label} amount=${f(ln.amount as number)}`);
}
process.exit(0);
