import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { quoteSnapshots } from "@/db/schema";

// Slice 12 Step 6d — quote_snapshots readers powering the
// mismatch banner (Client Review).
//
// The MismatchBanner renders when a quote is mid-Revise: PM has
// revised in-place and a fresh draft exists that hasn't been
// re-sent yet. In that state, the customer is still responding to
// the LAST-SENT version — which lives on the most-recently-
// superseded quote_snapshots row for the quote.
//
// A quote is in mid-Revise ⟺
//   quote.status === 'draft'
//   AND quote.versionNumber > 1
//   AND at least one snapshot exists with superseded_at IS NOT NULL
// (equivalently: the last sendQuote wrote a snapshot; Revise flipped
// it superseded; the next send hasn't fired yet.)
//
// Uses the (quote_id, superseded_at) index from Step 5a for the
// current-version query pattern; ORDER BY effective_from DESC picks
// the most-recent superseded row if multiple exist (post-multiple-
// revise loops).

export type SentSnapshotRow = {
  id: string;
  versionNumber: number;
  quoteNumber: string | null;
  sentAt: Date;
  pdfUrl: string | null;
  supersededAt: Date;
};

export async function getLatestSupersededSnapshot(
  quoteId: string,
): Promise<SentSnapshotRow | null> {
  const rows = await db
    .select({
      id: quoteSnapshots.id,
      versionNumber: quoteSnapshots.versionNumber,
      quoteNumber: quoteSnapshots.quoteNumber,
      sentAt: quoteSnapshots.sentAt,
      pdfUrl: quoteSnapshots.pdfUrl,
      supersededAt: quoteSnapshots.supersededAt,
    })
    .from(quoteSnapshots)
    .where(
      and(
        eq(quoteSnapshots.quoteId, quoteId),
        isNotNull(quoteSnapshots.supersededAt),
      ),
    )
    .orderBy(desc(quoteSnapshots.effectiveFrom))
    .limit(1);
  const r = rows[0];
  if (!r || !r.supersededAt) return null;
  return {
    id: r.id,
    versionNumber: r.versionNumber,
    quoteNumber: r.quoteNumber,
    sentAt: r.sentAt,
    pdfUrl: r.pdfUrl,
    supersededAt: r.supersededAt,
  };
}
