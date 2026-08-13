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
// projectId + assemblyTypes + fullLeafTypes + permissions through
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
  leafTypes,
  assemblyTypes,
  fullLeafTypes,
  permissions,
}: {
  /**
   * Which structure this button creates. The two are PEERS — `direct` never
   * becomes `group` because one product was added, and `group` never collapses
   * to `direct` because it holds only one.
   */
  mode: "direct" | "group";
  quoteId: string;
  projectId: string;
  editable: boolean;
  assemblies: AssemblyTarget[];
  leafTypes: { id: string; name: string; placeholder: boolean }[];
  assemblyTypes: { id: string; name: string }[];
  fullLeafTypes: LeafSpecEntryProductType[];
  permissions: { canCreateLeaves: boolean };
}) {
  const [open, setOpen] = useState(false);
  const isDirect = mode === "direct";

  return (
    <>
      <button
        type="button"
        className={`a1v2-btn ${isDirect ? "primary" : "ghost"} sm`}
        onClick={() => setOpen(true)}
        disabled={!editable}
        aria-disabled={!editable}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          !editable
            ? "Quote is not draft — editing disabled"
            : isDirect
              ? "Add a single product to this quote"
              : "Group several products that are sold together"
        }
      >
        {isDirect ? "+ Add Product" : "+ Add Item Group"}
      </button>
      <LibraryBrowseModal
        mode={mode}
        open={open}
        onClose={() => setOpen(false)}
        quoteId={quoteId}
        projectId={projectId}
        assemblies={assemblies}
        leafTypes={leafTypes}
        assemblyTypes={assemblyTypes}
        fullLeafTypes={fullLeafTypes}
        permissions={permissions}
      />
    </>
  );
}
