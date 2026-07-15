// Slice 11 Step 6.1 — single shared `<Document>` factory.
//
// The customer-PDF render path stands up ONCE, and both consumers
// (preview via `renderToStream`, persistence via `renderToBuffer`)
// call this factory to produce the identical react-pdf element
// tree. This is the load-bearing structural rule for the whole
// customer-PDF discipline: "preview = shipped artifact" is true
// by construction, not by convention.
//
// Do not build a preview renderer and a persistence renderer
// separately. Both consumers route through here.
//
// Composition:
//   1. Translate CustomerView → CpdfData via customerViewToCpdf
//      (produces the fixture-shape data + hasCharges/hasUnpriced flags).
//   2. Decide addendum inclusion: view.includeSpecAddendum AND
//      addendumData.hasMeaningfulContent (impl-6 gate). When both true,
//      emit CustomerPdfAddendumPages fragment.
//   3. Return <CustomerPdfDocument> parameterized by the composition
//      flags + optional addendumPages slot.
//
// Pattern 45 boundary safe: consumes CustomerView (adapter output)
// + QuoteAddendumData (loader output); imports only from
// customer-pdf-* + customer-view-to-cpdf + addendum-loader (types
// only). Zero costing-surface reads, zero DB access, no HubSpot.

import "server-only";

import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";

import { CustomerPdfAddendumPages } from "@/components/pdf/customer-pdf-addendum";
import { CustomerPdfDocument } from "@/components/pdf/customer-pdf-document";
import { customerViewToCpdf } from "@/lib/customer-view-to-cpdf";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import type { CustomerView } from "@/types/quote";

export function buildQuoteDocument(args: {
  view: CustomerView;
  addendumData: QuoteAddendumData | null;
  /** ISO date string for `CpdfQuote.issued_date` fallback when
   * `view.quote.sentDate` is null (draft preview). Adapter uses
   * the caller-supplied today to avoid `new Date()` in the render
   * hot path (deterministic for testing + easier to stamp
   * consistently across preview + persist for the same send). */
  todayIso: string;
}): ReactElement<DocumentProps> {
  const { view, addendumData, todayIso } = args;

  const { data, skuSet, hasCharges, hasUnpriced } = customerViewToCpdf(view, {
    todayIso,
  });

  // Addendum gate: include only when the PM toggle is on AND the
  // loader confirms meaningful content (impl-6 hasMeaningfulContent
  // guard — all-empty addendum doesn't render). Consumer of the
  // buildQuoteDocument factory doesn't decide; the CustomerView
  // + addendum-loader output does.
  const includeAddendum =
    view.includeSpecAddendum &&
    addendumData !== null &&
    addendumData.hasMeaningfulContent;

  const addendumPages = includeAddendum ? (
    <CustomerPdfAddendumPages
      addendum={addendumData}
      vendor={data.vendor}
      quote={data.quote}
      customer={data.customer}
    />
  ) : undefined;

  return (
    <CustomerPdfDocument
      data={data}
      skuSet={skuSet}
      layout={view.pdfLayout}
      detail={view.detailLevel}
      hasCharges={hasCharges}
      hasUnpriced={hasUnpriced}
      addendumPages={addendumPages}
    />
  );
}
