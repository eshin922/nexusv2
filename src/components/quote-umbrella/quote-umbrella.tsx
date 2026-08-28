"use client";

// Slice 12 Step 1 — QuoteUmbrella shell.
// Pattern 30 port of R8 canonical `QuoteUmbrella` (umbrella.jsx
// higher-order composition). Wraps the 5 sub-tab bodies inside a
// SubTabStrip + Legend + body slot.
//
// URL strategy: sub-tab state via `?tab=<id>` on the /quote route.
// Matches Pricing's `activeTierId` URL-sync pattern (URL is canonical;
// store/state is a local cache to avoid router round-trips). The
// active tab is passed in as a prop (server-resolved from
// searchParams); onGo pushes the new URL via next/navigation.
//
// Step 1 scope: IA + scaffolding only. Sub-tab bodies are stubs
// (except Preview which wraps QuoteHost verbatim per §11 Step 4
// deferral). Advance-bar buttons for Steps 5-8 are disabled until
// their step lands.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { UnbillablePlacement } from "@/lib/commercial-recovery/unbillable-placements";
import type { ChargeRecoveryPricingGap } from "@/lib/component-charges/recovery-pricing";
import type { BelowFloorProjection } from "@/lib/below-floor-projection";
import type {
  PresentationState,
  PresentationTier,
} from "@/components/quote/card-customer-presentation";
import { useCallback } from "react";
import type { CustomerView } from "@/types/quote";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import type { FrozenRecoveryInstruction } from "@/lib/commercial-recovery/frozen-instruction";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { GovernedSummary } from "@/components/quote/customer-view-rail";
import type { ReviewEventRow } from "@/lib/quote-review-events";
import type { SentSnapshotRow } from "@/lib/quote-snapshots";
import type { VersionRow } from "@/lib/quote-version-chain";
import type { QuotePerTierRollup } from "@/lib/costing";
import type { PreflightResult } from "@/lib/netsuite/sales-order-preflight";
import type { IdentityReadiness } from "@/lib/netsuite/identity-readiness";
import type { DealOrderReadiness } from "@/lib/netsuite/deal-order-readiness";
import { SubTabStrip } from "./sub-tab-strip";
import { Legend } from "./legend";
import { QuoteAxisProvider } from "./quote-axis-context";
import { TabPreviewQuote } from "./tab-preview-quote";
import { TabSendToClient } from "./tab-send-to-client";
import type { UnresolvedQuoteCost } from "@/lib/quote-cost-completeness-contract";
import { TabClientReview } from "./tab-client-review";
import { TabMarkAccepted } from "./tab-mark-accepted";
import { TabSalesOrder } from "./tab-sales-order";
import type { SubTabId } from "./subtabs";

export function QuoteUmbrella({
  unresolvedCosts,
  activeTab,
  view,
  quoteId,
  quoteStatus,
  quoteVersionNumber,
  quoteAcceptedAt,
  quoteNumberDb,
  quoteSentAtDb,
  customerAcceptedTierIdDb,
  quoteRollup,
  acceptancePrefill,
  hubspotAcceptStageLabel,
  hubspotAcceptSyncSuppressed = false,
  hubspotPushedAmount,
  netsuiteStatusOnPush,
  salesOrderPreflight,
  identityReadiness,
  dealOrderReadiness,
  soPushMirror,
  showStateSwitcher,
  recoveryInstructions,
  recoveryRows,
  presentation,
  presentationTiers,
  belowFloor,
  unbillableRecovery,
  chargeRecoveryPricingGaps,
  accountingInstruction,
  governed,
  presentationRestored,
  allowSimulatedComplete,
  internalNotes,
  addendumData,
  isHubspotLinked,
  reviewFeedCount,
  reviewFeed,
  latestSupersededSnapshot,
  projectId,
  versionChain,
}: {
  /** Send readiness, loaded server-side. Empty means nothing blocks the send. */
  unresolvedCosts: ReadonlyArray<UnresolvedQuoteCost>;
  activeTab: SubTabId;
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  /** Slice 12 Step 5c — passed for the Send-tab waiting-state's
   * v{N} + Revise's v{N+1} copy. Kept off CustomerView per
   * Pattern 45 (customer type stays PM-versioning-clean). */
  quoteVersionNumber: number;
  /** Slice 12 Step 7a — passed for Mark Accepted's "accepted by ·
   * when" line. NULL for non-accepted quotes. Kept off
   * CustomerView per Pattern 45. */
  quoteAcceptedAt: Date | null;
  /** Slice 12 Step 7c review-fix — raw DB `quote.quote_number`,
   * NOT the resolver's customer-view projection. The resolver
   * masks quoteNumber to null in draft (Pattern 45 boundary for
   * customer PDF — customer never sees a draft with a number).
   * PM-internal panels that surface the identifier (Mark Accepted's
   * "Recording against" block) need the true DB value regardless of
   * status — a revised v2 draft still has its original DPS-N number
   * on the row; the picker and PM panels must show it. Threaded as
   * a distinct prop to avoid unmasking the resolver (which would
   * defeat Pattern 45 for the actual customer render). */
  quoteNumberDb: string | null;
  /** Slice 12 Step 7c review-fix — raw DB `quote.sent_at`. Same
   * reasoning as quoteNumberDb: reviseQuote preserves sent_at on
   * the quote row (v3 §5.1 — "sent_at STAYS post-Revise"), so a
   * v2 draft carries v1's send timestamp. Customer-view projection
   * renders that unconditionally as the customer-facing "Issued"
   * date; PM panels need the raw value to decide whether to show
   * "sent DATE" (post-send) vs "not sent" (fresh draft) at all. */
  quoteSentAtDb: Date | null;
  /** Slice 12 Step 8a — raw DB `quote.customer_accepted_tier_id`.
   * Nullable; populated when acceptance has been recorded (survives
   * rollback per FK SET NULL). Renders the "named" marker on the
   * matching tier chip so PMs recognize a prior capture after a
   * rollback + re-accept cycle. */
  customerAcceptedTierIdDb: string | null;
  /** Slice 12 Step 8a — per-tier rollup for the acceptance sub-tab's
   * tier chips (turnkey + margin + status). PM-facing only. */
  quoteRollup: QuotePerTierRollup[];
  /** Slice 12 Step 8a — server-side prefill for the acceptance
   * transcription textarea. See getLatestRespondedEventForPrefill. */
  acceptancePrefill: {
    note: string;
    createdAt: Date;
    sourceRowId: string;
  } | null;
  /** Slice 12 Step 8a — resolved human-readable target stage for the
   * "Now · HubSpot" system card copy on sub-tab 4. Resolved at
   * page-load from firm_settings.hubspot_deal_stage_on_accept via
   * loadPipelineStages when the stored value is an id; passed
   * verbatim when the stored value is already a label. Fallback
   * string when resolution fails. */
  hubspotAcceptStageLabel: string;
  hubspotAcceptSyncSuppressed?: boolean;
  /** Slice 12 Step 8b — HubSpot amount 8a pushed at acceptance,
   * read from audit_log's quote_accepted diff_json.hubspot.amount.
   * Rendered on the Sales Order tab's ledger row ("HubSpot — deal
   * set to Won - In production at $X"). Nullable — legacy quotes
   * accepted pre-8a don't have amount in the audit; the Sales
   * Order tab falls back to the carried tier's totalRevenue
   * (structurally the same figure per PR #147 derivation trace). */
  hubspotPushedAmount: number | null;
  /** Slice 12 Step 8c-4 — effective firm_settings.netsuite_so_status_on_create
   * value ("Pending Fulfillment" for DPS). Was hardcoded on the Sales
   * Order tab pre-8c-4; now server-resolved so the receipt + confirm
   * modal reflect the firm's actual configuration. */
  netsuiteStatusOnPush: string;
  /** Slice 12 Step 8c-4 — pre-flight state for the Sales Order tab.
   * Null when the quote's status isn't accepted/complete (tab is
   * unreachable in that state; skipping the DB reads is a minor
   * optimization). Preflight covers: customer-map resolution,
   * ship-to line, latest netsuite_so_pushes row (for failed-state
   * re-renders). */
  salesOrderPreflight: PreflightResult | null;
  /** Predicts the two identity refusals so step 5 cannot claim readiness it
   * does not have. Advisory: buildFrozenSalesOrder remains the guard. */
  identityReadiness: IdentityReadiness | null;
  dealOrderReadiness: DealOrderReadiness | null;
  /** Slice 12 Step 8c-4 — quote row's mirror of the last SO push.
   * Populated on success (freeze-tx) OR failure (STEP 7 catch).
   * Drives the record vs failed variant selection on the Sales
   * Order tab across page reloads. */
  soPushMirror: {
    soId: string | null;
    soTranid: string | null;
    pushedAt: Date | null;
    pushStatus: string | null;
    pushError: string | null;
  };
  showStateSwitcher: boolean;
  /** For the Accounting zone — the sentences the send freeze will write. */
  recoveryInstructions: readonly FrozenRecoveryInstruction[];
  recoveryRows: RecoveryChargeRow[];
  presentation: PresentationState;
  presentationTiers: readonly PresentationTier[];
  belowFloor: BelowFloorProjection;
  unbillableRecovery: UnbillablePlacement[];
  chargeRecoveryPricingGaps: ChargeRecoveryPricingGap[];
  accountingInstruction: string | null;
  governed: GovernedSummary;
  /** TEMPORARY admin gate on the restored layout — see quote-host.tsx. */
  presentationRestored: boolean;
  /** Slice 12 Step 8b · CB P2 fix — hard-guard on the strip-state
   * simulation. Computed server-side in page.tsx from VERCEL_ENV so
   * client-baked NODE_ENV can't be the sole gate (Vercel Preview
   * builds have NODE_ENV=production). false = production Vercel
   * domain → simulation blocked. true = preview / development /
   * local → simulation allowed. Even so, the simulation is
   * cosmetic-only per the grep — no writes, actions, or gating
   * consume effectiveQuoteStatus. */
  allowSimulatedComplete: boolean;
  internalNotes: string | null;
  addendumData: QuoteAddendumData | null;
  isHubspotLinked: boolean;
  /** Slice 12 Step 5c — real count from quote_review_events.
   * Renders the sub-tab strip's Client Review badge (when > 0). */
  reviewFeedCount: number;
  /** Slice 12 Step 6a — full feed rows (newest first, joined with
   * users for author names). Only the Client Review sub-tab
   * consumes; passed at umbrella level for symmetry with count. */
  reviewFeed: ReviewEventRow[];
  /** Slice 12 Step 6d — most-recently-superseded quote_snapshots row
   * for this quote, if any. Present ⟺ the quote has been sent at
   * least once and (typically) revised. Combined with status=draft
   * to gate MismatchBanner render on Client Review. */
  latestSupersededSnapshot: SentSnapshotRow | null;
  /** Slice 12 Step 4 — routes the version-picker's cross-version
   * Links. Only the Preview tab uses it currently; passed at umbrella
   * level so future sub-tabs (e.g., Client Review's mismatch banner
   * "View v3 sent" link) can reuse. */
  projectId: string;
  /** Slice 12 Step 4 — sibling quote rows for this scenario family.
   * Resolved server-side in page.tsx (server-only import). */
  versionChain: VersionRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onGo = useCallback(
    (id: SubTabId) => {
      const params = new URLSearchParams(
        searchParams ? searchParams.toString() : "",
      );
      params.set("tab", id);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // Slice 12 Step 8b · CB P2 fix — when the Sales Order dev switcher
  // simulates the RECORD state (`?dev=1&so-state=record`), the receipt
  // renders "quote and every sub-tab are read-only" copy — but the
  // underlying quote.status is still 'accepted' (no writer flips it
  // to 'complete' in 8b). Without this override, the sub-tab strip
  // would render tabs 1-4 as "done · revisitable" (their state pre-
  // commit), contradicting the receipt copy CB flagged.
  //
  // Solution: when the dev switcher is active AND the URL says
  // so-state=record, present the strip with an effectiveQuoteStatus
  // of 'complete' so Pattern 52's freeze is visible in the strip —
  // tabs 1-4 render as 'locked', matching what production will show
  // once 8c wires markComplete. Legend also hides in the simulated
  // complete state (matches production behavior — showLegend gates
  // on 'complete').
  //
  // Production behavior is unchanged: real quote.status='complete'
  // → subTabStatus returns 'locked' for every tab → strip labels
  // "locked" per subTabSubLabel. The dev-switcher override just
  // makes CB (and CD) able to walk that visual state without a
  // real markComplete write.
  const soStateParam = searchParams?.get("so-state");
  // Slice 12 Step 8b · CB P2 fix — CA blast-radius review (2026-07-28):
  // hard-guard on `allowSimulatedComplete` so a curious PM hitting
  // ?dev=1&so-state=record on the PRODUCTION Vercel deploy cannot see
  // a false "complete" state on a real quote. Prop is computed server-
  // side in page.tsx from VERCEL_ENV (VERCEL_ENV === 'production' →
  // false; 'preview' | 'development' | absent → true). Client-side
  // NODE_ENV can't be used here — Vercel bakes NODE_ENV='production'
  // into ALL builds including previews, which would break CB's walk
  // on the preview URL.
  //
  // effectiveQuoteStatus blast radius (grep-verified):
  //   - SubTabStrip prop (cosmetic; drives sub-label rendering)
  //   - showLegend gate (cosmetic; hides legend when 'complete')
  //   - ZERO touch of sub-tab bodies, actions, writers, gating
  // Cosmetic scope, hard-guarded anyway per CA discipline: "dev
  // override with production reach" is a category to prevent, not
  // just narrow.
  const simulateComplete =
    allowSimulatedComplete &&
    showStateSwitcher &&
    soStateParam === "record" &&
    quoteStatus === "accepted";
  const effectiveQuoteStatus = simulateComplete ? "complete" : quoteStatus;

  const showLegend = effectiveQuoteStatus !== "complete";

  // Slice 12 Step 7c review-fix (CB P2) — derive "has this quote
  // been sent at least once?" from live state OR from the existence
  // of a superseded snapshot. Enables Client Review tab reachability
  // in the draft-with-history state (post-Revise) so PMs can consult
  // prior review context while working on v{N+1}. See subtabs.ts
  // subTabStatus for the derivation rule.
  const hasSentHistory =
    quoteStatus !== "draft" || latestSupersededSnapshot !== null;

  return (
    // Slice 12 Step 5d — axis state lifted to context so the Send
    // sub-tab (Step 5c/5d) can read PM's current toggle choices at
    // send time. Initial values come from the server-resolved view
    // (page.tsx derives them from searchParams, so deep-link init
    // still works). Toggles on Preview update context in place —
    // no RSC refetch.
    <QuoteAxisProvider
      initialPdfLayout={view.pdfLayout}
      initialDetailLevel={view.detailLevel}
      initialIncludeSpecAddendum={view.includeSpecAddendum}
    >
      <div className="r8-shell">
        <SubTabStrip
          activeId={activeTab}
          quoteStatus={effectiveQuoteStatus}
          feedCount={reviewFeedCount}
          hasSentHistory={hasSentHistory}
          lockBlocked={identityReadiness?.status === "blocked"}
          onGo={onGo}
        />
        {showLegend && <Legend />}
        {/* The bottom padding reserves room for the advance bar. Preview
            Quote on the restored surface has none -- the act lives in the
            rail footer -- so reserving there leaves a dead 96px strip.
            Keyed to the SAME condition that decides whether the bar renders
            (tab-preview-quote.tsx), so the two cannot drift apart. */}
        <div
          className={
            "r8-body" +
            (presentationRestored && activeTab === "preview" ? " r8-body-no-advance" : "")
          }
        >
          {activeTab === "preview" && (
            <TabPreviewQuote
              view={view}
              quoteId={quoteId}
              quoteStatus={quoteStatus}
              quoteNumberDb={quoteNumberDb}
              recoveryInstructions={recoveryInstructions}
              recoveryRows={recoveryRows}
          presentation={presentation}
          presentationTiers={presentationTiers}
          belowFloor={belowFloor}
          unbillableRecovery={unbillableRecovery}
          chargeRecoveryPricingGaps={chargeRecoveryPricingGaps}
          accountingInstruction={accountingInstruction}
              quoteRollup={quoteRollup}
              governed={governed}
              presentationRestored={presentationRestored}
              internalNotes={internalNotes}
              addendumData={addendumData}
              isHubspotLinked={isHubspotLinked}
              projectId={projectId}
              versionChain={versionChain}
              onGo={onGo}
            />
          )}
          {activeTab === "send" && (
            <TabSendToClient
              unresolvedCosts={unresolvedCosts}
              view={view}
              quoteId={quoteId}
              quoteStatus={quoteStatus}
              quoteVersionNumber={quoteVersionNumber}
              reviewFeedCount={reviewFeedCount}
              isHubspotLinked={isHubspotLinked}
              quoteRollup={quoteRollup}
              onGo={onGo}
            />
          )}
          {activeTab === "review" && (
            <TabClientReview
              view={view}
              quoteId={quoteId}
              quoteStatus={quoteStatus}
              quoteVersionNumber={quoteVersionNumber}
              feed={reviewFeed}
              latestSupersededSnapshot={latestSupersededSnapshot}
              onGo={onGo}
            />
          )}
          {activeTab === "accepted" && (
            <TabMarkAccepted
              view={view}
              quoteId={quoteId}
              quoteStatus={quoteStatus}
              quoteVersionNumber={quoteVersionNumber}
              quoteAcceptedAt={quoteAcceptedAt}
              quoteNumberDb={quoteNumberDb}
              quoteSentAtDb={quoteSentAtDb}
              quoteRollup={quoteRollup}
              customerAcceptedTierIdDb={customerAcceptedTierIdDb}
              prefillNote={acceptancePrefill?.note ?? null}
              prefillSourceRowId={acceptancePrefill?.sourceRowId ?? null}
              prefillSourceAt={acceptancePrefill?.createdAt ?? null}
              hubspotAcceptStageLabel={hubspotAcceptStageLabel}
              hubspotAcceptSyncSuppressed={hubspotAcceptSyncSuppressed}
              dealOrderReadiness={dealOrderReadiness}
              onGo={onGo}
            />
          )}
          {activeTab === "tier" && (
            <TabSalesOrder
              view={view}
              quoteId={quoteId}
              quoteStatus={quoteStatus}
              quoteVersionNumber={quoteVersionNumber}
              quoteNumberDb={quoteNumberDb}
              quoteAcceptedAt={quoteAcceptedAt}
              customerAcceptedTierIdDb={customerAcceptedTierIdDb}
              quoteRollup={quoteRollup}
              hubspotAcceptStageLabel={hubspotAcceptStageLabel}
              hubspotAcceptSyncSuppressed={hubspotAcceptSyncSuppressed}
              hubspotPushedAmount={hubspotPushedAmount}
              netsuiteStatusOnPush={netsuiteStatusOnPush}
              salesOrderPreflight={salesOrderPreflight}
              identityReadiness={identityReadiness}
              dealOrderReadiness={dealOrderReadiness}
              soPushMirror={soPushMirror}
              /* Slice 12 Step 8c-4 — hard-guard the Sales Order dev
                 switcher on VERCEL_ENV !== 'production' (via
                 allowSimulatedComplete) alongside the soft
                 showStateSwitcher gate. Since 8c-4 the write path
                 is live; every dev-switcher variant (pending / failed
                 / record) must be hard-blocked in production even
                 when a curious PM adds ?dev=1. Matches the #148
                 pattern extended from the record-only guard to the
                 whole variant switcher. */
              showStateSwitcher={showStateSwitcher && allowSimulatedComplete}
              onGo={onGo}
            />
          )}
        </div>
      </div>
    </QuoteAxisProvider>
  );
}
