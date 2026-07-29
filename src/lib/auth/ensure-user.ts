import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { findHubspotOwnerByEmail } from "@/lib/hubspot";
import { isAdmin } from "@/lib/admin-guard";
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
  const name =
    [identity.firstName, identity.lastName].filter(Boolean).join(" ") || null;
  const role = isAdmin(email) ? "admin" : "pm";

  const owner = await findHubspotOwnerByEmail(email);
  const hubspotOwnerId = owner?.id ?? null;

  // Race-safe insert: returns the new row when this request wins the
  // insert, empty when a concurrent request beat us to it (no row
  // returned because the constraint conflict suppressed the INSERT).
  const insertedRows = await db
    .insert(users)
    .values({ clerkUserId: userId, email, name, role, hubspotOwnerId })
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
