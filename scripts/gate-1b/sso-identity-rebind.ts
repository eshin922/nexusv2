/**
 * ONE-TIME SSO CUTOVER EVIDENCE — Edward only. Executed 2026-08-21. Kept as
 * the record of that migration, not as a reusable tool.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * This is NOT the onboarding mechanism described in
 * `docs/user-onboarding-pre-authorized-binding.md` (#327), and it must never
 * be adapted into one. That design binds a PENDING row on first sign-in and
 * refuses whenever a binding already exists. This script does the opposite:
 * it REPLACES an existing binding, which is exactly the operation #327
 * forbids at sign-in time.
 *
 * The distinction is the whole safety property. Generalising this file would
 * reintroduce email-keyed rebinding of already-bound users — the failure that
 * would silently re-point `edward.shin@gmail.com`, the historical Nexus actor.
 * If a future user needs a binding changed, that is an explicit, audited admin
 * action with its own design — not a re-run of this.
 *
 * ── WHAT IT DID ───────────────────────────────────────────────────────────
 *
 * Replaced the DEVELOPMENT Clerk id on the single Nexus actor
 * `edward@thedps.co` with the certified PRODUCTION Clerk id. ONE ROW, ONE
 * COLUMN. `users.id` and every configured authority were preserved.
 *
 *   users.id   e60b5670-86d8-437b-9654-36a1284c7b19   (unchanged)
 *   from       user_3FewGyAxn0W421Ja4ANvnkcsayj       (dev Clerk instance)
 *   to         user_3IEXNyfOoru6Fd5wGgle34XLngR       (production Clerk)
 *
 * Clerk user ids are opaque identifiers, not credentials. NO client secret,
 * publishable key, API token or other credential appears in this file, and
 * none may be added to it.
 *
 * ── ROLLBACK ──────────────────────────────────────────────────────────────
 *
 * The old binding is the rollback value. It is double-keyed the same way, so
 * it cannot fire against a row that has since moved:
 *
 *   UPDATE users SET clerk_user_id = 'user_3FewGyAxn0W421Ja4ANvnkcsayj'
 *    WHERE id = 'e60b5670-86d8-437b-9654-36a1284c7b19'
 *      AND clerk_user_id = 'user_3IEXNyfOoru6Fd5wGgle34XLngR';
 *
 * Expect exactly 1 row. Any other count means the state is not what this
 * rollback assumes — stop and re-derive rather than forcing it.
 *
 * ── WHY IT IS SHAPED THIS WAY ─────────────────────────────────────────────
 *
 * Fail-closed by construction:
 *   - every pre-assertion must pass or the process exits BEFORE opening a tx;
 *   - the UPDATE is double-keyed on (id AND expected-old clerk_user_id), so it
 *     cannot match a row that has already moved or a row that is not the
 *     target;
 *   - rowCount must be exactly 1 or the transaction rolls back.
 *
 * The reference census is taken from information_schema rather than a hand-
 * written column list. A hand-written list can only confirm the columns its
 * author remembered; enumerating the FKs means a reference nobody thought of
 * still gets counted. `users.id` does not change, so every count MUST be
 * identical afterwards — a difference would mean something wrote more than the
 * one column this script is allowed to touch. On the live run it enumerated 34
 * FK columns, 13 non-zero, zero drift.
 *
 * Run with no flag for a read-only dry run; `--apply` to write.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const NEXUS_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";
const OLD_CLERK_ID = "user_3FewGyAxn0W421Ja4ANvnkcsayj";
const NEW_CLERK_ID = "user_3IEXNyfOoru6Fd5wGgle34XLngR";
const TARGET_EMAIL = "edward@thedps.co";

const APPLY = process.argv.includes("--apply");

let failed = 0;
function claim(ok: boolean, label: string, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
const rows = async (q: string) =>
  (await db.execute(sql.raw(q))) as unknown as Record<string, unknown>[];

async function referenceCensus(userId: string) {
  const fks = await rows(`
    SELECT tc.table_name AS tbl, kcu.column_name AS col
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema    = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema    = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name  = 'users'
       AND ccu.column_name = 'id'
       AND tc.table_schema = 'public'
     ORDER BY tc.table_name, kcu.column_name`);

  const out: Record<string, number> = {};
  for (const f of fks) {
    const key = `${f.tbl}.${f.col}`;
    const r = await rows(
      `SELECT count(*)::int AS n FROM "${f.tbl}" WHERE "${f.col}" = '${userId}'`,
    );
    out[key] = Number(r[0].n);
  }
  return out;
}

async function gmailActors() {
  return rows(`
    SELECT id::text, email, clerk_user_id, role::text
      FROM users
     WHERE email ILIKE '%@gmail.com'
     ORDER BY email`);
}

async function main() {
  console.log(`MODE: ${APPLY ? "APPLY (will write)" : "DRY RUN (read-only)"}\n`);

  // ────────────── PRE-ASSERTIONS ──────────────
  console.log("PRE-ASSERTIONS");

  const matches = await rows(
    `SELECT id::text, email, name, role::text, commercial_approver,
            clerk_user_id, hubspot_owner_id, slack_user_id
       FROM users WHERE lower(email) = '${TARGET_EMAIL}'`,
  );
  claim(matches.length === 1, `exactly one Nexus row for ${TARGET_EMAIL}`, `${matches.length}`);
  if (matches.length !== 1) { console.log("\nSTOP — refusing to write"); process.exit(1); }

  const row = matches[0];
  claim(row.id === NEXUS_USER_ID, "row id is the durable Nexus users.id", String(row.id));
  claim(
    row.clerk_user_id === OLD_CLERK_ID,
    "current binding is the expected DEV Clerk id (rollback value captured)",
    String(row.clerk_user_id),
  );

  const already = await rows(
    `SELECT id::text, email FROM users WHERE clerk_user_id = '${NEW_CLERK_ID}'`,
  );
  claim(already.length === 0, "target Production Clerk id is not already bound", `${already.length} row(s)`);

  const gmailBefore = await gmailActors();
  console.log(`\n  historical gmail actors (${gmailBefore.length}):`);
  for (const g of gmailBefore) console.log(`     ${g.email}  id=${g.id}  clerk=${g.clerk_user_id}  role=${g.role}`);
  claim(
    gmailBefore.every((g) => g.clerk_user_id !== NEW_CLERK_ID),
    "no gmail actor holds the target Production Clerk id",
  );

  const censusBefore = await referenceCensus(NEXUS_USER_ID);
  console.log(`\n  reference census BEFORE (${Object.keys(censusBefore).length} FK columns):`);
  for (const [k, v] of Object.entries(censusBefore)) if (v > 0) console.log(`     ${k.padEnd(46)} ${v}`);

  console.log(`\n  ROLLBACK VALUE: users.id=${NEXUS_USER_ID} clerk_user_id='${OLD_CLERK_ID}'`);

  if (failed > 0) { console.log(`\nSTOP — ${failed} pre-assertion(s) failed; nothing written`); process.exit(1); }
  if (!APPLY) { console.log("\nDRY RUN complete — all pre-assertions pass. Re-run with --apply to write."); process.exit(0); }

  // ────────────── WRITE ──────────────
  console.log("\nWRITE");
  await db.transaction(async (tx) => {
    const updated = (await tx.execute(
      sql.raw(`UPDATE users
                  SET clerk_user_id = '${NEW_CLERK_ID}'
                WHERE id = '${NEXUS_USER_ID}'
                  AND clerk_user_id = '${OLD_CLERK_ID}'
              RETURNING id::text, email, clerk_user_id`),
    )) as unknown as Record<string, unknown>[];
    if (updated.length !== 1) {
      throw new Error(`expected exactly 1 row updated, got ${updated.length} — rolling back`);
    }
    console.log(`  ok    updated 1 row — ${updated[0].email} → ${updated[0].clerk_user_id}`);
  });

  // ────────────── POST-ASSERTIONS ──────────────
  console.log("\nPOST-ASSERTIONS");
  const after = (await rows(
    `SELECT id::text, email, name, role::text, commercial_approver,
            clerk_user_id, hubspot_owner_id, slack_user_id
       FROM users WHERE id = '${NEXUS_USER_ID}'`,
  ))[0];

  claim(after.id === NEXUS_USER_ID, "users.id unchanged", String(after.id));
  claim(after.email === row.email, "email unchanged", String(after.email));
  claim(after.name === row.name, "name unchanged", String(after.name));
  claim(after.role === "admin", "role remains admin", String(after.role));
  claim(after.commercial_approver === false, "commercial_approver remains false", String(after.commercial_approver));
  claim(String(after.hubspot_owner_id) === "151416663", "hubspot_owner_id = 151416663", String(after.hubspot_owner_id));
  claim(String(after.slack_user_id) === "U02GZMEM19N", "slack_user_id = U02GZMEM19N", String(after.slack_user_id));
  claim(after.clerk_user_id === NEW_CLERK_ID, "clerk_user_id is the Production id", String(after.clerk_user_id));

  const boundCount = await rows(
    `SELECT count(*)::int AS n FROM users WHERE clerk_user_id = '${NEW_CLERK_ID}'`,
  );
  claim(Number(boundCount[0].n) === 1, "exactly one Nexus row bound to the new Production Clerk id", `${boundCount[0].n}`);

  const oldStillBound = await rows(
    `SELECT count(*)::int AS n FROM users WHERE clerk_user_id = '${OLD_CLERK_ID}'`,
  );
  claim(Number(oldStillBound[0].n) === 0, "old DEV Clerk id no longer bound to any row", `${oldStillBound[0].n}`);

  const censusAfter = await referenceCensus(NEXUS_USER_ID);
  console.log("\n  reference census AFTER:");
  let drift = 0;
  for (const k of new Set([...Object.keys(censusBefore), ...Object.keys(censusAfter)])) {
    const b = censusBefore[k] ?? 0, a = censusAfter[k] ?? 0;
    if (b !== a) { drift++; console.log(`     DRIFT ${k}: ${b} → ${a}`); }
    else if (b > 0) console.log(`     ${k.padEnd(46)} ${a}`);
  }
  claim(drift === 0, "every FK reference count to users.id is unchanged", `${drift} drifted`);

  const gmailAfter = await gmailActors();
  claim(
    JSON.stringify(gmailAfter) === JSON.stringify(gmailBefore),
    "historical gmail actors byte-identical (id, email, clerk id, role)",
    `${gmailAfter.length} row(s)`,
  );

  console.log(failed === 0 ? "\nREBIND: PASS" : `\nREBIND: ${failed} ASSERTION(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("REBIND FAILED (indeterminate — verify state manually):", e?.message ?? e);
  process.exit(1);
});
