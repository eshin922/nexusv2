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
import { SubTabStrip } from "./sub-tab-strip";
import { Legend } from "./legend";
import { TabPreviewQuote } from "./tab-preview-quote";
import {
  TabSendToClient,
  TabClientReview,
  TabMarkAccepted,
  TabTierSelection,
} from "./tab-stubs";
import type { SubTabId } from "./subtabs";

export function QuoteUmbrella({
  activeTab,
  view,
  quoteId,
  quoteStatus,
  showStateSwitcher,
  internalNotes,
  addendumData,
  isHubspotLinked,
  reviewFeedCount,
}: {
  activeTab: SubTabId;
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  showStateSwitcher: boolean;
  internalNotes: string | null;
  addendumData: QuoteAddendumData | null;
  isHubspotLinked: boolean;
  /** Slice 12 Step 1 — passed as 0 until Step 6 wires the real
   * quote_review_events count. The strip renders the badge when > 0. */
  reviewFeedCount: number;
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
            onGo={onGo}
          />
        )}
        {activeTab === "send" && <TabSendToClient onGo={onGo} />}
        {activeTab === "review" && <TabClientReview onGo={onGo} />}
        {activeTab === "accepted" && <TabMarkAccepted onGo={onGo} />}
        {activeTab === "tier" && <TabTierSelection onGo={onGo} />}
      </div>
    </div>
  );
}
