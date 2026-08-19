/**
 * PROOF 7 — existing non-draft quotes are not retroactively rewritten.
 *
 * Two claims, and the second is the one that matters:
 *
 *   a) the frozen tables are empty — 0087 backfilled nothing;
 *   b) every non-draft quote that predates the freeze therefore has NO frozen
 *      matrix, and reads of it must return "not available from the record"
 *      rather than a live recomputation dressed as history.
 *
 * (b) is the honest consequence of not rewriting history. A backfill would
 * have produced a frozen matrix for quotes sent under the OLD OTC behaviour —
 * MAX-across-tiers, OR-across-tiers, OTC at cost — and stamped today's
 * corrected arithmetic onto documents the customer already received. The
 * absence of those rows IS the guarantee.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

const rows = <T,>(r: unknown) => r as unknown as T[];

const counts = rows<{ t: string; n: number }>(
  await db.execute(sql`
    select 'quote_snapshot_lines' t, count(*)::int n from quote_snapshot_lines
    union all select 'quote_snapshot_line_tiers', count(*)::int from quote_snapshot_line_tiers
    union all select 'quote_snapshot_tier_totals', count(*)::int from quote_snapshot_tier_totals`),
);
console.log("\n── frozen tables after 0087 ──");
for (const c of counts) console.log(`  ${c.t.padEnd(28)} ${c.n}`);

const pop = rows<{
  status: string;
  quotes: number;
  with_snapshot: number;
  with_frozen_matrix: number;
}>(
  await db.execute(sql`
    select q.status::text                                       as status,
           count(*)::int                                        as quotes,
           count(s.id)::int                                     as with_snapshot,
           count(distinct t.quote_snapshot_id)::int             as with_frozen_matrix
      from quotes q
      left join quote_snapshots s
        on s.quote_id = q.id and s.superseded_at is null
      left join quote_snapshot_tier_totals t
        on t.quote_snapshot_id = s.id
     where q.status <> 'draft'
     group by q.status order by q.status`),
);
console.log("\n── non-draft population ──");
console.log("  status        quotes  current snapshot  frozen matrix");
for (const p of pop) {
  console.log(
    `  ${p.status.padEnd(12)} ${String(p.quotes).padStart(6)} ${String(p.with_snapshot).padStart(17)} ${String(p.with_frozen_matrix).padStart(14)}`,
  );
}

// Allocation-OFF census: the population whose commercial total the OTC
// corrections would MOVE if anything ever recomputed them. Named explicitly
// so the absence of a frozen matrix for these is a recorded fact, not a gap
// discovered later.
const allocOff = rows<{ quote_id: string; status: string; tiers_off: number }>(
  await db.execute(sql`
    select q.id::text as quote_id, q.status::text as status,
           count(*)::int as tiers_off
      from quotes q
      join assemblies a on a.quote_id = q.id
      join assembly_production_inputs api on api.assembly_id = a.id
     where q.status <> 'draft'
       and api.allocate_service_fees_to_cost = false
     group by q.id, q.status order by q.status`),
);
console.log("\n── non-draft quotes with allocation OFF ──");
if (allocOff.length === 0) console.log("  none");
for (const a of allocOff) console.log(`  ${a.quote_id}  ${a.status.padEnd(10)} ${a.tiers_off} tier-row(s)`);

// PROOF 7, as an ordering claim rather than an emptiness one.
//
// "The tables are empty" was the right assertion only until the first
// certification send. The DURABLE claim is that no quote sent BEFORE the
// freeze shipped acquired frozen rows, and every quote sent after it has
// them — so the boundary is clean in both directions:
//
//   max(sent_at | no frozen rows)  <  min(sent_at | frozen rows)
//
// A pre-#300 quote gaining rows would break the left side. A post-freeze send
// missing its matrix would break the right.
const boundary = rows<{ side: string; n: number; earliest: string | null; latest: string | null }>(
  await db.execute(sql`
    select case when t.quote_snapshot_id is null then 'without frozen matrix'
                else 'with frozen matrix' end as side,
           count(distinct s.id)::int as n,
           min(s.sent_at)::text as earliest,
           max(s.sent_at)::text as latest
      from quote_snapshots s
      left join quote_snapshot_tier_totals t on t.quote_snapshot_id = s.id
     group by 1 order by 1`),
);
console.log("\n── snapshots, split by whether they carry a frozen matrix ──");
for (const b of boundary)
  console.log(`  ${b.side.padEnd(22)} ${String(b.n).padStart(3)} snapshot(s)  ${b.earliest ?? "—"} .. ${b.latest ?? "—"}`);

const withM = boundary.find((b) => b.side === "with frozen matrix");
const without = boundary.find((b) => b.side === "without frozen matrix");
const clean =
  !withM || !without || (without.latest !== null && withM.earliest !== null &&
    without.latest < withM.earliest);

console.log(
  clean
    ? "\nPROOF 7 HOLDS · every snapshot predating the freeze has no frozen rows;\n            nothing historical was backfilled or rewritten."
    : "\nPROOF 7 FAILS · a snapshot predating the freeze carries frozen rows.",
);
process.exit(clean ? 0 : 1);
