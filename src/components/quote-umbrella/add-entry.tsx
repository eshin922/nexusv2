"use client";

// Slice 12 Step 6b — AddEntry form.
// Pattern 30 port of R8 AddEntry (umbrella.jsx:368-412).
//
// Collapsed / expanded pattern per R8 §4 design intent:
//   > "add-entry collapsed to a single line until used. The moment
//   > this surface acquires a permanently-open form it starts reading
//   > as a task to complete rather than a place to jot."
//
// Three PM-authorable event types (system 'sent' entries write only
// via sendQuote path — Step 5b). Chip picker, not a select — per R8
// §4: "cheap to scan, and visible extensibility."

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addQuoteReviewEvent } from "@/app/actions/quote-review-events";

type EventTypeDef = {
  id: "responded" | "asked" | "revision_requested";
  label: string;
  hint: string;
};

// Canonical R8 fixture. Kept client-side; matches the PM-authorable
// subset of the quote_review_event_type pgEnum.
const EVENT_TYPES: readonly EventTypeDef[] = [
  { id: "responded", label: "Responded", hint: "Customer replied" },
  { id: "asked", label: "Asked", hint: "You asked them something" },
  {
    id: "revision_requested",
    label: "Revision requested",
    hint: "They want changes",
  },
] as const;

export function AddEntry({
  quoteId,
  disabled = false,
  disabledReason,
}: {
  quoteId: string;
  /** True when quote is not in a revisable state (draft/complete/
   * superseded/lost). Server-side guard also enforces via
   * requireRevisable — this is the UI mirror. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<EventTypeDef["id"]>("responded");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setNote("");
    setError(null);
  }

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("eventType", type);
    fd.set("note", note);
    startTransition(async () => {
      const r = await addQuoteReviewEvent(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      // Refresh so the umbrella re-loads the feed (page.tsx re-runs
      // getReviewFeed + getReviewFeedCount). The new entry appears
      // at the top of the feed and the sub-tab-strip badge increments.
      router.refresh();
      reset();
    });
  }

  if (!open) {
    return (
      <div className="r8-addentry">
        <button
          className="trigger"
          onClick={() => setOpen(true)}
          disabled={disabled || pending}
          title={disabled ? disabledReason : undefined}
          style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          data-testid="review-add-trigger"
        >
          <span className="plus">+</span> Log customer activity…
        </button>
      </div>
    );
  }

  return (
    <div className="r8-addentry">
      <div className="form">
        <div className="r8-typepick">
          {EVENT_TYPES.map((t) => (
            <button
              key={t.id}
              className={type === t.id ? "on" : ""}
              onClick={() => setType(t.id)}
              disabled={pending}
              type="button"
              data-testid={`review-type-${t.id}`}
            >
              <span className="t">{t.label}</span>
              <span className="h">{t.hint}</span>
            </button>
          ))}
        </div>
        {/* Slice 12 Step 9 Pattern 47 — textarea MUST NOT include
            `pending` in its disabled attribute. Blocking the input
            mid-save drops focus (browsers drop focus on disabled
            elements). Submit is button-driven here (not autosave),
            but the same focus-drop concern applies: if submit errors,
            the PM has to click back into the field to continue.
            Buttons still get `disabled={pending}` for double-click
            prevention — that's Pattern 47's carve-out for button
            elements. */}
        <textarea
          placeholder="What happened? e.g. Beth called — wants the capsule SKU out and T2 pricing held."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-testid="review-note-input"
        />
        {error && (
          <div
            role="alert"
            style={{
              marginTop: 8,
              padding: "6px 10px",
              borderRadius: 4,
              background: "var(--bad-soft)",
              color: "var(--bad)",
              fontSize: 12,
            }}
            data-testid="review-add-error"
          >
            {error}
          </div>
        )}
        <div className="formfoot">
          <span className="hint">
            appended to the log · timestamped · not customer-visible
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn ghost sm"
              onClick={reset}
              disabled={pending}
              type="button"
              data-testid="review-add-cancel"
            >
              Cancel
            </button>
            <button
              className="btn primary sm"
              onClick={submit}
              disabled={pending || !note.trim()}
              type="button"
              data-testid="review-add-submit"
            >
              {pending ? "Logging…" : "Log entry"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
