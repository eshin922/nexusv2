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
import { indexClientTargets, type ClientTargetRow } from "@/lib/client-target";
import type { TargetTier } from "./client-target";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { AssemblyTreeBody } from "./assembly-tree-body";
import { LibraryBrowseTrigger } from "@/components/library/library-browse-trigger";
import { CreateItemGroupTrigger } from "./create-item-group-trigger";

export function AssemblyTreeView({
  tree,
  editable,
  projectId,
  quoteId,
  itemGroupCategories,
  leafTypes,
  permissions,
  tiers,
  clientTargets,
}: {
  tree: AssemblyTree;
  editable: boolean;
  projectId: string;
  quoteId: string;
  itemGroupCategories: { id: string; name: string }[];
  leafTypes: LeafSpecEntryProductType[];
  // slice-library-first-creation-flow Step 3 — threaded through to
  // LibraryBrowseTrigger → LibraryBrowseModal for the gated
  // "+ Create new product" + "↗ Refresh from HubSpot" affordances.
  // Page-level fetcher reads user.canCreateLeaves via ensureUser.
  permissions: { canCreateLeaves: boolean };
  /** Tier list for the Client Target drawer, in display order. */
  tiers: ReadonlyArray<TargetTier>;
  /** Raw Client Target rows for the quote. Indexed here, resolved per row. */
  clientTargets: ReadonlyArray<ClientTargetRow>;
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

  // Per CD's tree summary: "X of Y products have complete specs". Counts BOTH
  // structures — a Direct Product's spec completeness matters exactly as much
  // as a grouped one's, and omitting it would overstate readiness.
  const totalLeaves = tree.totalSkus;
  const completeLeaves =
    tree.assemblies.reduce(
      (sum, a) =>
        sum +
        a.children.filter((c) => c.specCompleteness?.kind === "complete").length,
      0,
    ) +
    tree.directProducts.filter((p) => p.specCompleteness?.kind === "complete")
      .length;

  // Indexed ONCE for the whole tree. Every row then resolves from the same
  // governed structure rather than filtering a flat list per row.
  const targetsByUnit = indexClientTargets(clientTargets);

  const assemblyTargets = tree.assemblies.map((a) => ({
    id: a.id,
    sku: a.sku,
    name: a.name,
    leafCount: a.children.length,
  }));

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
          <span className="meta" aria-label="product and item group count">
            {tree.totalSkus} {tree.totalSkus === 1 ? "product" : "products"}
            {" · "}
            {tree.totalAssemblies}{" "}
            {tree.totalAssemblies === 1 ? "item group" : "item groups"}
          </span>
          {/* TWO PEER STRUCTURAL ACTIONS, at equal visual weight.

              + Add Product        browse the library, attach an existing
                                   product as a standalone Direct Product.
              + Add Direct Service browse the library's SERVICE entries and
                                   attach one as a top-level service line. A
                                   service is never an item group member
                                   (BV-012 §5.c) — the gate refuses it.
              + Create Item Group  create quote-local grouping structure. Not a
                                   product; nothing is written to the library.

              Both are primary. A ghost beside a filled button is not a peer —
              it reads as secondary chrome, which is how the grouped choice went
              unnoticed even after it became reachable (B-1, OW-4).

              ADDING PRODUCTS INTO A GROUP IS NOT HERE. It belongs to a specific
              Item Group, so it lives on that group's row, where the operator
              has already named the destination by choosing which row to act on.
              A quote-level entry had to ask for the destination in a menu, and
              on a quote with no groups it could not be answered at all. */}
          <LibraryBrowseTrigger
            mode="direct"
            quoteId={quoteId}
            projectId={projectId}
            editable={editable}
            assemblies={assemblyTargets}
            fullLeafTypes={leafTypes}
            permissions={permissions}
          />
          {/* THREE peer sellable units — BV-012 §5.b. The operator states
              what the customer is buying; nothing is inferred from which cost
              fields later hold values. */}
          <LibraryBrowseTrigger
            mode="service"
            quoteId={quoteId}
            projectId={projectId}
            editable={editable}
            assemblies={assemblyTargets}
            fullLeafTypes={leafTypes}
            permissions={permissions}
          />
          <CreateItemGroupTrigger
            quoteId={quoteId}
            editable={editable}
            itemGroupCategories={itemGroupCategories}
          />
        </div>
      </div>

      <div className="a1v2-tree-summary">
        <span className="pip complete" />{" "}
        <strong>{counts.good}</strong> item groups complete
        <span style={{ color: "var(--ink-4)" }}>·</span>
        <span className="pip partial" />{" "}
        <strong>{counts.warn}</strong> partial
        <span style={{ color: "var(--ink-4)" }}>·</span>
        <span className="pip empty" />{" "}
        <strong>{counts.empty}</strong> empty
        <span className="right">
          {completeLeaves} of {totalLeaves} products have complete specs
        </span>
      </div>

      <AssemblyTreeBody
        tree={tree}
        editable={editable}
        projectId={projectId}
        quoteId={quoteId}
        assemblies={assemblyTargets}
        tiers={tiers}
        targetsByUnit={targetsByUnit}
        fullLeafTypes={leafTypes}
        permissions={permissions}
      />
    </div>
  );
}
