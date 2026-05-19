import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, quotes } from "@/db/schema";
import { NavShell } from "@/components/nav/nav-shell";
import { loadLeafForSpecEntry } from "@/lib/leaf-spec-loader";

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

  const data = await loadLeafForSpecEntry(leafId);
  if (!data) notFound();

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

        {/* Step 3+ replace this placeholder with the canonical
            SpecEntry surface (header chrome + body panels). For
            Step 2 we render a structured stub so the route is
            reachable + data fetch is verified. */}
        <div className="r7b-card" style={{ padding: 24 }}>
          <h2 style={{ fontFamily: "var(--display)", fontSize: 22, marginBottom: 8 }}>
            Edit specs <em style={{ color: "var(--ink-3)", fontWeight: 400 }}>· {data.leaf.name}</em>
          </h2>
          <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
            Spec entry surface scaffold (impl-3 Step 2). Step 3 renders
            the canonical .a1v2-card chrome; Step 4 ships the SpecPanel
            field grid.
          </p>

          <dl style={{ marginTop: 16, fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-2)", display: "grid", gridTemplateColumns: "180px 1fr", rowGap: 6 }}>
            <dt>Leaf ID</dt>
            <dd>{data.leaf.id}</dd>
            <dt>SKU</dt>
            <dd>{data.leaf.sku ?? "—"}</dd>
            <dt>Product type</dt>
            <dd>{data.productType?.name ?? "(none — TypePicker scenario)"}</dd>
            <dt>Placeholder</dt>
            <dd>{data.productType?.placeholder ? "yes" : "no"}</dd>
            <dt>Field schema fields</dt>
            <dd>{data.productType?.fieldSchema?.fields.length ?? 0}</dd>
            <dt>Current spec row</dt>
            <dd>
              {data.currentSpec
                ? `v${data.currentSpec.versionNumber} · ${Object.keys(data.currentSpec.specValues).length} keys`
                : "(none yet)"}
            </dd>
            <dt>References</dt>
            <dd>{data.references.length} ASY{data.references.length === 1 ? "" : "s"}</dd>
            <dt>Available leaf types</dt>
            <dd>{data.availableLeafTypes.length}</dd>
          </dl>
        </div>
      </main>
    </NavShell>
  );
}
