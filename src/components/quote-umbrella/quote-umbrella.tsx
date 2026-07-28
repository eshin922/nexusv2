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
import type { VersionRow } from "@/lib/quote-version-chain";
import { SubTabStrip } from "./sub-tab-strip";
import { Legend } from "./legend";
import { QuoteAxisProvider } from "./quote-axis-context";
import { TabPreviewQuote } from "./tab-preview-quote";
import { TabSendToClient } from "./tab-send-to-client";
import { TabClientReview } from "./tab-client-review";
import { TabMarkAccepted, TabTierSelection } from "./tab-stubs";
import type { SubTabId } from "./subtabs";

export function QuoteUmbrella({
  activeTab,
  view,
  quoteId,
  quoteStatus,
  quoteVersionNumber,
  showStateSwitcher,
  internalNotes,
  addendumData,
  isHubspotLinked,
  reviewFeedCount,
  reviewFeed,
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
          onGo={onGo}
        />
        {showLegend && <Legend />}
        <div className="r8-body">
          {activeTab === "preview" && (
            <TabPreviewQuote
              view={view}
              quoteId={quoteId}
              quoteStatus={quoteStatus}
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
              onGo={onGo}
            />
          )}
          {activeTab === "accepted" && <TabMarkAccepted onGo={onGo} />}
          {activeTab === "tier" && <TabTierSelection onGo={onGo} />}
        </div>
      </div>
    </QuoteAxisProvider>
  );
}
