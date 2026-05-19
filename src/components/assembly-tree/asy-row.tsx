"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  AssemblyNode,
  AssemblyLeafNode,
  SpecCompleteness,
  AssemblyCompletenessRollup,
} from "@/lib/assembly-tree";
import { AsyContextMenu } from "./asy-context-menu";
import { LeafContextMenu } from "./leaf-context-menu";
import { AsyNotesDrawerPanel, AsyNotesTrigger } from "./asy-notes-drawer";
import { reorderAssemblyLeaves } from "@/app/actions/assemblies";

// Phase A.1 v2 impl-2 Step 4-9 — AsyRow client component
//
// Owns three pieces of UI state:
//   - notesOpen — toggles the per-ASY notes drawer (Step 8)
//   - leafDragId — currently-dragged junction's id (Step 9)
//   - leafOptimisticOrder — local order during drag (Step 9)
//
// ASY-row drag-and-drop is wired by the parent AssemblyTreeBody;
// leaf-row drag-and-drop is wired here (per-ASY scope; cross-ASY
// junction moves use the LEAF context menu's "Assign to parent
// ASY" affordance which is deferred to a follow-up).

export function AsyRow({
  asy,
  editable,
  isDragging,
  onDragStart,
  onDragOver,
}: {
  asy: AssemblyNode;
  editable: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const isExpanded = asy.children.length > 0;
  const [notesOpen, setNotesOpen] = useState(false);

  // LEAF-level drag state (scoped per ASY — leaves can only reorder
  // within their parent ASY in v1).
  const serverLeafOrder = useMemo(
    () => asy.children.map((c) => c.junctionId),
    [asy.children],
  );
  const [leafOptimisticOrder, setLeafOptimisticOrder] = useState<
    string[] | null
  >(null);
  const [leafDragId, setLeafDragId] = useState<string | null>(null);
  const [, startLeafReorderTransition] = useTransition();
  const [leafError, setLeafError] = useState<string | null>(null);

  const orderedChildren = useMemo(() => {
    if (!leafOptimisticOrder) return asy.children;
    const byId = new Map(
      asy.children.map((c) => [c.junctionId, c] as const),
    );
    return leafOptimisticOrder
      .map((id) => byId.get(id))
      .filter((c): c is AssemblyLeafNode => !!c);
  }, [asy.children, leafOptimisticOrder]);

  function handleLeafDragStart(e: React.DragEvent, junctionId: string) {
    if (!editable) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", junctionId);
    e.dataTransfer.setData("application/x-a1v2-drag-kind", "leaf");
    e.stopPropagation(); // don't bubble into ASY-row dragstart
    setLeafDragId(junctionId);
  }

  function handleLeafDragOver(e: React.DragEvent, overJunctionId: string) {
    if (!editable || !leafDragId || leafDragId === overJunctionId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    const order = leafOptimisticOrder ?? serverLeafOrder;
    const fromIdx = order.indexOf(leafDragId);
    const toIdx = order.indexOf(overJunctionId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    const insertAt = above ? toIdx : toIdx + 1;
    const adjusted = insertAt > fromIdx ? insertAt - 1 : insertAt;
    if (adjusted === fromIdx) return;

    const next = order.slice();
    next.splice(fromIdx, 1);
    next.splice(adjusted, 0, leafDragId);
    setLeafOptimisticOrder(next);
  }

  function handleLeafDragEnd() {
    if (!leafDragId) return;
    const order = leafOptimisticOrder;
    setLeafDragId(null);
    if (!order) return;
    const changed = order.some((id, i) => id !== serverLeafOrder[i]);
    if (!changed) {
      setLeafOptimisticOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set("assemblyId", asy.id);
    fd.set("junctionIds", order.join(","));
    startLeafReorderTransition(async () => {
      setLeafError(null);
      const result = await reorderAssemblyLeaves(fd);
      setLeafOptimisticOrder(null);
      if (!result.ok) setLeafError(result.error.message);
    });
  }

  return (
    <>
      <div
        className={`a1v2-asy-row${isExpanded ? " expanded" : ""}${isDragging ? " dragging" : ""}`}
        draggable={editable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
      >
        <span
          className="twirl"
          aria-hidden="true"
          title={editable ? "Drag to reorder" : undefined}
          style={{ cursor: editable ? "grab" : "default" }}
        >
          ▾
        </span>
        <span className="sku-pill">{asy.sku}</span>
        <div className="name-cell">
          <div className="name">{asy.name}</div>
          <div className="meta">
            {asy.packLabel ? <span>{asy.packLabel}</span> : null}
            {asy.packLabel ? <span className="sep">·</span> : null}
            <span className="type-tag">
              {asy.productType?.name ?? "—"}
            </span>
          </div>
        </div>
        <span className="leaf-count">{asy.children.length} leaves</span>
        <AsyRollupChip rollup={asy.rollup} />
        <AsyNotesTrigger
          assemblyId={asy.id}
          hasNote={
            asy.internalNotes !== null && asy.internalNotes.trim().length > 0
          }
          open={notesOpen}
          onToggle={() => setNotesOpen((v) => !v)}
        />
        <AsyContextMenu
          assemblyId={asy.id}
          assemblySku={asy.sku}
          disabled={!editable}
        />
      </div>
      {notesOpen ? (
        <AsyNotesDrawerPanel
          assemblyId={asy.id}
          initialNotes={asy.internalNotes}
          disabled={!editable}
        />
      ) : null}
      <div className="a1v2-leaves" onDragEnd={handleLeafDragEnd}>
        {orderedChildren.map((leaf) => (
          <LeafRow
            key={leaf.junctionId}
            leaf={leaf}
            editable={editable}
            isDragging={leafDragId === leaf.junctionId}
            onDragStart={(e) => handleLeafDragStart(e, leaf.junctionId)}
            onDragOver={(e) => handleLeafDragOver(e, leaf.junctionId)}
          />
        ))}
        {leafError ? (
          <div
            role="alert"
            style={{
              padding: "6px 16px 6px 60px",
              color: "var(--bad)",
              fontFamily: "var(--mono)",
              fontSize: 11,
            }}
          >
            Reorder failed: {leafError}
          </div>
        ) : null}
      </div>
    </>
  );
}

function LeafRow({
  leaf,
  editable,
  isDragging,
  onDragStart,
  onDragOver,
}: {
  leaf: AssemblyLeafNode;
  editable: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const otherRefs = Math.max(0, leaf.globalRefCount - 1);
  const refsCopy =
    otherRefs > 0
      ? `+ ${otherRefs} other ASY${otherRefs === 1 ? "" : "s"}`
      : "this scenario only";
  const qtyNum = Number(leaf.quantity);
  const qtyDisplay = qtyNum < 1 ? qtyNum.toFixed(4) : String(qtyNum);
  const costDisplay = leaf.unitCost
    ? `$${Number(leaf.unitCost).toFixed(2)} cost`
    : "— cost";

  return (
    <div
      className={`a1v2-leaf-row${isDragging ? " dragging" : ""}`}
      draggable={editable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
    >
      <span
        className="leaf-icon"
        aria-hidden="true"
        style={{ cursor: editable ? "grab" : "default" }}
      >
        ◦
      </span>
      <span className="leaf-sku">{leaf.sku ?? "—"}</span>
      <div className="leaf-name-cell">
        <div className="name">{leaf.name}</div>
        <div className="meta">
          qty {qtyDisplay} · {costDisplay}
        </div>
      </div>
      <span
        className={`type-tag leaf-type${leaf.productType ? "" : " untyped"}`}
      >
        {leaf.productType?.name ?? "untyped"}
      </span>
      <span className="leaf-refs">{refsCopy}</span>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <LeafCompletenessChip completeness={leaf.specCompleteness} />
        <LeafContextMenu
          junctionId={leaf.junctionId}
          leafName={leaf.name}
          disabled={!editable}
        />
      </div>
    </div>
  );
}

function AsyRollupChip({ rollup }: { rollup: AssemblyCompletenessRollup }) {
  let state: "complete" | "partial" | "empty";
  let copy: string;
  switch (rollup.kind) {
    case "all_complete":
      state = "complete";
      copy = `✓ All ${rollup.count} leaves complete`;
      break;
    case "partial": {
      const pending = rollup.total - rollup.complete;
      state = "partial";
      copy = `⚠ ${pending} of ${rollup.total} leaves pending`;
      break;
    }
    case "mixed_with_placeholders": {
      const pending = rollup.total - rollup.complete;
      state = "partial";
      copy = `⚠ ${pending} of ${rollup.total} leaves pending`;
      break;
    }
    case "no_leaves":
      state = "empty";
      copy = "— No leaves";
      break;
  }
  return <span className={`a1v2-chip ${state}`}>{copy}</span>;
}

function LeafCompletenessChip({
  completeness,
}: {
  completeness: SpecCompleteness | null;
}) {
  if (!completeness) {
    return <span className="a1v2-chip empty">— No specs entered</span>;
  }
  switch (completeness.kind) {
    case "complete":
      return (
        <span className="a1v2-chip complete">
          <span className="dot" />✓ Complete
        </span>
      );
    case "partial":
      return (
        <span className="a1v2-chip partial">
          ⚠ {completeness.total - completeness.filled} fields pending
        </span>
      );
    case "placeholder":
      return <span className="a1v2-chip partial">⚠ Fields pending</span>;
    case "empty":
      return <span className="a1v2-chip empty">— No specs entered</span>;
    case "no_type":
      return <span className="a1v2-chip no_type">⚠ No type set</span>;
  }
}
