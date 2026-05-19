"use client";

import { useState } from "react";
import type {
  AssemblyNode,
  AssemblyLeafNode,
  SpecCompleteness,
  AssemblyCompletenessRollup,
} from "@/lib/assembly-tree";
import { AsyContextMenu } from "./asy-context-menu";
import { LeafContextMenu } from "./leaf-context-menu";
import { AsyNotesDrawerPanel, AsyNotesTrigger } from "./asy-notes-drawer";

// Phase A.1 v2 impl-2 Step 8 — AsyRow client component
//
// Moved out of assembly-tree-view.tsx (server component) so the
// notes-drawer state can coordinate between the trigger inside the
// row and the drawer panel below it. Companion files:
//   - asy-context-menu.tsx (client) — ⋯ menu
//   - leaf-context-menu.tsx (client) — ⋯ menu on leaves
//   - asy-notes-drawer.tsx (client) — split into AsyNotesTrigger
//     (renders inside row) + AsyNotesDrawerPanel (renders between
//     row and leaves)

export function AsyRow({
  asy,
  editable,
}: {
  asy: AssemblyNode;
  editable: boolean;
}) {
  const isExpanded = asy.children.length > 0;
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <>
      <div className={`a1v2-asy-row${isExpanded ? " expanded" : ""}`}>
        <span className="twirl" aria-hidden="true">
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
      <div className="a1v2-leaves">
        {asy.children.map((leaf) => (
          <LeafRow key={leaf.junctionId} leaf={leaf} editable={editable} />
        ))}
      </div>
    </>
  );
}

function LeafRow({
  leaf,
  editable,
}: {
  leaf: AssemblyLeafNode;
  editable: boolean;
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
    <div className="a1v2-leaf-row">
      <span className="leaf-icon" aria-hidden="true">
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
