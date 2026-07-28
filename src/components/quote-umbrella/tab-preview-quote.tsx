"use client";

// Slice 12 Step 1 — Preview Quote sub-tab body.
//
// Wraps the existing QuoteHost verbatim. Step 4 (§11) does the real
// re-housing (version-picker UI + Preview-only chrome per R8 §2.2
// designer notes); Step 1 just moves QuoteHost under the umbrella
// without touching it, so the Preview surface keeps working exactly
// as it does today.
//
// The prop shape matches the pre-Slice-12 `/quote/page.tsx` call site
// so nothing downstream changes.

import { QuoteHost } from "@/components/quote/quote-host";
import type { CustomerView } from "@/types/quote";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import { AdvanceBar } from "./advance-bar";
import type { SubTabId } from "./subtabs";

export function TabPreviewQuote({
  view,
  quoteId,
  quoteStatus,
  showStateSwitcher,
  internalNotes,
  addendumData,
  isHubspotLinked,
  onGo,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  showStateSwitcher: boolean;
  internalNotes: string | null;
  addendumData: QuoteAddendumData | null;
  isHubspotLinked: boolean;
  onGo: (id: SubTabId) => void;
}) {
  return (
    <div>
      <QuoteHost
        view={view}
        quoteId={quoteId}
        quoteStatus={quoteStatus}
        showStateSwitcher={showStateSwitcher}
        internalNotes={internalNotes}
        addendumData={addendumData}
        isHubspotLinked={isHubspotLinked}
      />
      <AdvanceBar
        weight="light"
        mid={<span>previewing draft</span>}
        caption="Reversible — you can come back and revise"
        label="Continue to Send →"
        onAdvance={() => onGo("send")}
      />
    </div>
  );
}
