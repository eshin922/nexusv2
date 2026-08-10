import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc, desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  firmSettings,
  projects,
  quotes,
  quoteTiers,
} from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { isProductionRealtimeConfigured } from "@/lib/integrations/realtime-composition";
import { PricingPageHead } from "@/components/pricing/pricing-page-head";
import { NavShell } from "@/components/nav/nav-shell";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { PricingClassifierProvider } from "@/components/pricing-surface/pricing-classifier-context";
import { PricingStagingProvider } from "@/components/pricing-surface/pricing-staging-context";
import { PricingSurfaceShell } from "@/components/pricing-surface/pricing-surface-shell";

// slice-pricing-surface-redesign Step 8 — Pricing surface is now
// driven entirely by `<PricingSurfaceShell>`. The legacy reframe-shell
// + ROOM 0/1/2/3 composition was torn down per Q10 disposition; the
// classifier-driven STATE / ACTION / DETAIL zones replace every
// surface the old composition provided.
//
// Tear-down references (Pattern 30 hygiene):
//   - PricingReframeShell + 8 pricing-reframe components → deleted
//   - pricing-reframe.css + @import in globals.css → deleted
//   - SkuSummaryRowList + sku-breakdowns (per-route legacy) → deleted
//   - LinesRequiringReview / VerdictBand / PerTierOverrideCard /
//     PricingSectionHead — orphan-on-disk (Catch #4 posture: no
//     cross-surface consumers today; preserved for potential v1.1
//     re-mount or cleanup pass)
//   - CostStackHeader mount removed from Pricing; file STAYS for
//     Costs surface per Catch #4
//   - ActiveTierUrlSync mount removed (PSR doesn't carry an
//     active-tier URL concept); file STAYS for Costs consumer

export default async function CostingPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  // 2026-06-17 prod-hang Vercel-side instrumentation (per Edward's
  // CC handoff comm). See costs/page.tsx for full diagnostic
  // rationale + phase semantics. Pricing surface ALSO runs
  // getCostingBundle + downstream `<PricingClassifierProvider>` which
  // runs the classifier per render — a suspected memory contributor
  // since PR #54.
  const t0 = Date.now();
  const heapMb = () =>
    Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  const elapsed = () => `${Date.now() - t0}ms`;
  const { id: projectId, quoteId } = await params;
  const tag = quoteId.slice(0, 8);
  console.log(`[pricing:${tag}] start memory=${heapMb()}MB`);

  try {
  // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
  await recordSurfaceVisit({
    projectId,
    quoteId,
    surfaceKey: "costing",
  });
  console.log(`[pricing:${tag}] post-auth ${elapsed()} memory=${heapMb()}MB`);

  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();
  console.log(`[pricing:${tag}] post-meta ${elapsed()} memory=${heapMb()}MB`);

  // getCostingBundle MUST run sequentially (its internal Promise.all
  // of 8 queries combined with parallel raws-mode fetch otherwise
  // exhausts the pool — see CLAUDE.md "getCostingBundle parallel-
  // query discipline").
  const bundle = await getCostingBundle(quoteId);
  console.log(`[pricing:${tag}] post-bundle ${elapsed()} memory=${heapMb()}MB`);

  const [tiers, firmRow] = await Promise.all([
    db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quoteId))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
    // slice-pricing-surface-redesign Step 7 — policy gates surfaced
    // from current firm_settings row (Step 2 columns). Separate
    // fetch from getCostingBundle's firmSettings projection because
    // policy gates are not costing-math inputs; they're classifier
    // policy bands. Versioned-table read: current row = effective_until
    // IS NULL, latest effective_from.
    db
      .select({
        allowOverride: firmSettings.allowOverride,
        allowAcceptRisk: firmSettings.allowAcceptRisk,
      })
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1),
  ]);

  if (!bundle.ok) {
    console.log(
      `[pricing:${tag}] pre-render(error) ${elapsed()} memory=${heapMb()}MB`,
    );
    return (
      <NavShell
        surfaceKey="costing"
        projectId={projectId}
        quoteId={quoteId}
        activeScenarioLabel={quote.scenarioLabel}
      >
      <main className="r2-pricing r2-page">
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

  const editable = quote.status === "draft";

  // PSR needs the ★ recommended flag (the classifier's
  // recommended_tier_id input). CostingTier rollup doesn't carry it;
  // this list passes id + label + recommended through.
  const tiersForReframe = tiers.map((t) => ({
    id: t.id,
    label: t.label,
    recommended: t.recommended,
  }));

  console.log(`[pricing:${tag}] pre-render ${elapsed()} memory=${heapMb()}MB`);
  return (
    <NavShell
      surfaceKey="costing"
      projectId={projectId}
      quoteId={quoteId}
      activeScenarioLabel={quote.scenarioLabel}
    >
    <CostingStoreProvider
      snapshot={bundle.data}
      realtimeEnabled={isProductionRealtimeConfigured()}
    >
      {/* slice-pricing-surface-redesign · CB Step 9 re-walk Patch
          round 2 (2026-06-16) — classifier lifted to page-level
          provider. PricingPageHead + PricingSurfaceShell both
          consume the SAME classifier output via
          `usePricingClassifier()`. Brief §3 source-of-truth
          invariant is now structurally enforced — no parallel
          predicate chain anywhere on the surface. */}
      <PricingClassifierProvider
        tiersForReframe={tiersForReframe}
        policy={{
          allow_override: firmRow[0]?.allowOverride ?? true,
          allow_accept_risk: firmRow[0]?.allowAcceptRisk ?? true,
        }}
      >
        {/* Phase 3 mount — the staging provider nests INSIDE the classifier.
            Its preview run calls `useCostingStoreApi`, and that run must
            observe the same store the classifier reads. Nothing in the
            classifier depends on staging, so the reverse nesting would also
            work — and would imply a dependency that does not exist. */}
        <PricingStagingProvider
          initialGlobalAdj={Number(quote.globalPriceAdjPct)}
        >
        <main className="r2-pricing r2-page">
          <PricingPageHead
            projectId={projectId}
            quoteId={quoteId}
            project={project}
            quote={{
              scenarioLabel: quote.scenarioLabel,
              versionNumber: quote.versionNumber,
              status: quote.status,
            }}
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

          <PricingSurfaceShell
            projectId={projectId}
            quoteId={quoteId}
            tiers={tiersForReframe}
          />
        </main>
        </PricingStagingProvider>
      </PricingClassifierProvider>
    </CostingStoreProvider>
    </NavShell>
  );
  } catch (e) {
    // 2026-06-17 prod-hang instrumentation — surface uncaught
    // exceptions with phase context. Re-throw preserves Next.js
    // notFound / redirect handling.
    console.error(`[pricing:${tag}] FAIL ${elapsed()} memory=${heapMb()}MB`, e);
    throw e;
  }
}
