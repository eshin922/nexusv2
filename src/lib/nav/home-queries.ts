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
  // touching actions write quote-level ids for some actions and
  // sub-entity ids (assemblies, leaves, cost-data rows) for others.
  // Single CTE unions every NEW-model entity id known to belong to
  // this quote; the outer query matches audit_log entries against
  // it.
  //
  // **Slice 11.5.1 post-merge hotfix:** the prior shape referenced
  // OLD-model tables (`quote_skus`, `packaging_inputs`) that were
  // dropped in PR #80's schema migration. Step 4's brief migrated
  // function bodies in `quotes.ts` / `warnings.ts` / `markup-
  // defaults.ts` but missed this raw-SQL home-query lookup —
  // resulting in 500s on every `GET /` after deploy. Pattern 70
  // (cross-consumer audit gap) catch #2.
  const lastChangeRows = await db.execute<{
    summary: string | null;
    created_at: Date | string;
  }>(sql`
    WITH quote_entities AS (
      SELECT id::text AS eid FROM assemblies WHERE quote_id = ${latest.quoteId}
      UNION
      SELECT id::text FROM quote_leaves WHERE quote_id = ${latest.quoteId}
      UNION
      SELECT id::text FROM quote_tiers WHERE quote_id = ${latest.quoteId}
      UNION
      SELECT al.id::text
        FROM assembly_leaves al
        JOIN assemblies a ON al.assembly_id = a.id
        WHERE a.quote_id = ${latest.quoteId}
      UNION
      SELECT ali.id::text
        FROM assembly_leaf_inputs ali
        JOIN assembly_leaves al ON ali.assembly_leaf_id = al.id
        JOIN assemblies a ON al.assembly_id = a.id
        WHERE a.quote_id = ${latest.quoteId}
      UNION
      SELECT api.id::text
        FROM assembly_production_inputs api
        JOIN assemblies a ON api.assembly_id = a.id
        WHERE a.quote_id = ${latest.quoteId}
    )
    SELECT a.summary, a.created_at
    FROM audit_log a
    WHERE
      (a.entity_type = 'quote' AND a.entity_id = ${latest.quoteId})
      OR a.entity_id IN (SELECT eid FROM quote_entities)
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
