import "server-only";

import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { quotes, quoteSnapshots } from "@/db/schema";

// Slice 12 Step 4 — Version chain reader for the Preview Quote
// sub-tab picker. Reads the sibling versions for a scenario family.
// Newest version first (R8 designer notes §2 · Preview Quote).
//
// Slice 12 Step 7c review-fix (CB P1) — reader now UNIONS two sources
// per v3 §5.1 Round 3 amendment 3:
//   (a) The `quotes` row(s) that share (project_id, scenario_label)
//       — the historical multi-row shape Nexus's copy-flows produce
//       AND the current in-place row's live version.
//   (b) Superseded `quote_snapshots` rows for the CURRENT quote
//       — post-Revise-in-place, prior versions live here (Step 5b)
//       with `superseded_at IS NOT NULL`. The live `quotes` row only
//       carries the CURRENT version_number, so without this union
//       the picker showed "1 version" post-Revise (CB P1).
//
// Snapshot rows are marked `fromSnapshot: true` so the UI can:
//   - Render them as read-only (no /quote route exists at a per-
//     snapshot URL yet — the snapshot's PDF is at snapshot.pdf_url).
//   - Deep-link the "view sent PDF" affordance to the snapshot's
//     pdf_url when present.
//
// Ordering: DESC on version_number groups snapshots+live rows in
// one stream, then ASC on createdAt breaks ties. The current live
// row wins ties by createdAt for the (project, scenario) key.
//
// Total column intentionally NOT computed here per Step 4 scope —
// per-version rollup requires the full costing bundle per version
// (~8 queries each), which is expensive to fan out. The picker
// renders total placeholders; totals ship alongside the snapshot
// infrastructure in Step 5+.

export type VersionRow = {
  quoteId: string;
  versionNumber: number;
  status: string;
  sentAt: Date | null;
  createdAt: Date;
  isCurrent: boolean; // this is the quote the PM is currently viewing
  /** Slice 12 Step 7c review-fix — true when this row was projected
   * from a superseded quote_snapshots row (v1/v2/… prior to the
   * current in-place row). Snapshot rows carry the pdf_url that
   * customer received for that version; the picker uses it to render
   * an inline "view sent PDF" link instead of a route Link (no
   * per-snapshot /quote route exists — the current quote row is the
   * only routable target). */
  fromSnapshot: boolean;
  /** Slice 12 Step 7c review-fix — snapshot.pdf_url if fromSnapshot
   * (may still be null on very old snapshots pre-Slice-11 Step 6);
   * null for live quote rows. */
  snapshotPdfUrl: string | null;
};

export async function loadScenarioVersionChain(args: {
  projectId: string;
  scenarioLabel: string;
  currentQuoteId: string;
}): Promise<VersionRow[]> {
  // Live quote rows in the scenario family.
  const liveRowsPromise = db
    .select({
      quoteId: quotes.id,
      versionNumber: quotes.versionNumber,
      status: quotes.status,
      sentAt: quotes.sentAt,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.projectId, args.projectId),
        eq(quotes.scenarioLabel, args.scenarioLabel),
      ),
    );

  // Superseded snapshots for the current quote (post-Revise trail).
  // Snapshots are quote-scoped; a snapshot belongs to exactly one
  // quotes.id. We only include SUPERSEDED snapshots — the
  // still-current sent snapshot (superseded_at IS NULL) belongs to
  // the live row above and would be a duplicate.
  const snapshotRowsPromise = db
    .select({
      snapshotId: quoteSnapshots.id,
      quoteId: quoteSnapshots.quoteId,
      versionNumber: quoteSnapshots.versionNumber,
      supersededAt: quoteSnapshots.supersededAt,
      sentAt: quoteSnapshots.sentAt,
      createdAt: quoteSnapshots.createdAt,
      pdfUrl: quoteSnapshots.pdfUrl,
    })
    .from(quoteSnapshots)
    .where(
      and(
        eq(quoteSnapshots.quoteId, args.currentQuoteId),
        isNotNull(quoteSnapshots.supersededAt),
      ),
    );

  const [liveRows, snapshotRows] = await Promise.all([
    liveRowsPromise,
    snapshotRowsPromise,
  ]);

  const live: VersionRow[] = liveRows.map((r) => ({
    quoteId: r.quoteId,
    versionNumber: r.versionNumber,
    status: r.status,
    sentAt: r.sentAt,
    createdAt: r.createdAt,
    isCurrent: r.quoteId === args.currentQuoteId,
    fromSnapshot: false,
    snapshotPdfUrl: null,
  }));

  // Snapshot rows carry the historical "sent" state of the quote at
  // that version. status='sent' for the row's purposes (it WAS sent),
  // and the pill/date renders accordingly.
  const snapshots: VersionRow[] = snapshotRows.map((s) => ({
    quoteId: s.quoteId,
    versionNumber: s.versionNumber,
    status: "sent",
    sentAt: s.sentAt,
    createdAt: s.createdAt,
    isCurrent: false,
    fromSnapshot: true,
    snapshotPdfUrl: s.pdfUrl,
  }));

  // Sort DESC on versionNumber; within same version, live row wins
  // (breaks tie via createdAt ASC — snapshot's created_at is post-
  // send so it's typically LATER than the quote row's createdAt).
  return [...live, ...snapshots].sort((a, b) => {
    if (a.versionNumber !== b.versionNumber) {
      return b.versionNumber - a.versionNumber;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
