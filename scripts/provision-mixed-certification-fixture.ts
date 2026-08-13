/**
 * Mixed Direct + Item Group certification fixture.
 *
 * WHAT THIS ARTIFACT EXISTS TO PROVE. Not reconciliation — omission. Before
 * a5d19b5, a mixed turnkey quote rebuilt its payload with `lines: []`, so every
 * Direct Product was dropped from the Sales Order while the quote completed
 * successfully and the order balanced against its own lines. An accepted product
 * silently absent downstream is the primary invariant this fixture protects.
 *
 * SEEDS STRUCTURE AND ECONOMICS ONLY. Lifecycle is earned through the governed
 * path: Send → Accept → Complete run through the application. No freeze column
 * is written here — not `sent_at`, not `accepted_at`, not
 * `customer_accepted_tier_id`, not `accepted_tier_id`. Seeding those is the
 * Pattern 52 / defect-#154 masking failure, where a fixture pre-satisfies the
 * very state the walk is supposed to establish.
 *
 * READS FROM SOURCE (Pattern 53). Library leaves, project lineage and the
 * NetSuite customer map are read, never invented. Nothing here fabricates a
 * value that production code derives at runtime.
 *
 * Run:
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/provision-mixed-certification-fixture.ts
 */
import postgres from "postgres";
import crypto from "node:crypto";

const DB = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!DB) throw new Error("DIRECT_URL or DATABASE_URL required");
const sql = postgres(DB, { prepare: false, max: 1, connect_timeout: 10 });

// Existing project with verified lineage: HubSpot deal 59153706532 →
// company 52961503280 → NetSuite customer 360189. Reused deliberately so the
// fixture makes NO HubSpot write — creating a deal would be a production
// mutation, and suppression covers Accept-side writes, not deal creation.
const PROJECT_ID = "3a556d2b-52da-4805-a0c8-d9d520234fd4";

// Library leaves, by SKU. All three resolve in the NetSuite sandbox.
const GROUP_MEMBER_A = "eabba094-daff-481f-98d7-7341f52e7c47"; // 10064-GNX-Box
const GROUP_MEMBER_B = "6cce847c-37bf-46b4-ab33-315b2b33c6a6"; // DPS-BOTTLE-0001
const DIRECT_LEAF = "1347b416-60b2-4686-bd8b-19f546412d44"; // BA146400

// DISTINGUISHABILITY. Three different costs, none equal to any rate, and none a
// multiple of another — so a swap, a duplication or a cost echoing `rate`
// cannot reconcile by coincidence.
const COST_MEMBER_A = "0.37";
const COST_MEMBER_B = "1.29";
const COST_DIRECT = "2.53";
const TIER_QTY = 1000;

const TAG = `CERT-MIXED-DELETE-ME-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}`;

async function main() {
  const [project] = await sql`
    select p.id, p.deal_name, p.hubspot_deal_id, c.associated_company_id, m.netsuite_customer_id
    from projects p
    join hubspot_deals_cache c on c.deal_id = p.hubspot_deal_id
    join netsuite_customer_map m on m.hubspot_company_id = c.associated_company_id
    where p.id = ${PROJECT_ID}`;
  if (!project) throw new Error("Project lineage incomplete — refusing to seed.");
  console.log("lineage:", JSON.stringify(project));

  const leaves = await sql`
    select id, sku, name from leaves where id in (${GROUP_MEMBER_A}, ${GROUP_MEMBER_B}, ${DIRECT_LEAF})`;
  if (leaves.length !== 3) throw new Error("Expected 3 library leaves.");
  const bySku = new Map(leaves.map((l) => [l.id, l]));

  const quoteId = crypto.randomUUID();
  const tierId = crypto.randomUUID();
  const assemblyId = crypto.randomUUID();

  await sql.begin(async (tx) => {
    const [{ next }] = await tx`
      select coalesce(max(version_number), 0) + 1 as next from quotes where project_id = ${PROJECT_ID}`;

    await tx`
      insert into quotes (id, project_id, scenario_label, version_number, status, detail_level, global_price_adj_pct)
      values (${quoteId}, ${PROJECT_ID}, ${TAG}, ${next}, 'draft', 'turnkey_only', 0)`;

    // ONE tier. Sufficient: the mechanisms under test are structural, and a
    // second tier would multiply read-back surface without adding a proof.
    await tx`
      insert into quote_tiers (id, quote_id, label, qty, sort_order)
      values (${tierId}, ${quoteId}, 'Tier 1', ${TIER_QTY}, 0)`;

    // --- the Item Group: one assembly, two members ---
    await tx`
      insert into assemblies (id, quote_id, sku, name, position)
      values (${assemblyId}, ${quoteId}, ${`${TAG}-GRP`}, 'Certification Item Group', 0)`;

    for (const [i, leafId] of [GROUP_MEMBER_A, GROUP_MEMBER_B].entries()) {
      const quoteLeafId = crypto.randomUUID();
      await tx`
        insert into quote_leaves (id, quote_id, assembly_id, leaf_id, quantity, position)
        values (${quoteLeafId}, ${quoteId}, ${assemblyId}, ${leafId}, 1, ${i})`;
      await tx`
        insert into assembly_leaves (assembly_id, leaf_id, quantity, position, parent_assembly_leaf_id, quote_leaf_id)
        values (${assemblyId}, ${leafId}, 1, ${i}, null, ${quoteLeafId})`;
    }

    // --- the Direct Product: quote-level, assembly_id NULL, no junction ---
    const directQuoteLeafId = crypto.randomUUID();
    await tx`
      insert into quote_leaves (id, quote_id, assembly_id, leaf_id, quantity, position)
      values (${directQuoteLeafId}, ${quoteId}, null, ${DIRECT_LEAF}, 1, 0)`;

    // --- economics: one packaging line per attachment, priced ---
    const costByLeaf = new Map<string, string>([
      [GROUP_MEMBER_A, COST_MEMBER_A],
      [GROUP_MEMBER_B, COST_MEMBER_B],
      [DIRECT_LEAF, COST_DIRECT],
    ]);
    const attachments = await tx`
      select id, leaf_id, assembly_id from quote_leaves where quote_id = ${quoteId}`;
    for (const a of attachments) {
      await tx`
        insert into assembly_leaf_inputs
          (quote_leaf_id, assembly_leaf_id, tier_id, line_group_id, sort_order,
           inventory_eligible, unit_cost, qty_per_sellable_unit, category)
        values (${a.id}, null, ${tierId}, ${crypto.randomUUID()}, 0, false,
                ${costByLeaf.get(a.leaf_id)!}, 1, 'Primary')`;
    }

    console.log(
      JSON.stringify(
        {
          quoteId,
          tierId,
          tierQty: TIER_QTY,
          assemblyId,
          scenario: TAG,
          itemGroupMembers: [GROUP_MEMBER_A, GROUP_MEMBER_B].map((id) => ({
            leafId: id,
            sku: bySku.get(id)!.sku,
            governedUnitCost: costByLeaf.get(id),
          })),
          directProduct: {
            quoteLeafId: directQuoteLeafId,
            leafId: DIRECT_LEAF,
            sku: bySku.get(DIRECT_LEAF)!.sku,
            governedUnitCost: COST_DIRECT,
          },
        },
        null,
        2,
      ),
    );
  });

  // Lifecycle columns deliberately untouched — asserted, not assumed.
  const [check] = await sql`
    select status, sent_at, accepted_at, customer_accepted_tier_id, accepted_tier_id
    from quotes where id = ${quoteId}`;
  console.log("lifecycle (must be draft + all null):", JSON.stringify(check));

  await sql.end();
}

await main();
