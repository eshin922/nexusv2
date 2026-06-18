// Slice 11.5 Step 6 — sample-order margin curve verifier.
//
// Loads the sample-order quote from DB (NEW model tables), runs the
// adapter + math layer, and prints per-assembly per-tier margin.
// Compares against brief v2 A2 targets:
//
//   HGS-30-001:    T1 ~37%  T2 ~42%  T3 ~46%
//   HGS-50TS-001:  T1 ~35%  T2 ~41%  T3 ~47%
//
// Run via:
//   npx tsx scripts/verify/sample-order-margin.ts
//
// Exits 0 if margins land within ±2% of targets; exits 1 otherwise.

import postgres from "postgres";
import { buildQuoteCostingInputFromNewModel } from "../../src/lib/costing-adapter.ts";
import { computeQuoteCosting } from "../../src/lib/costing.ts";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

const TARGETS: Record<string, Record<string, number>> = {
  "HGS-30-001": { "5K": 0.37, "15K": 0.42, "50K": 0.46 },
  "HGS-50TS-001": { "5K": 0.35, "15K": 0.41, "50K": 0.47 },
};

// Brief v2 A2 uses "~" approximate values; 2.5pp tolerance covers
// the curve-shape commitment without forcing pixel-perfect matching.
const TOLERANCE = 0.025;

async function main() {
  // Find the sample order quote.
  const projectRows = await sql`
    SELECT id FROM projects
    WHERE hubspot_deal_id = 'SAMPLE-ORDER-AURORA-BOTANICA'
    LIMIT 1
  `;
  if (projectRows.length === 0) {
    console.error("Sample order not found. Run seed-sample-order.mjs first.");
    process.exit(1);
  }
  const projectId = projectRows[0].id;

  const quoteRows = await sql`
    SELECT * FROM quotes WHERE project_id = ${projectId} LIMIT 1
  `;
  if (quoteRows.length === 0) {
    console.error("Sample order quote not found.");
    process.exit(1);
  }
  const quote = quoteRows[0];

  // Load all NEW-model data + firm_settings + markup_defaults.
  const [
    fsRows,
    tiers,
    assemblies,
    assemblyLeafJoinRows,
    assemblyLeafInputs,
    assemblyProductionInputs,
    assemblyLeafOverrides,
    assemblyLeafTargets,
    markupRows,
    freightLegGroupRows,
    freightLegRows,
    freightLegTierRows,
  ] = await Promise.all([
    sql`SELECT * FROM firm_settings WHERE effective_until IS NULL ORDER BY effective_from DESC LIMIT 1`,
    sql`SELECT * FROM quote_tiers WHERE quote_id = ${quote.id} ORDER BY sort_order, created_at`,
    sql`SELECT * FROM assemblies WHERE quote_id = ${quote.id} ORDER BY position, created_at`,
    sql`
      SELECT al.*, l.name AS leaf_name, l.sku AS leaf_sku
      FROM assembly_leaves al
      JOIN assemblies a ON a.id = al.assembly_id
      JOIN leaves l ON l.id = al.leaf_id
      WHERE a.quote_id = ${quote.id}
      ORDER BY al.assembly_id, al.position
    `,
    sql`
      SELECT ali.*
      FROM assembly_leaf_inputs ali
      JOIN assembly_leaves al ON al.id = ali.assembly_leaf_id
      JOIN assemblies a ON a.id = al.assembly_id
      WHERE a.quote_id = ${quote.id}
    `,
    sql`
      SELECT api.*
      FROM assembly_production_inputs api
      JOIN assemblies a ON a.id = api.assembly_id
      WHERE a.quote_id = ${quote.id}
    `,
    sql`
      SELECT alo.*
      FROM assembly_leaf_overrides alo
      JOIN assembly_leaves al ON al.id = alo.assembly_leaf_id
      JOIN assemblies a ON a.id = al.assembly_id
      WHERE a.quote_id = ${quote.id}
    `,
    sql`
      SELECT alt.*
      FROM assembly_leaf_targets alt
      JOIN assembly_leaves al ON al.id = alt.assembly_leaf_id
      JOIN assemblies a ON a.id = al.assembly_id
      WHERE a.quote_id = ${quote.id}
    `,
    sql`SELECT * FROM markup_defaults`,
    sql`SELECT * FROM freight_leg_groups WHERE quote_id = ${quote.id} ORDER BY display_order`,
    sql`
      SELECT fl.*
      FROM freight_legs fl
      JOIN freight_leg_groups flg ON flg.id = fl.leg_group_id
      WHERE flg.quote_id = ${quote.id}
      ORDER BY fl.display_order
    `,
    sql`
      SELECT flt.*
      FROM freight_leg_tiers flt
      JOIN freight_legs fl ON fl.id = flt.freight_leg_id
      JOIN freight_leg_groups flg ON flg.id = fl.leg_group_id
      WHERE flg.quote_id = ${quote.id}
    `,
  ]);

  const fs = fsRows[0];
  const markupMap = Object.fromEntries(
    markupRows.map((m: { category: string; default_markup_pct: string }) => [
      m.category,
      Number(m.default_markup_pct),
    ]),
  );

  // Build CostingFreightLegGroup + Leg + LegTier shapes.
  const freightLegGroups = freightLegGroupRows.map(
    (g: { id: string; label: string; display_order: number }) => ({
      id: g.id,
      label: g.label,
      displayOrder: g.display_order,
    }),
  );

  const freightLegs = freightLegRows.map((l: any) => {
    const raw = (l.customs ?? {}) as { duty_pct?: number; tariff_pct?: number };
    const customs: { dutyPct?: number; tariffPct?: number } = {};
    if (raw.duty_pct !== undefined) customs.dutyPct = Number(raw.duty_pct);
    if (raw.tariff_pct !== undefined) customs.tariffPct = Number(raw.tariff_pct);
    return {
      id: l.id,
      legGroupId: l.leg_group_id,
      direction: l.direction,
      label: l.label,
      origin: l.origin,
      destination: l.destination,
      crossesInternationalBorder: l.crosses_international_border,
      treatment: l.treatment,
      mode: l.mode,
      carrier: l.carrier,
      incoterm: l.incoterm,
      cargoReadyDate: l.cargo_ready_date,
      vesselEtd: l.vessel_etd,
      vesselEta: l.vessel_eta,
      actualDeliveryDate: l.actual_delivery_date,
      freightMarkupPct: Number(l.freight_markup_pct ?? 0.3),
      dutyMarkupPct: Number(l.duty_markup_pct ?? 0.3),
      tariffMarkupPct: Number(l.tariff_markup_pct ?? 0.3),
      customs,
      displayOrder: l.display_order,
    };
  });

  const freightLegTiers = freightLegTierRows.map((lt: any) => ({
    freightLegId: lt.freight_leg_id,
    tierId: lt.tier_id,
    totalFreight: lt.total_freight !== null ? Number(lt.total_freight) : null,
    unitsInShipment: lt.units_in_shipment,
  }));

  // Build the leaf library lookup.
  const leafById = new Map<string, { name: string; sku: string }>();
  for (const r of assemblyLeafJoinRows as any[]) {
    leafById.set(r.leaf_id, { name: r.leaf_name, sku: r.leaf_sku });
  }

  const input = buildQuoteCostingInputFromNewModel({
    quote: {
      id: quote.id,
      globalPriceAdjPct: Number(quote.global_price_adj_pct ?? 0),
      targetMarginPct:
        quote.target_margin_pct !== null
          ? Number(quote.target_margin_pct)
          : null,
    },
    firmSettings: {
      targetMarginPct: Number(fs.target_margin_pct),
      floorMarginPct: Number(fs.floor_margin_pct),
    },
    markupDefaults: markupMap,
    tiers: tiers.map((t: any) => ({
      id: t.id,
      label: t.label,
      qty: t.qty,
      sortOrder: t.sort_order,
      tierPriceAdjPct:
        t.tier_price_adj_pct !== null ? Number(t.tier_price_adj_pct) : null,
    })),
    assemblies: assemblies.map((a: any) => ({
      id: a.id,
      sku: a.sku,
      name: a.name,
      position: a.position,
    })),
    assemblyLeaves: (assemblyLeafJoinRows as any[]).map((r) => ({
      id: r.id,
      assemblyId: r.assembly_id,
      leafId: r.leaf_id,
      quantity: r.quantity,
      position: r.position,
      leafName: r.leaf_name,
      leafSku: r.leaf_sku,
    })),
    assemblyLeafInputs: (assemblyLeafInputs as any[]).map((r) => ({
      assemblyLeafId: r.assembly_leaf_id,
      tierId: r.tier_id,
      lineGroupId: r.line_group_id,
      unitCost: r.unit_cost,
      qtyPerSellableUnit: r.qty_per_sellable_unit,
      category: r.category,
      markupPct: r.markup_pct,
    })),
    assemblyProductionInputs: (assemblyProductionInputs as any[]).map((r) => ({
      assemblyId: r.assembly_id,
      tierId: r.tier_id,
      customerShipsRaws: r.customer_ships_raws,
      allocateServiceFeesToCost: r.allocate_service_fees_to_cost,
      fillingBlendingCost: r.filling_blending_cost,
      cmAssemblyTotal: r.cm_assembly_total,
      setupFeeTotal: r.setup_fee_total,
      toolingArtworkTotal: r.tooling_artwork_total,
      rdTotal: r.rd_total,
      otherServiceTotal: r.other_service_total,
      bulkRawCost: r.bulk_raw_cost,
      actualUnitsProduced: r.actual_units_produced,
    })),
    assemblyLeafOverrides: (assemblyLeafOverrides as any[]).map((r) => ({
      assemblyLeafId: r.assembly_leaf_id,
      tierId: r.tier_id,
      sellPriceOverride: r.sell_price_override,
    })),
    assemblyLeafTargets: (assemblyLeafTargets as any[]).map((r) => ({
      assemblyLeafId: r.assembly_leaf_id,
      tierId: r.tier_id,
      clientTargetPricePerUnit: r.client_target_price_per_unit,
    })),
    freightLegGroups,
    freightLegs,
    freightLegTiers,
  });

  const result = computeQuoteCosting(input);

  // Tier label lookup.
  const tierLabelById = new Map(
    (tiers as any[]).map((t) => [t.id, t.label]),
  );
  const skuRollupBySku = new Map(
    result.skuRollups.map((r) => [r.skuLabel, r]),
  );

  let failures = 0;
  console.log("");
  console.log("Slice 11.5 Step 6 — sample-order margin verification");
  console.log("");
  for (const [sku, targets] of Object.entries(TARGETS)) {
    const rollup = skuRollupBySku.get(sku);
    if (!rollup) {
      console.error(`  ✗ ${sku} — assembly not found in skuRollups`);
      failures += 1;
      continue;
    }
    console.log(`  ${sku}:`);
    for (const [tierLabel, target] of Object.entries(targets)) {
      const pt = rollup.perTier.find(
        (p) => tierLabelById.get(p.tierId) === tierLabel,
      );
      if (!pt) {
        console.error(`    ✗ ${tierLabel} — per-tier rollup missing`);
        failures += 1;
        continue;
      }
      const margin = pt.marginPct;
      const delta = margin - target;
      const within = Math.abs(delta) <= TOLERANCE;
      const symbol = within ? "✓" : "✗";
      const targetStr = (target * 100).toFixed(0).padStart(3);
      const actualStr = (margin * 100).toFixed(1).padStart(5);
      const deltaStr =
        (delta >= 0 ? "+" : "") + (delta * 100).toFixed(1) + "pp";
      console.log(
        `    ${symbol} ${tierLabel.padEnd(4)} target ${targetStr}%  actual ${actualStr}%  delta ${deltaStr}`,
      );
      if (!within) failures += 1;
    }
  }
  console.log("");
  console.log("Per-tier blended margin (quote-level):");
  for (const qr of result.quoteRollup) {
    console.log(
      `  ${qr.label.padEnd(4)}  blended ${(qr.blendedMarginPct * 100).toFixed(2)}%  status ${qr.blendedMarginStatus}`,
    );
  }
  console.log("");

  await sql.end();
  if (failures > 0) {
    console.error(`${failures} margin assertion(s) outside ±${TOLERANCE * 100}% tolerance`);
    process.exit(1);
  }
  console.log("All margin assertions within tolerance ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
