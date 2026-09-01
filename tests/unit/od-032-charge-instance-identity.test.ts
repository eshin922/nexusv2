/**
 * OD-032 phase 1 — the identity is anchor-independent.
 *
 * The disposition's load-bearing clause:
 *
 *   > OD-028 anchor movement must have no ability to change election identity.
 *
 * OD-028 is that `quote_leaves.position` is not unique, so "the lowest-position
 * leaf" is decided by physical row order when members tie — and that anchor can
 * differ between a quote and its copy. `quote_snapshot_recovery_instructions.
 * owner_ref` is populated from it, and its own schema comment calls it
 * "traceability, not a join key."
 *
 * OD-032 makes owner attribution load-bearing. So the one thing that must be
 * true of phase 1 is that synthesis never consults that anchor — otherwise an
 * anchor that moved would move an election's identity, and OD-028 would stop
 * being a display concern and become a commercial one.
 *
 * These assert it structurally rather than by inspection, because "I read the
 * code and it doesn't" is exactly the claim a later edit invalidates silently.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const helper = () =>
  readFileSync("src/lib/commercial-recovery/charge-instance.ts", "utf8");
const migration = () =>
  readFileSync(
    "drizzle/0107_od_032_phase_1_charge_instance_identity.sql",
    "utf8",
  );

// ── the anchor is unreachable from synthesis ───────────────────────────────

test("the synthesis helper cannot read an anchor-derived owner", () => {
  const src = helper();

  // The three routes to a coerced anchor. None may appear.
  for (const forbidden of [
    /quoteSnapshotRecoveryInstructions/,
    /ownedPlacedCharges/,
    /skuRollups/,
  ]) {
    assert.ok(!forbidden.test(src), `synthesis must not reach for ${forbidden}`);
  }

  // The owner it does use is a literal, not a lookup.
  assert.match(src, /export const QUOTE_OWNER_REF = "@quote"/);
  assert.match(src, /args\.ownerRef \?\? QUOTE_OWNER_REF/);
});

test("the backfill derives identity from (quote_id, charge_key) and nothing else", () => {
  const sql = migration();

  // The INSERT that synthesises. Its SELECT list is the whole claim.
  const insert = sql.slice(
    sql.indexOf('INSERT INTO "quote_charge_instances"'),
    sql.indexOf('UPDATE "quote_charge_recovery" r'),
  );
  assert.ok(insert.length > 0, "the synthesis INSERT must exist");

  // Reads only the election's own primary key, and writes a literal owner.
  assert.match(insert, /FROM "quote_charge_recovery"/);
  assert.match(insert, /'@quote'/);

  // No join to anything anchor-derived.
  for (const forbidden of [
    /quote_snapshot_recovery_instructions/i,
    /owner_ref\s*=\s*i\./i,
    /quote_leaves/i,
    /assembly_leaves/i,
    /position/i,
  ]) {
    assert.ok(
      !forbidden.test(insert),
      `synthesis must not consult ${forbidden} — that is the anchor`,
    );
  }
});

test("permuting the anchor cannot change a synthesised identity — by construction", () => {
  // The falsification a database permutation would perform, expressed as the
  // property that makes it unnecessary: the synthesis key is a pure function of
  // (quote_id, charge_key), and the anchor appears in neither.
  //
  // A permutation test against live rows would prove the same thing for the
  // rows that happen to exist today. This proves it for every row that can
  // ever exist, which is the stronger claim and the one that survives a future
  // quote shape nobody has built yet.
  const insert = migration().slice(
    migration().indexOf('INSERT INTO "quote_charge_instances"'),
    migration().indexOf('UPDATE "quote_charge_recovery" r'),
  );

  const selectList = insert.slice(insert.indexOf("SELECT"), insert.indexOf("FROM"));
  const columns = selectList
    .replace("SELECT", "")
    .split(",")
    .map((c) => c.trim().replace(/"/g, ""));

  assert.deepEqual(
    columns,
    ['quote_id', 'charge_key', "'@quote'"],
    "the synthesis key must be exactly (quote_id, charge_key) plus a literal owner",
  );
});

// ── exactly once, in both directions ───────────────────────────────────────

test("the migration refuses to proceed on an incomplete or duplicated backfill", () => {
  const sql = migration();
  // A tightening that discovered a partial backfill would fail naming a column
  // rather than a cause. These fail first, in their own words.
  assert.match(sql, /did not receive an instance/);
  assert.match(sql, /claimed by more than one election/);
  assert.match(sql, /claimed by no election/);
  assert.match(sql, /RAISE EXCEPTION/);
});

// ── the nullable is not a discriminator ────────────────────────────────────

test("no runtime path branches on a null charge_instance_id", () => {
  // The disposition forbids a permanent nullable discriminator preserving two
  // identity models. The column is nullable only until phase 1b; what makes
  // that safe is that nothing READS the null to choose behaviour.
  const roots = [
    "src/app/actions/commercial-recovery-persist.ts",
    "src/app/actions/commercial-recovery.ts",
    "src/app/actions/costing.ts",
    "src/app/actions/quotes.ts",
    "src/lib/commercial-recovery/election-context.ts",
    "src/lib/commercial-recovery/charge-instance.ts",
  ];
  for (const f of roots) {
    const src = readFileSync(f, "utf8");
    for (const branch of [
      /chargeInstanceId\s*===\s*null/,
      /chargeInstanceId\s*!==\s*null/,
      /!\s*\w*\.?chargeInstanceId\b/,
      /isNull\(\s*quoteChargeRecovery\.chargeInstanceId/,
    ]) {
      assert.ok(
        !branch.test(src),
        `${f} must not branch on a null charge_instance_id (${branch})`,
      );
    }
  }
});

test("every election writer supplies an instance id", () => {
  // Both writers, asserted by name. A third writer added later without one
  // fails the count assertion in the migration's validate block on the next
  // run, but this catches it at review time instead.
  const persist = readFileSync(
    "src/app/actions/commercial-recovery-persist.ts",
    "utf8",
  );
  // Through the TRANSACTION handle: the instance and the election it keys must
  // appear together or not at all. And only when the proposal does not already
  // name one — synthesising over a component proposal would mint a '@quote'
  // row and key the election to a charge nobody caused.
  assert.match(persist, /ensureChargeInstance\(tx, \{ quoteId, chargeKey \}\)/);
  assert.match(persist, /proposal\.chargeInstanceId \?\?/);
  assert.match(persist, /chargeInstanceId,/);

  const quotes = readFileSync("src/app/actions/quotes.ts", "utf8");
  // Phase 2 made the copy instance-driven, so the call is multi-line and the
  // election reads its id from a map rather than a positional array. The claim
  // is unchanged: the copy path resolves an instance, and every election it
  // writes carries one.
  assert.match(quotes, /ensureChargeInstance\(tx, \{[\s\S]{0,200}?quoteId: newQuoteId/);
  assert.match(quotes, /chargeInstanceId: targetInstanceId/);
  // And the resolution cannot silently fail: an election whose charge did not
  // clone refuses the copy rather than writing a dangling or invented id.
  assert.match(quotes, /targetInstanceId === undefined/);
});

test("a copy gets its own instances, never the source's", () => {
  const quotes = readFileSync("src/app/actions/quotes.ts", "utf8");
  // Sharing an id across a copy would make two quotes' elections one row, so
  // re-electing on the copy would silently move the source.
  assert.match(quotes, /quoteId: newQuoteId,\s*\n?\s*chargeKey: (e|src)\.chargeKey/);

  // SCOPED TO THE COPY PATH, not the file.
  //
  // This read `!/chargeInstanceId: e\.chargeInstanceId/.test(quotes)` over the
  // whole module, and the rule it protects is real: a copy inheriting the
  // source's instance id would make two quotes share one election row.
  //
  // But the same literal is CORRECT elsewhere. The send freeze records which
  // election it froze, and carrying the source instance is the entire point --
  // without it the frozen election collapses two charges of one type into a
  // single key and the send fails with 23505. A file-wide grep cannot tell the
  // wrong inheritance from the right record, so it forbade both.
  //
  // Bounded to the copy's election block, which is where the rule applies.
  const copyStart = quotes.indexOf("const targetInstanceId");
  assert.ok(copyStart > 0, "the copy path's election block must be findable");
  const copyBlock = quotes.slice(copyStart - 600, copyStart + 600);
  assert.ok(
    !/chargeInstanceId: e\.chargeInstanceId/.test(copyBlock),
    "the copy must not inherit the source's instance id",
  );
  assert.match(copyBlock, /chargeInstanceId: targetInstanceId/);
});

// ── identity is not the natural key ────────────────────────────────────────

test("business uniqueness exists, and is not the identity", () => {
  const sql = migration();
  assert.match(sql, /"id"\s+uuid PRIMARY KEY/);
  assert.match(sql, /UNIQUE NULLS NOT DISTINCT \("quote_id", "charge_key", "owner_ref", "label"\)/);

  // NULLS NOT DISTINCT matters more than it looks: every synthesised row has a
  // null label, so Postgres' default would treat them all as distinct and the
  // constraint would silently not apply to the entire population it governs.
  assert.ok(
    !/UNIQUE \("quote_id", "charge_key", "owner_ref", "label"\)/.test(sql),
    "a plain UNIQUE would not constrain the unlabelled population",
  );
});

test("owner is never nullable, and the sentinel cannot collide with an id", () => {
  const sql = migration();
  assert.match(sql, /"owner_ref"\s+text NOT NULL/);
  // '@quote' is not a valid uuid, so "owned by the engagement" and "owned by an
  // entity that happens to have this id" stay distinguishable without a flag.
  assert.ok(!/^[0-9a-f-]{36}$/.test("@quote"));
});

// ── phase 1b · the contraction tightens only what is invariant ─────────────

const contract = () =>
  readFileSync(
    "drizzle/0108_od_032_phase_1b_contract_instance_identity.sql",
    "utf8",
  );

test("1b re-backfills before contracting, on the same anchor-free derivation", () => {
  const sql = contract();
  // The window between 0107 applying and the new writer deploying was live to
  // the OLD writer, whose INSERT path had no instance to write. Observed on
  // production, not theorised.
  const backfill = sql.slice(0, sql.indexOf("DO $$"));
  assert.match(backfill, /WHERE r\."charge_instance_id" IS NULL/);
  assert.match(backfill, /'@quote'/);
  // Same derivation as 0107 — never an anchor.
  for (const forbidden of [/owner_ref"\s*=\s*i\./, /quote_leaves/i, /position/i]) {
    assert.ok(!forbidden.test(backfill), `re-backfill must not consult ${forbidden}`);
  }
});

test("1b does NOT require zero orphan instances", () => {
  const sql = contract();
  const validate = sql.slice(sql.indexOf("DO $$"), sql.indexOf("END $$"));
  // 0107 asserted it — correct then, wrong forever. An instance with no
  // election is the governed `unplaced` state and must stay representable.
  assert.ok(
    !/claimed by no election/.test(validate),
    "carrying 0107's orphan assertion forward would fail on a legitimate row",
  );
  assert.match(sql, /DELIBERATELY NOT CHECKED: orphan instances/);
});

test("1b asserts the four things that are invariant", () => {
  const validate = contract().slice(
    contract().indexOf("DO $$"),
    contract().indexOf("END $$"),
  );
  assert.match(validate, /still have no instance after re-backfill/);   // (a)
  assert.match(validate, /claimed by more than one election/);           // (b)
  assert.match(validate, /reference a missing instance/);                // (c)
  assert.match(validate, /disagree with their instance/);                // (d)
});

test("the legacy unique is retained on purpose, and its removal is dated", () => {
  const sql = contract();
  // Dropping the index the deployed writer's ON CONFLICT names would break
  // every election the moment this applied — the shape phase 1 was split to
  // avoid, in the other direction.
  assert.match(sql, /quote_charge_recovery_legacy_quote_charge_unique/);
  assert.match(sql, /PHASE 2 DROPS IT/);
});

test("the historical snapshot exception is LIVE, and honoured", () => {
  // ── A TRIPWIRE THAT FIRED, INVERTED RATHER THAN DELETED ────────────────
  //
  // This asserted the opposite until OD-032 P-3: the snapshot table had no
  // `charge_instance_id`, so the historical-snapshot exception preserved a null
  // that did not exist yet, and the assertion said so — deliberately, so a
  // later reader could not assume the exception was handled and find nothing
  // handling it.
  //
  // P-3 added the column. The exception is now LIVE, so the tripwire becomes
  // the permanent assertion of what it was waiting for, exactly as OD-025's
  // divergence tripwire was inverted on repair rather than removed.
  //
  // The 1b contract's own wording still stands and is still true of ITS
  // migration: at 1b there was nothing to preserve.
  assert.match(contract(), /currently VACUOUS/);

  const schema = readFileSync("src/db/schema.ts", "utf8");
  const start = schema.lastIndexOf('"quote_snapshot_recovery_instructions"');
  const end = schema.indexOf("pgTable(", start);
  const snap = schema.slice(start, end === -1 ? schema.length : end);

  // The column exists...
  assert.match(
    snap,
    /chargeInstanceId: uuid\("charge_instance_id"\)/,
    "P-3 added this column; if it is gone the freeze writer silently drops it",
  );
  // ...and it is NULLABLE, because a legacy placed charge has no election and
  // therefore no instance. A NOT NULL here would require inventing one for the
  // great majority of live rows.
  // Scoped to THIS column's own declaration. A fixed-width window after
  // `chargeInstanceId:` reaches into `tierId`, which is legitimately notNull —
  // an instrument wide enough to catch the neighbour reports a failure that is
  // not there.
  const decl = snap.slice(
    snap.indexOf("chargeInstanceId:"),
    snap.indexOf("tierId:", snap.indexOf("chargeInstanceId:")),
  );
  assert.ok(decl.length > 0 && decl.length < 400, "the declaration slice is wrong");
  assert.ok(
    !/\.notNull\(\)/.test(decl),
    "the instance id must stay nullable — legacy placed charges have none",
  );

  // And the exception is honoured where it matters: the migration that added
  // the column BACKFILLS NOTHING. A frozen instruction is the record of what
  // Accounting was told, and back-filling one would rewrite that record.
  const p3 = readFileSync(
    "drizzle/0111_od_032_frozen_instruction_identity.sql",
    "utf8",
  ).replace(/^[ \t]*--.*$/gm, "");
  assert.ok(p3.includes("ADD COLUMN"), "comment stripping removed the statement");
  assert.doesNotMatch(p3, /UPDATE /);
  assert.doesNotMatch(p3, /SET NOT NULL/);
});
