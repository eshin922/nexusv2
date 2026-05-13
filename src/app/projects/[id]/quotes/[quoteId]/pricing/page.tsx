import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import {
  bulkRawSectionMeta,
  projects,
  quotes,
  quoteTiers,
} from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { ActiveTierUrlSync } from "@/components/pricing/active-tier-url-sync";
import { CostStackHeader } from "@/components/costs/cost-stack-header";
import { PricingPageHead } from "@/components/pricing/pricing-page-head";
import { LinesRequiringReview } from "@/components/pricing/lines-requiring-review";
import { PerTierOverrideCard } from "@/components/pricing/per-tier-override-card";
import { VerdictBand } from "@/components/pricing/verdict-band";
import { PricingSectionHead } from "@/components/pricing/pricing-section-head";
import { SkuSummaryRowList } from "./sku-summary-row";
import { NavShell } from "@/components/nav/nav-shell";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";

// Slice RI.5 — Pricing rebuild per Designer comprehensive audit
// + brief §3.3. Three rooms top-to-bottom:
//
//   ROOM 0 (conditional, BELOW_FLOOR only) — Lines Requiring Review
//          block. Anchored above verdict band per R2 rationale.
//   ROOM 1 — Cost stack panel (R6 cost-stack-header reused). "How
//            this number is built." Multi-tier columns; tier columns
//            are the active-tier selector (no separate selector UI).
//   ROOM 2 — Margin verdict band: 96px display blended margin number
//            + status text + admin-override-path BELOW_FLOOR + global
//            price adj slider with system-suggestion banner. Healthy
//            state shows three insight cards below.
//   PER-TIER OVERRIDE CARD — between Room 2 and Room 3. Hides when
//                            single-tier quote.
//   ROOM 3 — Per-SKU breakdown table (Slice 9.4a/9.4b shipped surface,
//            preserved exactly).
//
// Removed from prior build:
//   - <QuoteSummaryCard> mount (consolidated into Room 1 + Room 2)
//   - Per-tier cost breakdown sections (cost stack panel replaces)
//   - <ActiveTierSelector> page-level mount (cost stack columns ARE
//     the selector per R6 grammar)
//   - <h2>Per-SKU breakdown</h2> Tailwind-utility header (replaced
//     by R2 .r2-section-head register with italic-em annotation)

export default async function CostingPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id: projectId, quoteId } = await params;

  // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
  await recordSurfaceVisit({
    projectId,
    quoteId,
    surfaceKey: "costing",
  });

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

  // getCostingBundle MUST run sequentially (its internal Promise.all
  // of 8 queries combined with parallel raws-mode fetch otherwise
  // exhausts the pool — see CLAUDE.md "getCostingBundle parallel-
  // query discipline").
  const bundle = await getCostingBundle(quoteId);

  const [tiers, bulkRawMeta] = await Promise.all([
    db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quoteId))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
    db
      .select()
      .from(bulkRawSectionMeta)
      .where(eq(bulkRawSectionMeta.quoteId, quoteId))
      .limit(1),
  ]);

  const rawsMode = bulkRawMeta[0]?.rawsMode ?? "cm_sources";

  if (!bundle.ok) {
    return (
      <NavShell
        surfaceKey="costing"
        projectId={projectId}
        quoteId={quoteId}
        activeScenarioLabel={quote.scenarioLabel}
      >
      <main className="r2-page">
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          <Link
            href={`/projects/${project.id}/quotes/${quote.id}`}
            style={{ color: "var(--ink-3)" }}
          >
            ← Quote builder
          </Link>
        </div>
        <h1 className="r2-page-title">Pricing</h1>
        <div
          role="alert"
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 8,
            background: "var(--bad-soft)",
            border: "1px solid var(--bad)",
            color: "var(--bad)",
            fontSize: 13,
          }}
        >
          <p style={{ fontWeight: 600 }}>Costing unavailable</p>
          <p style={{ marginTop: 4 }}>{bundle.error.message}</p>
          {bundle.error.code === "NOT_FOUND" &&
            bundle.error.message.includes("firm_settings") && (
              <p style={{ marginTop: 8, fontSize: 11 }}>
                Contact an admin to seed firm settings via the admin page.
              </p>
            )}
        </div>
      </main>
      </NavShell>
    );
  }

  const tierBrief = tiers.map((t) => ({
    id: t.id,
    label: t.label,
    qty: t.qty,
  }));

  return (
    <NavShell
      surfaceKey="costing"
      projectId={projectId}
      quoteId={quoteId}
      activeScenarioLabel={quote.scenarioLabel}
    >
    <CostingStoreProvider snapshot={bundle.data}>
      {/* URL ↔ store sync for active-tier selection. Visual selector
          UI removed — cost stack tier columns are the selector now. */}
      <Suspense fallback={null}>
        <ActiveTierUrlSync />
      </Suspense>

      <main className="r2-page">
        <PricingPageHead
          projectId={projectId}
          quoteId={quoteId}
          project={project}
          quote={{
            scenarioLabel: quote.scenarioLabel,
            versionNumber: quote.versionNumber,
            status: quote.status,
            customerAcceptedAt: quote.customerAcceptedAt,
            customerAcceptedTierId: quote.customerAcceptedTierId,
          }}
          tiers={tierBrief}
        />

        {!editable && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: 16,
              borderRadius: 8,
              background: "var(--warn-soft)",
              border: "1px solid var(--warn)",
              color: "var(--warn)",
              fontSize: 13,
            }}
          >
            <p style={{ fontWeight: 600 }}>
              This quote is in{" "}
              <span style={{ fontFamily: "var(--mono)" }}>{quote.status}</span>{" "}
              status. Editing is disabled.
            </p>
          </div>
        )}

        {/* ROOM 0 — Lines Requiring Review (BELOW_FLOOR only) */}
        <LinesRequiringReview />

        {/* ROOM 1 — Cost stack panel (R6 cost-stack-header reused) */}
        <section style={{ marginBottom: 18 }}>
          <CostStackHeader tiers={tierBrief} rawsMode={rawsMode} />
        </section>

        {/* ROOM 2 — Margin verdict band (+ healthy-state insight cards) */}
        <VerdictBand editable={editable} />

        {/* Per-tier override card (Slice 9.2 — preserve, between Room 2/3) */}
        <PerTierOverrideCard editable={editable} />

        {/* ROOM 3 — Per-SKU breakdown table (9.4a/9.4b preserved) */}
        <PricingSectionHead />
        <SkuSummaryRowList editable={editable} />
      </main>
    </CostingStoreProvider>
    </NavShell>
  );
}
