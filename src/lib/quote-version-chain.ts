import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";

// Slice 12 Step 4 — Version chain reader for the Preview Quote
// sub-tab picker. Reads the sibling quote rows that share the same
// (project_id, scenario_label) — the scenario family. Newest version
// first (R8 designer notes §2 · Preview Quote).
//
// v3 brief §5.1 Round 3 amendment 3 introduces `quote_snapshots` as
// a sibling table that will retain per-version snapshots when
// Revise-in-place ships (Step 5/6). Until that lands, versions live
// as separate quote rows — the shape Nexus's copy-flows already
// produce and the shape 7 scenario families in prod use today.
//
// When quote_snapshots ships, this reader extends to union both
// sources (or migrates the historical multi-version quote-row data
// into the snapshots table; disposition at Step 5 prep).
//
// Total column intentionally NOT computed here per Step 4 scope —
// per-version rollup requires the full costing bundle per version
// (~8 queries each), which is expensive to fan out client-side. The
// picker renders total placeholders; totals ship alongside the
// snapshot infrastructure in Step 5+.

export type VersionRow = {
  quoteId: string;
  versionNumber: number;
  status: string;
  sentAt: Date | null;
  createdAt: Date;
  isCurrent: boolean; // this is the quote the PM is currently viewing
};

export async function loadScenarioVersionChain(args: {
  projectId: string;
  scenarioLabel: string;
  currentQuoteId: string;
}): Promise<VersionRow[]> {
  const rows = await db
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
    )
    .orderBy(desc(quotes.versionNumber), asc(quotes.createdAt));

  return rows.map((r) => ({
    quoteId: r.quoteId,
    versionNumber: r.versionNumber,
    status: r.status,
    sentAt: r.sentAt,
    createdAt: r.createdAt,
    isCurrent: r.quoteId === args.currentQuoteId,
  }));
}
