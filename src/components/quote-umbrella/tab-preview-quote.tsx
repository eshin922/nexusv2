"use client";

// Slice 12 Step 4 — Preview Quote sub-tab body.
//
// Adds the R8 canonical VersionPicker above the existing QuoteHost.
// Step 1 shipped the shell wrapping QuoteHost verbatim; Step 4 lifts
// the version-picker element per R8 §2.2 designer notes. Full R8
// two-column layout (.r8-cols + .r8-side wrapping the iframe) is
// deferred to a follow-up: it requires restructuring QuoteHost's
// internal chrome (linkage warning, PreviewToolbar, addendum toggle,
// detail-level toggle), and Steps 5-8 will hoist some of that chrome
// out to other sub-tabs (Send button → Step 5 Send sub-tab). Doing
// the layout restructure alongside those moves is cheaper than doing
// it twice.
//
// The Preview surface today: VersionPicker card at top → existing
// QuoteHost with all its chrome intact → light Advance bar.

import { QuoteHost } from "@/components/quote/quote-host";
import type { CustomerView } from "@/types/quote";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import type { VersionRow } from "@/lib/quote-version-chain";
import { AdvanceBar } from "./advance-bar";
import { VersionPicker } from "./version-picker";
import type { SubTabId } from "./subtabs";

export function TabPreviewQuote({
  view,
  quoteId,
  quoteStatus,
  showStateSwitcher,
  internalNotes,
  addendumData,
  isHubspotLinked,
  projectId,
  versionChain,
  onGo,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  showStateSwitcher: boolean;
  internalNotes: string | null;
  addendumData: QuoteAddendumData | null;
  isHubspotLinked: boolean;
  /** Slice 12 Step 4 — routes VersionPicker's cross-version Links. */
  projectId: string;
  /** Slice 12 Step 4 — resolved server-side in page.tsx; passed as a
   * prop so this client component doesn't need to be async. */
  versionChain: VersionRow[];
  onGo: (id: SubTabId) => void;
}) {
  return (
    <div className="r8-wrap">
      <VersionPicker
        projectId={projectId}
        versions={versionChain}
        quoteNumber={view.quote.quoteNumber}
      />
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
        mid={<span>previewing {quoteStatus}</span>}
        caption="Reversible — you can come back and revise"
        label="Continue to Send →"
        onAdvance={() => onGo("send")}
      />
    </div>
  );
}
