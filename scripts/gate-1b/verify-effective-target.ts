/**
 * Effective target margin — one resolution, five readers. Read-only.
 *
 * The point of this package is not that the number changed — it did not. It is
 * that five independent ladders became one, so this checks the properties that
 * make that claim meaningful rather than the number they all already agreed on.
 *
 *   1. The node exists on every quote, is a resolution, and states which rung
 *      it chose.
 *   2. Its value equals what the removed expression produced. No verdict moves.
 *   3. Its PROVENANCE matches the database: a quote with a target override must
 *      say "Quote override", and one without must not. Two of the five surfaces
 *      displayed a source; if the node's source were wrong they would now all
 *      be wrong together, which is worse than the drift it replaces.
 *   4. Overriding quotes actually occur, so the provenance path is exercised.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { readEffectiveTargetMargin, resolveNode, quoteWideKey } from "@/lib/costing-nodes";

const rows = (await db.execute(sql`
  select q.id::text as id, q.target_margin_pct::text as override
    from quotes q
   where exists (select 1 from quote_leaves ql where ql.quote_id = q.id)
   order by q.id
`)) as unknown as { id: string; override: string | null }[];

const firm = (await db.execute(sql`
  select target_margin_pct::text as t from firm_settings where effective_until is null
`)) as unknown as { t: string }[];
const firmTarget = Number(firm[0].t);

const failures: string[] = [];
let checked = 0;
let overriding = 0;
let inheriting = 0;

for (const r of rows) {
  const res = await getCostingBundle(r.id);
  if (!res.ok) { failures.push(`${r.id}: ${res.error.code}`); continue; }
  const graph = res.data.costing.graph;
  const where = r.id.slice(0, 8);

  const node = resolveNode(graph.nodes, quoteWideKey("target-margin"));
  if (!node) { failures.push(`${where}: target-margin node missing`); continue; }
  if (node.kind !== "resolution") failures.push(`${where}: kind is ${node.kind}`);
  const chosenCount = (node.candidates ?? []).filter((c) => c.chosen).length;
  if (chosenCount !== 1) failures.push(`${where}: ${chosenCount} chosen rungs, expected 1`);

  const read = readEffectiveTargetMargin(graph);
  if (!read) { failures.push(`${where}: unreadable`); continue; }
  checked += 1;

  // 2 · the value the removed expression produced.
  const expected = r.override !== null ? Number(r.override) : firmTarget;
  if (Math.abs(read.value - expected) > 1e-12) {
    failures.push(`${where}: value ${read.value} != ${expected}`);
  }

  // 3 · provenance against the database, not against itself.
  if (r.override !== null) {
    overriding += 1;
    if (!read.isOverride) failures.push(`${where}: has an override, reports "${read.source}"`);
    if (read.withoutOverride !== firmTarget) {
      failures.push(`${where}: withoutOverride ${read.withoutOverride} != firm ${firmTarget}`);
    }
  } else {
    inheriting += 1;
    if (read.isOverride) failures.push(`${where}: has NO override, reports "${read.source}"`);
  }
}

console.log(`\n  quotes checked                 ${checked}`);
console.log(`  reporting "Quote override"     ${overriding}`);
console.log(`  reporting "Firm default"       ${inheriting}`);
console.log(`  firm default                   ${(firmTarget * 100).toFixed(0)}%`);

if (failures.length) {
  console.log(`\n  FAIL ${failures.length}:`);
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
  process.exit(1);
}
if (overriding === 0) {
  console.log(`\n  FAIL  no quote exercised the override rung — provenance went untested.`);
  process.exit(1);
}
console.log(`\n  ok    one resolution, value and provenance both matching the database\n`);
process.exit(0);
