"use client";

import { useState } from "react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal/modal";
import type { TierCardData } from "./tier-card";

function fmtUSD(n: number, dec = 2) {
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    })
  );
}

// Slice RI.6 — visual shell of AcceptConfirmModal. The Confirm button
// is wired to a console.log stub; real Mark-Accepted action contract
// (status flip, snapshot write, sibling drop, HubSpot writeback)
// lands in Slice 12.

export function AcceptConfirmModal({
  open,
  onClose,
  tier,
  customerName,
  quoteNumber,
  sentVersion,
  activeSiblings,
}: {
  open: boolean;
  onClose: () => void;
  tier: TierCardData;
  customerName: string;
  quoteNumber: string;
  sentVersion: string;
  activeSiblings: ReadonlyArray<{ label: string }>;
}) {
  const [step, setStep] = useState<"confirm" | "locking">("confirm");

  if (step === "locking") {
    return (
      <Modal open={open} onClose={onClose}>
        <div
          style={{
            padding: "32px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "3px solid var(--rule)",
              borderTopColor: "var(--accent)",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <h2
            style={{
              fontFamily: "var(--display)",
              fontSize: 20,
              margin: "20px 0 4px",
              fontWeight: 500,
            }}
          >
            Locking quote…
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>
            Stub — Slice 12 wires snapshot · HubSpot writeback · sibling drop.
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHead>
        <div className="titles">
          <p className="eyebrow">Confirm acceptance · irreversible</p>
          <h2>
            Accept{" "}
            <em style={{ color: "var(--ink-3)" }}>
              {customerName} · {quoteNumber}
            </em>{" "}
            at {tier.label}
          </h2>
        </div>
        <button className="btn ghost sm" onClick={onClose}>
          ✕
        </button>
      </ModalHead>
      <ModalBody>
        <div
          style={{
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            padding: "14px 18px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontFamily: "var(--display)",
                fontSize: 18,
                fontWeight: 500,
              }}
            >
              {tier.label} · {tier.qty.toLocaleString()} units
            </div>
            <div
              className="mono"
              style={{ fontSize: 14, color: "var(--ink)" }}
            >
              {fmtUSD(tier.unitPrice)}/u · {fmtUSD(tier.total, 0)} total
            </div>
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {tier.marginPct === null
              ? "Margin not assessed — no revenue on this tier"
              : `Margin ${tier.marginPct.toFixed(1)}%`}{" "}
            · against {sentVersion}
          </div>
        </div>

        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            This will:
          </p>
          <ul
            style={{
              margin: 0,
              padding: "0 0 0 20px",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.7,
            }}
          >
            <li>
              Lock the quote — no further edits to {sentVersion}
            </li>
            <li>
              Auto-drop {activeSiblings.length} other active scenarios
              {activeSiblings.length > 0
                ? `: ${activeSiblings.map((s) => `"${s.label}"`).join(", ")}`
                : ""}
            </li>
            <li>
              Save your draft as a sibling for reference, status{" "}
              <code>dropped</code>
            </li>
            <li>
              Fire HubSpot writeback (deal stage → Closed-Won, amount →{" "}
              {fmtUSD(tier.total, 0)})
            </li>
            <li>
              Add audit row: <code>accepted</code> by you ·{" "}
              <code>accept_source: manual_button</code>
            </li>
          </ul>
        </div>

        <div className="formfield">
          <label htmlFor="accept-note">Optional: note for the audit log</label>
          <textarea
            id="accept-note"
            placeholder="e.g. Customer accepted via email reply on Apr 30."
          />
        </div>
      </ModalBody>
      <ModalFoot>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          style={{
            background: "var(--accent)",
            borderColor: "var(--accent)",
          }}
          onClick={() => {
            setStep("locking");
            setTimeout(() => {
              setStep("confirm");
              onClose();
            }, 1500);
          }}
        >
          ✓ Confirm · lock {tier.label}
        </button>
      </ModalFoot>
    </Modal>
  );
}
