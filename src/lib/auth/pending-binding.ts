import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { isCorporateEmail, normalizeCorporateEmail } from "@/lib/auth/corporate-email";
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
 * It is NOT generic email reconciliation. That distinction is the whole safety
 * argument, so it is enforced structurally rather than remembered:
 *
 *     for every user row U:
 *         if U.clerk_user_id IS NOT NULL:
 *             no sign-in path may write U.clerk_user_id
 *
 * The UPDATE is double-keyed on `binding_state = 'pending_first_sign_in'` AND
 * `clerk_user_id IS NULL`, and refuses unless it affected exactly one row. A
 * bound row cannot be reached by this code even if the email matches, even if
 * the caller wanted it to.
 *
 * The case that protects: `edward.shin@gmail.com` is the historical Nexus actor
 * on years of audit rows and foreign keys. A tenant sign-in that happened to
 * normalize onto a matching address must never silently re-point it.
 *
 * ── WHAT IT WRITES ───────────────────────────────────────────────────────
 *
 * `clerk_user_id` and the enrollment transition that consumes the pending
 * state. Nothing else. Not `id`, not `email`, not `role`, not
 * `commercial_approver`, not `can_edit_specs` / `can_create_leaves`, not
 * `name`, and not the HubSpot or Slack bindings — those are separate identity
 * relationships with their own governance, and a sign-in has no standing to
 * rewrite them.
 *
 * SSO proves WHO someone is. Nexus decides what they may do, and decided
 * already, when an admin provisioned the row.
 *
 * `users.id` in particular is referenced across the audit log and every
 * historical record. A binding that replaced the row would orphan them.
 *
 * ── REFUSAL vs FALL-THROUGH ──────────────────────────────────────────────
 *
 * Exactly ONE outcome falls through to ordinary provisioning: `no_pending_row`,
 * which is what an unrostered signer looks like and is not an error.
 *
 * Everything else REFUSES. An ambiguous match, an identity already bound, an
 * address already bound to a different identity, a non-corporate address —
 * none of these may quietly become "provision a fresh read_only user", because
 * that answers a question about enrollment integrity by creating a second
 * record for the same person.
 */

export type BindingRefusal =
  | { code: "non_corporate_identity"; detail: string }
  | { code: "ambiguous_email_match"; detail: string }
  | { code: "clerk_id_already_bound"; detail: string }
  | { code: "email_already_bound"; detail: string };

export type BindingOutcome =
  | { kind: "bound"; user: AppUser }
  | { kind: "raced"; user: AppUser }
  /** ORDINARY: nobody provisioned this person. Caller provisions read_only. */
  | { kind: "no_pending_row" }
  | { kind: "refused"; refusal: BindingRefusal };

/**
 * Attempt to bind `clerkUserId` to a pre-authorized row for `email`.
 *
 * Preconditions are evaluated and the write performed inside ONE transaction.
 * Split across statements, the checks and the act would describe different
 * instants — the double-keyed UPDATE would still refuse to overwrite anything,
 * but a refusal should be reasoned from the same state it acted on.
 */
export async function bindPendingUser(args: {
  clerkUserId: string;
  email: string;
}): Promise<BindingOutcome> {
  const normalized = normalizeCorporateEmail(args.email);

  // Precondition 1 — a VERIFIED CORPORATE identity.
  //
  // Checked here, not only upstream. The middleware's check also honours the
  // ALLOWED_EMAILS break-glass list, and being allowed to SIGN IN is not the
  // same as being eligible to CLAIM a row an admin provisioned for an employee.
  // Enterprise SSO only resolves the tenant domain anyway, so a non-corporate
  // identity reaching this point means an assumption broke upstream.
  if (!isCorporateEmail(normalized)) {
    return {
      kind: "refused",
      refusal: {
        code: "non_corporate_identity",
        detail:
          `${normalized} is not a corporate identity, so it cannot claim a ` +
          `pre-authorized Nexus user.`,
      },
    };
  }

  return db.transaction(async (tx) => {
    // Precondition 4 — the incoming identity is not already bound elsewhere.
    //
    // The unique index on `clerk_user_id` would also stop this, but as a
    // constraint violation: an error about an index, shown to someone who needs
    // to be told their identity is attached to a different Nexus user and an
    // admin has to resolve it.
    const boundElsewhere = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.clerkUserId, args.clerkUserId))
      .limit(1);
    if (boundElsewhere.length > 0) {
      return {
        kind: "refused" as const,
        refusal: {
          code: "clerk_id_already_bound" as const,
          detail:
            `This sign-in is already bound to Nexus user ${boundElsewhere[0].id} ` +
            `(${boundElsewhere[0].email}).`,
        },
      };
    }

    // Every row for this address, in ANY state.
    //
    // Filtering to pending rows here would make an already-bound row
    // indistinguishable from no row at all. The caller would then provision a
    // duplicate, hit the unique index on email, and surface a raw constraint
    // error where a diagnosis belongs.
    const forEmail = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`);

    if (forEmail.length === 0) return { kind: "no_pending_row" as const };

    if (forEmail.length > 1) {
      // Unrepresentable while `users_email_lower_unique` stands. Handled
      // anyway: if that index is ever dropped, this must refuse rather than
      // silently pick one, and a guard that cannot currently fire costs
      // nothing to keep.
      return {
        kind: "refused" as const,
        refusal: {
          code: "ambiguous_email_match" as const,
          detail: `${forEmail.length} Nexus users share the address ${normalized}.`,
        },
      };
    }

    const target = forEmail[0];

    // Preconditions 2 and 3 — exactly one row, and it is pending and unbound.
    if (target.bindingState !== "pending_first_sign_in" || target.clerkUserId !== null) {
      return {
        kind: "refused" as const,
        refusal: {
          code: "email_already_bound" as const,
          detail:
            `${normalized} already belongs to Nexus user ${target.id}, which is ` +
            `bound to a different sign-in. Nexus does not re-point an existing ` +
            `user at a new identity.`,
        },
      };
    }

    // THE WRITE. Double-keyed, so a row that became bound between the SELECT
    // and here — a parallel first-sign-in request, which is the normal shape of
    // first sign-in — matches zero rows instead of being overwritten.
    const updated = await tx
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
      // Race loser. The winner bound the same row to the same identity — both
      // requests carry one authenticated session — so re-reading by
      // clerk_user_id returns the row this request was trying to produce.
      const won = await tx
        .select()
        .from(users)
        .where(eq(users.clerkUserId, args.clerkUserId))
        .limit(1);
      if (won.length === 1) return { kind: "raced" as const, user: won[0] };
      return { kind: "no_pending_row" as const };
    }

    const user = updated[0];

    // In the SAME transaction as the write it describes. An audit row that can
    // commit without its mutation, or the reverse, is not evidence.
    //
    // Named for the TRANSITION, not the mechanism: a pre-authorized user became
    // bound to an identity. If the broker stops being Clerk tomorrow,
    // `user_identity_bound` still describes it, and the mechanism detail lives
    // in diff_json where it belongs.
    await writeAuditEntry(
      {
        userId: user.id,
        entityType: "user",
        entityId: user.id,
        action: "user_identity_bound",
        diffJson: {
          binding_state: { from: "pending_first_sign_in", to: "bound" },
          clerk_user_id: { from: null, to: args.clerkUserId },
          matched_on: normalized,
          // Recorded so the audit shows what did NOT move. These are the
          // invariants the binding is trusted to preserve, and an auditor
          // should be able to read them off the row without re-deriving.
          preserved: {
            user_id: user.id,
            email: user.email,
            role: user.role,
            commercial_approver: user.commercialApprover,
            can_edit_specs: user.canEditSpecs,
            can_create_leaves: user.canCreateLeaves,
            hubspot_owner_id: user.hubspotOwnerId,
            slack_user_id: user.slackUserId,
          },
          audit_source: "enterprise_sso_first_sign_in",
        },
        summary: `First sign-in bound ${user.email} to its pre-authorized Nexus user.`,
      },
      tx,
    );

    return { kind: "bound" as const, user };
  });
}
