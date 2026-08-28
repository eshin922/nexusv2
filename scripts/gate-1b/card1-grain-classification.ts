/**
 * Card 1 · classify every recovery-charge source by COMMERCIAL GRAIN.
 *
 * Edward's disposition: Card 1 must separate recovery authority from
 * accounting destination. `rd_formulation` presented $12,510 as one actionable
 * charge, of which the control governs only the $5,600 OTC fee — the remaining
 * $6,910.40 is the `SVC-FORMULATION` Direct Service leaf, already priced as a
 * customer line.
 *
 * Before repairing that, the disposition requires the predicted Testing /
 * Micros case be verified and EVERY source classified, so the correction lands
 * in one pass rather than special-casing R&D.
 *
 * READ ONLY. It classifies; it writes nothing.
 *
 * ── WHAT THIS MEASURES, AND WHAT IT CANNOT ──────────────────────────────
 *
 * It reports, per charge row on a real quote:
 *   - the row's own `totalRecovery` (what Card 1 shows today);
 *   - the OTC-fee portion, summed from the production columns that feed it;
 *   - the residual, which is what a Direct Service line contributes.
 *
 * A residual of zero means the row is purely an OTC fee and its control
 * governs all of it. A non-zero residual is the defect: the control advertises
 * an amount larger than it can move.
 *
 * It cannot tell you WHY a residual exists — only that it does, and how much.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { loadQuoteCostingInput, getCostingBundle } from "@/app/actions/costing";
import { buildRecoveryWorkspace } from "@/lib/commercial-recovery/workspace-view";
import { OTC_COLUMN_TO_CHARGE } from "@/lib/commercial-recovery/registry";

const TARGET = process.argv[2] ?? null;

const quotes = TARGET
  ? [{ quote_id: TARGET }]
  : ((await db.execute(sql`
      select q.id::text as quote_id
        from quotes q
        join assembly_production_inputs p on p.assembly_id in (
          select a.id from assemblies a where a.quote_id = q.id)
       group by q.id
       order by q.updated_at desc nulls last
       limit 25
    `)) as unknown as { quote_id: string }[]);

const money = (n: number) => "$" + n.toFixed(2);

let defects = 0;
let inspected = 0;

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
  }).filter((r) => r.present);

  if (rows.length === 0) continue;
  inspected++;

  // The OTC-fee portion, straight from the columns that ARE the fee. Summed
  // per charge across every (assembly, tier) production row, then marked up at
  // the same governed rate the charge economics use.
  const prod = (await db.execute(sql`
    select p.*
      from assembly_production_inputs p
      join assemblies a on a.id = p.assembly_id
     where a.quote_id = ${q.quote_id}
  `)) as unknown as Record<string, unknown>[];

  const feeCostByCharge = new Map<string, number>();
  for (const r of prod) {
    for (const [column, chargeKey] of Object.entries(OTC_COLUMN_TO_CHARGE)) {
      const snake = column.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
      const v = Number(r[snake] ?? 0) || 0;
      if (v === 0) continue;
      feeCostByCharge.set(chargeKey, (feeCostByCharge.get(chargeKey) ?? 0) + v);
    }
  }

  const header: string[] = [];
  for (const row of rows) {
    // No economics, nothing to classify — see the sibling certification. Never
    // folded to 0: that would state a cost the operator has not entered.
    if (row.totalCost === null) continue;
    const feeCost = feeCostByCharge.get(row.chargeKey) ?? 0;
    // The row's own cost is the authority on what it thinks it holds; the fee
    // columns are the authority on the OTC portion. Their difference is the
    // Direct Service contribution.
    const residualCost = row.totalCost - feeCost;
    const isDefect = Math.abs(residualCost) > 0.005;
    if (isDefect) defects++;
    header.push(
      [
        isDefect ? "DEFECT " : "ok     ",
        row.chargeKey.padEnd(22),
        "shown " + money(row.totalRecovery ?? 0).padStart(12),
        "| cost " + money(row.totalCost).padStart(11),
        "= fee " + money(feeCost).padStart(11),
        "+ service " + money(residualCost).padStart(11),
      ].join(" "),
    );
  }

  console.log("");
  console.log("quote " + q.quote_id);
  for (const h of header) console.log("  " + h);
}

console.log("");
console.log("── classification ──");
console.log(`  quotes inspected : ${inspected}`);
console.log(`  charge rows whose control cannot move all it advertises : ${defects}`);
console.log("");
console.log("  A row is OK when its cost is entirely OTC-fee columns: the");
console.log("  recovery control governs every dollar it shows. A DEFECT row");
console.log("  carries a Direct Service contribution the control cannot move.");

process.exit(0);
