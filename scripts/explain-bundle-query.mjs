// Once the per-query timing instrumentation in getCostingBundle
// identifies a slow query, run this script against a known-slow
// quote to capture EXPLAIN ANALYZE output. Pass the quote_id +
// query name as args.
//
// Usage:
//   node --env-file=.env.local scripts/explain-bundle-query.mjs \
//     <quoteId> <queryName>
//
// queryName ∈ {
//   skus | tiers | packaging | production | markup_defaults |
//   cell_ovr | cell_tgt |
//   freight.groups | freight.legs | freight.leg_tiers |
//   freight.cust_meta
// }
//
// Output: query plan + execution time + buffer stats. Look for:
//   - Seq Scan on a large table = missing index
//   - High rows-removed-by-filter = filter pushdown issue
//   - High actual time vs planned = stats stale (ANALYZE the table)
//   - Hash Join when Nested Loop expected (or vice versa) = bad join order

import postgres from "postgres";

const [, , quoteId, queryName] = process.argv;
if (!quoteId || !queryName) {
  console.error(
    "Usage: node scripts/explain-bundle-query.mjs <quoteId> <queryName>",
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
const sql = postgres(url, { max: 1, idle_timeout: 5 });

// Map queryName → SQL. Mirrors the Drizzle queries in
// src/app/actions/costing.ts getCostingBundle + loadFreightForQuote.
// Hardcoded so the script is self-contained — no Drizzle import at
// the EXPLAIN ANALYZE layer (which is rawer than the production
// query path but produces the same plan).
const QUERIES = {
  skus: `
    SELECT * FROM quote_skus
     WHERE quote_id = $1
     ORDER BY sort_order ASC, created_at ASC;
  `,
  tiers: `
    SELECT * FROM quote_tiers
     WHERE quote_id = $1
     ORDER BY sort_order ASC, created_at ASC;
  `,
  packaging: `
    SELECT pi.*, qs.*
      FROM packaging_inputs pi
           INNER JOIN quote_skus qs ON qs.id = pi.quote_sku_id
     WHERE qs.quote_id = $1;
  `,
  production: `
    SELECT pi.*, qs.*
      FROM production_inputs pi
           INNER JOIN quote_skus qs ON qs.id = pi.quote_sku_id
     WHERE qs.quote_id = $1;
  `,
  markup_defaults: `
    SELECT * FROM markup_defaults;
  `,
  cell_ovr: `
    SELECT qst.quote_sku_id, qst.tier_id, qst.sell_price_override
      FROM quote_sku_tiers qst
           INNER JOIN quote_skus qs ON qs.id = qst.quote_sku_id
     WHERE qs.quote_id = $1;
  `,
  cell_tgt: `
    SELECT qstt.quote_sku_id, qstt.tier_id, qstt.client_target_price_per_unit
      FROM quote_sku_tier_targets qstt
           INNER JOIN quote_skus qs ON qs.id = qstt.quote_sku_id
     WHERE qs.quote_id = $1;
  `,
  "freight.groups": `
    SELECT * FROM freight_leg_groups
     WHERE quote_id = $1
     ORDER BY display_order ASC;
  `,
  "freight.legs": `
    SELECT fl.*
      FROM freight_legs fl
           INNER JOIN freight_leg_groups flg ON flg.id = fl.leg_group_id
     WHERE flg.quote_id = $1
     ORDER BY fl.display_order ASC;
  `,
  "freight.leg_tiers": `
    SELECT flt.*
      FROM freight_leg_tiers flt
           INNER JOIN freight_legs fl ON fl.id = flt.freight_leg_id
           INNER JOIN freight_leg_groups flg ON flg.id = fl.leg_group_id
     WHERE flg.quote_id = $1;
  `,
  "freight.cust_meta": `
    SELECT fcm.*
      FROM freight_customer_arranges_meta fcm
           INNER JOIN freight_legs fl ON fl.id = fcm.freight_leg_id
           INNER JOIN freight_leg_groups flg ON flg.id = fl.leg_group_id
     WHERE flg.quote_id = $1;
  `,
};

const query = QUERIES[queryName];
if (!query) {
  console.error(`Unknown queryName: ${queryName}`);
  console.error(`Available: ${Object.keys(QUERIES).join(", ")}`);
  process.exit(1);
}

try {
  console.log(`\n=== EXPLAIN ANALYZE: ${queryName} on quote ${quoteId} ===\n`);

  // EXPLAIN ANALYZE + BUFFERS + VERBOSE captures planner choice,
  // actual exec time, row count vs estimate, and buffer (cache vs
  // disk) usage.
  const rows = await sql.unsafe(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ${query.trim()}`,
    [quoteId],
  );

  for (const r of rows) {
    console.log(r["QUERY PLAN"]);
  }

  console.log("");
  console.log("Read the plan top-down. Watch for:");
  console.log("  · 'Seq Scan' on a table > a few thousand rows = missing index");
  console.log(
    "  · Wide gap between 'rows=' estimate and 'actual rows=' = stale stats (ANALYZE the table)",
  );
  console.log(
    "  · 'Rows Removed by Filter' high = where-clause filter not using an index",
  );
  console.log(
    "  · 'Buffers: shared read=N' high vs 'hit=N' = cold cache (1st run); re-run to compare",
  );
  console.log(
    "  · 'Execution Time' >100ms on a quote-scoped query usually means missing index",
  );
} finally {
  await sql.end();
}
