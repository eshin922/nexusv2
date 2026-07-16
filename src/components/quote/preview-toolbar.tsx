"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerViewPdfLayout } from "@/types/quote";
import { sendQuote } from "@/app/actions/quotes";
import { CustomerNotesDrawer } from "./customer-notes-drawer";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal/modal";

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
// disposition). The confirm modal is the only guardrail against
// accidental sends now that the button is un-gated — do NOT remove
// the confirm step.
//
// **Slice 11 Step 8 Gate-0 hotfix (2026-07-15).** Was `window.confirm`
// / `window.alert` — native browser modals. CB's Gate-0 smoke hit a
// hard fail: browser automation can't operate native dialogs, so
// the send flow was untestable. Swapped for in-DOM Modal primitive
// (portal + r3-shared scope + Escape handling). Automation-friendly
// (CB clicks a real DOM button); still deliberate two-step commit.
// Success / failure states render inline in the modal (no more
// `alert`). See docs/cc-comm-gate-0-fail-diagnosis.md for the root-
// cause report.

type SendStatus =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "sending" }
  | { kind: "success"; quoteNumber: string }
  | { kind: "error"; message: string };

function SendButton({
  quoteId,
  customerName,
  projectTitle,
}: {
  quoteId: string;
  customerName: string | null;
  projectTitle: string | null;
}) {
  const router = useRouter();
  const [_pending, startTransition] = useTransition();
  const [status, setStatus] = useState<SendStatus>({ kind: "idle" });

  const isModalOpen =
    status.kind === "confirming" ||
    status.kind === "sending" ||
    status.kind === "success" ||
    status.kind === "error";

  const isSending = status.kind === "sending";

  function onOpenConfirm() {
    setStatus({ kind: "confirming" });
  }

  function onClose() {
    if (isSending) return; // block dismiss during in-flight send
    // Success path: refresh the page state so the toolbar reflects
    // the sent status before the modal closes.
    if (status.kind === "success") {
      router.refresh();
    }
    setStatus({ kind: "idle" });
  }

  function onDispatch() {
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    setStatus({ kind: "sending" });
    startTransition(async () => {
      const r = await sendQuote(fd);
      if (!r.ok) {
        setStatus({ kind: "error", message: r.error.message });
        return;
      }
      setStatus({ kind: "success", quoteNumber: r.data.quoteNumber });
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn sm primary"
        onClick={onOpenConfirm}
        disabled={isModalOpen}
        title="Send the quote — generates the customer PDF, transitions the quote to sent, and captures the immutable snapshot. Admin override required to revert."
        data-testid="send-quote-button"
      >
        {isSending ? "Sending…" : "↗ Send"}
      </button>
      <Modal open={isModalOpen} onClose={onClose}>
        {(status.kind === "confirming" || status.kind === "sending") && (
          <>
            <ModalHead>Send this quote?</ModalHead>
            <ModalBody>
              <div style={{ marginBottom: 12 }}>
                {(customerName || projectTitle) && (
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "var(--paper-2)",
                      border: "1px solid var(--rule)",
                      borderRadius: 6,
                      marginBottom: 14,
                      fontSize: 13,
                    }}
                  >
                    {customerName && (
                      <div>
                        <strong>Customer:</strong> {customerName}
                      </div>
                    )}
                    {projectTitle && (
                      <div style={{ marginTop: 4 }}>
                        <strong>Deal:</strong> {projectTitle}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  This will:
                  <ul style={{ margin: "6px 0 0 20px", padding: 0 }}>
                    <li>
                      Transition the quote to <code>status=&apos;sent&apos;</code>{" "}
                      (admin override required to revert)
                    </li>
                    <li>Assign a customer-facing quote number</li>
                    <li>
                      Snapshot all commercial defaults + prepared-by contact
                    </li>
                    <li>Generate the customer PDF + persist to storage</li>
                  </ul>
                </div>
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: "var(--ink-3)",
                    fontStyle: "italic",
                  }}
                >
                  The PDF becomes the immutable sent artifact.
                </div>
              </div>
            </ModalBody>
            <ModalFoot>
              <button
                type="button"
                className="btn sm"
                onClick={onClose}
                disabled={isSending}
                data-testid="send-quote-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn sm primary"
                onClick={onDispatch}
                disabled={isSending}
                data-testid="send-quote-confirm"
              >
                {isSending ? "Sending…" : "Send"}
              </button>
            </ModalFoot>
          </>
        )}
        {status.kind === "success" && (
          <>
            <ModalHead>Sent ✓</ModalHead>
            <ModalBody>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                Quote number{" "}
                <code
                  style={{
                    padding: "2px 6px",
                    background: "var(--paper-2)",
                    border: "1px solid var(--rule)",
                    borderRadius: 4,
                  }}
                >
                  {status.quoteNumber}
                </code>{" "}
                assigned. The customer PDF has been generated and
                snapshotted. The preview will refresh with the sent
                state when you close this dialog.
              </div>
            </ModalBody>
            <ModalFoot>
              <button
                type="button"
                className="btn sm primary"
                onClick={onClose}
                data-testid="send-quote-success-close"
              >
                Close
              </button>
            </ModalFoot>
          </>
        )}
        {status.kind === "error" && (
          <>
            <ModalHead>Send failed</ModalHead>
            <ModalBody>
              <div
                role="alert"
                style={{
                  padding: "10px 12px",
                  background: "var(--bad-soft)",
                  border: "1px solid var(--bad)",
                  color: "var(--bad)",
                  borderRadius: 6,
                  fontSize: 13,
                  marginBottom: 8,
                }}
                data-testid="send-quote-error-message"
              >
                {status.message}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                Nothing was committed — the quote remains a draft. You can
                retry, cancel, or close this dialog to review the quote before
                trying again.
              </div>
            </ModalBody>
            <ModalFoot>
              <button
                type="button"
                className="btn sm"
                onClick={onClose}
                data-testid="send-quote-error-close"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn sm primary"
                onClick={onDispatch}
                data-testid="send-quote-error-retry"
              >
                Retry
              </button>
            </ModalFoot>
          </>
        )}
      </Modal>
    </>
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
  customerName,
  projectTitle,
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
  /** Slice 11 Step 8 Gate-0 hotfix — surfaced in the in-DOM send
   * confirm modal so PMs see who this quote is going to before they
   * commit the immutable transition. Null-safe render. */
  customerName: string | null;
  projectTitle: string | null;
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
        {quoteStatus === "draft" && (
          <SendButton
            quoteId={quoteId}
            customerName={customerName}
            projectTitle={projectTitle}
          />
        )}
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
