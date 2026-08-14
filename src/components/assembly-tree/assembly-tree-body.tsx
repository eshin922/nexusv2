"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { AssemblyTree } from "@/lib/assembly-tree";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { AsyRow } from "./asy-row";
import { DirectProductRow } from "./direct-product-row";
import { attachDragProxy } from "./drag-proxy";
import {
  indicatorAnchor,
  isNoOpDrop,
  resolveDropIndex,
  sameZone,
  type DropPlan,
  type DropZone,
} from "@/lib/product-structure/drop-plan";
import {
  moveProductMembership,
  reorderAssemblies,
} from "@/app/actions/assemblies";
import { useRouter } from "next/navigation";

// Phase A.1 v2 impl-2 Step 9 — Drag-to-reorder ASY rows.
//
// Mirrors src/app/projects/[id]/quotes/[quoteId]/sku-row-list.tsx
// pattern (HTML5 native drag-and-drop + optimistic order during drag
// + server action on drop + revalidation snaps back to canonical
// order). Per CLAUDE.md "Form state pattern" / Pattern 47: state is
// controlled; the server action is fire-and-forget within a
// transition; rollback on error clears optimistic state and surfaces
// the error inline.
//
// LEAF reorder within an ASY is handled inside AsyRow; this wrapper
// only manages ASY-level reorder.

export function AssemblyTreeBody({
  tree,
  editable,
  projectId,
  quoteId,
  assemblies,
  fullLeafTypes,
  permissions,
}: {
  tree: AssemblyTree;
  editable: boolean;
  projectId: string;
  quoteId: string;
  assemblies: { id: string; sku: string; name: string; leafCount: number }[];
  fullLeafTypes: LeafSpecEntryProductType[];
  permissions: { canCreateLeaves: boolean };
}) {
  const serverOrder = useMemo(
    () => tree.assemblies.map((a) => a.id),
    [tree.assemblies],
  );
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const router = useRouter();
  const [, startReorderTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const orderedAssemblies = useMemo(() => {
    if (!optimisticOrder) return tree.assemblies;
    const byId = new Map(tree.assemblies.map((a) => [a.id, a] as const));
    return optimisticOrder
      .map((id) => byId.get(id))
      .filter((a): a is (typeof tree.assemblies)[number] => !!a);
  }, [tree.assemblies, optimisticOrder]);

  function handleAsyDragStart(e: React.DragEvent, id: string) {
    if (!editable) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.setData(
      "application/x-a1v2-drag-kind",
      "assembly",
    );
    setDragId(id);
  }

  function handleAsyDragOver(e: React.DragEvent, overId: string) {
    if (!editable || !dragId || dragId === overId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const order = optimisticOrder ?? serverOrder;
    const fromIdx = order.indexOf(dragId);
    const toIdx = order.indexOf(overId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

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

  function handleAsyDragEnd() {
    if (!dragId) return;
    const order = optimisticOrder;
    setDragId(null);
    if (!order) return;
    const changed = order.some((id, i) => id !== serverOrder[i]);
    if (!changed) {
      setOptimisticOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("assemblyIds", order.join(","));
    startReorderTransition(async () => {
      setError(null);
      const result = await reorderAssemblies(fd);
      setOptimisticOrder(null);
      if (!result.ok) {
        setError(result.error.message);
      }
    });
  }

  // Direct Products render as peers of Item Groups, not inside them. They are
  // listed first because a quote-level product is the simpler structure and
  // reading it before the nested one matches how the operator built it.
  // ---- Member/product movement across structural homes.
  //
  // Held HERE rather than inside AsyRow, because the drag now crosses row
  // boundaries: A -> B, Direct -> group, group -> Direct. Per-ASY state can
  // only ever describe movement inside one group, which is why cross-group
  // movement was unreachable before.
  //
  // Reorder WITHIN a group stays where it was — that path works and is not
  // rebuilt here.
  const [movingLeafId, setMovingLeafId] = useState<string | null>(null);
  // WHERE THE PRODUCT WILL LAND — destination plus resulting index, not "which
  // row is the pointer over". Those two disagree on every downward same-list
  // drag, and the operator is being shown a promise about the former.
  const [plan, setPlan] = useState<DropPlan | null>(null);
  const [, startMoveTransition] = useTransition();

  const directIds = useMemo(
    () => tree.directProducts.map((p) => p.quoteLeafId),
    [tree.directProducts],
  );
  const groupMemberIds = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of orderedAssemblies)
      m.set(
        a.id,
        a.children.map((c) => c.quoteLeafId),
      );
    return m;
  }, [orderedAssemblies]);

  const siblingsFor = useCallback(
    (zone: DropZone): string[] =>
      zone.kind === "direct" ? directIds : (groupMemberIds.get(zone.assemblyId) ?? []),
    [directIds, groupMemberIds],
  );

  /** The home the product is being dragged OUT of — needed to detect no-ops. */
  const movingHome = useMemo<DropZone | null>(() => {
    if (!movingLeafId) return null;
    if (directIds.includes(movingLeafId)) return { kind: "direct" };
    for (const [assemblyId, ids] of groupMemberIds)
      if (ids.includes(movingLeafId)) return { kind: "group", assemblyId };
    return null;
  }, [movingLeafId, directIds, groupMemberIds]);

  function beginMove(
    e: React.DragEvent,
    quoteLeafId: string,
    name: string,
    sku: string | null,
  ) {
    if (!editable) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", quoteLeafId);
    e.dataTransfer.setData("application/x-a1v2-drag-kind", "member");
    e.stopPropagation();
    attachDragProxy(e, name, sku);
    setMovingLeafId(quoteLeafId);
  }

  const proposePlan = useCallback(
    (zone: DropZone, overId: string | null, edge: "before" | "after") => {
      if (!movingLeafId) return;
      const index = resolveDropIndex({
        siblings: siblingsFor(zone),
        movingId: movingLeafId,
        overId,
        edge,
      });
      const next: DropPlan = { zone, index };
      // A destination that persists the structure that already exists is not a
      // destination. No line, and the drop below becomes a no-op.
      if (
        isNoOpDrop({
          plan: next,
          currentZone: movingHome,
          currentSiblings: movingHome ? siblingsFor(movingHome) : [],
          movingId: movingLeafId,
        })
      ) {
        setPlan(null);
        return;
      }
      setPlan((prev) =>
        prev && sameZone(prev.zone, next.zone) && prev.index === next.index
          ? prev
          : next,
      );
    },
    [movingLeafId, movingHome, siblingsFor],
  );

  /** Hovering a product row — the precise case. Midpoint decides the edge. */
  function overProductRow(
    e: React.DragEvent,
    zone: DropZone,
    overQuoteLeafId: string,
  ) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge =
      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    proposePlan(zone, overQuoteLeafId, edge);
  }

  /** Hovering a destination but no particular row — append. */
  function overZoneTail(e: React.DragEvent, zone: DropZone) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    proposePlan(zone, null, "after");
  }

  /** The group HEADER sits above its members, so it reads as position zero. */
  function overGroupHeader(e: React.DragEvent, assemblyId: string) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const zone: DropZone = { kind: "group", assemblyId };
    const first = siblingsFor(zone).find((id) => id !== movingLeafId) ?? null;
    proposePlan(zone, first, "before");
  }

  function commitDrop(e: React.DragEvent) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    const quoteLeafId = movingLeafId;
    const target = plan;
    setMovingLeafId(null);
    setPlan(null);
    // No indicator was showing, so nothing was promised. Releasing over an
    // invalid destination returns the product to where it already is.
    if (!target) return;

    const fd = new FormData();
    fd.set("quoteLeafId", quoteLeafId);
    fd.set(
      "target",
      target.zone.kind === "direct" ? "direct" : target.zone.assemblyId,
    );
    fd.set("position", String(target.index));
    startMoveTransition(async () => {
      setError(null);
      const result = await moveProductMembership(fd);
      // No optimistic reshuffle. A move crosses a governed boundary, so the
      // tree redraws from what the server actually did rather than from what
      // the drop implied — a failed move must not leave the operator looking
      // at a structure that does not exist.
      if (!result.ok) setError(result.error.message);
      else router.refresh();
    });
  }

  function endMove() {
    setMovingLeafId(null);
    setPlan(null);
  }

  // Which row carries the line, and on which edge.
  const anchor = useMemo(() => {
    if (!plan || !movingLeafId) return null;
    return indicatorAnchor(siblingsFor(plan.zone), movingLeafId, plan.index);
  }, [plan, movingLeafId, siblingsFor]);

  const dropEdgeFor = useCallback(
    (zone: DropZone, quoteLeafId: string): "before" | "after" | null => {
      if (!plan || !anchor || !sameZone(plan.zone, zone)) return null;
      return anchor.overId === quoteLeafId ? anchor.edge : null;
    },
    [plan, anchor],
  );

  const isEmpty =
    orderedAssemblies.length === 0 && tree.directProducts.length === 0;

  return (
    <div
      className={`a1v2-tree${plan?.zone.kind === "direct" ? " drop-active" : ""}`}
      onDragEnd={() => {
        handleAsyDragEnd();
        endMove();
      }}
      // The tree body IS the Direct/root drop zone. No separate dropzone
      // element is introduced — the existing container communicates it, and a
      // permanent "drop here" affordance would be chrome the operator has to
      // read past on every render.
      onDragOver={(e) => overZoneTail(e, { kind: "direct" })}
      onDrop={commitDrop}
    >
      {isEmpty ? (
        <p className="r7b-empty-state">
          {editable
            ? "Nothing on this quote yet · use Add Product for a single product, or Create Item Group to sell several together."
            : "No products."}
        </p>
      ) : (
        <>
          {tree.directProducts.map((product) => (
            <DirectProductRow
              key={product.quoteLeafId}
              product={product}
              editable={editable}
              quoteId={quoteId}
              isMoving={movingLeafId === product.quoteLeafId}
              onMoveStart={(e) =>
                beginMove(e, product.quoteLeafId, product.name, product.sku)
              }
              dropEdge={dropEdgeFor({ kind: "direct" }, product.quoteLeafId)}
              onRowDragOver={(e) =>
                overProductRow(e, { kind: "direct" }, product.quoteLeafId)
              }
              onRowDrop={commitDrop}
              editSpecsHref={`/projects/${projectId}/quotes/${quoteId}/leaves/${product.leafId}/specs`}
            />
          ))}
          {orderedAssemblies.map((asy) => (
            <AsyRow
              key={asy.id}
              asy={asy}
              editable={editable}
              projectId={projectId}
              quoteId={quoteId}
              isDragging={dragId === asy.id}
              onDragStart={(e) => handleAsyDragStart(e, asy.id)}
              onDragOver={(e) => handleAsyDragOver(e, asy.id)}
              movingLeafId={movingLeafId}
              isDropTarget={
                plan?.zone.kind === "group" && plan.zone.assemblyId === asy.id
              }
              // Empty group: there is no member row to anchor the line to, so
              // the header carries it.
              showTailIndicator={
                plan?.zone.kind === "group" &&
                plan.zone.assemblyId === asy.id &&
                anchor?.overId === null
              }
              memberDropEdge={(quoteLeafId) =>
                dropEdgeFor({ kind: "group", assemblyId: asy.id }, quoteLeafId)
              }
              onMemberDragStart={beginMove}
              onMemberRowDragOver={(e, quoteLeafId) =>
                overProductRow(e, { kind: "group", assemblyId: asy.id }, quoteLeafId)
              }
              onMemberDragOverGroup={(e) => overGroupHeader(e, asy.id)}
              onMemberDragOverGroupTail={(e) =>
                overZoneTail(e, { kind: "group", assemblyId: asy.id })
              }
              onMemberDropOnGroup={commitDrop}
              assemblies={assemblies}
              fullLeafTypes={fullLeafTypes}
              permissions={permissions}
            />
          ))}
        </>
      )}
      {error ? (
        <div
          role="alert"
          style={{
            padding: "8px 16px",
            color: "var(--bad)",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          Reorder failed: {error}
        </div>
      ) : null}
    </div>
  );
}
