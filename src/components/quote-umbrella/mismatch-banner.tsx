"use client";

// Slice 12 Step 6d — sent-vs-draft mismatch banner.
// Pattern 30 port of R8 MismatchBanner (umbrella.jsx:346-366).
//
// Renders on Client Review when a quote is mid-Revise: PM has
// revised in-place and a fresh draft exists that hasn't been
// re-sent yet. Warns that the customer is still responding to the
// last-sent version and that acceptance would record against
// whichever version the customer actually saw.
//
// Three affordances (Q4a — Compare hidden until v1.5+ diff ships):
//   1. View v{N} (sent) — opens the superseded snapshot's stored
//      PDF in a new tab; falls back to a re-sign attempt via
//      resignSnapshotPdf when the 30-day signed URL has expired
//      (Q4b)
//   2. Send v{N+1} to customer — navigates to Send sub-tab (where
//      SendQuoteFlow lives per Step 5d)
//   3. Dismiss — local-state hide; not persisted (v3 brief doesn't
//      mandate durability, and ephemeral matches R8 canonical
//      demo shape)
//
// Slice 12 Step 10 Q4a (2026-07-29) — the Compare v{N} ↔ v{N+1}
// button was disabled with a tooltip admitting it wasn't shipped.
// CA disposition: "A control that admits in its own tooltip that
// it isn't shipped is worse than no control." Same reasoning as
// removing "Request unlock (admin)." Hidden until version-diff
// ships in v1.5+; the affordance re-appears when the feature lands.
//
// Warn-tinted, not error-tinted: per R8 §5, "a draft leading a
// sent version is a normal working state, not a fault."

import { useState, useTransition } from "react";
import { resignSnapshotPdf } from "@/app/actions/quotes";
import type { SentSnapshotRow } from "@/lib/quote-snapshots";
import type { SubTabId } from "./subtabs";

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MismatchBanner({
  quoteId,
  sentSnapshot,
  draftVersion,
  onGo,
}: {
  /** Q4b — resignSnapshotPdf needs the quote id to look up the
   * matching audit row. Snapshot rows carry it via quote_id but
   * the SentSnapshotRow shape here doesn't expose it separately;
   * parent passes it explicitly. */
  quoteId: string;
  sentSnapshot: SentSnapshotRow;
  draftVersion: number;
  onGo: (id: SubTabId) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [resigning, startResigning] = useTransition();
  const [resignError, setResignError] = useState<string | null>(null);
  if (dismissed) return null;

  const sentVersion = sentSnapshot.versionNumber;

  function viewSentPdf() {
    setResignError(null);
    // Q4b — try the snapshot's stored pdf_url first (Slice-11-Step-6+
    // sends persist it; still-valid within 30 days of the send).
    // On null/expired, fall through to resignSnapshotPdf which reads
    // the storagePath from audit_log and re-signs a fresh 30-day URL.
    // Falls back gracefully when the audit row lacks storagePath
    // (pre-Slice-11-Step-6 legacy or fixture-seeded snapshots).
    if (sentSnapshot.pdfUrl) {
      window.open(sentSnapshot.pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }
    startResigning(async () => {
      const r = await resignSnapshotPdf(quoteId, sentVersion);
      if (!r.ok) {
        setResignError(r.error.message);
        return;
      }
      window.open(r.data.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="r8-mismatch" data-testid="mismatch-banner">
      <span className="icon" aria-hidden="true">
        !
      </span>
      <div className="txt">
        <h4>
          You sent <strong>v{sentVersion}</strong> on{" "}
          {shortDate(sentSnapshot.sentAt)} · current draft is{" "}
          <strong>v{draftVersion}</strong>
        </h4>
        <p>
          The customer is responding to <strong>v{sentVersion}</strong>. Your
          v{draftVersion} edits aren&apos;t visible to them until you send
          again. Acceptance records against the version the customer actually
          saw.
        </p>
        {resignError && (
          <div
            role="alert"
            style={{
              marginBottom: 8,
              padding: "8px 10px",
              background: "var(--bad-soft, var(--warn-soft))",
              border: "1px solid var(--bad, var(--warn))",
              borderRadius: 4,
              fontSize: 12,
              color: "var(--bad, var(--ink-2))",
            }}
            data-testid="mismatch-view-sent-error"
          >
            {resignError}
          </div>
        )}
        <div className="acts">
          <button
            className="btn sm"
            onClick={viewSentPdf}
            disabled={resigning}
            data-testid="mismatch-view-sent"
          >
            {resigning ? "Loading…" : `View v${sentVersion} (sent)`}
          </button>
          {/* Q4a — Compare button hidden; see file header rationale. */}
          <button
            className="btn sm"
            onClick={() => onGo("send")}
            data-testid="mismatch-send-draft"
          >
            Send v{draftVersion} to customer
          </button>
          <button
            className="btn sm ghost"
            onClick={() => setDismissed(true)}
            data-testid="mismatch-dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
