import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { quoteReviewEvents } from "@/db/schema";

// Slice 12 Step 5c — feed-count reader for the umbrella.
//
// Powers the sub-tab strip's Client Review feed-count badge (renders
// when count > 0) and the Send-tab waiting-state "N entries so far"
// copy. Cheap indexed lookup (quote_id is the first column of the
// composite index shipped in Step 3).
//
// Slice 12 Step 6 (Revise-in-place + PM Add-entry form) will extend
// this file with the full feed reader (list of entries with author,
// timestamp, etc.). For Step 5c, count-only is sufficient.

export async function getReviewFeedCount(quoteId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quoteReviewEvents)
    .where(eq(quoteReviewEvents.quoteId, quoteId));
  return rows[0]?.count ?? 0;
}
