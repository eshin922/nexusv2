"use client";

import { useState } from "react";
import {
  Modal,
  ModalHead,
  ModalBody,
  ModalFoot,
} from "@/components/modal/modal";

// Slice RI.6 — visual shell of OverrideModal. Real Slack DM dispatch +
// override audit + approval round-trip lands Slice 12.

export function OverrideModal({
  open,
  onClose,
  customerName,
  quoteNumber,
  blendedMarginPct,
  floorPct,
  flaggedLineCount,
}: {
  open: boolean;
  onClose: () => void;
  customerName: string;
  quoteNumber: string;
  blendedMarginPct: number;
  floorPct: number;
  flaggedLineCount: number;
}) {
  const [reason, setReason] = useState("");

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHead>
        <div className="titles">
          <p className="eyebrow" style={{ color: "var(--bad)" }}>
            Request admin override · below-floor send
          </p>
          <h2>
            Override gates on{" "}
            <em style={{ color: "var(--ink-3)" }}>
              {customerName} · {quoteNumber}
            </em>
          </h2>
        </div>
        <button className="btn ghost sm" onClick={onClose}>
          ✕
        </button>
      </ModalHead>
      <ModalBody>
        <div
          style={{
            background: "var(--bad-soft)",
            border: "1px solid oklch(from var(--bad) l c h / 0.4)",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <p
            className="eyebrow"
            style={{ color: "var(--bad)", marginBottom: 6 }}
          >
            Gates being overridden
          </p>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.7,
            }}
          >
            ▸ <strong>Quote-level:</strong> blended margin{" "}
            {blendedMarginPct.toFixed(1)}% (floor {(floorPct * 100).toFixed(1)}
            %)
            <br />▸ <strong>Line-level:</strong> {flaggedLineCount} line(s)
            below floor
          </div>
        </div>

        <div className="formfield">
          <label htmlFor="override-reason">
            Reason for override · required
          </label>
          <textarea
            id="override-reason"
            placeholder="e.g. Strategic Q2 win — Lumen referenced as anchor reference for incoming Sephora RFP. Margin recovery planned via T4 PO followups in Q3."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="helper">
            Logged to <code>quote_warnings.override_reason</code> · permanent
            record · visible to leadership.
          </div>
        </div>

        <div className="formfield">
          <label>Approval request preview</label>
          <div className="slack-preview">
            <div className="slack-head">
              <div className="slack-logo">S</div>
              <div className="slack-to">
                to <strong>@admin · sales-leadership</strong>
              </div>
            </div>
            <div className="slack-msg">
              <span className="mention">@admin</span> requesting below-floor
              override on{" "}
              <strong>
                {customerName} · {quoteNumber}
              </strong>
              .{"\n"}Blended margin{" "}
              <strong>{blendedMarginPct.toFixed(1)}%</strong> (floor{" "}
              {(floorPct * 100).toFixed(1)}%). {flaggedLineCount} line(s)
              UNDERPRICED.{"\n"}
              {reason ? (
                <>
                  Reason: <em>&ldquo;{reason}&rdquo;</em>
                </>
              ) : (
                <em style={{ color: "var(--ink-4)" }}>
                  [reason will appear here once you fill it in]
                </em>
              )}
            </div>
          </div>
          <div className="helper">
            Stub — Slice 12 wires Slack DM dispatch + thread-approval round-trip.
          </div>
        </div>
      </ModalBody>
      <ModalFoot>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <div className="row gap-2">
          <button
            className="btn"
            onClick={() => alert("Stub — Slice 12 saves draft override.")}
          >
            Save draft (don&rsquo;t send yet)
          </button>
          <button
            className="btn bad"
            disabled={!reason.trim()}
            onClick={() => {
              alert("Stub — delivery is not built; this logs nothing yet.");
              onClose();
            }}
          >
            ⚡ Log override request
          </button>
        </div>
      </ModalFoot>
    </Modal>
  );
}
