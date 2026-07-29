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
import { computeUmbrellaAdvance } from "./advance-target";
import { VersionPicker } from "./version-picker";
import type { SubTabId } from "./subtabs";

export function TabPreviewQuote({
  view,
  quoteId,
  quoteStatus,
  quoteNumberDb,
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
  /** Slice 12 Step 7c review-fix — PM-facing DB quote_number, per
   * quote-umbrella.tsx prop docs. Post-Revise the DB has the number
   * but view.quote.quoteNumber is masked to null (Pattern 45 boundary
   * for customer PDF). Picker header shows "DPS-N · X versions" when
   * populated; falls back to "quote number assigned at send" only when
   * genuinely NULL (fresh pre-send draft). */
  quoteNumberDb: string | null;
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
        quoteNumber={quoteNumberDb}
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
      {/* Slice 12 Step 9 CB P6 pattern-fix — advance target derived
          from quoteStatus via computeUmbrellaAdvance, not hardcoded.
          Prior version pinned "Continue to Send →" regardless of
          lifecycle position (Preview on an already-accepted quote
          pointed backward). Helper handles complete-state null +
          all four lifecycle positions uniformly across all 5 tabs. */}
      {(() => {
        const adv = computeUmbrellaAdvance("preview", quoteStatus);
        return (
          <AdvanceBar
            weight="light"
            mid={<span>previewing {quoteStatus}</span>}
            caption={adv?.caption ?? "Umbrella read-only — no advance"}
            label={adv?.label}
            onAdvance={adv ? () => onGo(adv.targetTab) : undefined}
            disabled={!adv}
          />
        );
      })()}
    </div>
  );
}
