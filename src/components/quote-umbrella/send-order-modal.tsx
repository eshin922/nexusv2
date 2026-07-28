"use client";

// Slice 12 Step 8b — Send order confirm modal.
// Pattern 30 port of R9 canonical SendOrderModal
// (docs/design-prototypes/dist/round-9/app/r9/ceremony.jsx:337-380).
//
// R9.1-3 explicitly DROPPED the typed FINALIZE gate — the receipt
// carries the weight, and this modal is one screen that names the
// consequence once. Cancel copy is verbatim CD: "Cancel — keep it
// reversible." Primary CTA is the dark-slab heavy button matching
// the AdvanceBar's irreversible-act treatment.
//
// Step 8b scope: modal renders + closes fidelity-perfect but its
// confirm callback is INERT (fires a no-op onConfirm). The parent
// TabSalesOrder wires the CTA's `disabled` attribute so the button
// is un-pressable while the NetSuite write path is stubbed. When
// 8c lands markComplete, the parent flips `disabled=false` and the
// onConfirm callback dispatches the real server action.

import type { ReactNode } from "react";

function usd(n: number, dec = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function SendOrderModal({
  customerName,
  tierLabel,
  netsuiteCustomerId,
  netsuiteStatusOnPush,
  totalAmount,
  productLineCount,
  oneTimeCount,
  disabled,
  disabledReason,
  onClose,
  onConfirm,
}: {
  customerName: string;
  tierLabel: string;
  /** Slice 12 Step 8b — NetSuite account id stub; real value arrives
   * in 8c via the NetSuite customer-match resolution. Rendered
   * verbatim in the modal summary card. */
  netsuiteCustomerId: string;
  /** Slice 12 Step 8b — NetSuite status the SO is created at (per
   * firm config; expected 'Pending Fulfillment'). Rendered in the
   * mono meta line + the primary consequence list item. */
  netsuiteStatusOnPush: string;
  totalAmount: number;
  productLineCount: number;
  oneTimeCount: number;
  /** Slice 12 Step 8b — CA amendment 5: two independent disable
   * reasons (Step 8c stub + below-floor gate) combine into this
   * prop. The parent computes the effective disabled state; this
   * modal renders the disabled visual + shows the reason inline
   * under the CTA when disabled. */
  disabled: boolean;
  disabledReason?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
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
        </div>
        <div className="modal-foot">
          <button
            className="btn ghost"
            onClick={onClose}
            data-testid="send-order-modal-cancel"
          >
            Cancel — keep it reversible
          </button>
          <button
            className="r8-adv-btn heavy"
            onClick={onConfirm}
            disabled={disabled}
            data-testid="send-order-modal-confirm"
            title={disabled ? disabledReason : undefined}
          >
            <span className="lock">🔒</span> Send order to NetSuite
          </button>
        </div>
      </div>
    </div>
  );
}

// Exported as a re-usable ConsequenceList for the sub-tab 5 side
// rails (rendered when the modal isn't open, to preview what the
// send will do). Kept in-file since it's R9-canonical to this modal.
export function SendOrderConsequences(): ReactNode {
  return null; // Placeholder — the R9 canon renders these only inside the modal.
}
