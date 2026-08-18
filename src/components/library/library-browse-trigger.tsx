"use client";

import { useState } from "react";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { LibraryBrowseModal, type AssemblyTarget } from "./library-browse-modal";

// Phase A.1 v2 impl-5 Step 4 — Library browse trigger.
//
// Lightweight client component holding the modal's open/close
// state + button rendering. Same shape as the (deleted)
// AddProductTrigger / PullFromHubSpotTrigger that the slice-
// library-first-creation-flow replaced.
//
// slice-library-first-creation-flow Step 3 — extended props thread
// projectId + itemGroupCategories + fullLeafTypes + permissions through
// for the nested AddProductModal launched from "+ Create new
// product" inside the library modal's empty-states.
//
// slice-library-first-creation-flow Step 6 — promoted to canonical
// + Add component → primary CTA per locked Q1 disposition.
// Relocated from the .a1v2-library-affordance footer to the
// SKUs card-head .actions cluster as the sole add-to-quote entry
// point. The prior + Add product + ↗ Pull from HubSpot buttons
// are removed; Pull lives inside the library modal header as an
// inline progress band (Step 5). Button copy + visual register
// shift: `a1v2-btn ghost sm` → `a1v2-btn primary sm`; `+ Add
// leaf from library →` → `+ Add component →`.

export function LibraryBrowseTrigger({
  mode,
  quoteId,
  projectId,
  editable,
  assemblies,
  initialTargetAssemblyId,
  label,
  className,
  fullLeafTypes,
  permissions,
}: {
  /**
   * Which structure this button creates. The two are PEERS — `direct` never
   * becomes `group` because one product was added, and `group` never collapses
   * to `direct` because it holds only one.
   */
  mode: "direct" | "group" | "service";
  quoteId: string;
  projectId: string;
  editable: boolean;
  assemblies: AssemblyTarget[];
  /** Preselected destination — set when launched from an Item Group row. */
  initialTargetAssemblyId?: string;
  /** Overrides the default copy; the row-level control names its own action. */
  label?: string;
  /** Overrides the default button weight for non-card-head placements. */
  className?: string;
  fullLeafTypes: LeafSpecEntryProductType[];
  permissions: { canCreateLeaves: boolean };
}) {
  const [open, setOpen] = useState(false);
  const isDirect = mode === "direct";
  const isService = mode === "service";
  // Direct Service is a peer sellable unit, not a variant of Add Product, so
  // it carries the same primary weight (BV-012 §5.b). A ghost beside two
  // filled buttons would read as secondary chrome — the exact treatment that
  // made the grouped choice go unnoticed even after it became reachable.
  const isPrimary = isDirect || isService;

  return (
    <>
      <button
        type="button"
        className={className ?? `a1v2-btn ${isPrimary ? "primary" : "ghost"} sm`}
        onClick={() => setOpen(true)}
        disabled={!editable}
        aria-disabled={!editable}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          !editable
            ? "Quote is not draft — editing disabled"
            : isService
              ? "Sell a service on its own line — formulation, filling, pack-out, testing"
              : isDirect
                ? "Add a single product to this quote"
                : "Add products into an existing item group"
        }
      >
        {label ??
          (isService
            ? "+ Add Direct Service"
            : isDirect
              ? "+ Add Product"
              : "+ Add to Item Group")}
      </button>
      <LibraryBrowseModal
        mode={mode}
        initialTargetAssemblyId={initialTargetAssemblyId}
        open={open}
        onClose={() => setOpen(false)}
        quoteId={quoteId}
        projectId={projectId}
        assemblies={assemblies}
        fullLeafTypes={fullLeafTypes}
        permissions={permissions}
      />
    </>
  );
}
