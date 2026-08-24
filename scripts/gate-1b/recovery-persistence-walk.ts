/**
 * persist → reload → measured impact → clear → legacy restoration.
 *
 * The operator walk minus the click. Everything after the button is exercised
 * here against the real read path on a real quote: the election is COMMITTED,
 * the bundle is re-read on a fresh connection, the workspace and the frozen
 * instruction are rebuilt from it, and then the election is removed and the
 * quote is proven byte-identical to how it started.
 *
 * ── WHY THE ELECTION IS REALLY COMMITTED ────────────────────────────────
 *
 * A rolled-back transaction proves nothing about a RELOAD. `getCostingBundle`
 * reads on its own connection and cannot see uncommitted rows, so a
 * transaction-scoped election would be invisible to exactly the path under
 * test. The row is written, read back through the real loader, and deleted.
 *
 * ── WHAT IT DOES NOT COVER ──────────────────────────────────────────────
 *
 * The click, and `setChargeRecovery` itself — which needs an authenticated
 * operator. The row is written directly, so this certifies the READ path and
 * the restoration, not the writer. The writer is covered by unit tests and by
 * the browser walk.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────
 *
 * Runs only on a quote passed as an argument, only if that quote is a DRAFT,
 * and refuses if the charge already carries an election (which would mean
 * clearing it destroys an operator's real decision). The full costing digest
 * is captured before and compared after; a mismatch is a FAILURE, not a note.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle, loadQuoteCostingInput } from "@/app/actions/costing";
import { measureRecoveryImpact } from "@/lib/commercial-recovery/impact";
import { buildRecoveryWorkspace } from "@/lib/commercial-recovery/workspace-view";
import { projectFrozenInstructions } from "@/lib/commercial-recovery/frozen-instruction";
import type { RecoveryChargeKey } from "@/lib/commercial-recovery/registry";

const QUOTE = process.argv[2];
const CHARGE = (process.argv[3] ?? "project_setup") as RecoveryChargeKey;
if (!QUOTE) {
  console.error("usage: recovery-persistence-walk <quoteId> [chargeKey]");
  process.exit(2);
}

const failures: string[] = [];
const cents = (n: number) => Math.round(n * 100);

const leafPredicate = (skus: unknown) => {
  const ids = new Set(
    ((skus ?? []) as { id: string; skuRole?: string }[])
      .filter((s) => s.skuRole === "leaf")
      .map((s) => s.id),
  );
  return (id: string) => ids.has(id);
};

/** Everything the customer's money depends on, as one comparable string. */
async function digest(): Promise<string> {
  const b = await getCostingBundle(QUOTE);
  if (!b.ok) throw new Error(`bundle failed: ${b.error.code}`);
  const isLeaf = leafPredicate(b.data.skus);
  return JSON.stringify({
    rollup: b.data.costing.quoteRollup,
    skuRollups: b.data.costing.skuRollups,
    instructions: projectFrozenInstructions(b.data.costing, isLeaf),
  });
}

const guard = (await db.execute(sql`
  select status,
         (select count(*)::int from quote_charge_recovery r
           where r.quote_id = q.id and r.charge_key = ${CHARGE}) as elections
    from quotes q where q.id = ${QUOTE}::uuid
`)) as unknown as { status: string; elections: number }[];

if (guard.length === 0) failures.push(`quote ${QUOTE} not found`);
else if (guard[0].status !== "draft") {
  failures.push(`quote is '${guard[0].status}', not draft — elections are frozen`);
} else if (guard[0].elections > 0) {
  failures.push(
    `${CHARGE} already carries an election — clearing it would destroy an operator's decision`,
  );
}
if (failures.length > 0) {
  console.log(`\nREFUSED\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}

console.log(`\nRecovery persistence walk — ${QUOTE} · ${CHARGE}\n`);

// ── 1 · BEFORE ─────────────────────────────────────────────────────────
const before = await digest();
console.log(`  before        digest ${before.length} bytes`);

// ── 2 · what the operator would have been shown ────────────────────────
const built = await loadQuoteCostingInput(QUOTE);
if (!built.ok) throw new Error(`input failed: ${built.error.code}`);
const proposed = measureRecoveryImpact(built.data, CHARGE, "included");
if (proposed === null) {
  console.log(`  REFUSED — ${CHARGE} is not present on this quote`);
  process.exit(1);
}
console.log(
  `  preview       ${proposed.governedRecovery} recovered` +
    (proposed.perUnit === null ? "" : ` @ ${proposed.perUnit}/unit x ${proposed.tierQuantity}`) +
    `  ·  total ${proposed.customerTotalBefore.toFixed(2)} → ${proposed.customerTotalAfter.toFixed(2)}`,
);

// ── 3 · PERSIST ────────────────────────────────────────────────────────
const actor = (await db.execute(sql`
  select id::text as id from users order by created_at limit 1
`)) as unknown as { id: string }[];

await db.execute(sql`
  insert into quote_charge_recovery (quote_id, charge_key, mode, elected_by_user_id)
  values (${QUOTE}::uuid, ${CHARGE}, 'included', ${actor[0].id}::uuid)
`);
console.log(`  persisted     election row written`);

// ── 4 · RELOAD, on a fresh read ────────────────────────────────────────
const reloaded = await getCostingBundle(QUOTE);
if (!reloaded.ok) throw new Error(`reload failed: ${reloaded.error.code}`);
const isLeaf = leafPredicate(reloaded.data.skus);

const row = buildRecoveryWorkspace({
  costing: reloaded.data.costing,
  isLeaf,
  elections: reloaded.data.chargeElections ?? [],
  allocationStates: [
    ...new Set(
      ((reloaded.data.production ?? []) as { allocateServiceFeesToCost?: boolean | null }[]).map(
        (p) => p.allocateServiceFeesToCost === true,
      ),
    ),
  ],
}).find((r) => r.chargeKey === CHARGE);

if (row === undefined) failures.push("the reloaded workspace has no row for this charge");
else {
  console.log(`  reloaded      source=${row.source} placements=${row.placements.join(",")}`);
  if (row.source !== "election") {
    failures.push(`reloaded as '${row.source}' — the persisted election did not reach the read path`);
  }
  if (row.electedMode !== "included") {
    failures.push(`reloaded mode is ${row.electedMode}, not the one written`);
  }
}

const frozen = projectFrozenInstructions(reloaded.data.costing, isLeaf).filter(
  (i) => i.chargeKey === CHARGE && i.treatmentSource === "election",
);
if (frozen.length === 0) {
  failures.push("no ELECTED instruction would be frozen after the reload");
} else {
  console.log(
    `  instruction   ${frozen[0].treatment} · ${frozen[0].treatmentSource} · perUnit=${frozen[0].amortizedPerUnit} qty=${frozen[0].tierQuantity}`,
  );
  if (frozen[0].amortizedPerUnit === null) {
    failures.push("the elected instruction froze no per-unit basis");
  }
}

// The economics the preview promised are the economics that landed.
const landedTotal = (reloaded.data.costing.quoteRollup ?? []).length;
if (landedTotal > 0 && proposed.tiers.length > 0) {
  // Re-loaded so the "before" of this measurement is the PERSISTED state --
  // which is what the preview promised the total would become.
  const rebuilt = await loadQuoteCostingInput(QUOTE);
  const after = rebuilt.ok
    ? measureRecoveryImpact(rebuilt.data, CHARGE, "included")
    : null;
  if (after && cents(after.customerTotalBefore) !== cents(proposed.customerTotalAfter)) {
    failures.push(
      `the preview promised ${proposed.customerTotalAfter.toFixed(2)} and the persisted state is ${after.customerTotalBefore.toFixed(2)}`,
    );
  } else {
    console.log(`  landed        the promised total is the persisted total`);
  }
}

// ── 5 · CLEAR ──────────────────────────────────────────────────────────
await db.execute(sql`
  delete from quote_charge_recovery
   where quote_id = ${QUOTE}::uuid and charge_key = ${CHARGE}
`);
console.log(`  cleared       election row removed`);

// ── 6 · LEGACY RESTORATION, byte-for-byte ──────────────────────────────
const after = await digest();
if (after === before) {
  console.log(`  restored      digest identical (${after.length} bytes)`);
} else {
  failures.push("clearing did NOT restore the quote — the digest moved");
  console.log(`  restored      MISMATCH: ${before.length} vs ${after.length} bytes`);
}

const left = (await db.execute(sql`
  select count(*)::int as n from quote_charge_recovery where quote_id = ${QUOTE}::uuid
`)) as unknown as { n: number }[];
console.log(`  left behind   ${left[0].n} election row(s)`);
if (left[0].n !== 0) failures.push(`${left[0].n} election rows left on the quote`);

console.log(
  failures.length === 0
    ? `\nPASS — persisted, reloaded as elected, froze a basis, cleared, restored byte-for-byte\n`
    : `\nFAIL\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
