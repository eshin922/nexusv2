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
import type { BelowFloorProjection } from "@/lib/below-floor-projection";
import type {
  PresentationState,
  PresentationTier,
} from "@/components/quote/card-customer-presentation";
import type { FrozenRecoveryInstruction } from "@/lib/commercial-recovery/frozen-instruction";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { QuotePerTierRollup } from "@/lib/costing";
import type { GovernedSummary } from "@/components/quote/customer-view-rail";
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
  recoveryInstructions,
  recoveryRows,
  presentation,
  presentationTiers,
  belowFloor,
  quoteRollup,
  governed,
  presentationRestored,
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
  /**
   * Recovery workspace rows, built from the SAME bundle read the preview
   * renders from. Passed down rather than loaded here so the surface and the
   * document cannot disagree about a charge.
   */
  /** Set when an economics-changing election would supersede a live
   * authorization. A prediction of the existing mechanism, never a second one. */
  /** Slice 12 Step 7c review-fix — PM-facing DB quote_number, per
   * quote-umbrella.tsx prop docs. Post-Revise the DB has the number
   * but view.quote.quoteNumber is masked to null (Pattern 45 boundary
   * for customer PDF). Picker header shows "DPS-N · X versions" when
   * populated; falls back to "quote number assigned at send" only when
   * genuinely NULL (fresh pre-send draft). */
  quoteNumberDb: string | null;
  recoveryInstructions: readonly FrozenRecoveryInstruction[];
  recoveryRows: RecoveryChargeRow[];
  presentation: PresentationState;
  presentationTiers: readonly PresentationTier[];
  belowFloor: BelowFloorProjection;
  quoteRollup: readonly QuotePerTierRollup[];
  governed: GovernedSummary;
  presentationRestored: boolean;
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
  const host = (
    <QuoteHost
      view={view}
      quoteId={quoteId}
      quoteStatus={quoteStatus}
      recoveryInstructions={recoveryInstructions}
      recoveryRows={recoveryRows}
      presentation={presentation}
      presentationTiers={presentationTiers}
          belowFloor={belowFloor}
      quoteRollup={quoteRollup}
      governed={governed}
      presentationRestored={presentationRestored}
      internalNotes={internalNotes}
      addendumData={addendumData}
      isHubspotLinked={isHubspotLinked}
    />
  );
  const picker = (
    <VersionPicker
      projectId={projectId}
      versions={versionChain}
      quoteNumber={quoteNumberDb}
    />
  );

  // ── SUPERSESSION, NOT SUPPRESSION ──────────────────────────────────────
  //
  // Disposition, Edward 2026-08-24: on the restored Customer View the legacy
  // `Continue to Send →` bar is OBSOLETE. Freeze & send is the single
  // canonical final action, and the two are not to be reconciled or relocated.
  //
  // So the restored branch returns before `AdvanceBar` is ever referenced,
  // rather than rendering it conditionally. A conditional would keep the old
  // control one boolean away from returning — and the boolean in question is
  // the admin gate, which is going to be removed. Suppression that depends on
  // a flag you intend to delete is not suppression.
  //
  // The legacy branch below keeps the bar, and keeps it only while that
  // surface exists.
  if (presentationRestored) {
    return (
      <div className="r8-wrap">
        {picker}
        {host}
      </div>
    );
  }

  const adv = computeUmbrellaAdvance("preview", quoteStatus);
  return (
    <div className="r8-wrap">
      {picker}
      {host}
      {/* Slice 12 Step 9 CB P6 pattern-fix — advance target derived from
          quoteStatus via computeUmbrellaAdvance, not hardcoded. Prior version
          pinned "Continue to Send →" regardless of lifecycle position. */}
      <AdvanceBar
        weight="light"
        mid={<span>previewing {quoteStatus}</span>}
        caption={adv?.caption ?? "Umbrella read-only — no advance"}
        label={adv?.label}
        onAdvance={adv ? () => onGo(adv.targetTab) : undefined}
        disabled={!adv}
      />
    </div>
  );
}
