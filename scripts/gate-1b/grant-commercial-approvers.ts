/**
 * One-time governed authority grant: commercial_approver false -> true. WRITES.
 *
 * BV-005's Commercial Approver authority, assigned for the first time. Three
 * rows, named explicitly by Edward:
 *
 *     edward@thedps.co   Ed Shin
 *     amy@thedps.co      Amy Park
 *     daniel@thedps.co   Daniel Park
 *
 * ── NOT DERIVED FROM ANYTHING ────────────────────────────────────────────
 *
 * All three happen to be Admins. That is a coincidence of this roster, NOT the
 * rule, and the script refuses to encode it: `role` appears in no WHERE clause
 * and no SET clause. `schema.ts:389` states the same thing about the column,
 * and `mayAuthorizeBelowFloor` takes `role` as an argument specifically so a
 * test can prove it goes unread. This grant is the first production write of
 * that column, so it is also the first chance to establish the derivation by
 * accident. It does not.
 *
 * Equally: nothing here removes authority on a role change, and nothing grants
 * it when someone becomes Admin. Both directions stay separately governed.
 *
 * ── DANIEL IS PENDING, AND THAT IS FINE ──────────────────────────────────
 *
 * `daniel@thedps.co` has no Clerk identity yet. Verified against the schema
 * rather than assumed: the only CHECK on the table is
 * `users_binding_state_matches_clerk_id` (0093:32-35), which constrains
 * `binding_state` against `clerk_user_id` and says nothing about authority.
 * The Nexus row IS the durable authority record; Clerk supplies an identity to
 * bind to it later. Granting now means his authority is already correct on the
 * day he signs in, rather than being a second task nobody remembers.
 *
 * He cannot ACT until he binds and — for Slack-routed decisions — has a Slack
 * binding. That is a property of the workflow, not of the grant.
 *
 * ── ONLY ONE ED ROW, DELIBERATELY ────────────────────────────────────────
 *
 * Production holds two Admin rows for Ed Shin: `edward@thedps.co` (corporate,
 * Slack-bound) and `edward.shin@gmail.com` (the historical Nexus actor, kept
 * because every early audit row points at it). Only the corporate row is
 * granted.
 *
 * This is a governance decision, not tidiness. Independence is evaluated
 * between USER IDS — `evaluateBelowFloorAuthorization` compares
 * `approvedByUserId !== actingUserId` — so it cannot see that two rows are one
 * person. Granting both would let one human raise a request as one identity and
 * approve it as the other, satisfying every check while defeating the only rule
 * that matters. `schema.ts:396-399` anticipated exactly this: seeding authority
 * from the pre-SSO rows "would manufacture an independence the estate does not
 * have."
 *
 * The script therefore asserts the gmail row is NOT an approver, before and
 * after.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────
 *
 * Double-keyed on id AND `commercial_approver = false`, so a re-run matches
 * zero rows and refuses rather than rewriting. Every other column is read
 * before and after and compared: role, binding_state, clerk_user_id,
 * can_edit_specs, can_create_leaves, hubspot_owner_id, slack_user_id. The audit
 * is in the same transaction as the update — an unexplained authority grant and
 * a record of a grant that did not happen are both worse than neither.
 *
 * Dry by default. Pass --apply to write.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";

const GRANT = ["edward@thedps.co", "amy@thedps.co", "daniel@thedps.co"] as const;

/**
 * Must NOT be granted. Named rather than merely omitted: an omission is
 * invisible, and the reason this row is excluded is the reason the whole grant
 * is safe.
 */
const MUST_NOT_GRANT = "edward.shin@gmail.com";

const REASON =
  "Initial BV-005 Commercial Approver assignment. Explicitly named by Edward; " +
  "not derived from the admin role.";

/** The administrator accountable for this change. */
const ACTOR_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";

const APPLY = process.argv.includes("--apply");

/** Everything that must not move, plus the one thing that must. */
const COLUMNS = sql`
  id, email, name, role::text as role, binding_state::text as binding_state,
  clerk_user_id, commercial_approver, can_edit_specs, can_create_leaves,
  hubspot_owner_id, slack_user_id
`;

type Row = Record<string, unknown>;

async function readOne(email: string): Promise<Row | null> {
  const rows = (await db.execute(
    sql`select ${COLUMNS} from public.users where lower(email) = ${email}`,
  )) as unknown as Row[];
  return rows.length === 1 ? rows[0] : null;
}

/** Every column except the one being granted. */
const UNTOUCHED = [
  "id",
  "email",
  "name",
  "role",
  "binding_state",
  "clerk_user_id",
  "can_edit_specs",
  "can_create_leaves",
  "hubspot_owner_id",
  "slack_user_id",
] as const;

async function main() {
  // ── PRE-FLIGHT ─────────────────────────────────────────────────────────
  const before = new Map<string, Row>();
  for (const email of GRANT) {
    const row = await readOne(email);
    if (!row) {
      console.error(`REFUSED — expected exactly one row for ${email}`);
      process.exit(1);
    }
    if (row.commercial_approver === true) {
      console.error(`REFUSED — ${email} is already a Commercial Approver; nothing to grant.`);
      process.exit(1);
    }
    before.set(email, row);
  }

  const excluded = await readOne(MUST_NOT_GRANT);
  if (!excluded) {
    console.error(`REFUSED — could not read ${MUST_NOT_GRANT} to confirm it stays excluded.`);
    process.exit(1);
  }
  if (excluded.commercial_approver === true) {
    console.error(
      `REFUSED — ${MUST_NOT_GRANT} already carries approver authority. Two approver ` +
        `rows for one person defeats the independence rule; resolve before granting.`,
    );
    process.exit(1);
  }

  console.log("CURRENT STATE\n");
  for (const email of GRANT) {
    const u = before.get(email)!;
    console.log(`  ${String(u.email).padEnd(22)} ${String(u.name)}`);
    console.log(`    role                : ${u.role}   (NOT read by this grant)`);
    console.log(`    binding_state       : ${u.binding_state}`);
    console.log(`    clerk_user_id       : ${u.clerk_user_id ?? "null"}`);
    console.log(`    slack_user_id       : ${u.slack_user_id ?? "null"}`);
    console.log(`    commercial_approver : ${u.commercial_approver}  ->  true`);
    console.log();
  }
  console.log(`  EXCLUDED · ${MUST_NOT_GRANT} stays false (historical actor; see header)\n`);

  if (!APPLY) {
    console.log("DRY RUN — pass --apply to write.");
    process.exit(0);
  }

  // ── APPLY ──────────────────────────────────────────────────────────────
  for (const email of GRANT) {
    const u = before.get(email)!;
    const id = String(u.id);

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(users)
        .set({ commercialApprover: true, updatedAt: new Date() })
        // Double-keyed: the id AND the state being transitioned FROM. A second
        // run matches nothing rather than re-granting.
        .where(and(eq(users.id, id), eq(users.commercialApprover, false)))
        .returning({ id: users.id });

      if (updated.length !== 1) {
        throw new Error(`${email}: expected 1 row updated, got ${updated.length}`);
      }

      await writeAuditEntry(
        {
          userId: ACTOR_USER_ID,
          entityType: "user",
          entityId: id,
          action: "commercial_approver_granted",
          summary: `${u.email} granted BV-005 Commercial Approver authority.`,
          diffJson: {
            commercial_approver: { from: false, to: true },
            email: u.email,
            reason: REASON,
            // Recorded so the audit shows what the grant did NOT depend on.
            // A later reader asking "was this derived from admin?" gets the
            // answer from the record rather than from this file.
            role_at_grant: u.role,
            derived_from_role: false,
            binding_state_at_grant: u.binding_state,
            audit_source: "admin_authority_grant",
          },
        },
        tx,
      );
    });
  }

  // ── VERIFY, BY READING BACK ────────────────────────────────────────────
  // Not from the update's return value: a function reporting what it believes
  // it wrote is not evidence about what was written.
  let failures = 0;
  const check = (name: string, got: unknown, want: unknown) => {
    const ok = String(got) === String(want);
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${ok ? String(got) : `got ${got}, want ${want}`}`);
  };

  console.log("VERIFICATION — read back from the database\n");
  for (const email of GRANT) {
    const b = before.get(email)!;
    const a = await readOne(email);
    if (!a) {
      console.log(`  FAIL  ${email} — row not readable after grant`);
      failures++;
      continue;
    }
    check(`${email} · commercial_approver`, a.commercial_approver, true);
    for (const col of UNTOUCHED) {
      check(`${email} · ${col} unchanged`, a[col] ?? "null", b[col] ?? "null");
    }
    const audits = (await db.execute(sql`
      select count(*)::int n from audit_log
       where action = 'commercial_approver_granted' and entity_id = ${String(b.id)}
    `)) as unknown as Array<{ n: number }>;
    check(`${email} · exactly one grant audit`, audits[0].n, 1);
    console.log();
  }

  const after = await readOne(MUST_NOT_GRANT);
  check(`${MUST_NOT_GRANT} · still NOT an approver`, after?.commercial_approver, false);

  const total = (await db.execute(sql`
    select count(*)::int n from users where commercial_approver = true
  `)) as unknown as Array<{ n: number }>;
  check("approver pool size", total[0].n, GRANT.length);

  console.log(
    `\nVERDICT: ${
      failures === 0
        ? `${GRANT.length} Commercial Approvers granted; no other field moved on any row.`
        : `${failures} failure(s).`
    }`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
