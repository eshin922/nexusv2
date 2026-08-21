/**
 * One-row governed role correction: amy@thedps.co  read_only -> admin. WRITES.
 *
 * Amy Park is an explicitly approved initial-roster user with intended role
 * `admin`. She signed in BEFORE being pre-authorized, so the old auto-provision
 * fallback created her row at `read_only` — the policy defect #327-followup
 * closes. Her binding is correct and stays exactly as it is.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
 *
 * It does not delete, recreate, or re-bind. `users.id` and `clerk_user_id` are
 * in the WHERE clause, never the SET clause: her durable id is referenced by
 * every audit row she will ever appear on, and re-creating the row to "clean it
 * up" would orphan them to fix a cosmetic history.
 *
 * It does not touch `commercial_approver`. BV-005 keeps that authority
 * independent of role, and a role correction quietly carrying it would be the
 * first place that independence eroded — the exact erosion the column exists to
 * make structural.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────
 *
 * Double-keyed on id AND the expected current role, so re-running after it has
 * applied matches zero rows and refuses rather than re-writing. The audit is in
 * the same transaction as the update: an unexplained role elevation and a
 * record of an elevation that did not happen are both worse than neither.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";

const EMAIL = "amy@thedps.co";
const FROM_ROLE = "read_only" as const;
const TO_ROLE = "admin" as const;
const REASON = "Initial roster correction after pre-roster first sign-in.";
/** The administrator accountable for this change. */
const ACTOR_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";

const APPLY = process.argv.includes("--apply");

async function main() {
  const before = (await db.execute(
    sql`select id, email, name, role::text as role, binding_state::text as binding_state,
               clerk_user_id, commercial_approver, can_edit_specs, can_create_leaves,
               hubspot_owner_id, slack_user_id
          from public.users where lower(email) = ${EMAIL}`,
  )) as unknown as Array<Record<string, unknown>>;

  if (before.length !== 1) {
    console.error(`REFUSED — expected exactly one row for ${EMAIL}, found ${before.length}`);
    process.exit(1);
  }
  const u = before[0];

  console.log("CURRENT STATE");
  console.log("  users.id            :", u.id);
  console.log("  clerk_user_id       :", u.clerk_user_id);
  console.log("  role                :", u.role);
  console.log("  binding_state       :", u.binding_state);
  console.log("  commercial_approver :", u.commercial_approver);
  console.log("  can_edit_specs      :", u.can_edit_specs);
  console.log("  can_create_leaves   :", u.can_create_leaves);
  console.log("");
  console.log(`PROPOSED  role: ${FROM_ROLE} -> ${TO_ROLE}`);
  console.log(`REASON    ${REASON}`);
  console.log("UNCHANGED users.id, clerk_user_id, binding_state, commercial_approver,");
  console.log("          can_edit_specs, can_create_leaves, hubspot_owner_id, slack_user_id");

  if (u.role !== FROM_ROLE) {
    console.error(`\nREFUSED — role is already "${u.role}", not "${FROM_ROLE}". Nothing to correct.`);
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to perform the correction.");
    process.exit(0);
  }

  const after = await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ role: TO_ROLE, updatedAt: new Date() })
      .where(and(eq(users.id, String(u.id)), eq(users.role, FROM_ROLE)))
      .returning();

    if (updated.length !== 1) {
      throw new Error(
        `Refusing — the update matched ${updated.length} rows, not 1. ` +
          `Someone changed this row between the read and the write.`,
      );
    }
    const row = updated[0];

    await writeAuditEntry(
      {
        userId: ACTOR_USER_ID,
        entityType: "user",
        entityId: row.id,
        action: "user_role_corrected",
        diffJson: {
          role: { from: FROM_ROLE, to: TO_ROLE },
          reason: REASON,
          // What did NOT move. A role correction is the likeliest place for an
          // authority to travel along unnoticed.
          preserved: {
            user_id: row.id,
            email: row.email,
            clerk_user_id: row.clerkUserId,
            binding_state: row.bindingState,
            commercial_approver: row.commercialApprover,
            can_edit_specs: row.canEditSpecs,
            can_create_leaves: row.canCreateLeaves,
          },
          audit_source: "admin_roster_correction",
        },
        summary: `${row.email} corrected from ${FROM_ROLE} to ${TO_ROLE}. ${REASON}`,
      },
      tx,
    );

    return row;
  });

  console.log("\nCORRECTED");
  console.log("  users.id            :", after.id, "(unchanged)");
  console.log("  clerk_user_id       :", after.clerkUserId, "(unchanged)");
  console.log("  role                :", after.role);
  console.log("  commercial_approver :", after.commercialApprover, "(unchanged, false)");
  process.exit(0);
}

void main();
