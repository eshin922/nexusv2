import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { quoteReviewEvents, users } from "@/db/schema";

// Slice 12 Step 5c — feed-count reader for the umbrella.
//
// Powers the sub-tab strip's Client Review feed-count badge (renders
// when count > 0) and the Send-tab waiting-state "N entries so far"
// copy. Cheap indexed lookup (quote_id is the first column of the
// composite index shipped in Step 3).

export async function getReviewFeedCount(quoteId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quoteReviewEvents)
    .where(eq(quoteReviewEvents.quoteId, quoteId));
  return rows[0]?.count ?? 0;
}

// Slice 12 Step 6a — full feed reader for the Client Review sub-tab.
//
// Returns every entry for the quote, newest first, joined against
// `users` so the feed row can render the author name inline (R8 §4
// canonical: `.who` slot). System-generated entries (author_user_id =
// NULL) render as "system" via the `authorName` fallback.
//
// Uses the composite index `(quote_id, version_number, created_at
// DESC)` shipped in Step 3. Cheap even for chatty quotes (v1 workflow
// tends to have <20 entries per quote).

export type ReviewEventRow = {
  id: string;
  versionNumber: number;
  eventType: "sent" | "responded" | "asked" | "revision_requested";
  note: string | null;
  system: boolean;
  createdAt: Date;
  authorUserId: string | null;
  authorName: string; // resolved: users.name / users.email / "system"
};

export async function getReviewFeed(quoteId: string): Promise<ReviewEventRow[]> {
  const rows = await db
    .select({
      id: quoteReviewEvents.id,
      versionNumber: quoteReviewEvents.versionNumber,
      eventType: quoteReviewEvents.eventType,
      note: quoteReviewEvents.note,
      system: quoteReviewEvents.system,
      createdAt: quoteReviewEvents.createdAt,
      authorUserId: quoteReviewEvents.authorUserId,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(quoteReviewEvents)
    .leftJoin(users, eq(users.id, quoteReviewEvents.authorUserId))
    .where(eq(quoteReviewEvents.quoteId, quoteId))
    .orderBy(desc(quoteReviewEvents.createdAt));

  return rows.map((r) => ({
    id: r.id,
    versionNumber: r.versionNumber,
    eventType: r.eventType,
    note: r.note,
    system: r.system,
    createdAt: r.createdAt,
    authorUserId: r.authorUserId,
    authorName: r.system
      ? "system"
      : (r.authorName ?? r.authorEmail ?? "unknown"),
  }));
}
