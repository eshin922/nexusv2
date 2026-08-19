/**
 * Seeds a legacy combined `tooling_artwork_total` onto an isolated
 * ZZ-VALIDATION draft, and reports the current state of the three columns.
 *
 * Written directly rather than through the UI because the UI DELIBERATELY does
 * not offer the legacy input on a quote that has never carried one — that is
 * the behaviour under test. This reproduces the migration state old data can
 * contain; it invents no derived economics and rewrites no history.
 *
 *   usage: bv011-seed-legacy <quoteId> [--seed <amount> | --clear]
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

const quoteId = process.argv[2];
const seedIdx = process.argv.indexOf("--seed");
const amount = seedIdx > -1 ? process.argv[seedIdx + 1] : null;
const clear = process.argv.includes("--clear");
const rows = <T,>(r: unknown) => r as unknown as T[];

if (!quoteId) {
  console.error("usage: bv011-seed-legacy <quoteId> [--seed <amount> | --clear]");
  process.exit(1);
}

// Refuse anywhere but the isolated certification project. A seed like this on
// a client quote would be indistinguishable from real pre-split data.
const [guard] = rows<{ deal: string; status: string }>(
  await db.execute(sql`
    select p.deal_name as deal, q.status::text as status
      from quotes q join projects p on p.id = q.project_id
     where q.id = ${quoteId}::uuid`),
);
if (!guard) {
  console.error("no such quote");
  process.exit(1);
}
if (!guard.deal.startsWith("ZZ-VALIDATION")) {
  console.error(`REFUSED — "${guard.deal}" is not a ZZ-VALIDATION project.`);
  process.exit(1);
}
if (guard.status !== "draft") {
  console.error(`REFUSED — quote is ${guard.status}, not draft.`);
  process.exit(1);
}

if (amount) {
  await db.execute(sql`
    update assembly_production_inputs api
       set tooling_artwork_total = ${amount}::numeric
      from quote_tiers t
     where t.id = api.tier_id and t.quote_id = ${quoteId}::uuid`);
  console.log(`seeded tooling_artwork_total = ${amount} on every tier row`);
} else if (clear) {
  await db.execute(sql`
    update assembly_production_inputs api
       set tooling_artwork_total = NULL, tooling_total = NULL, artwork_total = NULL
      from quote_tiers t
     where t.id = api.tier_id and t.quote_id = ${quoteId}::uuid`);
  console.log("cleared all three Tooling/Artwork columns");
}

const state = rows<{
  tier: string; legacy: string | null; tooling: string | null;
  artwork: string | null; alloc: boolean;
}>(
  await db.execute(sql`
    select t.label as tier, api.tooling_artwork_total::text as legacy,
           api.tooling_total::text as tooling, api.artwork_total::text as artwork,
           api.allocate_service_fees_to_cost as alloc
      from assembly_production_inputs api
      join quote_tiers t on t.id = api.tier_id
     where t.quote_id = ${quoteId}::uuid order by t.qty`),
);
console.log("\n  tier      legacy_combined   tooling   artwork   allocated");
for (const r of state) {
  console.log(
    `  ${r.tier.padEnd(9)} ${String(r.legacy ?? "—").padStart(15)} ${String(r.tooling ?? "—").padStart(9)} ${String(r.artwork ?? "—").padStart(9)}   ${r.alloc}`,
  );
}
process.exit(0);
