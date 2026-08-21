/**
  * Live proof on the refused ABH witness. READ-ONLY evidence artifact.
 *
 * Reads the ABH frozen rows AS THEY STAND (4dp, written by the old writer),
 * applies the push-side derivation, and runs REG-4's own link-B check on the
 * result. Old rate and derived rate are both checked, so the report shows a
 * failure and a pass rather than only the outcome being argued for.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { derivePostedRate } from "@/lib/commercial-rate";
import { checkLinkB } from "@/lib/netsuite/reg4";

const rows = (await db.execute(
  sql.raw(`
    select l.display_name name, t.tier_label tier, t.quantity qty,
           t.unit_rate::text stored_rate, t.line_amount::text amount
      from quote_snapshot_line_tiers t
      join quote_snapshot_lines l on l.id = t.quote_snapshot_line_id
      join quote_snapshots s on s.id = l.quote_snapshot_id
     where s.quote_id = 'cfa7b84d-18fb-4ef0-9bba-ce2a44cd266c'
       and t.pricing_state = 'priced'
     order by l.position, t.tier_label`),
)) as unknown as Array<{
  name: string;
  tier: string;
  qty: number;
  stored_rate: string;
  amount: string;
}>;

const cents = (a: string) => Math.round(Number(a) * 100);
let oldFailures = 0;
let newPasses = 0;

console.log("ABH — Neoprene Bag · quote cfa7b84d (accepted, send refused)\n");
console.log(
  "tier | qty    | stored rate  | OLD verdict | derived rate  | NEW verdict",
);
console.log("-".repeat(78));

for (const r of rows) {
  const base = {
    sourceLineId: "x",
    description: r.name,
    quantity: r.qty,
    amount: r.amount,
  };
  const oldFail = checkLinkB([{ ...base, rate: r.stored_rate }], cents(r.amount));
  const derived = derivePostedRate(r.amount, r.qty);
  const newFail = derived.ok
    ? checkLinkB([{ ...base, rate: derived.rate }], cents(r.amount))
    : [{ kind: "underivable" }];

  if (oldFail.length > 0) oldFailures++;
  if (newFail.length === 0) newPasses++;

  console.log(
    `${r.tier.padEnd(4)} | ${String(r.qty).padStart(6)} | ${r.stored_rate.padEnd(12)} | ` +
      `${(oldFail.length > 0 ? "REFUSED" : "pass").padEnd(11)} | ` +
      `${(derived.ok ? derived.rate : "-").padEnd(13)} | ` +
      `${newFail.length === 0 ? "EXACT" : "REFUSED"}`,
  );
}

console.log(`\nrows                 : ${rows.length}`);
console.log(`refused before repair: ${oldFailures}`);
console.log(`exact after repair   : ${newPasses}`);
console.log(
  `\nVERDICT: ${
    oldFailures > 0 && newPasses === rows.length
      ? "the witness failed on the old behaviour and reproduces every accepted amount exactly after the repair."
      : "INDETERMINATE — the regression did not demonstrate both halves."
  }`,
);
process.exit(0);
