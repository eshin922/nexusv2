"use client";

import { useState } from "react";
import { AddProductModal } from "./add-product-modal";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";

// Phase A.1 v2 impl-4 Step 8 — Trigger button + modal host.
//
// Lives inside the AssemblyTreeView's card-head .actions cluster
// (canonical position per qw_a1v2.jsx line 147). Owns the modal's
// open/close state.
//
// The "↗ Pull from HubSpot" button stays as a sibling inert
// button rendered by AssemblyTreeView directly — that's an
// integration path (existing legacy HubSpot pull flow needs
// adaptation for new ASY/LEAF schema) deferred to impl-5 or a
// follow-up.

export function AddProductTrigger({
  quoteId,
  projectId,
  editable,
  assemblyTypes,
  leafTypes,
}: {
  quoteId: string;
  projectId: string;
  editable: boolean;
  assemblyTypes: { id: string; name: string }[];
  leafTypes: LeafSpecEntryProductType[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="a1v2-btn primary sm"
        onClick={() => setOpen(true)}
        disabled={!editable}
        aria-disabled={!editable}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          editable
            ? "Add a new product (ASY) or library leaf"
            : "Quote is not draft — editing disabled"
        }
      >
        + Add product
      </button>
      <AddProductModal
        quoteId={quoteId}
        projectId={projectId}
        open={open}
        onClose={() => setOpen(false)}
        assemblyTypes={assemblyTypes}
        leafTypes={leafTypes}
      />
    </>
  );
}
