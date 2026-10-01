/**
 * Order 2 · the production certification of the corrected representability
 * contract.
 *
 * Reads the ACTUAL Sales Order out of NetSuite and reconciles it against the
 * FROZEN accepted artifact — never against the emitter's own output, which
 * would only prove the emitter agrees with itself.
 *
 * The load-bearing assertion, per the corrected contract:
 *
 *     frozen accepted cents === ROUND_HALF_UP(stored quantity x stored rate, 2)
 *
 * NOT the old exact-product invariant. At least one 2,100-unit line must be
 * covered, because that is the shape the previous rule refused: 2,100 units at
 * 6.00633810 has an exact product of 12613.31001000 and the provider stores
 * 12613.31.
 *
 * Three readers, because one can be wrong about what is stored: the REST
 * record's header total, SuiteQL over `transactionline` for the stored rows,
 * and the transaction's own foreign total.
 *
 * ── TAX ──────────────────────────────────────────────────────────────────
 *
 * Asserted here rather than measured separately, because "the total equals the
 * frozen amount" is only true while tax is zero — and NetSuite defaults this
 * customer's lines to CA_CA at 6%.
 *
 * `tax-policy.ts` is the governing rule: every Sales Order Nexus creates is
 * NON-TAXABLE. Nexus sends no tax authority; `markComplete` patches every line
 * to `-8` after NetSuite has built the order, and fails closed if any taxable
 * line remains. This checks the OUTCOME of that policy on the real record, so
 * a silent regression in the patch would surface as a certification failure
 * rather than as a grand total nobody re-read.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getRecord, suiteQL, describeNetsuiteTarget } from "@/lib/netsuite/client";
import {
  postedAmountCents,
  centsToDecimal,
  POSTED_RATE_SCALE,
} from "@/lib/netsuite/posted-amount";

const QUOTE = "c555a868-dabe-416a-b853-13ef7c770469";
const rows = <T,>(r: unknown) => r as unknown as T[];

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

const scaledRate = (rate: string | number): bigint => {
  const [w, f = ""] = String(rate).split(".");
  const neg = w.startsWith("-");
  const whole = BigInt(neg ? w.slice(1) : w);
  const v = whole * 10n ** BigInt(POSTED_RATE_SCALE) +
    BigInt((f + "0".repeat(POSTED_RATE_SCALE)).slice(0, POSTED_RATE_SCALE));
  return neg ? -v : v;
};

console.log("TARGET", JSON.stringify(describeNetsuiteTarget()));

// ── the Nexus side: quote, accepted tier, frozen lines ──────────────────
const q = rows<{
  quote_number: string;
  status: string;
  netsuite_so_id: string | null;
  netsuite_so_tranid: string | null;
  accepted_tier_id: string | null;
}>(
  await db.execute(sql`
    select quote_number, status, netsuite_so_id, netsuite_so_tranid, accepted_tier_id
      from quotes where id = ${QUOTE}::uuid`),
)[0];

console.log(`\nQUOTE ${q.quote_number} · ${q.status} · SO ${q.netsuite_so_tranid ?? "—"} (${q.netsuite_so_id ?? "—"})`);

console.log("\n── LIFECYCLE ──────────────────────────────────────────────");
check(q.status === "complete", "quote reached complete", q.status);
check(q.netsuite_so_id !== null, "sales order id recorded", q.netsuite_so_id ?? "null");
check(q.accepted_tier_id !== null, "accepted tier recorded post-push");

const frozen = rows<{
  display_name: string;
  tier_label: string;
  quantity: number;
  unit_rate: string;
  line_amount: string;
}>(
  await db.execute(sql`
    select l.display_name, t.tier_label, t.quantity, t.unit_rate, t.line_amount
      from quote_snapshot_lines l
      join quote_snapshot_line_tiers t on t.quote_snapshot_line_id = l.id
      join quote_tiers qt on qt.id = t.tier_id
     where l.quote_snapshot_id in (select id from quote_snapshots where quote_id = ${QUOTE}::uuid)
       and qt.id = ${q.accepted_tier_id}::uuid
       and t.pricing_state = 'priced'
     order by l.position`),
);

// ── the NetSuite side ───────────────────────────────────────────────────
const SO = String(q.netsuite_so_id);
const rec = await getRecord<Record<string, unknown>>("salesOrder", SO);
const stored = rows<{
  seq: number;
  quantity: string;
  rate: string;
  foreignamount: string;
  item: string;
  itemtype: string;
}>(
  await suiteQL(
    `select tl.linesequencenumber seq, tl.quantity, tl.rate, tl.foreignamount,
            i.itemid item, i.itemtype itemtype
       from transactionline tl
       join item i on i.id = tl.item
      where tl.transaction = ${SO} and tl.mainline = 'F' and tl.taxline = 'F'
      order by tl.linesequencenumber`,
  ).then((r) => r.items),
);

console.log("\n── STORED IN NETSUITE ─────────────────────────────────────");
for (const r of stored) {
  console.log(
    `  ${String(r.item).padEnd(20)} qty ${String(Math.abs(Number(r.quantity))).padStart(6)}` +
      `  rate ${String(r.rate).padEnd(14)} amount ${Math.abs(Number(r.foreignamount)).toFixed(2)}`,
  );
}

// ── THE CONTRACT, line by line ──────────────────────────────────────────
console.log("\n── PROVIDER CONTRACT, per stored line ─────────────────────");
console.log("  frozen cents === ROUND_HALF_UP(stored qty x stored rate, 2)\n");

let covered2100 = 0;
for (const r of stored) {
  const qty = BigInt(Math.abs(Math.trunc(Number(r.quantity))));
  const amount = Math.abs(Number(r.foreignamount));
  const recomputed = postedAmountCents(scaledRate(r.rate), qty);
  const storedCents = BigInt(Math.round(amount * 100));

  // 1 · NetSuite's own stored amount IS the half-up product of its own
  //     stored quantity and rate. This is the provider contract, verified on
  //     the provider's data rather than on ours.
  check(
    recomputed === storedCents,
    `${String(r.item).padEnd(20)} ${qty} x ${r.rate}`,
    `-> ${centsToDecimal(recomputed)} vs stored ${amount.toFixed(2)}`,
  );

  // 2 · and that value is the FROZEN accepted amount.
  const match = frozen.find((f) => Math.abs(Number(f.line_amount) - amount) < 0.005);
  check(match !== undefined, `    ...matches a frozen accepted line`, amount.toFixed(2));

  if (qty === 2100n) covered2100++;
}
check(covered2100 > 0, "at least one 2,100-unit line covered", `${covered2100} line(s)`);

// ── totals, three ways ──────────────────────────────────────────────────
console.log("\n── TOTALS ─────────────────────────────────────────────────");
const frozenSum = frozen.reduce((a, f) => a + Math.round(Number(f.line_amount) * 100), 0);
const storedSum = stored.reduce(
  (a, r) => a + Math.round(Math.abs(Number(r.foreignamount)) * 100),
  0,
);
check(storedSum === frozenSum, "stored line sum === frozen accepted sum",
  `${(storedSum / 100).toFixed(2)} vs ${(frozenSum / 100).toFixed(2)}`);

const main = rows<{ foreigntotal: string }>(
  await suiteQL(`select foreigntotal from transaction where id = ${SO}`).then((r) => r.items),
);
check(
  Math.round(Number(main[0]?.foreigntotal) * 100) === frozenSum,
  "transaction foreigntotal === frozen accepted sum",
  `${Number(main[0]?.foreigntotal).toFixed(2)}`,
);
check(
  Math.round(Number(rec.total) * 100) === frozenSum,
  "REST record total === frozen accepted sum",
  `${Number(rec.total).toFixed(2)}`,
);

// ── tax · the governed rule, checked on the real record ─────────────────
console.log("\n── TAX (tax-policy.ts: every Nexus SO is NON-TAXABLE) ─────");
const taxTotal = Number(rec.taxTotal ?? 0);
check(Math.abs(taxTotal) < 0.005, "taxTotal is 0.00", taxTotal.toFixed(2));
check(
  Math.round(Number(rec.total) * 100) === Math.round(Number(rec.subtotal) * 100),
  "total === subtotal — no tax rides on the grand total",
  `${Number(rec.total).toFixed(2)} vs ${Number(rec.subtotal).toFixed(2)}`,
);
check(
  Math.round(Number(rec.subtotal) * 100) === frozenSum,
  "subtotal === frozen accepted consideration",
  `${Number(rec.subtotal).toFixed(2)}`,
);

// Line codes read from NetSuite, not inferred from the totals being zero: a
// zero tax total with a taxable code present would be a different, worse
// state than a zero total with every line governed.
const codes = rows<{ c: string | null }>(
  await suiteQL(
    `select distinct tl.taxcode c from transactionline tl
      where tl.transaction = ${SO} and tl.mainline = 'F'`,
  ).then((r) => r.items),
).map((r) => String(r.c ?? "null"));
const GOVERNED_NON_TAXABLE = new Set(["-8", "-7"]);
check(
  codes.every((c) => GOVERNED_NON_TAXABLE.has(c)),
  "every line carries a governed non-taxable code",
  codes.sort().join(",") + "  (-8 Not Taxable, -7 non-taxable; -519 would be CA_CA 6%)",
);

// ── structure ───────────────────────────────────────────────────────────
console.log("\n── STRUCTURE ──────────────────────────────────────────────");
check(stored.length === frozen.length, "one stored line per frozen line",
  `${stored.length} vs ${frozen.length}`);
const dupes = stored.length - new Set(stored.map((r) => r.seq)).size;
check(dupes === 0, "no line appears twice");
// Tested on the item TYPE, not the item code.
//
// A first attempt asserted "no item id beginning IGP-", which FAILED on
// correct data: IGP-0001 is the Item Group COMMERCIAL line established by
// #523 — the finished good's own economics, resolving through
// `item_group_production` — and it is supposed to be there. A Group SPAN is a
// different object: a `Group`-type line, whose members NetSuite expands and
// whose EndGroup rolls up. Conflating the two would have reported a defect on
// a correct order.
check(
  !stored.some((r) => String(r.itemtype).toLowerCase().includes("group")),
  "no Item Group SPAN — DPS-1073 is itemized, and OD-004 forbids grouping it",
  stored.map((r) => r.itemtype).join(", "),
);
check(
  stored.some((r) => String(r.item) === "IGP-0001"),
  "the Item Group COMMERCIAL line IS present (#523)",
);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
