import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, quotes } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { ActiveTierSelector } from "@/components/costing/active-tier-selector";
import { ActiveTierUrlSync } from "@/components/costing/active-tier-url-sync";
import { IdBadge } from "@/components/id-badge";
import { QuoteSummaryCard } from "@/components/quote-summary-card";
import { SkuSummaryRowList } from "./sku-summary-row";

// Slice 8 sub-step 6 follow-up: this page is a thin server shell. All
// math display reads from the Zustand store via CostingSkuBreakdownsList
// and QuoteSummaryCard, both inside CostingStoreProvider. The page
// itself only handles auth/notFound + initial bundle fetch + static
// chrome (header, project name, status). PMs iterate on GPA and margin
// here directly, so every section must update optimistically in lockstep.

// ---- main page ----

export default async function CostingPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id: projectId, quoteId } = await params;

  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();

  const editable = quote.status === "draft";

  const bundle = await getCostingBundle(quoteId);
  if (!bundle.ok) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <div className="mb-2 text-sm">
          <Link
            href={`/projects/${project.id}/quotes/${quote.id}`}
            className="text-gray-500 hover:text-gray-900"
          >
            ← Quote builder
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Costing Sheet</h1>
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <p className="font-semibold">Costing unavailable</p>
          <p className="mt-1">{bundle.error.message}</p>
          {bundle.error.code === "NOT_FOUND" &&
            bundle.error.message.includes("firm_settings") && (
              <p className="mt-2 text-xs">
                Contact an admin to seed firm settings via the admin page.
              </p>
            )}
        </div>
      </main>
    );
  }

  return (
    <CostingStoreProvider snapshot={bundle.data}>
      {/* Slice 9.4a — Suspense boundary required by useSearchParams in
          App Router (see Next 15 docs: hooks that read URL state must
          be inside a Suspense boundary or the build emits warnings and
          falls back to client-only render). ActiveTierUrlSync is the
          first consumer; the active-tier selector UI (Task 5) and any
          future URL-aware Costing Sheet components share this boundary. */}
      <Suspense fallback={null}>
        <ActiveTierUrlSync />
      </Suspense>
      <main className="mx-auto max-w-7xl p-6">
        <div className="mb-2 text-sm">
          <Link
            href={`/projects/${project.id}/quotes/${quote.id}`}
            className="text-gray-500 hover:text-gray-900"
          >
            ← Quote builder
          </Link>
        </div>

        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Costing Sheet</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
            <span>{project.dealName}</span>
            <span>·</span>
            <span>
              {quote.scenarioLabel} v{quote.versionNumber}
            </span>
            <span>·</span>
            <IdBadge id={quote.id} />
            <span>·</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
              {quote.status}
            </span>
          </p>
        </header>

        {!editable && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <p className="font-semibold">
              This quote is in <span className="font-mono">{quote.status}</span>{" "}
              status. Editing is disabled.
            </p>
          </div>
        )}

        <div className="mb-6">
          <QuoteSummaryCard variant="full" editable={editable} />
        </div>

        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Per-SKU breakdown
            </h2>
            {/* Slice 9.4a — page-level active-tier selector. Same
                Suspense boundary as ActiveTierUrlSync (both consume
                useSearchParams). Click handler updates store + URL
                together; rows re-render against new active tier. */}
            <Suspense fallback={null}>
              <ActiveTierSelector />
            </Suspense>
          </div>
          {/* Slice 9.4a — SkuSummaryRowList replaces the prior
              CostingSkuBreakdownsList (cost-decomposition tables) as
              the primary per-SKU surface. Decomposition is preserved
              in the per-row drawer (Task 6 wires it). */}
          <SkuSummaryRowList editable={editable} />
        </section>
      </main>
    </CostingStoreProvider>
  );
}

