"use client";

import { useState } from "react";
import { SkuRow } from "./sku-row";

// §6.b Step 3 — per-row drawer infrastructure.
//
// Lifts `openSkuId` state above individual SkuRow components so
// only one drawer can be open at a time. Opening a new row's
// drawer collapses any previously-open drawer. Drawer state is
// ephemeral — no URL param (per brief §3.2 + Pushback 2
// disposition).
//
// Step 3 ships the infrastructure + the Components-cell trigger
// on assembly rows; Step 4 fills the drawer body (child-SKU
// navigation list + per-SKU notes textarea).
//
// Trigger sources (this commit):
// - Click `{N} comp ▸` cell on an assembly row → toggles drawer
//
// Trigger sources deferred:
// - `⋯` button toggle (R7b designer notes §3.2) — current ⋯
//   menu houses critical affordances (Move up/down, Delete,
//   Reassign, Detach, HubSpot link). Step 9 drag-drop replaces
//   ↑↓, at which point the ⋯ menu can be folded into the drawer
//   or retired. Until then: ⋯ keeps the existing menu; drawer
//   trigger is the Components cell only on assemblies. Leaves
//   gain a drawer entry in Step 4 (likely via a HAS NOTE chip
//   click or a small "Notes" affordance row-internal).
//
// Server component composition: page.tsx pre-computes per-row
// derived data (depth, hasChildren, childCount, eligibleParents)
// and passes the typed array. This client wrapper renders the
// header + iterates.

export type SkuChildRow = {
  id: string;
  skuLabel: string;
  productName: string;
  skuRole: "leaf" | "assembly";
  qtyPerParent: string | null;
  childCount: number;
};

export type SkuRowListItem = {
  sku: {
    id: string;
    hubspotProductId: string | null;
    skuLabel: string;
    productName: string;
    unitsPerPack: number;
    retailBenchmark: string | null;
    notes: string | null;
    lastHubspotRefreshAt: Date | null;
    skuRole: "leaf" | "assembly";
    parentSkuId: string | null;
    qtyPerParent: string | null;
  };
  depth: number;
  hasChildren: boolean;
  childCount: number;
  /** §6.b Step 4 — direct children for the assembly drawer's
   * child-SKU navigation list. Empty array for leaves. */
  childSkus: SkuChildRow[];
  eligibleParents: Array<{
    id: string;
    skuLabel: string;
    productName: string;
    skuRole: "leaf" | "assembly";
  }>;
};

export function SkuRowList({
  rows,
  hubspotPortalId,
  disabled,
  projectId,
  quoteId,
}: {
  rows: SkuRowListItem[];
  hubspotPortalId: string | null;
  disabled: boolean;
  /** §6.b Step 4 — needed for the drawer's "↗ Cost build" link
   * per child SKU + the "+ Add child SKU" footer. */
  projectId: string;
  quoteId: string;
}) {
  const [openSkuId, setOpenSkuId] = useState<string | null>(null);

  function onDrawerToggle(id: string) {
    setOpenSkuId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="divide-y divide-rule">
      {rows.map(
        ({
          sku,
          depth,
          hasChildren,
          childCount,
          childSkus,
          eligibleParents,
        }) => (
          <SkuRow
            key={sku.id}
            sku={sku}
            depth={depth}
            hasChildren={hasChildren}
            childCount={childCount}
            childSkus={childSkus}
            eligibleParents={eligibleParents}
            hubspotPortalId={hubspotPortalId}
            disabled={disabled}
            isDrawerOpen={openSkuId === sku.id}
            onDrawerToggle={() => onDrawerToggle(sku.id)}
            projectId={projectId}
            quoteId={quoteId}
          />
        ),
      )}
    </div>
  );
}
