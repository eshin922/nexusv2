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
import { useCallback } from "react";
import type { CustomerView } from "@/types/quote";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import type { ReviewEventRow } from "@/lib/quote-review-events";
import type { SentSnapshotRow } from "@/lib/quote-snapshots";
import type { VersionRow } from "@/lib/quote-version-chain";
import type { QuotePerTierRollup } from "@/lib/costing";
import { SubTabStrip } from "./sub-tab-strip";
import { Legend } from "./legend";
import { QuoteAxisProvider } from "./quote-axis-context";
import { TabPreviewQuote } from "./tab-preview-quote";
import { TabSendToClient } from "./tab-send-to-client";
import { TabClientReview } from "./tab-client-review";
import { TabMarkAccepted } from "./tab-mark-accepted";
import { TabTierSelection } from "./tab-stubs";
import type { SubTabId } from "./subtabs";

export function QuoteUmbrella({
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
  showStateSwitcher,
  internalNotes,
  addendumData,
  isHubspotLinked,
  reviewFeedCount,
  reviewFeed,
  latestSupersededSnapshot,
  projectId,
  versionChain,
}: {
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
  showStateSwitcher: boolean;
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

  const showLegend = quoteStatus !== "complete";

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
          quoteStatus={quoteStatus}
          feedCount={reviewFeedCount}
          hasSentHistory={hasSentHistory}
          onGo={onGo}
        />
        {showLegend && <Legend />}
        <div className="r8-body">
          {activeTab === "preview" && (
            <TabPreviewQuote
              view={view}
              quoteId={quoteId}
              quoteStatus={quoteStatus}
              quoteNumberDb={quoteNumberDb}
              showStateSwitcher={showStateSwitcher}
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
              view={view}
              quoteId={quoteId}
              quoteStatus={quoteStatus}
              quoteVersionNumber={quoteVersionNumber}
              reviewFeedCount={reviewFeedCount}
              isHubspotLinked={isHubspotLinked}
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
              onGo={onGo}
            />
          )}
          {activeTab === "tier" && <TabTierSelection onGo={onGo} />}
        </div>
      </div>
    </QuoteAxisProvider>
  );
}
