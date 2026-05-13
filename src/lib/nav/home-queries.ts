import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  projects,
  quotes,
  quoteWarnings,
  userSurfaceVisits,
} from "@/db/schema";
import type { SurfaceKey } from "./surface-routes";

// Slice RI.9 §6 step 4 — Resume card data source.
//
// Reads the most recent `user_surface_visits` row for the user,
// joined to projects + quotes for display labels. Last-change line
// pulled from `audit_log.summary` filtered to the quote's id —
// LIVE READ, not snapshot (Pattern 8 — Resume card reflects the
// latest audit-log row, not a frozen-at-visit snapshot).
//
// Returns null for first-time PMs (no rows). Returns null when the
// referenced project/quote was deleted between visit + resume
// (graceful fallback — Resume card renders empty state).

export type ResumeContext = {
  surfaceKey: SurfaceKey;
  projectId: string;
  projectName: string;
  quoteId: string;
  scenarioLabel: string;
  versionNumber: number;
  quoteStatus: string;
  visitedAt: Date;
  /** Last audit_log.summary for this quote (live read; null when no log row). */
  lastChangeSummary: string | null;
  lastChangeAt: Date | null;
};

export async function getResumeContext(
  userId: string,
): Promise<ResumeContext | null> {
  // Most recent visit for this user. quoteId is nullable on the
  // column but in practice always present for quote-scoped surfaces;
  // filter explicitly.
  const [latest] = await db
    .select({
      surfaceKey: userSurfaceVisits.surfaceKey,
      projectId: userSurfaceVisits.projectId,
      quoteId: userSurfaceVisits.quoteId,
      visitedAt: userSurfaceVisits.visitedAt,
    })
    .from(userSurfaceVisits)
    .where(eq(userSurfaceVisits.userId, userId))
    .orderBy(desc(userSurfaceVisits.visitedAt))
    .limit(1);

  if (!latest || !latest.quoteId) return null;

  // Join projects + quotes for display labels. Both may be deleted
  // between visit + resume (CASCADE cleans the visit row eventually
  // but there's a brief window); guard with INNER JOIN — if either
  // is gone, query returns no row → null → empty state.
  const [meta] = await db
    .select({
      projectName: projects.dealName,
      scenarioLabel: quotes.scenarioLabel,
      versionNumber: quotes.versionNumber,
      quoteStatus: quotes.status,
    })
    .from(projects)
    .innerJoin(quotes, eq(quotes.projectId, projects.id))
    .where(
      and(
        eq(projects.id, latest.projectId),
        eq(quotes.id, latest.quoteId),
      ),
    )
    .limit(1);

  if (!meta) return null;

  // Last audit_log row for this quote. entity_id is text; quote-
  // touching actions write the quote_id as entity_id for some
  // actions, but most write quote_skus / quote_tiers / etc. as
  // the row id. Fetch the latest row for this quote regardless of
  // entity_type — filter via the quote_id column on audit_log
  // (where present). For now: use the existing `getProjectActivity`
  // shape (CTE for quote ids); simplified to one quote.
  const lastChangeRows = await db.execute<{
    summary: string | null;
    created_at: Date | string;
  }>(sql`
    SELECT a.summary, a.created_at
    FROM audit_log a
    WHERE
      (a.entity_type = 'quote' AND a.entity_id = ${latest.quoteId})
      OR a.entity_id IN (
        SELECT id::text FROM quote_skus WHERE quote_id = ${latest.quoteId}
      )
      OR a.entity_id IN (
        SELECT id::text FROM quote_tiers WHERE quote_id = ${latest.quoteId}
      )
      OR a.entity_id IN (
        SELECT id::text FROM packaging_inputs WHERE quote_sku_id IN (
          SELECT id FROM quote_skus WHERE quote_id = ${latest.quoteId}
        )
      )
    ORDER BY a.created_at DESC
    LIMIT 1
  `);
  const lastChangeRow = (lastChangeRows as unknown as Array<{
    summary: string | null;
    created_at: Date | string;
  }>)[0];
  const lastChangeAt = lastChangeRow
    ? lastChangeRow.created_at instanceof Date
      ? lastChangeRow.created_at
      : new Date(lastChangeRow.created_at)
    : null;

  return {
    surfaceKey: latest.surfaceKey as SurfaceKey,
    projectId: latest.projectId,
    projectName: meta.projectName,
    quoteId: latest.quoteId,
    scenarioLabel: meta.scenarioLabel,
    versionNumber: meta.versionNumber,
    quoteStatus: meta.quoteStatus,
    visitedAt: latest.visitedAt,
    lastChangeSummary: lastChangeRow?.summary ?? null,
    lastChangeAt,
  };
}

// Slice RI.9 §6 step 6 — Pushback 1 priority signal.
// Count of `action_required` ("now-tier") warnings for this user,
// across all their projects. Drives the "But check inbox first —
// N now-tier items" chip on Resume card.
//
// v1: user-scope = all active warnings (no per-user filter on
// quote_warnings; the inbox surfaces every PM's warnings). When
// per-PM filtering lands (UX_BACKLOG: deal-organizer per-user
// assignment), narrow this query.
export async function getNowTierWarningCount(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quoteWarnings)
    .where(
      and(
        eq(quoteWarnings.severity, "action_required"),
        eq(quoteWarnings.status, "active"),
      ),
    );
  return rows[0]?.n ?? 0;
}
