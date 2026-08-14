"use client";

import { useMemo, useState, useTransition } from "react";
import type { AssemblyTree } from "@/lib/assembly-tree";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { AsyRow } from "./asy-row";
import { DirectProductRow } from "./direct-product-row";
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
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [, startMoveTransition] = useTransition();

  function beginMove(e: React.DragEvent, quoteLeafId: string) {
    if (!editable) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", quoteLeafId);
    e.dataTransfer.setData("application/x-a1v2-drag-kind", "member");
    e.stopPropagation();
    setMovingLeafId(quoteLeafId);
  }

  function overZone(e: React.DragEvent, zone: string) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== zone) setDropTarget(zone);
  }

  function dropOnZone(e: React.DragEvent, target: string) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    const quoteLeafId = movingLeafId;
    setMovingLeafId(null);
    setDropTarget(null);

    const fd = new FormData();
    fd.set("quoteLeafId", quoteLeafId);
    fd.set("target", target);
    fd.set("position", "0");
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
    setDropTarget(null);
  }

  const isEmpty =
    orderedAssemblies.length === 0 && tree.directProducts.length === 0;

  return (
    <div
      className={`a1v2-tree${dropTarget === "direct" ? " drop-active" : ""}`}
      onDragEnd={(e) => {
        handleAsyDragEnd();
        endMove();
      }}
      // The tree body IS the Direct/root drop zone. No separate dropzone
      // element is introduced — the existing container communicates it, and a
      // permanent "drop here" affordance would be chrome the operator has to
      // read past on every render.
      onDragOver={(e) => overZone(e, "direct")}
      onDrop={(e) => dropOnZone(e, "direct")}
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
              onMoveStart={(e) => beginMove(e, product.quoteLeafId)}
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
              isDropTarget={dropTarget === asy.id}
              onMemberDragStart={beginMove}
              onMemberDragOverGroup={(e) => overZone(e, asy.id)}
              onMemberDropOnGroup={(e) => dropOnZone(e, asy.id)}
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
