// Sample Order Seed (Path C — NEW model only).
//
// **What this seeds:** a canonical, demo-quality order showing the
// post-Phase-A.1-v2 ASY/LEAF model end-to-end. Project + quote +
// 3 tiers + 2 assemblies + assembly_leaves junctions + library leaves
// + quote_leaves pins + multi-leg freight journey + audit log entry.
//
// **What it does NOT seed:** the legacy quote_skus / packaging_inputs /
// production_inputs / quote_sku_tiers chain. Per 2026-06-17 Edward + CA
// disposition (Path C). The legacy chain is deprecated post-Phase
// A.1 v2; Costs / Pricing / Quote surfaces still READ from it, but
// that's an architectural drift slated for Slice 11.5 read-path
// migration. Sample order renders properly on Setup today; renders
// empty on Costs/Pricing/Quote until Slice 11.5 lands.
//
// **When to run:** one-time on production (or a fresh DB) as the
// canonical demo + training + SV-1 anchor.
//
// **Run via:**
//   node --env-file=.env.local scripts/seed-sample-order.mjs
//   node --env-file=.env.local scripts/seed-sample-order.mjs --force
//
// **Idempotency:** lookup by project hubspot_deal_id =
// 'SAMPLE-ORDER-AURORA-BOTANICA' (sentinel; no real HubSpot deal).
// Re-runs detect existing project + exit; --force drops + reseeds.
//
// **CLAUDE.md "Single Supabase project — dev and prod share one DB":**
// the seed lands on whichever DB DIRECT_URL points at. For prod
// seeding, run against prod env; for dev seeding, run against dev
// env. Same script, same DB; the seed is meant to be visible to
// production PMs (it's the demo order).
//
// **NEW-model field availability gap (banked inline):** assemblies
// hold flat per-assembly cost; no per-tier-per-leaf cost variation
// exists in NEW model. Sample seeds flat ~40% margin on T2
// (recommended tier) + small tier_price_adj_pct variations to
// demonstrate the adjustment mechanism. Edward's brief-specified
// realistic margin curve (T1 ~37%, T2 ~40%, T3 ~47%) returns once
// per-tier-cost variation surfaces in NEW model OR Slice 11.5
// bridges the legacy per-tier-per-leaf cost data into the new
// rollup paths.

import postgres from "postgres";
import { randomUUID } from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set in .env.local");
  process.exit(1);
}

const force = process.argv.includes("--force");
const PROJECT_DEAL_ID = "SAMPLE-ORDER-AURORA-BOTANICA";
const PROJECT_DEAL_NAME = "SAMPLE — Aurora Botanica · Hydra-Glow Serum";
const PROJECT_CLIENT_NAME = "SAMPLE — Aurora Botanica";

const SAMPLE_USER_EMAIL = "edward.shin@gmail.com";

// Library leaf catalog. Realistic costs for the Hydra-Glow Serum
// assemblies. SKUs prefixed `LIB-` to differentiate from per-quote
// assembly SKUs.
const LIBRARY_LEAVES = [
  // 30ml SKU components
  { sku: "LIB-PP-BOTTLE-30ML", name: "Glass bottle · 30ml · amber", productTypeId: "leaf_primary_packaging", unitCost: "0.45" },
  { sku: "LIB-PP-DROPPER-30ML", name: "Glass dropper · 30ml", productTypeId: "leaf_primary_packaging", unitCost: "0.12" },
  { sku: "LIB-SP-LABEL-30ML", name: "Wraparound label · 30ml", productTypeId: "leaf_secondary_packaging", unitCost: "0.08" },
  { sku: "LIB-SP-CARTON-30ML", name: "Folding carton · 30ml", productTypeId: "leaf_secondary_packaging", unitCost: "0.25" },
  // 50ml SKU components
  { sku: "LIB-PP-BOTTLE-50ML", name: "Glass bottle · 50ml · amber", productTypeId: "leaf_primary_packaging", unitCost: "0.65" },
  { sku: "LIB-PP-DROPPER-50ML", name: "Glass dropper · 50ml", productTypeId: "leaf_primary_packaging", unitCost: "0.15" },
  { sku: "LIB-SP-LABEL-50ML", name: "Wraparound label · 50ml", productTypeId: "leaf_secondary_packaging", unitCost: "0.10" },
  { sku: "LIB-SP-CARTON-50ML", name: "Folding carton · 50ml", productTypeId: "leaf_secondary_packaging", unitCost: "0.35" },
  // Travel Set unique component
  { sku: "LIB-SG-POUCH-TRAVEL", name: "Cotton travel pouch · drawstring", productTypeId: "leaf_soft_goods", unitCost: "1.80" },
  // Shared service leaves
  { sku: "LIB-SVC-FORMULA-HGS", name: "Hydra-Glow formula · per unit", productTypeId: "leaf_service", unitCost: "1.20" },
  { sku: "LIB-SVC-FILLING", name: "Filling + closure + QC", productTypeId: "leaf_service", unitCost: "0.50" },
];

// Assembly catalog. unit_price targets ~40% margin against summed
// component costs on the recommended tier.
//
//   HGS-30-001 cost  = bottle 0.45 + dropper 0.12 + label 0.08 +
//                      carton 0.25 + formula 1.20 + filling 0.50
//                    = $2.60
//   HGS-30-001 price = $4.50 → margin = 1 - 2.60/4.50 = 42.2%
//
//   HGS-50TS-001 cost = bottle 0.65 + dropper 0.15 + label 0.10 +
//                       carton 0.35 + pouch 1.80 + formula 1.20 +
//                       filling 0.50
//                     = $4.75
//   HGS-50TS-001 price = $8.00 → margin = 1 - 4.75/8.00 = 40.6%
const ASSEMBLIES = [
  {
    sku: "HGS-30-001",
    name: "Hydra-Glow Serum · 30ml",
    description: "Single bottle SKU — bottle, dropper, label, carton.",
    productTypeId: "asy_skincare",
    unitCost: "2.60",
    unitPrice: "4.50",
    markupPct: "0.7308", // (4.50 - 2.60) / 2.60
    components: [
      { sku: "LIB-PP-BOTTLE-30ML", quantity: "1" },
      { sku: "LIB-PP-DROPPER-30ML", quantity: "1" },
      { sku: "LIB-SP-LABEL-30ML", quantity: "1" },
      { sku: "LIB-SP-CARTON-30ML", quantity: "1" },
      { sku: "LIB-SVC-FORMULA-HGS", quantity: "1" },
      { sku: "LIB-SVC-FILLING", quantity: "1" },
    ],
  },
  {
    sku: "HGS-50TS-001",
    name: "Hydra-Glow Serum · 50ml Travel Set",
    description: "50ml bottle + travel pouch — Item Group bundle.",
    productTypeId: "asy_skincare",
    unitCost: "4.75",
    unitPrice: "8.00",
    markupPct: "0.6842", // (8.00 - 4.75) / 4.75
    components: [
      { sku: "LIB-PP-BOTTLE-50ML", quantity: "1" },
      { sku: "LIB-PP-DROPPER-50ML", quantity: "1" },
      { sku: "LIB-SP-LABEL-50ML", quantity: "1" },
      { sku: "LIB-SP-CARTON-50ML", quantity: "1" },
      { sku: "LIB-SG-POUCH-TRAVEL", quantity: "1" },
      { sku: "LIB-SVC-FORMULA-HGS", quantity: "1" },
      { sku: "LIB-SVC-FILLING", quantity: "1" },
    ],
  },
];

// Tier catalog. T2 (15K) is recommended. tier_price_adj_pct:
// - T1 small qty premium: +5% sell price (volume curve)
// - T3 large qty discount: -8% sell price
// Demonstrates the per-tier adjustment mechanism even though
// economies-of-scale margin variation isn't representable in NEW
// model (see header gap note).
const TIERS = [
  { label: "5K", qty: 5000, sortOrder: 0, recommended: false, tierPriceAdjPct: "0.0500" },
  { label: "15K", qty: 15000, sortOrder: 1, recommended: true, tierPriceAdjPct: null },
  { label: "50K", qty: 50000, sortOrder: 2, recommended: false, tierPriceAdjPct: "-0.0800" },
];

// Multi-leg freight journey: Shenzhen, CN → Long Beach, CA →
// Newark, NJ. 3 legs (ocean FCL + drayage + LTL truck).
//
// Per-tier total_freight costs reflect realistic scaling — ocean
// container cost flat across tier (one container fits all three
// run sizes), drayage + LTL scale with shipment volume.
const FREIGHT_LEG_GROUP_LABEL = "Outbound · CN → US distribution";
const FREIGHT_LEGS = [
  {
    label: "Ocean FCL · Shenzhen → Long Beach",
    direction: "outbound",
    origin: "Shenzhen, CN",
    destination: "Long Beach, CA",
    crossesInternationalBorder: true,
    treatment: "pass_through",
    mode: "ocean_fcl",
    carrier: "MAERSK",
    incoterm: "FOB",
    customs: { duty_pct: 0.06, tariff_pct: 0.025 },
    displayOrder: 0,
    // total_freight per tier — flat (one container)
    tierCosts: { "5K": "1500.00", "15K": "1500.00", "50K": "1500.00" },
  },
  {
    label: "Drayage · Long Beach port → CA DC",
    direction: "outbound",
    origin: "Long Beach, CA",
    destination: "Carson, CA",
    crossesInternationalBorder: false,
    treatment: "pass_through",
    mode: "drayage",
    carrier: "DPS Logistics",
    incoterm: "DDP",
    customs: {},
    displayOrder: 1,
    // scales modestly with volume
    tierCosts: { "5K": "350.00", "15K": "500.00", "50K": "800.00" },
  },
  {
    label: "LTL · CA DC → Newark, NJ",
    direction: "outbound",
    origin: "Carson, CA",
    destination: "Newark, NJ",
    crossesInternationalBorder: false,
    treatment: "pass_through",
    mode: "ltl_truck",
    carrier: "FedEx Freight",
    incoterm: "DDP",
    customs: {},
    displayOrder: 2,
    tierCosts: { "5K": "350.00", "15K": "700.00", "50K": "1400.00" },
  },
];

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  // ---- User lookup ----
  const userRows = await sql`
    SELECT id, email FROM users WHERE email = ${SAMPLE_USER_EMAIL} LIMIT 1
  `;
  if (userRows.length === 0) {
    console.error(
      `[seed-sample-order] No user found with email ${SAMPLE_USER_EMAIL}.`,
    );
    console.error("Edward must sign in at least once to provision the users row.");
    process.exit(1);
  }
  const ownerId = userRows[0].id;
  console.log(`[seed-sample-order] Owner: ${SAMPLE_USER_EMAIL} (${ownerId.slice(0, 8)})`);

  // ---- Idempotency check / force-reseed ----
  const existing = await sql`
    SELECT id FROM projects WHERE hubspot_deal_id = ${PROJECT_DEAL_ID} LIMIT 1
  `;
  if (existing.length > 0) {
    if (!force) {
      const navProjectId = existing[0].id;
      const navQuoteRow = await sql`
        SELECT id FROM quotes WHERE project_id = ${navProjectId} LIMIT 1
      `;
      console.log(
        `[seed-sample-order] Sample order already exists. Pass --force to drop + re-seed.`,
      );
      console.log(`  Project ID: ${navProjectId}`);
      if (navQuoteRow.length > 0) {
        console.log(`  Quote ID:   ${navQuoteRow[0].id}`);
      }
      process.exit(0);
    }
    console.log("[seed-sample-order] --force: dropping existing sample project + cascades.");
    await sql`DELETE FROM projects WHERE id = ${existing[0].id}`;
    // Library leaves are global — drop only the ones we seeded by SKU prefix.
    await sql`DELETE FROM leaves WHERE sku LIKE 'LIB-%'`;
  }

  // ---- Library leaves ----
  const leafIdsBySku = {};
  for (const leaf of LIBRARY_LEAVES) {
    const [row] = await sql`
      INSERT INTO leaves (name, sku, product_type_id, unit_cost, owner_id)
      VALUES (${leaf.name}, ${leaf.sku}, ${leaf.productTypeId}, ${leaf.unitCost}, ${ownerId})
      RETURNING id
    `;
    leafIdsBySku[leaf.sku] = row.id;
  }
  console.log(`[seed-sample-order] ✓ ${LIBRARY_LEAVES.length} library leaves`);

  // ---- Project ----
  const [project] = await sql`
    INSERT INTO projects (
      hubspot_deal_id, deal_name, client_name, sales_rep_user_id,
      project_category, status
    )
    VALUES (
      ${PROJECT_DEAL_ID}, ${PROJECT_DEAL_NAME}, ${PROJECT_CLIENT_NAME}, ${ownerId},
      'packaging', 'active'
    )
    RETURNING id
  `;
  const projectId = project.id;

  // ---- Quote ----
  const [quote] = await sql`
    INSERT INTO quotes (
      project_id, scenario_label, version_number, status,
      target_margin_pct, created_by_user_id
    )
    VALUES (
      ${projectId}, '5K / 15K / 50K — China sources', 1, 'draft',
      '0.3500', ${ownerId}
    )
    RETURNING id
  `;
  const quoteId = quote.id;

  // ---- Tiers ----
  const tierIdsByLabel = {};
  for (const t of TIERS) {
    const [row] = await sql`
      INSERT INTO quote_tiers (quote_id, label, qty, sort_order, recommended, tier_price_adj_pct)
      VALUES (${quoteId}, ${t.label}, ${t.qty}, ${t.sortOrder}, ${t.recommended}, ${t.tierPriceAdjPct})
      RETURNING id
    `;
    tierIdsByLabel[t.label] = row.id;
  }
  console.log(`[seed-sample-order] ✓ ${TIERS.length} tiers`);

  // ---- Assemblies + assembly_leaves + quote_leaves ----
  let position = 0;
  for (const asy of ASSEMBLIES) {
    const [asyRow] = await sql`
      INSERT INTO assemblies (
        quote_id, sku, name, description, product_type_id,
        unit_cost, unit_price, markup_pct, owner_id, position
      )
      VALUES (
        ${quoteId}, ${asy.sku}, ${asy.name}, ${asy.description}, ${asy.productTypeId},
        ${asy.unitCost}, ${asy.unitPrice}, ${asy.markupPct}, ${ownerId}, ${position}
      )
      RETURNING id
    `;
    const assemblyId = asyRow.id;
    position += 1;

    let componentPosition = 0;
    for (const comp of asy.components) {
      const leafId = leafIdsBySku[comp.sku];
      if (!leafId) throw new Error(`Missing leaf for SKU ${comp.sku}`);
      await sql`
        INSERT INTO assembly_leaves (assembly_id, leaf_id, quantity, position)
        VALUES (${assemblyId}, ${leafId}, ${comp.quantity}, ${componentPosition})
      `;
      // quote_leaves pin — links the leaf to the quote (no spec
      // version pinned; v1 ships unpinned by default per leaf_specs
      // header comment in schema.ts).
      await sql`
        INSERT INTO quote_leaves (quote_id, assembly_id, leaf_id, quantity, position)
        VALUES (${quoteId}, ${assemblyId}, ${leafId}, ${comp.quantity}, ${componentPosition})
      `;
      componentPosition += 1;
    }
  }
  console.log(`[seed-sample-order] ✓ ${ASSEMBLIES.length} assemblies with components`);

  // ---- Freight ----
  const [legGroup] = await sql`
    INSERT INTO freight_leg_groups (quote_id, label, display_order)
    VALUES (${quoteId}, ${FREIGHT_LEG_GROUP_LABEL}, 0)
    RETURNING id
  `;
  const legGroupId = legGroup.id;

  for (const leg of FREIGHT_LEGS) {
    const [legRow] = await sql`
      INSERT INTO freight_legs (
        leg_group_id, direction, label, origin, destination,
        crosses_international_border, treatment, mode, carrier, incoterm,
        customs, display_order
      )
      VALUES (
        ${legGroupId}, ${leg.direction}, ${leg.label}, ${leg.origin}, ${leg.destination},
        ${leg.crossesInternationalBorder}, ${leg.treatment}, ${leg.mode}, ${leg.carrier}, ${leg.incoterm},
        ${sql.json(leg.customs)}, ${leg.displayOrder}
      )
      RETURNING id
    `;
    const legId = legRow.id;
    for (const [tierLabel, totalFreight] of Object.entries(leg.tierCosts)) {
      const tierId = tierIdsByLabel[tierLabel];
      if (!tierId) throw new Error(`Missing tier for label ${tierLabel}`);
      await sql`
        INSERT INTO freight_leg_tiers (freight_leg_id, tier_id, total_freight)
        VALUES (${legId}, ${tierId}, ${totalFreight})
      `;
    }
  }
  console.log(
    `[seed-sample-order] ✓ 1 freight leg group with ${FREIGHT_LEGS.length} legs × ${TIERS.length} tiers`,
  );

  // ---- Audit log ----
  await sql`
    INSERT INTO audit_log (user_id, entity_type, entity_id, action, diff_json)
    VALUES (
      ${ownerId}, 'project', ${projectId}, 'sample_order_seeded',
      ${sql.json({
        project_id: projectId,
        quote_id: quoteId,
        seed_version: "1",
        seed_date: new Date().toISOString().slice(0, 10),
        leaves_seeded: LIBRARY_LEAVES.length,
        assemblies_seeded: ASSEMBLIES.length,
        tiers: TIERS.map((t) => ({ label: t.label, qty: t.qty })),
        notes: "Path C — NEW model only. See Slice 11.5 for read-path migration.",
      })}
    )
  `;

  // ---- Output ----
  const baseUrl = "https://nexusv2-nu.vercel.app";
  const recommendedTier = TIERS.find((t) => t.recommended);
  console.log("");
  console.log("✓ Sample order seeded.");
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Quote ID:   ${quoteId}`);
  console.log(`  Customer:   ${PROJECT_CLIENT_NAME}`);
  console.log(
    `  Tiers:      ${TIERS.map((t) => `${t.label}${t.recommended ? " (recommended)" : ""}`).join(" / ")}`,
  );
  console.log(
    `  SKUs:       ${ASSEMBLIES.map((a) => `${a.sku} (${a.name})`).join(" + ")}`,
  );
  console.log(
    `  Base margin (T2 recommended, no adj): ~${ASSEMBLIES.map((a) =>
      ((1 - Number(a.unitCost) / Number(a.unitPrice)) * 100).toFixed(1) + "%",
    ).join(" / ")}`,
  );
  console.log("");
  console.log("  Navigate:");
  console.log(`    Setup:    ${baseUrl}/projects/${projectId}/quotes/${quoteId}`);
  console.log(`    Costs:    ${baseUrl}/projects/${projectId}/quotes/${quoteId}/costs`);
  console.log(`    Pricing:  ${baseUrl}/projects/${projectId}/quotes/${quoteId}/pricing`);
  console.log(`    Quote:    ${baseUrl}/projects/${projectId}/quotes/${quoteId}/quote`);
  console.log("");
  console.log(
    "  ⚠ Costs/Pricing/Quote render empty until Slice 11.5 read-path migration lands.",
  );
  console.log(
    "    Setup surface renders properly (NEW model has Setup wiring).",
  );
} catch (err) {
  console.error("[seed-sample-order] FAILED:", err);
  process.exit(1);
} finally {
  await sql.end();
}
