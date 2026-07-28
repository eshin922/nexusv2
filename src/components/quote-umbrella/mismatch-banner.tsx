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
// Four affordances per R8 §5:
//   1. View v{N} (sent) — opens the superseded snapshot's stored
//      PDF in a new tab
//   2. Compare v{N} ↔ v{N+1} — DEFERRED to v1.5+ per v3 §0 Round 4
//      disposition. Renders disabled with a "coming soon" tooltip
//      so the affordance shape ships but the diff-view work is out
//      of Slice 12 scope
//   3. Send v{N+1} to customer — navigates to Send sub-tab (where
//      SendQuoteFlow lives per Step 5d)
//   4. Dismiss — local-state hide; not persisted (v3 brief doesn't
//      mandate durability, and ephemeral matches R8 canonical
//      demo shape)
//
// Warn-tinted, not error-tinted: per R8 §5, "a draft leading a
// sent version is a normal working state, not a fault."

import { useState } from "react";
import type { SentSnapshotRow } from "@/lib/quote-snapshots";
import type { SubTabId } from "./subtabs";

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MismatchBanner({
  sentSnapshot,
  draftVersion,
  onGo,
}: {
  sentSnapshot: SentSnapshotRow;
  draftVersion: number;
  onGo: (id: SubTabId) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const sentVersion = sentSnapshot.versionNumber;

  function viewSentPdf() {
    if (sentSnapshot.pdfUrl) {
      window.open(sentSnapshot.pdfUrl, "_blank", "noopener,noreferrer");
    } else {
      window.alert(
        "The sent PDF URL for that version isn't available (signed URLs expire after 30 days; the storage path is retained in audit_log for regeneration).",
      );
    }
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
        <div className="acts">
          <button
            className="btn sm"
            onClick={viewSentPdf}
            disabled={!sentSnapshot.pdfUrl}
            title={
              sentSnapshot.pdfUrl
                ? undefined
                : "Sent PDF signed URL has expired (regenerable from audit_log storage_path)."
            }
            data-testid="mismatch-view-sent"
          >
            View v{sentVersion} (sent)
          </button>
          <button
            className="btn sm"
            disabled
            title="Version-diff view ships in v1.5+ per v3 brief §0 Round 4 disposition. The hook is preserved so the diff plugs in without rework."
            data-testid="mismatch-compare"
          >
            Compare v{sentVersion} ↔ v{draftVersion}
          </button>
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
