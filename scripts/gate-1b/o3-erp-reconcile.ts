/**
 * NETSUITE AGAINST THE FROZEN SNAPSHOT — not against the emitter.
 *
 * `o3-certify` proves the ERP's STRUCTURE matches the frozen composition. This
 * proves its ARITHMETIC matches the frozen accepted column, and it does so
 * without consulting the code that produced the order: one side is read from
 * `transactionline` in the sandbox, the other from `quote_snapshot_*` in
 * Postgres, and they are compared. An emitter that computed the wrong number
 * consistently would satisfy a check written against itself.
 *
 * Both are necessary and neither is sufficient. A flat set of member lines
 * summing to the right total reconciles perfectly and misrepresents the
 * accepted structure; a correct structure carrying wrong money is worse.
 *
 * ── SUBJECT B AT THE ERP ────────────────────────────────────────────────
 *
 * The separately-billed charges must appear ONCE each, on their governed
 * items, and the Included ones must not appear at all. `otc_tooling`/OTC-0005
 * is asserted absent by name: it is a real item on a real destination, so a
 * fallback would post the mould there silently rather than failing.
 *
 * READ-ONLY.
 *
 * Usage:  o3-erp-reconcile.ts [quoteNumber]
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

import { suiteQL } from "@/lib/netsuite/client";

const quoteNumber = process.argv[2] ?? "DPS-1074";

const [quote] = (await db.execute(sql`
  SELECT id, netsuite_so_id, netsuite_so_tranid, customer_accepted_tier_id
    FROM quotes WHERE quote_number = ${quoteNumber}
`)) as unknown as Array<Record<string, string | null>>;

if (!quote?.netsuite_so_id) {
  console.log(`UNRESOLVED · ${quoteNumber} has no Sales Order to read back`);
  process.exit(2);
}

const fails: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(56)} ${detail}`);
  if (!ok) fails.push(label);
};

// ── THE FROZEN SIDE ───────────────────────────────────────────────────
const [tierTotal] = (await db.execute(sql`
  SELECT tt.tier_commercial_total::text AS total,
         tt.unit_subtotal::text          AS unit_subtotal,
         tt.otc_subtotal::text           AS otc_subtotal
    FROM quote_snapshot_tier_totals tt
    JOIN quote_snapshots s ON s.id = tt.quote_snapshot_id
   WHERE s.quote_id = ${quote.id}
     AND s.superseded_at IS NULL
     AND tt.tier_id = ${quote.customer_accepted_tier_id}
`)) as unknown as Array<Record<string, string>>;

if (!tierTotal) {
  console.log("INDETERMINATE · no frozen tier total for the accepted tier");
  process.exit(2);
}

// ── THE ERP SIDE ──────────────────────────────────────────────────────
const res: {
  items: Array<Record<string, string | null>>;
} = (await suiteQL(
  `select tl.linesequencenumber seq, tl.itemtype, tl.quantity, tl.rate,
          tl.netamount, tl.taxline, tl.mainline, i.itemid
     from transactionline tl
     left join item i on i.id = tl.item
    where tl.transaction = ${quote.netsuite_so_id}
    order by tl.linesequencenumber`,
)) as never;
const lines = res.items ?? [];

const abs = (v: unknown) => Math.abs(Number(v ?? 0));
const money = (n: number) => n.toFixed(2);

console.log(`SO ${quote.netsuite_so_tranid} (${quote.netsuite_so_id}) · ${quoteNumber}`);
console.log(`FROZEN accepted column · unit ${tierTotal.unit_subtotal} · otc ${tierTotal.otc_subtotal} · total ${tierTotal.total}`);
console.log("");
console.log("RECONCILIATION · NetSuite read back vs the frozen snapshot");

const mainline = lines.find((l) => l.mainline === "T");
const members = lines.filter((l) => l.itemtype === "InvtPart" && l.taxline === "F");
const accounting = lines.filter((l) => l.itemtype === "NonInvtPart" && l.taxline === "F");
const taxLines = lines.filter((l) => l.taxline === "T");

// ── grouped member economics ──────────────────────────────────────────
const memberSum = members.reduce((a, l) => a + abs(l.netamount), 0);
check(
  "grouped member economics = frozen unit subtotal",
  money(memberSum) === Number(tierTotal.unit_subtotal).toFixed(2),
  `${money(memberSum)} vs ${Number(tierTotal.unit_subtotal).toFixed(2)}`,
);
for (const l of members) {
  const posted = Math.round(Number(l.rate) * abs(l.quantity) * 100) / 100;
  check(
    `  ${l.itemid} · rate x qty reproduces its amount`,
    Math.abs(posted - abs(l.netamount)) < 0.005,
    `${l.rate} x ${abs(l.quantity)} = ${money(posted)}`,
  );
}

// ── separate charges: exactly two, once each, on their governed items ──
console.log("");
const EXPECTED_CHARGES = [
  { item: "OTC-0006", amount: 7680, what: "Tooling / mould" },
  { item: "OTC-0004", amount: 1488, what: "Label Print Plates" },
];
check(
  "exactly two separately-billed accounting lines",
  accounting.length === 2,
  `${accounting.length}`,
);
for (const e of EXPECTED_CHARGES) {
  const hits = accounting.filter((l) => l.itemid === e.item);
  check(
    `${e.what} · ${e.item} appears exactly once`,
    hits.length === 1,
    `${hits.length}`,
  );
  if (hits.length === 1) {
    check(
      `${e.what} · ${e.item} = ${money(e.amount)}`,
      Math.abs(abs(hits[0].netamount) - e.amount) < 0.005,
      money(abs(hits[0].netamount)),
    );
  }
}

// ── the Included charges must not be there, and neither must OTC-0005 ──
console.log("");
check(
  "Sleeve Print Plates (Included) has no separate line",
  accounting.filter((l) => l.itemid === "OTC-0004").length === 1,
  "one print-plates line only, for the Label set",
);
// CORRECTED 2026-09-07. This asserted the absence of OTC-0002 / OTC-0003,
// which are a Cutting Die and an unrelated item -- not samples. It excluded
// two things that were never going to be present for reasons having nothing
// to do with samples, so it passed vacuously and could not have failed.
//
// `otc_samples` has NO mapped item, so there is no code to name. The property
// that actually holds is structural: an Included charge produces no accounting
// line at all, so the two lines above are the complete set. Asserted that way,
// it fails the moment a third appears.
check(
  "Samples (Included) has no separate line",
  accounting.length === EXPECTED_CHARGES.length &&
    accounting.every((l) => EXPECTED_CHARGES.some((e) => e.item === l.itemid)),
  `${accounting.length} accounting line(s), all expected`,
);
check(
  "no duplicate Tooling through OTC-0005 or any legacy path",
  !lines.some((l) => l.itemid === "OTC-0005"),
  "OTC-0005 absent",
);

// ── totals, tax, and no unexpected line ───────────────────────────────
console.log("");
const otcSum = accounting.reduce((a, l) => a + abs(l.netamount), 0);
check(
  "separate charges = frozen otc subtotal",
  money(otcSum) === Number(tierTotal.otc_subtotal).toFixed(2),
  `${money(otcSum)} vs ${Number(tierTotal.otc_subtotal).toFixed(2)}`,
);
check(
  "taxTotal = 0.00",
  taxLines.every((l) => abs(l.netamount) === 0),
  taxLines.length === 0 ? "no tax line" : `${taxLines.length} tax line(s), all zero`,
);
check(
  "order total = accepted consideration",
  money(abs(mainline?.netamount)) === Number(tierTotal.total).toFixed(2),
  `${money(abs(mainline?.netamount))} vs ${Number(tierTotal.total).toFixed(2)}`,
);
check(
  "order total = members + separate charges",
  money(memberSum + otcSum) === money(abs(mainline?.netamount)),
  `${money(memberSum + otcSum)} vs ${money(abs(mainline?.netamount))}`,
);

// Every line is accounted for. A line nobody expected is the failure that
// reconciles: an extra zero-value row changes no total and changes the order.
const accountedFor =
  1 /* mainline */ +
  lines.filter((l) => l.itemtype === "Group" || l.itemtype === "EndGroup").length +
  members.length +
  accounting.length +
  taxLines.length;
check(
  "no unexpected line",
  accountedFor === lines.length,
  `${accountedFor} accounted of ${lines.length}`,
);

console.log("");
console.log(fails.length === 0 ? "RECONCILED" : `FAIL · ${fails.length}: ${fails.join("; ")}`);
process.exit(fails.length === 0 ? 0 : 1);
