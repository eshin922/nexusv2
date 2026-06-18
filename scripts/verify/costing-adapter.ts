// Slice 11.5 Step 3 — pure-adapter unit test.
//
// Predicate-layer verification #1 from brief §5: given fixture
// NEW-model rows matching a known OLD-model layout, the adapter
// produces a QuoteCostingInput that the math layer consumes to
// produce a sane rollup. Run via:
//
//   npx tsx scripts/verify/costing-adapter.ts
//
// Failure mode: process.exit(1) with the failing assertion +
// observed value. Not yet wired into prebuild — Step 7 verification
// will hook it once the full predicate stack is green.
//
// Fixture shape: one assembly with two leaves + two tiers. Per-
// component packaging costs vary by tier (NEW-model can now express
// volume discounts; Step 6 sample seed margin curve depends on this).
// One assembly_production_inputs row exercises the anchor-leaf
// fan-out. One assembly_leaf_override exercises the per-cell
// override passthrough. One assembly_leaf_target exercises the
// per-cell target passthrough.

import { buildQuoteCostingInputFromNewModel } from "../../src/lib/costing-adapter.ts";
import { computeQuoteCosting } from "../../src/lib/costing.ts";

const failures: string[] = [];

function expect<T>(label: string, actual: T, predicate: (v: T) => boolean) {
  if (predicate(actual)) return;
  failures.push(
    `${label} — got ${JSON.stringify(actual)}`,
  );
}

function eqClose(a: number, b: number, eps = 0.01) {
  return Math.abs(a - b) < eps;
}

// ---------- Fixture (NEW-model shape) ----------

const QUOTE_ID = "q-1";
const TIER_1_ID = "t-1";
const TIER_2_ID = "t-2";
const ASSEMBLY_ID = "asy-1";
const LEAF_A_ID = "leaf-a";
const LEAF_B_ID = "leaf-b";
const LIB_LEAF_A = "lib-a";
const LIB_LEAF_B = "lib-b";

const fixture = {
  quote: {
    id: QUOTE_ID,
    globalPriceAdjPct: 0,
    targetMarginPct: null,
  },
  firmSettings: {
    targetMarginPct: 0.35,
    floorMarginPct: 0.25,
  },
  markupDefaults: { Primary: 0.4, Secondary: 0.3 },
  tiers: [
    { id: TIER_1_ID, label: "T1", qty: 5000, sortOrder: 0, tierPriceAdjPct: null },
    { id: TIER_2_ID, label: "T2", qty: 15000, sortOrder: 1, tierPriceAdjPct: null },
  ],
  assemblies: [
    { id: ASSEMBLY_ID, sku: "HGS-30-001", name: "Hydrating glow serum 30ml", position: 0 },
  ],
  assemblyLeaves: [
    {
      id: LEAF_A_ID,
      assemblyId: ASSEMBLY_ID,
      leafId: LIB_LEAF_A,
      quantity: "1",
      position: 0,
      leafName: "30ml amber bottle",
      leafSku: "LIB-PP-BOTTLE-30",
    },
    {
      id: LEAF_B_ID,
      assemblyId: ASSEMBLY_ID,
      leafId: LIB_LEAF_B,
      quantity: "1",
      position: 1,
      leafName: "30ml dropper",
      leafSku: "LIB-PP-DROPPER-30",
    },
  ],
  assemblyLeafInputs: [
    // Bottle line at two tiers; T2 cheaper per volume discount.
    {
      assemblyLeafId: LEAF_A_ID,
      tierId: TIER_1_ID,
      lineGroupId: "lg-bottle",
      unitCost: "0.50",
      qtyPerSellableUnit: "1",
      category: "Primary",
      markupPct: "0.4",
    },
    {
      assemblyLeafId: LEAF_A_ID,
      tierId: TIER_2_ID,
      lineGroupId: "lg-bottle",
      unitCost: "0.45",
      qtyPerSellableUnit: "1",
      category: "Primary",
      markupPct: "0.4",
    },
    // Dropper line at two tiers; T2 cheaper.
    {
      assemblyLeafId: LEAF_B_ID,
      tierId: TIER_1_ID,
      lineGroupId: "lg-dropper",
      unitCost: "0.15",
      qtyPerSellableUnit: "1",
      category: "Primary",
      markupPct: "0.4",
    },
    {
      assemblyLeafId: LEAF_B_ID,
      tierId: TIER_2_ID,
      lineGroupId: "lg-dropper",
      unitCost: "0.12",
      qtyPerSellableUnit: "1",
      category: "Primary",
      markupPct: "0.4",
    },
  ],
  // Production fields are LUMP $ amounts across the tier; math
  // layer amortizes by (actualUnitsProduced ?? tier.qty). Lumps
  // chosen so per-unit comes out clean:
  //   T1: (filling 600 + cmAssembly 400) / 5000 = $0.20/unit
  //   T2: (filling 900 + cmAssembly 600) / 15000 = $0.10/unit
  assemblyProductionInputs: [
    {
      assemblyId: ASSEMBLY_ID,
      tierId: TIER_1_ID,
      customerShipsRaws: false,
      allocateServiceFeesToCost: true,
      fillingBlendingCost: "600",
      cmAssemblyTotal: "400",
      setupFeeTotal: null,
      toolingArtworkTotal: null,
      rdTotal: null,
      otherServiceTotal: null,
      bulkRawCost: null,
      actualUnitsProduced: null,
    },
    {
      assemblyId: ASSEMBLY_ID,
      tierId: TIER_2_ID,
      customerShipsRaws: false,
      allocateServiceFeesToCost: true,
      fillingBlendingCost: "900",
      cmAssemblyTotal: "600",
      setupFeeTotal: null,
      toolingArtworkTotal: null,
      rdTotal: null,
      otherServiceTotal: null,
      bulkRawCost: null,
      actualUnitsProduced: null,
    },
  ],
  assemblyLeafOverrides: [
    // Leaf A T2 override — math layer should honor.
    {
      assemblyLeafId: LEAF_A_ID,
      tierId: TIER_2_ID,
      sellPriceOverride: "1.50",
    },
  ],
  assemblyLeafTargets: [
    // Leaf B T2 client target — math layer should expose in
    // skuRollup competitiveStatus.
    {
      assemblyLeafId: LEAF_B_ID,
      tierId: TIER_2_ID,
      clientTargetPricePerUnit: "0.30",
    },
  ],
  freightLegGroups: [],
  freightLegs: [],
  freightLegTiers: [],
};

// ---------- Adapter invariants ----------

const input = buildQuoteCostingInputFromNewModel(fixture);

// I1 — skus[] cardinality = assemblies + assembly_leaves
expect(
  "I1 skus[] cardinality",
  input.skus.length,
  (n) => n === 1 + 2,
);

// I2 — assemblies emit as skuRole='assembly' with parentSkuId null
const asyRow = input.skus.find((s) => s.id === ASSEMBLY_ID);
expect(
  "I2 assembly skuRole",
  asyRow?.skuRole,
  (r) => r === "assembly",
);
expect(
  "I2 assembly parentSkuId",
  asyRow?.parentSkuId,
  (v) => v === null,
);

// I3 — assembly_leaves emit as skuRole='leaf' with parentSkuId=assembly_id
const leafARow = input.skus.find((s) => s.id === LEAF_A_ID);
expect(
  "I3 leaf-A skuRole",
  leafARow?.skuRole,
  (r) => r === "leaf",
);
expect(
  "I3 leaf-A parentSkuId",
  leafARow?.parentSkuId,
  (v) => v === ASSEMBLY_ID,
);
expect(
  "I3 leaf-A productName from library",
  leafARow?.productName,
  (v) => v === "30ml amber bottle",
);

// I4 — packaging[] direct passthrough; one entry per assembly_leaf_inputs row
expect(
  "I4 packaging[] cardinality",
  input.packaging.length,
  (n) => n === 4,
);
const pkgLeafAT1 = input.packaging.find(
  (p) => p.quoteSkuId === LEAF_A_ID && p.tierId === TIER_1_ID,
);
expect(
  "I4 packaging unit cost passthrough",
  pkgLeafAT1?.unitCost,
  (v) => v === 0.5,
);

// I5 — production[] anchor-leaf fan-out: assembly_production_inputs (2 rows)
// → production[] (2 rows attached to LEAF_A, the lowest-position leaf)
expect(
  "I5 production[] cardinality (anchor-only)",
  input.production.length,
  (n) => n === 2,
);
expect(
  "I5 production all attached to anchor leaf (LEAF_A)",
  input.production.every((p) => p.quoteSkuId === LEAF_A_ID),
  (b) => b === true,
);

// I6 — cellOverrides[] passthrough on assembly_leaf identity
expect(
  "I6 cellOverrides[] cardinality",
  input.cellOverrides.length,
  (n) => n === 1,
);
expect(
  "I6 cellOverride quoteSkuId = assembly_leaf",
  input.cellOverrides[0]?.quoteSkuId,
  (v) => v === LEAF_A_ID,
);

// I7 — cellTargets[] passthrough on assembly_leaf identity
expect(
  "I7 cellTargets[] cardinality",
  input.cellTargets.length,
  (n) => n === 1,
);
expect(
  "I7 cellTarget value passthrough",
  input.cellTargets[0]?.clientTargetPricePerUnit,
  (v) => v === 0.3,
);

// ---------- Math-layer integration sanity ----------

const result = computeQuoteCosting(input);

// I8 — assembly rollup exists with the expected id
const asyRollup = result.skuRollups.find((s) => s.skuId === ASSEMBLY_ID);
expect(
  "I8 assembly rollup present",
  asyRollup,
  (v) => v !== undefined,
);

// I9 — leaf-A rollup exists; its per-tier cost includes both
// packaging (its own line) AND production (anchor-only attachment).
const leafARollup = result.skuRollups.find((s) => s.skuId === LEAF_A_ID);
expect(
  "I9 leaf-A rollup present",
  leafARollup,
  (v) => v !== undefined,
);

const leafAT1 = leafARollup?.perTier.find((pt) => pt.tierId === TIER_1_ID);
// Expected leaf-A T1 factory cost per unit: packaging 0.50 +
// production amortized (1000 ÷ 5000) = 0.70. No freight in
// fixture; raw is null (customerShipsRaws=false but bulkRawCost
// is null).
expect(
  "I9 leaf-A T1 factoryCostPerUnit composition (pkg + production anchor)",
  leafAT1?.factoryCostPerUnit ?? -1,
  (v) => eqClose(v, 0.70),
);

// I10 — leaf-B rollup: only packaging (no production data; siblings
// of the anchor leaf get no production attribution).
const leafBRollup = result.skuRollups.find((s) => s.skuId === LEAF_B_ID);
const leafBT1 = leafBRollup?.perTier.find((pt) => pt.tierId === TIER_1_ID);
expect(
  "I10 leaf-B T1 factoryCostPerUnit = packaging only (no production)",
  leafBT1?.factoryCostPerUnit ?? -1,
  (v) => eqClose(v, 0.15),
);

// I11 — assembly rollup T2 cost sums children:
//   leaf-A T2 = pkg 0.45 + prod (1500 ÷ 15000) = 0.55
//   leaf-B T2 = pkg 0.12
//   assembly T2 = 0.55 + 0.12 = 0.67
const asyT2 = asyRollup?.perTier.find((pt) => pt.tierId === TIER_2_ID);
expect(
  "I11 assembly T2 factoryCostPerUnit = sum of children (anchor + siblings)",
  asyT2?.factoryCostPerUnit ?? -1,
  (v) => eqClose(v, 0.67),
);

// ---------- Report ----------

if (failures.length === 0) {
  console.log("[costing-adapter] all 11 invariants pass ✓");
  process.exit(0);
}

console.error(`[costing-adapter] ${failures.length} invariant(s) failed:`);
for (const f of failures) console.error(`  ✗ ${f}`);
process.exit(1);
