// Backfill — Setup → Costs inheritance.
//
// Closes the gap left by the missing materialisation path: attached Setup
// leaves with no Packaging row, and assemblies with no Production row for a
// given tier. Inserts rows with every cost field NULL, so a backfilled row is
// indistinguishable from one the corrected action layer would have created —
// "structure exists, awaiting a cost", never "costs nothing".
//
// SAFETY
//
// - **Draft-only.** Selection mirrors the `assertDraft` mutability contract
//   used by every write action: `quotes.status = 'draft'`. Sent, accepted, and
//   complete revisions are commercially frozen (Pattern 52) and are skipped.
//   Their cost surfaces stay exactly as they were sent.
// - **Additive only.** Never updates or deletes an existing row, so an
//   operator-entered cost cannot be touched.
// - **Idempotent.** Every insert is guarded by a NOT EXISTS test, so a second
//   run is a no-op.
// - **Transactional per quote**, so a quote is either fully inherited or
//   untouched.
//
// Usage:
//   node --env-file=.env.local --experimental-strip-types \
//     scripts/backfill/setup-costs-inheritance.ts [--apply]
//
// Defaults to a DRY RUN. Pass --apply to write.

import { randomUUID } from "node:crypto";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15 });

type Totals = {
  quotes: number;
  packagingRows: number;
  productionRows: number;
  skippedFrozen: number;
};
const totals: Totals = {
  quotes: 0,
  packagingRows: 0,
  productionRows: 0,
  skippedFrozen: 0,
};

try {
  const [frozen] = await sql<{ n: number }[]>`
    select count(*)::int as n from quotes where status <> 'draft'`;
  totals.skippedFrozen = frozen.n;

  const draftQuotes = await sql<{ id: string; label: string | null }[]>`
    select id, scenario_label as label from quotes
    where status = 'draft' order by created_at`;

  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — ${draftQuotes.length} draft quotes in scope; ${frozen.n} non-draft skipped\n`,
  );

  for (const q of draftQuotes) {
    // Leaves attached in Setup that have no Packaging row on a given tier.
    const missingPkg = await sql<
      { assemblyLeafId: string; tierId: string; position: number }[]
    >`
      select al.id as "assemblyLeafId", t.id as "tierId", al.position
      from assembly_leaves al
      join assemblies a on a.id = al.assembly_id
      join quote_tiers t on t.quote_id = a.quote_id
      where a.quote_id = ${q.id}
        and not exists (
          select 1 from assembly_leaf_inputs ali
          where ali.assembly_leaf_id = al.id and ali.tier_id = t.id
        )
      order by al.position, t.sort_order`;

    // Assemblies with no Production row on a given tier.
    const missingProd = await sql<{ assemblyId: string; tierId: string }[]>`
      select a.id as "assemblyId", t.id as "tierId"
      from assemblies a
      join quote_tiers t on t.quote_id = a.quote_id
      where a.quote_id = ${q.id}
        and not exists (
          select 1 from assembly_production_inputs api
          where api.assembly_id = a.id and api.tier_id = t.id
        )`;

    if (missingPkg.length === 0 && missingProd.length === 0) continue;

    totals.quotes += 1;
    totals.packagingRows += missingPkg.length;
    totals.productionRows += missingProd.length;
    console.log(
      `  ${q.id.slice(0, 8)}  ${String(q.label ?? "").slice(0, 28).padEnd(28)}  +${missingPkg.length} packaging  +${missingProd.length} production`,
    );

    if (!APPLY) continue;

    await sql.begin(async (tx) => {
      // One line_group_id per leaf, shared across that leaf's tier rows —
      // a line is one component priced at several quantities.
      const groupByLeaf = new Map<string, string>();
      for (const row of missingPkg) {
        let g = groupByLeaf.get(row.assemblyLeafId);
        if (!g) {
          g = randomUUID();
          groupByLeaf.set(row.assemblyLeafId, g);
        }
        await tx`
          insert into assembly_leaf_inputs
            (assembly_leaf_id, tier_id, line_group_id, sort_order)
          values (${row.assemblyLeafId}, ${row.tierId}, ${g}, ${row.position})`;
      }
      for (const row of missingProd) {
        await tx`
          insert into assembly_production_inputs
            (assembly_id, tier_id, customer_ships_raws, allocate_service_fees_to_cost)
          values (${row.assemblyId}, ${row.tierId}, false, true)`;
      }
    });
  }

  console.log("");
  console.log(`quotes touched      : ${totals.quotes}`);
  console.log(`packaging rows      : ${totals.packagingRows}`);
  console.log(`production rows     : ${totals.productionRows}`);
  console.log(`frozen quotes skipped: ${totals.skippedFrozen}`);
  if (!APPLY) console.log("\nDRY RUN — nothing written. Re-run with --apply.");
} finally {
  await sql.end();
}
