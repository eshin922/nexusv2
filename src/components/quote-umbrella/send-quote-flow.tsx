"use client";

// Slice 12 Step 5d — extracted SendButton + SendConfirmModal.
// Pulled out of preview-toolbar.tsx so the Send action can live in
// the Send sub-tab (Step 5c pre-send state). Reads current PDF axis
// state from the quote-axis-context (Step 5d — lifted from
// QuoteHost's local state at the same time).
//
// Zero semantic change from the pre-move SendButton — same server
// action, same confirm-modal flow, same success/error handling.
// The Gate-0 in-DOM Modal fix (Slice 11 Step 8, was window.confirm)
// is preserved.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendQuote } from "@/app/actions/quotes";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal/modal";
import { useQuoteAxis } from "./quote-axis-context";

type SendStatus =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "sending" }
  | { kind: "success"; quoteNumber: string }
  | { kind: "error"; message: string };

export function SendQuoteFlow({
  quoteId,
  customerName,
  projectTitle,
  isHubspotLinked,
  buttonLabel = "↗ Send",
  buttonClassName = "btn sm primary",
}: {
  quoteId: string;
  customerName: string | null;
  projectTitle: string | null;
  isHubspotLinked: boolean;
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [_pending, startTransition] = useTransition();
  const [status, setStatus] = useState<SendStatus>({ kind: "idle" });
  const { pdfLayout, detailLevel, includeSpecAddendum } = useQuoteAxis();

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
    if (status.kind === "success") {
      // Refresh so the umbrella pulls fresh quote.status = 'sent';
      // Sub-tab strip re-derives (Preview done · Send current becomes
      // Send done · Client Review current) and Send-tab flips to
      // waiting variant.
      router.refresh();
    }
    setStatus({ kind: "idle" });
  }

  function onDispatch() {
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    // PDF axes read from context — Step 5d lifted these out of
    // QuoteHost's local state so this component (living in the
    // Send tab, not Preview) can see PM's current toggle choices.
    fd.set("pdfLayout", pdfLayout);
    fd.set("detailLevel", detailLevel);
    fd.set("includeSpecAddendum", includeSpecAddendum ? "1" : "0");
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
        className={buttonClassName}
        onClick={onOpenConfirm}
        disabled={isModalOpen || !isHubspotLinked}
        title={
          !isHubspotLinked
            ? "This deal isn't linked to HubSpot. Push it to HubSpot before sending."
            : "Send the quote — generates the customer PDF, transitions the quote to sent, and captures the immutable snapshot."
        }
        data-testid="send-quote-button"
      >
        {isSending ? "Sending…" : buttonLabel}
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
                      Transition the quote to{" "}
                      <code>status=&apos;sent&apos;</code> (reversible via
                      Revise until Complete)
                    </li>
                    <li>Assign a customer-facing quote number</li>
                    <li>
                      Snapshot commercial defaults + prepared-by contact
                    </li>
                    <li>Generate the customer PDF + persist to storage</li>
                    <li>Log a system entry in Client Review</li>
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
                  The PDF becomes the immutable sent artifact for this
                  version.
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
                snapshotted. The umbrella will refresh with the sent
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
                retry, cancel, or close this dialog to review the quote
                before trying again.
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
