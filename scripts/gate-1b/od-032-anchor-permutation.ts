/**
 * OD-032 — the governed OD-028 anchor-permutation gate.
 *
 * The disposition's load-bearing clause:
 *
 *   > OD-028 anchor movement must have no ability to change election identity.
 *
 * A structural test can argue that synthesis never reads the anchor. This
 * PERFORMS the movement: it rewrites the `position` values that decide which
 * leaf anchors per-assembly production, re-reads identity, mapping AND resolved
 * recovery, and asserts none of the three moved.
 *
 * ── IT IS A PHASE GATE, NOT ROUTINE CI ───────────────────────────────────
 *
 * It writes. It is required at every OD-032 phase boundary that changes charge
 * identity, ownership, election mapping, copy semantics or freeze behaviour,
 * and it is deliberately kept out of `verify:ci` — a writing test running
 * automatically against the shared production database is a bad trade at any
 * frequency.
 *
 * A phase's earlier PASS does not carry across a later boundary. Phase 1b moves
 * the election primary key and tightens the identity constraints, so phase 1's
 * result says nothing about it.
 *
 * ── TWO PERMUTATIONS, AND THE SECOND IS THE SHARP ONE ────────────────────
 *
 *   1. REVERSE   every position distinct, order inverted. Any leaf that
 *                anchored under "lowest position wins" now sorts last.
 *   2. ALL-TIED  every position identical. This is the OD-028 shape itself:
 *                with no tiebreak, the anchor is decided by physical row order
 *                alone, which is the condition the finding is about. A pass
 *                under reverse-ordering alone would leave the actual ambiguous
 *                state untested.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────
 *
 * Draft-only by refusal, restored in a `finally`, and the restore is VERIFIED
 * before exit. An unverified restore on a shared production database is a hope,
 * not a restore. Exit code is non-zero if the restore did not take, so a failed
 * cleanup cannot be mistaken for a pass.
 *
 *   usage: od-032-anchor-permutation <quoteId>
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getQuoteCosting } from "@/app/actions/costing";

const quoteId = process.argv[2];
if (!quoteId) {
  console.error("usage: od-032-anchor-permutation <quoteId>");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);

type Row = Record<string, unknown>;
const rows = (r: unknown) => r as unknown as Row[];

const [quote] = rows(await db.execute(sql`
  SELECT id, status, scenario_label FROM quotes WHERE id = ${quoteId}
`));
if (!quote) throw new Error(`no quote ${quoteId}`);
if (quote.status !== "draft") {
  throw new Error(`refusing to permute a ${quote.status} quote — draft only`);
}
console.log(`subject   : ${quote.scenario_label} (${quote.status})`);

/**
 * Identity, mapping and RESOLUTION — the three things that must not move.
 *
 * Resolution is captured through the engine rather than the tables, because
 * "the rows look the same" and "the quote still prices the same" are different
 * claims and only the second is what an operator experiences.
 */
async function capture() {
  const instances = rows(await db.execute(sql`
    SELECT id, charge_key, owner_ref, label
      FROM quote_charge_instances WHERE quote_id = ${quoteId}
     ORDER BY charge_key, owner_ref, id
  `));
  const elections = rows(await db.execute(sql`
    SELECT charge_key, mode, charge_instance_id
      FROM quote_charge_recovery WHERE quote_id = ${quoteId}
     ORDER BY charge_key
  `));

  const r = await getQuoteCosting(quoteId);
  let resolution: unknown = { unresolved: !r.ok };
  if (r.ok) {
    const d = r.data as unknown as {
      skuRollups?: Array<{ perTier?: Array<{ constructed?: { charges?: Array<Record<string, unknown>> } }> }>;
      quoteRollup?: Array<{ label?: string; blendedMarginPct?: number | null; totalRevenue?: number | null }>;
    };
    const charges: string[] = [];
    for (const sku of d.skuRollups ?? []) {
      for (const pt of sku.perTier ?? []) {
        for (const c of pt.constructed?.charges ?? []) {
          charges.push(`${c.chargeKey}|${c.placement}|${c.source}|${c.cost}|${c.recoverableSell}`);
        }
      }
    }
    charges.sort();
    // TIER TOTALS ARE COMPARED AT COMMERCIAL PRECISION, AND THE RAW VALUES
    // ARE KEPT SO NOTHING IS HIDDEN.
    //
    // A tier total is a SUM over leaves, and IEEE-754 addition is not
    // associative — so permuting leaf order legitimately changes the last bits
    // of the accumulation. Measured on this subject: Tier 2 read
    // 52520.600000000006 in one order and 52520.6 in another, with every
    // per-charge value byte-identical.
    //
    // That is a pre-existing property of the costing engine and has nothing to
    // do with charge identity. Comparing tier sums bit-for-bit would make this
    // gate fail on float accumulation and report it as an identity defect —
    // a measurement taken with too sharp an instrument rather than a finding.
    // The CLAIM under test is "recovery resolution unchanged", a commercial
    // claim, so tier sums are compared at cents and margin at basis points,
    // and `tiersRaw` carries the unrounded values into the output.
    //
    // Per-charge values are still compared EXACTLY. They are not sums, so any
    // movement in them would be real.
    resolution = {
      charges,
      tiers: (d.quoteRollup ?? [])
        .map(
          (t) =>
            `${t.label}|${(t.totalRevenue ?? 0).toFixed(2)}|${((t.blendedMarginPct ?? 0) * 10000).toFixed(2)}`,
        )
        .sort(),
      tiersRaw: (d.quoteRollup ?? [])
        .map((t) => `${t.label}|${t.totalRevenue}|${t.blendedMarginPct}`)
        .sort(),
    };
  }

  return { instances, elections, resolution };
}

const before = await capture();
const positions = rows(await db.execute(sql`
  SELECT id, position FROM quote_leaves WHERE quote_id = ${quoteId} ORDER BY id
`));
if (positions.length < 2) {
  throw new Error(`subject has ${positions.length} leaf/leaves — need at least 2 to permute an anchor`);
}
console.log(`leaves    : ${positions.length}`);
console.log(`positions : ${positions.map((p) => p.position).join(",")} (original)`);

const results: { name: string; identity: boolean; mapping: boolean; resolution: boolean }[] = [];
let restored = false;

async function permuteTo(name: string, value: (i: number) => number) {
  for (let i = 0; i < positions.length; i++) {
    await db.execute(sql`
      UPDATE quote_leaves SET position = ${value(i)} WHERE id = ${positions[i].id as string}
    `);
  }
  const now = rows(await db.execute(sql`
    SELECT position FROM quote_leaves WHERE quote_id = ${quoteId} ORDER BY id
  `));
  console.log(`\npermutation "${name}" → ${now.map((p) => p.position).join(",")}`);

  const after = await capture();
  const identity = JSON.stringify(before.instances) === JSON.stringify(after.instances);
  const mapping = JSON.stringify(before.elections) === JSON.stringify(after.elections);
  // Compare the commercial projection, not the raw floats — see capture().
  const strip = (r: unknown) => {
    const o = { ...(r as Record<string, unknown>) };
    delete o.tiersRaw;
    return JSON.stringify(o);
  };
  const resolution = strip(before.resolution) === strip(after.resolution);

  console.log(`  instance identity unchanged : ${identity ? "PASS" : "FAIL"}`);
  console.log(`  election mapping unchanged  : ${mapping ? "PASS" : "FAIL"}`);
  console.log(`  recovery resolution unchanged: ${resolution ? "PASS" : "FAIL"}`);
  if (!identity) console.log("    before:", JSON.stringify(before.instances), "\n    after :", JSON.stringify(after.instances));
  if (!mapping) console.log("    before:", JSON.stringify(before.elections), "\n    after :", JSON.stringify(after.elections));
  if (!resolution) {
    console.log("    before:", JSON.stringify(before.resolution));
    console.log("    after :", JSON.stringify(after.resolution));
  }
  // Reported ALWAYS, pass or fail. Float accumulation moving is not a gate
  // failure, but it is a fact about this subject worth seeing rather than
  // silently rounded away.
  const rawMoved =
    JSON.stringify((before.resolution as Record<string, unknown>).tiersRaw) !==
    JSON.stringify((after.resolution as Record<string, unknown>).tiersRaw);
  console.log(
    `  tier float accumulation      : ${rawMoved ? "moved sub-cent — see capture() note" : "identical"}`,
  );

  results.push({ name, identity, mapping, resolution });
}

try {
  // 1 · every position distinct, order inverted.
  await permuteTo("reverse", (i) => positions.length - 1 - i);
  // 2 · every position identical — the OD-028 tie shape, where nothing but
  //     physical row order can decide the anchor.
  await permuteTo("all-tied at 0", () => 0);
} finally {
  for (const p of positions) {
    await db.execute(sql`
      UPDATE quote_leaves SET position = ${p.position as number} WHERE id = ${p.id as string}
    `);
  }
  const check = rows(await db.execute(sql`
    SELECT id, position FROM quote_leaves WHERE quote_id = ${quoteId} ORDER BY id
  `));
  restored = JSON.stringify(check) === JSON.stringify(positions);
  console.log(`\npositions restored          : ${restored ? "PASS" : "FAIL — MANUAL REPAIR NEEDED"}`);
  if (!restored) {
    console.log("  expected:", JSON.stringify(positions));
    console.log("  actual  :", JSON.stringify(check));
  }
}

const allHeld = results.every((r) => r.identity && r.mapping && r.resolution);
console.log(`\nGATE: ${allHeld && restored ? "PASS" : "FAIL"} (${results.length} permutation(s), restore ${restored ? "verified" : "FAILED"})`);
process.exit(allHeld && restored ? 0 : 1);
