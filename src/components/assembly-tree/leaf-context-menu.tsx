"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { detachAssemblyLeaf } from "@/app/actions/assemblies";

// Phase A.1 v2 impl-2 Step 7 — LEAF context menu (scenario ②)
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// LeafContextMenu (lines 262-276). Items:
//   - Edit specs (primary, accent-tinted) — the load-bearing action
//     per CD designer notes §3.2 ("Leaf context menu owns Edit specs")
//   - [sep] Move up / Move down / Assign to parent ASY / View library
//          record
//   - [sep] Delete from this ASY (destructive, "library leaf stays"
//          caption)
//
// Step 7 wires:
//   - ⋯ toggles menu open
//   - Click-outside + Escape dismiss
//   - Delete fires detachAssemblyLeaf server action (junction-only;
//     library leaf untouched)
//
// Inert until later phases / steps:
//   - Edit specs → impl-3 (Phase 3 Spec entry surface; brief §5.3)
//   - Move up/down → Step 9 (drag-to-reorder primary path; menu can
//                   ride keyboard-arrow accessibility on top)
//   - Assign to parent ASY → follow-up (cross-ASY junction-move
//                            workflow design TBD)
//   - View library record → impl-5 (Phase 5 library browse + reps)

export function LeafContextMenu({
  junctionId,
  leafName,
  disabled,
}: {
  junctionId: string;
  leafName: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      fd.set("junctionId", junctionId);
      startTransition(async () => {
        setError(null);
        const result = await detachAssemblyLeaf(fd);
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
        aria-label={`LEAF ${leafName} context menu`}
      >
        ⋯
      </button>
      {open && (
        <div
          className="a1v2-context-menu"
          role="menu"
          aria-label="Leaf actions"
        >
          <div className="header">Leaf actions</div>
          <button
            type="button"
            className="item accent"
            role="menuitem"
            disabled
            aria-disabled="true"
            title="Spec entry surface ships in impl-3"
          >
            Edit specs
          </button>
          <div className="sep" />
          <button
            type="button"
            className="item"
            role="menuitem"
            disabled
            aria-disabled="true"
            title="Drag-to-reorder is the primary path (Step 9)"
          >
            Move up
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            disabled
            aria-disabled="true"
            title="Drag-to-reorder is the primary path (Step 9)"
          >
            Move down
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            disabled
            aria-disabled="true"
            title="Cross-ASY junction-move workflow — design TBD"
          >
            Assign to parent ASY
          </button>
          <button
            type="button"
            className="item"
            role="menuitem"
            disabled
            aria-disabled="true"
            title="Library browse surface ships in impl-5"
          >
            View library record
          </button>
          <div className="sep" />
          <button
            type="button"
            className="item bad"
            role="menuitem"
            onClick={handleDelete}
            disabled={pending}
          >
            {confirmingDelete ? (
              "Confirm — detach from ASY"
            ) : (
              <>
                Delete from this ASY{" "}
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--mono)",
                    fontSize: 9,
                    color: "var(--ink-4)",
                  }}
                >
                  library leaf stays
                </span>
              </>
            )}
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
