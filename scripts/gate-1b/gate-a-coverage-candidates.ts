/**
 * Gate A coverage search — find quotes that naturally exercise the two
 * customer-facing states the parity pass has not reached.
 *
 *   item 8   an unpriced / "on request" cell
 *   item 12  a customer-facing note
 *
 * READ ONLY. It selects; it writes nothing, and it must not: the alternative
 * to finding a real case is a dedicated validation quote, never mutating a
 * customer's.
 *
 * Deliberately raw SQL over the tables rather than the resolver — the resolver
 * pulls Clerk transitively and will not load outside Next, and this only needs
 * to know WHICH quotes to then inspect through the surface.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

// ── item 12 · a customer-facing note ────────────────────────────────────
const withNotes = await db.execute(sql`
  select q.id::text as quote_id,
         p.id::text as project_id,
         q.status,
         q.scenario_label,
         length(q.customer_facing_notes) as note_len
    from quotes q
    join projects p on p.id = q.project_id
   where q.customer_facing_notes is not null
     and length(trim(q.customer_facing_notes)) > 0
   order by q.updated_at desc nulls last
   limit 10
`);

// ── item 8 · an unpriced cell ───────────────────────────────────────────
//
// A leaf with no sell override and no target at some tier renders "on
// request". The cheapest structural proxy: quotes that HAVE leaves and tiers
// but are missing a per-(leaf, tier) sell row somewhere.
const maybeUnpriced = await db.execute(sql`
  with pairs as (
    select ql.quote_id, ql.id as leaf_id, t.id as tier_id
      from quote_leaves ql
      join quote_tiers t on t.quote_id = ql.quote_id
  ),
  priced as (
    select p.quote_id,
           count(*) filter (where o.quote_leaf_id is not null) as priced_cells,
           count(*) as total_cells
      from pairs p
      left join assembly_leaf_overrides o
        on o.quote_leaf_id = p.leaf_id and o.tier_id = p.tier_id
     group by p.quote_id
  )
  select pr.quote_id::text as quote_id,
         q.status,
         pr.priced_cells,
         pr.total_cells
    from priced pr
    join quotes q on q.id = pr.quote_id
   where pr.priced_cells < pr.total_cells
   order by pr.total_cells desc
   limit 10
`);

console.log("── item 12 · quotes carrying a customer-facing note ──");
if (withNotes.length === 0) console.log("   none found");
for (const r of withNotes as unknown as Record<string, unknown>[]) {
  console.log(
    `   quote ${r.quote_id}  project ${r.project_id}  status=${r.status}  ` +
      `scenario=${r.scenario_label}  note ${r.note_len} chars`,
  );
}

console.log("");
console.log("── item 8 · candidates with an unpriced (leaf, tier) cell ──");
if (maybeUnpriced.length === 0) console.log("   none found");
for (const r of maybeUnpriced as unknown as Record<string, unknown>[]) {
  console.log(
    `   quote ${r.quote_id}  status=${r.status}  priced ${r.priced_cells}/${r.total_cells}`,
  );
}

process.exit(0);
