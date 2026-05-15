"use client";

import { useState } from "react";
import { AddAssemblyButton } from "./add-assembly-button";
import { AddProductModal } from "./add-product-modal";
import { SkuSearchPanel } from "./sku-search-panel";

// §6.b path-B migration commit 3 follow-up — SKU footer client
// wrapper. Renders canonical .r7b-sku-footer layout per
// 7bsetup.jsx lines 187-192 + 7bstyles.css .r7b-sku-footer rules.
//
// Canonical layout: [+ Add product] [↗ Pull from HubSpot]
//                   [📦 Pull from Inventory] <meta>
//
// Confirmation C disposition: "Pull from Inventory" stripped from
// v1 footer (own scoping slice). Two buttons + meta only.
//
// §6.b Step 8 — "+ Add product" trigger now opens the canonical
// .r7b-modal Add-product modal (AddProductModal) instead of the
// pre-Step-8 AddAssemblyButton inline form. The modal supports
// both leaf + assembly via the Type select and includes the
// HubSpot writeback toggle per R7b §3.7 / §3.7.1.
//
// "↗ Pull from HubSpot" is a button per canonical; clicking
// expands the SkuSearchPanel below the footer. Prior impl
// rendered SkuSearchPanel inline inside the footer flex — that
// caused the visual mismatch (search input + dropdown took
// space, broke canonical button-row register) and the "white
// gap" Edward smoked.

type EligibleParent = {
  id: string;
  skuLabel: string;
  productName: string;
  skuRole: "leaf" | "assembly";
};

export function SkuFooter({
  quoteId,
  eligibleParents,
}: {
  quoteId: string;
  eligibleParents: EligibleParent[];
}) {
  // eligibleParents accepted for API stability — used by sku-search-panel.
  // AddProductModal v1 creates top-level rows only; parent-child wiring
  // happens in the row drawer (§6.b Step 4 / Mismatch 1 γ carve).
  void eligibleParents;

  const [hubSpotOpen, setHubSpotOpen] = useState(false);

  return (
    <>
      <div className="r7b-sku-footer">
        <AddProductModal quoteId={quoteId} />
        <AddAssemblyButton quoteId={quoteId} />
        <button
          type="button"
          className="add-sku"
          onClick={() => setHubSpotOpen((v) => !v)}
          aria-expanded={hubSpotOpen}
          aria-controls="sku-hubspot-panel"
        >
          ↗ Pull from HubSpot
        </button>
        <span className="meta">Drag rows to reorder</span>
      </div>
      {hubSpotOpen && (
        <div
          id="sku-hubspot-panel"
          style={{
            background: "var(--paper-2)",
            borderTop: "1px solid var(--rule)",
            padding: "12px 16px",
          }}
        >
          <SkuSearchPanel
            quoteId={quoteId}
            eligibleParents={eligibleParents.map((p) => ({
              id: p.id,
              skuLabel: p.skuLabel,
              productName: p.productName,
              skuRole: p.skuRole,
            }))}
          />
        </div>
      )}
    </>
  );
}
