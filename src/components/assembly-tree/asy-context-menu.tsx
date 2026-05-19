"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteAssembly } from "@/app/actions/assemblies";

// Phase A.1 v2 impl-2 Step 6 — ASY context menu (scenario ③)
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// AsyContextMenu (lines 245-260). Items: Edit product · Duplicate ASY
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
//   - Duplicate ASY → follow-up (design choice: clone leaves or just
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
}: {
  assemblyId: string;
  assemblySku: string;
  disabled: boolean;
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
        aria-label={`ASY ${assemblySku} context menu`}
      >
        ⋯
      </button>
      {open && (
        <div
          className="a1v2-context-menu"
          role="menu"
          aria-label="ASY actions"
        >
          <div className="header">ASY actions</div>
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
            title="Duplicate ASY — design TBD (clone leaves or shell?)"
          >
            Duplicate ASY
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
            title="Specs live on leaves, not ASYs"
          >
            Edit specs{" "}
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
              : "Delete ASY · cascade"}
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
