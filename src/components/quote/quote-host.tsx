"use client";

import { useState } from "react";
import type { CustomerView, CustomerViewPdfLayout } from "@/types/quote";
import { PreviewToolbar, type CustomerViewSubState } from "./preview-toolbar";
import { BoundaryGuardNotice } from "./boundary-guard-notice";
import { PageBreakMarker } from "./page-break-marker";
import { PdfPage } from "@/components/pdf/pdf-page";
import { PdfHeader } from "@/components/pdf/pdf-header";
import { PdfPricingTable } from "@/components/pdf/pdf-pricing-table";
import { PdfChargesBlock } from "@/components/pdf/pdf-charges-block";
import { PdfTerms } from "@/components/pdf/pdf-terms";
import { PdfNotes } from "@/components/pdf/pdf-notes";
import { PdfFooter } from "@/components/pdf/pdf-footer";

// Demonstration fixtures for the three R3 states. Real per-quote
// data plumbing arrives in Slice 11. The state switcher is dev-only
// (gated by `showStateSwitcher` prop).

type FixtureChargesBundle = {
  serviceFees: CustomerView["serviceFees"];
  freightLines: CustomerView["freightLines"];
};

const EMPTY_CHARGES: FixtureChargesBundle = {
  serviceFees: [],
  freightLines: [],
};

const PASS_THROUGH_CHARGES: FixtureChargesBundle = {
  serviceFees: [
    {
      id: "sf1",
      scope: "project",
      label: "Project setup & tooling",
      sub: "Per-project, one-time. Includes filling-line setup, dye-cuts, plates.",
      amount: 5250,
      qtyLabel: "1 (per project)",
    },
    {
      id: "sf2",
      scope: "sku",
      skuLabel: "GLW-50",
      label: "GLW-50 — custom mold tooling",
      sub: "One-time. Mold ownership transfers to client at PO+50k cumulative units.",
      amount: 12400,
      qtyLabel: "1 (GLW-50 only)",
    },
    {
      id: "sf3",
      scope: "sku",
      skuLabel: "CAP-60",
      label: "CAP-60 — formulation R&D",
      sub: "One-time. Final formula approval required before T2 production.",
      amount: 3200,
      qtyLabel: "1 (CAP-60 only)",
    },
  ],
  freightLines: [
    {
      id: "fr1",
      label: "Outbound LTL — origin to destination DC",
      sub: "Per shipment. Estimate based on current rates; actual billed at cost+15%.",
      qtyLabel: "Per Tier shipment",
      tierAmounts: [0.42, 0.34, 0.28, 0.24],
    },
    {
      id: "fr2",
      label: "Inbound ocean — origin port to LAX",
      sub: "Container freight, allocated per unit. Customer-billed separately as container LCL/FCL booked.",
      qtyLabel: "Per Tier shipment",
      tierAmounts: [0.55, 0.48, 0.42, 0.38],
    },
  ],
};

function chargesForSubState(s: CustomerViewSubState): FixtureChargesBundle {
  return s === "passThrough" ? PASS_THROUGH_CHARGES : EMPTY_CHARGES;
}

function skusForSubState(view: CustomerView, s: CustomerViewSubState) {
  if (s === "partial") {
    // Partial state: take real SKUs, NULL out tier 1 on the last SKU
    // to demonstrate the mixed-completeness render.
    return view.skus.map((sku, idx) =>
      idx === view.skus.length - 1
        ? {
            ...sku,
            tierPrices: sku.tierPrices.map((p, i) => (i === 0 ? null : p)),
            shape: "partial" as const,
          }
        : sku,
    );
  }
  // Pure / passThrough: filter out partial-shape SKUs (R3 source
  // customer-view.jsx:207, 229 — `cleanSkus = skus.filter(s => s.shape !== "partial")`).
  return view.skus.filter((sku) => sku.shape !== "partial");
}

// State-conditional intro paragraph copy. Tracks R3 source
// CustomerViewPure / PassThrough / Partial.
function introCopy(
  s: CustomerViewSubState,
  layout: CustomerViewPdfLayout,
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
        "Pricing landed FOB Long Beach. Glow Capsule (CAP-60) Tier 1 pricing pending finalization of the formulation R&D milestone — quote available on request once raw-ingredient sourcing is locked.",
    };
  }
  // pure
  if (layout === "single_tier") {
    return {
      eyebrow: "Confirmed pricing",
      h2: "Per-unit pricing — Tier 2 (25,000 units)",
      paragraph:
        "Pricing landed FOB Long Beach. Container freight, duty, and applicable tariffs included in the unit price shown. Volume tier-pricing available on request.",
    };
  }
  return {
    eyebrow: "Tiered pricing",
    h2: "Per-unit pricing across volume tiers",
    paragraph:
      "Pricing landed FOB Long Beach. Container freight, duty, and applicable tariffs included in the unit price shown. Tier 2 is recommended for first-PO production runs.",
  };
}

export function QuoteHost({
  view,
  quoteId,
  quoteStatus,
  showStateSwitcher,
  devSendEnabled,
  internalNotes,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  showStateSwitcher: boolean;
  devSendEnabled: boolean;
  /** RI.9 §6 step 7 — pass-through so the inline customer-notes
   * editor doesn't clobber internal notes on save. */
  internalNotes: string | null;
}) {
  const [subState, setSubState] = useState<CustomerViewSubState>("pure");
  const [pdfLayout, setPdfLayout] = useState<CustomerViewPdfLayout>(view.pdfLayout);

  const charges = chargesForSubState(subState);
  const skus = skusForSubState(view, subState);
  const includeIncoterms = subState === "passThrough";
  const isTwoPage = subState === "passThrough";
  const copy = introCopy(subState, pdfLayout);

  return (
    // Sweep Step 4.1/N — adopt `r3-shared` parent-scope class so the
    // canonical R3 rules (now under .r3-shared { ... } in
    // src/styles/r3-shared.css) resolve for this Quote tree.
    // Same shape Mark Accepted will adopt in Step 5.
    <div className="r3-shared preview-chrome">
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
            serviceFees={charges.serviceFees}
            freightLines={charges.freightLines}
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
    </div>
  );
}
