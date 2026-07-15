"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerViewPdfLayout } from "@/types/quote";
import { sendQuote } from "@/app/actions/quotes";
import { CustomerNotesDrawer } from "./customer-notes-drawer";

export type CustomerViewSubState = "pure" | "passThrough" | "partial";

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  // ISO YYYY-MM-DD → "Apr 28"
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Slice 11 Step 6 — canonical Send. Was DevSendButton (a Slice-RI.7
// dev stub gated by admin + NODE_ENV); Step 6 makes it the real
// send path — `sendQuote` now renders the customer PDF via
// `renderToBuffer` + uploads to `quote-pdfs` bucket + writes signed
// URL to `quotes.pdfUrl` before marking the quote sent.
//
// Permission: any authenticated user. No admin gate (per §3
// disposition). The confirm dialog is the only guardrail against
// accidental sends now that the button is un-gated — do NOT remove
// the confirm step.
function SendButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !confirm(
        "Send this quote?\n\n" +
          "This will:\n" +
          "  • Transition the quote to status='sent' (admin override required to revert)\n" +
          "  • Assign a customer-facing quote number\n" +
          "  • Snapshot all commercial defaults + prepared-by contact\n" +
          "  • Generate the customer PDF + persist to storage\n\n" +
          "The PDF becomes the immutable sent artifact. Continue?",
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const r = await sendQuote(fd);
      if (!r.ok) {
        alert(`Send failed: ${r.error.message}`);
        return;
      }
      alert(`Sent · ${r.data.quoteNumber}`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className="btn sm primary"
      onClick={onClick}
      disabled={pending}
      title="Send the quote — generates the customer PDF, transitions the quote to sent, and captures the immutable snapshot. Admin override required to revert."
    >
      {pending ? "Sending…" : "↗ Send"}
    </button>
  );
}

export function PreviewToolbar({
  quoteId,
  quoteStatus,
  quoteNumber,
  sentDate,
  pdfLayout,
  onPdfLayoutChange,
  subState,
  onSubStateChange,
  showStateSwitcher,
  customerFacingNotes,
  internalNotes,
}: {
  quoteId: string;
  quoteStatus: string;
  quoteNumber: string | null;
  sentDate: string | null;
  pdfLayout: CustomerViewPdfLayout;
  onPdfLayoutChange: (next: CustomerViewPdfLayout) => void;
  subState: CustomerViewSubState;
  onSubStateChange: (next: CustomerViewSubState) => void;
  showStateSwitcher: boolean;
  /** RI.9 §6 step 7 — current customer-facing notes (passed
   * through to the inline drawer; updates flow via updateQuoteNotes). */
  customerFacingNotes: string | null;
  /** Pass-through so the customer-notes save doesn't clobber
   * internal notes (action layer updates both fields together). */
  internalNotes: string | null;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const notesEditable = quoteStatus === "draft";
  // Slice 11 Step 6 FU — sent quotes render the immutable snapshot;
  // the layout toggle would change the iframe URL but the resolver
  // ignores search params in the isSent branch. Disable so PMs
  // don't wonder why toggles no-op.
  const isSent = quoteStatus !== "draft";
  const sentLockTooltip = isSent
    ? "Sent quotes render the frozen snapshot; toggles only work on drafts."
    : undefined;
  return (
    <div className="preview-toolbar">
      <div className="left">
        <span className="ribbon">PM-internal preview · this becomes the PDF</span>
        <span className="meta">
          <strong>{quoteNumber ?? "draft (no number yet)"}</strong>
          {sentDate ? ` · sent ${formatShortDate(sentDate)}` : ""}
        </span>
        <span className="meta" style={{ color: "var(--ink-4)" }}>·</span>
        <span
          className="meta send-as"
          style={{ opacity: isSent ? 0.5 : 1 }}
          title={sentLockTooltip}
        >
          Send as:{" "}
          <button
            type="button"
            className={pdfLayout === "tier_table" ? "active" : ""}
            onClick={() => onPdfLayoutChange("tier_table")}
            disabled={isSent}
          >
            tier table
          </button>
          <span className="sep">|</span>
          <button
            type="button"
            className={pdfLayout === "single_tier" ? "active" : ""}
            onClick={() => onPdfLayoutChange("single_tier")}
            disabled={isSent}
          >
            single tier
          </button>
        </span>
      </div>
      <div className="right">
        {showStateSwitcher && (
          <div
            className="state-sub"
            title="Prototype navigation only — production renders whichever state the data is in."
          >
            <button
              className={subState === "pure" ? "active" : ""}
              onClick={() => onSubStateChange("pure")}
            >
              ① Pure
            </button>
            <button
              className={subState === "passThrough" ? "active" : ""}
              onClick={() => onSubStateChange("passThrough")}
            >
              ② Pass-through
            </button>
            <button
              className={subState === "partial" ? "active" : ""}
              onClick={() => onSubStateChange("partial")}
            >
              ③ Partial
            </button>
          </div>
        )}
        {notesEditable && (
          <button
            type="button"
            className="btn sm"
            title="Edit customer-facing notes inline. Internal notes stay on Setup."
            onClick={() => setNotesOpen(true)}
          >
            ✎ Edit notes
          </button>
        )}
        <button
          type="button"
          className="btn sm"
          title="Generates the PDF and saves to your Downloads. You attach it to your usual email."
          onClick={() => {
            // Slice 11 Step 6 FU — download button opens the API
            // route with ?download=1 so the browser saves rather
            // than displays inline. Same render path as the iframe
            // preview (per CA §1 — no fourth render path).
            window.open(
              `/api/quotes/${quoteId}/customer-pdf?download=1`,
              "_blank",
            );
          }}
        >
          ⤓ Download PDF
        </button>
        <button
          type="button"
          className="btn sm"
          title="Generates the PDF, saves to Downloads, and opens a new email draft in your default mail client (mailto:). No SMTP integration — you attach the downloaded PDF manually and send from your own client."
          onClick={() => {
            // Download PDF first (browser save), then open mail
            // client with subject/body pre-filled. D3 — no SMTP,
            // no auto-attach (PM attaches the just-downloaded
            // file manually in the mail client).
            window.open(
              `/api/quotes/${quoteId}/customer-pdf?download=1`,
              "_blank",
            );
            const subject = quoteNumber
              ? `Quote ${quoteNumber}`
              : "Quote from The DPS";
            const body =
              "Hi,\n\n" +
              "Please find our quote attached (I've just saved it to my Downloads).\n\n" +
              "Let me know if you have any questions.\n\n" +
              "Thanks,";
            window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          }}
        >
          ↳ Download + open mail draft
        </button>
        {quoteStatus === "draft" && <SendButton quoteId={quoteId} />}
      </div>
      {notesOpen && (
        <CustomerNotesDrawer
          quoteId={quoteId}
          initialCustomerFacingNotes={customerFacingNotes}
          initialInternalNotes={internalNotes}
          onClose={() => setNotesOpen(false)}
        />
      )}
    </div>
  );
}
