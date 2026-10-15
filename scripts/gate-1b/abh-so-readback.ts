/**
 * ABH retry — provider-side verification of SO2724. READ-ONLY.
 *
 * Reads back what NetSuite ACTUALLY stored and ACTUALLY computed, and compares
 * it to the frozen matrix. Nexus's own view is not evidence about the provider;
 * only the provider's numbers are.
 *
 * `transactionline.netamount` is stored NEGATIVE for these lines — handled
 * explicitly, because ignoring it produced five false MISMATCH verdicts during
 * the precision probe.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { suiteQL } from "@/lib/netsuite/client";

const SO_INTERNAL_ID = "363041";
const QUOTE_ID = "cfa7b84d-18fb-4ef0-9bba-ce2a44cd266c";

async function main() {
  const frozen = (await db.execute(
    sql.raw(`
      select l.display_name name, t.quantity qty,
             t.unit_rate::text rate, t.line_amount::text amount
        from quote_snapshot_line_tiers t
        join quote_snapshot_lines l on l.id = t.quote_snapshot_line_id
        join quote_snapshots s on s.id = l.quote_snapshot_id
        join quotes q on q.id = s.quote_id
       where s.quote_id = '${QUOTE_ID}'
         and t.pricing_state = 'priced'
         and t.tier_id = q.accepted_tier_id
       order by l.position`),
  )) as unknown as Array<{ name: string; qty: number; rate: string; amount: string }>;

  const ns = ((await suiteQL(`
    select tl.linesequencenumber ln, tl.memo, abs(tl.quantity) qty,
           TO_CHAR(tl.rate, 'FM99999999990.99999999') rate_s,
           TO_CHAR(abs(tl.netamount), 'FM99999999990.99') net_s
      from transactionline tl
     where tl.transaction = ${SO_INTERNAL_ID}
       and tl.mainline = 'F' and tl.taxline = 'F'
     order by tl.linesequencenumber`)) as { items?: Array<Record<string, string>> })
    .items ?? [];

  const total = ((await suiteQL(
    `select tranid, TO_CHAR(foreigntotal,'FM99999999990.99') tot from transaction where id = ${SO_INTERNAL_ID}`,
  )) as { items?: Array<Record<string, string>> }).items?.[0];

  console.log(`NetSuite ${total?.tranid} (internal ${SO_INTERNAL_ID}) — provider readback\n`);
  console.log("NetSuite line                  |    qty | NS rate      | NS amount  | frozen amt | verdict");
  console.log("-".repeat(96));

  let exact = 0;
  let nsSum = 0;
  for (const [i, r] of ns.entries()) {
    const f = frozen[i];
    const nsAmt = Number(r.net_s);
    nsSum += Math.round(nsAmt * 100);
    // NetSuite's OWN multiplication, recomputed from what it stored.
    const product = Math.round(Number(r.rate_s) * Number(r.qty) * 100);
    const frozenCents = f ? Math.round(Number(f.amount) * 100) : NaN;
    // The rate NetSuite holds is NOT compared to the stored `unit_rate`, and
    // must not be. This quote was frozen by the OLD 4dp writer, so its stored
    // rate is the stale 3.05030000 the repair exists to bypass — the posted
    // rate is DERIVED from the accepted amount instead. Asserting equality
    // against the stored rate tests the defect, not the fix.
    //
    // The three properties that matter, all against the frozen AMOUNT:
    const ok =
      f !== undefined &&
      Math.round(nsAmt * 100) === frozenCents && // NetSuite's amount is the accepted one
      product === frozenCents; // and its own qty x rate reproduces it
    if (ok) exact++;
    console.log(
      `${String(r.memo ?? "").slice(0, 30).padEnd(30)} | ${String(r.qty).padStart(6)} | ` +
        `${String(r.rate_s).padEnd(12)} | ${String(nsAmt).padStart(10)} | ` +
        `${(f?.amount ?? "-").padStart(10)} | ${ok ? "EXACT" : "DRIFT"}`,
    );
  }

  const frozenSum = frozen.reduce((a, f) => a + Math.round(Number(f.amount) * 100), 0);
  console.log(`\nNetSuite line sum : ${(nsSum / 100).toFixed(2)}`);
  console.log(`frozen line sum   : ${(frozenSum / 100).toFixed(2)}`);
  console.log(`NetSuite SO total : ${total?.tot}`);
  console.log(`lines exact       : ${exact} / ${ns.length}`);

  const pass =
    exact === ns.length && ns.length === frozen.length && nsSum === frozenSum;
  console.log(
    `\nVERDICT: ${
      pass
        ? "EXACT — every NetSuite line reproduces its frozen amount, and the order sums to the frozen total. No REG-4 drift."
        : "DRIFT — see above."
    }`,
  );
  process.exit(pass ? 0 : 1);
}

void main();
