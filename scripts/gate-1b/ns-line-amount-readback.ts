/**
 * Readback for the disposable line-amount authority probe (SO internalId
 * supplied as the first argument, default 363641).
 *
 * Three independent readers, because one reader can be wrong about what was
 * stored and agreement between them is the evidence:
 *
 *   1  REST record, sublist expanded
 *   2  SuiteQL over `transactionline` — the stored rows, not a projection
 *   3  the order's own subtotal / total
 *
 * The lines under test, as sent:
 *
 *   L1  qty 2100  rate 6.0063381  amount 12613.31  (explicit, NON-representable)
 *   L2  qty 2100  rate 6.0063381  amount omitted   (baseline)
 *   L3  qty 1000  rate 6.0        amount 6000.00   (explicit, representable)
 *
 * 2100 x 6.00633810 = 12613.31001000, which is why `commercial-freeze.ts`
 * refused DPS-1073.
 */

import { getRecord, suiteQL, describeNetsuiteTarget } from "@/lib/netsuite/client";

const SO = process.argv[2] ?? "363641";
console.log("TARGET", JSON.stringify(describeNetsuiteTarget()));
console.log(`SALES ORDER ${SO}\n`);

console.log("── READBACK 1 · REST record ───────────────────────────────");
const rec = await getRecord<Record<string, unknown>>("salesOrder", SO);
console.log(
  `  tranId=${String(rec.tranId)}  subtotal=${String(rec.subtotal)}  total=${String(rec.total)}`,
);

console.log("\n── READBACK 2 · SuiteQL transactionline (stored rows) ─────");
const tl = await suiteQL<Record<string, unknown>>(
  `select linesequencenumber seq, quantity, rate, rateamount, netamount, foreignamount
     from transactionline
    where transaction = ${SO} and mainline = 'F' and taxline = 'F'
    order by linesequencenumber`,
);
for (const r of tl.items) {
  console.log(
    `  seq=${String(r.seq)}  qty=${String(r.quantity)}  rate=${String(r.rate)}` +
      `  rateamount=${String(r.rateamount)}  netamount=${String(r.netamount)}` +
      `  foreignamount=${String(r.foreignamount)}`,
  );
}

console.log("\n── READBACK 3 · SuiteQL mainline (order total) ────────────");
const main = await suiteQL<Record<string, unknown>>(
  `select foreigntotal, id from transaction where id = ${SO}`,
);
for (const r of main.items) console.log(`  foreigntotal=${String(r.foreigntotal)}`);

console.log("\n── VERDICT ────────────────────────────────────────────────");
const rowsByseq = new Map(tl.items.map((r) => [Number(r.seq), r]));
const l1 = rowsByseq.get(1);
const l2 = rowsByseq.get(2);
const l3 = rowsByseq.get(3);

const amountOf = (r: Record<string, unknown> | undefined) =>
  r === undefined ? null : Math.abs(Number(r.foreignamount ?? r.netamount));

const a1 = amountOf(l1);
const a2 = amountOf(l2);
const a3 = amountOf(l3);

console.log(`  L1 supplied 12613.31, stored ${a1}`);
console.log(`  L2 supplied nothing,  stored ${a2}`);
console.log(`  L3 supplied  6000.00, stored ${a3}`);

if (a1 !== null && a2 !== null) {
  if (Math.abs(a1 - a2) < 1e-9) {
    console.log(
      "\n  L1 == L2 → the supplied amount was IGNORED. NetSuite computes the\n" +
        "  amount from quantity x rate, and REG-4's premise holds.",
    );
  } else {
    console.log(
      "\n  L1 != L2 → the supplied amount was HONOURED. NetSuite stores an\n" +
        "  explicit amount independently of quantity x rate.",
    );
  }
}
if (l1) {
  const rateKept = Math.abs(Number(l1.rate) - 6.0063381) < 1e-9;
  console.log(`  L1 rate stored ${String(l1.rate)} — ${rateKept ? "PRESERVED" : "REWRITTEN"}`);
}
console.log(`\n  DISPOSABLE record ${SO}. Delete in the sandbox UI when done.`);

process.exit(0);
