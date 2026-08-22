"use server";

import { and, desc, eq, ilike, inArray, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { projects, quotes } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";

/**
 * Deal search for the rail's command palette.
 *
 * READ-ONLY, and deliberately on demand: the rail renders on every page, so
 * loading a project list into it would add a query to every route in the app to
 * serve a control most navigations never touch. One query, only when someone
 * types.
 *
 * ── ON `ilike` ───────────────────────────────────────────────────────────
 *
 * Substring matching on `deal_name` / `client_name` is correct HERE and
 * forbidden elsewhere, and the difference is worth stating because the
 * organizer's own rules ban exactly this shape. `projects.is_test` exists
 * because matching NAMES to decide what a record IS was unsafe — it hid
 * `MISTR - Sachet Rollstock Test Roll`, a real customer deal. This is the
 * opposite: the operator supplies the string and is asking for name matches.
 * Nothing is inferred about the record.
 *
 * The `is_test` filter still applies, so fixtures stay out of search the same
 * way they stay out of the table.
 */
export type ProjectSearchHit = {
  projectId: string;
  dealName: string;
  clientName: string | null;
  /** Most recently updated non-dropped quote, for a one-click destination. */
  latestQuoteId: string | null;
};

export async function searchProjects(query: string): Promise<ProjectSearchHit[]> {
  await ensureUser();

  const q = query.trim();
  // Two characters is the floor: a single letter matches most of the estate and
  // the result is noise, not a shortlist.
  if (q.length < 2) return [];

  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  const rows = await db
    .select({
      projectId: projects.id,
      dealName: projects.dealName,
      clientName: projects.clientName,
    })
    .from(projects)
    .where(
      and(
        eq(projects.isTest, false),
        or(ilike(projects.dealName, pattern), ilike(projects.clientName, pattern)),
      ),
    )
    .orderBy(desc(projects.importedAt))
    .limit(8);

  if (rows.length === 0) return [];

  // The latest non-dropped quote per matched project, as a SECOND query rather
  // than a correlated subquery.
  //
  // The subquery version returned NULL for every row while the identical raw
  // SQL returned ids — a `sql` template rendering difference I did not need to
  // win. The matched set is at most 8, so one `inArray` read is both cheaper to
  // reason about and verifiable: a wrong result here silently sends every
  // search to the project page instead of the quote, which is exactly the kind
  // of degradation nothing would report.
  const latest = await db
    .select({ id: quotes.id, projectId: quotes.projectId, updatedAt: quotes.updatedAt })
    .from(quotes)
    .where(
      and(
        inArray(
          quotes.projectId,
          rows.map((r) => r.projectId),
        ),
        ne(quotes.scenarioStatus, "dropped"),
      ),
    )
    .orderBy(desc(quotes.updatedAt));

  const latestByProject = new Map<string, string>();
  for (const q of latest) {
    // Ordered newest-first, so the first id seen per project is the latest.
    if (!latestByProject.has(q.projectId)) latestByProject.set(q.projectId, q.id);
  }

  return rows.map((r) => ({
    ...r,
    latestQuoteId: latestByProject.get(r.projectId) ?? null,
  }));
}
