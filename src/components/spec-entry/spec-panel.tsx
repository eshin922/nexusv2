"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { LeafSpecField } from "@/lib/leaf-spec-loader";
import { resolveFieldControl } from "@/lib/spec-field-control";
/**
 * The save, supplied by the caller.
 *
 * Declared structurally and passed in rather than imported here, so this
 * module does not pull a server action -- and with it the database -- into
 * every graph that renders a field. That is also what makes the behaviour
 * testable: what happens to keystrokes landing WHILE a save is in flight
 * cannot be observed without controlling when the save resolves.
 */
export type SpecSaveService = (
  formData: FormData,
) => Promise<
  { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } }
>;

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
//   - a completed save NEVER writes the server snapshot back over the input.
//     The snapshot is older than anything typed while the request was in
//     flight, and putting it back drops those keystrokes silently.
//   - "saving…" / "saved" status renders alongside the cell, not on it
//
// Per-field debounced save: each field has its own timeout. When
// PMs hop between fields rapidly, each field's pending save fires
// independently. No global "saving" state — per-cell granularity.

/**
 * Fields with text the operator has not left yet.
 *
 * "Done" closes the surface, and a field still under the cursor has not
 * blurred. Flushing through this registry writes it before the modal goes,
 * rather than relying on the incidental blur a click produces.
 */
const pendingSpecCommits = new Set<() => Promise<boolean>>();

/**
 * Commit every field that has uncommitted text, and report whether they all
 * landed. Safe to call repeatedly.
 *
 * Returns false if any save failed. The caller is closing a surface on the
 * strength of this, so it has to wait for the answer rather than fire the
 * writes and assume.
 */
export async function flushPendingSpecEdits(): Promise<boolean> {
  const results = await Promise.all([...pendingSpecCommits].map((c) => c()));
  return results.every(Boolean);
}

export function SpecPanel({
  title,
  fields,
  scope,
  leafId,
  initialValues,
  filled,
  total,
  readOnly,
  save,
}: {
  title: string;
  fields: LeafSpecField[];
  scope: { quoteId: string } | { library: true };
  leafId: string;
  initialValues: Record<string, unknown>;
  filled: number;
  total: number;
  readOnly: boolean;
  save: SpecSaveService;
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
            save={save}
          />
        ))}
      </div>
    </div>
  );
}

export function SpecCell({
  scope,
  field,
  leafId,
  initialValue,
  readOnly,
  save,
}: {
  field: LeafSpecField;
  scope: { quoteId: string } | { library: true };
  leafId: string;
  initialValue: string;
  readOnly: boolean;
  save: SpecSaveService;
}) {
  const [draft, setDraft] = useState<string>(initialValue);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── WHAT THE PROP LAST SAID, AND WHERE THE OPERATOR HAS GOT TO ──────────
  //
  // `initialValue` is an RSC snapshot: it means "this was the value when the
  // parent last rendered", and says nothing about what has been typed since.
  const lastPropRef = useRef(initialValue);
  // The text on screen, readable synchronously. `draft` is state and lags a
  // render, which is too slow for a blur handler to act on.
  const latestRef = useRef(initialValue);
  // The last value a save was issued for. Anything else on screen is
  // uncommitted.
  const committedRef = useRef(initialValue);
  // Saves issued and not yet answered.
  const inFlightRef = useRef(0);
  // The outstanding save for whatever `committedRef` currently holds.
  //
  // "This value has been committed" and "this value is still being written"
  // are different facts, and treating them as one is what let Done close over
  // a save that had not answered yet.
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  // Values this field has itself sent and then moved past.
  //
  // A save triggers a revalidation, so its snapshot comes back as a prop --
  // and it can arrive after a LATER edit has already been sent. Adopting it
  // would put the field back to a value the operator has already replaced,
  // which is the same reversion as before wearing a different hat.
  const supersededRef = useRef<Set<string>>(new Set());

  // Adopt an EXTERNAL change only, and never over uncommitted text.
  //
  // The prop must actually have CHANGED. An earlier version listed `pending`
  // here and reset the draft whenever a save finished, which wrote the
  // snapshot back over whatever had been typed in the meantime.
  useEffect(() => {
    if (initialValue === lastPropRef.current) return;
    lastPropRef.current = initialValue;
    // Uncommitted typing is newer than any snapshot.
    if (latestRef.current !== committedRef.current) return;
    // A save of ours is still out. Anything arriving now predates its answer,
    // so it cannot be a later state than what we last sent.
    if (inFlightRef.current > 0) return;
    // A late echo of something we already replaced.
    if (supersededRef.current.has(initialValue)) return;
    latestRef.current = initialValue;
    committedRef.current = initialValue;
    setDraft(initialValue);
  }, [initialValue]);

  // ── SAVING HAPPENS WHEN THE OPERATOR LEAVES THE FIELD ───────────────────
  //
  // Not while they are typing. A value like "129.1 x 92.3 x 13.5" is entered
  // in pieces with pauses and corrections, and every pause used to fire a
  // request whose response then argued with the keyboard. Committing on blur
  // means the field is written once, with what the operator actually finished
  // typing.
  const commit = useCallback(async (): Promise<boolean> => {
    const value = latestRef.current;
    if (value === committedRef.current) {
      // Nothing new to send -- but a save for exactly this value may still be
      // out. Returning true here reported success for a request that had not
      // answered, which is what Done was closing on.
      return inFlightSaveRef.current ?? true;
    }
    // What we are moving away from is now a stale snapshot if it comes back.
    supersededRef.current.add(committedRef.current);
    committedRef.current = value;

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

    // Awaited, so "Done" can wait for it and close only if it worked -- and
    // held, so a second caller asking about the SAME value waits for this one
    // rather than being told it is already done.
    inFlightRef.current += 1;
    const run = (async (): Promise<boolean> => {
      let ok = true;
      await new Promise<void>((resolve) => {
        startTransition(async () => {
          setError(null);
          const result = await save(fd);
          if (!result.ok) {
            // Leave the text alone. It is what the operator entered and the
            // only copy -- reverting it would destroy the thing they would
            // otherwise retry. Clearing the committed marker is what makes
            // leaving the field again re-send it.
            committedRef.current = "\u0000never";
            setError(result.error.message);
            ok = false;
          } else {
            setSavedAt(Date.now());
          }
          inFlightRef.current -= 1;
          resolve();
        });
      });
      return ok;
    })();
    inFlightSaveRef.current = run;
    const ok = await run;
    // Only clear it if nothing newer has taken its place.
    if (inFlightSaveRef.current === run) inFlightSaveRef.current = null;
    return ok;
  }, [field.key, leafId, save, scope]);

  // Registered so "Done" can flush a field the operator is still inside.
  // Clicking Done blurs the input first in a browser, but that is a detail of
  // how the click happens rather than a guarantee -- and the close must not
  // race the write it triggers.
  // Registered ONCE, for the life of the field.
  //
  // Registering `commit` itself re-ran this on every render that changed its
  // identity -- `scope` is a fresh object literal at most call sites -- and
  // the cleanup then committed mid-keystroke, which is the behaviour this
  // whole change removes. The registration holds a stable wrapper; the ref
  // keeps it pointed at the current closure.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const entry = () => commitRef.current();
    pendingSpecCommits.add(entry);
    return () => {
      // Leaving the surface is leaving the field: an unmount with text still
      // uncommitted would otherwise drop it silently.
      void entry();
      pendingSpecCommits.delete(entry);
    };
  }, []);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const v = e.target.value;
    latestRef.current = v;
    setDraft(v);
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    // Enter commits a single-line field. In a textarea it is a newline and
    // must stay one.
    if (e.key === "Enter" && e.currentTarget.tagName !== "TEXTAREA") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  const control = resolveFieldControl(field);

  return (
    <div className={`a1v2-spec-cell${field.wide ? " wide" : ""}`}>
      <span className="lbl">{field.label}</span>
      {control === "textarea" ? (
        <textarea
          value={draft}
          onChange={handleChange}
          onBlur={() => void commit()}
          onKeyDown={handleKeyDown}
          disabled={readOnly}
          placeholder="—"
          rows={2}
        />
      ) : (
        <input
          type={control}
          value={draft}
          onChange={handleChange}
          onBlur={() => void commit()}
          onKeyDown={handleKeyDown}
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
