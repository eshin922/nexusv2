/**
 * A quote's commercial state, as one comparable line.
 *
 * Run before a browser walk and again after it. The hash covers everything the
 * customer's money depends on — the tier rollup, every per-SKU rollup, and the
 * instructions a SEND would freeze — so "restored" is a string comparison
 * rather than an impression.
 *
 * A hash rather than a diff on purpose: the question after a walk is binary,
 * and a 35KB diff invites reading past a difference. When it does differ, the
 * persistence-walk script prints the sizes and the elections tell you why.
 *
 * Read-only.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { projectFrozenInstructions } from "@/lib/commercial-recovery/frozen-instruction";

const QUOTE = process.argv[2];
if (!QUOTE) {
  console.error("usage: recovery-walk-state <quoteId>");
  process.exit(2);
}

const meta = (await db.execute(sql`
  select q.status, q.scenario_label, p.deal_name,
         (select count(*)::int from quote_charge_recovery r where r.quote_id = q.id) as elections,
         (select count(*)::int from quote_snapshots s where s.quote_id = q.id) as snapshots
    from quotes q join projects p on p.id = q.project_id
   where q.id = ${QUOTE}::uuid
`)) as unknown as {
  status: string; scenario_label: string; deal_name: string;
  elections: number; snapshots: number;
}[];

if (meta.length === 0) {
  console.log(`quote ${QUOTE} not found`);
  process.exit(1);
}

const bundle = await getCostingBundle(QUOTE);
if (!bundle.ok) {
  console.log(`bundle failed: ${bundle.error.code}`);
  process.exit(1);
}

const leafIds = new Set(
  ((bundle.data.skus ?? []) as { id: string; skuRole?: string }[])
    .filter((s) => s.skuRole === "leaf")
    .map((s) => s.id),
);

const payload = JSON.stringify({
  rollup: bundle.data.costing.quoteRollup,
  skuRollups: bundle.data.costing.skuRollups,
  instructions: projectFrozenInstructions(bundle.data.costing, (id) => leafIds.has(id)),
});

const rows = (await db.execute(sql`
  select charge_key, mode from quote_charge_recovery
   where quote_id = ${QUOTE}::uuid order by charge_key
`)) as unknown as { charge_key: string; mode: string }[];

console.log(`${meta[0].deal_name} / ${meta[0].scenario_label}`);
console.log(`  status      ${meta[0].status}`);
console.log(`  elections   ${rows.length === 0 ? "none" : rows.map((r) => `${r.charge_key}=${r.mode}`).join(" ")}`);
console.log(`  snapshots   ${meta[0].snapshots}`);
console.log(`  digest      ${createHash("sha256").update(payload).digest("hex").slice(0, 32)} (${payload.length} bytes)`);
