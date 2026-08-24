/**
 * Does the frozen recovery instruction project correctly, and will the database
 * take it?
 *
 * Four things, and only one of them is arithmetic:
 *
 *  1. EVERY placed charge on a live quote produces an instruction. Every quote
 *     today is legacy-placed, so an elections-keyed freeze would record nothing
 *     — this is the measurement that says the projection does not have that
 *     shape.
 *
 *  2. The leaf predicate does not SILENTLY DROP rows. `isLeaf` answers false
 *     both for "this is an assembly" and for "this id is not in `skus` at all",
 *     and those are different facts. If a rollup id is absent from `skus`, its
 *     charges vanish from the accounting record with nothing reporting it. So
 *     the unresolved case is counted separately and is a FAILURE, not a skip.
 *
 *  3. No legacy amortization carries a per-unit basis. A legacy allocated fee
 *     is marked up by the quote-level adjustment, so a frozen $0.14 would sit
 *     beside a charge the customer paid $0.168 for.
 *
 *  4. The database accepts the write, PERFORMED and rolled back — because a
 *     Drizzle `.notNull()` is a declaration, not a check, which is what the
 *     0066 outage cost.
 *
 * Read-only in effect: the only writes happen inside a transaction that throws.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { projectFrozenInstructions } from "@/lib/commercial-recovery/frozen-instruction";

const failures: string[] = [];

// ── PHASE 1 · THE PROJECTION, OVER THE LIVE ESTATE ─────────────────────

type QuoteRow = { quote_id: string; status: string; gpa: number | null };

const quotes = (await db.execute(sql`
  select q.id::text as quote_id, q.status,
         q.global_price_adj_pct::float8 as gpa
    from quotes q
   where exists (
     select 1 from assemblies a
       join assembly_production_inputs api on api.assembly_id = a.id
      where a.quote_id = q.id
        and coalesce(api.setup_fee_total, 0)
          + coalesce(api.tooling_total, 0)
          + coalesce(api.artwork_total, 0)
          + coalesce(api.tooling_artwork_total, 0)
          + coalesce(api.rd_total, 0)
          + coalesce(api.other_service_total, 0) > 0
   )
   order by q.id::text
`)) as unknown as QuoteRow[];

console.log(
  `\nFrozen recovery instruction — ${quotes.length} quotes carrying a one-time charge\n`,
);

let instructions = 0;
let unresolvedOwners = 0;
let legacyWithBasis = 0;
let electedRows = 0;
let quotesWithNone = 0;
const byTreatment = new Map<string, number>();

for (const q of quotes) {
  const bundle = await getCostingBundle(q.quote_id);
  if (!bundle.ok) {
    // A read failure is not an absence. Counting it as one is the shape that
    // let a nonexistence claim be reported from a caught error.
    console.log(`  ${q.quote_id}  BUNDLE FAILED — ${bundle.error.code}`);
    unresolvedOwners++;
    continue;
  }
  const skus = (bundle.data.skus ?? []) as { id: string; skuRole?: string }[];
  const known = new Map(skus.map((s) => [s.id, s.skuRole]));

  // Rollups whose id `skus` cannot resolve at all: the rows the predicate would
  // drop while returning the same `false` it returns for an assembly.
  for (const r of (bundle.data.costing?.skuRollups ?? []) as { skuId: string }[]) {
    if (!known.has(r.skuId)) {
      unresolvedOwners++;
      console.log(
        `  ${q.quote_id}  UNRESOLVED rollup owner ${r.skuId} — absent from skus`,
      );
    }
  }

  const rows = projectFrozenInstructions(
    bundle.data.costing,
    (skuId) => known.get(skuId) === "leaf",
  );
  if (rows.length === 0) quotesWithNone++;
  instructions += rows.length;

  for (const i of rows) {
    byTreatment.set(i.treatment, (byTreatment.get(i.treatment) ?? 0) + 1);
    if (i.treatmentSource === "election") electedRows++;
    if (i.treatmentSource === "legacy" && i.amortizedPerUnit !== null) {
      legacyWithBasis++;
      console.log(
        `  ${q.quote_id}  LEGACY ROW CARRIES A BASIS — ${i.chargeKey} @ ${i.amortizedPerUnit}`,
      );
    }
  }
}

console.log(`\n  instructions projected      ${instructions}`);
console.log(`  quotes projecting none      ${quotesWithNone}`);
console.log(`  elected rows                ${electedRows}`);
console.log(
  `  by treatment                ${[...byTreatment].map(([k, v]) => `${k}=${v}`).join("  ")}`,
);
console.log(`  unresolved rollup owners    ${unresolvedOwners}`);
console.log(`  legacy rows with a basis    ${legacyWithBasis}`);

if (instructions === 0) {
  failures.push(
    "no instruction projected from any quote — an elections-keyed freeze would look identical",
  );
}
if (unresolvedOwners > 0) {
  failures.push(
    `${unresolvedOwners} rollup owners unresolved — those charges would vanish from the record silently`,
  );
}
if (legacyWithBasis > 0) {
  failures.push(
    `${legacyWithBasis} legacy rows carry a per-unit basis the adjustment moves`,
  );
}

// ── PHASE 2 · WILL THE DATABASE TAKE IT? ───────────────────────────────
//
// Not answerable from the model. `.notNull()` is a DECLARATION; the 0066
// outage is what happens when it is read as a check — a column omitted from a
// typed insert literal was simply absent, Postgres supplied NULL, and it
// succeeded on every attach until a migration made the database agree.
//
// So the write is PERFORMED and rolled back. Rolled back because a send must
// not be simulated on a live quote; performed because reading the action layer
// establishes nothing about what Postgres will accept.

const snap = (await db.execute(sql`
  select s.id::text as snapshot_id, s.quote_id::text as quote_id
    from quote_snapshots s order by s.created_at desc limit 1
`)) as unknown as { snapshot_id: string; quote_id: string }[];

if (snap.length === 0) {
  failures.push("no snapshot exists to test the write against");
} else {
  const tier = (await db.execute(sql`
    select id::text as tier_id from quote_tiers
     where quote_id = ${snap[0].quote_id}::uuid order by sort_order limit 1
  `)) as unknown as { tier_id: string }[];

  if (tier.length === 0) {
    failures.push("the newest snapshot's quote has no tier — cannot exercise the FK");
  } else {
    const SNAP = snap[0].snapshot_id;
    const TIER = tier[0].tier_id;
    try {
      await db.transaction(async (tx) => {
        // The amortized shape: a $0 invoice line beside a non-zero recovery,
        // which is the divergence the whole record exists to carry.
        await tx.execute(sql`
          insert into quote_snapshot_recovery_instructions
            (quote_snapshot_id, charge_key, owner_ref, tier_id, treatment,
             treatment_source, cost, governed_recovery, separate_invoice_amount,
             amortized_per_unit, tier_quantity)
          values (${SNAP}::uuid, 'project_setup', 'certify-elected',
                  ${TIER}::uuid, 'unit_price', 'election',
                  '1000.00', '1400.00', '0.00', '0.140000', 10000)
        `);
        // The legacy shape: no basis at all, which must store as NULL rather
        // than be coerced to a zero a reader would act on.
        await tx.execute(sql`
          insert into quote_snapshot_recovery_instructions
            (quote_snapshot_id, charge_key, owner_ref, tier_id, treatment,
             treatment_source, cost, governed_recovery, separate_invoice_amount,
             amortized_per_unit, tier_quantity)
          values (${SNAP}::uuid, 'project_setup', 'certify-legacy',
                  ${TIER}::uuid, 'unit_price', 'legacy',
                  '1000.00', '1400.00', '0.00', null, null)
        `);

        const back = (await tx.execute(sql`
          select owner_ref, treatment_source,
                 separate_invoice_amount::float8 as sia,
                 amortized_per_unit::float8 as apu, tier_quantity
            from quote_snapshot_recovery_instructions
           where quote_snapshot_id = ${SNAP}::uuid
             and owner_ref like 'certify-%'
           order by owner_ref
        `)) as unknown as {
          owner_ref: string;
          treatment_source: string;
          sia: number | null;
          apu: number | null;
          tier_quantity: number | null;
        }[];

        console.log(`\n  write accepted; read back inside the transaction:`);
        for (const b of back) {
          console.log(
            `    ${b.owner_ref.padEnd(16)} ${b.treatment_source.padEnd(9)} invoice=${b.sia}  perUnit=${b.apu}  qty=${b.tier_quantity}`,
          );
        }
        if (back.length !== 2) failures.push(`expected 2 rows back, got ${back.length}`);

        // The distinction has to survive the ROUND TRIP, not just the insert.
        const legacy = back.find((b) => b.owner_ref === "certify-legacy");
        if (legacy === undefined) failures.push("the legacy row did not come back");
        else {
          if (legacy.apu !== null) failures.push("a NULL basis came back as a number");
          if (legacy.tier_quantity !== null) failures.push("a NULL quantity came back as a number");
          if (legacy.sia !== 0) failures.push("the $0 invoice instruction came back as something else");
        }

        // And the uniqueness constraint has to actually refuse a duplicate, or
        // one charge on one owner could carry two contradictory treatments.
        let refused = false;
        try {
          await tx.execute(sql`
            insert into quote_snapshot_recovery_instructions
              (quote_snapshot_id, charge_key, owner_ref, tier_id, treatment,
               treatment_source, cost)
            values (${SNAP}::uuid, 'project_setup', 'certify-elected',
                    ${TIER}::uuid, 'separate_line', 'election', '1000.00')
          `);
        } catch {
          refused = true;
        }
        if (!refused) {
          failures.push(
            "a duplicate (snapshot, charge, owner, tier) was accepted — one charge could carry two treatments",
          );
        }

        throw new Error("ROLLBACK");
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "ROLLBACK") {
        failures.push(
          `the database refused the instruction write: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}

const left = (await db.execute(sql`
  select count(*)::int as n from quote_snapshot_recovery_instructions
   where owner_ref like 'certify-%'
`)) as unknown as { n: number }[];
console.log(`  rows left behind after rollback  ${left[0].n}`);
if (left[0].n !== 0) failures.push(`the rollback left ${left[0].n} rows behind`);

console.log(
  failures.length === 0
    ? `\nPASS — covers legacy placements, resolves every owner, states no basis it cannot fix, and the database accepts it\n`
    : `\nFAIL\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
