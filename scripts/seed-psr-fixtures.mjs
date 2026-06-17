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
// Math discipline (patch round 3 — switched from sell_price_override
// to per-cell `packaging_inputs.markup_pct`):
//
//   sell  = cost × (1 + markup_pct) × (1 + global_adj) × (1 + tier_adj)
//   margin = (sell - cost) / sell = markup / (1 + markup) when adjs=0
//
//   markup = 0.85   →   margin ≈ 46.0%   (above target — PSR-1/-2)
//   markup = 0.60   →   margin ≈ 37.5%   (above 35% target — PSR-1 mix)
//   markup = 0.40   →   margin ≈ 28.6%   (below 35% target — PSR-4)
//   markup = 0.30   →   margin ≈ 23.1%   (below floor 25% — PSR-6 / PSR-5)
//   markup = 0.20   →   margin ≈ 16.7%   (well below floor — PSR-6 deep)
//
// Why this approach (CB Patch round 3 BUG-A diagnostic):
// sell_price_override is TERMINAL — when set, math layer bypasses
// the markup chain entirely (`requiredSell = cellOverride`). That
// makes Apply Surgical a no-op on overridden cells because surgical
// writes `tier_price_adj_pct`, which influences the markup-chain
// `computedSell`, not the override path. Pre-empts BUG-A Case C.
//
// **Per-quote target override.** Each fixture sets
// `quotes.target_margin_pct = '0.3500'` (Slice 9.2 column) so the
// 35% target reference is independent of firm-policy drift
// (production firm_settings observed at target=0.40 during BUG-E
// investigation). Fixtures own their target; smoke walks against
// 35% regardless of admin settings.

import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const PROJECT_DEAL_ID = "PSR-SMOKE-FIXTURE";
const PROJECT_DEAL_NAME = "PSR Smoke Test";
const PROJECT_CLIENT_NAME = "PSR Smoke Test Client";

// Reference markup_pct values for predictable margins (cost=$10/unit;
// no adjustments). margin = markup / (1 + markup).
const MARKUP_ABOVE_TARGET = 0.85; // 46.0% margin
const MARKUP_NEAR_TARGET = 0.6; // 37.5% margin
const MARKUP_BELOW_TARGET = 0.4; // 28.6% margin
const MARKUP_BELOW_FLOOR = 0.3; // 23.1% margin (production default markup)
const MARKUP_DEEP_FLOOR = 0.2; // 16.7% margin
const COST_PER_UNIT = 10;
const PER_QUOTE_TARGET_MARGIN_PCT = "0.3500"; // 35% target reference

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
    markupGrid: [
      [MARKUP_NEAR_TARGET, MARKUP_NEAR_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_NEAR_TARGET, MARKUP_NEAR_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_NEAR_TARGET, MARKUP_NEAR_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
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
    markupGrid: [
      [MARKUP_NEAR_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_NEAR_TARGET, MARKUP_ABOVE_TARGET],
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
    markupGrid: [
      [MARKUP_BELOW_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_BELOW_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_BELOW_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
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
    markupGrid: [
      [MARKUP_BELOW_TARGET, MARKUP_BELOW_TARGET, MARKUP_BELOW_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_BELOW_TARGET, MARKUP_BELOW_TARGET, MARKUP_BELOW_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_BELOW_TARGET, MARKUP_BELOW_TARGET, MARKUP_BELOW_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
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
    markupGrid: [
      [MARKUP_DEEP_FLOOR, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_DEEP_FLOOR, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_DEEP_FLOOR, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
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
    // null = no cost data for this (sku, tier). Store sees no
    // packaging for that cell → marginPct = 0. Adapter detects
    // (requiredSell === 0 && contributionCost === 0) and infers
    // missing (CB Patch round 3 adapter extension) → classifier
    // emits missing=true → state_line.status = "provisional".
    markupGrid: [
      [null, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
      [MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, null, MARKUP_ABOVE_TARGET],
      [MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET, MARKUP_ABOVE_TARGET],
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
    //     scenario_label). `target_margin_pct` set per-quote
    //     (Slice 9.2 override) to anchor 35% regardless of
    //     firm_settings drift.
    const [q] = await sql`
      INSERT INTO quotes (
        project_id, scenario_label, version_number, target_margin_pct
      )
      VALUES (
        ${projectId}, ${fix.scenarioLabel}, 1,
        ${PER_QUOTE_TARGET_MARGIN_PCT}
      )
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

    // 3d. Per SKU × tier: insert ONE packaging_inputs row with
    //     unit_cost=10, qty_per_sellable_unit=1, and per-cell
    //     markup_pct (from markupGrid). The math layer's sell-side
    //     primitive is `cost × (1 + markup) × (1 + adj_chain)`;
    //     varying markup_pct per cell produces the target margins
    //     without using sell_price_override (which is TERMINAL and
    //     would bypass tier_price_adj_pct surgical recovery).
    //
    //     Schema: packaging_inputs is keyed per (quote_sku_id,
    //     tier_id, line_group_id, supplier, category). Each cell gets
    //     its own line_group_id so per-tier markup variation lands
    //     cleanly (no shared line group between tiers).
    //
    //     For cells where markupGrid is null (PSR-10 provisional
    //     fixture), skip the packaging input entirely → SKU has no
    //     cost data for that tier → requiredSell + contributionCost
    //     both 0 → adapter infers missing → state_line.status =
    //     "provisional".
    for (let skuIdx = 0; skuIdx < fix.skus.length; skuIdx++) {
      const skuLabel = fix.skus[skuIdx].label;
      const skuId = skuIds[skuLabel];
      for (let tierIdx = 0; tierIdx < fix.tiers.length; tierIdx++) {
        const tierLabel = fix.tiers[tierIdx].label;
        const tierId = tierIds[tierLabel];
        const markupPct = fix.markupGrid[skuIdx][tierIdx];
        if (markupPct === null) {
          // Skip — no cost data → adapter infers missing.
          continue;
        }
        const lineGroupId = crypto.randomUUID();
        await sql`
          INSERT INTO packaging_inputs (
            quote_sku_id, tier_id, line_group_id, supplier, category,
            unit_cost, qty_per_sellable_unit, markup_pct
          )
          VALUES (
            ${skuId}, ${tierId}, ${lineGroupId}, 'Fixture supplier', 'Primary',
            ${COST_PER_UNIT.toString()}, '1', ${markupPct.toFixed(4)}
          )
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
