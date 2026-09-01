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
  // The COLUMN is the claim. 0118 also gave it a foreign key; 0119 removed
  // that, so this asserts the column and the sibling test below asserts the
  // absence of any referential action.
  const t = snapshotElectionTable(code(SCHEMA));
  assert.match(t, /chargeInstanceId: uuid\("charge_instance_id"\)/);
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

test("the frozen instance has NO foreign key at all", () => {
  // 0118 shipped `ON DELETE SET NULL`, copied from the precedent on
  // `quote_snapshot_recovery_instructions`. The precedent does not transfer,
  // and the difference is specific to this table.
  //
  // There NULL is inert: uniqueness is `(snapshot, key, owner, tier)` either
  // way. HERE NULL SELECTS WHICH UNIQUENESS RULE APPLIES, so nulling a modern
  // row migrates it into the legacy namespace and binds it to a rule it was
  // never written under.
  //
  // Measured pre-0119 against Postgres, on O3's exact shape — two print_plates
  // elections in one snapshot — by
  // `scripts/gate-1b/snapshot-election-grain-falsify.ts`:
  //
  //   23505  duplicate key value violates unique constraint
  //          "quote_snapshot_charge_recovery_legacy_uq"
  //
  // raised by DELETING A CHARGE. Two failures in one: the collision 0118 was
  // written to remove, reintroduced by a delete rather than a send; and a
  // frozen snapshot forbidding ordinary draft-side editing, which is the
  // RESTRICT behaviour the disposition rules out. Absent the collision it would
  // instead have silently erased the provenance.
  //
  // All three referential actions fail the same way, so there is no constraint.
  // SCOPED TO THE FIELD, not the table. `snapshot_id` cascades on purpose —
  // deleting a snapshot should delete its frozen rows — and a table-wide
  // `doesNotMatch(/onDelete: "cascade"/)` flagged that correct declaration as
  // a defect on the first run here. The claim is about ONE column.
  const t = snapshotElectionTable(code(SCHEMA));
  const field = t.slice(t.indexOf("chargeInstanceId:"), t.indexOf("},"));
  assert.ok(field.length > 0, "the field must be findable");
  assert.doesNotMatch(field, /references\(/, "frozen provenance is not a live dependency");
  assert.doesNotMatch(field, /onDelete/);
  // The column itself stays.
  assert.match(field, /chargeInstanceId: uuid\("charge_instance_id"\)/);
  // And the snapshot FK is untouched — this repair narrows one column, not the
  // table's relationship to the snapshot that owns it.
  assert.match(t, /snapshotId: uuid\("snapshot_id"\)[\s\S]{0,120}onDelete: "cascade"/);
});

test("0119 drops the constraint and changes nothing else", () => {
  const m = read("drizzle/0119_snapshot_election_frozen_provenance.sql");
  assert.match(m, /DROP CONSTRAINT "quote_snapshot_charge_recovery_instance_fk"/);
  // No backfill: a pre-0118 row carries NULL because nothing recorded its
  // instance, and deriving one from `charge_key` would dress a guess as a
  // record. Both partial uniques stay exactly as 0118 left them.
  assert.doesNotMatch(m, /UPDATE /i, "history must not be backfilled");
  assert.doesNotMatch(m, /DROP INDEX/i, "both partial uniques survive");
  assert.doesNotMatch(m, /DROP COLUMN/i);
});

test("the behavioural proof runs against Postgres, and keeps nothing", () => {
  // Uniqueness and delete behaviour are properties of the DATABASE. A test
  // asserting the schema text says `set null` cannot say what a delete does —
  // so the four cases are exercised for real, in a transaction that always
  // rolls back, each in its own savepoint.
  const h = read("scripts/gate-1b/snapshot-election-grain-falsify.ts");
  assert.match(h, /savepoint s/);
  assert.match(h, /throw new Rollback\(\)/);
  // And it proves it left nothing, rather than asserting it did.
  assert.match(h, /the harness left nothing behind/);
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

test("both migrations are registered in the journal, in order", () => {
  // Resolved against `_journal.json`, never from prose — a brief's implicit
  // counter drifts, and a duplicated index is a migration nobody runs.
  //
  // TWO entries now: 0118 corrected the grain, 0119 removed the foreign key it
  // had given the new column. 0119 must follow 0118, because dropping a
  // constraint that does not exist yet is not a migration.
  const j = JSON.parse(read("drizzle/meta/_journal.json"));
  const entry = j.entries.find(
    (e: { tag: string }) => e.tag === "0118_snapshot_election_instance_grain",
  );
  const follow = j.entries.find(
    (e: { tag: string }) => e.tag === "0119_snapshot_election_frozen_provenance",
  );
  assert.ok(entry, "0118 must be journalled");
  assert.ok(follow, "0119 must be journalled");
  assert.ok(follow.when > entry.when, "0119 must follow 0118");
  assert.ok(follow.idx > entry.idx, "and hold the later index");
  const idxs = j.entries.map((e: { idx: number }) => e.idx);
  assert.equal(new Set(idxs).size, idxs.length, "indices must be unique");
  // ABOVE THE HIGH-WATER MARK, which is the property that decides whether the
  // migrator will run it. drizzle-orm reads `max(created_at)` from the journal
  // table and executes every entry whose `when` exceeds it; an entry below the
  // mark is structurally unreachable and would never apply.
  const before = j.entries.filter(
    (e: { tag: string }) =>
      e.tag !== "0118_snapshot_election_instance_grain" &&
      e.tag !== "0119_snapshot_election_frozen_provenance",
  );
  const previousMax = Math.max(...before.map((e: { when: number }) => e.when));
  assert.ok(
    entry.when > previousMax,
    `0118 must sit above the pre-existing high-water mark (${entry.when} vs ${previousMax})`,
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
