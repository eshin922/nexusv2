/**
 * Gate A item 8 — rank quotes by how likely they are to render "on request".
 *
 * READ ONLY. It ranks candidates for a browser sweep; it does not decide
 * whether a cell is unpriced. It cannot: unpriced is an EVALUATED
 * costing/customer-view result, not a row that is missing somewhere.
 *
 * The previous attempt got that wrong — it counted `assembly_leaf_overrides`,
 * which are MANUAL overrides, and so reported "0 priced" for a fully priced
 * quote. This one makes no such claim. It only asks which quotes have the
 * shape that tends to PRODUCE an unpriced cell, and the surface is what
 * answers.
 *
 * Ranked by the conditions named in the disposition:
 *   - a leaf with no cost inputs at all (nothing to price from)
 *   - a leaf with inputs at some tiers and not others (partially resolved)
 *   - drafts first, since a draft is where incomplete costing lives
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

const rows = await db.execute(sql`
  with leaf_tier as (
    select ql.quote_id, ql.id as leaf_id, t.id as tier_id
      from quote_leaves ql
      join quote_tiers t on t.quote_id = ql.quote_id
  ),
  costed as (
    select lt.quote_id,
           lt.leaf_id,
           count(*) filter (where i.quote_leaf_id is not null) as costed_tiers,
           count(*) as tiers
      from leaf_tier lt
      left join assembly_leaf_inputs i
        on i.quote_leaf_id = lt.leaf_id and i.tier_id = lt.tier_id
     group by lt.quote_id, lt.leaf_id
  ),
  agg as (
    select quote_id,
           count(*) as leaves,
           count(*) filter (where costed_tiers = 0) as leaves_with_no_inputs,
           count(*) filter (where costed_tiers > 0 and costed_tiers < tiers)
             as leaves_partially_costed
      from costed
     group by quote_id
  )
  select a.quote_id::text as quote_id,
         q.project_id::text as project_id,
         q.status,
         q.scenario_label,
         a.leaves,
         a.leaves_with_no_inputs,
         a.leaves_partially_costed
    from agg a
    join quotes q on q.id = a.quote_id
   where a.leaves_with_no_inputs > 0 or a.leaves_partially_costed > 0
   order by (q.status = 'draft') desc,
            a.leaves_with_no_inputs desc,
            a.leaves_partially_costed desc
   limit 12
`);

console.log("── candidates most likely to render \"on request\" ──");
console.log("   (a ranking for the sweep, NOT a determination)");
console.log("");
if (rows.length === 0) {
  console.log("   none — every quote's leaves carry cost inputs at every tier.");
  console.log("   If the sweep then finds no unpriced cell either, the state may");
  console.log("   not exist in production at all, and a validation quote is the");
  console.log("   honest next step rather than a weaker gate.");
}
for (const r of rows as unknown as Record<string, unknown>[]) {
  console.log(
    `   /projects/${r.project_id}/quotes/${r.quote_id}/quote` +
      `\n      status=${r.status} scenario=${r.scenario_label} leaves=${r.leaves} ` +
      `no-inputs=${r.leaves_with_no_inputs} partial=${r.leaves_partially_costed}`,
  );
}

process.exit(0);
