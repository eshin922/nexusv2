import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { findHubspotOwnerByEmail } from "@/lib/hubspot";
import { isAdmin } from "@/lib/admin-guard";

export type AppUser = typeof users.$inferSelect;

/**
 * Returns the DB row for the currently authenticated Clerk user, creating
 * one on first sign-in. On creation, looks up the HubSpot owner by email
 * and back-fills sales_rep_user_id on any existing projects where this
 * user owned the deal in HubSpot but the FK was null.
 */
export async function ensureUser(): Promise<AppUser> {
  const { userId } = await auth();
  if (!userId) throw new Error("ensureUser called without an authenticated session");

  // Fast path: user already provisioned
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  // Slow path: first sign-in
  const clerkUser = await currentUser();
  if (!clerkUser) throw new Error("Clerk user not found");
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("No email on Clerk user");

  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
  const role = isAdmin(email) ? "admin" : "pm";

  const owner = await findHubspotOwnerByEmail(email);
  const hubspotOwnerId = owner?.id ?? null;

  const inserted = await db
    .insert(users)
    .values({ clerkUserId: userId, email, name, role, hubspotOwnerId })
    .returning();
  const user = inserted[0];

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
