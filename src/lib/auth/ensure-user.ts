import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { isAdmin } from "@/lib/admin-guard";
import { bindPendingUser } from "@/lib/auth/pending-binding";
import type { AuthenticationDependencies } from "@/lib/auth/identity-provider";
import { getApplicationDependencies } from "@/lib/integrations/composition";

export type AppUser = typeof users.$inferSelect;

/**
 * Returns the DB row for the currently authenticated Clerk user, creating
 * one on first sign-in. On creation, looks up the HubSpot owner by email
 * and back-fills sales_rep_user_id on any existing projects where this
 * user owned the deal in HubSpot but the FK was null.
 *
 * **Concurrency safety (P0 2026-06-26 — MS OAuth first-sign-in race).**
 * First sign-in fires multiple parallel server-side requests (layout +
 * page + actions). Without ON CONFLICT, each request does
 * SELECT-then-INSERT; first wins, the rest hit the
 * `users_clerk_user_id_unique` constraint and 500 the request (digest
 * 3173971648 in production logs). Fix: INSERT ... ON CONFLICT DO
 * NOTHING + fallback SELECT for race-losers. HubSpot backfill only
 * runs on the race-winner (insertedRows non-empty); race-losers skip
 * the backfill — the winner has it covered.
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

  // Fast path: user already provisioned
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  if (!authentication.identity.provisionMissingUsers) {
    throw new Error(
      `[identity] seeded user missing for ${identity.externalUserId}`,
    );
  }

  // Slow path: first sign-in
  const email = identity.email;

  // #327 — PRE-AUTHORIZED BINDING, ahead of provisioning.
  //
  // An admin may have created this person's Nexus row, with their role and
  // authorities, before they ever reached Clerk. If so, attach this identity to
  // THAT row rather than manufacturing a second one at least privilege.
  //
  // Order matters: this must run BEFORE the insert below, or a rostered
  // employee's first sign-in creates a duplicate read_only row and their
  // pre-authorized row sits pending forever while they see an application with
  // no access. The duplicate would be the visible symptom; the pending row
  // going unclaimed is the one that would take longer to notice.
  //
  // Everything except a successful bind falls through, deliberately. An
  // unrostered signer having no pending row is the ORDINARY case, not an error.
  const binding = await bindPendingUser({ clerkUserId: userId, email });
  if (binding.kind === "bound" || binding.kind === "raced") return binding.user;
  if (binding.kind === "clerk_id_already_bound") {
    // Refusal, not a fallback. This identity is already attached to a different
    // Nexus user, so provisioning a second row would split one person across
    // two records — and the unique index would reject it anyway, as an error
    // about an index. Say what is actually true and who has to fix it.
    throw new Error(
      `[identity] This sign-in is already bound to Nexus user ${binding.boundToUserId}. ` +
        `Nexus will not attach it to a second record — an admin must resolve the ` +
        `duplicate before this person can sign in.`,
    );
  }

  const name =
    [identity.firstName, identity.lastName].filter(Boolean).join(" ") || null;
  // LEAST PRIVILEGE for an identity nobody recognised.
  //
  // This branch used to assign "pm", which meant every first-time signer
  // arrived with quote-authoring standing — and it overrode the column's own
  // `read_only` default to do it. That was invisible while `pm` was
  // indistinguishable from every other non-admin role, and it would have
  // stopped being invisible the moment the first per-role gate shipped: an
  // account that fell through onboarding would read as a deliberate grant.
  //
  // Reaching here at all means the address is authorized to sign in (the
  // middleware's @thedps.co check ran first) but is NOT on the roster. That is
  // an onboarding gap, and the safe response to a gap is the smallest possible
  // standing, not the most useful one.
  //
  // Recognised employees do not reach this line at all: the pre-authorized
  // binding above returns early for anyone an admin provisioned, so this
  // governs only the genuinely unrecognised case.
  const role = isAdmin(email) ? "admin" : "read_only";

  const { hubspot } = await getApplicationDependencies();
  const owner = await hubspot.findOwnerByEmail(email);
  const hubspotOwnerId = owner?.id ?? null;

  // Race-safe insert: returns the new row when this request wins the
  // insert, empty when a concurrent request beat us to it (no row
  // returned because the constraint conflict suppressed the INSERT).
  const insertedRows = await db
    .insert(users)
    // `bindingState` is stated rather than left to the column default. This row
    // is being created WITH an identity, so it is born bound — and saying so
    // keeps the writer honest if the default is ever reconsidered.
    .values({
      clerkUserId: userId,
      email,
      name,
      role,
      hubspotOwnerId,
      bindingState: "bound" as const,
    })
    .onConflictDoNothing({ target: users.clerkUserId })
    .returning();

  if (insertedRows.length > 0) {
    // Race winner — finalize HubSpot backfill once. Backfill is also
    // idempotent (WHERE salesRepUserId IS NULL) so re-running by a
    // late writer would be a no-op, but we skip it for the loser
    // path for clarity + one fewer round-trip.
    const user = insertedRows[0];
    if (hubspotOwnerId) {
      await db
        .update(projects)
        .set({ salesRepUserId: user.id, updatedAt: new Date() })
        .where(
          and(
            eq(projects.hubspotOwnerId, hubspotOwnerId),
            isNull(projects.salesRepUserId),
          ),
        );
    }
    return user;
  }

  // Race loser — another request inserted while we were preparing.
  // Fetch the row that won.
  const afterRace = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);
  if (afterRace.length === 0) {
    // Extraordinarily unlikely: the row vanished between our
    // ON CONFLICT and the follow-up SELECT (manual deletion?).
    // Surface explicitly rather than returning undefined.
    throw new Error(
      "ensureUser: ON CONFLICT suppressed the insert but no existing row was found on follow-up read",
    );
  }
  return afterRace[0];
}
