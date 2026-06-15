"use client";

import { useState } from "react";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { LibraryBrowseModal, type AssemblyTarget } from "./library-browse-modal";

// Phase A.1 v2 impl-5 Step 4 — Library browse trigger.
//
// Mirrors AddProductTrigger pattern: lightweight client component
// holding the modal's open/close state + button rendering. Lives
// in the .a1v2-library-affordance footer of the Setup tree (canonical
// position per qw_a1v2.jsx line 169-172).
//
// slice-library-first-creation-flow Step 3 — extended props thread
// projectId + assemblyTypes + fullLeafTypes + permissions through
// for the nested AddProductModal launched from "+ Create new
// product" inside the library modal's empty-states.

export function LibraryBrowseTrigger({
  quoteId,
  projectId,
  editable,
  assemblies,
  leafTypes,
  assemblyTypes,
  fullLeafTypes,
  permissions,
}: {
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

  return (
    <>
      <button
        type="button"
        className="a1v2-btn ghost sm"
        onClick={() => setOpen(true)}
        disabled={!editable}
        aria-disabled={!editable}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          editable
            ? "Browse the library — search + attach to an ASY"
            : "Quote is not draft — editing disabled"
        }
      >
        + Add leaf from library →
      </button>
      <LibraryBrowseModal
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
