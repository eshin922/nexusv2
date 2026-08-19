/**
 * #300 lifecycle proof — checks 4, 5 and 6 of the review.
 *
 * Everything destructive runs inside a transaction that is ROLLED BACK, so the
 * script proves properties of the live system without leaving a mark on it.
 * The rollback is not a convenience: the whole claim is that the frozen record
 * does not move, and a proof that moved it would be measuring its own damage.
 *
 *   usage: freeze-lifecycle-proof <quoteId>
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createHash } from "node:crypto";

const quoteId = process.argv[2];
if (!quoteId) {
  console.error("usage: freeze-lifecycle-proof <quoteId>");
  process.exit(1);
}

const rows = <T,>(r: unknown) => r as unknown as T[];
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * A canonical rendering of the entire frozen matrix.
 *
 * Every persisted field, ordered deterministically, hashed. Comparing digests
 * rather than spot-checking a total is deliberate: a spot check can pass while
 * a rate, an allocation state or a pricing state underneath it has moved.
 */
async function matrixDigest(tx: Exec): Promise<{ digest: string; body: string }> {
  const cells = rows<Record<string, unknown>>(
    await tx.execute(sql`
      select s.version_number, ln.position, ln.line_kind::text, ln.display_name,
             coalesce(ln.display_sku,'') as display_sku,
             coalesce(ln.service_identity::text,'') as service_identity,
             coalesce(ln.owning_assembly_id::text,'') as owning_assembly_id,
             coalesce(ln.quote_leaf_id::text,'') as quote_leaf_id,
             coalesce(ln.netsuite_item_id,'') as netsuite_item_id,
             ct.tier_label, coalesce(ct.quantity, -1) as quantity,
             ct.pricing_state::text,
             coalesce(ct.unit_rate::text,'') as unit_rate,
             coalesce(ct.line_amount::text,'') as line_amount,
             coalesce(ct.allocation_state::text,'') as allocation_state
        from quote_snapshots s
        join quote_snapshot_lines ln on ln.quote_snapshot_id = s.id
        join quote_snapshot_line_tiers ct on ct.quote_snapshot_line_id = ln.id
       where s.quote_id = ${quoteId}::uuid
       order by s.version_number, ln.position, ct.quantity, ct.tier_label`),
  );
  const totals = rows<Record<string, unknown>>(
    await tx.execute(sql`
      select s.version_number, t.tier_label, coalesce(t.quantity,-1) as quantity,
             t.unit_subtotal::text, t.otc_subtotal::text,
             t.tier_commercial_total::text, t.total_is_provisional
        from quote_snapshots s
        join quote_snapshot_tier_totals t on t.quote_snapshot_id = s.id
       where s.quote_id = ${quoteId}::uuid
       order by s.version_number, t.quantity, t.tier_label`),
  );
  const body = JSON.stringify({ cells, totals });
  return { digest: createHash("sha256").update(body).digest("hex"), body };
}

/** Runs `fn` inside a transaction and always rolls back. */
async function inRollback<T>(fn: (tx: Exec) => Promise<T>): Promise<T> {
  const SENTINEL = "__rollback__";
  let out!: T;
  try {
    await db.transaction(async (tx) => {
      out = await fn(tx as unknown as Exec);
      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  return out;
}

const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

// ══ baseline ═════════════════════════════════════════════════════════════
const base = await matrixDigest(db as unknown as Exec);
const [meta] = rows<{ status: string; v: number; snaps: number; lines: number; cells: number; totals: number }>(
  await db.execute(sql`
    select q.status::text as status, q.version_number as v,
           (select count(*)::int from quote_snapshots s where s.quote_id=q.id) as snaps,
           (select count(*)::int from quote_snapshot_lines ln
              join quote_snapshots s on s.id=ln.quote_snapshot_id where s.quote_id=q.id) as lines,
           (select count(*)::int from quote_snapshot_line_tiers ct
              join quote_snapshot_lines ln on ln.id=ct.quote_snapshot_line_id
              join quote_snapshots s on s.id=ln.quote_snapshot_id where s.quote_id=q.id) as cells,
           (select count(*)::int from quote_snapshot_tier_totals t
              join quote_snapshots s on s.id=t.quote_snapshot_id where s.quote_id=q.id) as totals
      from quotes q where q.id=${quoteId}::uuid`),
);
console.log(`\nquote ${quoteId}`);
console.log(`  status=${meta.status} v${meta.v} · snapshots=${meta.snaps} · frozen lines=${meta.lines} cells=${meta.cells} tierTotals=${meta.totals}`);
console.log(`  matrix digest ${base.digest.slice(0, 32)}…\n`);

if (meta.snaps === 0) {
  console.log("No snapshot yet — send the quote first.");
  process.exit(0);
}

// ══ CHECK 4 · internal consistency of the persisted record ═══════════════
console.log("── CHECK 4 · the frozen record is internally consistent ──");

const [one] = rows<{ current: number }>(
  await db.execute(sql`select count(*)::int as current from quote_snapshots
                        where quote_id=${quoteId}::uuid and superseded_at is null`),
);
check(one.current === 1, "exactly one current snapshot matrix for this send", `current=${one.current}`);

const recon = rows<{ tier_label: string; stated: string; summed: string }>(
  await db.execute(sql`
    select t.tier_label, t.tier_commercial_total::text as stated,
           coalesce(sum(ct.line_amount),0)::text as summed
      from quote_snapshots s
      join quote_snapshot_tier_totals t on t.quote_snapshot_id = s.id
      left join quote_snapshot_lines ln on ln.quote_snapshot_id = s.id
      left join quote_snapshot_line_tiers ct
             on ct.quote_snapshot_line_id = ln.id and ct.tier_id = t.tier_id
                and ct.pricing_state = 'priced'
     where s.quote_id = ${quoteId}::uuid and s.superseded_at is null
     group by t.tier_label, t.tier_commercial_total, t.quantity order by t.quantity`),
);
for (const r of recon)
  check(Number(r.stated) === Number(r.summed), `${r.tier_label}: total = Σ its own priced cells`,
        `${r.stated} vs ${r.summed}`);

const split = rows<{ tier_label: string; ok: boolean; unit: string; otc: string; total: string }>(
  await db.execute(sql`
    select tier_label, (unit_subtotal + otc_subtotal = tier_commercial_total) as ok,
           unit_subtotal::text as unit, otc_subtotal::text as otc, tier_commercial_total::text as total
      from quote_snapshot_tier_totals t
      join quote_snapshots s on s.id = t.quote_snapshot_id
     where s.quote_id=${quoteId}::uuid and s.superseded_at is null order by t.quantity`),
);
for (const r of split)
  check(r.ok, `${r.tier_label}: tier_commercial_total = unit + OTC`, `${r.unit} + ${r.otc} = ${r.total}`);

const [states] = rows<{ bad: number; qor: number; priced: number }>(
  await db.execute(sql`
    select count(*) filter (where (ct.pricing_state='priced')
                              <> (ct.unit_rate is not null and ct.line_amount is not null))::int as bad,
           count(*) filter (where ct.pricing_state='quote_on_request')::int as qor,
           count(*) filter (where ct.pricing_state='priced')::int as priced
      from quote_snapshot_line_tiers ct
      join quote_snapshot_lines ln on ln.id = ct.quote_snapshot_line_id
      join quote_snapshots s on s.id = ln.quote_snapshot_id
     where s.quote_id=${quoteId}::uuid and s.superseded_at is null`),
);
check(states.bad === 0, "pricing_state agrees with amount nullity on every cell", `violations=${states.bad}`);
check(states.qor > 0, "at least one cell is explicitly quote_on_request", `qor=${states.qor} priced=${states.priced}`);

// ══ CHECK 5 · the record does not move with live economics ═══════════════
console.log("\n── CHECK 5 · the frozen record is independent of live economics ──");

const after = await inRollback(async (tx) => {
  // Move everything a draft edit could possibly move. If the frozen matrix is
  // in any way derived at read time, one of these will show.
  await tx.execute(sql`update assembly_leaf_inputs ali set unit_cost = coalesce(unit_cost,0) + 99.99
                        from quote_tiers t where t.id = ali.tier_id and t.quote_id = ${quoteId}::uuid`);
  await tx.execute(sql`update assembly_production_inputs api
                          set setup_fee_total = coalesce(setup_fee_total,0) + 5000,
                              rd_total = coalesce(rd_total,0) + 5000,
                              allocate_service_fees_to_cost = not allocate_service_fees_to_cost
                        from quote_tiers t where t.id = api.tier_id and t.quote_id = ${quoteId}::uuid`);
  await tx.execute(sql`update quotes set global_price_adj_pct = coalesce(global_price_adj_pct,0) + 0.25,
                                          target_margin_pct = 0.99
                        where id = ${quoteId}::uuid`);
  await tx.execute(sql`update markup_defaults set default_markup_pct = 0.9 where category = 'Production'`);
  const [moved] = rows<{ n: number }>(await tx.execute(
    sql`select count(*)::int as n from assembly_leaf_inputs ali
          join quote_tiers t on t.id = ali.tier_id
         where t.quote_id = ${quoteId}::uuid and ali.unit_cost >= 99.99`));
  const d = await matrixDigest(tx);
  return { digest: d.digest, moved: moved.n };
});
check(after.moved > 0, "the mutation really landed inside the transaction", `${after.moved} cost cells moved`);
check(after.digest === base.digest, "frozen matrix byte-identical after live costs, markup and settings moved",
      `${after.digest.slice(0, 16)}… vs ${base.digest.slice(0, 16)}…`);

const post = await matrixDigest(db as unknown as Exec);
check(post.digest === base.digest, "and unchanged outside the transaction (rollback clean)");

// ══ CHECK 6 · ACCEPT selects; it does not recompute ══════════════════════
console.log("\n── CHECK 6 · the accepted total is a selection from the frozen column ──");
console.log("  (acceptance simulated in a rolled-back transaction — the real path");
console.log("   fires a production HubSpot deal-stage push and is not exercised)");

const tiers = rows<{ tier_id: string; tier_label: string; total: string; prov: boolean }>(
  await db.execute(sql`
    select t.tier_id::text, t.tier_label, t.tier_commercial_total::text as total,
           t.total_is_provisional as prov
      from quote_snapshot_tier_totals t
      join quote_snapshots s on s.id = t.quote_snapshot_id
     where s.quote_id=${quoteId}::uuid and s.superseded_at is null order by t.quantity`),
);

const { readAcceptedCommercialTotal } = await import("@/lib/commercial-freeze");

for (const t of tiers) {
  const r = await inRollback(async (tx) => {
    await tx.execute(sql`update quotes set customer_accepted_tier_id = ${t.tier_id}::uuid
                          where id = ${quoteId}::uuid`);
    const read = await readAcceptedCommercialTotal(
      tx as unknown as Parameters<typeof readAcceptedCommercialTotal>[0],
      quoteId,
    );
    const d = await matrixDigest(tx);
    return { read, digest: d.digest };
  });
  check(
    r.read !== null && r.read.total === Number(t.total) && r.read.tierId === t.tier_id,
    `accepting ${t.tier_label} reads exactly its frozen total`,
    `read=${r.read?.total ?? "null"} frozen=${t.total}`,
  );
  check(r.digest === base.digest, `  …and leaves every other frozen tier untouched`);
}

const noAccept = await readAcceptedCommercialTotal(
  db as unknown as Parameters<typeof readAcceptedCommercialTotal>[0],
  quoteId,
);
check(noAccept === null, "with no accepted tier the read is null, never a substituted recomputation");

console.log(
  fail.length === 0
    ? "\nALL CHECKS PASS\n"
    : `\n${fail.length} CHECK(S) FAILED:\n  ${fail.join("\n  ")}\n`,
);
process.exit(fail.length === 0 ? 0 : 1);
