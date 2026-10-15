"use client";

import { lazy, Suspense } from "react";

const EditableSkuAccountingNote = lazy(() => import("./sku-accounting-note-editor"));

/** Quote-specific, internal instruction attached to one product identity. */
export function SkuAccountingNote({
  quoteId,
  quoteLeafId,
  sku,
  value,
  editable,
}: {
  quoteId: string;
  quoteLeafId: string;
  sku: string;
  value: string | null;
  editable: boolean;
}) {
  if (!editable) {
    return <div className="cm2-sku-accounting-note">
      <span>Note to Accounting{sku ? ` · ${sku}` : ""}</span>
      <span className="cm2-sku-accounting-read">{value || "No instruction recorded"}</span>
    </div>;
  }
  return <Suspense fallback={<span className="cm2-edit-loading" aria-hidden="true" />}>
    <EditableSkuAccountingNote quoteId={quoteId} quoteLeafId={quoteLeafId} sku={sku} value={value} />
  </Suspense>;
}
