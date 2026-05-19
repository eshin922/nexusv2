// Phase A.1 v2 impl-2 Step 4 — ASY tree view (scenarios ① + ④)
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// `TreeView` (lines 117-175) + `AsyRow` (177-213) + `LeafRow`
// (215-243) + `CompletenessChip` (85-98). Class names .a1v2-* per
// Pattern 30 path-B-default canonical CSS (src/styles/r-a1v2-setup.css).
//
// Step 4 scope: static tree render + rollup chips. Subsequent steps:
//   - Step 5: type chips at row level (ASY filled blue / LEAF outline)
//   - Steps 6-7: context menus (currently the ⋯ button is inert)
//   - Step 8: per-SKU notes textarea + HAS NOTE chip
//   - Step 9: drag-to-reorder
//   - Step 10: header buttons (Add product / Pull from HubSpot) +
//             counter caption
//
// Pattern 28 verbatim copy preserved from canonical JSX:
//   - "{N} leaves" (plural-always even at 1, matches canonical line 195)
//   - "+ N other ASY{s}" / "this scenario only" leaf-refs caption
//   - "✓ All N leaves complete" / "⚠ N of M leaves pending" rollup copy
//   - "✓ Complete" / "⚠ N fields pending" / "— No specs entered" /
//     "⚠ No type set" chip copy

import type {
  AssemblyTree,
  AssemblyNode,
  AssemblyLeafNode,
  SpecCompleteness,
  AssemblyCompletenessRollup,
} from "@/lib/assembly-tree";
import { AsyContextMenu } from "./asy-context-menu";

type EditableProps = { editable: boolean };

export function AssemblyTreeView({
  tree,
  editable,
}: {
  tree: AssemblyTree;
  editable: boolean;
}) {
  // Rollup-state counters for the tree summary header (scenario ④).
  // good = all_complete, warn = partial or mixed_with_placeholders,
  // empty = no_leaves.
  const counts = tree.assemblies.reduce(
    (acc, a) => {
      const k = a.rollup.kind;
      if (k === "all_complete") acc.good++;
      else if (k === "partial" || k === "mixed_with_placeholders") acc.warn++;
      else acc.empty++;
      return acc;
    },
    { good: 0, warn: 0, empty: 0 },
  );

  // Per CD's tree summary: "X of Y leaves have complete specs".
  const totalLeaves = tree.totalSkus;
  const completeLeaves = tree.assemblies.reduce(
    (sum, a) =>
      sum +
      a.children.filter((c) => c.specCompleteness?.kind === "complete").length,
    0,
  );

  return (
    <div className="a1v2-card">
      <div className="a1v2-card-head">
        {/* Step 10 fills `.actions` with the Add product + Pull from
            HubSpot buttons + the "N SKUs · M assemblies" counter caption.
            Step 4 ships the structural skeleton with the h3 only. */}
        <h3>
          SKUs <em>· cost-stack tree</em>
        </h3>
        <div className="actions" />
      </div>

      <div className="a1v2-tree-summary">
        <span className="pip complete" />{" "}
        <strong>{counts.good}</strong> ASY all-complete
        <span style={{ color: "var(--ink-4)" }}>·</span>
        <span className="pip partial" />{" "}
        <strong>{counts.warn}</strong> partial
        <span style={{ color: "var(--ink-4)" }}>·</span>
        <span className="pip empty" />{" "}
        <strong>{counts.empty}</strong> empty
        <span className="right">
          {completeLeaves} of {totalLeaves} leaves have complete specs
        </span>
      </div>

      <div className="a1v2-tree">
        {tree.assemblies.length === 0 ? (
          <p className="r7b-empty-state">
            {editable
              ? "No assemblies yet. Use the buttons above to add a product."
              : "No assemblies."}
          </p>
        ) : (
          tree.assemblies.map((asy) => (
            <AsyRow key={asy.id} asy={asy} editable={editable} />
          ))
        )}
      </div>

      {/* Step 5 of Phase 5 (impl-5) wires the library browse modal.
          Step 4 ships the affordance button as inert visual; clicking
          is a no-op until impl-5. */}
      <div className="a1v2-library-affordance">
        <button className="a1v2-btn ghost sm" disabled aria-disabled="true">
          + Add leaf from library →
        </button>
        <span className="meta">browse globally-reusable components</span>
      </div>
    </div>
  );
}

function AsyRow({ asy, editable }: { asy: AssemblyNode } & EditableProps) {
  const isExpanded = asy.children.length > 0;
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
            {/* Step 5 styles this type-tag to canonical ASY-filled-blue.
                Step 4 ships plain text. */}
            <span className="type-tag">
              {asy.productType?.name ?? "—"}
            </span>
          </div>
        </div>
        <span className="leaf-count">{asy.children.length} leaves</span>
        <AsyRollupChip rollup={asy.rollup} />
        <AsyContextMenu
          assemblyId={asy.id}
          assemblySku={asy.sku}
          disabled={!editable}
        />
      </div>
      <div className="a1v2-leaves">
        {asy.children.map((leaf) => (
          <LeafRow key={leaf.junctionId} leaf={leaf} />
        ))}
      </div>
    </>
  );
}

function LeafRow({ leaf }: { leaf: AssemblyLeafNode }) {
  const otherRefs = Math.max(0, leaf.globalRefCount - 1);
  const refsCopy =
    otherRefs > 0
      ? `+ ${otherRefs} other ASY${otherRefs === 1 ? "" : "s"}`
      : "this scenario only";
  // Quantity rendering matches canonical: < 1 → 4 decimals, ≥ 1 →
  // raw (canonical doesn't strip trailing zeros at integer quantities;
  // preserved verbatim per Pattern 28).
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
        {/* Step 7 wires this ⋯ button to LeafContextMenu. */}
        <button
          className="context-trigger"
          type="button"
          disabled
          aria-disabled="true"
          aria-label="Leaf context menu (wired in Step 7)"
        >
          ⋯
        </button>
      </div>
    </div>
  );
}

function AsyRollupChip({ rollup }: { rollup: AssemblyCompletenessRollup }) {
  // ASY rollup chip — scenario ④ states.
  // Per canonical computeAsyRollup: good=allComplete, warn otherwise
  // unless no leaves. Copy is interpolated.
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
  // Per-leaf chip — scenarios ⑤-⑩ states (rendered in tree per CD
  // designer notes §3.1 "completeness chip" cell). Step 4 ships the
  // chip render here; full Spec entry surface comes in impl-3.
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
