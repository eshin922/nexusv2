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
import type { CpdfData } from "@/components/pdf/customer-pdf-types";
import { customerViewToCpdf } from "@/lib/customer-view-to-cpdf";
import type { QuoteAddendumData } from "@/lib/addendum-loader";
import type { CustomerView } from "@/types/quote";
import type { QuoteSnapshotRepresentation } from "@/lib/quote-snapshot-representation";

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
  const { data } = customerViewToCpdf(view, { todayIso });
  return buildDocumentFromRepresentation({
    data,
    addendumData,
    includeSpecAddendum: view.includeSpecAddendum,
    layout: view.pdfLayout,
    detail: view.detailLevel,
  });
}

/**
 * Render from `CpdfData` directly, with no `CustomerView` in sight.
 *
 * OD-023 · this is the seam that lets a SENT version render from its frozen
 * representation instead of from live tables. `buildQuoteDocument` above is now
 * a thin projection onto it, so a draft preview and a historical re-render go
 * through exactly the same code — which is what makes "the artifact matches the
 * stored representation" a property of the build rather than a hope.
 *
 * `skuSet`, `hasCharges` and `hasUnpriced` are DERIVED here rather than passed
 * in. They are functions of `data` alone, and storing them would create three
 * more values that could disagree with the payload they describe.
 */
export function buildDocumentFromRepresentation(args: {
  data: CpdfData;
  addendumData: QuoteAddendumData | null;
  includeSpecAddendum: boolean;
  layout: CustomerView["pdfLayout"];
  detail: CustomerView["detailLevel"];
}): ReactElement<DocumentProps> {
  const { data, addendumData, includeSpecAddendum, layout, detail } = args;

  const skuSet = data.skus;
  const hasCharges = data.serviceFees.length > 0;
  const hasUnpriced = data.skus.some((s) =>
    s.tier_prices.some((p) => p === null),
  );

  // Addendum gate: include only when the toggle was on AND the loader confirms
  // meaningful content (impl-6 `hasMeaningfulContent` guard — an all-empty
  // addendum doesn't render). The caller doesn't decide; the representation
  // does.
  const includeAddendum =
    includeSpecAddendum &&
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
      layout={layout}
      detail={detail}
      hasCharges={hasCharges}
      hasUnpriced={hasUnpriced}
      addendumPages={addendumPages}
    />
  );
}

/**
 * OD-023 · render a SENT version from its frozen representation.
 *
 * The single render path used at send time, so the stored payload and the
 * generated PDF cannot describe different versions — the artifact is produced
 * from the same object that is persisted, not from a parallel resolution that
 * happens to match.
 *
 * Lives here rather than beside the representation type because this module is
 * inside the react-pdf containment allowlist and that one is deliberately kept
 * free of the PDF library.
 */
export function renderRepresentation(
  rep: QuoteSnapshotRepresentation,
): ReactElement<DocumentProps> {
  return buildDocumentFromRepresentation({
    data: rep.cpdfData,
    addendumData: rep.addendumData,
    includeSpecAddendum: rep.includeSpecAddendum,
    layout: rep.pdfLayout,
    detail: rep.detailLevel,
  });
}
