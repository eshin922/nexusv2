// Sample Order Seed (NEW model, post-Slice 11.5).
//
// **What this seeds:** a canonical, demo-quality order showing the
// post-Phase-A.1-v2 ASY/LEAF model end-to-end. Project + quote +
// 3 tiers + 2 assemblies + assembly_leaves junctions + library leaves
// + quote_leaves pins + multi-leg freight journey + assembly_leaf_inputs
// (per-tier packaging cost variation) + assembly_production_inputs
// (per-tier production lumps) + audit log entry.
//
// **Slice 11.5 Step 6 update (2026-06-18):** added NEW cost-data
// table population (`assembly_leaf_inputs` + `assembly_production_inputs`)
// so Costs / Pricing / Quote surfaces render with computed margins,
// not empty cells. Per-tier unit_cost variation models realistic
// supplier discounts at volume (T1 small qty premium → T3 large qty
// discount); production lump amortization gives volume-driven cost
// curve. Target margin curve per brief v2 A2:
//
//   | SKU         | T1 (5K) | T2 (15K, recommended) | T3 (50K) |
//   |-------------|---------|-----------------------|----------|
//   | HGS-30-001  | ~37%    | ~42%                  | ~46%     |
//   | HGS-50TS-001| ~35%    | ~41%                  | ~47%     |
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
//
// `unit_cost` on library leaves is the catalog T2 (recommended) price;
// per-tier supplier discount curve lives on `assembly_leaf_inputs`
// (per-(leaf, tier) cost rows). Library cost is used as a fallback /
// default when a per-quote override isn't set; for the sample order,
// every assembly_leaf_inputs row gets explicit per-tier values.
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
];

// Per-(component, tier) unit cost curve. Realistic supplier discount
// shape: small qty = premium, large qty = discount. Used by the seed
// to populate `assembly_leaf_inputs` for each (assembly_leaf, tier)
// cell. Categories drive markup_pct via markup_defaults — Primary
// 0.45, Secondary 0.50, Soft Goods 0.35 (firm defaults).
//
// Markups carry per-row from category_default at seed time (matches
// Setup-add-line default behavior). PMs may override on the Costs
// surface; the seed sets `markup_pct_source = 'category_default'` so
// the revert affordance behaves correctly post-seed.
const LEAF_INPUT_CURVE = {
  "LIB-PP-BOTTLE-30ML": { category: "Primary",   T1: "0.54", T2: "0.45", T3: "0.36" },
  "LIB-PP-DROPPER-30ML":{ category: "Primary",   T1: "0.15", T2: "0.12", T3: "0.10" },
  "LIB-SP-LABEL-30ML":  { category: "Secondary", T1: "0.10", T2: "0.08", T3: "0.06" },
  "LIB-SP-CARTON-30ML": { category: "Secondary", T1: "0.31", T2: "0.25", T3: "0.20" },

  "LIB-PP-BOTTLE-50ML": { category: "Primary",   T1: "0.78", T2: "0.65", T3: "0.52" },
  "LIB-PP-DROPPER-50ML":{ category: "Primary",   T1: "0.18", T2: "0.15", T3: "0.12" },
  "LIB-SP-LABEL-50ML":  { category: "Secondary", T1: "0.12", T2: "0.10", T3: "0.08" },
  "LIB-SP-CARTON-50ML": { category: "Secondary", T1: "0.42", T2: "0.35", T3: "0.28" },

  "LIB-SG-POUCH-TRAVEL":{ category: "Soft Goods",T1: "2.10", T2: "1.80", T3: "1.50" },
};

// Per-tier production lump amounts. Filling+blending operations
// (formula + per-unit filling+QC) per tier. Lump is `tier qty × per-
// unit operation cost`; math layer amortizes lump / tier.qty back
// to per-unit at compute time. Per-unit costs curve:
//   T1 (5K):   filling $2.00, cm_assembly $0.10 → lump $10K each
//   T2 (15K):  filling $1.70, cm_assembly $0.08 → lump $25.5K + $1.2K
//   T3 (50K):  filling $1.40, cm_assembly $0.06 → lump $70K + $3K
const PRODUCTION_CURVE = {
  T1: { qty: 5000,  fillingBlendingPerUnit: "2.00", cmAssemblyPerUnit: "0.10" },
  T2: { qty: 15000, fillingBlendingPerUnit: "1.70", cmAssemblyPerUnit: "0.08" },
  T3: { qty: 50000, fillingBlendingPerUnit: "1.40", cmAssemblyPerUnit: "0.06" },
};

// Assembly catalog. Per Slice 11.5 Step 6, the math layer computes
// sell from `assembly_leaf_inputs` (per-tier line costs × markups) +
// `assembly_production_inputs` (per-tier lumps) + freight; the
// `unit_cost` / `unit_price` / `markup_pct` columns on `assemblies`
// are deprecated post-#A15 (math layer ignores them) but kept here
// as PM-facing scan/summary values that match the T2 (recommended)
// per-tier rollup.
//
// Components are physical packaging only (bottle/dropper/label/carton/
// pouch). Formula + filling are NOT separate library leaves; their
// cost lives on `assembly_production_inputs` (per-tier lumps) per the
// math model's production fee bucket. Compare with OLD seed which
// had them as additional leaves.
const ASSEMBLIES = [
  {
    sku: "HGS-30-001",
    name: "Hydra-Glow Serum · 30ml",
    description: "Single bottle SKU — bottle, dropper, label, carton.",
    productTypeId: "asy_skincare",
    unitCost: "2.60",   // legacy / PM-scan; T2 rollup approximation
    unitPrice: "5.20",  // legacy / PM-scan; ~42% margin at T2
    markupPct: "1.00",  // legacy / PM-scan; (5.20 - 2.60) / 2.60
    components: [
      { sku: "LIB-PP-BOTTLE-30ML", quantity: "1" },
      { sku: "LIB-PP-DROPPER-30ML", quantity: "1" },
      { sku: "LIB-SP-LABEL-30ML", quantity: "1" },
      { sku: "LIB-SP-CARTON-30ML", quantity: "1" },
    ],
  },
  {
    sku: "HGS-50TS-001",
    name: "Hydra-Glow Serum · 50ml Travel Set",
    description: "50ml bottle + travel pouch — Item Group bundle.",
    productTypeId: "asy_skincare",
    unitCost: "3.25",
    unitPrice: "6.50",  // legacy / PM-scan; ~41% margin at T2
    markupPct: "1.00",
    components: [
      { sku: "LIB-PP-BOTTLE-50ML", quantity: "1" },
      { sku: "LIB-PP-DROPPER-50ML", quantity: "1" },
      { sku: "LIB-SP-LABEL-50ML", quantity: "1" },
      { sku: "LIB-SP-CARTON-50ML", quantity: "1" },
      { sku: "LIB-SG-POUCH-TRAVEL", quantity: "1" },
    ],
  },
];

// Tier catalog. T2 (15K) is recommended.
//
// Per-tier-price adjustment values land target margin curve per
// brief v2 A2. Cost variation (assembly_leaf_inputs + production
// curve) accounts for most of the margin shape; tier_price_adj_pct
// fine-tunes each tier to land in target band. Iterated values
// determined by Step 6 verify script — see step-6 verification doc
// for the per-tier math.
const TIERS = [
  { label: "5K", qty: 5000, sortOrder: 0, recommended: false, tierPriceAdjPct: "0.1800" },
  { label: "15K", qty: 15000, sortOrder: 1, recommended: true, tierPriceAdjPct: "0.2800" },
  { label: "50K", qty: 50000, sortOrder: 2, recommended: false, tierPriceAdjPct: "0.3700" },
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

  // ---- Markup defaults lookup (for per-line category_default
  //      markup_pct on assembly_leaf_inputs rows) ----
  const markupRows = await sql`
    SELECT category, default_markup_pct FROM markup_defaults
  `;
  const markupDefaultByCategory = Object.fromEntries(
    markupRows.map((r) => [r.category, r.default_markup_pct]),
  );

  // ---- Assemblies + assembly_leaves + quote_leaves ----
  //
  // Slice 11.5 Step 6 — capture assembly_leaf.id per component for
  // downstream assembly_leaf_inputs population. Each assembly_leaves
  // row gets one assembly_leaf_inputs row per tier (sparse table:
  // missing row = no packaging cost; we want explicit per-(leaf,
  // tier) cost curve for the margin demonstration).
  const assemblyMeta = [];
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

    const componentLeafIds = [];
    let componentPosition = 0;
    for (const comp of asy.components) {
      const leafId = leafIdsBySku[comp.sku];
      if (!leafId) throw new Error(`Missing leaf for SKU ${comp.sku}`);
      const [alRow] = await sql`
        INSERT INTO assembly_leaves (assembly_id, leaf_id, quantity, position)
        VALUES (${assemblyId}, ${leafId}, ${comp.quantity}, ${componentPosition})
        RETURNING id
      `;
      componentLeafIds.push({
        assemblyLeafId: alRow.id,
        librarySku: comp.sku,
        position: componentPosition,
      });
      // quote_leaves pin — links the leaf to the quote (no spec
      // version pinned; v1 ships unpinned by default per leaf_specs
      // header comment in schema.ts).
      await sql`
        INSERT INTO quote_leaves (quote_id, assembly_id, leaf_id, quantity, position)
        VALUES (${quoteId}, ${assemblyId}, ${leafId}, ${comp.quantity}, ${componentPosition})
      `;
      componentPosition += 1;
    }
    assemblyMeta.push({ assemblyId, sku: asy.sku, componentLeafIds });
  }
  console.log(`[seed-sample-order] ✓ ${ASSEMBLIES.length} assemblies with components`);

  // ---- assembly_leaf_inputs (Slice 11.5 Step 6) ----
  //
  // One row per (assembly_leaf, tier). line_group_id is fresh per
  // (assembly_leaf, line) to satisfy the unique index pattern from
  // CLAUDE.md "line_group_id semantics" — synthetic UUID grouping
  // rows that represent the same logical packaging line across
  // tiers. Each assembly_leaf has one logical packaging line in
  // the sample seed, so one line_group_id per leaf × N tier rows.
  //
  // Per-tier unit_cost from LEAF_INPUT_CURVE; markup_pct from
  // markup_defaults[category]; markup_pct_source='category_default'
  // (matches Setup-add-line default behavior).
  let leafInputRowCount = 0;
  for (const asy of assemblyMeta) {
    for (const comp of asy.componentLeafIds) {
      const curve = LEAF_INPUT_CURVE[comp.librarySku];
      if (!curve) {
        throw new Error(
          `Missing LEAF_INPUT_CURVE entry for ${comp.librarySku}`,
        );
      }
      const markup = markupDefaultByCategory[curve.category];
      if (!markup) {
        throw new Error(
          `Missing markup_default for category ${curve.category}`,
        );
      }
      const lineGroupId = randomUUID();
      // sort_order is line-level; same value across tier rows of
      // the same line_group. Sample seed has one logical line per
      // leaf; sort_order=0 across all rows is fine (siblings under
      // different leaves have independent line_group_id).
      const sortOrder = 0;
      for (const tier of TIERS) {
        const tierKey =
          tier.label === "5K" ? "T1"
          : tier.label === "15K" ? "T2"
          : tier.label === "50K" ? "T3"
          : null;
        if (!tierKey) throw new Error(`Unknown tier label ${tier.label}`);
        const tierUnitCost = curve[tierKey];
        await sql`
          INSERT INTO assembly_leaf_inputs (
            assembly_leaf_id, tier_id, line_group_id, sort_order,
            supplier, qty_per_sellable_unit, category, markup_pct,
            markup_pct_source, inventory_eligible, unit_cost
          )
          VALUES (
            ${comp.assemblyLeafId}, ${tierIdsByLabel[tier.label]},
            ${lineGroupId}, ${sortOrder},
            ${"Aurora Botanica supplier · " + comp.librarySku},
            ${"1"}, ${curve.category}, ${markup},
            ${"category_default"}, ${false}, ${tierUnitCost}
          )
        `;
        leafInputRowCount += 1;
      }
    }
  }
  console.log(
    `[seed-sample-order] ✓ ${leafInputRowCount} assembly_leaf_inputs rows (${ASSEMBLIES.reduce((n, a) => n + a.components.length, 0)} components × ${TIERS.length} tiers)`,
  );

  // ---- assembly_production_inputs (Slice 11.5 Step 6) ----
  //
  // One row per (assembly, tier). Per-tier production lumps drawn
  // from PRODUCTION_CURVE: filling+blending + cm_assembly are the
  // two lump categories captured (no setup_fee / tooling / rd /
  // other / bulk_raw in the sample seed). allocateServiceFeesToCost
  // defaults true per schema; bulk_raw_cost null (sample seed uses
  // cm_sources raws mode).
  let productionRowCount = 0;
  for (const asy of assemblyMeta) {
    for (const tier of TIERS) {
      const tierKey =
        tier.label === "5K" ? "T1"
        : tier.label === "15K" ? "T2"
        : tier.label === "50K" ? "T3"
        : null;
      const curve = PRODUCTION_CURVE[tierKey];
      const fillingLump = (
        Number(curve.fillingBlendingPerUnit) * curve.qty
      ).toFixed(2);
      const cmLump = (Number(curve.cmAssemblyPerUnit) * curve.qty).toFixed(2);
      await sql`
        INSERT INTO assembly_production_inputs (
          assembly_id, tier_id,
          customer_ships_raws, allocate_service_fees_to_cost,
          filling_blending_cost, cm_assembly_total
        )
        VALUES (
          ${asy.assemblyId}, ${tierIdsByLabel[tier.label]},
          ${false}, ${true},
          ${fillingLump}, ${cmLump}
        )
      `;
      productionRowCount += 1;
    }
  }
  console.log(
    `[seed-sample-order] ✓ ${productionRowCount} assembly_production_inputs rows (${ASSEMBLIES.length} assemblies × ${TIERS.length} tiers)`,
  );

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
        seed_version: "2-slice-11-5",
        seed_date: new Date().toISOString().slice(0, 10),
        leaves_seeded: LIBRARY_LEAVES.length,
        assemblies_seeded: ASSEMBLIES.length,
        leaf_input_rows_seeded: leafInputRowCount,
        production_input_rows_seeded: productionRowCount,
        tiers: TIERS.map((t) => ({ label: t.label, qty: t.qty })),
        notes:
          "Slice 11.5 Step 6 — NEW model end-to-end. Margin curve via per-tier cost variation + tier_price_adj_pct.",
      })}
    )
  `;

  // ---- Output ----
  const baseUrl = "https://nexusv2-nu.vercel.app";
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
  console.log("  Margin curve target (per brief v2 A2):");
  console.log("    HGS-30-001:   T1 ~37%  T2 ~42%  T3 ~46%");
  console.log("    HGS-50TS-001: T1 ~35%  T2 ~41%  T3 ~47%");
  console.log("");
  console.log("  Navigate:");
  console.log(`    Setup:    ${baseUrl}/projects/${projectId}/quotes/${quoteId}`);
  console.log(`    Costs:    ${baseUrl}/projects/${projectId}/quotes/${quoteId}/costs`);
  console.log(`    Pricing:  ${baseUrl}/projects/${projectId}/quotes/${quoteId}/pricing`);
  console.log(`    Quote:    ${baseUrl}/projects/${projectId}/quotes/${quoteId}/quote`);
  console.log("");
  console.log(
    "  ✓ Costs/Pricing/Quote should now render with computed margins.",
  );
} catch (err) {
  console.error("[seed-sample-order] FAILED:", err);
  process.exit(1);
} finally {
  await sql.end();
}
