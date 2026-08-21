/**
 * #321 F-1 — is the fix DISCRIMINATING?
 *
 * Runs the OLD gate and the NEW behaviour against the same real fixture, both
 * inside a transaction that is ROLLED BACK, so the Case 1 witness (`cfa7b84d`)
 * is never mutated. A test that passes on both implementations certifies
 * nothing, so this proves the old one FAILS before the new one is accepted.
 *
 * The simulation is faithful to the sequence in `applyTierPreset`: delete the
 * tiers (cascading `assembly_leaf_inputs`), insert replacements, then decide
 * whether to materialize.
 *   OLD: gate on `preservedLines` built via INNER JOIN assembly_leaves
 *   NEW: no ownership gate; call the canonical idempotent materializer
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { materializePackagingRows } from "@/lib/packaging-materialization";

const FIXTURES = [
  ["Direct-only    (cfa7b84d)", "cfa7b84d-18fb-4ef0-9bba-ce2a44cd266c"],
  ["Grouped-only   (52bd0077)", "52bd0077-20af-4345-8856-45003bfca8b3"],
  ["Mixed          (4781e4bb)", "4781e4bb-0597-4044-a1ea-3ffc8c3be35a"],
] as const;

type Row = Record<string, string>;
const rows = <T,>(r: unknown) => r as unknown as T[];

async function simulate(quoteId: string, mode: "old" | "new") {
  let out = { gate: 0, seeded: 0, rowsAfter: 0, dupes: 0 };
  try {
    await db.transaction(async (tx) => {
      // snapshot tier shape, then replace tiers exactly as applyTierPreset does
      const tiers = rows<Row>(await tx.execute(sql.raw(
        `select label, qty::text qty, sort_order::text so from quote_tiers
          where quote_id='${quoteId}' order by sort_order`)));

      // OLD gate is computed BEFORE the delete, as in the real code
      const legacy = rows<Row>(await tx.execute(sql.raw(
        `select distinct i.line_group_id from assembly_leaf_inputs i
           join assembly_leaves al on al.id = i.assembly_leaf_id
           join assemblies a on a.id = al.assembly_id
          where a.quote_id='${quoteId}'`)));
      out.gate = legacy.length;

      await tx.execute(sql.raw(`delete from quote_tiers where quote_id='${quoteId}'`));
      for (const t of tiers) {
        await tx.execute(sql.raw(
          `insert into quote_tiers (quote_id, label, qty, sort_order)
           values ('${quoteId}', '${t.label.replace(/'/g, "''")}', ${t.qty}, ${t.so})`));
      }

      if (mode === "new" || out.gate > 0) {
        const s = await materializePackagingRows(tx as never, quoteId);
        out.seeded = s.inserted;
        // idempotency: a second call must add nothing
        const again = await materializePackagingRows(tx as never, quoteId);
        out.dupes = again.inserted;
      }

      const after = rows<Row>(await tx.execute(sql.raw(
        `select count(*) n from assembly_leaf_inputs i
           join quote_leaves ql on ql.id = i.quote_leaf_id
          where ql.quote_id='${quoteId}'`)));
      out.rowsAfter = Number(after[0].n);

      throw new Error("__rollback__");
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__rollback__") throw e;
  }
  return out;
}

async function main() {
  console.log("fixture                     mode   gate  seeded  rowsAfter  2ndCall");
  for (const [label, q] of FIXTURES) {
    for (const mode of ["old", "new"] as const) {
      const r = await simulate(q, mode);
      const flag = mode === "old" && r.rowsAfter === 0 ? "   <- OLD FAILS" : "";
      console.log(`${label}  ${mode.padEnd(5)}  ${String(r.gate).padStart(4)}  ${String(r.seeded).padStart(6)}  ${String(r.rowsAfter).padStart(9)}  ${String(r.dupes).padStart(7)}${flag}`);
    }
  }
  // nothing persisted
  const chk = rows<Row>(await db.execute(sql.raw(
    `select count(*) n from assembly_leaf_inputs i join quote_leaves ql on ql.id=i.quote_leaf_id
      where ql.quote_id='cfa7b84d-18fb-4ef0-9bba-ce2a44cd266c'`)));
  console.log(`\nwitness untouched after rollback: cfa7b84d packaging rows = ${chk[0].n}`);
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
