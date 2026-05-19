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
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { AssemblyTreeBody } from "./assembly-tree-body";
import { AddProductTrigger } from "@/components/add-product/add-product-trigger";
import { LibraryBrowseTrigger } from "@/components/library/library-browse-trigger";

export function AssemblyTreeView({
  tree,
  editable,
  projectId,
  quoteId,
  assemblyTypes,
  leafTypes,
  leafTypesForFilter,
}: {
  tree: AssemblyTree;
  editable: boolean;
  projectId: string;
  quoteId: string;
  assemblyTypes: { id: string; name: string }[];
  leafTypes: LeafSpecEntryProductType[];
  leafTypesForFilter: { id: string; name: string; placeholder: boolean }[];
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
          {/* Pull from HubSpot — visual button per canonical
              qw_a1v2.jsx line 146. Inert until impl-4 wires the
              HubSpot pull flow against the new assemblies + leaves
              schema (legacy SkuSearchPanel writes against
              quote_skus; needs adaptation for Path A parallel
              structure). */}
          <button
            type="button"
            className="a1v2-btn ghost sm"
            disabled
            aria-disabled="true"
            title="Pull from HubSpot wires to the new ASY/LEAF schema in impl-4 (Phase 4)"
          >
            ↗ Pull from HubSpot
          </button>
          {/* + Add product — wired in impl-4 Step 8. Trigger button
              + modal host live in the AddProductTrigger client
              component; this server wrapper threads the prop chain. */}
          <AddProductTrigger
            quoteId={quoteId}
            projectId={projectId}
            editable={editable}
            assemblyTypes={assemblyTypes}
            leafTypes={leafTypes}
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

      {/* Phase A.1 v2 impl-5 Step 4 — wire the library browse modal
          trigger. Replaces the impl-2 inert button. Per-ASY attach
          target picked inside the modal (nexus extension vs canonical
          hardcoded "+ Add to GLW-30"). */}
      <div className="a1v2-library-affordance">
        <LibraryBrowseTrigger
          quoteId={quoteId}
          editable={editable}
          assemblies={tree.assemblies.map((a) => ({
            id: a.id,
            sku: a.sku,
            name: a.name,
          }))}
          leafTypes={leafTypesForFilter}
        />
        <span className="meta">browse globally-reusable components</span>
      </div>
    </div>
  );
}
