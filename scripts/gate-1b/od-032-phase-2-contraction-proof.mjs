// Post-contraction proof, by TRANSACTION rather than by reading the writer.
//
// OD-017's lesson: "A structural claim is proven by a transaction that performs
// it — rolled back if the state must not persist — never by reading the action
// layer." Every write here happens inside a transaction that always ROLLS BACK,
// so nothing persists on the shared database.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const url = /^DIRECT_URL=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, '');
const sql = postgres(url, { max: 1, prepare: false });

const QUOTE = '4781e4bb-0597-4044-a1ea-3ffc8c3be35a';
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

class Rollback extends Error {}

// Two leaves on the subject quote, to own the same charge type.
const leaves = await sql`
  SELECT id FROM quote_leaves WHERE quote_id = ${QUOTE} ORDER BY position, id LIMIT 2`;
if (leaves.length < 2) { console.error('subject needs 2+ leaves'); process.exit(1); }
const [A, B] = leaves.map((l) => l.id);
const user = (await sql`SELECT id FROM users LIMIT 1`)[0].id;

console.log(`subject: ${QUOTE}`);
console.log(`leaves : ${A.slice(0, 8)} / ${B.slice(0, 8)}\n`);

try {
  await sql.begin(async (tx) => {
    // ── 1 · two components each own the same charge type ────────────────
    // The dropped unique was on the ELECTION table, so this exercises the
    // instance table's finer constraint: same quote, same type, two owners.
    const [ia] = await tx`
      INSERT INTO quote_charge_instances (quote_id, charge_key, owner_ref, owner_quote_leaf_id)
      VALUES (${QUOTE}, 'print_plates', ${A}, ${A}) RETURNING id`;
    const [ib] = await tx`
      INSERT INTO quote_charge_instances (quote_id, charge_key, owner_ref, owner_quote_leaf_id)
      VALUES (${QUOTE}, 'print_plates', ${B}, ${B}) RETURNING id`;
    record('two components own the same charge type', ia.id !== ib.id,
      `${ia.id.slice(0, 8)} / ${ib.id.slice(0, 8)}`);

    // ── 2 · one component owns two of one type, distinguished by label ──
    const [ic] = await tx`
      INSERT INTO quote_charge_instances (quote_id, charge_key, owner_ref, owner_quote_leaf_id, label)
      VALUES (${QUOTE}, 'print_plates', ${A}, ${A}, 'Second pass') RETURNING id`;
    record('one component owns two instances of one type', ic.id !== ia.id,
      'distinguished by label, not by identity');

    // ── 3 · THE CONTRACTION'S PURPOSE ───────────────────────────────────
    // Two elections, same quote, SAME charge_key. Under the dropped unique
    // this was rejected outright. It is the whole reason 0110 exists.
    await tx`
      INSERT INTO quote_charge_recovery (quote_id, charge_key, charge_instance_id, mode, elected_by_user_id)
      VALUES (${QUOTE}, 'print_plates', ${ia.id}, 'included', ${user})`;
    await tx`
      INSERT INTO quote_charge_recovery (quote_id, charge_key, charge_instance_id, mode, elected_by_user_id)
      VALUES (${QUOTE}, 'print_plates', ${ib.id}, 'included', ${user})`;
    const n = (await tx`
      SELECT count(*)::int n FROM quote_charge_recovery
       WHERE quote_id = ${QUOTE} AND charge_key = 'print_plates'`)[0].n;
    record('two same-type elections coexist on one quote', n === 2,
      `${n} rows — impossible before 0110`);

    // ── 4 · the writer's ON CONFLICT target still resolves ──────────────
    // Re-electing must UPDATE, not duplicate. This is the deployed writer's
    // exact statement shape, against the primary key it now names.
    await tx`
      INSERT INTO quote_charge_recovery (quote_id, charge_key, charge_instance_id, mode, elected_by_user_id)
      VALUES (${QUOTE}, 'print_plates', ${ia.id}, 'separate', ${user})
      ON CONFLICT (charge_instance_id)
      DO UPDATE SET mode = 'separate', elected_at = now()`;
    const after = await tx`
      SELECT charge_instance_id, mode FROM quote_charge_recovery
       WHERE quote_id = ${QUOTE} AND charge_key = 'print_plates' ORDER BY charge_instance_id`;
    const reElected = after.find((r) => r.charge_instance_id === ia.id);
    record('re-election UPDATES via the primary key', after.length === 2 && reElected.mode === 'separate',
      `${after.length} rows, A.mode=${reElected?.mode}`);

    // ── 5 · the sibling was NOT touched ─────────────────────────────────
    // The failure the old target would have caused: conflicting on
    // (quote_id, charge_key) would have re-elected the WRONG carton's plates.
    const sibling = after.find((r) => r.charge_instance_id === ib.id);
    // NON-VACUOUS: B was inserted as `included` while A was re-elected to
    // `separate`, so untouched and also-updated are now DIFFERENT values.
    // With both inserted as `separate` this check could not have failed.
    record("the sibling election is untouched", sibling?.mode === "included",
      `B.mode=${sibling?.mode} -- "separate" would mean the re-election reached the wrong carton`);

    // ── 6 · the finer constraint still refuses a true duplicate ─────────
    let refused = false;
    try {
      await tx`SAVEPOINT s1`;
      await tx`
        INSERT INTO quote_charge_instances (quote_id, charge_key, owner_ref, owner_quote_leaf_id)
        VALUES (${QUOTE}, 'print_plates', ${A}, ${A})`;
      await tx`RELEASE SAVEPOINT s1`;
    } catch { refused = true; await tx`ROLLBACK TO SAVEPOINT s1`; }
    record('a genuine duplicate is still refused', refused,
      'same quote + type + owner + NULL label');

    // ── 7 · the CHECK still refuses a disagreeing owner ─────────────────
    let checkHeld = false;
    try {
      await tx`SAVEPOINT s2`;
      await tx`
        INSERT INTO quote_charge_instances (quote_id, charge_key, owner_ref, owner_quote_leaf_id)
        VALUES (${QUOTE}, 'print_plates', '@quote', ${A})`;
      await tx`RELEASE SAVEPOINT s2`;
    } catch { checkHeld = true; await tx`ROLLBACK TO SAVEPOINT s2`; }
    record('owner_ref and owner_quote_leaf_id cannot disagree', checkHeld);

    // ── 8 · deleting the component takes its charges ────────────────────
    // Falsification 5, performed rather than read off the DDL.
    await tx`SAVEPOINT s3`;
    await tx`DELETE FROM quote_leaves WHERE id = ${B}`;
    const orphans = (await tx`
      SELECT count(*)::int n FROM quote_charge_instances WHERE owner_quote_leaf_id = ${B}`)[0].n;
    const orphanElections = (await tx`
      SELECT count(*)::int n FROM quote_charge_recovery WHERE charge_instance_id = ${ib.id}`)[0].n;
    record('deleting a component orphans nothing', orphans === 0 && orphanElections === 0,
      `${orphans} instance(s), ${orphanElections} election(s) left behind`);
    await tx`ROLLBACK TO SAVEPOINT s3`;

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error('\nUNEXPECTED:', e.message); process.exit(1); }
}

// ── the rollback actually rolled back ──────────────────────────────────
const left = (await sql`
  SELECT count(*)::int n FROM quote_charge_instances WHERE charge_key = 'print_plates'`)[0].n;
const leavesLeft = (await sql`SELECT count(*)::int n FROM quote_leaves WHERE id = ${B}`)[0].n;
const elections = (await sql`SELECT count(*)::int n FROM quote_charge_recovery`)[0].n;
console.log('');
record('nothing persisted', left === 0 && leavesLeft === 1 && elections === 27,
  `${left} instance(s), leaf B present=${leavesLeft}, ${elections} election(s) (expect 0 / 1 / 27)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'PROOF: PASS' : 'PROOF: FAIL'} (${results.length - failed.length}/${results.length})`);
await sql.end();
process.exit(failed.length === 0 ? 0 : 1);
