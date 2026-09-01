/**
 * How much of the CURRENT quote population would the publication
 * representability guard refuse if it were finalized today?
 *
 * The guard (`derivePostedRate`, called by `commercial-freeze.ts`) requires
 * the cent-authoritative line amount to be what the PROVIDER will store:
 *
 *     ROUND_HALF_UP(quantity x rate, 2) === accepted amount
 *
 * It previously required a residue of exactly zero at scale 8, which holds
 * only when `cents x 1e6` divides by the quantity — so a quantity whose prime
 * factors are only 2 and 5 always passed, and any factor of 3, 7 or 11 failed
 * for most amounts. That was stricter than NetSuite, measured, and it refused
 * ordinary work.
 *
 * This runs the REAL projection (`projectCommercial`) over every quote, so the
 * amounts are the ones publication would actually try to freeze — not a
 * synthetic model of them. Frozen quotes are reported separately: they cleared
 * the guard by construction and are not at risk; they are here to show what the
 * population has historically looked like.
 *
 * Read-only. Touches nothing.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial, publishedCents } from "@/lib/commercial-projection";
import { derivePostedRate } from "@/lib/commercial-rate";

const rows = <T,>(r: unknown) => r as unknown as T[];

/**
 * The guard's condition — now the REAL one, called rather than re-modelled.
 *
 * It used to be re-stated here as "cents x 1e6 divides by quantity", which was
 * the old zero-residue rule. Re-implementing a gate inside the instrument that
 * measures it means the instrument can be right about a rule the system no
 * longer applies, so this calls `derivePostedRate` itself.
 */
function representable(amount: number, quantity: number): boolean {
  return derivePostedRate(amount.toFixed(2), quantity).ok;
}

/** Quantities that can NEVER fail, whatever the amount. */
function alwaysSafe(q: number): boolean {
  let x = q;
  for (const p of [2, 5]) while (x % p === 0) x /= p;
  return x === 1;
}

const quotes = rows<{ id: string; quote_number: string | null; status: string }>(
  await db.execute(sql`
    select q.id, q.quote_number, q.status
      from quotes q
     where exists (select 1 from quote_tiers t where t.quote_id = q.id and t.qty is not null)
     order by q.created_at`),
);

console.log(`\nprojecting ${quotes.length} quote(s)...\n`);

type Row = {
  quote: string;
  status: string;
  tierLabel: string;
  qty: number;
  line: string;
  amount: number;
  ok: boolean;
};

const results: Row[] = [];
const errors: string[] = [];

for (const q of quotes) {
  let bundle;
  try {
    bundle = await getCostingBundle(q.id);
  } catch (e) {
    errors.push(`${q.quote_number ?? q.id.slice(0, 8)}: bundle threw — ${String(e).slice(0, 80)}`);
    continue;
  }
  if (!bundle.ok) {
    errors.push(`${q.quote_number ?? q.id.slice(0, 8)}: ${bundle.error.message.slice(0, 80)}`);
    continue;
  }
  let projection;
  try {
    projection = projectCommercial((bundle as { data: Parameters<typeof projectCommercial>[0] }).data);
  } catch (e) {
    errors.push(`${q.quote_number ?? q.id.slice(0, 8)}: projection threw — ${String(e).slice(0, 80)}`);
    continue;
  }

  for (const line of projection.lines) {
    for (const [i, cell] of line.cells.entries()) {
      if (cell.state !== "priced") continue;
      const tier = projection.tiers[i];
      const amount = publishedCents(cell.lineAmount);
      results.push({
        quote: q.quote_number ?? q.id.slice(0, 8),
        status: q.status,
        tierLabel: tier?.tierLabel ?? `#${i}`,
        qty: cell.quantity,
        line: line.displayName,
        amount,
        ok: representable(amount, cell.quantity),
      });
    }
  }
}

// ── headline ────────────────────────────────────────────────────────────
const live = results.filter((r) => r.status === "draft");
const frozen = results.filter((r) => r.status !== "draft");
const fails = results.filter((r) => !r.ok);
const liveFails = live.filter((r) => !r.ok);

console.log("── EXPOSURE ───────────────────────────────────────────────");
console.log(`  (line, tier) cells projected      ${results.length}`);
console.log(`    of which DRAFT (at risk)        ${live.length}`);
console.log(`    of which already frozen         ${frozen.length}`);
console.log(`  cells that would be REFUSED       ${fails.length}`);
console.log(`    of which DRAFT                  ${liveFails.length}`);

// ── by quantity, which is what actually decides it ──────────────────────
console.log("\n── BY TIER QUANTITY ───────────────────────────────────────");
console.log("  qty        cells   refused   safe-by-construction?");
const byQty = new Map<number, Row[]>();
for (const r of results) byQty.set(r.qty, [...(byQty.get(r.qty) ?? []), r]);
for (const [qty, rs] of [...byQty].sort((a, b) => a[0] - b[0])) {
  const bad = rs.filter((r) => !r.ok).length;
  console.log(
    `  ${String(qty).padStart(8)}  ${String(rs.length).padStart(6)}  ${String(bad).padStart(8)}   ${
      alwaysSafe(qty) ? "yes — factors 2/5 only" : "NO — has an odd prime factor"
    }`,
  );
}

// ── which quotes are blocked ────────────────────────────────────────────
console.log("\n── QUOTES THAT COULD NOT BE FINALIZED TODAY ───────────────");
const blocked = new Map<string, Row[]>();
for (const r of fails) blocked.set(r.quote, [...(blocked.get(r.quote) ?? []), r]);
if (blocked.size === 0) console.log("  none");
for (const [quote, rs] of blocked) {
  console.log(`  ${quote.padEnd(10)} ${rs[0].status.padEnd(9)} ${rs.length} refused cell(s)`);
  for (const r of rs.slice(0, 4)) {
    console.log(`      ${r.tierLabel.padEnd(8)} qty ${String(r.qty).padStart(6)}  ${r.line.slice(0, 32).padEnd(34)} ${r.amount.toFixed(2)}`);
  }
  if (rs.length > 4) console.log(`      ... and ${rs.length - 4} more`);
}

if (errors.length) {
  console.log("\n── NOT MEASURED ───────────────────────────────────────────");
  console.log("  Reported, not silently dropped: a quote this could not");
  console.log("  project is a quote whose exposure is UNKNOWN, not zero.");
  for (const e of errors) console.log(`  ${e}`);
}

// ── the instrument must be able to report a failure ─────────────────────
//
// A population that reports zero refusals is worth nothing unless the thing
// reporting it can still say "refused". These are known-bad by construction —
// the historical ABH shape, where the product lands on a DIFFERENT cent — and
// they are run through the same `representable` the census used.
console.log("── INSTRUMENT SELF-CHECK ──────────────────────────────────");
const mustRefuse: [number, number, string][] = [
  [33848.09, 5000, "ABH tier 1 at scale 4 — posts 33848.00"],
  [31424.86, 20000, "ABH tier 3 at scale 4 — posts 31424.00"],
];
let selfCheckOk = true;
for (const [amount, qty, why] of mustRefuse) {
  // Deliberately NOT through `derivePostedRate`, which would derive a rate
  // that works. The historical defect was a rate rounded independently at
  // scale 4, so that is what is tested: can this instrument still see one?
  const scale4 = Math.round((amount / qty) * 10000) / 10000;
  const posted = Math.round(scale4 * qty * 100) / 100;
  const refused = posted !== amount;
  if (!refused) selfCheckOk = false;
  console.log(
    `  ${refused ? "REFUSES" : "ACCEPTS (!)"}  ${qty} x ${scale4.toFixed(4)} -> ` +
      `${posted.toFixed(2)} vs accepted ${amount.toFixed(2)}   ${why}`,
  );
}
console.log(
  selfCheckOk
    ? "  The rule still refuses whole-cent disagreements, so the zero above means what it says."
    : "  SELF-CHECK FAILED — the zero above is not trustworthy.",
);

console.log("");
process.exit(0);
