"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateAssemblyNotes } from "@/app/actions/assemblies";

// Phase A.1 v2 impl-2 Step 8 — Per-ASY notes drawer + HAS NOTE chip
//
// Brief §5.2: "Per-SKU notes textarea with HAS NOTE chip (computed
// from `assemblies.internal_notes`)". The canonical CD prototype
// doesn't detail the notes-drawer UX; carried forward from R7b's
// per-SKU drawer pattern (notes-editor textarea + chip indicator).
//
// Split into two components:
//   - AsyNotesTrigger — renders inside .a1v2-asy-row alongside the
//     context-menu trigger; toggles the drawer panel open/close
//   - AsyNotesDrawerPanel — renders below the row (between the row
//     and the .a1v2-leaves); contains the textarea
//
// State (open/close) lives in the parent AsyRow client component
// so the trigger and panel can coordinate without lifting through
// context.
//
// Pattern 47 invariants (textarea):
//   - controlled (value bound to React state)
//   - per-keystroke local update (<16ms via setState)
//   - debounced server save (500ms after last keystroke)
//   - `disabled` attribute is `{disabled}` ONLY — never includes
//     `pending`. The "saving…" / "saved" status renders alongside
//     the textarea, not on it

const SAVE_DEBOUNCE_MS = 500;

export function AsyNotesTrigger({
  assemblyId,
  hasNote,
  open,
  onToggle,
}: {
  assemblyId: string;
  hasNote: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="a1v2-asy-notes-trigger"
      aria-expanded={open}
      aria-controls={`asy-notes-${assemblyId}`}
      aria-label={
        hasNote
          ? "ASY notes (notes present) — toggle drawer"
          : "ASY notes (no notes yet) — toggle drawer"
      }
    >
      Notes {open ? "⌃" : "⌄"}
      {hasNote ? <span className="has-note-chip">HAS NOTE</span> : null}
    </button>
  );
}

export function AsyNotesDrawerPanel({
  assemblyId,
  initialNotes,
  disabled,
}: {
  assemblyId: string;
  initialNotes: string | null;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<string>(initialNotes ?? "");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local draft when initialNotes changes from a snapshot prop
  // (e.g., realtime reconcile updated the source-of-truth value).
  // Only adopt the new prop when user isn't currently typing — if a
  // save is in flight or recently committed, prefer the local draft
  // to avoid interrupting the user.
  useEffect(() => {
    if (pending) return;
    setDraft(initialNotes ?? "");
  }, [initialNotes, pending]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setDraft(v);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const fd = new FormData();
      fd.set("assemblyId", assemblyId);
      fd.set("internalNotes", v);
      startTransition(async () => {
        setError(null);
        const result = await updateAssemblyNotes(fd);
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setSavedAt(Date.now());
      });
    }, SAVE_DEBOUNCE_MS);
  }

  return (
    <div
      id={`asy-notes-${assemblyId}`}
      className="a1v2-asy-notes-drawer"
      role="region"
      aria-label="ASY notes editor"
    >
      <label
        className="a1v2-asy-notes-label"
        htmlFor={`asy-notes-ta-${assemblyId}`}
      >
        Internal notes
        <span className="meta">PM-only · not on customer PDF</span>
      </label>
      <textarea
        id={`asy-notes-ta-${assemblyId}`}
        value={draft}
        onChange={handleChange}
        disabled={disabled}
        placeholder="Notes about this ASY — sourcing dependencies, customer phone notes, R&D blockers…"
        rows={3}
      />
      <div className="a1v2-asy-notes-meta">
        {pending ? (
          <span className="saving">saving…</span>
        ) : error ? (
          <span className="error" role="alert">
            {error}
          </span>
        ) : savedAt !== null ? (
          <span className="saved">saved</span>
        ) : null}
      </div>
    </div>
  );
}
