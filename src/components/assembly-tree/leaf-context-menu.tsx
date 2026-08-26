"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { detachAssemblyLeaf } from "@/app/actions/assemblies";
import { describeAttachmentRemoval } from "@/app/actions/quote-products";

// Phase A.1 v2 impl-2 Step 7 — LEAF context menu (scenario ②)
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// LeafContextMenu (lines 262-276). Items:
//   - Edit specs (primary, accent-tinted) — the load-bearing action
//     per CD designer notes §3.2 ("Leaf context menu owns Edit specs")
//   - [sep] Move up / Move down / Move to another item group / View library
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
//   - Move to another item group → follow-up (cross-ASY junction-move
//                            workflow design TBD)
//   - View library record → impl-5 (Phase 5 library browse + reps)

export function LeafContextMenu({
  junctionId,
  quoteLeafId,
  leafName,
  editSpecsHref,
  disabled,
  moveDestinations,
  onMove,
}: {
  junctionId: string;
  /** OD-017 canonical identity — what the governed move and the dependent
   *  count are both keyed on. NOT `junctionId`, which is the legacy
   *  grouped-membership id and lives in a different id space. */
  quoteLeafId: string;
  leafName: string;
  editSpecsHref: string;
  disabled: boolean;
  /** Item Groups other than this one, plus quote level. */
  moveDestinations?: ReadonlyArray<{
    target: string;
    label: string;
    position: number;
  }>;
  onMove?: (quoteLeafId: string, target: string, position: number) => void;
}) {
  const [movePicker, setMovePicker] = useState(false);
  const [removalNote, setRemovalNote] = useState<string | null>(null);
  const [removalUnknown, setRemovalUnknown] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Rendered only when there is somewhere to go AND something to do it with.
  // A command with no destinations is the B-4B failure mode again.
  const editableMove =
    !disabled && !!onMove && (moveDestinations?.length ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setConfirmingDelete(false);
      setMovePicker(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmingDelete(false);
        setMovePicker(false);
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
    if (!confirmingDelete) {
      // Ask what this destroys BEFORE arming the confirm. Removing a member
      // cascades its packaging lines, per-cell overrides, client targets,
      // staged lifts and freight membership, and the caption here used to say
      // only "library leaf stays" — true about the library, silent about the
      // quote, and the one line in the interaction that made a destructive act
      // read as safe.
      setConfirmingDelete(true);
      setRemovalNote(null);
      setRemovalUnknown(false);
      const fd = new FormData();
      fd.set("quoteLeafId", quoteLeafId);
      void describeAttachmentRemoval(fd).then((r) => {
        // A failed count must NOT present as "nothing at risk". Say the check
        // did not run; the operator can then decide with that knowledge rather
        // than with a false reassurance.
        if (!r.ok) setRemovalUnknown(true);
        else setRemovalNote(r.data.sentence);
      });
      return;
    }
    {
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
          <Link
            href={editSpecsHref}
            className="item accent"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            {/* Same act as the top-level row's, so the same label. A member
                is always a product today, but branching the noun by row type is
                what produced the service mismatch one level up. */}
            Edit library specs
          </Link>
          {/* B-4B removed four disabled items, correctly: none was a
              capability, and "Move to another item group had no writer
              anywhere in the action layer" was TRUE WHEN WRITTEN.

              It is false now. `moveProductMembership` exists, preserves
              `quote_leaves.id`, repoints every dependent economic row, and has
              run 46 times. The rationale outlived its facts, and the effect
              was that the only route into a group was a drag — no keyboard, no
              menu — while Remove-and-re-add sat one item below, discoverable
              and destructive. The safe route being harder to reach than the
              destructive one is the whole defect.

              Restored against the existing writer. Not a new capability: a
              second door onto the certified one. */}
          {editableMove && (
            <>
              <div className="sep" />
              <button
                type="button"
                className="item"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={movePicker}
                onClick={() => setMovePicker((v) => !v)}
              >
                Move to another item group...
              </button>
              {movePicker &&
                moveDestinations!.map((d) => (
                  <button
                    key={d.target}
                    type="button"
                    className="item"
                    role="menuitem"
                    style={{ paddingLeft: 26 }}
                    onClick={() => {
                      setOpen(false);
                      setMovePicker(false);
                      onMove!(quoteLeafId, d.target, d.position);
                    }}
                  >
                    {d.label}
                  </button>
                ))}
            </>
          )}
          <div className="sep" />
          <button
            type="button"
            className="item bad"
            role="menuitem"
            onClick={handleDelete}
            disabled={pending}
          >
            {confirmingDelete
              ? "Confirm — remove from item group"
              : "Remove from item group"}
          </button>
          {/* What the removal actually costs, said before the second click.
              The caption this replaces read "library leaf stays" — true about
              the LIBRARY and silent about the QUOTE, which made the only line
              in the interaction the one that reassured. */}
          {confirmingDelete && (
            <div
              className="item"
              role="note"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 9.5,
                lineHeight: 1.5,
                color: removalUnknown ? "var(--warn)" : "var(--bad)",
                whiteSpace: "normal",
                cursor: "default",
              }}
            >
              {removalUnknown
                ? "Could not check what else this deletes. Nothing is confirmed about that either way."
                : (removalNote ?? "Checking what else this deletes...")}
              <div style={{ color: "var(--ink-4)", marginTop: 3 }}>
                The library product itself is untouched.
              </div>
            </div>
          )}
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
