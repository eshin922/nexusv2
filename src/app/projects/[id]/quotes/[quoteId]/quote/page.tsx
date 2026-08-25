import { notFound } from "next/navigation";
import { CustomerViewLive } from "@/components/quote/customer-view-live";
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
import { loadUnresolvedQuoteCosts } from "@/lib/quote-cost-completeness";
import { resolveHubspotAcceptStageLabel } from "@/lib/hubspot-stage-label";
import { loadSalesOrderPreflight } from "@/lib/netsuite/sales-order-preflight";
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
import "@/styles/r3-customer-view.css";
import { isHubspotAcceptSyncSuppressed } from "@/lib/config/certification-mode";

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
    /** Review-only: force the legacy layout for an admin. See below. */
    legacy?: string;
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
    /** Parity-evidence mount. Admin-only, temporary. */
    live?: string;
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
  const { dev, legacy, layout, detail, addendum, tab, live } = await searchParams;
  const activeTabRaw = parseSubTabParam(tab);
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

    const { view, addendumData, project, quote, quoteRollup, recoveryInstructions, recoveryRows, governed, presentation, belowFloor } =
      result;
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
      // Send readiness. The cost guard has always refused an unresolved send;
      // loading it here is what lets the surface SAY so before the operator
      // presses the button, instead of the refusal arriving as an exception.
      unresolvedCosts,
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
          // Slice 12 Step 8c-4 — Sales Order tab needs the effective
          // "status_on_create" so the pending-state ledger + confirm
          // modal render the real target (e.g. "Pending Fulfillment").
          // Was hardcoded in tab-sales-order.tsx pre-8c-4.
          netsuiteSoStatusOnCreate: firmSettings.netsuiteSoStatusOnCreate,
        })
        .from(firmSettings)
        .where(isNull(firmSettings.effectiveUntil))
        .orderBy(desc(firmSettings.effectiveFrom))
        .limit(1),
      loadUnresolvedQuoteCosts(quote.id),
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

    // Slice 12 Step 8c-4 — Sales Order pre-flight. Cheap DB-only
    // reads (customer-map lookup + hubspot deal cache row + latest
    // netsuite_so_pushes row). Only runs when the tab could conceivably
    // render receipt state — draft/sent quotes never reach subtab 5's
    // active state, so skipping the query saves a couple of round-trips
    // on those page loads. See loadSalesOrderPreflight for the intent
    // + scope caveats.
    const salesOrderPreflight =
      quote.status === "accepted" || quote.status === "complete"
        ? await loadSalesOrderPreflight(quote.id, project.id)
        : null;

    // The recovery workspace's supersession prediction. Reads the SAME
    // `quoteRollup` the surface renders from — a second costing read would be
    // a second opinion about the economics, which is the error this seam
    // exists to remove. Costs one query, and returns null immediately when the
    // quote holds no authorizations at all.

    // Slice 12 Step 8c-4 — quote row mirror of the latest push. Same
    // fields as the preflight's latestPush but sourced from the quote
    // (fast; no netsuite_so_pushes join needed on every render). Both
    // sources reconcile: freeze-tx writes both on success; failure
    // writes both. Preflight's latestPush is authoritative for
    // errorDetail (columns like errorClass live only on the push row).
    const soPushMirror = {
      soId: quote.netsuiteSoId,
      soTranid: quote.netsuiteSoTranid,
      pushedAt: quote.netsuitePushedAt,
      pushStatus: quote.netsuiteSoPushStatus,
      pushError: quote.netsuiteSoPushError,
    };

    // Slice 12 Step 10 Q13 — route-level guard for completed quotes,
    // refined at re-walk (2026-07-29) per CA disposition R1.
    //
    // Original guard: coerce every sub-tab to Preview on complete.
    // Problem re-walk surfaced: sub-tab 5 (tier / Sales Order) is
    // the canonical post-lock record — "what was agreed and what was
    // ordered" per CD's audit. Blanket coercion removed the
    // destination, not just the bypass. CB couldn't see the order
    // number or timestamp anywhere in the UI (had to be read from
    // the DB directly to verify Q15's SO2698 landed).
    //
    // Refined rule: sub-tab 5 stays reachable at complete (renders
    // its receipt state). Sub-tabs 1-4 coerce to Preview — their
    // submit-bearing forms would ship live on direct URL navigation.
    // Server-side assertNotFrozen still rejects any submit that
    // slips through.
    const activeTab =
      quote.status === "complete" && activeTabRaw !== "tier"
        ? "preview"
        : activeTabRaw;

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
    const viewer = await ensureUser();

    // ── THE RESTORED LAYOUT IS UNDER REVIEW ─────────────────────────────
    //
    // #376 restores this surface to its Design Authority: document dominant,
    // controls in a panel beside it, Accounting in its own zone. That changes
    // the operator-facing shape, and structural tests are necessary but not
    // sufficient for a layout — so it ships where it can be reviewed with a
    // real session (production is the only surface carrying one) without
    // reaching operators before it has been.
    //
    // TEMPORARY. Removing this deletes every `!presentationRestored` branch in
    // quote-host.tsx. It is NOT a role boundary: the authority's Q6 says the
    // panel is any-PM, and this must come off rather than harden into one.
    //
    // `?legacy=1` forces the legacy path for an admin. The gate cannot come
    // off until BOTH paths have been seen, and every admin sees only the
    // restored one — while nine non-admin users (six PMs, plus accounting,
    // logistics and sales) see only the legacy one. The alternatives were to
    // mutate a real person's role in the database, or to ask a colleague to
    // test; an opt-in query param costs neither and is deleted with the flag.
    const presentationRestored = viewer.role === "admin" && legacy !== "1";


    console.log(
      `[quote:${tag}] pre-render ${elapsed()} memory=${heapMb()}MB`,
    );
    // ── PARITY EVIDENCE MOUNT ────────────────────────────────────────────
    //
    // `?live=1` renders the live HTML document ALONGSIDE nothing else, for one
    // purpose: extracting its content to compare against the PDF's, from the
    // same resolved CustomerView, on production.
    //
    // It does NOT replace the iframe. The disposition is explicit that the
    // preview is not swapped until parity evidence is clean, and evidence
    // gathered by making the change under test is not evidence.
    //
    // Admin-gated by the same condition as the restored surface, and removed
    // once the comparison is recorded.
    if (live === "1" && viewer.role === "admin") {
      return (
        <main style={{ padding: 24 }} data-testid="live-parity-mount">
          <CustomerViewLive view={view} />
        </main>
      );
    }

    return (
      // The viewport the umbrella shell sizes against. The chrome takes its
      // natural height; `.r8-shell` grows into what remains. Before this, the
      // shell claimed a full viewport of its own beneath the chrome and every
      // sub-tab overflowed the page by the chrome's height.
      <div className="r8-viewport">
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
          unresolvedCosts={unresolvedCosts}
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
          recoveryInstructions={recoveryInstructions}
          recoveryRows={recoveryRows}
          presentation={presentation}
          // EVERY tier, not the presented subset. `view.tiers` has already had
          // the hidden ones removed, so building the toggles from it would drop
          // a tier's own toggle the moment it was hidden — a one-way door.
          presentationTiers={presentation.allTiers}
          belowFloor={belowFloor}
          governed={governed}
          presentationRestored={presentationRestored}
          acceptancePrefill={acceptancePrefill}
          hubspotAcceptStageLabel={hubspotAcceptStageLabel}
          hubspotAcceptSyncSuppressed={isHubspotAcceptSyncSuppressed()}
          hubspotPushedAmount={hubspotPushedAmount}
          netsuiteStatusOnPush={
            firmSettingsRow[0]?.netsuiteSoStatusOnCreate ??
            "Pending Fulfillment"
          }
          salesOrderPreflight={salesOrderPreflight}
          soPushMirror={soPushMirror}
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
      </div>
    );
  } catch (e) {
    console.error(`[quote:${tag}] FAIL ${elapsed()} memory=${heapMb()}MB`, e);
    throw e;
  }
}
