"use client";

import { useState, useTransition } from "react";

import { sendQuote } from "@/app/actions/quotes";
import { ERR } from "@/lib/action-result";
import { runGoverned, runGovernedRaw } from "@/lib/governed-action";
import { UnresolvedCostsNotice } from "@/components/quote-umbrella/unresolved-costs-notice";
import type { UnresolvedQuoteCost } from "@/lib/quote-cost-completeness-contract";
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
  flushElections,
  label,
  dataState,
  title,
}: {
  quoteId: string;
  disabled: boolean;
  /**
   * Persist the current recovery elections and CONFIRM they landed.
   *
   * Called before the send, every time. Finalize freezes an artifact from the
   * stored state, so it must not run against a projection the operator can see
   * but the database does not hold — and "wait for the debounce" would wait on
   * a clock rather than on storage, where a failed write still lets the clock
   * elapse. Returns false when the set is not durable, and the send does not
   * happen.
   */
  flushElections?: () => Promise<boolean>;
  label: string;
  dataState: string;
  title?: string;
}) {
  const { pdfLayout, detailLevel, includeSpecAddendum } = useQuoteAxis();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // ── ONE REFUSAL RENDERS AS A WORK LIST, NOT A SENTENCE ─────────────────
  //
  // `action-result.ts` says so where the code is declared: UNRESOLVED_COSTS
  // "has its own code because it is the one refusal the UI must render as a
  // work list rather than a sentence — `error.details` carries the rows."
  //
  // The first version of this button showed `error.message` for everything,
  // so an operator was told "Resolve costs before sending." and not WHICH
  // costs — a refusal that names no work is a dead end wearing the clothes of
  // an instruction. Caught on the consolidated walk, by being refused.
  //
  // Read from the refusal itself rather than from a prop, so the list can
  // never describe a different read than the one that declined.
  const [unresolved, setUnresolved] = useState<readonly UnresolvedQuoteCost[]>([]);

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
          setUnresolved([]);
          const fd = new FormData();
          fd.set("quoteId", quoteId);
          // The axes the operator is looking at, so the artifact that is
          // frozen is the document on screen. Read from context rather than
          // re-resolved: a second read could disagree with the preview.
          fd.set("pdfLayout", pdfLayout);
          fd.set("detailLevel", detailLevel);
          fd.set("includeSpecAddendum", includeSpecAddendum ? "1" : "0");
          startTransition(async () => {
            // FLUSH FIRST. The elections on screen may be newer than the ones
            // stored; freezing an artifact from the stored state while the
            // operator is looking at a different one is the failure this
            // prevents.
            if (flushElections) {
              // The flush can fail to REACH the server as easily as it can
              // report a failure, and both mean the same thing here: do not
              // freeze an artifact from elections that are not durable.
              const flushed = await runGovernedRaw(flushElections);
              if (flushed.kind === "unreachable") {
                setError(flushed.message);
                return;
              }
              if (!flushed.value) {
                setError(
                  "Your recovery elections have not been saved. Nothing was sent — " +
                    "check your connection and try again.",
                );
                return;
              }
            }
            const r = await runGoverned(() => sendQuote(fd));
            // The refusal is SHOWN, not swallowed. A below-floor quote fails
            // here with the authorization core's own sentence, which names the
            // tier and distinguishes never-authorized from invalidated from
            // state-has-changed — three refusals that send an operator to three
            // different places.
            //
            // And a server that never answered is shown too, in its own words.
            // Soak run 5 measured a 503 here that left the quote in `draft`
            // with nothing on screen; the operator's evidence that the freeze
            // had failed was that the page did not change.
            if (r.kind === "ok") return;
            if (r.kind === "unreachable") {
              setError(r.message);
              return;
            }
            if (r.code === ERR.UNRESOLVED_COSTS && Array.isArray(r.details)) {
              setUnresolved(r.details as UnresolvedQuoteCost[]);
              return;
            }
            setError(r.message);
          });
        }}
      >
        {pending ? "Finalizing…" : label}
      </button>
      {unresolved.length > 0 && (
        <div data-testid="cv-finalize-unresolved">
          <UnresolvedCostsNotice unresolved={unresolved} />
        </div>
      )}
      {error && (
        <div className="cv-finalize-error" role="alert" data-testid="cv-finalize-error">
          {error}
        </div>
      )}
    </>
  );
}
