/**
 * Does NetSuite honour an explicitly supplied line AMOUNT, or does it always
 * recompute it from quantity x rate?
 *
 * Nexus has never asked. `mark-complete.ts` sends only `quantity` and `rate`
 * (`:1022`, `:1053`, `:1343`), and REG-4's `checkLinkB` states the premise
 * outright — "NetSuite computes amount as quantity x rate". The publication
 * guard that refused DPS-1073 rests entirely on that premise, so the premise
 * needs evidence rather than repetition.
 *
 * ── THE EXPERIMENT ──────────────────────────────────────────────────────
 *
 * ONE disposable Sales Order in the SANDBOX, against the certification
 * customer, carrying three lines that answer everything in one transaction:
 *
 *   L1  qty 2100  rate 6.00633810  amount 12613.31  <- the refused case, with
 *                                                      an explicit amount
 *   L2  qty 2100  rate 6.00633810  (no amount)      <- baseline: what does
 *                                                      NetSuite compute?
 *   L3  qty 1000  rate 6.00000000  amount 6000.00   <- representable control
 *
 * L1 is the exact case `commercial-freeze.ts` refused: 2100 x 6.00633810 =
 * 12613.31001000, not 12613.31.
 *
 * Read back THREE ways, because a single reader can be wrong about what was
 * stored: REST record, SuiteQL over `transactionline`, and the order total.
 *
 * A Sales Order is non-posting — it does not reach the GL until fulfilment —
 * which is why it is the right instrument here.
 *
 * NOT DPS-1073. This transaction is disposable and exists only to answer the
 * question; the certification fixture is untouched.
 */

import {
  createRecord,
  getRecord,
  suiteQL,
  describeNetsuiteTarget,
} from "@/lib/netsuite/client";

const CUSTOMER = "388800"; // ZZ-VALIDATION certification customer
const ITEM = "76155"; // TRN-PP-BOTTLE-30

const target = describeNetsuiteTarget();
console.log("TARGET", JSON.stringify(target));
if (!target.accountIsSandbox) {
  console.log("\nREFUSED — not a sandbox account. This writes a record.");
  process.exit(1);
}

// ── the three lines ─────────────────────────────────────────────────────
const lines: { label: string; item: { id: string }; quantity: number; rate: number; amount?: number }[] = [
  {
    label: "L1 non-representable, amount SUPPLIED",
    item: { id: ITEM },
    quantity: 2100,
    rate: 6.0063381,
    amount: 12613.31,
  },
  {
    label: "L2 non-representable, amount OMITTED (baseline)",
    item: { id: ITEM },
    quantity: 2100,
    rate: 6.0063381,
  },
  {
    label: "L3 representable control, amount SUPPLIED",
    item: { id: ITEM },
    quantity: 1000,
    rate: 6.0,
    amount: 6000.0,
  },
];

console.log("\n── SENDING ────────────────────────────────────────────────");
for (const l of lines) {
  console.log(
    `  ${l.label}\n      qty=${l.quantity} rate=${l.rate}` +
      (l.amount === undefined ? " amount=<omitted>" : ` amount=${String(l.amount)}`),
  );
}
console.log(
  "\n  expected if NetSuite recomputes: L1 amount becomes 12613.31 (rounded)\n" +
    "  or 12613.310010; if it HONOURS the supplied amount, L1 stays 12613.31\n" +
    "  while L2 shows whatever NetSuite computes for the same qty x rate.",
);

const created = await createRecord({
  recordType: "salesOrder",
  body: {
    entity: { id: CUSTOMER },
    memo: "DISPOSABLE — line amount authority probe. Safe to delete.",
    item: {
      items: lines.map(({ label: _label, ...rest }) => rest),
    },
  },
});

const soId = created.internalId;
console.log(`\n  created Sales Order internalId=${soId}`);

// ── READBACK 1 · REST record ────────────────────────────────────────────
console.log("\n── READBACK 1 · REST record ───────────────────────────────");
const rec = await getRecord<Record<string, unknown>>(
  "salesOrder",
  `${String(soId)}?expandSubResources=true`,
);
const items = (rec as { item?: { items?: Record<string, unknown>[] } }).item?.items ?? [];
for (const [i, it] of items.entries()) {
  console.log(
    `  line ${i + 1}  qty=${String(it.quantity)}  rate=${String(it.rate)}  amount=${String(it.amount)}`,
  );
}
console.log(`  order subtotal=${String(rec.subtotal)}  total=${String(rec.total)}`);

// ── READBACK 2 · SuiteQL over transactionline ───────────────────────────
console.log("\n── READBACK 2 · SuiteQL transactionline ───────────────────");
const tl = await suiteQL<Record<string, unknown>>(
  `select linesequencenumber, quantity, rate, netamount, foreignamount
     from transactionline
    where transaction = ${soId} and mainline = 'F' and taxline = 'F'
    order by linesequencenumber`,
);
for (const r of tl.items) {
  console.log(
    `  seq=${String(r.linesequencenumber)}  qty=${String(r.quantity)}  rate=${String(r.rate)}` +
      `  netamount=${String(r.netamount)}  foreignamount=${String(r.foreignamount)}`,
  );
}

// ── VERDICT ─────────────────────────────────────────────────────────────
console.log("\n── VERDICT ────────────────────────────────────────────────");
const l1 = items[0] as { rate?: unknown; amount?: unknown } | undefined;
const l2 = items[1] as { amount?: unknown } | undefined;
if (l1) {
  const amt = Number(l1.amount);
  const honoured = Math.abs(amt - 12613.31) < 0.000001;
  console.log(
    `  L1 amount stored as ${String(l1.amount)} — supplied amount was ${honoured ? "HONOURED" : "NOT honoured"}`,
  );
  console.log(`  L1 rate stored as ${String(l1.rate)} — rate was ${Math.abs(Number(l1.rate) - 6.0063381) < 1e-9 ? "preserved" : "REWRITTEN"}`);
}
if (l2) console.log(`  L2 (amount omitted) computed as ${String(l2.amount)}`);
console.log(
  `\n  DISPOSABLE record internalId=${soId} — delete it in the sandbox UI when done.`,
);

process.exit(0);
