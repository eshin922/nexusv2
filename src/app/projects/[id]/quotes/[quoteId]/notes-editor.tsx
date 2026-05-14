"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { updateQuoteNotes } from "@/app/actions/quotes";

const DEBOUNCE_MS = 800;

// §6.b path-B migration commit 5/5 — Notes split renders canonical
// .r7b-notes / .r7b-note-zone structure (7bsetup.jsx NotesSection
// lines 313-350 + 7bstyles.css .r7b-notes / .r7b-note-zone rules
// at line 426).
//
// Two side-by-side audience-distinct zones at bottom of Setup:
//   Internal (left)   — .r7b-note-zone.internal — purple --internal
//                       accent border-left, INTERNAL chip
//   Customer (right)  — .r7b-note-zone.customer — green --good
//                       accent border-left, CUSTOMER chip
//
// Canonical DOM:
//   .r7b-note-zone
//     .r7b-note-zone-head
//       .lhs > h4 + .audience
//       .chip
//     .r7b-note-zone-body
//       <textarea>
//       .helper > <strong>Audience:</strong> + text + (Preview link)
//
// Autosave: blur-debounced (800ms) via updateQuoteNotes action.
// R6 Blur+Enter carry-forward.

export function NotesEditor({
  quoteId,
  projectId,
  internalNotes,
  customerFacingNotes,
  disabled = false,
}: {
  quoteId: string;
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
    <div className="r7b-notes">
      {/* Internal zone — purple --internal accent */}
      <div className="r7b-note-zone internal" aria-label="Internal notes">
        <div className="r7b-note-zone-head">
          <div className="lhs">
            <h4>Internal notes</h4>
            <span className="audience">PM-only · never customer-visible</span>
          </div>
          <span className="chip">Internal</span>
        </div>
        <div className="r7b-note-zone-body">
          <textarea
            value={internal}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              setInternal(v);
              scheduleSave({ internal: v });
            }}
            placeholder="e.g., 'Customer requested matte tube finish in Apr 24 call; pending sourcing confirm.'"
          />
          <div className="helper">
            <strong>Audience:</strong> you, other PMs, and admins. Sourcing
            dependencies, customer phone notes, R&amp;D blockers go here.
          </div>
        </div>
      </div>

      {/* Customer-facing zone — green --good accent */}
      <div
        className="r7b-note-zone customer"
        aria-label="Customer-facing notes"
      >
        <div className="r7b-note-zone-head">
          <div className="lhs">
            <h4>Customer-facing notes</h4>
            <span className="audience">Renders on the Quote PDF</span>
          </div>
          <span className="chip">Customer</span>
        </div>
        <div className="r7b-note-zone-body">
          <textarea
            value={customer}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              setCustomer(v);
              scheduleSave({ customer: v });
            }}
            placeholder="e.g., 'Pricing valid for 30 days. Lead time begins after artwork approval.'"
          />
          <div className="helper">
            <strong>Audience:</strong> the customer (renders on the Quote PDF
            and Mark-Accepted snapshot). Boundary-guard: this text travels
            with the quote artifact.{" "}
            <Link href={`/projects/${projectId}/quotes/${quoteId}/quote`}>
              Preview on Quote →
            </Link>
          </div>
        </div>
      </div>

      {(saveError || pending) && (
        <div
          style={{
            gridColumn: "1 / -1",
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
          role="status"
          aria-live="polite"
        >
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
