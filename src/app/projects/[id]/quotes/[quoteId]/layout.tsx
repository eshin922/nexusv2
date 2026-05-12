import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";
import { InnerRail } from "@/components/rails/inner-rail";

// Slice RI.8 F-1 fix — quote-scoped layout. Renders InnerRail with
// `activeScenarioLabel` derived from a small DB lookup against the
// quoteId route param. This is the load-bearing fix Round 4's
// canonical sub-rail navigation has been waiting for —
// `/projects/[id]/layout.tsx` never had access to quoteId, so
// InnerRail received `activeQuoteId=undefined` and the per-scenario
// sub-rail (Setup / Cost build / Costing sheet / Customer view)
// never expanded for the active scenario.
//
// Why we resolve scenario_label here (not in InnerRail):
//   - InnerRail's existing `getProjectScenarios` returns the
//     latest version per scenario. Matching by `latestQuoteId`
//     fails when PM is viewing an older version (common after
//     re-sends create new draft versions while older sent
//     versions stay reachable). Resolving scenario_label at the
//     layout — one tiny indexed lookup by quote id — is the
//     simpler and more correct contract.
//
// Layout composition (Next 15):
//   /projects/[id]/layout.tsx                — records visit only (no rail)
//   /projects/[id]/quotes/[quoteId]/layout.tsx — this file (rail + offset)
//   /projects/[id]/page.tsx                  — Project Detail; renders its
//                                              own rail (no active scenario)
//
// Double-rail render avoided because the project layout no longer
// renders a rail (see comment in projects/[id]/layout.tsx).

export default async function QuoteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;

  // Resolve scenario_label for the active quote. Single-row lookup
  // by indexed PK; ~ms. Worst case (quoteId not found, e.g., bad
  // URL): scenario_label stays undefined → no active highlight, no
  // sub-rail expansion (graceful — the underlying page renders 404
  // anyway).
  const rows = await db
    .select({ scenarioLabel: quotes.scenarioLabel })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  const activeScenarioLabel = rows[0]?.scenarioLabel;

  return (
    <div className="min-h-screen">
      <InnerRail projectId={id} activeScenarioLabel={activeScenarioLabel} />
      {/* Main content offset by inner rail (240px). Outer rail's
          56px padding already applied by AppShell at the root. */}
      <div className="pl-60">{children}</div>
    </div>
  );
}
