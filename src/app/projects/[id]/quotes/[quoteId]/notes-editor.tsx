"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { updateQuoteNotes } from "@/app/actions/quotes";

const DEBOUNCE_MS = 800;

// §6.b Step 7 (pulled forward to Step 1 amendment) — Notes split
// per R7b designer notes §3.6 / Decision 2.
//
// Two side-by-side zones at bottom of Setup:
//   Internal (left)   — `--internal` purple accent
//                       INTERNAL chip
//                       "PM-ONLY · NEVER CUSTOMER-VISIBLE" subtitle
//                       audience footer
//   Customer (right)  — `--good` green accent
//                       CUSTOMER chip
//                       "RENDERS ON THE QUOTE PDF" subtitle
//                       audience footer
//                       "Preview on Quote →" link
//
// Audience-decision-at-write-time per R7b: separate textareas with
// distinct visual treatment makes accidental cross-pollination of
// audiences hard. R7b explicitly rejected the v1 single-textarea-
// with-checkboxes pattern.
//
// Layout: CSS grid two-column on desktop, stacked on narrow. Card
// chrome (paper bg + rule border + 10px radius) per R7b.

export function NotesEditor({
  quoteId,
  projectId,
  internalNotes,
  customerFacingNotes,
  disabled = false,
}: {
  quoteId: string;
  /** §6.b Step 7 — for the "Preview on Quote →" customer-zone link. */
  projectId: string;
  internalNotes: string | null;
  customerFacingNotes: string | null;
  disabled?: boolean;
}) {
  const [internal, setInternal] = useState(internalNotes ?? "");
  const [customer, setCustomer] = useState(customerFacingNotes ?? "");

  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ internal, customer });
  stateRef.current = { internal, customer };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{ internal: string; customer: string }>;

  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("internalNotes", s.internal);
    fd.set("customerFacingNotes", s.customer);
    startTransition(async () => {
      const r = await updateQuoteNotes(fd);
      if (!r.ok) setSaveError(r.error.message);
      else setSaveError(null);
    });
  }

  function scheduleSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(overrides), DEBOUNCE_MS);
  }

  return (
    <div className="r6b-notes-grid">
      {/* Internal card — purple --internal accent */}
      <section
        className="r6b-notes-card"
        data-zone="internal"
        aria-label="Internal notes"
      >
        <header className="r6b-notes-card-head">
          <div>
            <h3 className="r6b-notes-card-title">Internal notes</h3>
            <p className="r6b-notes-card-subtitle">
              PM-only · never customer-visible
            </p>
          </div>
          <span className="r6b-notes-chip" data-chip="internal">
            INTERNAL
          </span>
        </header>
        <textarea
          value={internal}
          rows={5}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setInternal(v);
            scheduleSave({ internal: v });
          }}
          placeholder="e.g., 'Customer requested matte tube finish in Apr 24 call; pending sourcing confirm.'"
          className="r6b-notes-textarea"
        />
        <footer className="r6b-notes-card-footer">
          <span className="r6b-notes-audience-label">Audience:</span>{" "}
          you, other PMs, and admins. Sourcing dependencies, customer phone
          notes, R&amp;D blockers go here.
        </footer>
      </section>

      {/* Customer-facing card — green --good accent */}
      <section
        className="r6b-notes-card"
        data-zone="customer"
        aria-label="Customer-facing notes"
      >
        <header className="r6b-notes-card-head">
          <div>
            <h3 className="r6b-notes-card-title">Customer-facing notes</h3>
            <p className="r6b-notes-card-subtitle">
              Renders on the Quote PDF
            </p>
          </div>
          <span className="r6b-notes-chip" data-chip="customer">
            CUSTOMER
          </span>
        </header>
        <textarea
          value={customer}
          rows={5}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setCustomer(v);
            scheduleSave({ customer: v });
          }}
          placeholder="e.g., 'Pricing valid for 30 days. Lead time begins after artwork approval.'"
          className="r6b-notes-textarea"
        />
        <footer className="r6b-notes-card-footer">
          <span className="r6b-notes-audience-label">Audience:</span>{" "}
          the customer (renders on the Quote PDF and Mark-Accepted snapshot).
          Boundary-guard: this text travels with the quote artifact.
          {" "}
          <Link
            href={`/projects/${projectId}/quotes/${quoteId}/quote`}
            className="r6b-notes-preview-link"
          >
            Preview on Quote →
          </Link>
        </footer>
      </section>

      {(saveError || pending) && (
        <div className="r6b-notes-status" role="status" aria-live="polite">
          {saveError ? (
            <span style={{ color: "var(--bad)" }}>{saveError}</span>
          ) : (
            <span style={{ color: "var(--ink-3)" }}>Saving…</span>
          )}
        </div>
      )}
    </div>
  );
}
