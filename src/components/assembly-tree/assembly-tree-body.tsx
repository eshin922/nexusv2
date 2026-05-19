"use client";

import { useMemo, useState, useTransition } from "react";
import type { AssemblyTree } from "@/lib/assembly-tree";
import { AsyRow } from "./asy-row";
import { reorderAssemblies } from "@/app/actions/assemblies";

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
  quoteId,
}: {
  tree: AssemblyTree;
  editable: boolean;
  quoteId: string;
}) {
  const serverOrder = useMemo(
    () => tree.assemblies.map((a) => a.id),
    [tree.assemblies],
  );
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
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

  return (
    <div className="a1v2-tree" onDragEnd={handleAsyDragEnd}>
      {orderedAssemblies.length === 0 ? (
        <p className="r7b-empty-state">
          {editable
            ? "No assemblies yet. Use the buttons above to add a product."
            : "No assemblies."}
        </p>
      ) : (
        orderedAssemblies.map((asy) => (
          <AsyRow
            key={asy.id}
            asy={asy}
            editable={editable}
            isDragging={dragId === asy.id}
            onDragStart={(e) => handleAsyDragStart(e, asy.id)}
            onDragOver={(e) => handleAsyDragOver(e, asy.id)}
          />
        ))
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
