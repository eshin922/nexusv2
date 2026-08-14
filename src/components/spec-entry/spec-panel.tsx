"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { LeafSpecField } from "@/lib/leaf-spec-loader";
import { updateLeafSpec } from "@/app/actions/leaf-specs";

// Phase A.1 v2 impl-3 Step 4-5 — SpecPanel field-grid renderer
// with per-field autosave (Pattern 47).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// SpecPanel (lines 384-405). .a1v2-spec-panel > .panel-head + .a1v2-
// spec-grid > .a1v2-spec-cell (.wide modifier for wide fields).
// Input vs textarea selected by field-key heuristic: keys including
// "additional" / "description" / "packout" → textarea (multi-line
// supplementary fields); everything else → input (single-line).
//
// Pattern 47 invariants:
//   - controlled inputs (value bound to local state)
//   - per-keystroke local update (<16ms)
//   - debounced server save (500ms after last keystroke per field)
//   - `disabled={readOnly}` ONLY — never `disabled={readOnly || pending}`
//     on inputs/textareas (causes focus loss on the saving frame)
//   - "saving…" / "saved" status renders alongside the cell, not on it
//
// Per-field debounced save: each field has its own timeout. When
// PMs hop between fields rapidly, each field's pending save fires
// independently. No global "saving" state — per-cell granularity.

const SAVE_DEBOUNCE_MS = 500;

export function SpecPanel({
  title,
  fields,
  scope,
  leafId,
  initialValues,
  filled,
  total,
  readOnly,
}: {
  title: string;
  fields: LeafSpecField[];
  scope: { quoteId: string } | { library: true };
  leafId: string;
  initialValues: Record<string, unknown>;
  filled: number;
  total: number;
  readOnly: boolean;
}) {
  return (
    <div className="a1v2-spec-panel">
      <div className="panel-head">
        <h4>{title}</h4>
        <span className="meta">
          {filled} of {total} fields
        </span>
      </div>
      <div className="a1v2-spec-grid">
        {fields.map((f) => (
          <SpecCell
            key={f.key}
            field={f}
            scope={scope}
            leafId={leafId}
            initialValue={normalizeInitial(initialValues[f.key])}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

function SpecCell({
  scope,
  field,
  leafId,
  initialValue,
  readOnly,
}: {
  field: LeafSpecField;
  scope: { quoteId: string } | { library: true };
  leafId: string;
  initialValue: string;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<string>(initialValue);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from server-snapshot prop when value changes externally
  // (e.g., realtime reconcile). Don't clobber user typing if a
  // save is in flight.
  useEffect(() => {
    if (pending) return;
    setDraft(initialValue);
  }, [initialValue, pending]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function scheduleSave(value: string) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const fd = new FormData();
      fd.set("leafId", leafId);
      // The scope travels with every write. A form that omitted it would be
      // refused rather than defaulted.
      if ("library" in scope) fd.set("scope", "library");
      else {
        fd.set("scope", "quote");
        fd.set("quoteId", scope.quoteId);
      }
      fd.set("fieldKey", field.key);
      fd.set("value", value);
      startTransition(async () => {
        setError(null);
        const result = await updateLeafSpec(fd);
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setSavedAt(Date.now());
      });
    }, SAVE_DEBOUNCE_MS);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const v = e.target.value;
    setDraft(v);
    scheduleSave(v);
  }

  // Field-key heuristic per canonical line 395-398: wide multi-line
  // fields trigger textarea rendering. Everything else is single-line.
  const isMultiline =
    field.key.includes("additional") ||
    field.key.includes("description") ||
    field.key.includes("packout");

  return (
    <div className={`a1v2-spec-cell${field.wide ? " wide" : ""}`}>
      <span className="lbl">{field.label}</span>
      {isMultiline ? (
        <textarea
          value={draft}
          onChange={handleChange}
          disabled={readOnly}
          placeholder="—"
          rows={2}
        />
      ) : (
        <input
          type="text"
          value={draft}
          onChange={handleChange}
          disabled={readOnly}
          placeholder="—"
        />
      )}
      <SpecCellStatus
        pending={pending}
        savedAt={savedAt}
        error={error}
      />
    </div>
  );
}

function SpecCellStatus({
  pending,
  savedAt,
  error,
}: {
  pending: boolean;
  savedAt: number | null;
  error: string | null;
}) {
  if (error) {
    return (
      <span className="a1v2-spec-status error" role="alert">
        {error}
      </span>
    );
  }
  if (pending) {
    return <span className="a1v2-spec-status saving">saving…</span>;
  }
  if (savedAt !== null) {
    return <span className="a1v2-spec-status saved">saved</span>;
  }
  return null;
}

function normalizeInitial(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
}
