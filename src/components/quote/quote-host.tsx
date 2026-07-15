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
): string {
  const params = new URLSearchParams({
    layout,
    detail,
    addendum: addendumOn ? "1" : "0",
  });
  return `/api/quotes/${quoteId}/customer-pdf?${params.toString()}`;
}

export function QuoteHost({
  view,
  quoteId,
  quoteStatus,
  showStateSwitcher,
  devSendEnabled,
  internalNotes,
  addendumData,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  showStateSwitcher: boolean;
  devSendEnabled: boolean;
  internalNotes: string | null;
  addendumData: QuoteAddendumData | null;
}) {
  // State mirrors the resolver's initial read (search-param
  // overrides propagate into `view` before this component mounts).
  // Toolbar changes update local state → iframe re-loads.
  const [pdfLayout, setPdfLayout] = useState<CustomerViewPdfLayout>(
    view.pdfLayout,
  );
  const [detailLevel, setDetailLevel] = useState<CustomerViewDetailLevel>(
    view.detailLevel,
  );
  const [addendumOn, setAddendumOn] = useState<boolean>(view.includeSpecAddendum);

  // Cosmetic no-op — subState was used by the legacy DOM tree to
  // preview "what state X would look like." New iframe renders real
  // data; state variants fall out of the actual bundle content.
  const [subState, setSubState] = useState<CustomerViewSubState>("pure");

  const iframeSrc = buildIframeSrc(quoteId, pdfLayout, detailLevel, addendumOn);

  return (
    <div className="r3-shared">
      <div className="preview-chrome">
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
          devSendEnabled={devSendEnabled}
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
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              Detail:
            </span>
            <select
              value={detailLevel}
              onChange={(e) =>
                setDetailLevel(e.target.value as CustomerViewDetailLevel)
              }
              style={{ fontSize: 12 }}
            >
              <option value="itemized">Itemized</option>
              <option value="turnkey_only">Turnkey only</option>
            </select>
          </label>

          {addendumData ? (
            <AddendumToggle
              on={addendumOn}
              onToggle={() => setAddendumOn((v) => !v)}
              totalLeaves={addendumData.totalLeaves}
              totalAssemblies={addendumData.totalAssemblies}
              hasMeaningfulContent={addendumData.hasMeaningfulContent}
            />
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
