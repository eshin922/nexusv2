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
//   - the Products section header
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
import type { LibraryPermissions } from "@/lib/permissions/library-product";
import type { ComponentChargeKey } from "@/lib/commercial-recovery/registry";
import type { ProductAssociableServiceIdentity } from "@/lib/product-structure/service-association";

export function AssemblyTreeView({
  tree,
  editable,
  projectId,
  quoteId,
  itemGroupCategories,
  leafTypes,
  permissions,
  existingComponentCharges,
  suggestedChargesByProductType,
  suggestedServicesByProductType,
  associatedServiceLeaves,
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
  permissions: LibraryPermissions;
  /**
   * Charges each component already owns — OD-032.
   *
   * Threaded rather than fetched here: the tree is a client component and this
   * is server state. Carried as IDENTITY (instance, type, label, owner) rather
   * than a count by type, because the sheet needs to know both whether the type
   * is already present AND which labels exist to be distinguished from.
   */
  existingComponentCharges?: ReadonlyArray<{
    chargeInstanceId: string;
    quoteLeafId: string;
    chargeKey: string;
    label: string | null;
  }>;
  /** Advisory rules keyed by HubSpot's raw hs_product_type value. */
  suggestedChargesByProductType: Record<string, ComponentChargeKey[]>;
  suggestedServicesByProductType: Record<string, ProductAssociableServiceIdentity[]>;
  associatedServiceLeaves: ReadonlyArray<{ id: string; serviceIdentity: string }>;
  /** Tier list for the Client Target drawer, in display order. */
  tiers: ReadonlyArray<TargetTier>;
  /** Raw Client Target rows for the quote. Indexed here, resolved per row. */
  clientTargets: ReadonlyArray<ClientTargetRow>;
}) {
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
    <div className="setup-wizard-quote-items">
      <AssemblyTreeBody
        tree={tree}
        editable={editable}
        projectId={projectId}
        quoteId={quoteId}
        assemblies={assemblyTargets}
        itemGroupCategories={itemGroupCategories}
        tiers={tiers}
        targetsByUnit={targetsByUnit}
        fullLeafTypes={leafTypes}
        permissions={permissions}
        existingComponentCharges={existingComponentCharges}
        suggestedChargesByProductType={suggestedChargesByProductType}
        suggestedServicesByProductType={suggestedServicesByProductType}
        associatedServiceLeaves={associatedServiceLeaves}
      />
    </div>
  );
}
