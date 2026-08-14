import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, quotes } from "@/db/schema";
import { NavShell } from "@/components/nav/nav-shell";
import { loadLeafForSpecEntry } from "@/lib/leaf-spec-loader";
import { SpecEntrySurface } from "@/components/spec-entry/spec-entry-surface";
import { ensureUser } from "@/lib/auth/ensure-user";

// Phase A.1 v2 impl-3 — Spec entry surface route.
//
// URL: /projects/:id/quotes/:qid/leaves/:leafId/specs
//
// Origin quote context (id + qid) preserved for back-nav to Setup
// + cascade-warning workflow (referencing ASYs in this quote vs
// elsewhere). Leaf data itself is library-scoped (no quote_id);
// URL nesting is a routing convenience for PM workflow.
//
// Step 2 ships the route scaffolding + data fetch. Step 3+
// replace the placeholder with the actual SpecEntry surface
// (header + completeness chip + ref count + panel render).

export default async function SpecEntryPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string; leafId: string }>;
}) {
  const { id: projectId, quoteId, leafId } = await params;

  // Verify quote + project membership before loading leaf data
  // (URL-tampering defense: don't leak leaf data to PMs without
  // valid quote context).
  const quoteRows = await db
    .select({
      quote: quotes,
      project: projects,
    })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();

  const data = await loadLeafForSpecEntry(leafId, { quoteId });
  if (!data) notFound();

  // Permission gate at render time. Non-admin users without
  // can_edit_specs render the read-only state (scenario ⑩).
  // Admin role implicit-passes per spec-permission-guard.ts.
  const user = await ensureUser();
  const canEdit = user.role === "admin" || user.canEditSpecs;
  const readOnly = !canEdit;

  return (
    <NavShell
      surfaceKey="setup"
      projectId={projectId}
      quoteId={quoteId}
      activeScenarioLabel={quote.scenarioLabel}
    >
      <main className="r7b-page">
        <div className="mb-2 text-sm">
          <Link
            href={`/projects/${projectId}/quotes/${quoteId}/setup`}
            className="text-ink-3 hover:text-ink"
          >
            ← Back to Setup
          </Link>
        </div>

        <SpecEntrySurface quoteId={quoteId} data={data} readOnly={readOnly} />
      </main>
    </NavShell>
  );
}
