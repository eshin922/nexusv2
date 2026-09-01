/**
 * The frozen ELECTION table collapsed two elections of one charge type.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * `quote_snapshot_charge_recovery` was keyed `(snapshot_id, charge_key)` — one
 * row per charge TYPE per snapshot. `quote_charge_recovery`, the live table it
 * freezes, is keyed on `charge_instance_id`. So a quote electing the same type
 * on two different components holds two elections, and freezing them tried to
 * write one key twice:
 *
 *   23505  duplicate key value violates unique constraint
 *          "quote_snapshot_charge_recovery_pk"
 *   Key (snapshot_id, charge_key)=(..., print_plates) already exists.
 *
 * The whole send transaction rolled back. Not a partial freeze — nothing was
 * written, which is why it surfaced as an opaque 500 with a clean database
 * behind it.
 *
 * ── WHY IT SURVIVED ─────────────────────────────────────────────────────
 *
 * It needs two ELECTED charges of ONE type on ONE quote. Until O3 no quote had
 * ever had two component charges of the same type at all — the population had
 * component instances with zero tier rows, so they were never costed, never
 * elected, and never frozen.
 *
 * Third instance of the same shape in this corpus, all found by O3:
 *
 *   #537  the send gate demanded a column nothing could write
 *   #538  two key namespaces one character apart
 *   here  the freeze of an election was narrower than the election
 *
 * Each held only because nothing had reached it (Pattern 56).
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────
 *
 * The grain, at the schema and at the writer. The end-to-end proof is O3
 * itself: a real send of a quote carrying two `print_plates` elections on two
 * components with two different treatments.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");
/** Comments stripped — these modules explain the old grain on purpose. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SCHEMA = "src/db/schema.ts";
const MIGRATION = "drizzle/0118_snapshot_election_instance_grain.sql";

function snapshotElectionTable(src: string): string {
  const start = src.indexOf("export const quoteSnapshotChargeRecovery");
  assert.ok(start >= 0, "the snapshot election table must exist");
  const end = src.indexOf("export const", start + 10);
  return src.slice(start, end === -1 ? undefined : end);
}

// ══════════════════════════════════════════════════════════════════════
// The grain
// ══════════════════════════════════════════════════════════════════════

test("the frozen election carries the instance it froze", () => {
  const t = snapshotElectionTable(code(SCHEMA));
  assert.match(t, /chargeInstanceId: uuid\("charge_instance_id"\)/);
  assert.match(t, /references\(\s*\(\) => quoteChargeInstances\.id/);
});

test("the old charge-key primary key is gone", () => {
  const t = snapshotElectionTable(code(SCHEMA));
  assert.doesNotMatch(
    t,
    /primaryKey\(\{ columns: \[t\.snapshotId, t\.chargeKey\] \}\)/,
    "keying the freeze by charge type is the defect itself",
  );
  assert.match(t, /id: uuid\("id"\)\.primaryKey\(\)/);
});

test("each era keeps its own uniqueness", () => {
  // Two partial uniques, not one key. Post-migration rows are one per elected
  // INSTANCE; pre-migration rows keep exactly the guarantee the old primary key
  // gave them, so history cannot be violated by a stray backfill.
  const t = snapshotElectionTable(code(SCHEMA));
  assert.match(
    t,
    /uniqueIndex\("quote_snapshot_charge_recovery_instance_uq"\)[\s\S]{0,160}is not null/,
  );
  assert.match(
    t,
    /uniqueIndex\("quote_snapshot_charge_recovery_legacy_uq"\)[\s\S]{0,160}is null/,
  );
});

test("the instance is nullable, and only for history", () => {
  const t = snapshotElectionTable(code(SCHEMA));
  // A NOT NULL would be a tightening migration against rows that cannot supply
  // a value — the election they froze may since have been superseded, and
  // inventing an id would dress a guess as a record.
  assert.doesNotMatch(t, /charge_instance_id"\)[\s\S]{0,80}\.notNull\(\)/);
});

test("a frozen election outlives the charge it came from", () => {
  const t = snapshotElectionTable(code(SCHEMA));
  assert.match(t, /onDelete: "set null"/);
  assert.doesNotMatch(
    t,
    /chargeInstanceId[\s\S]{0,200}onDelete: "cascade"/,
    "deleting a draft-side charge must not delete the record of what was quoted",
  );
});

// ══════════════════════════════════════════════════════════════════════
// The writer
// ══════════════════════════════════════════════════════════════════════

test("the freeze writer carries the instance through", () => {
  const src = code("src/app/actions/quotes.ts");
  assert.match(
    src,
    /insert\(quoteSnapshotChargeRecovery\)[\s\S]{0,320}chargeInstanceId: e\.chargeInstanceId/,
    "dropping it here is what collapsed two elections into one key",
  );
});

test("the freeze reads the live table at ITS grain", () => {
  // The live elections are selected whole and mapped; nothing dedupes or groups
  // by charge key on the way in, which would reintroduce the collapse above the
  // database rather than in it.
  const src = code("src/app/actions/quotes.ts");
  const block = src.slice(
    src.indexOf("const electionsToFreeze"),
    src.indexOf("const electionsToFreeze") + 700,
  );
  assert.match(block, /from\(quoteChargeRecovery\)/);
  for (const collapsing of [/new Map\(/, /groupBy/, /\.reduce\(/, /dedupe/i]) {
    assert.doesNotMatch(block, collapsing, "the freeze must not re-collapse by key");
  }
});

// ══════════════════════════════════════════════════════════════════════
// The migration
// ══════════════════════════════════════════════════════════════════════

test("the migration is RELAXING, so it is safe ahead of the code", () => {
  // The deployed writer supplies no instance id, so its rows land NULL and stay
  // bound by the legacy partial unique — which reproduces the old key exactly.
  // That is what makes migration-then-code the correct order here rather than
  // the other way round.
  const m = read(MIGRATION);
  assert.match(m, /ADD COLUMN "charge_instance_id" uuid;/);
  assert.doesNotMatch(m, /SET NOT NULL/, "a tightening step would break the deployed writer");
  assert.doesNotMatch(m, /DROP COLUMN/, "nothing is destroyed here");
  assert.match(m, /DROP CONSTRAINT "quote_snapshot_charge_recovery_pk"/);
  assert.match(m, /WHERE "charge_instance_id" IS NOT NULL/);
  assert.match(m, /WHERE "charge_instance_id" IS NULL/);
});

test("the migration is registered in the journal at the resolved index", () => {
  // Resolved against `_journal.json`, never from prose — a brief's implicit
  // counter drifts, and a duplicated index is a migration nobody runs.
  const j = JSON.parse(read("drizzle/meta/_journal.json"));
  const entry = j.entries.find(
    (e: { tag: string }) => e.tag === "0118_snapshot_election_instance_grain",
  );
  assert.ok(entry, "the migration must be journalled");
  const idxs = j.entries.map((e: { idx: number }) => e.idx);
  assert.equal(new Set(idxs).size, idxs.length, "indices must be unique");
  // ABOVE THE HIGH-WATER MARK, which is the property that decides whether the
  // migrator will run it. drizzle-orm reads `max(created_at)` from the journal
  // table and executes every entry whose `when` exceeds it; an entry below the
  // mark is structurally unreachable and would never apply.
  const others = j.entries.filter(
    (e: { tag: string }) => e.tag !== "0118_snapshot_election_instance_grain",
  );
  const previousMax = Math.max(...others.map((e: { when: number }) => e.when));
  assert.ok(
    entry.when > previousMax,
    `the entry must sit above the previous high-water mark (${entry.when} vs ${previousMax})`,
  );

  // NOT asserted: that the whole journal is ordered by `when`. It is not, and
  // was not before this change — `0025_drop_auto_migrate_artifact` carries a
  // later stamp than `0026_r6_2_freight_legs_additive`, both from 2026. Left
  // alone deliberately: both sit far below the high-water mark, so neither is
  // reachable, and rewriting a historical stamp to satisfy a tidier invariant
  // would edit the record of when something actually ran. Asserting the global
  // property here would have made this file fail on a pre-existing fact it did
  // not cause and must not fix.
});
