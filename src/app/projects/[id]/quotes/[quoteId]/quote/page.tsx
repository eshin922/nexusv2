import { notFound } from "next/navigation";
import { SurfaceChrome } from "@/components/nav/surface-chrome";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { ensureUser } from "@/lib/auth/ensure-user";
import { resolveCustomerView } from "@/lib/customer-view-resolver";
import { isHubspotLinkedDealId } from "@/lib/hubspot-linkage";
import { QuoteUmbrella } from "@/components/quote-umbrella/quote-umbrella";
import { parseSubTabParam } from "@/components/quote-umbrella/subtabs";
import { loadScenarioVersionChain } from "@/lib/quote-version-chain";
import {
  getReviewFeed,
  getReviewFeedCount,
  getLatestRespondedEventForPrefill,
} from "@/lib/quote-review-events";
import { getLatestSupersededSnapshot } from "@/lib/quote-snapshots";
import { resolveHubspotAcceptStageLabel } from "@/lib/hubspot-stage-label";
import { db } from "@/db";
import { auditLog, firmSettings } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
// Slice 12 Step 1 — canonical CSS + shared primitives loaded only on
// the /quote route (blast-radius scoped per Step 1 planning).
// Slice 12 Step 8a — R9 addendum loaded AFTER r8 per Pattern 30
// / R9 designer notes §7 ("Load order: r8 styles first, then r9").
// Five documented overrides at bottom of the addendum; everything
// else is new (.r9-*) with no r8 collisions.
import "@/styles/r-shared-primitives.css";
import "@/styles/r8-quote-umbrella.css";
import "@/styles/r9-quote-umbrella-addendum.css";

// Slice RI.6 — Quote page (visual shell + boundary-guard
// build invariant per brief §3.7).
// Slice RI.7 — wires real firm_settings live reads + per-quote
// snapshots into the data shape.
// Slice 11 Step 6.2 — CustomerView resolution extracted to
// src/lib/customer-view-resolver.ts so this page + the new
// /api/quotes/[quoteId]/customer-pdf route (Step 6.3) build the
// view from the SAME code path — no divergence between the
// preview iframe and the persisted PDF.

export default async function CustomerViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quoteId: string }>;
  searchParams: Promise<{
    dev?: string;
    /**
     * Slice 11 Step 4 preview overrides. Draft-mode only —
     * sent quotes always read from the immutable snapshot column.
     * Priority order (per brief §4):
     *   isSent ? quote.{col} : (searchParams.{param} ?? quote.{col} ?? default)
     */
    layout?: string;
    detail?: string;
    addendum?: string;
    /**
     * Slice 12 Step 1 — sub-tab selection within the Quote umbrella.
     * Defaults to `preview` if absent or invalid. Values: preview,
     * send, review, accepted, tier (see subtabs.ts SUBTABS canon).
     */
    tab?: string;
  }>;
}) {
  // 2026-06-17 prod-hang Vercel-side instrumentation (see
  // costs/page.tsx for full rationale). Quote umbrella runs the
  // resolver's costing bundle + addendum loader + preparedBy chain
  // (heavy on memory if a quote has many SKUs).
  const t0 = Date.now();
  const heapMb = () =>
    Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  const elapsed = () => `${Date.now() - t0}ms`;
  const { id: projectId, quoteId } = await params;
  const { dev, layout, detail, addendum, tab } = await searchParams;
  const activeTab = parseSubTabParam(tab);
  const tag = quoteId.slice(0, 8);
  console.log(`[quote:${tag}] start memory=${heapMb()}MB`);

  try {
    // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
    await recordSurfaceVisit({
      projectId,
      quoteId,
      surfaceKey: "customer_view",
    });
    console.log(`[quote:${tag}] post-auth ${elapsed()} memory=${heapMb()}MB`);

    const result = await resolveCustomerView({
      quoteId,
      searchParams: { layout, detail, addendum },
    });
    console.log(
      `[quote:${tag}] post-resolve ${elapsed()} memory=${heapMb()}MB`,
    );

    if (!result.ok) {
      if (result.kind === "not_found") notFound();
      // bundle_error — render inline error UI (no throw; keep the
      // surface chrome so PMs know where they are).
      return (
        <main
          style={{ padding: "32px 24px", maxWidth: 880, margin: "0 auto" }}
        >
          <div style={{ marginBottom: 16 }}>
            <SurfaceChrome
              surfaceKey="customer_view"
              segments={[]}
              breadcrumbTarget="customer_view"
              projectId={projectId}
              quoteId={quoteId}
            />
          </div>
          <h1>Quote unavailable</h1>
          <p style={{ color: "var(--bad)" }}>{result.message}</p>
        </main>
      );
    }

    const { view, addendumData, project, quote, quoteRollup } = result;
    if (project.id !== projectId) notFound();

    // Slice 12 Step 4 — sibling quote versions for the Preview
    // version-picker. Reads all quotes with same (project_id,
    // scenario_label), newest first. Cheap query (indexed on
    // project_id; typically 1-6 rows per scenario in prod).
    //
    // Slice 12 Step 5c — feed count for the sub-tab strip's Client
    // Review badge + the Send-tab waiting-state "N entries so far"
    // copy. Cheap indexed count query.
    // Slice 12 Step 6a — parallel-load the Client Review feed rows
    // alongside count + version chain. Count feeds sub-tab-strip
    // badge; feed rows feed the Client Review sub-tab body. Cheap
    // indexed reads; typical <20 rows per quote.
    // Slice 12 Step 6d — also load latest-superseded snapshot for
    // MismatchBanner gate. Small indexed query; parallelizes cheaply.
    // Slice 12 Step 8a — parallel adds:
    //   - acceptancePrefill: most-recent PM-authored 'responded' feed
    //     entry for the Acceptance sub-tab's "Their words" textarea
    //     pre-fill. Small indexed lookup.
    //   - firmSettingsRow: needed for the "Now · HubSpot" system card
    //     copy on sub-tab 4 (target-stage label). One-row lookup on
    //     effective_until IS NULL.
    // Both cheap; keep out of any nested Promise.all with
    // getCostingBundle per parallel-query discipline.
    const [
      versionChain,
      reviewFeedCount,
      reviewFeed,
      latestSupersededSnapshot,
      acceptancePrefill,
      firmSettingsRow,
    ] = await Promise.all([
      loadScenarioVersionChain({
        projectId: project.id,
        scenarioLabel: quote.scenarioLabel,
        currentQuoteId: quote.id,
      }),
      getReviewFeedCount(quote.id),
      getReviewFeed(quote.id),
      getLatestSupersededSnapshot(quote.id),
      getLatestRespondedEventForPrefill(quote.id),
      db
        .select({
          hubspotDealStageOnAccept: firmSettings.hubspotDealStageOnAccept,
        })
        .from(firmSettings)
        .where(isNull(firmSettings.effectiveUntil))
        .orderBy(desc(firmSettings.effectiveFrom))
        .limit(1),
    ]);

    // Slice 12 Step 8b — pull the HubSpot amount 8a pushed at
    // acceptance from the most-recent quote_accepted audit row.
    // Rendered on the Sales Order tab's ledger. Only present for
    // quotes accepted post-8a; older accepts pre-date the amount
    // write (Step 8b Sales Order falls back to tier.totalRevenue).
    let hubspotPushedAmount: number | null = null;
    if (quote.status === "accepted" || quote.status === "complete") {
      const priorAccept = await db
        .select({ diffJson: auditLog.diffJson })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, "quote"),
            eq(auditLog.entityId, quote.id),
            eq(auditLog.action, "quote_accepted"),
          ),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      const dj = priorAccept[0]?.diffJson;
      if (dj && typeof dj === "object" && "hubspot" in dj) {
        const hs = (dj as { hubspot?: { amount?: number } }).hubspot;
        if (hs && typeof hs.amount === "number") {
          hubspotPushedAmount = hs.amount;
        }
      }
    }

    // Resolve HubSpot accept-stage LABEL for the sub-tab 4 systems
    // card. firm_settings stores an id today ('195607084') post the
    // Slice 12 Step 7b fix-pass; the resolver falls back to the raw
    // value if pipeline lookup fails (network / API error), and to a
    // generic phrase if firm_settings has no active row. Sub-tab 4 is
    // read-only display; a failed resolve degrades to the raw id
    // rather than blocking the whole page render.
    const hubspotAcceptStageLabel = await resolveHubspotAcceptStageLabel(
      firmSettingsRow[0]?.hubspotDealStageOnAccept ?? null,
    );

    const showStateSwitcher =
      dev === "1" || process.env.NODE_ENV !== "production";
    // Slice 12 Step 8b · CB P2 fix — CA blast-radius review
    // (2026-07-28). See quote-umbrella.tsx allowSimulatedComplete
    // prop docs for the rationale. VERCEL_ENV is set by Vercel to
    // 'production' | 'preview' | 'development'; absent locally.
    // Production Vercel domain → blocked; preview / local → allowed.
    const allowSimulatedComplete =
      process.env.VERCEL_ENV !== "production";

    // Slice 11 Step 6 — auth check for surface access. The Send
    // button is un-gated (any authenticated PM); admin role no
    // longer required per §3 disposition. `ensureUser` here only
    // gates the surface itself.
    await ensureUser();

    console.log(
      `[quote:${tag}] pre-render ${elapsed()} memory=${heapMb()}MB`,
    );
    return (
      <>
        <div style={{ padding: "16px 24px 0" }}>
          <SurfaceChrome
            surfaceKey="customer_view"
            segments={[]}
            breadcrumbTarget="customer_view"
            projectId={project.id}
            quoteId={quote.id}
          />
        </div>
        <QuoteUmbrella
          activeTab={activeTab}
          view={view}
          quoteId={quote.id}
          quoteStatus={quote.status}
          quoteVersionNumber={quote.versionNumber}
          quoteAcceptedAt={quote.acceptedAt}
          quoteNumberDb={quote.quoteNumber}
          quoteSentAtDb={quote.sentAt}
          customerAcceptedTierIdDb={quote.customerAcceptedTierId}
          quoteRollup={quoteRollup}
          acceptancePrefill={acceptancePrefill}
          hubspotAcceptStageLabel={hubspotAcceptStageLabel}
          hubspotPushedAmount={hubspotPushedAmount}
          showStateSwitcher={showStateSwitcher}
          allowSimulatedComplete={allowSimulatedComplete}
          internalNotes={quote.internalNotes}
          addendumData={addendumData}
          isHubspotLinked={isHubspotLinkedDealId(project.hubspotDealId)}
          reviewFeedCount={reviewFeedCount}
          reviewFeed={reviewFeed}
          latestSupersededSnapshot={latestSupersededSnapshot}
          projectId={project.id}
          versionChain={versionChain}
        />
      </>
    );
  } catch (e) {
    console.error(`[quote:${tag}] FAIL ${elapsed()} memory=${heapMb()}MB`, e);
    throw e;
  }
}
