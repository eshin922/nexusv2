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
} from "@/lib/quote-review-events";
import { getLatestSupersededSnapshot } from "@/lib/quote-snapshots";
// Slice 12 Step 1 — canonical CSS + shared primitives loaded only on
// the /quote route (blast-radius scoped per Step 1 planning).
import "@/styles/r-shared-primitives.css";
import "@/styles/r8-quote-umbrella.css";

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

    const { view, addendumData, project, quote } = result;
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
    const [
      versionChain,
      reviewFeedCount,
      reviewFeed,
      latestSupersededSnapshot,
    ] = await Promise.all([
      loadScenarioVersionChain({
        projectId: project.id,
        scenarioLabel: quote.scenarioLabel,
        currentQuoteId: quote.id,
      }),
      getReviewFeedCount(quote.id),
      getReviewFeed(quote.id),
      getLatestSupersededSnapshot(quote.id),
    ]);

    const showStateSwitcher =
      dev === "1" || process.env.NODE_ENV !== "production";

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
          showStateSwitcher={showStateSwitcher}
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
