// slice-pricing-surface-redesign Step 9 re-walk — PSR fixture seed.
//
// CB Step 9 re-walk surfaced a fixture-seeding gap: without seeded
// quotes shaped to CD's prototype margin grids, smoke can't walk
// PSR-1..PSR-7/9-13. This script seeds 6 quote fixtures under a
// dedicated test project, controlling margins via per-cell
// sell_price_override (sparse upsert pattern from Slice 9.3).
//
// Run via:
//
//   node --env-file=.env.local scripts/seed-psr-fixtures.mjs
//
// Idempotent: re-running drops + re-inserts the fixtures under the
// "PSR Smoke Test" project. Existing real quotes in the system are
// untouched (project lookup keys on the synthetic hubspot_deal_id
// "PSR-SMOKE-FIXTURE").
//
// **Single Supabase project caveat (CLAUDE.md):** this writes to the
// same DB Vercel reads from. The "PSR Smoke Test" project is visible
// in production listings until manually deleted via /admin or
// /projects. Acceptable per Pattern 32 pre-prod tolerance for a
// 12-user internal tool, but Edward should not point real PMs at
// the PSR Smoke Test project for actual quote work.
//
// Math discipline: each cell's margin is controlled exactly by
// (sell_price_override, factory_cost_per_unit) per the sparse-
// override pattern. Cost stays at $10/unit across all SKUs (1
// packaging line per SKU, unit_cost=10, qty_per_sellable_unit=1).
// Sell-price overrides directly land margin:
//
//   margin = (sell_override - 10) / sell_override
//
//   sell_override = 15   →   margin = 33.3%  (above 35% target? no, slightly below — adjust as needed)
//   sell_override = 16   →   margin = 37.5%  (above target)
//   sell_override = 18   →   margin = 44.4%  (well above target)
//   sell_override = 14   →   margin = 28.6%  (below target, above floor)
//   sell_override = 13   →   margin = 23.1%  (below floor)
//   sell_override = 12   →   margin = 16.7%  (well below floor)
//
// The fixtures below use these reference points for predictable
// classifier mode emission per scenario.

import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const PROJECT_DEAL_ID = "PSR-SMOKE-FIXTURE";
const PROJECT_DEAL_NAME = "PSR Smoke Test";
const PROJECT_CLIENT_NAME = "PSR Smoke Test Client";

// Reference sell-price overrides for predictable margins (cost = $10/unit).
const SELL_ABOVE_TARGET = 18; // 44.4% margin
const SELL_NEAR_TARGET = 16; // 37.5% margin
const SELL_BELOW_TARGET = 14; // 28.6% margin
const SELL_BELOW_FLOOR = 13; // 23.1% margin
const SELL_DEEP_FLOOR = 12; // 16.7% margin
const COST_PER_UNIT = 10;

// Fixture catalog — 6 quotes covering the PSR scenarios.
const FIXTURES = [
  {
    scenarioLabel: "PSR-1 · Sendable 5-tier",
    description:
      "All cells above target. Covers PSR-1 (sendable vanilla) + PSR-2 (sendable headroom).",
    tiers: [
      { label: "T1", qty: 100 },
      { label: "T2", qty: 250 },
      { label: "T3", qty: 500 },
      { label: "T4", qty: 1000 },
      { label: "T5", qty: 2500 },
    ],
    recommendedTierLabel: "T2",
    skus: [
      { label: "S1", name: "Cotton tote · natural" },
      { label: "S2", name: "Hardcover notebook" },
      { label: "S3", name: "Bamboo pen set" },
    ],
    // sellGrid[skuIdx][tierIdx] = override price
    sellGrid: [
      [SELL_NEAR_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
      [SELL_NEAR_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
      [SELL_NEAR_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
    ],
  },
  {
    scenarioLabel: "PSR-3 · Sendable 2-tier",
    description: "Minimal viable layout. Covers PSR-3.",
    tiers: [
      { label: "T1", qty: 50 },
      { label: "T2", qty: 150 },
    ],
    recommendedTierLabel: "T1",
    skus: [
      { label: "S1", name: "Organic cotton tee · printed" },
      { label: "S2", name: "Canvas market tote" },
    ],
    sellGrid: [
      [SELL_NEAR_TARGET, SELL_ABOVE_TARGET],
      [SELL_NEAR_TARGET, SELL_ABOVE_TARGET],
    ],
  },
  {
    scenarioLabel: "PSR-4 · Suggestion-led surgical",
    description:
      "T1 below target; others above. Covers PSR-4. Basis for PSR-13 (escalation when GPA drops).",
    tiers: [
      { label: "T1", qty: 100 },
      { label: "T2", qty: 250 },
      { label: "T3", qty: 500 },
      { label: "T4", qty: 1000 },
      { label: "T5", qty: 2500 },
    ],
    recommendedTierLabel: "T3",
    skus: [
      { label: "S1", name: "Heritage leather journal" },
      { label: "S2", name: "Brass desk organizer" },
      { label: "S3", name: "Felt laptop sleeve · custom" },
    ],
    sellGrid: [
      [SELL_BELOW_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
      [SELL_BELOW_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
      [SELL_BELOW_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
    ],
  },
  {
    scenarioLabel: "PSR-5 · Suggestion-led global",
    description: "T1/T2/T3 below target → global wins ranking. Covers PSR-5.",
    tiers: [
      { label: "T1", qty: 100 },
      { label: "T2", qty: 250 },
      { label: "T3", qty: 500 },
      { label: "T4", qty: 1000 },
      { label: "T5", qty: 2500 },
    ],
    recommendedTierLabel: "T4",
    skus: [
      { label: "S1", name: "Logo-embossed leather coaster set" },
      { label: "S2", name: "Welcome amenity bottle · 200ml" },
      { label: "S3", name: "Linen napkin set · monogram" },
    ],
    sellGrid: [
      [SELL_BELOW_TARGET, SELL_BELOW_TARGET, SELL_BELOW_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET],
      [SELL_BELOW_TARGET, SELL_BELOW_TARGET, SELL_BELOW_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET],
      [SELL_BELOW_TARGET, SELL_BELOW_TARGET, SELL_BELOW_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET],
    ],
  },
  {
    scenarioLabel: "PSR-6 · Blocked single tier below floor",
    description:
      "T1 below floor; other tiers above target. Covers PSR-6 + basis for PSR-11 (recovery after Apply Surgical).",
    tiers: [
      { label: "T1", qty: 100 },
      { label: "T2", qty: 250 },
      { label: "T3", qty: 500 },
      { label: "T4", qty: 1000 },
      { label: "T5", qty: 2500 },
    ],
    recommendedTierLabel: "T3",
    skus: [
      { label: "S1", name: "Aromatherapy roller · 10ml" },
      { label: "S2", name: "Recycled glass diffuser" },
      { label: "S3", name: "Cotton bath mitt · set of 3" },
    ],
    sellGrid: [
      [SELL_DEEP_FLOOR, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
      [SELL_DEEP_FLOOR, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
      [SELL_DEEP_FLOOR, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
    ],
  },
  {
    scenarioLabel: "PSR-10 · Provisional missing raws",
    description:
      "2 cells with no cost data (raws not entered) → margin unknown. Other cells above target → mode=sendable+provisional. Covers PSR-10.",
    tiers: [
      { label: "T1", qty: 100 },
      { label: "T2", qty: 250 },
      { label: "T3", qty: 500 },
      { label: "T4", qty: 1000 },
      { label: "T5", qty: 2500 },
    ],
    recommendedTierLabel: "T2",
    skus: [
      { label: "S1", name: "Hand-blown glass carafe" },
      { label: "S2", name: "Walnut serving board" },
      { label: "S3", name: "Linen menu sleeve" },
    ],
    // null = no cost data for this (sku, tier); cell stays missing
    sellGrid: [
      [null, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
      [SELL_NEAR_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, null, SELL_ABOVE_TARGET],
      [SELL_NEAR_TARGET, SELL_NEAR_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET, SELL_ABOVE_TARGET],
    ],
  },
];

const sql = postgres(url, { max: 1 });

try {
  // 1. Find or create the test project.
  let projectId;
  const existingProject = await sql`
    SELECT id FROM projects WHERE hubspot_deal_id = ${PROJECT_DEAL_ID} LIMIT 1
  `;
  if (existingProject.length > 0) {
    projectId = existingProject[0].id;
    console.log(`[psr-seed] Reusing existing project: ${projectId}`);
  } else {
    const [proj] = await sql`
      INSERT INTO projects (hubspot_deal_id, deal_name, client_name)
      VALUES (${PROJECT_DEAL_ID}, ${PROJECT_DEAL_NAME}, ${PROJECT_CLIENT_NAME})
      RETURNING id
    `;
    projectId = proj.id;
    console.log(`[psr-seed] Created project: ${projectId}`);
  }

  // 2. Drop existing PSR fixture quotes under this project.
  // (Cascades delete tiers, SKUs, sku_tiers, packaging_inputs.)
  const dropped = await sql`
    DELETE FROM quotes WHERE project_id = ${projectId} RETURNING id
  `;
  if (dropped.length > 0) {
    console.log(`[psr-seed] Dropped ${dropped.length} existing fixture quote(s).`);
  }

  // 3. Seed each fixture.
  for (const fix of FIXTURES) {
    // 3a. Insert quote. `version_number` is NOT NULL without a
    //     default — fresh PSR fixtures start at version 1
    //     (versions are per-scenario; each fixture is its own
    //     scenario_label). Other defaults: scenario_status=active,
    //     status=draft, global_price_adj_pct='0.0000'.
    const [q] = await sql`
      INSERT INTO quotes (project_id, scenario_label, version_number)
      VALUES (${projectId}, ${fix.scenarioLabel}, 1)
      RETURNING id
    `;
    const quoteId = q.id;

    // 3b. Insert tiers (capture id, sort_order).
    const tierIds = {};
    let tierSort = 0;
    for (const t of fix.tiers) {
      const recommended = t.label === fix.recommendedTierLabel;
      const [row] = await sql`
        INSERT INTO quote_tiers (quote_id, label, qty, sort_order, recommended)
        VALUES (${quoteId}, ${t.label}, ${t.qty}, ${tierSort}, ${recommended})
        RETURNING id
      `;
      tierIds[t.label] = row.id;
      tierSort += 1;
    }

    // 3c. Insert SKUs (leaf role; hubspot_product_id nullable per
    //     Slice 5.5 since fixtures aren't HubSpot-anchored).
    const skuIds = {};
    let skuSort = 0;
    for (const s of fix.skus) {
      const [row] = await sql`
        INSERT INTO quote_skus (
          quote_id, sku_role, sku_label, product_name, sort_order
        )
        VALUES (${quoteId}, 'leaf', ${s.label}, ${s.name}, ${skuSort})
        RETURNING id
      `;
      skuIds[s.label] = row.id;
      skuSort += 1;
    }

    // 3d. Per SKU: insert one packaging_inputs line per tier with
    //     unit_cost=10, qty_per_sellable_unit=1. Schema: packaging_inputs
    //     is keyed per (quote_sku_id, tier_id, line_group_id, supplier,
    //     category). Use a single shared line_group_id per SKU.
    //     For cells where sellGrid is null (provisional fixture), skip
    //     the packaging input entirely → SKU has no cost data for that
    //     tier → margin unknown → classifier emits missing=true.
    for (let skuIdx = 0; skuIdx < fix.skus.length; skuIdx++) {
      const skuLabel = fix.skus[skuIdx].label;
      const skuId = skuIds[skuLabel];
      const lineGroupId = crypto.randomUUID();
      for (let tierIdx = 0; tierIdx < fix.tiers.length; tierIdx++) {
        const tierLabel = fix.tiers[tierIdx].label;
        const tierId = tierIds[tierLabel];
        const sellOverride = fix.sellGrid[skuIdx][tierIdx];
        if (sellOverride === null) {
          // Skip — no cost data → classifier sees missing margin.
          continue;
        }
        // Insert a single packaging line carrying the unit cost.
        await sql`
          INSERT INTO packaging_inputs (
            quote_sku_id, tier_id, line_group_id, supplier, category,
            unit_cost, qty_per_sellable_unit, markup_pct
          )
          VALUES (
            ${skuId}, ${tierId}, ${lineGroupId}, 'Fixture supplier', 'Primary',
            ${COST_PER_UNIT.toString()}, '1', '0.3000'
          )
        `;
        // Insert per-cell sell-price override (Slice 9.3 sparse table).
        // schema: quote_sku_tiers (sku_id, tier_id) PK; NOT NULL on
        // sell_price_override (row exists ⟹ override is set).
        await sql`
          INSERT INTO quote_sku_tiers (
            quote_sku_id, tier_id, sell_price_override
          )
          VALUES (${skuId}, ${tierId}, ${sellOverride.toString()})
        `;
      }
    }

    console.log(
      `[psr-seed] ✓ ${fix.scenarioLabel} — quote_id=${quoteId} (${fix.skus.length} SKUs × ${fix.tiers.length} tiers)`,
    );
  }

  console.log("");
  console.log(`[psr-seed] Done. Visit the PSR Smoke Test project to walk:`);
  console.log(`  http://localhost:3001/projects/${projectId}`);
  console.log("");
  console.log("  (Or :3000 if you restarted dev. Each fixture quote opens");
  console.log("   directly to its Pricing surface for scenario walk-through.)");
} catch (err) {
  console.error("[psr-seed] FAIL:", err);
  process.exit(1);
} finally {
  await sql.end();
}
