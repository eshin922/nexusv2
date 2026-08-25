"use client";

import { useEffect, useState, useLayoutEffect, useRef } from "react";
import type {
  CustomerView,
  CustomerViewDetailLevel,
  CustomerViewPdfLayout,
} from "@/types/quote";
import { PreviewToolbar } from "./preview-toolbar";
import { CustomerViewRail } from "./customer-view-rail";
import type { GovernedSummary } from "./customer-view-rail";
import type { FrozenRecoveryInstruction } from "@/lib/commercial-recovery/frozen-instruction";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { QuotePerTierRollup } from "@/lib/costing";
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
  // The `#navpanes=0` fragment configures the BROWSER's built-in PDF
  // viewer, not the document: it hides the left thumbnail pane by default
  // so the quote gets the full preview width. A URL fragment is never sent
  // to the server, so the customer-pdf route and the generated PDF are
  // untouched. The native toolbar (zoom / download / print) is deliberately
  // left intact, and the pane remains reopenable from the viewer itself.
  // Honoured by Chromium/Edge; ignored harmlessly elsewhere.
  return `/api/quotes/${quoteId}/customer-pdf?${params.toString()}#navpanes=0`;
}

/**
 * A short stable digest, for cache keys only.
 *
 * Not security, not identity — it exists so the iframe src changes when the
 * commercial recovery state changes without carrying the whole projection in a
 * query string. Collisions would show a stale document, which is the defect
 * this is fixing, so it is 32-bit rather than something shorter.
 */
/**
 * How long the preview waits for the operator to stop changing things.
 *
 * Long enough that tabbing through several treatments regenerates once; short
 * enough that a single deliberate change does not feel abandoned.
 */
const PREVIEW_COALESCE_MS = 600;

function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function QuoteHost({
  view,
  quoteId,
  quoteStatus,
  recoveryInstructions,
  recoveryRows,
  quoteRollup,
  governed,
  presentationRestored,
  internalNotes,
  addendumData,
  isHubspotLinked,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  /** Projected from the same construction the send transaction freezes. */
  recoveryInstructions: readonly FrozenRecoveryInstruction[];
  /** Card 1 · one row per governed recoverable charge. */
  recoveryRows: RecoveryChargeRow[];
  /** Every governed tier — the gate evaluates all, not only those shown. */
  quoteRollup: readonly QuotePerTierRollup[];
  /** Card 0 · the read-only mirror. */
  governed: GovernedSummary;
  /**
   * Render the authority's document-plus-panel layout.
   *
   * TEMPORARY, and admin-derived at the page. The restored layout changes
   * the operator-facing shape of this surface, and structural tests are
   * necessary but not sufficient for that — so it reaches production where
   * it can be reviewed with a real session, without reaching operators
   * before it has been. Removing this flag deletes every `!presentationRestored`
   * branch below; it is not a role boundary and must not become one (the
   * authority's Q6 says the panel is any-PM).
   */
  presentationRestored: boolean;
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

  // ── THE PREVIEW'S VERSION KEY ───────────────────────────────────────────
  //
  // This was `view.quote.sentDate ?? \`draft-${quoteStatus}\``, a constant on
  // drafts, so the iframe never reloaded and the document beside the control
  // showed the state from page load. The first repair keyed it on the recovery
  // instruction, which fixed Card 1 and left a narrower version of the same
  // hole: a packaging or freight edit that moves unit prices without touching
  // OTC recovery leaves that digest unchanged, and the document goes stale
  // again.
  //
  // So the key is the WHOLE projected view — the object the renderer is built
  // from. Anything that can change the document changes the key, by
  // construction rather than by remembering to add a field.
  //
  // It fingerprints; it does not decide. No commercial value is derived here
  // and nothing is reconstructed: `view` is already resolved, and this only
  // notices that it differs from the last one.
  const viewDigest = hashString(JSON.stringify(view));
  const iframeVersion = `${view.quote.sentDate ?? `draft-${quoteStatus}`}~${viewDigest}`;
  const targetSrc = buildIframeSrc(
    quoteId,
    pdfLayout,
    detailLevel,
    addendumOn,
    iframeVersion,
  );

  // ── THE PREVIEW FOLLOWS; IT DOES NOT LEAD ───────────────────────────────
  //
  // Rendering the customer PDF costs 1904-2627ms, measured three times on
  // production. Keying the iframe directly off `targetSrc` put that render in
  // front of the operator's answer: elect a treatment, wait for a PDF nobody
  // asked for yet, then see the selection move.
  //
  // The authoritative commercial state — Card 1's selection and the margin
  // cards — comes from the RSC re-render and is already on screen. The preview
  // catches up afterwards, from that same resolved state. It is one authority
  // arriving at two speeds, not two authorities.
  //
  // COALESCED. Each change re-arms the timer, so a burst of elections costs ONE
  // regeneration rather than one per click. Writes are untouched: they stay
  // immediate and individually governed, and only the artifact is coalesced.
  // Same discipline as the realtime reconcile pipe, pointed outward.
  // ── THE BYTES ARRIVE BEFORE THE FRAME DOES ──────────────────────────────
  //
  // Two attempts at hiding this failed, and both failed for the same reason.
  //
  // The first swapped the src on the visible frame via its `key`, which
  // unmounts and remounts: the pane blanked for a whole render. The second
  // loaded a replacement in a hidden frame and promoted it on `onLoad` — but
  // `onLoad` fires when the DOCUMENT has loaded, not when the PDF plugin has
  // PAINTED it. So promotion happened early and the operator saw the viewer's
  // empty canvas, which Chrome paints dark. Reported as "it flashes black",
  // and that is precisely what it was.
  //
  // There is no event for "the PDF is on screen", so no amount of frame
  // juggling can time the swap correctly. The fix is to remove the thing being
  // waited on: fetch the document to completion FIRST, then hand the frame a
  // blob it can render from memory. Nothing is on screen while a network round
  // trip and a 2s server render happen, because they have already happened.
  //
  // One frame, no `key`, so nothing is ever unmounted. Repainting from a local
  // blob is a frame or two rather than seconds.
  //
  // A failed fetch changes nothing: the current document stays. A preview that
  // silently keeps showing the last good state is better than one that blanks,
  // and `previewStale` keeps saying so until it succeeds.
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (loadedFor === targetSrc) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(targetSrc);
          if (!res.ok || cancelled) return;
          const blob = await res.blob();
          if (cancelled) return;
          const next = URL.createObjectURL(blob);
          setBlobSrc((prev) => {
            // Release the previous document; nothing references it after the
            // swap, and a preview left open all afternoon would otherwise hold
            // every version it had ever shown.
            if (prev) URL.revokeObjectURL(prev);
            return next;
          });
          setLoadedFor(targetSrc);
        } catch {
          // Leave the current document in place.
        }
      })();
    }, PREVIEW_COALESCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targetSrc, loadedFor]);

  // Before the first blob resolves, the route URL is the document — the
  // ordinary first paint, unchanged.
  const shownSrc = blobSrc ?? targetSrc;
  const previewStale = loadedFor !== targetSrc && blobSrc !== null;

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

  /**
   * The height the shell actually leaves this workspace.
   *
   * ── WHY THIS IS MEASURED AND NOT A CONSTANT ─────────────────────────
   *
   * The authority's composition is viewport-bound: each pane scrolls on its
   * own and the finalize footer is pinned bottom-right. That needs a real
   * available height.
   *
   * The first attempt guessed `calc(100vh - 50px)`. The chrome above this
   * surface is actually 261px — an outer bar, the umbrella sub-tab strip and a
   * version band — so the body overhung the viewport by 211px and the page
   * grew a second scrollbar. The operator had to scroll the whole page to
   * reach "the act".
   *
   * 261 is the evidence that the assumption was wrong, not a better constant.
   * The chain from `.r8-shell` down is `block`, so the shell's height never
   * propagates and no pure-CSS `flex: 1` reaches here without changing chrome
   * shared with other surfaces.
   *
   * So it is derived from where this element actually sits, and re-derived on
   * resize. Another chrome change moves the number by itself instead of
   * silently breaking the workspace.
   *
   * No feedback loop: setting the height of an element does not move its own
   * top, so the measurement is stable across the write.
   */
  const workspaceRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      // A floor, so a mis-measure degrades to a small workspace rather than a
      // collapsed one.
      let avail = Math.max(420, Math.round(window.innerHeight - top));
      el.style.setProperty("--cv-avail", `${avail}px`);

      // What sits BELOW as well as above.
      //
      // The chrome beneath this workspace is not one box: the umbrella's
      // advance bar is 64px with a 32px margin above it and another below.
      // Subtracting the residual ONCE took the page overflow from 96px to 32px
      // and stopped there, because collapsing margins settle as the height
      // changes and one pass cannot see the final state.
      //
      // So it converges instead of assuming. Bounded at three passes: if it
      // has not settled by then the cause is something this measurement cannot
      // express, and quietly looping would hide that.
      const doc = document.documentElement;
      for (let pass = 0; pass < 3; pass++) {
        const residual = doc.scrollHeight - doc.clientHeight;
        if (residual <= 0) break;
        avail = Math.max(420, avail - residual);
        el.style.setProperty("--cv-avail", `${avail}px`);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [presentationRestored]);

  // Owned here so the Presentation panel's Voice group and the drawer
  // agree about whether it is open.
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div className="r3-shared">
      {presentationRestored ? (
        /* ── The authority's composition ───────────────────────────────
           "Left: the artifact. Right: the decisions about it.
            Bottom-right: the act."

           The preview keeps the customer PDF iframe (D7) — Chrome's native
           zoom stands in for the reference's stepper, because a DOM preview
           would be a second renderer able to disagree with the artifact the
           customer actually receives. */
        <div className="cv-body" ref={workspaceRef}>
          <div className="cv-preview">
            <div className="cv-preview-bar">
              <span className="cv-frame-chip">What the customer receives</span>
              <span className="cv-preview-summary">
                {detailLevel === "itemized" ? "Itemized" : "Turnkey"}
                {" · "}
                {pdfLayout === "tier_table" ? "all tiers" : "single tier"}
                {addendumOn ? " · with specification addendum" : ""}
              </span>
              <span className="cv-preview-right">
                {addendumOn ? 2 : 1} page PDF
              </span>
            </div>

            {showLinkageWarning && (
              <div role="alert" data-testid="quote-linkage-warning"
                   style={{
                     margin: "12px 20px 0", padding: "10px 14px",
                     background: "var(--warn-soft, #fff4e5)",
                     border: "1px solid var(--warn, #d97706)",
                     color: "var(--warn, #92400e)",
                     borderRadius: 6, fontSize: 13, lineHeight: 1.4,
                   }}>
                <strong>This deal isn&apos;t linked to HubSpot.</strong>{" "}
                Push it to HubSpot before sending.
              </div>
            )}

            {/* Restrained, and deliberately NOT a blocker: the commercial
                controls stay live while this shows. The operator has their
                authoritative answer already; this only says the document is
                catching up. */}
            {previewStale && (
              <div className="cv-preview-updating" role="status" data-testid="cv-preview-updating">
                Updating preview…
              </div>
            )}
            <div className="cv-canvas">
              <div className="cv-sheet">
                {/* No `key`. This frame is mounted once and lives for the life of
                    the surface; only what it points at changes. */}
                <iframe src={shownSrc} title="Customer PDF preview" />
              </div>
            </div>
          </div>

          <CustomerViewRail
            quoteId={quoteId}
            quoteStatus={quoteStatus}
            recoveryRows={recoveryRows}
            recoveryInstructions={recoveryInstructions}
            rollups={quoteRollup}
            governed={governed}
            pdfLayout={pdfLayout}
            onPdfLayoutChange={setPdfLayout}
            detailLevel={detailLevel}
            onDetailLevelChange={setDetailLevel}
            pdfHref={targetSrc}
            pageCount={addendumOn ? 2 : 1}
          />
        </div>
      ) : (
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
          customerFacingNotes={view.quote.customerFacingNotes}
          internalNotes={internalNotes}
          notesOpen={notesOpen}
          onOpenNotes={() => setNotesOpen(true)}
          onCloseNotes={() => setNotesOpen(false)}
          showNotesButton={!presentationRestored}
        />

        <BoundaryGuardNotice />

        {/* LEGACY control row — deleted with the flag. The authority moves
            these into the Presentation panel: "controls become a panel beside
            it". Kept only so operators are not shown an unreviewed layout. */}
        {!presentationRestored && (
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
              style={{ display: "flex", alignItems: "center", gap: 8, opacity: isSent ? 0.5 : 1 }}
              title={sentLockTooltip}
            >
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Detail:</span>
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
              <span style={{ opacity: isSent ? 0.5 : 1 }} title={sentLockTooltip}>
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
        )}

        {/* Preview iframe — the actual react-pdf output the customer
            receives. Height accommodates a Letter page (8.5in × 11in
            at 96dpi ≈ 1056px) plus overflow for multi-page. */}
        <div
          style={{
            border: "1px solid var(--rule)",
            background: "var(--paper)",
            maxWidth: 880,
            margin: "0 auto",
          }}
        >
          {/* Legacy path: direct and uncoalesced, as it has always been.
              The two-pane composition is what makes following worthwhile,
              and this branch does not have it. */}
          <iframe
            src={targetSrc}
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
      )}
    </div>
  );
}
