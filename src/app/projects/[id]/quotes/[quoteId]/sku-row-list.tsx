"use client";

import { useMemo, useState, useTransition } from "react";
import { SkuRow } from "./sku-row";
import { reorderQuoteSkus } from "@/app/actions/quotes";

// §6.b Step 3 — per-row drawer infrastructure.
//
// Lifts `openSkuId` state above individual SkuRow components so
// only one drawer can be open at a time. Opening a new row's
// drawer collapses any previously-open drawer. Drawer state is
// ephemeral — no URL param (per brief §3.2 + Pushback 2
// disposition).
//
// §6.b Step 9 — Drag-and-drop reorder (R7b §3.8). HTML5 native
// drag-and-drop on the .r7b-sku-row element; the grip column
// provides the visual affordance (.grip cursor: grab) but the
// whole row is draggable so PMs can grab anywhere comfortable.
// Local optimistic order during drag → action persists on drop
// → server revalidation snaps to the new sort_order. Reorder
// scope is the FLAT visible list (page.tsx renders via
// buildTreeRenderOrder which interleaves assembly + children);
// PMs reorder by parent → children migrate with the parent on
// the next render since they depend on parent's sort_order
// position in the tree traversal. Reordering individual children
// across parents requires the drawer's Reassign affordance, not
// drag.
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
  /** Leaf-detach micro-slice Sub-item 1b — drives the per-row
   * Detach confirmation modal gate in DrawerChildList. Server-
   * computed: notes non-empty OR retailBenchmark non-null. */
  hasPreservableData: boolean;
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
  /** Leaf-detach micro-slice Sub-item 1 — current parent's skuLabel
   * (only meaningful when sku.parentSkuId !== null). Threaded
   * through so the row's overflow menu can render "Detach from
   * {parent name}" and the detach confirmation modal can name the
   * parent. Null when SKU has no parent. */
  currentParentLabel: string | null;
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

  // §6.b Step 9 — Local optimistic order during drag. Server
  // revalidation overwrites this when the action returns. Memo
  // resets to the canonical server-given order whenever `rows`
  // identity changes (after a successful reorder + revalidate, or
  // after an add/delete elsewhere in the table).
  const serverOrder = useMemo(() => rows.map((r) => r.sku.id), [rows]);
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [, startReorderTransition] = useTransition();

  const orderedRows = useMemo(() => {
    if (!optimisticOrder) return rows;
    const byId = new Map(rows.map((r) => [r.sku.id, r] as const));
    return optimisticOrder
      .map((id) => byId.get(id))
      .filter((r): r is SkuRowListItem => !!r);
  }, [rows, optimisticOrder]);

  function onDrawerToggle(id: string) {
    setOpenSkuId((prev) => (prev === id ? null : id));
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    if (disabled) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setDragId(id);
    // Close any open drawer while dragging — drawer + drag at the
    // same time is visually crowded and the drag handle overlap
    // makes the drop target ambiguous.
    setOpenSkuId(null);
  }

  function handleDragOver(e: React.DragEvent, overId: string) {
    if (disabled || !dragId || dragId === overId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const order = optimisticOrder ?? serverOrder;
    const fromIdx = order.indexOf(dragId);
    const toIdx = order.indexOf(overId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    // Detect upper vs lower half of the row to decide insert position.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    const insertAt = above ? toIdx : toIdx + 1;
    const adjusted = insertAt > fromIdx ? insertAt - 1 : insertAt;
    if (adjusted === fromIdx) return;

    const next = order.slice();
    next.splice(fromIdx, 1);
    next.splice(adjusted, 0, dragId);
    setOptimisticOrder(next);
  }

  function handleDragEnd() {
    if (!dragId) return;
    const order = optimisticOrder;
    setDragId(null);
    if (!order) return;
    // Did anything actually change vs server order?
    const changed = order.some((id, i) => id !== serverOrder[i]);
    if (!changed) {
      setOptimisticOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("skuIds", order.join(","));
    startReorderTransition(async () => {
      const result = await reorderQuoteSkus(fd);
      // Clear optimistic state — server revalidation will land the
      // new canonical order via the rows prop on the next render.
      setOptimisticOrder(null);
      if (!result.ok) {
        // Rollback is automatic via clearing optimisticOrder; surface
        // the error via window.alert for v1 (UX_BACKLOG: toast).
        if (typeof window !== "undefined") window.alert(result.error.message);
      }
    });
  }

  return (
    <div className="divide-y divide-rule" onDragEnd={handleDragEnd}>
      {orderedRows.map(
        ({
          sku,
          depth,
          hasChildren,
          childCount,
          childSkus,
          eligibleParents,
          currentParentLabel,
        }) => (
          <SkuRow
            key={sku.id}
            sku={sku}
            depth={depth}
            hasChildren={hasChildren}
            childCount={childCount}
            childSkus={childSkus}
            eligibleParents={eligibleParents}
            currentParentLabel={currentParentLabel}
            hubspotPortalId={hubspotPortalId}
            disabled={disabled}
            isDrawerOpen={openSkuId === sku.id}
            onDrawerToggle={() => onDrawerToggle(sku.id)}
            projectId={projectId}
            quoteId={quoteId}
            isDragging={dragId === sku.id}
            onDragStart={(e) => handleDragStart(e, sku.id)}
            onDragOver={(e) => handleDragOver(e, sku.id)}
            onDragEnd={handleDragEnd}
          />
        ),
      )}
    </div>
  );
}
