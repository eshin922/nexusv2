"use client";

import { useState, useTransition } from "react";

import { sendQuote } from "@/app/actions/quotes";
import { useQuoteAxis } from "@/components/quote-umbrella/quote-axis-context";

/**
 * Finalize quote — the Customer View's primary action.
 *
 * ── THE NAME ─────────────────────────────────────────────────────────────
 *
 * Not "Freeze & send". Nexus does not email the customer, and the footer says
 * so two lines above this button: "Delivery is manual — Nexus does not email
 * the customer." A button promising a send, directly beneath a line saying
 * nothing is sent, is the surface contradicting itself about the one act the
 * operator is performing. What it does is freeze the quote and produce the
 * artifact. Edward's call, 2026-08-25.
 *
 * The ACTION it calls is still `sendQuote`, deliberately. That name is the
 * certified path — the send gate, the snapshot writes, the PDF persistence, the
 * audit row and the below-floor refusal all hang off it, and renaming a
 * transaction to match a button is how a rename becomes a regression. The
 * button says what the operator does; the action keeps the name the system
 * knows it by.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
 *
 * It builds no FormData of its own beyond the axes, performs no gate of its
 * own, and decides nothing about the floor. `sendQuote` refuses a below-floor
 * quote without valid authorization, and the footer's `disabled` PREDICTS that
 * refusal from the same shared projection the gate uses. A surface predicate
 * that substituted for the gate is the defect this repair removed; this one
 * agrees with it because they read one evaluation.
 *
 * So a below-floor quote is refused twice, by the same rule, and the operator
 * learns it before clicking rather than after.
 */
export function FinalizeQuoteButton({
  quoteId,
  disabled,
  label,
  dataState,
  title,
}: {
  quoteId: string;
  disabled: boolean;
  label: string;
  dataState: string;
  title?: string;
}) {
  const { pdfLayout, detailLevel, includeSpecAddendum } = useQuoteAxis();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        className="cv-primary"
        type="button"
        // Pattern 47(e) permits `pending` on a BUTTON: double-click protection
        // is real here, and focus stability is not a button concern. This is
        // the one irreversible act on the surface.
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        data-state={dataState}
        title={pending ? "Finalizing…" : title}
        data-testid="cv-primary"
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set("quoteId", quoteId);
          // The axes the operator is looking at, so the artifact that is
          // frozen is the document on screen. Read from context rather than
          // re-resolved: a second read could disagree with the preview.
          fd.set("pdfLayout", pdfLayout);
          fd.set("detailLevel", detailLevel);
          fd.set("includeSpecAddendum", includeSpecAddendum ? "1" : "0");
          startTransition(async () => {
            const r = await sendQuote(fd);
            // The refusal is SHOWN, not swallowed. A below-floor quote fails
            // here with the authorization core's own sentence, which names the
            // tier and distinguishes never-authorized from invalidated from
            // state-has-changed — three refusals that send an operator to three
            // different places.
            if (!r.ok) setError(r.error.message);
          });
        }}
      >
        {pending ? "Finalizing…" : label}
      </button>
      {error && (
        <div className="cv-finalize-error" role="alert" data-testid="cv-finalize-error">
          {error}
        </div>
      )}
    </>
  );
}
