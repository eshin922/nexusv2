"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteAssembly } from "@/app/actions/assemblies";
import { LibraryBrowseTrigger } from "@/components/library/library-browse-trigger";
import type { AssemblyTarget } from "@/components/library/library-browse-modal";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";

// Phase A.1 v2 impl-2 Step 6 — ASY context menu (scenario ③)
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// AsyContextMenu (lines 245-260). Items: Edit product · Duplicate item group
// · Move position · [sep] · Edit specs (disabled, "leaves only"
// caption) · [sep] · Delete ASY · cascade (destructive).
//
// Step 6 wires:
//   - Click ⋯ toggles menu open
//   - Click outside dismisses menu
//   - Escape key dismisses
//   - Delete fires deleteAssembly server action
//
// Inert until later phases / steps:
//   - Edit product → Phase 4 impl-4 (add-product modal mode toggle)
//   - Duplicate item group → follow-up (design choice: clone leaves or just
//                     shell; banked for impl-2 polish or v1.1+)
//   - Move position → Step 9 (drag-to-reorder is the primary path;
//                     menu keyboard-move can ride that infrastructure)
//
// Edit specs (disabled in canonical) renders disabled with the
// "leaves only" caption per CD designer notes §3.2 ("the disabled
// Edit specs row stays in the menu so PMs who try to edit specs at
// the ASY level get explicit feedback rather than missing affordance").

export function AsyContextMenu({
  assemblyId,
  assemblySku,
  disabled,
  quoteId,
  projectId,
  assemblies,
  fullLeafTypes,
  permissions,
}: {
  assemblyId: string;
  assemblySku: string;
  disabled: boolean;
  // §1 presentation closeout — the props "Add products" needs, threaded here
  // rather than to a button on the row. See the menu item below.
  quoteId: string;
  projectId: string;
  assemblies: AssemblyTarget[];
  fullLeafTypes: LeafSpecEntryProductType[];
  permissions: { canCreateLeaves: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss. Listener attached only when menu is open
  // to avoid sticky document handlers.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setConfirmingDelete(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmingDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function handleDelete() {
    if (confirmingDelete) {
      const fd = new FormData();
      fd.set("assemblyId", assemblyId);
      startTransition(async () => {
        setError(null);
        const result = await deleteAssembly(fd);
        if (!result.ok) {
          setError(result.error.message);
          setConfirmingDelete(false);
          return;
        }
        setOpen(false);
        setConfirmingDelete(false);
      });
    } else {
      setConfirmingDelete(true);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="context-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Item group ${assemblySku} context menu`}
      >
        ⋯
      </button>
      {open && (
        <div
          className="a1v2-context-menu"
          role="menu"
          aria-label="Item group actions"
        >
          <div className="header">Item group actions</div>
          {/* §1 presentation closeout · "+ Add products" MOVED here from the
              group's control band.

              It was a button on every Item Group row. One affordance repeated N
              times reads as a dense band of controls, and it made the
              surface-level entry stop looking like THE way to add a product.

              MOVED, NOT REMOVED — and the distinction is load-bearing. B-1 is a
              sign-off blocker whose repair is precisely that adding into a
              group lives on that group's row; the surface-level trigger is
              `mode="direct"` and its modal renders no destination picker in
              that mode, so deleting this would have left NO route into a group
              at all. The row keeps the route; the row no longer keeps a button.

              The destination is still pre-chosen — the operator named it by
              opening THIS group's menu — so the picker has nothing to ask. */}
          <LibraryBrowseTrigger
            mode="group"
            quoteId={quoteId}
            projectId={projectId}
            editable={!disabled}
            assemblies={assemblies}
            initialTargetAssemblyId={assemblyId}
            label="Add products…"
            className="item"
            fullLeafTypes={fullLeafTypes}
            permissions={permissions}
          />
          <button
            type="button"
            className="item"
            role="menuitem"
            disabled
            aria-disabled="true"
            title="Edit product flow lands in impl-4 (Add Product modal)"
          >
            Edit product
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            disabled
            aria-disabled="true"
            title="Duplicate item group — design TBD (clone products or shell?)"
          >
            Duplicate item group
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            disabled
            aria-disabled="true"
            title="Drag-to-reorder is the primary path (Step 9)"
          >
            Move position
          </button>
          <div className="sep" />
          <div
            className="item disabled"
            role="menuitem"
            aria-disabled="true"
            title="Specs live on library entries, not item groups"
          >
            Edit library specs{" "}
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--mono)",
                fontSize: 9,
                color: "var(--ink-4)",
              }}
            >
              leaves only
            </span>
          </div>
          <div className="sep" />
          <button
            type="button"
            className="item bad"
            role="menuitem"
            onClick={handleDelete}
            disabled={pending}
          >
            {confirmingDelete
              ? "Confirm delete — cascade"
              : "Delete item group · cascade"}
          </button>
          {error ? (
            <div
              role="alert"
              style={{
                padding: "6px 10px",
                color: "var(--bad)",
                fontSize: 11,
                fontFamily: "var(--mono)",
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
