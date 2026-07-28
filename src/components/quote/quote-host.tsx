"use client";

import { useState } from "react";
import type {
  CustomerView,
  CustomerViewDetailLevel,
  CustomerViewPdfLayout,
} from "@/types/quote";
import { PreviewToolbar, type CustomerViewSubState } from "./preview-toolbar";
import { AddendumToggle } from "./addendum-toggle";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import { BoundaryGuardNotice } from "./boundary-guard-notice";
import { useQuoteAxis } from "@/components/quote-umbrella/quote-axis-context";

// Slice 11 Step 6.4 — QuoteHost is now an iframe-driven preview
// wrapped in the PM-internal toolbar chrome. Retires the legacy
// DOM-based `pdf-*` component tree (7 files deleted alongside this
// commit); the iframe points at /api/quotes/[quoteId]/customer-pdf
// which renders the ACTUAL react-pdf output the customer receives.
//
// Preview = shipped artifact by construction — same
// `buildQuoteDocument` factory feeds both the preview stream and
// the sendQuote persistence buffer (Step 6.6).
//
// Toolbar controls (pdfLayout, detailLevel, includeSpecAddendum)
// update the iframe src via URL params — no client-side render
// state to keep in sync with server-side data. Server resolver
// (customer-view-resolver.ts) reads searchParams in the draft
// branch; sent+ quotes ignore search params and read the
// immutable snapshot columns (Step 4.4 read path).
//
// dev sub-state switcher (PreviewToolbar) is preserved for
// backward compat but is now cosmetic — the iframe reflects real
// data, not state variants. Retire in a follow-up when we replace
// PreviewToolbar with a dedicated Step-6 toolbar.

function buildIframeSrc(
  quoteId: string,
  layout: CustomerViewPdfLayout,
  detail: CustomerViewDetailLevel,
  addendumOn: boolean,
  // Slice 11 Step 6 FU — cache-buster derived from quote state.
  // Without this, the iframe URL is unchanged when a quote
  // transitions draft → sent (toolbar controls hold constant),
  // so the browser serves the stale draft render instead of
  // re-fetching the fresh sent-state PDF. Bumping this on state
  // change forces the iframe to re-mount + re-fetch.
  version: string,
): string {
  const params = new URLSearchParams({
    layout,
    detail,
    addendum: addendumOn ? "1" : "0",
    v: version,
  });
  return `/api/quotes/${quoteId}/customer-pdf?${params.toString()}`;
}

export function QuoteHost({
  view,
  quoteId,
  quoteStatus,
  showStateSwitcher,
  internalNotes,
  addendumData,
  isHubspotLinked,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  showStateSwitcher: boolean;
  internalNotes: string | null;
  addendumData: QuoteAddendumData | null;
  /** Slice 11 Step 8 Gate-0 hotfix — when false, the deal has no
   * HubSpot record (Nexus-only) and sends are blocked. Renders an
   * inline warning banner + disables the Send button. Server-side
   * `sendQuote` also blocks (defense-in-depth). */
  isHubspotLinked: boolean;
}) {
  // Slice 12 Step 5d — axis state moved from local React state to
  // <QuoteAxisProvider> at the umbrella level, so the Send sub-tab
  // (Step 5c/5d) can read PM's current toggle choices at send time.
  // Initial values came from server-resolved view via the provider's
  // initial props; toggles here update context in place.
  const {
    pdfLayout,
    detailLevel,
    includeSpecAddendum: addendumOn,
    setPdfLayout,
    setDetailLevel,
    setIncludeSpecAddendum: setAddendumOn,
  } = useQuoteAxis();

  // Cosmetic no-op — subState was used by the legacy DOM tree to
  // preview "what state X would look like." New iframe renders real
  // data; state variants fall out of the actual bundle content.
  const [subState, setSubState] = useState<CustomerViewSubState>("pure");

  // Cache-buster: quote state (sentDate + status) — changes when
  // the quote transitions draft → sent, forcing the iframe to
  // re-fetch fresh data instead of serving the cached draft.
  const iframeVersion = view.quote.sentDate ?? `draft-${quoteStatus}`;
  const iframeSrc = buildIframeSrc(
    quoteId,
    pdfLayout,
    detailLevel,
    addendumOn,
    iframeVersion,
  );

  // Slice 11 Step 6 FU — snapshot-lock indicator. Sent quotes
  // render the immutable snapshot (per Step 4.4 read-path); the
  // toolbar toggles would change the iframe URL but the resolver's
  // isSent branch ignores search params. Disable the controls so
  // PMs don't wonder why they no-op.
  const isSent = quoteStatus !== "draft";
  const sentLockTooltip = isSent
    ? "Sent quotes render the frozen snapshot; toggles only work on drafts."
    : undefined;

  const showLinkageWarning = !isHubspotLinked && !isSent;

  return (
    <div className="r3-shared">
      <div className="preview-chrome">
        {showLinkageWarning && (
          <div
            role="alert"
            data-testid="quote-linkage-warning"
            style={{
              maxWidth: 880,
              margin: "0 auto 12px",
              padding: "10px 14px",
              background: "var(--warn-soft, #fff4e5)",
              border: "1px solid var(--warn, #d97706)",
              color: "var(--warn, #92400e)",
              borderRadius: 6,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            <strong>This deal isn&apos;t linked to HubSpot.</strong>{" "}
            Push it to HubSpot before sending. Send is disabled until
            the deal has a real HubSpot record; downstream capabilities
            (deal-stage push, NetSuite SO write) also require the
            linkage.
          </div>
        )}
        <PreviewToolbar
          quoteId={quoteId}
          quoteStatus={quoteStatus}
          quoteNumber={view.quote.quoteNumber}
          sentDate={view.quote.sentDate}
          pdfLayout={pdfLayout}
          onPdfLayoutChange={setPdfLayout}
          subState={subState}
          onSubStateChange={setSubState}
          showStateSwitcher={showStateSwitcher}
          customerFacingNotes={view.quote.customerFacingNotes}
          internalNotes={internalNotes}
        />

        <BoundaryGuardNotice />

        {/* Detail-level + addendum toolbar chrome. Sits alongside
            the AddendumToggle so PMs have all three iframe knobs in
            one row. */}
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto 18px",
            padding: "10px 14px",
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            display: "flex",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              opacity: isSent ? 0.5 : 1,
            }}
            title={sentLockTooltip}
          >
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              Detail:
            </span>
            <select
              value={detailLevel}
              onChange={(e) =>
                setDetailLevel(e.target.value as CustomerViewDetailLevel)
              }
              disabled={isSent}
              style={{ fontSize: 12 }}
            >
              <option value="itemized">Itemized</option>
              <option value="turnkey_only">Turnkey only</option>
            </select>
          </label>

          {addendumData ? (
            <span
              style={{ opacity: isSent ? 0.5 : 1 }}
              title={sentLockTooltip}
            >
              <AddendumToggle
                on={addendumOn}
                onToggle={() => {
                  if (isSent) return;
                  setAddendumOn(!addendumOn);
                }}
                totalLeaves={addendumData.totalLeaves}
                totalAssemblies={addendumData.totalAssemblies}
                hasMeaningfulContent={addendumData.hasMeaningfulContent}
              />
            </span>
          ) : (
            <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
              No addendum data.
            </span>
          )}
        </div>

        {/* Preview iframe — the actual react-pdf output the customer
            receives. Height accommodates a Letter page (8.5in × 11in
            at 96dpi ≈ 1056px) plus overflow for multi-page. */}
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            border: "1px solid var(--rule)",
            background: "var(--paper)",
          }}
        >
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            title="Customer PDF preview"
            style={{
              width: "100%",
              height: "1100px",
              border: "none",
              display: "block",
            }}
          />
        </div>
      </div>
    </div>
  );
}
