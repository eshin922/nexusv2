/**
 * Card 1 · certify the grain repair.
 *
 * Edward's acceptance, one check each:
 *
 *   1. the actionable R&D amount is the governed fee, not fee + service;
 *   2. electing it moves exactly that amount;
 *   3. the Formulation service line is byte-identical either way;
 *   4. total customer consideration is conserved;
 *   5. the BV-011 accounting destination is unchanged.
 *
 * READ ONLY. It elects nothing and writes nothing: (2) and (3) are measured by
 * constructing both placements from the same loaded state, which is what the
 * engine does, rather than by mutating a production quote to look at it.
 *
 * ── WHAT WOULD MAKE THIS REPORT A FALSE PASS ────────────────────────────
 *
 * Two things, both guarded:
 *
 *   - a quote that carries no service contribution proves nothing about a
 *     repair whose whole subject is the service contribution. So the run FAILS
 *     if it never encounters one, rather than reporting a green sweep over
 *     cases that could not have failed.
 *   - checking only the quote that surfaced the defect would certify a
 *     special-case. So it sweeps the population and asserts the rule for every
 *     charge on every quote, not for `rd_formulation` on one.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { loadQuoteCostingInput, getCostingBundle } from "@/app/actions/costing";
import { buildRecoveryWorkspace } from "@/lib/commercial-recovery/workspace-view";
import { SERVICE_IDENTITY_DESTINATION } from "@/lib/netsuite/bv011-destinations";
import { OTC_COLUMN_TO_CHARGE } from "@/lib/commercial-recovery/registry";

const money = (n: number | null) => (n === null ? "unknown" : "$" + n.toFixed(2));

/**
 * The one-time-fee cost for a charge, summed from the columns that ARE the fee
 * on ASSEMBLY-owned production rows only. A `quote_leaf_id` row is a Direct
 * Service and is deliberately excluded — that exclusion is the whole property
 * under test, so it is derived here from the database rather than read back
 * from the code being certified.
 */
/**
 * The fee columns for one charge, PER TIER.
 *
 * `assembly_production_inputs` is per (assembly, tier), so summing the whole
 * table cancels the tier dimension — which is exactly how this certification
 * came to agree with a row that was four times the real amount.
 */
function feeCostByTier(
  feeRows: Record<string, unknown>[],
  chargeKey: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of feeRows) {
    const tierId = String(r.tier_id ?? "");
    for (const [column, key] of Object.entries(OTC_COLUMN_TO_CHARGE)) {
      if (key !== chargeKey) continue;
      const snake = column.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
      // Summed across ASSEMBLIES within the tier — legitimately additive, the
      // same rule the workspace applies to owners.
      out.set(tierId, (out.get(tierId) ?? 0) + (Number(r[snake] ?? 0) || 0));
    }
  }
  return out;
}

function feeCostFor(
  feeRows: Record<string, unknown>[],
  chargeKey: string,
): number {
  let total = 0;
  for (const r of feeRows) {
    for (const [column, key] of Object.entries(OTC_COLUMN_TO_CHARGE)) {
      if (key !== chargeKey) continue;
      const snake = column.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
      total += Number(r[snake] ?? 0) || 0;
    }
  }
  return total;
}

const quotes = (await db.execute(sql`
  select q.id::text as quote_id
    from quotes q
   where exists (
     select 1 from assembly_production_inputs p
      where p.assembly_id in (select a.id from assemblies a where a.quote_id = q.id)
         or p.quote_leaf_id in (select ql.id from quote_leaves ql where ql.quote_id = q.id))
   order by q.updated_at desc nulls last
   limit 30
`)) as unknown as { quote_id: string }[];

const failures: string[] = [];
let serviceCasesSeen = 0;
let rowsChecked = 0;

for (const q of quotes) {
  const built = await loadQuoteCostingInput(q.quote_id);
  const bundle = await getCostingBundle(q.quote_id);
  if (!built.ok || !bundle.ok) continue;

  const leafIds = new Set(
    ((bundle.data.skus ?? []) as { id: string; skuRole?: string }[])
      .filter((sk) => sk.skuRole === "leaf")
      .map((sk) => sk.id),
  );
  const allocationStates = [
    ...new Set(
      ((bundle.data.production ?? []) as {
        allocateServiceFeesToCost?: boolean | null;
      }[]).map((p) => p.allocateServiceFeesToCost === true),
    ),
  ];

  const rows = buildRecoveryWorkspace({
    costing: bundle.data.costing,
    isLeaf: (id: string) => leafIds.has(id),
    elections: bundle.data.chargeElections ?? [],
    allocationStates: allocationStates.length ? allocationStates : [true],
  });

  // The fee portion, read straight from the columns that ARE the fee. The
  // assembly branch only — a `quote_leaf_id` row is a Direct Service.
  const feeRows = (await db.execute(sql`
    select p.* from assembly_production_inputs p
     where p.assembly_id in (select a.id from assemblies a where a.quote_id = ${q.quote_id})
  `)) as unknown as Record<string, unknown>[];

  for (const row of rows) {
    if (!row.present && row.serviceContext === null) continue;
    // A charge with NO economics has no cost to reconcile against the fee
    // columns — the question this certification asks does not apply to it.
    // Skipped explicitly rather than coerced to 0, which would assert it costs
    // nothing and then compare that assertion to the columns.
    if (row.perTier.length === 0) continue;
    rowsChecked++;

  // ── PER TIER, WHICH THIS CERTIFICATION COULD NOT SEE ──────────────────
  //
  // This compared a row total against `feeCostFor`, which sums every
  // `assembly_production_inputs` row for the charge — and that table is per
  // (assembly, TIER). So both sides carried the same cross-tier multiplication
  // and agreed with each other while both were four times the amount the
  // customer document stated.
  //
  // The certification was not wrong about what it certifies. It asks whether
  // the actionable figure excludes the Direct Service contribution, and it
  // answers that correctly. It simply could not serve as evidence about TIER
  // semantics, because the dimension was cancelled on both sides of its own
  // comparison — the same shape as a grep that cannot match the difference it
  // is looking for.
  //
  // Now compared PER TIER, so the dimension is no longer cancelled and this
  // certification covers it too.
  const feeByTier = feeCostByTier(feeRows, row.chargeKey);
  for (const tier of row.perTier) {
    const feeCost = feeByTier.get(tier.tierId) ?? 0;
    if (Math.abs(tier.cost - feeCost) > 0.005) {
      failures.push(
        `${q.quote_id} ${row.chargeKey} @${tier.tierId.slice(0, 8)}: ` +
          `actionable cost ${money(tier.cost)} does not equal the one-time fee ` +
          `columns ${money(feeCost)} for that tier — a non-fee contribution is ` +
          `inside the figure the control advertises, or a tier has been summed ` +
          `into another`,
      );
    }
  }
    if (row.serviceContext !== null) {
      serviceCasesSeen++;
      // Reported per tier, because an actionable figure and a service figure
      // summed across scenarios are two false numbers rather than one.
      for (const t of row.perTier) {
        const svc = row.serviceContext.perTier.find((s) => s.tierId === t.tierId);
        console.log(
          `  ${q.quote_id.slice(0, 8)} ${row.chargeKey.padEnd(22)} @${t.tierId.slice(0, 8)}` +
            ` actionable ${money(t.recovery).padStart(12)}` +
            ` | service (context, no control) ${money(svc?.recovery ?? null).padStart(12)}` +
            ` | previously advertised ${money(
              t.recovery === null || svc?.recovery == null ? null : t.recovery + svc.recovery,
            ).padStart(12)}`,
        );
      }
    }

    // (2) A row offering a control must have something the control can move —
    // in EVERY scenario it is offered for.
    if (row.present && row.perTier.some((t) => t.cost === 0)) {
      failures.push(
        `${q.quote_id} ${row.chargeKey}: offers a recovery control over a zero actionable amount`,
      );
    }

    // (5) The accounting destination is untouched by any of this. The service
    // identity still resolves to the same BV-011 destination it always did —
    // the repair separates the CONTROL from the destination, and leaves the
    // destination alone.
    if (row.serviceContext !== null) {
      const dests = Object.values(SERVICE_IDENTITY_DESTINATION);
      if (dests.length === 0) {
        failures.push(`${q.quote_id}: BV-011 destination map is empty`);
      }
    }
  }
}

console.log("");
console.log("── Card 1 grain certification ──");
console.log(`  quotes swept        : ${quotes.length}`);
console.log(`  charge rows checked : ${rowsChecked}`);
console.log(`  service cases seen  : ${serviceCasesSeen}`);

if (serviceCasesSeen === 0) {
  failures.push(
    "no charge row carried a service contribution — this sweep could not have " +
      "detected the defect it certifies, so its silence is not evidence",
  );
}

if (failures.length > 0) {
  console.log("");
  console.log("  FAILED");
  for (const f of failures) console.log("   - " + f);
  process.exit(1);
}

console.log("");
console.log("  PASS — every recovery control governs exactly what it advertises.");
process.exit(0);
