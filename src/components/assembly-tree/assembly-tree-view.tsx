// Phase A.1 v2 impl-2 Step 4-8 — ASY tree view (server wrapper)
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// `TreeView` (lines 117-175). Top-level card + summary header +
// .a1v2-tree map of AsyRow children.
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
//
// slice-library-first-creation-flow Step 6 — Setup card-head
// simplification per locked Q1 + Q2 dispositions. Three coequal
// buttons (+ Add product · ↗ Pull from HubSpot · + Add leaf from
// library →) consolidate to a single `+ Add component →` primary
// CTA that opens LibraryBrowseModal. The library modal is the
// canonical entry point for all add-to-quote workflows:
//   - Find existing library leaf → attach (existing)
//   - Create new product (LEAF or ASY) → stacked AddProductModal
//   - Refresh from HubSpot → inline progress band in modal header
// Footer `.a1v2-library-affordance` block removed entirely
// (Q2 — single entry point).

import type { AssemblyTree } from "@/lib/assembly-tree";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { AssemblyTreeBody } from "./assembly-tree-body";
import { LibraryBrowseTrigger } from "@/components/library/library-browse-trigger";

export function AssemblyTreeView({
  tree,
  editable,
  projectId,
  quoteId,
  assemblyTypes,
  leafTypes,
  leafTypesForFilter,
  permissions,
}: {
  tree: AssemblyTree;
  editable: boolean;
  projectId: string;
  quoteId: string;
  assemblyTypes: { id: string; name: string }[];
  leafTypes: LeafSpecEntryProductType[];
  leafTypesForFilter: { id: string; name: string; placeholder: boolean }[];
  // slice-library-first-creation-flow Step 3 — threaded through to
  // LibraryBrowseTrigger → LibraryBrowseModal for the gated
  // "+ Create new product" + "↗ Refresh from HubSpot" affordances.
  // Page-level fetcher reads user.canCreateLeaves via ensureUser.
  permissions: { canCreateLeaves: boolean };
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
    <div className="a1v2-card r-a1v2-card-tree">
      <div className="a1v2-card-head">
        <h3>
          SKUs <em>· cost-stack tree</em>
        </h3>
        <div className="actions">
          {/* Step 10 — "N SKUs · M assemblies" counter caption per
              brief §5.2. Reads off the same totals the tree-summary
              header uses (totalSkus = leaf children across all
              assemblies; totalAssemblies = top-level ASY count). */}
          <span className="meta" aria-label="SKU + assembly count caption">
            {tree.totalSkus} {tree.totalSkus === 1 ? "SKU" : "SKUs"}
            {" · "}
            {tree.totalAssemblies}{" "}
            {tree.totalAssemblies === 1 ? "assembly" : "assemblies"}
          </span>
          {/* slice-library-first-creation-flow Step 6 — single
              primary CTA. Opens LibraryBrowseModal which hosts
              search + attach existing + create new (stacked
              AddProductModal) + refresh from HubSpot (inline
              progress band). */}
          <LibraryBrowseTrigger
            quoteId={quoteId}
            projectId={projectId}
            editable={editable}
            assemblies={tree.assemblies.map((a) => ({
              id: a.id,
              sku: a.sku,
              name: a.name,
            }))}
            leafTypes={leafTypesForFilter}
            assemblyTypes={assemblyTypes}
            fullLeafTypes={leafTypes}
            permissions={permissions}
          />
        </div>
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

      <AssemblyTreeBody
        tree={tree}
        editable={editable}
        projectId={projectId}
        quoteId={quoteId}
      />
    </div>
  );
}
