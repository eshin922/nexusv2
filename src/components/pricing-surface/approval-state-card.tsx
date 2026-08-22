"use client";

/**
 * The operator-visible below-floor approval state.
 *
 * This exists because connecting the Request trigger without it would create
 * governed state the surface cannot show: the operator clicks, a real request
 * and a real Slack message are created, and the page looks identical. Invisible
 * workflow state is worse than an honest no-op.
 *
 * It renders WORKFLOW state only. Whether acceptance is permitted remains the
 * gate's answer, and this never claims otherwise — see the `approved` copy.
 *
 * `cancelled` and expiry are not rendered because neither is implemented. A UI
 * state for an unreachable transition is a promise the system cannot keep.
 */

import type { ApprovalTierState } from "@/lib/below-floor-approval-state";

const WRAP: React.CSSProperties = {
  margin: "16px 0 0",
  padding: "12px 14px",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  background: "var(--paper-2)",
  fontSize: 12.5,
  lineHeight: 1.55,
};

function when(d: Date | null): string {
  if (!d) return "";
  return ` · ${new Date(d).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function ApprovalStateCard({
  state,
  tierLabel,
}: {
  state: ApprovalTierState;
  tierLabel: string;
}) {
  if (state.kind === "none") return null;

  if (state.kind === "pending") {
    return (
      <div style={{ ...WRAP, borderColor: "var(--warn, #d97706)" }} role="status">
        <strong>Approval pending — {tierLabel}</strong>
        {when(state.requestedAt)}
        <div style={{ color: "var(--ink-2)", marginTop: 4 }}>
          Awaiting a Commercial Approver. The quote stays blocked until the
          decision is recorded in Nexus.
          {/* Delivery is reported because a failed post is invisible otherwise —
              the request is still governed and still blocking, but nobody has
              been told about it. It never implies authority either way. */}
          {!state.delivered && (
            <>
              {" "}
              <strong>The Slack notification could not be delivered</strong> —
              contact the approver directly.
            </>
          )}
        </div>
      </div>
    );
  }

  if (state.kind === "approved") {
    return (
      <div style={{ ...WRAP, borderColor: "var(--good, #15803d)" }} role="status">
        <strong>Approved — {tierLabel}</strong>
        {when(state.decidedAt)}
        <div style={{ color: "var(--ink-2)", marginTop: 4 }}>
          An authorized commercial approver — someone other than whoever priced
          this quote — authorized this tier below the floor.
          {/* Corrected 2026-08-22: this used to say acceptance "must be
              recorded by someone other than the approver". That rule is gone.
              Independence is measured against the quote's operator, so who
              records the acceptance is no longer part of the question. */}
          {" "}
          It stays valid while the tier&rsquo;s economics are unchanged.
        </div>
      </div>
    );
  }

  if (state.kind === "rejected") {
    return (
      <div style={{ ...WRAP, borderColor: "var(--bad)" }} role="status">
        <strong>Rejected — {tierLabel}</strong>
        {when(state.decidedAt)}
        {state.reason && (
          <div style={{ marginTop: 4 }}>
            <em>{state.reason}</em>
          </div>
        )}
        <div style={{ color: "var(--ink-2)", marginTop: 4 }}>
          This tier is not authorized below the floor. Adjust the commercial
          state, or raise a new request if circumstances have changed.
        </div>
      </div>
    );
  }

  if (state.kind === "operator_conflict") {
    return (
      <div style={{ ...WRAP, borderColor: "var(--bad)" }} role="status">
        <strong>Not independently approved — {tierLabel}</strong>
        <div style={{ color: "var(--ink-2)", marginTop: 4 }}>
          The authorization on this tier was granted by the person who priced
          the quote, so it does not satisfy the separation of duties and will be
          refused at send. An authorized commercial approver who did not build
          these numbers must decide it — raise a new request.
        </div>
      </div>
    );
  }

  // superseded
  return (
    <div style={{ ...WRAP }} role="status">
      <strong>Superseded — {tierLabel}</strong>
      <div style={{ color: "var(--ink-2)", marginTop: 4 }}>
        The quote&rsquo;s commercial state changed after this was raised, so it no
        longer applies. Proceed from the current numbers, and raise a new request
        if this tier is still below the floor.
      </div>
    </div>
  );
}
