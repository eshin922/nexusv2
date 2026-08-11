/**
 * S-7 disposition — `ZZ-VALIDATION-tier-propagation`. READ ONLY.
 *
 * ONE QUESTION. `verify:s7-preserved` reports this quote's blended margin moved
 * `0.22753988245172124 -> 0.5072339132761682`. The movement predates BOTH
 * P3-017 commits, so the candidate cause is a change to the quote's INPUTS
 * rather than to the arithmetic. The audit log names the change: between
 * 2026-08-10T17:55Z and 20:57Z the Pricing surface's apply path wrote
 * `tier_price_adj_pct` on all four tiers, each first write `from: null`.
 *
 * A plausible story is not a disposition. This is the proof.
 *
 * WHY ARITHMETIC RATHER THAN RE-COMPUTATION. Re-running the engine with the
 * adjustments zeroed would answer the question, but it answers it THROUGH the
 * code under suspicion — and the thing being established is precisely that the
 * code did not change what it computes. So the check is made against the
 * captured baseline directly:
 *
 *   an adjustment scales a tier's revenue and leaves its cost alone, so
 *   if the adjustment is the WHOLE cause then
 *
 *       margin' = (revenue x (1 + adj) - cost) / (revenue x (1 + adj))
 *
 *   computed from the BASELINE's own cost and revenue must reproduce the
 *   moved figure exactly. Not nearly — exactly. Any drift in a cost input,
 *   a markup, a freight allocation or the blend itself would show up as a
 *   residual, because none of those are on the right-hand side.
 *
 * Nothing is written, and nothing about the engine is trusted.
 */

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";

const QUOTE = "52bd0077-20af-4345-8856-45003bfca8b3";
/** The figure `verify:s7-preserved` reports as the current value. */
const MOVED_TO = 0.5072339132761682;

interface BaselineTierRollup {
  tierId: string;
  label: string;
  totalCost: number;
  totalRevenue: number;
  blendedMarginPct: number | null;
}

const detail = JSON.parse(
  '{"_":' + readFileSync("docs/gate-1b/costing-baseline-detail.json", "utf8").trim() + "}",
)._ as Record<string, { quoteRollup: BaselineTierRollup[] }>;

const baseline = detail[QUOTE];
if (!baseline) throw new Error("quote not in the S-7 baseline");

const live = (await db.execute(sql`
  select id::text as tier_id, label, sort_order,
         tier_price_adj_pct::text as adj
    from quote_tiers where quote_id = ${QUOTE}
   order by sort_order
`)) as unknown as { tier_id: string; label: string; adj: string | null }[];

const adjByTier = new Map(live.map((t) => [t.tier_id, t.adj]));

console.log("\nS-7 disposition — ZZ-VALIDATION-tier-propagation\n");
console.log("  tier    baseline cost   baseline revenue   baseline margin      live adj");
for (const t of baseline.quoteRollup) {
  console.log(
    `  ${t.label.padEnd(7)} ${String(t.totalCost).padStart(13)} ${String(t.totalRevenue).padStart(18)} ` +
      `${String(t.blendedMarginPct).padStart(20)}   ${adjByTier.get(t.tierId) ?? "(no tier)"}`,
  );
}

// The quote's blended margin is reported at `quoteRollup[0]` — Tier 1.
const t1 = baseline.quoteRollup[0];
const adjRaw = adjByTier.get(t1.tierId);
const adj = adjRaw === null || adjRaw === undefined ? 0 : Number.parseFloat(adjRaw);

const revenue = t1.totalRevenue * (1 + adj);
const predicted = (revenue - t1.totalCost) / revenue;
const residual = Math.abs(predicted - MOVED_TO);

console.log("");
console.log(`  baseline margin           ${t1.blendedMarginPct}`);
console.log(`  ${t1.totalRevenue} x (1 + ${adj}) = ${revenue}, cost unchanged at ${t1.totalCost}`);
console.log(`  predicted margin          ${predicted}`);
console.log(`  reported moved-to         ${MOVED_TO}`);
console.log(`  residual                  ${residual}`);
console.log("");
console.log(
  residual === 0
    ? "  PROVEN — the tier adjustment accounts for the movement EXACTLY, to the last\n" +
        "  bit, with cost held at its captured value. No cost input moved and the\n" +
        "  arithmetic did not change. This is a data mutation, not commercial drift."
    : "  NOT PROVEN — a residual remains, so the adjustment is not the whole cause.\n" +
        "  Something else moved as well; do not dispose of this on the adjustment.",
);
console.log("");

process.exit(residual === 0 ? 0 : 1);
