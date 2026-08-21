import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SYSTEM_ACTORS, writeSystemAuditEntry } from "@/lib/audit";
import { bindPendingUser } from "@/lib/auth/pending-binding";
import { normalizeCorporateEmail } from "@/lib/auth/corporate-email";
import type { AuthenticationDependencies } from "@/lib/auth/identity-provider";
import { getApplicationDependencies } from "@/lib/integrations/composition";

export type AppUser = typeof users.$inferSelect;

/**
 * The Nexus row for the authenticated identity.
 *
 * ── NEXUS ADMIN IS THE ENROLLMENT AUTHORITY ──────────────────────────────
 *
 * Authenticating proves WHO someone is. It does not enroll them. There are
 * exactly three outcomes, and creating a user is not among them:
 *
 *   1  the identity is already bound          -> resolve it
 *   2  an admin pre-authorized this address   -> bind, once
 *   3  Nexus has no record of this person     -> REFUSE, and record the refusal
 *
 * ── WHY AUTO-PROVISIONING IS GONE ────────────────────────────────────────
 *
 * Until now, an unrecognised corporate signer was provisioned automatically at
 * `read_only`. That looked safe and was not. `read_only` is a LABEL, not an
 * authorization boundary: outside `schema.ts` no non-admin role value is read
 * for any authorization decision, so an auto-provisioned row is not meaningfully
 * more constrained than any other non-admin row — it simply has no admin
 * surfaces, exactly like `pm` or `logistics`.
 *
 * So the fallback was not least privilege. It was enrollment by sign-in,
 * wearing least privilege as a costume. It surfaced when an employee who had
 * never been added in Nexus signed in and received a working account.
 *
 * Auto-provisioning cannot be repaired by choosing a smaller role. The defect is
 * that a person outside the roster gained an account at all, and the only fix is
 * to stop creating one.
 *
 * ── CONCURRENCY ──────────────────────────────────────────────────────────
 *
 * First sign-in fires several parallel server requests (layout + page +
 * actions). The race that used to matter here — two requests both inserting —
 * cannot happen now, because nothing inserts. `bindPendingUser` owns the one
 * remaining race and resolves it inside a single transaction.
 */
export async function ensureUser(): Promise<AppUser> {
  const { authentication } = await getApplicationDependencies();
  return ensureUserWithAuthentication(authentication);
}

export async function ensureUserWithAuthentication(
  authentication: AuthenticationDependencies,
): Promise<AppUser> {
  const identity = await authentication.identity.current();
  if (!identity) {
    throw new Error("ensureUser called without an authenticated session");
  }
  const userId = identity.externalUserId;

  // 1 · already bound. Every returning user, every request after the first.
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const email = identity.email;

  // 2 · pre-authorized by an admin (#327). Binds once, writes only the handle
  // and its state transition, and refuses anything that would rebind a row that
  // already has an identity.
  const binding = await bindPendingUser({ clerkUserId: userId, email });
  if (binding.kind === "bound" || binding.kind === "raced") return binding.user;

  if (binding.kind === "refused") {
    // Integrity refusal: an identity already bound, an address already bound,
    // an ambiguous match, a non-corporate identity. Each means enrollment
    // integrity is in question and an admin has to look.
    throw new Error(
      `[identity] Sign-in refused (${binding.refusal.code}). ${binding.refusal.detail} ` +
        `An admin must resolve this before this person can sign in.`,
    );
  }

  // 3 · NOBODY ADDED THIS PERSON. Refuse, and say so on the record.
  //
  // Reaching here means the identity authenticated successfully and is not
  // enrolled. Those are different questions with different authorities, and the
  // second one belongs to a Nexus admin.
  await recordEnrollmentRefusal({ email, clerkUserId: userId });

  throw new Error(
    `[identity] ${normalizeCorporateEmail(email)} is not enrolled in Nexus. ` +
      `Signing in proves who you are; it does not grant access. A Nexus admin ` +
      `must add this person before they can sign in.`,
  );
}

/**
 * Record a refused sign-in by an identity Nexus does not know.
 *
 * ── WHY THIS IS A SYSTEM ROW AND NOT A USER ROW ──────────────────────────
 *
 * The audit model can represent this cleanly, and only one shape is honest.
 * `writeSystemAuditEntry` writes `user_id` and `actor_user_id` NULL with
 * `actor_kind = 'system'`, so a trace arriving here reports a machine act
 * rather than failing to find a human.
 *
 * There is no user to name, and inventing one would be worse than recording
 * nothing: the identity that attempted is NOT a Nexus actor — that is the whole
 * finding — and attributing the row to them would assert the enrollment this
 * refusal denies. The attempted address is the SUBJECT (`entity_id`, which is
 * text precisely so non-UUID keys are representable), never the actor.
 *
 * Best-effort. A refusal that could not be written must not become an
 * accidental admission: the throw stands either way.
 */
async function recordEnrollmentRefusal(args: {
  email: string;
  clerkUserId: string;
}): Promise<void> {
  const normalized = normalizeCorporateEmail(args.email);
  try {
    await writeSystemAuditEntry({
      systemActor: SYSTEM_ACTORS.enrollmentGate,
      entityType: "enrollment",
      entityId: normalized,
      // Named for the transition, not the mechanism: enrollment was refused.
      action: "enrollment_refused",
      diffJson: {
        email: normalized,
        external_user_id: args.clerkUserId,
        reason: "no_pending_row",
        audit_source: "enterprise_sso_first_sign_in",
      },
      summary: `${normalized} authenticated but is not enrolled in Nexus; access refused.`,
    });
  } catch {
    // Deliberately swallowed. If the audit write fails the person is still
    // refused — the alternative, letting the failure propagate differently from
    // the refusal itself, would make an unwritable audit indistinguishable from
    // an unenrolled user at the call site.
  }
}
