"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateQuoteNotes } from "@/app/actions/quotes";

// Slice RI.9 §6 step 7 — Pushback 2 disposition.
//
// "Edit notes" affordance on Customer view (Quote) renders as an
// inline drawer overlay, NOT a jump-to-Setup. PM stays on the
// surface for the edit-and-send loop. Closing the drawer returns
// to Customer view with no breadcrumb shuffle.
//
// Scope: edits ONLY `quote.customerFacingNotes`. Internal notes
// stay on Setup; customer-facing notes is what the PM actually
// reviews on this surface (they render in the PDF Notes block
// under "Notes" header).
//
// Save pattern: blur-or-Enter autosave, matching the existing
// quote notes flow. The shared `updateQuoteNotes` action takes
// both notes fields; we pass `internalNotes` through unchanged
// so a customer-notes edit doesn't clobber internal notes.
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
      const r = await updateQuoteNotes(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      lastSavedValue.current = next;
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter saves (plain Enter — multi-line via Shift+Enter to match
    // common chat/notes pattern). Cmd/Ctrl+Enter also commits.
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
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "min(680px, calc(100vw - 32px))",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderRadius: "12px 12px 0 0",
          padding: "20px 22px 18px",
          boxShadow: "0 -12px 32px oklch(from var(--ink) l c h / 0.18)",
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
                ? <span style={{ color: "var(--bad)" }}>{error}</span>
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
