// R1 · Rollback after first Apply — the blocking rehearsal.
//
// Phase 3 §2 R1 states the question precisely, and it is NOT whether the
// current runtime renders lifts:
//
//   "What happens when a runtime WITHOUT lift support meets a database
//    CONTAINING them."
//
// Three outcomes, each with a different commercial consequence:
//
//   absorbs  — keeps consuming lift rows while failing to explain them
//   ignores  — computes a different price from the one displayed before rollback
//   rejects  — fails because it cannot interpret the state
//
// ── HOW THIS SCRIPT IS USED ───────────────────────────────────────────────
//
// It is written to run UNCHANGED on both runtimes, because it touches only
// APIs that exist on both: `getCostingBundle` and `resolveCustomerView`. Run
// it once on the Phase 3 branch and once from a git worktree checked out at
// the pre-Phase-3 commit, both pointed at the SAME database, and diff the two
// JSON documents.
//
//     node --env-file=.env.validation.local \
//       --experimental-strip-types --conditions=react-server \
//       --experimental-loader ./scripts/support/src-resolver.mjs \
//       scripts/rehearsal/r1-rollback-after-apply.ts <quoteId>
//
// Running the old runtime rather than simulating it is deliberate. Passing
// `lifts: []` on this branch would model the old behaviour and would probably
// be right — but "probably right" is an argument, and R1 asks for a
// measurement.
//
// ── WHAT IT RECORDS, AND WHAT IT DOES NOT ─────────────────────────────────
//
// Three of R1's six comparisons: computed sell, margin, and the Completion /
// NetSuite projection. These are the ones where a divergence is a wrong
// NUMBER, and a script is the right instrument for a number.
//
// The other three — displayed sell, Customer View, PDF — are rendered
// artifacts, and are captured over HTTP from each runtime's own running app.
// `resolveCustomerView` is deliberately NOT imported: it reaches the
// validation authentication provider, which is a `.tsx` module the type
// stripper cannot load, and routing around that would mean measuring
// something other than what the app serves.

import { getCostingBundle } from "../../src/app/actions/costing.ts";

const quoteId = process.argv[2];
if (!quoteId) {
  console.error("usage: r1-rollback-after-apply.ts <quoteId>");
  process.exit(1);
}

const round = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Number(n.toFixed(6));

const bundle = await getCostingBundle(quoteId);
if (!bundle.ok) {
  // A `rejects` outcome would surface here, and it is a legitimate result
  // rather than a script failure — recorded as such.
  console.log(
    JSON.stringify({ quoteId, outcome_signal: "rejects", error: bundle.error }, null, 1),
  );
  process.exit(0);
}

const costing = bundle.data.costing;

// 1 + 3 · computed sell and margin, per leaf per tier.
const cells: Record<
  string,
  { sell: number | null; sellSource: string | null; marginPct: number | null }
> = {};
for (const rollup of costing.skuRollups) {
  if (rollup.skuRole !== "leaf") continue;
  for (const t of rollup.perTier) {
    cells[`${rollup.canonicalQuoteLeafId ?? rollup.skuId}::${t.tierId}`] = {
      // `computedSellPerUnit` is the engine's own name for R1's "computed
      // sell"; `sellSource` says whether a direct price displaced it.
      sell: round(t.computedSellPerUnit),
      sellSource: t.sellSource,
      marginPct: round(t.marginPct),
    };
  }
}

// 6 · the Completion / NetSuite projection. `markComplete` pushes
// `Number(tierRollup.totalRevenue.toFixed(2))` for the accepted tier; every
// tier's is captured so the comparison does not depend on which one is
// accepted at the time the rehearsal runs.
const tiers = costing.quoteRollup.map((t) => ({
  tierId: t.tierId,
  label: t.label,
  netsuiteAmount: Number(t.totalRevenue.toFixed(2)),
  blendedMarginPct: round(t.blendedMarginPct),
  status: t.blendedMarginStatus,
}));

console.log(
  JSON.stringify(
    {
      quoteId,
      // Present on the Phase 3 runtime, absent on the pre-Phase-3 one. The
      // clearest single marker of which runtime produced a document.
      liftsInInput: (bundle.data as { lifts?: unknown[] }).lifts?.length ?? "field-absent",
      cells,
      tiers,
    },
    null,
    1,
  ),
);
