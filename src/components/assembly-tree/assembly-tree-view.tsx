// Phase A.1 v2 impl-2 Step 4-8 — ASY tree view (server wrapper)
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// `TreeView` (lines 117-175). Top-level card + summary header +
// .a1v2-tree map of AsyRow children + library-affordance footer.
//
// AsyRow + LeafRow + completeness chips moved to ./asy-row.tsx
// (client) so the per-ASY notes drawer (Step 8) can coordinate
// open/close state between its inline trigger and its sibling
// drawer panel.
//
// Pattern 28 verbatim copy preserved from canonical JSX:
//   - "SKUs · cost-stack tree" header
//   - "ASY all-complete / partial / empty" summary pips
//   - "{N} of {M} leaves have complete specs" right-summary
//   - "+ Add leaf from library →" + "browse globally-reusable
//     components" affordance footer

import type { AssemblyTree } from "@/lib/assembly-tree";
import { AsyRow } from "./asy-row";

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
            HubSpot buttons + the "N SKUs · M assemblies" counter
            caption. Step 4 shipped the structural skeleton. */}
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
