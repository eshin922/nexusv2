"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateQuoteNotes } from "@/app/actions/quotes";
import { runGoverned } from "@/lib/governed-action";

// Slice RI.9 §6 step 7 — Pushback 2 disposition.
//
// "Edit notes" affordance on Customer view (Quote) renders as a
// center-anchored modal overlay, NOT a jump-to-Setup. PM stays
// on the surface for the edit-and-send loop. Closing the modal
// returns to Customer view with no breadcrumb shuffle.
//
// RI.9 step 10 smoke: initial implementation bottom-anchored the
// dialog (drawer pattern); recentered to standard modal position
// because brief §4.2 didn't pin position and desktop convention
// for a discrete edit dialog is center-anchored with backdrop.
// File name retained for git history; component is a modal in
// shape.
//
// Scope: edits ONLY `quote.customerFacingNotes`. Internal notes
// stay on Setup; customer-facing notes is what the PM actually
// reviews on this surface (they render in the PDF Notes block
// under "Notes" header).
//
// Save pattern: blur-or-⌘Enter autosave, matching the existing
// quote notes flow. Plain Enter is reserved for newlines in the
// textarea. The shared `updateQuoteNotes` action takes both notes
// fields; we pass `internalNotes` through unchanged so a
// customer-notes edit doesn't clobber internal notes.
//
// Quote status guard: only drafts are editable (assertDraft in
// the action layer). Button hides for sent+ quotes.

export function CustomerNotesDrawer({
  quoteId,
  initialCustomerFacingNotes,
  initialInternalNotes,
  onClose,
}: {
  quoteId: string;
  initialCustomerFacingNotes: string | null;
  initialInternalNotes: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialCustomerFacingNotes ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const lastSavedValue = useRef(initialCustomerFacingNotes ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(
      textareaRef.current.value.length,
      textareaRef.current.value.length,
    );
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const next = value.trim();
    const prev = lastSavedValue.current.trim();
    if (next === prev) return;

    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("customerFacingNotes", next);
    if (initialInternalNotes !== null) {
      fd.set("internalNotes", initialInternalNotes);
    }
    setError(null);
    startTransition(async () => {
      const r = await runGoverned(() => updateQuoteNotes(fd));
      if (r.kind !== "ok") {
        // `lastSavedValue` is deliberately NOT advanced. A save that may not
        // have landed must leave the drawer believing the text is unsaved, so
        // the next blur retries it rather than short-circuiting on equality.
        setError(r.message);
        return;
      }
      lastSavedValue.current = next;
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Plain Enter is reserved for newlines in a textarea (R6 Blur+Enter
    // pattern doesn't bind plain Enter on multi-line inputs); ⌘/Ctrl
    // +Enter commits explicitly. Blur on Tab-out is the other save
    // path.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Edit customer-facing notes"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(from var(--ink) l c h / 0.35)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(680px, 100%)",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderRadius: 12,
          padding: "20px 22px 18px",
          boxShadow: "0 12px 40px oklch(from var(--ink) l c h / 0.22)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div>
            <p
              className="r2-eyebrow"
              style={{ margin: 0, color: "var(--ink-3)" }}
            >
              Edit notes · customer-facing
            </p>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: "var(--ink-3)",
              }}
            >
              These render in the PDF Notes block. Internal notes stay on Setup.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 22,
              lineHeight: 1,
              color: "var(--ink-3)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={onKeyDown}
          placeholder="e.g. Pricing valid for 30 days. Lead time begins after artwork approval."
          rows={6}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--ink)",
            resize: "vertical",
            minHeight: 120,
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 10,
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.03em",
            color: "var(--ink-3)",
          }}
        >
          <span>
            {pending
              ? "Saving…"
              : error
                ? (
                    <span role="alert" data-testid="cv-notes-error" style={{ color: "var(--bad)" }}>
                      {error}
                    </span>
                  )
                : savedAt
                  ? "Saved · changes flow into next preview"
                  : "Tab out or ⌘ Enter to save · Esc to close"}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--rule)",
              borderRadius: 4,
              padding: "4px 10px",
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.04em",
              color: "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
