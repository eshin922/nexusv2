/**
 * NetSuite computes the line amount from quantity x rate — probe 1 (SO2731)
 * established that, and that a supplied amount is ignored. This probe asks the
 * question that actually decides the disposition:
 *
 *     WHAT does it do with the sub-cent remainder?
 *
 * Probe 1 sent 2100 x 6.0063381, whose exact product is 12613.31001000, and
 * NetSuite stored 12613.31. So it did NOT keep the residue. But one data point
 * cannot distinguish ROUNDING from TRUNCATION, because that residue (0.00001)
 * discards to the same cent either way.
 *
 * These lines discriminate:
 *
 *   L1  qty 1000  rate 0.00000900  exact 0.00900   round -> 0.01   trunc -> 0.00
 *   L2  qty 1000  rate 0.00000400  exact 0.00400   round -> 0.00   trunc -> 0.00
 *   L3  qty 1000  rate 0.00000500  exact 0.00500   the half-way case
 *   L4  qty 1000  rate 0.00001500  exact 0.01500   half-up -> 0.02, half-even -> 0.02
 *   L5  qty 1000  rate 0.00002500  exact 0.02500   half-up -> 0.03, half-even -> 0.02
 *
 * L1 separates rounding from truncation. L3/L4/L5 separate half-up from
 * half-even, which matters because a rule that rounds ties differently from
 * Nexus would put the two systems a cent apart on exactly the lines a relaxed
 * guard would newly admit.
 *
 * Disposable sandbox Sales Order. Not DPS-1073.
 *
 * Goes through `createProbeSalesOrder` so the artifact carries the governed
 * `-8 · Not Taxable` line code. A diagnostic must not manufacture a taxable
 * order under the certification customer — see that helper.
 */

import { suiteQL, describeNetsuiteTarget } from "@/lib/netsuite/client";
import { createProbeSalesOrder } from "./probe-sales-order";

const CUSTOMER = "388800";
const ITEM = "76155";

const target = describeNetsuiteTarget();
console.log("TARGET", JSON.stringify(target));
if (!target.accountIsSandbox) {
  console.log("REFUSED — not a sandbox account.");
  process.exit(1);
}

const CASES = [
  { rate: 0.000009, exact: "0.00900", round: "0.01", trunc: "0.00" },
  { rate: 0.000004, exact: "0.00400", round: "0.00", trunc: "0.00" },
  { rate: 0.000005, exact: "0.00500", round: "0.01 (half-up)", trunc: "0.00" },
  { rate: 0.000015, exact: "0.01500", round: "0.02", trunc: "0.01" },
  { rate: 0.000025, exact: "0.02500", round: "0.03 half-up / 0.02 half-even", trunc: "0.02" },
];

console.log("\n── SENDING ────────────────────────────────────────────────");
CASES.forEach((c, i) =>
  console.log(
    `  L${i + 1}  qty 1000 x ${c.rate.toFixed(8)} = ${c.exact}  ` +
      `round->${c.round}  trunc->${c.trunc}`,
  ),
);

const created = await createProbeSalesOrder({
  customerId: CUSTOMER,
  memo: "DISPOSABLE — sub-cent rounding rule probe. Safe to delete.",
  lines: CASES.map((c) => ({ itemId: ITEM, quantity: 1000, rate: c.rate })),
});

const SO = created.internalId;
console.log(`\n  created Sales Order internalId=${SO}`);

const tl = await suiteQL<Record<string, unknown>>(
  `select linesequencenumber seq, quantity, rate, foreignamount
     from transactionline
    where transaction = ${SO} and mainline = 'F' and taxline = 'F'
    order by linesequencenumber`,
);

console.log("\n── STORED ─────────────────────────────────────────────────");
const stored = new Map<number, number>();
for (const r of tl.items) {
  const amt = Math.abs(Number(r.foreignamount));
  stored.set(Number(r.seq), amt);
  console.log(
    `  seq=${String(r.seq)}  qty=${String(r.quantity)}  rate=${String(r.rate)}  amount=${amt.toFixed(2)}`,
  );
}

console.log("\n── VERDICT ────────────────────────────────────────────────");
const a1 = stored.get(1);
if (a1 !== undefined) {
  console.log(
    a1 === 0.01
      ? "  L1 = 0.01 → NetSuite ROUNDS the sub-cent remainder."
      : a1 === 0
        ? "  L1 = 0.00 → NetSuite TRUNCATES the sub-cent remainder."
        : `  L1 = ${a1} → neither round nor truncate; investigate.`,
  );
}
const a5 = stored.get(5);
if (a5 !== undefined) {
  console.log(
    a5 === 0.03
      ? "  L5 = 0.03 → ties round HALF-UP."
      : a5 === 0.02
        ? "  L5 = 0.02 → ties round HALF-EVEN (or truncate)."
        : `  L5 = ${a5} → unexpected; investigate.`,
  );
}
console.log(`\n  DISPOSABLE record ${SO}. Delete in the sandbox UI when done.`);
process.exit(0);
