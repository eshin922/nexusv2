/**
 * SEND atomicity — does a failed ordered-spec freeze leave partial send state?
 * Everything ROLLED BACK.
 *
 * Frozen specs are keyed to `quote_snapshot_id`, so the snapshot row must exist
 * before they can be written. That ordering is exactly what makes the question
 * worth asking: if the freeze fails AFTER the snapshot insert, does a usable
 * sent offer survive without the specifications it was ordered under?
 *
 * This exercises the REAL transaction boundary — the same `db.transaction`
 * sendQuote uses — writing the same tables in the same order, then failing at
 * the spec step on purpose.
 *
 * A CONTROL runs the identical sequence WITHOUT the induced failure, so a clean
 * "nothing persisted" cannot be produced by a harness that never wrote anything.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const PROBE_SNAP = "00000000-0000-0000-0000-00000000fee1";
const LEAF_A = "00000000-0000-0000-0000-00000000fea1";
const LEAF_B = "00000000-0000-0000-0000-00000000fea2";

type R = { name: string; got: string; want: string };
const results: R[] = [];
const rec = (n: string, g: string, w: string) => results.push({ name: n, got: g, want: w });

async function counts() {
  const r = (await db.execute(sql`
    select
      (select count(*)::int from quote_snapshots where id = ${PROBE_SNAP}::uuid) snaps,
      (select count(*)::int from quote_snapshot_leaf_specs
         where quote_snapshot_id = ${PROBE_SNAP}::uuid) specs,
      (select count(*)::int from quote_snapshot_tier_totals
         where quote_snapshot_id = ${PROBE_SNAP}::uuid) totals
  `)) as unknown as Array<{ snaps: number; specs: number; totals: number }>;
  return r[0];
}

/**
 * The send sequence, in sendQuote's order: snapshot -> ordered specs ->
 * commercial state. `failAt` induces a realistic failure rather than a thrown
 * string — a duplicate (snapshot, leaf) is precisely what a double-freeze looks
 * like, and it is refused by the same constraint that guards production.
 */
async function runSend(opts: { failAtSpecs: boolean; commit: boolean }) {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into quote_snapshots (id, quote_id, version_number, sent_at, effective_from)
        values (${PROBE_SNAP}::uuid, (select id from quotes limit 1), 998, now(), now())`);

      await tx.execute(sql`
        insert into quote_snapshot_leaf_specs
          (quote_snapshot_id, quote_leaf_id, spec_values, content_hash, disposition)
        values (${PROBE_SNAP}::uuid, ${LEAF_A}::uuid, '{}'::jsonb, 'h-a', 'specified')`);

      if (opts.failAtSpecs) {
        // Same (snapshot, leaf) again — the unique constraint refuses, which is
        // the real failure mode of a freeze running twice over one offer.
        await tx.execute(sql`
          insert into quote_snapshot_leaf_specs
            (quote_snapshot_id, quote_leaf_id, spec_values, content_hash, disposition)
          values (${PROBE_SNAP}::uuid, ${LEAF_A}::uuid, '{}'::jsonb, 'h-dup', 'specified')`);
      } else {
        await tx.execute(sql`
          insert into quote_snapshot_leaf_specs
            (quote_snapshot_id, quote_leaf_id, spec_values, content_hash, disposition)
          values (${PROBE_SNAP}::uuid, ${LEAF_B}::uuid, '{}'::jsonb, 'h-b', 'specified')`);
      }

      // Commercial state, written after the specs — as in sendQuote.
      await tx.execute(sql`
        insert into quote_snapshot_tier_totals
          (quote_snapshot_id, tier_id, tier_label, quantity, unit_subtotal,
           otc_subtotal, tier_commercial_total, total_is_provisional)
        values (${PROBE_SNAP}::uuid, gen_random_uuid(), 'probe', 1,
                '0.00', '0.00', '0.00', false)`);

      if (!opts.commit) throw new Error("__rollback__");
    });
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return m === "__rollback__" ? null : m;
  }
}

async function main() {
  const before = await counts();
  if (before.snaps + before.specs + before.totals !== 0) {
    console.error("probe ids already present; refusing to run");
    process.exit(1);
  }

  // ── CONTROL ────────────────────────────────────────────────────────────
  // The same sequence, no induced failure, still rolled back. Proves the
  // harness DOES write — otherwise "nothing persisted" below is vacuous.
  const control = await runSend({ failAtSpecs: false, commit: false });
  rec("CONTROL sequence ran without error", control ? `err: ${control.slice(0, 40)}` : "clean", "clean");
  const afterControl = await counts();
  rec("CONTROL persisted nothing (rolled back)",
    `${afterControl.snaps}/${afterControl.specs}/${afterControl.totals}`, "0/0/0");

  // ── INDUCED FAILURE AT THE SPEC FREEZE ─────────────────────────────────
  const failed = await runSend({ failAtSpecs: true, commit: true });
  rec("spec freeze failed as induced", failed ? "failed" : "SUCCEEDED", "failed");
  if (failed) console.log(`      ${failed.split("\n")[0].slice(0, 110)}`);

  const after = await counts();
  rec("no usable send snapshot remains", String(after.snaps), "0");
  rec("no partial ordered-spec set remains", String(after.specs), "0");
  rec("no frozen commercial state remains", String(after.totals), "0");

  console.log("SEND ATOMICITY — induced ordered-spec failure after snapshot creation\n");
  let failedCount = 0;
  for (const r of results) {
    const ok = r.got === r.want;
    if (!ok) failedCount++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${r.name.padEnd(40)} ${ok ? r.got : `got ${r.got}, want ${r.want}`}`);
  }
  console.log(
    `\nVERDICT: ${failedCount === 0 ? "snapshot, ordered specs and commercial state commit together or not at all." : `${failedCount} failure(s).`}`,
  );
  process.exit(failedCount === 0 ? 0 : 1);
}

void main();
