"use client";

/**
 * Justification capture for the "Request approval" action.
 *
 * REUSES THE MODAL PATTERN, NOT `OverrideModal`. The mark-accepted modal carries
 * workflow-specific state this path does not share — a Slack DM preview block,
 * an `alert()` stub confirm, and props framed around mark-accepted's flagged
 * lines. Coupling to it would drag that surface's assumptions into Pricing. The
 * shared `Modal` primitives are the part worth reusing.
 *
 * It asks the one question the server action requires and cannot answer itself.
 * Eligibility, policy and tier selection are decided upstream.
 */

import { useEffect, useState } from "react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal/modal";

export function RequestOverrideModal({
  open, onClose, onSubmit, tierLabel, blendedMarginPct, floorPct, pending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (justification: string) => void;
  /** Named explicitly: a request authorizes ONE tier, not the whole quote. */
  tierLabel: string;
  blendedMarginPct: number | null;
  floorPct: number;
  pending: boolean;
  error: string | null;
}) {
  const [justification, setJustification] = useState("");

  // Reset between openings so a stale draft cannot be submitted against a tier
  // whose pricing changed underneath it.
  useEffect(() => {
    if (open) setJustification("");
  }, [open]);

  // Client-side guard only. `requestBelowFloorApproval` performs the same check
  // and remains authoritative — this exists so the operator is told before a
  // round trip, not so the server can trust the input.
  const blank = justification.trim() === "";
  const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHead>
        <div className="titles">
          <p className="eyebrow" style={{ color: "var(--bad)" }}>
            Request approval · below floor
          </p>
          <h2>Why should this be approved?</h2>
        </div>
      </ModalHead>

      <ModalBody>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--ink-2)" }}>
          This asks a Commercial Approver to authorize <strong>{tierLabel}</strong>{" "}
          at <strong>{pct(blendedMarginPct)}</strong>, below the firm floor of{" "}
          <strong>{pct(floorPct)}</strong>. Your reason goes to them with the request.
        </p>

        <div className="formfield">
          <label htmlFor="bf-justification">Justification (required)</label>
          <textarea
            id="bf-justification"
            rows={4}
            value={justification}
            // Never disabled while pending — Pattern 47(e): disabling an input
            // mid-flight drops focus. The submit button carries pending state.
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Why this quote should be approved below the margin floor."
          />
        </div>

        {error && (
          <p role="alert" style={{
            margin: "12px 0 0", padding: "8px 10px", fontSize: 12.5,
            color: "var(--bad)", border: "1px solid var(--bad)", borderRadius: 6,
          }}>
            {error}
          </p>
        )}
      </ModalBody>

      <ModalFoot>
        <button className="btn ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button className="btn primary" disabled={blank || pending}
          onClick={() => onSubmit(justification)}>
          {pending ? "Sending…" : "Send request"}
        </button>
      </ModalFoot>
    </Modal>
  );
}
