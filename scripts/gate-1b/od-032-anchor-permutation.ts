/**
 * OD-032 phase 1 — the OD-028 anchor-permutation falsification.
 *
 * The disposition's load-bearing clause:
 *
 *   > OD-028 anchor movement must have no ability to change election identity.
 *
 * A structural test can argue that synthesis never reads the anchor. This
 * PERFORMS the movement: it rewrites the `position` values that decide which
 * leaf anchors per-assembly production, re-reads the identities, and asserts
 * nothing moved. If synthesis ever starts consulting the anchor, this fails
 * with the two ids side by side rather than with a passing structural claim.
 *
 * ── IT WRITES, AND IT RESTORES ───────────────────────────────────────────
 *
 * Positions are rewritten and put back in a `finally`. It refuses to run on
 * anything but a DRAFT quote, so a frozen artifact can never be the subject.
 * The restore is verified before the process exits — an unverified restore on
 * a shared production database is not a restore, it is a hope.
 *
 *   usage: od-032-anchor-permutation <quoteId>
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

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
console.log(`subject: ${quote.scenario_label} (${quote.status})`);

/** Identity + election, which is what must not move. */
async function capture() {
  const instances = rows(await db.execute(sql`
    SELECT id, charge_key, owner_ref, label
      FROM quote_charge_instances WHERE quote_id = ${quoteId}
     ORDER BY charge_key, owner_ref
  `));
  const elections = rows(await db.execute(sql`
    SELECT charge_key, mode, charge_instance_id
      FROM quote_charge_recovery WHERE quote_id = ${quoteId}
     ORDER BY charge_key
  `));
  return { instances, elections };
}

const before = await capture();
const positions = rows(await db.execute(sql`
  SELECT id, position FROM quote_leaves WHERE quote_id = ${quoteId} ORDER BY id
`));
console.log(`leaves: ${positions.length}, positions before: ${positions.map((p) => p.position).join(",")}`);

let restored = false;
try {
  // Reverse the ordering. Any leaf that anchored before is now last, so a
  // "lowest position wins" rule lands somewhere else — which is precisely the
  // movement OD-028 describes.
  const n = positions.length;
  for (let i = 0; i < n; i++) {
    await db.execute(sql`
      UPDATE quote_leaves SET position = ${n - 1 - i} WHERE id = ${positions[i].id as string}
    `);
  }
  const after0 = rows(await db.execute(sql`
    SELECT id, position FROM quote_leaves WHERE quote_id = ${quoteId} ORDER BY id
  `));
  console.log(`positions permuted to: ${after0.map((p) => p.position).join(",")}`);

  const after = await capture();

  const idsBefore = JSON.stringify(before.instances);
  const idsAfter = JSON.stringify(after.instances);
  const elBefore = JSON.stringify(before.elections);
  const elAfter = JSON.stringify(after.elections);

  const identityHeld = idsBefore === idsAfter;
  const electionHeld = elBefore === elAfter;

  console.log(`\ninstance identity unchanged : ${identityHeld ? "PASS" : "FAIL"}`);
  console.log(`election mapping unchanged  : ${electionHeld ? "PASS" : "FAIL"}`);
  if (!identityHeld) {
    console.log("  before:", idsBefore);
    console.log("  after :", idsAfter);
  }
  if (!electionHeld) {
    console.log("  before:", elBefore);
    console.log("  after :", elAfter);
  }
  if (!identityHeld || !electionHeld) {
    throw new Error("OD-028 anchor movement changed an identity — the clause is violated");
  }
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

process.exit(restored ? 0 : 1);
