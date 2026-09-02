/**
 * Order 2 · the link that closes the certification.
 *
 * #532 proved the Freight economics are right in the ENGINE. The NetSuite
 * readback proved the Sales Order equals the FROZEN artifact. Neither on its
 * own proves the freight survived publication — that requires joining the two
 * ends, which is what this does:
 *
 *     engine revenue  ~=  frozen line sum  ===  frozen tier total  ===  NetSuite
 *
 * The FIRST relation is deliberately not an equality, and asserting it as one
 * was a mistake on the first run: it compares ACROSS the #515 publication
 * boundary. The engine carries full precision; publication normalises each
 * LINE to cents and derives the tier total from those. Sum-of-rounded-lines is
 * not rounded-sum, so a residue of up to half a cent PER LINE is expected —
 * that is the boundary working, not drift. Here it is exactly 1c over 7 lines.
 *
 * Everything DOWNSTREAM of that boundary must be exact, and is. If the frozen
 * lines sum to the frozen tier total and that equals what NetSuite stored,
 * then everything the engine computed for the accepted tier — freight, duty,
 * tariff and their distinct markups included — reached the order.
 *
 * Freight is BUNDLED into unit price on this quote, so it has no line of its
 * own on the order. That is precisely why the identity has to be asserted at
 * the total: a bundled component cannot be pointed at, only accounted for.
 * Its magnitude is reported alongside so the share being carried is visible
 * rather than implied.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { suiteQL } from "@/lib/netsuite/client";

const QUOTE = "c555a868-dabe-416a-b853-13ef7c770469";
const rows = <T,>(r: unknown) => r as unknown as T[];
const cents = (n: number) => Math.round(n * 100);

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

const q = rows<{
  quote_number: string;
  netsuite_so_id: string;
  accepted_tier_id: string;
}>(
  await db.execute(sql`
    select quote_number, netsuite_so_id, accepted_tier_id
      from quotes where id = ${QUOTE}::uuid`),
)[0];

const tier = rows<{ label: string; qty: number }>(
  await db.execute(sql`
    select label, qty from quote_tiers where id = ${q.accepted_tier_id}::uuid`),
)[0];

console.log(`\n${q.quote_number} · accepted ${tier.label} · ${tier.qty} units · SO ${q.netsuite_so_id}\n`);

// ── 1 · the engine ──────────────────────────────────────────────────────
const bundle = await getCostingBundle(QUOTE);
if (!bundle.ok) throw new Error(bundle.error.message);
const rollup = (bundle as unknown as {
  data: { costing: { quoteRollup: Array<{
    tierId: string;
    label: string;
    totalRevenue: number;
    costBreakdown: {
      freight: number;
      freightContainer: number;
      dutyAndTariff: number;
      freightContainerMarkupSum: number;
      dutyAndTariffMarkupSum: number;
    };
  }> } };
}).data.costing.quoteRollup;

const accepted = rollup.find((r) => r.tierId === q.accepted_tier_id);
if (!accepted) throw new Error("accepted tier not in rollup");

const freightBillable =
  accepted.costBreakdown.freightContainerMarkupSum +
  accepted.costBreakdown.dutyAndTariffMarkupSum;

console.log("── WHAT THE ACCEPTED TIER CARRIES ─────────────────────────");
console.log(`  engine revenue                 ${accepted.totalRevenue.toFixed(2)}`);
console.log(`  of which freight (billable)    ${freightBillable.toFixed(2)}`);
console.log(`    container                    ${accepted.costBreakdown.freightContainerMarkupSum.toFixed(2)}`);
console.log(`    duty + tariff                ${accepted.costBreakdown.dutyAndTariffMarkupSum.toFixed(2)}`);
console.log(`  freight COST (unmarked)        ${accepted.costBreakdown.freight.toFixed(2)}`);

// ── 2 · the frozen artifact ─────────────────────────────────────────────
const frozenTotal = rows<{ tier_commercial_total: string }>(
  await db.execute(sql`
    select tier_commercial_total
      from quote_snapshot_tier_totals
     where tier_id = ${q.accepted_tier_id}::uuid
       and quote_snapshot_id in (select id from quote_snapshots where quote_id = ${QUOTE}::uuid)`),
)[0];

const frozenSum = rows<{ sum: string; n: number }>(
  await db.execute(sql`
    select coalesce(sum(t.line_amount), 0) sum, count(*)::int n
      from quote_snapshot_lines l
      join quote_snapshot_line_tiers t on t.quote_snapshot_line_id = l.id
     where l.quote_snapshot_id in (select id from quote_snapshots where quote_id = ${QUOTE}::uuid)
       and t.tier_id = ${q.accepted_tier_id}::uuid
       and t.pricing_state = 'priced'`),
)[0];

// ── 3 · NetSuite ────────────────────────────────────────────────────────
const ns = rows<{ foreigntotal: string }>(
  await suiteQL(`select foreigntotal from transaction where id = ${q.netsuite_so_id}`)
    .then((r) => r.items),
)[0];

console.log("\n── THE CHAIN ──────────────────────────────────────────────");
console.log(`  engine accepted-tier revenue   ${accepted.totalRevenue.toFixed(2)}`);
console.log(`  frozen line sum                ${Number(frozenSum.sum).toFixed(2)}  (${frozenSum.n} lines)`);
console.log(`  frozen tier total              ${Number(frozenTotal.tier_commercial_total).toFixed(2)}`);
console.log(`  NetSuite stored total          ${Number(ns.foreigntotal).toFixed(2)}\n`);

// Downstream of the cent boundary, everything is EXACT.
check(
  cents(Number(frozenSum.sum)) === cents(Number(frozenTotal.tier_commercial_total)),
  "frozen line sum === frozen tier total (REG-4 link A shape)",
);
check(
  cents(Number(frozenSum.sum)) === cents(Number(ns.foreigntotal)),
  "frozen === NetSuite — the push moved nothing",
);

// ACROSS the boundary the residue must be BOUNDED and attributable. Asserting
// equality here would assert that #515's cent normalisation does not exist; an
// open tolerance would hide real drift. The bound is half a cent per published
// line — the most that rounding each line independently can accumulate.
const residue = Math.abs(cents(accepted.totalRevenue) - cents(Number(frozenSum.sum)));
const bound = Math.ceil(frozenSum.n / 2);
check(
  residue <= bound,
  "engine vs frozen: residue within the published-cents bound",
  `${residue}c over ${frozenSum.n} lines, bound ${bound}c`,
);

// The freight is real and non-trivial, so the equalities above are carrying
// something. An identity that holds because a component is zero proves nothing.
check(
  freightBillable > 0,
  "the freight being carried is non-zero",
  freightBillable.toFixed(2),
);
check(
  cents(freightBillable) < cents(accepted.totalRevenue),
  "and it is a component, not the whole",
  `${((freightBillable / accepted.totalRevenue) * 100).toFixed(1)}% of revenue`,
);

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
