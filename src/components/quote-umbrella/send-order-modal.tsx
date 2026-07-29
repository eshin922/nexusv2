"use client";

// Slice 12 Step 8c-4 — Send order confirm modal.
// Pattern 30 port of R9 canonical SendOrderModal
// (docs/design-prototypes/dist/round-9/app/r9/ceremony.jsx:337-380).
//
// R9.1-3 explicitly DROPPED the typed FINALIZE gate — the receipt
// carries the weight, and this modal is one screen that names the
// consequence once. Cancel copy is verbatim CD: "Cancel — keep it
// reversible." Primary CTA is the dark-slab heavy button matching
// the AdvanceBar's irreversible-act treatment.
//
// 8c-4 additions (Nexus adaptations — fidelity manifest item):
//   - `sending` state — the confirm button becomes non-pressable
//     while markComplete is in flight; the label reads "Sending…"
//     Cancel is also locked (closing mid-flight would strand the
//     server work). Not in R9 canon; needed because the write is
//     now a real network call, not an inert stub.
//   - `inFlightError` — when the server action returns a
//     structured error, the modal keeps itself open with the error
//     rendered inline next to the summary (same visual register as
//     the disabled-reason banner). PM decides whether to retry
//     (button re-enables) or cancel back to the failed-tab.
//
// Slice 12 Step 10 Q11 (2026-07-29) — wrapped in the standard
// portal-backed Modal shell. Pre-Q11 the confirm content rendered
// as an inline .modal-scrim div INSIDE the SO tab tree — not
// portaled, so the AdvanceBar's Send button behind it stayed in
// the DOM (visible + technically reachable at the wrong z-index
// stack). CB flagged "two live Send buttons visible at once on the
// irreversible action." Now portaled via <Modal> → the tab body
// is out of the interactive tree while the confirm sits in the
// document.body layer.

import type { ReactNode } from "react";
import { Modal } from "@/components/modal/modal";

function usd(n: number, dec = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function SendOrderModal({
  open,
  customerName,
  tierLabel,
  netsuiteCustomerId,
  netsuiteStatusOnPush,
  totalAmount,
  productLineCount,
  oneTimeCount,
  disabled,
  disabledReason,
  sending,
  inFlightError,
  onClose,
  onConfirm,
}: {
  /** Q11 — parent-controlled open state; Modal handles portal +
   * Escape + scrim-click. Was previously conditionally-rendered by
   * the parent, which forced this component to own the scrim div. */
  open: boolean;
  customerName: string;
  tierLabel: string;
  /** NetSuite account id resolved by the parent via preflight
   * (netsuite_customer_map). Rendered verbatim in the summary. */
  netsuiteCustomerId: string;
  /** firm_settings.netsuite_so_status_on_create effective value
   * (e.g. 'Pending Fulfillment'). Server-resolved by page.tsx. */
  netsuiteStatusOnPush: string;
  totalAmount: number;
  productLineCount: number;
  oneTimeCount: number;
  /** Aggregate disabled state from the parent. Compound reasons
   * (below-floor + unmapped customer + no HubSpot company) collapse
   * into a single string rendered inline under the CTA. */
  disabled: boolean;
  disabledReason?: string;
  /** Slice 12 Step 8c-4 — markComplete is in flight. Locks both
   * buttons (cancel included — closing mid-flight would strand the
   * server work). Label reads "Sending…". */
  sending: boolean;
  /** Slice 12 Step 8c-4 — the server action returned an error on
   * the last attempt. Rendered inline; button re-enables so the
   * PM can retry after reading the message. */
  inFlightError: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const buttonsLocked = disabled || sending;
  // Sending state locks close-on-scrim-click too — closing the modal
  // mid-flight would strand the server work. Matches the Cancel
  // button's own `disabled={sending}` treatment.
  const modalClose = sending ? () => {} : onClose;
  return (
    <Modal open={open} onClose={modalClose} size="lg">
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <div className="r8-final-head">
          <p className="eyebrow">Send order · irreversible</p>
          <h2>
            Send this order to NetSuite for <em>{customerName}</em>?
          </h2>
        </div>
        <div className="modal-body">
          <div
            style={{
              background: "var(--paper-2)",
              border: "1px solid var(--rule)",
              borderRadius: 8,
              padding: "13px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--display)",
                  fontSize: 16,
                  fontWeight: 500,
                }}
              >
                {tierLabel} · {netsuiteCustomerId}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 15,
                  color: "var(--ink)",
                }}
              >
                {usd(totalAmount)}
              </span>
            </div>
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                color: "var(--ink-3)",
                marginTop: 5,
                letterSpacing: "0.03em",
              }}
            >
              {productLineCount} product line{productLineCount === 1 ? "" : "s"}
              {" + "}
              {oneTimeCount} one-time · {netsuiteStatusOnPush}
            </div>
          </div>
          <div>
            <p className="eyebrow" style={{ marginBottom: 6 }}>
              This will
            </p>
            <ul className="r8-consequences">
              <li>
                <span className="g">→</span>
                <span>
                  Create the <strong>Sales Order</strong> in NetSuite ·{" "}
                  {netsuiteStatusOnPush}
                </span>
              </li>
              <li>
                <span className="g">→</span>
                <span>
                  Set quote state <code>accepted</code> →{" "}
                  <strong>
                    <code>complete</code>
                  </strong>
                </span>
              </li>
              <li>
                <span className="g">🔒</span>
                <span>
                  Make the{" "}
                  <strong>entire Quote umbrella read-only</strong>
                </span>
              </li>
              <li>
                <span className="g">🔒</span>
                <span>
                  Disable <strong>Revise</strong> and{" "}
                  <strong>roll back acceptance</strong> — both work right
                  up until this click
                </span>
              </li>
            </ul>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.55,
            }}
          >
            Cancelling an order after it exists means cancelling it in
            NetSuite, not here.
          </p>
          {disabled && disabledReason && (
            <p
              style={{
                margin: "10px 0 0",
                padding: "8px 10px",
                background: "var(--warn-soft)",
                border: "1px dashed var(--warn)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--warn-ink, var(--ink-2))",
                lineHeight: 1.5,
              }}
              data-testid="send-order-modal-disabled-reason"
            >
              {disabledReason}
            </p>
          )}
          {inFlightError && (
            <p
              style={{
                margin: "10px 0 0",
                padding: "10px 12px",
                background: "var(--bad-soft, var(--warn-soft))",
                border: "1px solid var(--bad, var(--warn))",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--bad-ink, var(--ink))",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}
              data-testid="send-order-modal-inflight-error"
            >
              <strong
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  marginRight: 8,
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Send failed
              </strong>
              {inFlightError}
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button
            className="btn ghost"
            onClick={onClose}
            disabled={sending}
            data-testid="send-order-modal-cancel"
          >
            {inFlightError ? "Close — retry from the tab" : "Cancel — keep it reversible"}
          </button>
          <button
            className="r8-adv-btn heavy"
            onClick={onConfirm}
            disabled={buttonsLocked}
            data-testid="send-order-modal-confirm"
            title={disabled ? disabledReason : undefined}
          >
            <span className="lock">🔒</span>{" "}
            {sending
              ? "Sending…"
              : inFlightError
                ? "Retry — send order to NetSuite"
                : "Send order to NetSuite"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Exported as a re-usable ConsequenceList for the sub-tab 5 side
// rails (rendered when the modal isn't open, to preview what the
// send will do). Kept in-file since it's R9-canonical to this modal.
export function SendOrderConsequences(): ReactNode {
  return null; // Placeholder — the R9 canon renders these only inside the modal.
}
