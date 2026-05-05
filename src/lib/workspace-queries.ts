import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  quotes,
  userPinnedProjects,
  userProjectVisits,
} from "@/db/schema";

// Slice RI.2 — server-side queries for the outer rail's Pinned +
// Recent sections + the Home (Deal organizer) project list.

// Color-coded letter avatar for project glyphs in the rails. Same
// project_id always maps to the same hue (deterministic via id hash);
// letter is derived from the project's client_name (or deal_name
// fallback). Returned as a structured object so the rendering
// component can apply the hue via inline style + the letter via text.
export type ProjectGlyph = {
  projectId: string;
  letter: string;
  // 0-360 hue value for OKLCH; saturation + lightness fixed in CSS
  hue: number;
};

function hashHue(projectId: string): number {
  // Cheap stable hash → 0-360 hue. Deterministic per project id.
  let h = 0;
  for (let i = 0; i < projectId.length; i++) {
    h = (h * 31 + projectId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function letterFor(name: string | null): string {
  if (!name) return "—";
  const trimmed = name.trim();
  if (!trimmed) return "—";
  return trimmed[0].toUpperCase();
}

export type RailProject = {
  id: string;
  clientName: string | null;
  dealName: string;
  glyph: ProjectGlyph;
};

// Outer rail Pinned section. Returns up to 8 pinned projects in
// pin_order ascending. Per Round 4 design.
export async function getPinnedProjects(userId: string): Promise<RailProject[]> {
  const rows = await db
    .select({
      id: projects.id,
      clientName: projects.clientName,
      dealName: projects.dealName,
    })
    .from(userPinnedProjects)
    .innerJoin(projects, eq(userPinnedProjects.projectId, projects.id))
    .where(eq(userPinnedProjects.userId, userId))
    .orderBy(userPinnedProjects.pinOrder)
    .limit(8);

  return rows.map((r) => ({
    id: r.id,
    clientName: r.clientName,
    dealName: r.dealName,
    glyph: {
      projectId: r.id,
      letter: letterFor(r.clientName ?? r.dealName),
      hue: hashHue(r.id),
    },
  }));
}

// Outer rail Recent section. Returns up to 4 most-recently-visited
// projects per Round 4 commitment. MRU ordered.
export async function getRecentProjects(userId: string): Promise<RailProject[]> {
  const rows = await db
    .select({
      id: projects.id,
      clientName: projects.clientName,
      dealName: projects.dealName,
    })
    .from(userProjectVisits)
    .innerJoin(projects, eq(userProjectVisits.projectId, projects.id))
    .where(eq(userProjectVisits.userId, userId))
    .orderBy(desc(userProjectVisits.lastVisitedAt))
    .limit(4);

  return rows.map((r) => ({
    id: r.id,
    clientName: r.clientName,
    dealName: r.dealName,
    glyph: {
      projectId: r.id,
      letter: letterFor(r.clientName ?? r.dealName),
      hue: hashHue(r.id),
    },
  }));
}

// Returns whether the current user has the given project pinned.
// Used by per-project pin toggle affordances.
export async function isProjectPinned(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const row = await db
    .select({ projectId: userPinnedProjects.projectId })
    .from(userPinnedProjects)
    .where(
      and(
        eq(userPinnedProjects.userId, userId),
        eq(userPinnedProjects.projectId, projectId),
      ),
    )
    .limit(1);
  return row.length > 0;
}

// Home (Deal organizer) project list row.
// Per Round 4 design: Deal/Client + Stage + Latest quote (margin +
// amount) + Margin pip + Next action chip + Activity timestamp.
//
// Aggregates the latest quote per project + derives:
//   - latestQuoteVersion / latestQuoteScenarioLabel
//   - latestQuoteStatus (drives the Next action chip)
//   - latestQuoteUpdatedAt (drives the Activity timestamp)
//
// Margin + amount derivation requires running the costing pipeline
// per quote, which is too expensive for a list view; deferred to
// per-row hover/lazy-load. List shows status + version + label only.
export type DealOrganizerRow = {
  id: string;
  clientName: string | null;
  dealName: string;
  hubspotDealId: string;
  status: string; // 'active' | 'archived'
  dealStage: string | null;
  glyph: ProjectGlyph;
  latestQuote: {
    id: string;
    scenarioLabel: string;
    versionNumber: number;
    status: string; // 'draft' | 'sent' | 'accepted'
    updatedAt: Date;
  } | null;
};

// Latest-quote-per-project via DISTINCT ON. Postgres-specific; mirrors
// the per-project-latest pattern used elsewhere. Returns rows ordered
// by project.updatedAt DESC by default; filters applied at action layer.
export async function getDealOrganizerProjects(): Promise<DealOrganizerRow[]> {
  const rows = await db.execute<{
    id: string;
    client_name: string | null;
    deal_name: string;
    hubspot_deal_id: string;
    status: string;
    deal_stage: string | null;
    project_updated_at: Date;
    latest_quote_id: string | null;
    latest_quote_scenario_label: string | null;
    latest_quote_version_number: number | null;
    latest_quote_status: string | null;
    latest_quote_updated_at: Date | null;
  }>(sql`
    SELECT
      p.id,
      p.client_name,
      p.deal_name,
      p.hubspot_deal_id,
      p.status,
      p.deal_stage,
      p.updated_at AS project_updated_at,
      lq.id AS latest_quote_id,
      lq.scenario_label AS latest_quote_scenario_label,
      lq.version_number AS latest_quote_version_number,
      lq.status AS latest_quote_status,
      lq.updated_at AS latest_quote_updated_at
    FROM projects p
    LEFT JOIN LATERAL (
      SELECT q.id, q.scenario_label, q.version_number, q.status, q.updated_at
      FROM quotes q
      WHERE q.project_id = p.id
      ORDER BY q.updated_at DESC
      LIMIT 1
    ) lq ON TRUE
    WHERE p.status = 'active'
    ORDER BY GREATEST(p.updated_at, COALESCE(lq.updated_at, p.updated_at)) DESC
  `);

  return (rows as unknown as Array<{
    id: string;
    client_name: string | null;
    deal_name: string;
    hubspot_deal_id: string;
    status: string;
    deal_stage: string | null;
    project_updated_at: Date;
    latest_quote_id: string | null;
    latest_quote_scenario_label: string | null;
    latest_quote_version_number: number | null;
    latest_quote_status: string | null;
    latest_quote_updated_at: Date | null;
  }>).map((r) => ({
    id: r.id,
    clientName: r.client_name,
    dealName: r.deal_name,
    hubspotDealId: r.hubspot_deal_id,
    status: r.status,
    dealStage: r.deal_stage,
    glyph: {
      projectId: r.id,
      letter: letterFor(r.client_name ?? r.deal_name),
      hue: hashHue(r.id),
    },
    latestQuote: r.latest_quote_id
      ? {
          id: r.latest_quote_id,
          scenarioLabel: r.latest_quote_scenario_label!,
          versionNumber: r.latest_quote_version_number!,
          status: r.latest_quote_status!,
          updatedAt: r.latest_quote_updated_at!,
        }
      : null,
  }));
}

// Inner rail — scenarios for a project. Returns one row per
// (scenario_label) with the latest version per scenario. Used by
// the inner rail's scenario list.
export type RailScenario = {
  scenarioLabel: string;
  scenarioStatus: string;
  latestQuoteId: string;
  latestVersionNumber: number;
  isRecommended: boolean;
};

export async function getProjectScenarios(
  projectId: string,
): Promise<RailScenario[]> {
  const rows = await db.execute<{
    scenario_label: string;
    scenario_status: string;
    latest_quote_id: string;
    latest_version_number: number;
    is_recommended: boolean;
  }>(sql`
    SELECT DISTINCT ON (q.scenario_label)
      q.scenario_label,
      q.scenario_status,
      q.id AS latest_quote_id,
      q.version_number AS latest_version_number,
      q.is_recommended
    FROM quotes q
    WHERE q.project_id = ${projectId}
    ORDER BY q.scenario_label, q.version_number DESC
  `);

  return (rows as unknown as Array<{
    scenario_label: string;
    scenario_status: string;
    latest_quote_id: string;
    latest_version_number: number;
    is_recommended: boolean;
  }>).map((r) => ({
    scenarioLabel: r.scenario_label,
    scenarioStatus: r.scenario_status,
    latestQuoteId: r.latest_quote_id,
    latestVersionNumber: r.latest_version_number,
    isRecommended: r.is_recommended,
  }));
}

// Project detail — full scenarios with version chains. One row per
// (scenario_label) with all versions ordered version DESC. Drives
// the Round 4 scenario cards on Project Detail.
export type ScenarioVersion = {
  id: string;
  versionNumber: number;
  status: string; // 'draft' | 'sent' | 'accepted'
  acceptedAt: Date | null;
  sentAt: Date | null;
  copiedFromQuoteId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ScenarioCard = {
  scenarioLabel: string;
  scenarioStatus: string;
  isRecommended: boolean;
  dropReason: string | null;
  droppedAt: Date | null;
  versions: ScenarioVersion[];
};

export async function getProjectScenarioCards(
  projectId: string,
): Promise<ScenarioCard[]> {
  // All quotes for this project, joined to scenario metadata derived
  // from the latest version's row (status + recommended + drop reason).
  // Group client-side.
  const rows = await db.execute<{
    scenario_label: string;
    scenario_status: string;
    is_recommended: boolean;
    drop_reason: string | null;
    dropped_at: Date | null;
    id: string;
    version_number: number;
    status: string;
    accepted_at: Date | null;
    sent_at: Date | null;
    copied_from_quote_id: string | null;
    created_at: Date;
    updated_at: Date;
  }>(sql`
    SELECT
      q.scenario_label,
      q.scenario_status,
      q.is_recommended,
      q.drop_reason,
      q.dropped_at,
      q.id,
      q.version_number,
      q.status,
      q.accepted_at,
      q.sent_at,
      q.copied_from_quote_id,
      q.created_at,
      q.updated_at
    FROM quotes q
    WHERE q.project_id = ${projectId}
    ORDER BY q.scenario_label, q.version_number DESC
  `);

  // Group by scenario_label client-side. Take scenario-level metadata
  // from the latest version per scenario (DISTINCT ON pattern would
  // also work; this is a small dataset, simpler client-side group).
  const byLabel = new Map<string, ScenarioCard>();
  for (const r of rows as unknown as Array<{
    scenario_label: string;
    scenario_status: string;
    is_recommended: boolean;
    drop_reason: string | null;
    dropped_at: Date | null;
    id: string;
    version_number: number;
    status: string;
    accepted_at: Date | null;
    sent_at: Date | null;
    copied_from_quote_id: string | null;
    created_at: Date;
    updated_at: Date;
  }>) {
    if (!byLabel.has(r.scenario_label)) {
      byLabel.set(r.scenario_label, {
        scenarioLabel: r.scenario_label,
        scenarioStatus: r.scenario_status,
        isRecommended: r.is_recommended,
        dropReason: r.drop_reason,
        droppedAt: r.dropped_at,
        versions: [],
      });
    }
    byLabel.get(r.scenario_label)!.versions.push({
      id: r.id,
      versionNumber: r.version_number,
      status: r.status,
      acceptedAt: r.accepted_at,
      sentAt: r.sent_at,
      copiedFromQuoteId: r.copied_from_quote_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }
  return Array.from(byLabel.values());
}

// Project detail — recent activity feed (last 24h by default; cap N).
// Reads audit_log filtered to entity_id matching the project + any
// quote within the project. Strips internal IDs in summary copy
// (audit-finding compliance).
export type ActivityEntry = {
  id: string;
  userId: string | null;
  userName: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string | null;
  entityLabel: string | null;
  diffJson: Record<string, unknown>;
  createdAt: Date;
};

export async function getProjectActivity(
  projectId: string,
  limit = 30,
): Promise<ActivityEntry[]> {
  const rows = await db.execute<{
    id: string;
    user_id: string | null;
    user_name: string | null;
    entity_type: string;
    entity_id: string;
    action: string;
    summary: string | null;
    entity_label: string | null;
    diff_json: Record<string, unknown>;
    created_at: Date;
  }>(sql`
    WITH project_quote_ids AS (
      SELECT id::text FROM quotes WHERE project_id = ${projectId}
    )
    SELECT
      a.id,
      a.user_id,
      u.name AS user_name,
      a.entity_type,
      a.entity_id,
      a.action,
      a.summary,
      a.entity_label,
      a.diff_json,
      a.created_at
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE
      (a.entity_type = 'project' AND a.entity_id = ${projectId})
      OR a.entity_id IN (SELECT id FROM project_quote_ids)
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `);

  return (rows as unknown as Array<{
    id: string;
    user_id: string | null;
    user_name: string | null;
    entity_type: string;
    entity_id: string;
    action: string;
    summary: string | null;
    entity_label: string | null;
    diff_json: Record<string, unknown>;
    created_at: Date;
  }>).map((r) => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    summary: r.summary,
    entityLabel: r.entity_label,
    diffJson: r.diff_json,
    createdAt: r.created_at,
  }));
}

// Project detail — lineage panel. Resolves copied_from traceability
// across project boundaries. For each scenario's earliest version
// (v1), if copied_from_quote_id is set AND that source quote belongs
// to a different project, surface as cross-project lineage.
export type LineageEntry = {
  scenarioLabel: string;
  fromProjectId: string;
  fromProjectClientName: string | null;
  fromProjectDealName: string;
  fromQuoteScenarioLabel: string;
  fromQuoteVersionNumber: number;
  forkedAt: Date;
};

export async function getProjectLineage(
  projectId: string,
): Promise<LineageEntry[]> {
  const rows = await db.execute<{
    scenario_label: string;
    from_project_id: string;
    from_project_client_name: string | null;
    from_project_deal_name: string;
    from_scenario_label: string;
    from_version_number: number;
    forked_at: Date;
  }>(sql`
    WITH first_versions AS (
      SELECT DISTINCT ON (q.scenario_label)
        q.scenario_label,
        q.copied_from_quote_id,
        q.created_at
      FROM quotes q
      WHERE q.project_id = ${projectId}
      ORDER BY q.scenario_label, q.version_number ASC
    )
    SELECT
      fv.scenario_label,
      src_p.id AS from_project_id,
      src_p.client_name AS from_project_client_name,
      src_p.deal_name AS from_project_deal_name,
      src_q.scenario_label AS from_scenario_label,
      src_q.version_number AS from_version_number,
      fv.created_at AS forked_at
    FROM first_versions fv
    INNER JOIN quotes src_q ON src_q.id = fv.copied_from_quote_id
    INNER JOIN projects src_p ON src_p.id = src_q.project_id
    WHERE src_p.id != ${projectId}
  `);

  return (rows as unknown as Array<{
    scenario_label: string;
    from_project_id: string;
    from_project_client_name: string | null;
    from_project_deal_name: string;
    from_scenario_label: string;
    from_version_number: number;
    forked_at: Date;
  }>).map((r) => ({
    scenarioLabel: r.scenario_label,
    fromProjectId: r.from_project_id,
    fromProjectClientName: r.from_project_client_name,
    fromProjectDealName: r.from_project_deal_name,
    fromQuoteScenarioLabel: r.from_scenario_label,
    fromQuoteVersionNumber: r.from_version_number,
    forkedAt: r.forked_at,
  }));
}

// Inner rail header — project basic info.
export type RailProjectHeader = {
  id: string;
  clientName: string | null;
  dealName: string;
  dealStage: string | null;
  glyph: ProjectGlyph;
};

export async function getProjectHeader(
  projectId: string,
): Promise<RailProjectHeader | null> {
  const rows = await db
    .select({
      id: projects.id,
      clientName: projects.clientName,
      dealName: projects.dealName,
      dealStage: projects.dealStage,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    clientName: r.clientName,
    dealName: r.dealName,
    dealStage: r.dealStage,
    glyph: {
      projectId: r.id,
      letter: letterFor(r.clientName ?? r.dealName),
      hue: hashHue(r.id),
    },
  };
}
