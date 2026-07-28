"use client";

// Slice 12 Step 6c — Revise-in-place button + confirm modal.
//
// Two mount sites:
//   - Client Review sidecar (primary "↺ Revise → v{N+1}")
//   - Send-tab waiting state (secondary "↺ Revise quote")
//   - Future: inline on `revision_requested` feed entries
//
// Design intent per R8 §5: Revise is styled as an ORDINARY secondary
// action inside a dashed container — never a primary, never a
// destructive/danger treatment. Reversibility is *routine* in the
// v2 model; ceremony gets reserved for the one irreversible act
// (Tier Selection → Complete). Confirm copy always states the
// invariant: *same quote, same number, nothing is lost.*

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviseQuote } from "@/app/actions/quotes";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal/modal";

type Status =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "revising" }
  | { kind: "success"; newVersionNumber: number }
  | { kind: "error"; message: string };

export function ReviseButton({
  quoteId,
  currentVersionNumber,
  quoteNumber,
  disabled = false,
  disabledReason,
  buttonLabel,
  buttonClassName = "btn sm",
  buttonStyle,
  buttonTestId = "revise-quote-button",
}: {
  quoteId: string;
  currentVersionNumber: number;
  quoteNumber: string | null;
  disabled?: boolean;
  disabledReason?: string;
  /** Defaults to "↺ Revise quote"; sidecar CTA passes
   * "↺ Revise → v{N+1}". */
  buttonLabel?: string;
  buttonClassName?: string;
  buttonStyle?: React.CSSProperties;
  buttonTestId?: string;
}) {
  const router = useRouter();
  const [_pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const nextVersion = currentVersionNumber + 1;
  const label = buttonLabel ?? `↺ Revise quote`;

  const isModalOpen =
    status.kind === "confirming" ||
    status.kind === "revising" ||
    status.kind === "success" ||
    status.kind === "error";
  const isRevising = status.kind === "revising";

  function onOpen() {
    if (disabled) return;
    setStatus({ kind: "confirming" });
  }

  function onClose() {
    if (isRevising) return;
    if (status.kind === "success") {
      // Refresh so the umbrella pulls fresh quote.status = 'draft' +
      // bumped version_number. Sub-tab strip re-derives; Preview tab
      // becomes editable; SendTab flips back to pre-send variant.
      router.refresh();
    }
    setStatus({ kind: "idle" });
  }

  function onDispatch() {
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    setStatus({ kind: "revising" });
    startTransition(async () => {
      const r = await reviseQuote(fd);
      if (!r.ok) {
        setStatus({ kind: "error", message: r.error.message });
        return;
      }
      setStatus({
        kind: "success",
        newVersionNumber: r.data.newVersionNumber,
      });
    });
  }

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        style={buttonStyle}
        onClick={onOpen}
        disabled={disabled || isModalOpen}
        title={disabled ? disabledReason : undefined}
        data-testid={buttonTestId}
      >
        {label}
      </button>
      <Modal open={isModalOpen} onClose={onClose}>
        {(status.kind === "confirming" || status.kind === "revising") && (
          <>
            <ModalHead>Revise this quote?</ModalHead>
            <ModalBody>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <p style={{ marginTop: 0 }}>
                  Returns{" "}
                  <code
                    style={{
                      padding: "2px 6px",
                      background: "var(--paper-2)",
                      border: "1px solid var(--rule)",
                      borderRadius: 4,
                    }}
                  >
                    {quoteNumber ?? "this quote"}
                  </code>{" "}
                  to editable draft as{" "}
                  <strong>v{nextVersion}</strong>. Same quote, same number —{" "}
                  <em>nothing is lost.</em>
                </p>
                <ul style={{ margin: "10px 0 0 18px", padding: 0 }}>
                  <li>Notes, associations, cost data all carry over</li>
                  <li>The current sent version is retained (viewable in Preview)</li>
                  <li>Client Review log stays intact</li>
                  <li>
                    Once ready, send again — the customer sees the same
                    quote number with a fresh version
                  </li>
                </ul>
                <p
                  style={{
                    marginTop: 12,
                    marginBottom: 0,
                    color: "var(--ink-3)",
                    fontStyle: "italic",
                    fontSize: 12,
                  }}
                >
                  Reversibility is the whole point — this action is routine.
                </p>
              </div>
            </ModalBody>
            <ModalFoot>
              <button
                type="button"
                className="btn sm"
                onClick={onClose}
                disabled={isRevising}
                data-testid="revise-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn sm primary"
                onClick={onDispatch}
                disabled={isRevising}
                data-testid="revise-confirm"
              >
                {isRevising ? "Revising…" : `Revise → v${nextVersion}`}
              </button>
            </ModalFoot>
          </>
        )}
        {status.kind === "success" && (
          <>
            <ModalHead>Revised ✓</ModalHead>
            <ModalBody>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                {quoteNumber ?? "This quote"} is now{" "}
                <strong>v{status.newVersionNumber} · draft</strong>. Edit
                anywhere in Setup, Costs, or Pricing — the umbrella
                refreshes when you close this dialog.
              </div>
            </ModalBody>
            <ModalFoot>
              <button
                type="button"
                className="btn sm primary"
                onClick={onClose}
                data-testid="revise-success-close"
              >
                Close
              </button>
            </ModalFoot>
          </>
        )}
        {status.kind === "error" && (
          <>
            <ModalHead>Revise failed</ModalHead>
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
                data-testid="revise-error-message"
              >
                {status.message}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                Nothing was committed — the quote state is unchanged.
              </div>
            </ModalBody>
            <ModalFoot>
              <button
                type="button"
                className="btn sm"
                onClick={onClose}
                data-testid="revise-error-close"
              >
                Close
              </button>
              <button
                type="button"
                className="btn sm primary"
                onClick={onDispatch}
                data-testid="revise-error-retry"
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
