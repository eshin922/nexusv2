import "server-only";
import { and, asc, count, desc, eq, exists, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  projects,
  quotes,
} from "@/db/schema";

// slice-fr12-copy-operations Step 5 — picker loaders feeding the
// CSF modal's copy-source dropdowns.
//
// Two loaders, two consumers:
//   - loadScenarioCopyPicker — within-project picker; lists active
//     scenarios in THIS project (excludes the modal's anchoring
//     quote so PMs don't accidentally copy from the open scenario)
//   - loadCopySourceProjects — cross-project picker; lists projects
//     that have at least one ASY/LEAF-tree-having quote (Pattern 32
//     tolerance per Q7 — legacy quote_skus-only quotes invisible
//     as copy sources)
//
// Both loaders include accepted scenarios as valid templates per Q6
// (Beija Flor reorder use case). Both filter to quotes that have at
// least one assembly via EXISTS subquery so the picker never
// surfaces a legacy-data orphan that would clone to empty.

// ──────────────────────────────────────────────────────────────────
// loadScenarioCopyPicker (within-project)
// ──────────────────────────────────────────────────────────────────

export type ScenarioCopyPickerRow = {
  quoteId: string;
  scenarioLabel: string;
  scenarioStatus: "active" | "dropped" | "accepted"; // 3 values per Catch #2
  // slice-fr12-copy-operations BUG-1 hotfix — quote-level workflow
  // status (draft/sent/accepted/superseded/lost) disambiguates
  // picker rows at copy time per CA + CB disposition. Distinct
  // from scenarioStatus (the scenario-family lifecycle); the two
  // enums share the 'accepted' value but answer different
  // forensic questions. Surfaced verbatim in the picker option
  // label so PMs see "sent" vs "draft" inline.
  status: "draft" | "sent" | "accepted" | "superseded" | "lost";
  isRecommended: boolean;
  versionNumber: number;
  asyCount: number;
  leafCount: number;
  latestActivity: Date;
};

export type ScenarioCopyPickerFilters = {
  projectId: string;
  excludeQuoteId?: string; // current scenario to exclude (anchoring quote)
};

export async function loadScenarioCopyPicker(
  filters: ScenarioCopyPickerFilters,
): Promise<{ scenarios: ScenarioCopyPickerRow[] }> {
  const conds = [
    eq(quotes.projectId, filters.projectId),
    // Pattern 32 tolerance per Q7: ASY/LEAF-tree-having quotes only
    // (legacy quote_skus-only quotes invisible as copy sources).
    exists(
      db
        .select({ id: assemblies.id })
        .from(assemblies)
        .where(eq(assemblies.quoteId, quotes.id)),
    ),
    // Don't filter on scenarioStatus — accepted scenarios are valid
    // templates per Q6 (Beija Flor reorder use case). Dropped
    // scenarios are also valid sources; PMs may want to revive an
    // explored alternative.
  ];
  if (filters.excludeQuoteId) {
    conds.push(ne(quotes.id, filters.excludeQuoteId));
  }

  const rows = await db
    .select({
      quoteId: quotes.id,
      scenarioLabel: quotes.scenarioLabel,
      scenarioStatus: quotes.scenarioStatus,
      status: quotes.status,
      isRecommended: quotes.isRecommended,
      versionNumber: quotes.versionNumber,
      updatedAt: quotes.updatedAt,
    })
    .from(quotes)
    .where(and(...conds))
    .orderBy(desc(quotes.updatedAt));

  if (rows.length === 0) return { scenarios: [] };

  // Wave 2: per-quote ASY count + LEAF count via a single grouped
  // query that joins assemblies → assembly_leaves so we can return
  // both counts without an additional roundtrip.
  const quoteIds = rows.map((r) => r.quoteId);
  const countRows = await db
    .select({
      quoteId: assemblies.quoteId,
      asyCount: sql<number>`count(distinct ${assemblies.id})`,
      leafCount: sql<number>`count(${assemblyLeaves.id})`,
    })
    .from(assemblies)
    .leftJoin(assemblyLeaves, eq(assemblyLeaves.assemblyId, assemblies.id))
    .where(
      sql`${assemblies.quoteId} in ${sql.raw(
        `(${quoteIds.map((id) => `'${id}'`).join(",")})`,
      )}`,
    )
    .groupBy(assemblies.quoteId);
  const countsByQuote = new Map(
    countRows.map((r) => [
      r.quoteId,
      { asy: Number(r.asyCount ?? 0), leaf: Number(r.leafCount ?? 0) },
    ]),
  );

  const scenarios: ScenarioCopyPickerRow[] = rows.map((r) => {
    const c = countsByQuote.get(r.quoteId) ?? { asy: 0, leaf: 0 };
    return {
      quoteId: r.quoteId,
      scenarioLabel: r.scenarioLabel,
      scenarioStatus: r.scenarioStatus,
      status: r.status,
      isRecommended: r.isRecommended,
      versionNumber: r.versionNumber,
      asyCount: c.asy,
      leafCount: c.leaf,
      latestActivity: r.updatedAt,
    };
  });

  return { scenarios };
}

// ──────────────────────────────────────────────────────────────────
// loadCopySourceProjects (cross-project, renamed per Q9)
// ──────────────────────────────────────────────────────────────────

export type CopySourceProject = {
  projectId: string;
  clientName: string | null;
  dealName: string;
  quotes: ScenarioCopyPickerRow[];
};

export type CopySourceProjectsFilters = {
  search?: string; // matches project deal_name OR client_name (case-insensitive)
  excludeProjectId?: string; // the target project (modal's anchoring project)
  limit?: number; // result cap for picker performance
};

const COPY_SOURCE_DEFAULT_LIMIT = 50;

export async function loadCopySourceProjects(
  filters: CopySourceProjectsFilters,
): Promise<{ projects: CopySourceProject[] }> {
  const limit = filters.limit ?? COPY_SOURCE_DEFAULT_LIMIT;
  const search = filters.search?.trim() ?? "";

  // Subquery: projects with at least one ASY/LEAF-tree-having quote
  // (Pattern 32 tolerance per Q7).
  const hasAsyLeafQuote = exists(
    db
      .select({ id: quotes.id })
      .from(quotes)
      .innerJoin(assemblies, eq(assemblies.quoteId, quotes.id))
      .where(eq(quotes.projectId, projects.id)),
  );

  const projectConds = [hasAsyLeafQuote];
  if (filters.excludeProjectId) {
    projectConds.push(ne(projects.id, filters.excludeProjectId));
  }
  if (search.length > 0) {
    const pattern = `%${search}%`;
    const orClause = or(
      ilike(projects.dealName, pattern),
      ilike(projects.clientName, pattern),
    );
    if (orClause) projectConds.push(orClause);
  }

  const projectRows = await db
    .select({
      projectId: projects.id,
      clientName: projects.clientName,
      dealName: projects.dealName,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(...projectConds))
    .orderBy(desc(projects.updatedAt))
    .limit(limit);

  if (projectRows.length === 0) return { projects: [] };

  // Per-project scenario list. Reuses loadScenarioCopyPicker's
  // contract by running its query shape per project. Picker UI
  // typically renders the project list with a scenario dropdown
  // that opens on selection; serving the scenarios eagerly here
  // saves a second roundtrip when the PM picks a project.
  //
  // For v1 picker scale (~10s of projects in v1), the eager fetch
  // is fine. If picker scale grows past hundreds, switch to
  // lazy-load-on-select (split into loadCopySourceProjects +
  // loadProjectScenariosForCopy).
  const projectIds = projectRows.map((p) => p.projectId);
  const allQuotes = await db
    .select({
      quoteId: quotes.id,
      projectId: quotes.projectId,
      scenarioLabel: quotes.scenarioLabel,
      scenarioStatus: quotes.scenarioStatus,
      status: quotes.status,
      isRecommended: quotes.isRecommended,
      versionNumber: quotes.versionNumber,
      updatedAt: quotes.updatedAt,
    })
    .from(quotes)
    .where(
      and(
        sql`${quotes.projectId} in ${sql.raw(
          `(${projectIds.map((id) => `'${id}'`).join(",")})`,
        )}`,
        exists(
          db
            .select({ id: assemblies.id })
            .from(assemblies)
            .where(eq(assemblies.quoteId, quotes.id)),
        ),
      ),
    )
    .orderBy(desc(quotes.updatedAt));

  // Per-quote ASY + LEAF counts (single grouped query).
  const quoteIds = allQuotes.map((q) => q.quoteId);
  const countRows =
    quoteIds.length === 0
      ? []
      : await db
          .select({
            quoteId: assemblies.quoteId,
            asyCount: sql<number>`count(distinct ${assemblies.id})`,
            leafCount: sql<number>`count(${assemblyLeaves.id})`,
          })
          .from(assemblies)
          .leftJoin(
            assemblyLeaves,
            eq(assemblyLeaves.assemblyId, assemblies.id),
          )
          .where(
            sql`${assemblies.quoteId} in ${sql.raw(
              `(${quoteIds.map((id) => `'${id}'`).join(",")})`,
            )}`,
          )
          .groupBy(assemblies.quoteId);
  const countsByQuote = new Map(
    countRows.map((r) => [
      r.quoteId,
      { asy: Number(r.asyCount ?? 0), leaf: Number(r.leafCount ?? 0) },
    ]),
  );

  // Group quotes by project.
  const quotesByProject = new Map<string, ScenarioCopyPickerRow[]>();
  for (const q of allQuotes) {
    const c = countsByQuote.get(q.quoteId) ?? { asy: 0, leaf: 0 };
    const row: ScenarioCopyPickerRow = {
      quoteId: q.quoteId,
      scenarioLabel: q.scenarioLabel,
      scenarioStatus: q.scenarioStatus,
      status: q.status,
      isRecommended: q.isRecommended,
      versionNumber: q.versionNumber,
      asyCount: c.asy,
      leafCount: c.leaf,
      latestActivity: q.updatedAt,
    };
    const list = quotesByProject.get(q.projectId) ?? [];
    list.push(row);
    quotesByProject.set(q.projectId, list);
  }

  // Filter project rows to those that still have at least one
  // ASY/LEAF-tree-having quote after the join (defense in depth
  // against EXISTS semantic edge cases on empty assembly_leaves).
  const projectsOut: CopySourceProject[] = [];
  for (const p of projectRows) {
    const projectQuotes = quotesByProject.get(p.projectId) ?? [];
    if (projectQuotes.length === 0) continue;
    projectsOut.push({
      projectId: p.projectId,
      clientName: p.clientName,
      dealName: p.dealName,
      quotes: projectQuotes,
    });
  }

  return { projects: projectsOut };
}
