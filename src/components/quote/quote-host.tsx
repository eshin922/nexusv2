"use client";

import { useState } from "react";
import type { CustomerView, CustomerViewPdfLayout } from "@/types/quote";
import { PreviewToolbar, type CustomerViewSubState } from "./preview-toolbar";
import { AddendumToggle } from "./addendum-toggle";
import { PdfAddendumAssemblies } from "@/components/pdf/pdf-addendum";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import { BoundaryGuardNotice } from "./boundary-guard-notice";
import { PageBreakMarker } from "./page-break-marker";
import { PdfPage } from "@/components/pdf/pdf-page";
import { PdfHeader } from "@/components/pdf/pdf-header";
import { PdfPricingTable } from "@/components/pdf/pdf-pricing-table";
import { PdfChargesBlock } from "@/components/pdf/pdf-charges-block";
import { PdfTerms } from "@/components/pdf/pdf-terms";
import { PdfNotes } from "@/components/pdf/pdf-notes";
import { PdfFooter } from "@/components/pdf/pdf-footer";

// Slice 11 wires the action-layer queries that populate
// `view.serviceFees` + `view.freightLines` from real cost-input rows
// (production_inputs.is_one_time → tooling/setup service fees;
// Slice R6.2 freight_legs.treatment = pass_through → freight lines).
// Today page.tsx sets both arrays to `[]` — empty until Slice 11.
//
// Rest-of-app sweep Step 9 hotfix (May 2026) — Edward smoke caught
// hardcoded PASS_THROUGH_CHARGES fixtures (Project setup $5,250 /
// GLW-50 mold $12,400 / CAP-60 R&D $3,200 / Outbound LTL $0.28-0.42)
// shipping as real data when PMs toggled the dev sub-state switcher
// to "Pass-through." Pattern 45-candidate ("customer-facing render
// data-source verification") finding: every PDF block must trace to
// real bundle data; placeholder fixtures shipping to production was
// a v1 blocker. Removed the fixtures + `chargesForSubState` /
// `skusForSubState` mutators; the dev switcher now drives intro
// copy + two-page layout intent ONLY, with data flowing verbatim
// from `view`. `isTwoPage` is gated on actual charges existing —
// dev toggle to "Pass-through" on a zero-charges quote no-ops
// rather than rendering a blank second page.

// Default-sub-state derivation: pick the conceptual register that
// matches the real bundle data. Dev switcher can override; PMs in
// production never see the switcher (gated by `showStateSwitcher`).
function deriveDefaultSubState(view: CustomerView): CustomerViewSubState {
  if (view.skus.some((s) => s.shape === "partial")) return "partial";
  if (view.serviceFees.length > 0 || view.freightLines.length > 0) {
    return "passThrough";
  }
  return "pure";
}

// State-conditional intro paragraph copy. Tracks R3 source
// CustomerViewPure / PassThrough / Partial.
//
// Step 9 hotfix — copy that referenced specific fixture SKUs ("Glow
// Capsule (CAP-60)") + fixture tier labels ("Tier 2 (25,000 units)")
// was shipping verbatim into real quotes. Generic phrasing now;
// `single_tier` layout derives the tier label from `view.tiers` +
// `recommendedTierIdx` so it always matches the rendered tier.
// Slice 11 owns the deeper per-quote copy customization (incoterms,
// commercial context, etc.).
function introCopy(
  s: CustomerViewSubState,
  layout: CustomerViewPdfLayout,
  recommendedTier: { label: string; quantity: number } | null,
): { eyebrow: string; h2: string; paragraph: string } {
  if (s === "passThrough") {
    return {
      eyebrow: "Tiered pricing",
      h2: "Per-unit pricing across volume tiers",
      paragraph:
        "Pricing landed EXW Long Beach. Outbound freight billed separately at cost; one-time charges itemized below. See terms for details.",
    };
  }
  if (s === "partial") {
    return {
      eyebrow: "Tiered pricing",
      h2: "Per-unit pricing across volume tiers",
      paragraph:
        "Pricing landed FOB Long Beach. Some SKUs have tier pricing pending finalization — quote available on request once outstanding sourcing or formulation milestones are locked.",
    };
  }
  // pure
  if (layout === "single_tier") {
    const tierLabel = recommendedTier
      ? `${recommendedTier.label} (${recommendedTier.quantity.toLocaleString("en-US")} units)`
      : "the confirmed tier";
    return {
      eyebrow: "Confirmed pricing",
      h2: `Per-unit pricing — ${tierLabel}`,
      paragraph:
        "Pricing landed FOB Long Beach. Container freight, duty, and applicable tariffs included in the unit price shown. Volume tier-pricing available on request.",
    };
  }
  const recName = recommendedTier?.label ?? "the recommended tier";
  return {
    eyebrow: "Tiered pricing",
    h2: "Per-unit pricing across volume tiers",
    paragraph: `Pricing landed FOB Long Beach. Container freight, duty, and applicable tariffs included in the unit price shown. ${recName} is recommended for first-PO production runs.`,
  };
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
  /** RI.9 §6 step 7 — pass-through so the inline customer-notes
   * editor doesn't clobber internal notes on save. */
  internalNotes: string | null;
  /** Phase A.1 v2 impl-6 — addendum data crosses the customer-view
   * boundary via this typed prop. Optional (null when the quote has
   * zero ASYs OR uses legacy quote_skus schema with no addendum
   * support); QuoteHost suppresses the addendum render in that case. */
  addendumData: QuoteAddendumData | null;
}) {
  const [subState, setSubState] = useState<CustomerViewSubState>(() =>
    deriveDefaultSubState(view),
  );
  const [pdfLayout, setPdfLayout] = useState<CustomerViewPdfLayout>(view.pdfLayout);
  // Phase A.1 v2 impl-6 — Addendum toggle state. Defaults ON when
  // addendumData has meaningful content (parallels CD canonical
  // default-on UX); transient per Pattern 32 (no persistence yet).
  const [addendumOn, setAddendumOn] = useState<boolean>(() =>
    Boolean(addendumData?.hasMeaningfulContent),
  );

  // Data flows from `view` directly — no fixture substitution.
  const serviceFees = view.serviceFees;
  const freightLines = view.freightLines;
  const skus = view.skus;
  const hasAdditionalCharges =
    serviceFees.length > 0 || freightLines.length > 0;

  const includeIncoterms = subState === "passThrough";
  // isTwoPage gated on real data — dev toggle to "passThrough" on a
  // zero-charges quote stays single-page rather than rendering an
  // empty second page.
  const isTwoPage = subState === "passThrough" && hasAdditionalCharges;
  const recommendedTier =
    view.recommendedTierIdx !== null &&
    view.recommendedTierIdx < view.tiers.length
      ? view.tiers[view.recommendedTierIdx]
      : null;
  const copy = introCopy(subState, pdfLayout, recommendedTier);

  return (
    // Sweep Step 4.1/N — adopt `r3-shared` parent-scope class so the
    // canonical R3 rules (now under .r3-shared { ... } in
    // src/styles/r3-shared.css) resolve for this Quote tree.
    //
    // Step 10 Edward smoke fix (2026-05-14) — `r3-shared` lives on a
    // dedicated PARENT div, separate from `preview-chrome`. CSS
    // Nesting Level 1 compiles `.r3-shared { .preview-chrome { ... } }`
    // to `.r3-shared .preview-chrome` (descendant combinator), which
    // doesn't match same-element compound `<div className="r3-shared
    // preview-chrome">`. Splitting into nested divs makes the rule
    // resolve correctly. Edward repro: diagonal-pattern background
    // on preview-chrome was missing post-Step-4 because the rule
    // wasn't binding.
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

      {/* Phase A.1 v2 impl-6 Step 6 — Addendum toggle.
          Renders only when addendum data has been loaded
          (new-schema quote). State is session-transient per
          Pattern 32; default-on when hasMeaningfulContent.

          impl-6 patch round (Bug #N) — wrapper styled to match
          BoundaryGuardNotice chrome (maxWidth 880, margin auto,
          paper-2 background, padding). Pre-fix the toggle floated
          in the unstyled `display: flex; justifyContent: flex-end`
          gutter and visually appeared on the PDF surface rather
          than as PM preview chrome. Now anchored as a sibling
          chrome element alongside BoundaryGuardNotice. */}
      {addendumData ? (
        <div
          className="addendum-toggle-chrome"
          style={{
            maxWidth: 880,
            margin: "0 auto 18px",
            padding: "10px 14px",
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <AddendumToggle
            on={addendumOn}
            onToggle={() => setAddendumOn((v) => !v)}
            totalLeaves={addendumData.totalLeaves}
            totalAssemblies={addendumData.totalAssemblies}
            hasMeaningfulContent={addendumData.hasMeaningfulContent}
          />
        </div>
      ) : null}

      <PdfPage
        footer={
          <PdfFooter
            vendor={view.vendor}
            quote={view.quote}
            page={1}
            pages={isTwoPage ? 2 : 1}
          />
        }
      >
        <PdfHeader
          vendor={view.vendor}
          quote={view.quote}
          customer={view.customer}
          preparedBy={view.preparedBy}
        />
        <p className="pdf-eyebrow" style={{ marginTop: 28 }}>
          {copy.eyebrow}
        </p>
        <h2 className="pdf-h2" style={{ marginTop: 0 }}>
          {copy.h2}
        </h2>
        <p style={{ margin: "0 0 18px", maxWidth: "60ch" }}>
          {copy.paragraph}
        </p>
        <PdfPricingTable
          tiers={view.tiers}
          skus={skus}
          recommendedTierIdx={view.recommendedTierIdx}
          pdfLayout={pdfLayout}
        />
        {isTwoPage ? (
          <PdfChargesBlock
            serviceFees={serviceFees}
            freightLines={freightLines}
            recommendedTierIdx={view.recommendedTierIdx}
            tiers={view.tiers}
          />
        ) : (
          // RI.9 step 10 smoke — Notes ABOVE Terms. Customer-facing
          // notes are quote-specific (PM-authored on this surface);
          // T&Cs are boilerplate from firm_settings. Notes-first
          // reads better for the customer.
          <>
            <PdfNotes notes={view.quote.customerFacingNotes} />
            <PdfTerms
              quote={view.quote}
              includeIncoterms={includeIncoterms}
            />
          </>
        )}
      </PdfPage>

      {isTwoPage && (
        <>
          <PageBreakMarker current={1} total={2} />
          <PdfPage
            footer={
              <PdfFooter
                vendor={view.vendor}
                quote={view.quote}
                page={2}
                pages={2}
              />
            }
          >
            {/* RI.9 step 10 smoke — Notes ABOVE Terms on page 2.
                Eyebrow updated to "Notes & terms" to match reading
                order; the H2 "Commercial terms" stays anchored to
                PdfTerms (which still leads the structured terms
                block). PdfNotes carries its own "Notes" label
                internally, so no separate H2 needed. */}
            <p className="pdf-eyebrow">Notes &amp; terms</p>
            <PdfNotes notes={view.quote.customerFacingNotes} />
            <h2 className="pdf-h2" style={{ marginTop: 24 }}>
              Commercial terms
            </h2>
            <PdfTerms quote={view.quote} includeIncoterms />
            <div style={{ marginTop: 28 }}>
              <h3 className="pdf-h3">How to accept</h3>
              <p>
                Reply to this email with the tier and quantity you&rsquo;d like
                to proceed on. We&rsquo;ll issue a PO confirmation and
                production schedule within 2 business days.
              </p>
            </div>
          </PdfPage>
        </>
      )}

      {/* Phase A.1 v2 impl-6 Step 7 — Addendum pages render
          BELOW the pricing PdfPage(s) when toggle is on AND
          there's meaningful content. PdfAddendumAssemblies
          internally suppresses on !hasMeaningfulContent or
          zero assemblies. */}
      {addendumOn && addendumData ? (
        <PdfAddendumAssemblies
          data={addendumData}
          clientName={view.customer.name ?? null}
        />
      ) : null}
    </div>
    </div>
  );
}
