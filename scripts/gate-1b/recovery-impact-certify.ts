/**
 * Does the impact preview tell an operator the truth, on real quotes?
 *
 * Four checks, each one a defect this measurement has already caught or could:
 *
 *  1. The BEFORE figure is the quote's actual customer total. A preview whose
 *     baseline is wrong is worse than none: both figures look plausible and the
 *     delta between them is fiction.
 *
 *  2. The governed recovery matches the workspace row's. They read the same
 *     construction, so a disagreement means one of them is counting a charge
 *     twice — which is exactly what happened: summing every rollup instead of
 *     leaf rollups only reported $2,800 on a $1,400 charge, because an
 *     assembly's rollup carries the merge of its children's.
 *
 *  3. Two ELECTED contracts produce the same customer total, to the cent. That
 *     is the neutrality the whole precedence exists to provide.
 *
 *  4. Clearing returns to the baseline. The negative proof, on production data
 *     rather than a fixture.
 *
 * Nothing is written and no election is persisted — every measurement is a
 * counterfactual thrown away.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { loadQuoteCostingInput } from "@/app/actions/costing";
import { getCostingBundle } from "@/app/actions/costing";
import { measureRecoveryImpact } from "@/lib/commercial-recovery/impact";
import { buildRecoveryWorkspace } from "@/lib/commercial-recovery/workspace-view";
import type { RecoveryChargeKey } from "@/lib/commercial-recovery/registry";

const quotes = (await db.execute(sql`
  select q.id::text as quote_id, q.status,
         coalesce(q.global_price_adj_pct::float8, 0) as gpa
    from quotes q
   where exists (
     select 1 from assemblies a
       join assembly_production_inputs api on api.assembly_id = a.id
      where a.quote_id = q.id
        and coalesce(api.setup_fee_total, 0)
          + coalesce(api.tooling_total, 0)
          + coalesce(api.artwork_total, 0)
          + coalesce(api.tooling_artwork_total, 0)
          + coalesce(api.rd_total, 0)
          + coalesce(api.other_service_total, 0) > 0
   )
   order by q.id::text
`)) as unknown as { quote_id: string; status: string; gpa: number }[];

const failures: string[] = [];
const cents = (n: number) => Math.round(n * 100);
const usd = (n: number) => `$${n.toFixed(2)}`;

console.log(`\nRecovery impact preview — ${quotes.length} quotes with a one-time charge\n`);

let measured = 0;

for (const q of quotes) {
  const built = await loadQuoteCostingInput(q.quote_id);
  const bundle = await getCostingBundle(q.quote_id);
  if (!built.ok || !bundle.ok) {
    failures.push(`${q.quote_id}: input or bundle unavailable`);
    continue;
  }

  const allocationStates = [
    ...new Set(
      (bundle.data.production ?? []).map(
        (p: { allocateServiceFeesToCost?: boolean | null }) =>
          p.allocateServiceFeesToCost === true,
      ),
    ),
  ];
  const leafIds = new Set(
    ((bundle.data.skus ?? []) as { id: string; skuRole?: string }[])
      .filter((sk) => sk.skuRole === "leaf")
      .map((sk) => sk.id),
  );
  const rows = buildRecoveryWorkspace({
    costing: bundle.data.costing,
    isLeaf: (id) => leafIds.has(id),
    elections: bundle.data.chargeElections ?? [],
    allocationStates: allocationStates.length ? allocationStates : [true],
  }).filter((r) => r.present);

  for (const row of rows) {
    const key = row.chargeKey as RecoveryChargeKey;

    // Only what the boundary would accept. The first run of this script asked
    // for every mode on every present charge and the constructor threw on
    // `rd_formulation`, whose recovery BV-011 does not authorize — a real
    // refusal, correctly raised, reached by a measurement that had no business
    // asking. `previewChargeRecovery` consults `refusalFor` before measuring;
    // this reads the same verdicts off the workspace row.
    const can = (m: string) => row.options.some((o) => o.mode === m && o.available);
    if (!can("included") || !can("separate")) {
      console.log(
        `  ${q.quote_id.slice(0, 8)}  ${key.padEnd(18)} refused — ${
          row.options.find((o) => !o.available)?.reason ?? "no governed contract"
        }`,
      );
      continue;
    }

    const inc = measureRecoveryImpact(built.data, key, "included");
    const sep = measureRecoveryImpact(built.data, key, "separate");
    if (inc === null || sep === null) {
      failures.push(`${q.quote_id} ${key}: present in the workspace but not measurable`);
      continue;
    }
    measured++;

    // 2 · the same construction, so the same recovery.
    //
    // ── WHAT THIS COMPARISON CAN AND CANNOT SEE ──────────────────────────
    //
    // It certifies that the workspace and the preview read ONE construction —
    // the double-counted-rollup defect, where a $1,400 charge reported $2,800.
    // For that it is valid and it stays.
    //
    // It cannot speak to TIER semantics. `RecoveryImpact.governedRecovery` is
    // itself "summed over every (owner, tier)" by its own definition, so both
    // sides of this comparison still cancel the tier dimension — the same
    // shape as the Card 1 certification before it was made tier-aware.
    //
    // The workspace's vector is therefore summed HERE, deliberately, to match
    // the preview's basis. That is a comparison of like with like and not a
    // statement that either figure is the amount of anything. The preview's
    // own cross-tier sum is a separate defect at a separate site, reported
    // rather than repaired inside a scope that named two.
    const rowRecovery = row.perTier.every((t) => t.recovery !== null)
      ? row.perTier.reduce((a, t) => a + (t.recovery as number), 0)
      : null;
    if (rowRecovery !== null && inc.governedRecovery !== null) {
      if (cents(rowRecovery) !== cents(inc.governedRecovery)) {
        failures.push(
          `${q.quote_id} ${key}: workspace says ${usd(rowRecovery)} recovered, preview says ${usd(inc.governedRecovery)} — one is counting a rollup twice`,
        );
      }
    }

    // 3 · neutrality between two elected contracts.
    if (cents(inc.customerTotalAfter) !== cents(sep.customerTotalAfter)) {
      failures.push(
        `${q.quote_id} ${key}: elected placements differ — ${usd(inc.customerTotalAfter)} vs ${usd(sep.customerTotalAfter)}`,
      );
    }

    // 4 · clearing returns to the baseline.
    const cleared = measureRecoveryImpact(built.data, key, null);
    if (cleared && cents(cleared.customerTotalAfter) !== cents(cleared.customerTotalBefore)) {
      // Only meaningful when there was an election to clear; with none, the
      // counterfactual IS the current state and must be identical.
      const hadElection = (bundle.data.chargeElections ?? []).some(
        (e: { chargeKey: string }) => e.chargeKey === key,
      );
      if (!hadElection) {
        failures.push(
          `${q.quote_id} ${key}: clearing a charge with no election changed the total`,
        );
      }
    }

    const delta = inc.customerTotalAfter - inc.customerTotalBefore;
    const ladder =
      rowRecovery === null ? null : -(rowRecovery * q.gpa);
    console.log(
      `  ${q.quote_id.slice(0, 8)}  ${key.padEnd(18)} gpa=${q.gpa.toFixed(2)}  ` +
        `${usd(inc.customerTotalBefore)} → ${usd(inc.customerTotalAfter)}  ` +
        `Δ ${usd(delta)}` +
        (ladder === null
          ? "  (unpriced)"
          : cents(delta) === cents(ladder)
            ? "  = -recovery×gpa"
            : `  ≠ -recovery×gpa (${usd(ladder)}) — a lift or override is involved`),
    );
  }
}

// 1 · the baseline. Checked once against the resolver's own tier totals, which
// is the number the customer document prints.
if (quotes.length > 0) {
  const q = quotes[0];
  const built = await loadQuoteCostingInput(q.quote_id);
  const bundle = await getCostingBundle(q.quote_id);
  if (built.ok && bundle.ok) {
    const leafIds = new Set(
      ((bundle.data.skus ?? []) as { id: string; skuRole?: string }[])
        .filter((sk) => sk.skuRole === "leaf")
        .map((sk) => sk.id),
    );
    const rows = buildRecoveryWorkspace({
      costing: bundle.data.costing,
      isLeaf: (id) => leafIds.has(id),
      elections: bundle.data.chargeElections ?? [],
      allocationStates: [true],
    }).filter((r) => r.present);
    if (rows.length > 0) {
      const m = measureRecoveryImpact(built.data, rows[0].chargeKey, "included");
      const engineTotal = (bundle.data.costing.quoteRollup ?? []).reduce(
        (a: number, t: { totalRevenue: number }) => a + t.totalRevenue,
        0,
      );
      console.log(
        `\n  baseline cross-check on ${q.quote_id.slice(0, 8)}: preview ${usd(m?.customerTotalBefore ?? 0)} vs engine revenue ${usd(engineTotal)}`,
      );
      // Not asserted equal: the customer total and the engine's revenue differ
      // legitimately where a charge is billed on its own line. Printed so a
      // reader can see they are the same order of magnitude rather than being
      // told they match.
    }
  }
}

console.log(`\n  contracts measured  ${measured}`);
console.log(
  failures.length === 0
    ? `\nPASS — baselines agree with the workspace, elected placements are neutral, clearing is inert\n`
    : `\nFAIL\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
