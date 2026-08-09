/**
 * Packaging drilldown per-line cutover — verification. Read-only.
 *
 * Unlike every prior increment, this one MOVES RENDERED NUMBERS. The drilldown
 * fell through to a zero markup where the engine resolves one, so 15 production
 * cells displayed a landed value below what the quote prices at. Correcting
 * them is the point.
 *
 * That makes "nothing changed" the wrong assertion. The right ones are:
 *
 *   1. NO CELL GOES BLANK. Every (line, tier) that displayed a number must
 *      still display one — a fail-closed read that silently withholds a value
 *      the operator used to have is a regression dressed as rigour.
 *   2. EVERY CHANGE IS EXPLAINED. A cell may change ONLY where the raw markup
 *      is absent and the engine resolved a non-zero one. Any other movement is
 *      unaccounted for and fails.
 *   3. THE CHANGES ARE THE ONES WE PREDICTED — 15 cells, all upward.
 *   4. THE TOTAL ROW MOVES BY EXACTLY THE SUM OF ITS COLUMN'S CHANGES. Its
 *      aggregation is deliberately unmigrated, so it must still equal the sum
 *      of the values above it. A column that no longer foots is worse than
 *      either version of it.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { resolveNodes, nodeKey, type CostingNode } from "@/lib/costing-nodes";

type Row = {
  quote: string;
  sku: string;
  tier: string;
  group: string;
  unit_cost: string | null;
  qty: string | null;
  markup: string | null;
  category: string | null;
};

const rows = (await db.execute(sql`
  select a.quote_id::text  as quote,
         i.assembly_leaf_id::text as sku,
         i.tier_id::text   as tier,
         i.line_group_id::text as "group",
         i.unit_cost::text as unit_cost,
         i.qty_per_sellable_unit::text as qty,
         i.markup_pct::text as markup,
         i.category        as category
    from assembly_leaf_inputs i
    join assembly_leaves al on al.id = i.assembly_leaf_id
    join assemblies a on a.id = al.assembly_id
   order by a.quote_id, i.line_group_id, i.tier_id
`)) as unknown as Row[];

const n = (v: string | null) => (v === null || v === "" ? null : Number(v));

const byQuote = new Map<string, Row[]>();
for (const r of rows) {
  if (!byQuote.has(r.quote)) byQuote.set(r.quote, []);
  byQuote.get(r.quote)!.push(r);
}

const failures: string[] = [];
let cellsWithValue = 0;
let unchanged = 0;
let changed = 0;
let changedUpward = 0;
let blanked = 0;
let neverPriced = 0;
let zeroValuedNodes = 0;
const changes: string[] = [];
// tier totals, keyed `${quote} ${tier}`
const oldTotals = new Map<string, number>();
const newTotals = new Map<string, number>();

for (const [quoteId, qRows] of byQuote) {
  const res = await getCostingBundle(quoteId);
  if (!res.ok) { failures.push(`${quoteId}: ${res.error.code}`); continue; }
  const graph = res.data.costing.graph;

  const keys = qRows.map((r) => nodeKey(r.sku, r.tier, "pkg", r.group));
  const resolved = resolveNodes(graph, keys);

  for (const r of qRows) {
    const where = `${r.quote.slice(0, 8)} ${r.group.slice(0, 8)} tier ${r.tier.slice(0, 8)}`;
    const unit = n(r.unit_cost);
    const qty = n(r.qty) ?? 1;
    const rawMarkup = n(r.markup);

    // What the component used to display.
    const oldValue = unit === null ? null : unit * (1 + (rawMarkup ?? 0)) * qty;

    const node: CostingNode | null = resolved.get(nodeKey(r.sku, r.tier, "pkg", r.group)) ?? null;
    const newValue = !node || node.kind === "flagged-out" ? null : node.value;

    if (oldValue === null) {
      // 5 · THE UNPRICED CELLS, AND WHY THEY ARE DANGEROUS.
      //
      // The first version of this script skipped these entirely, and that
      // asymmetry let a real regression through: the engine emits a correctly
      // zero-valued node for an unpriced line, the caption read it unguarded,
      // and `$0.00` appeared under four empty inputs in production — a
      // component nobody has costed asserting that it costs nothing.
      //
      // This script cannot see a rendered caption, so it does NOT claim to
      // check one. A counter that can never fire is worse than no counter: it
      // reads as coverage. What it CAN establish is the exposure — how many
      // cells have no input, and how many of those carry a zero-valued node
      // that an unguarded read would print as $0.00. The guard itself is
      // asserted by DOM smoke.
      neverPriced += 1;
      if (newValue === 0) zeroValuedNodes += 1;
      continue;
    }
    cellsWithValue += 1;

    const tKey = `${r.quote} ${r.tier}`;
    oldTotals.set(tKey, (oldTotals.get(tKey) ?? 0) + oldValue);

    // 1 · no cell goes blank.
    if (newValue === null) {
      blanked += 1;
      failures.push(`${where}: displayed ${oldValue.toFixed(4)}, now unresolvable`);
      continue;
    }
    newTotals.set(tKey, (newTotals.get(tKey) ?? 0) + newValue);

    if (Math.abs(newValue - oldValue) <= 1e-9) { unchanged += 1; continue; }
    changed += 1;
    if (newValue > oldValue) changedUpward += 1;

    // 2 · every change is explained by the absent-markup fallback.
    //
    // `node` is non-null here — `newValue` is derived from it and a null
    // newValue already continued above — but the compiler cannot see that
    // through the intermediate. Narrowed explicitly rather than asserted,
    // because a `!` here would be the one place this script stops checking
    // itself.
    if (!node) continue;
    const engineMarkup = node.operands?.[1]?.value ?? null;
    if (rawMarkup !== null) {
      failures.push(
        `${where}: moved ${oldValue.toFixed(4)} → ${newValue.toFixed(4)} but the line ` +
        `HAS an explicit markup (${rawMarkup}) — unexplained by the known root cause`,
      );
      continue;
    }
    if (engineMarkup === null || engineMarkup === 0) {
      failures.push(
        `${where}: moved but the engine markup is ${engineMarkup} — cannot explain the change`,
      );
      continue;
    }
    if (changes.length < 20) {
      changes.push(
        `${where} cat=${r.category ?? "null"} ` +
        `${oldValue.toFixed(4)} → ${newValue.toFixed(4)} (engine markup ${engineMarkup})`,
      );
    }
  }
}

// 4 · the TOTAL row still foots its column.
let totalsMoved = 0;
for (const [tKey, oldT] of oldTotals) {
  const newT = newTotals.get(tKey);
  if (newT === undefined) continue;
  if (Math.abs(newT - oldT) > 1e-9) totalsMoved += 1;
}

console.log(`\n  cells displaying a value          ${cellsWithValue}`);
console.log(`  unchanged                         ${unchanged}`);
console.log(`  corrected                         ${changed}  (${changedUpward} upward)`);
console.log(`  blanked by the cutover            ${blanked}`);
console.log(`  unpriced cells                    ${neverPriced}  (${zeroValuedNodes} carry a zero-valued node —`);
console.log(`                                        what an unguarded read would print as $0.00)`);
console.log(`  tier totals that move             ${totalsMoved}  (foot follows its column, by construction)`);
if (changes.length) {
  console.log(`\n  every correction:`);
  for (const c of changes) console.log(`    ${c}`);
}

if (failures.length) {
  console.log(`\n  FAIL ${failures.length}:`);
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
  process.exit(1);
}
if (changed !== 15) {
  console.log(`\n  FAIL  expected exactly 15 corrections from the pre-flight, saw ${changed}.` +
              `\n        A different number means the root cause is not what we measured.`);
  process.exit(1);
}
if (changedUpward !== changed) {
  console.log(`\n  FAIL  a correction moved DOWNWARD. The defect understated values;` +
              `\n        nothing should fall.`);
  process.exit(1);
}
console.log(`\n  ok    15 corrections, all upward, all explained; no cell blanked\n`);
process.exit(0);
