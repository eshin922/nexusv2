import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { normalizeCorporateEmail } from "@/lib/auth/corporate-email";
import type { AppUser } from "@/lib/auth/ensure-user";

/**
 * #327 — pre-authorized first-sign-in binding.
 *
 * An admin provisions a Nexus row with a corporate email and the intended
 * authority BEFORE the person has ever reached Clerk. Their first successful
 * Enterprise SSO attaches the authenticated Clerk identity to that row.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 *
 * It is NOT a generic email-rebinding fallback. That distinction is the whole
 * safety argument, so it is enforced structurally rather than remembered:
 *
 *     for every user row U:
 *         if U.clerk_user_id IS NOT NULL:
 *             no sign-in path may write U.clerk_user_id
 *
 * The UPDATE below is double-keyed on `binding_state = 'pending_first_sign_in'`
 * AND `clerk_user_id IS NULL`, and refuses unless it affected exactly one row.
 * A bound row cannot be reached by this code even if the email matches, even if
 * the caller wanted it to.
 *
 * The case that protects: `edward.shin@gmail.com` is the historical Nexus actor
 * on years of audit rows and foreign keys. A tenant sign-in that happened to
 * normalize onto a matching address must never silently re-point it.
 *
 * ── WHAT IT WRITES ───────────────────────────────────────────────────────
 *
 * `clerk_user_id` and the state transition that consumes the pending flag.
 * Nothing else. Not `id`, not `email`, not `role`, not `commercial_approver`,
 * not `can_edit_specs` / `can_create_leaves`, not `name`. The row's identity
 * and its authority predate the binding and are not derived from it — SSO
 * proves WHO someone is; Nexus decides what they may do, and decided already.
 *
 * `users.id` in particular is referenced across the audit log and every
 * historical record. A binding that replaced the row would orphan them.
 */

export type BindingOutcome =
  | { kind: "bound"; user: AppUser }
  | { kind: "no_pending_row" }
  | { kind: "clerk_id_already_bound"; boundToUserId: string }
  | { kind: "raced"; user: AppUser };

/**
 * Attempt to bind `clerkUserId` to a pre-authorized row for `email`.
 *
 * Returns an outcome rather than throwing: "there is no pending row" is the
 * ORDINARY case for an unrostered signer, and the caller falls through to
 * least-privilege provisioning. Only genuine conflicts are surfaced as their
 * own outcomes so the operator can be told an admin must act.
 */
export async function bindPendingUser(args: {
  clerkUserId: string;
  email: string;
}): Promise<BindingOutcome> {
  const normalized = normalizeCorporateEmail(args.email);

  // Precondition 4, checked before the write so the refusal is legible.
  //
  // The unique index on `clerk_user_id` would also stop this, but as a
  // constraint violation — an error about an index, surfaced to someone who
  // needs to be told that their Clerk identity is already attached to a
  // different Nexus user and an admin has to resolve it.
  const alreadyBound = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, args.clerkUserId))
    .limit(1);
  if (alreadyBound.length > 0) {
    return { kind: "clerk_id_already_bound", boundToUserId: alreadyBound[0].id };
  }

  // Preconditions 2 and 3. `lower(email)` matches the unique index, which is
  // what makes "exactly one" a property of the schema rather than a hope —
  // two pending rows for one address are not representable.
  const candidates = await db
    .select()
    .from(users)
    .where(
      and(
        sql`lower(${users.email}) = ${normalized}`,
        eq(users.bindingState, "pending_first_sign_in"),
        isNull(users.clerkUserId),
      ),
    )
    .limit(2);

  if (candidates.length !== 1) return { kind: "no_pending_row" };
  const target = candidates[0];

  // THE WRITE. Double-keyed, so a row that became bound between the SELECT and
  // here — a parallel first-sign-in request, which is the normal shape of first
  // sign-in — matches zero rows instead of being overwritten.
  const updated = await db
    .update(users)
    .set({
      clerkUserId: args.clerkUserId,
      bindingState: "bound",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, target.id),
        eq(users.bindingState, "pending_first_sign_in"),
        isNull(users.clerkUserId),
      ),
    )
    .returning();

  if (updated.length !== 1) {
    // Race loser. The winner bound the same row to the same Clerk identity —
    // both requests carry one authenticated session — so re-reading by
    // clerk_user_id returns the row this request was trying to produce.
    const won = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, args.clerkUserId))
      .limit(1);
    if (won.length === 1) return { kind: "raced", user: won[0] };
    return { kind: "no_pending_row" };
  }

  const user = updated[0];

  // Named for the TRANSITION, not the mechanism: a pre-authorized user became
  // bound to an identity. If the broker stops being Clerk tomorrow,
  // `user_identity_bound` still describes it, and the mechanism detail lives in
  // diff_json where it belongs.
  //
  // Written through the governed helper rather than a raw insert — it snapshots
  // the actor display name and refuses an entry whose acting user does not
  // resolve. The actor IS the person signing in; they performed this by signing
  // in, and the row resolves because the binding committed a moment ago.
  await writeAuditEntry({
    userId: user.id,
    entityType: "user",
    entityId: user.id,
    action: "user_identity_bound",
    diffJson: {
      binding_state: { from: "pending_first_sign_in", to: "bound" },
      clerk_user_id: { from: null, to: args.clerkUserId },
      matched_on: normalized,
      // Recorded so the audit shows what did NOT move. These are the
      // invariants the binding is trusted to preserve.
      preserved: {
        user_id: user.id,
        email: user.email,
        role: user.role,
        commercial_approver: user.commercialApprover,
        can_edit_specs: user.canEditSpecs,
        can_create_leaves: user.canCreateLeaves,
      },
      audit_source: "enterprise_sso_first_sign_in",
    },
    summary: `First sign-in bound ${user.email} to its pre-authorized Nexus user.`,
  });

  return { kind: "bound", user };
}
