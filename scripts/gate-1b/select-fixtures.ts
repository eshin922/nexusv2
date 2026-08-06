/**
 * Gate 1B · S-7 — fixture selection. READ ONLY.
 *
 * The preservation proof is only as good as what it covers. A baseline over
 * three simple quotes proves the simple path and says nothing about the paths
 * where divergence is actually likely — overrides, tier adjustments, the
 * allocation toggle, customer-shipped raws, multi-leg freight.
 *
 * So fixtures are selected by COVERAGE of the ten node kinds, not by
 * convenience. Each quote is scored on which kinds its data can produce, and
 * the report names any kind no candidate reaches — an uncovered kind is a hole
 * in the proof and must be stated rather than discovered later.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

type Row = Record<string, string | null>;

const rows = (await db.execute(sql`
  select q.id::text                        as quote_id,
         q.status,
         q.scenario_label,
         p.deal_name,
         (q.global_price_adj_pct is not null and q.global_price_adj_pct <> 0)::text as has_global_adj,
         (select count(*) from quote_tiers t where t.quote_id = q.id)::text          as tiers,
         (select count(*) from quote_tiers t where t.quote_id = q.id
            and t.tier_price_adj_pct is not null)::text                             as tier_adj,
         (select count(*) from assemblies a where a.quote_id = q.id)::text           as assemblies,
         (select count(*) from assembly_leaves al
             join assemblies a on a.id = al.assembly_id where a.quote_id = q.id)::text as leaves,
         (select count(*) from assembly_leaf_inputs ali
             join assembly_leaves al on al.id = ali.assembly_leaf_id
             join assemblies a on a.id = al.assembly_id
            where a.quote_id = q.id and ali.unit_cost is not null)::text             as priced_pkg_cells,
         (select count(distinct ali.line_group_id) from assembly_leaf_inputs ali
             join assembly_leaves al on al.id = ali.assembly_leaf_id
             join assemblies a on a.id = al.assembly_id
            where a.quote_id = q.id)::text                                           as pkg_lines,
         (select count(*) from assembly_leaf_inputs ali
             join assembly_leaves al on al.id = ali.assembly_leaf_id
             join assemblies a on a.id = al.assembly_id
            where a.quote_id = q.id and ali.markup_pct is not null)::text            as pkg_line_markups,
         (select count(*) from assembly_production_inputs api
             join assemblies a on a.id = api.assembly_id where a.quote_id = q.id)::text as prod_rows,
         (select count(*) from assembly_production_inputs api
             join assemblies a on a.id = api.assembly_id
            where a.quote_id = q.id and api.allocate_service_fees_to_cost)::text     as alloc_on,
         (select count(*) from assembly_production_inputs api
             join assemblies a on a.id = api.assembly_id
            where a.quote_id = q.id and api.customer_ships_raws)::text               as ships_raws,
         (select count(*) from assembly_production_inputs api
             join assemblies a on a.id = api.assembly_id
            where a.quote_id = q.id and api.bulk_raw_cost is not null
              and api.bulk_raw_cost <> 0)::text                                      as bulk_raw,
         (select count(*) from assembly_leaf_overrides alo
             join assembly_leaves al on al.id = alo.assembly_leaf_id
             join assemblies a on a.id = al.assembly_id where a.quote_id = q.id)::text as overrides,
         (select count(*) from freight_subcategories fs where fs.quote_id = q.id)::text as shipments,
         (select count(*) from freight_destination_breaks b
             join freight_destinations d on d.id = b.freight_destination_id
             join freight_subcategories fs on fs.id = d.freight_subcategory_id
            where fs.quote_id = q.id)::text                                          as freight_breaks,
         (select count(*) from freight_customs_breaks cb
             join freight_customs_entries e on e.id = cb.freight_customs_entry_id
             join freight_subcategories fs on fs.id = e.freight_subcategory_id
            where fs.quote_id = q.id)::text                                          as customs_breaks
    from quotes q
    join projects p on p.id = q.project_id
   order by q.updated_at desc
`)) as unknown as Row[];

const n = (r: Row, k: string) => Number(r[k] ?? 0);

/** Which of the ten node kinds this quote's data can actually produce. */
function kinds(r: Row): string[] {
  const k: string[] = [];
  if (n(r, "priced_pkg_cells") > 0 || n(r, "prod_rows") > 0) k.push("origin", "sum", "markup");
  if (n(r, "pkg_line_markups") > 0 || n(r, "pkg_lines") > 0) k.push("resolution");
  if (n(r, "prod_rows") > 0 && n(r, "tiers") > 0) k.push("allocation");
  if (n(r, "customs_breaks") > 0) k.push("rate");
  if (r.has_global_adj === "true" || n(r, "tier_adj") > 0) k.push("adjustment");
  if (n(r, "tier_adj") > 0) k.push("resolution:adj");
  if (n(r, "overrides") > 0) k.push("override");
  if (n(r, "ships_raws") > 0) k.push("flagged-out");
  if (n(r, "assemblies") > 1 || n(r, "leaves") > 1) k.push("blend");
  return [...new Set(k)];
}

const scored = rows
  .map((r) => ({ r, k: kinds(r) }))
  .filter((x) => n(x.r, "leaves") > 0)
  .sort((a, b) => b.k.length - a.k.length || n(b.r, "priced_pkg_cells") - n(a.r, "priced_pkg_cells"));

console.log(`\nGate 1B S-7 — fixture selection over ${rows.length} quotes\n`);
console.log("Top candidates by node-kind coverage:\n");
for (const { r, k } of scored.slice(0, 12)) {
  console.log(
    `  ${r.quote_id}  [${String(r.status).padEnd(8)}] ${String(r.deal_name).slice(0, 34).padEnd(34)} ${String(r.scenario_label).slice(0, 26)}`,
  );
  console.log(
    `      tiers=${r.tiers} leaves=${r.leaves} pkgCells=${r.priced_pkg_cells} lines=${r.pkg_lines} prod=${r.prod_rows} ship=${r.shipments} brk=${r.freight_breaks} cust=${r.customs_breaks} ovr=${r.overrides} tierAdj=${r.tier_adj} raws=${r.ships_raws} bulk=${r.bulk_raw}`,
  );
  console.log(`      kinds(${k.length}): ${k.join(" ")}\n`);
}

const ALL = [
  "origin", "sum", "markup", "resolution", "allocation",
  "rate", "adjustment", "override", "flagged-out", "blend",
];
const covered = new Set(scored.slice(0, 12).flatMap((x) => x.k.map((s) => s.split(":")[0])));
const missing = ALL.filter((k) => !covered.has(k));
console.log(
  missing.length === 0
    ? "Every node kind is reachable from the candidate set.\n"
    : `UNCOVERED node kinds across all candidates: ${missing.join(", ")}\n  A baseline cannot exercise these; state it rather than discover it.\n`,
);
process.exit(0);
