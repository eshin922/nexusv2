"use client";

import { useState, useTransition } from "react";
import type { FreightHandoffState } from "@/app/actions/freight-handoff";
import {
  completeFreightHandoff,
  getFreightHandoff,
  markReadyForFreight,
  withdrawFreightRequest,
} from "@/app/actions/freight-handoff";
import type { ActionResult } from "@/lib/action-result";

/**
 * The packaging → logistics handoff, on the surface where both halves of it
 * happen.
 *
 * ── IT REPORTS A DECISION, NOT A STATE OF THE DATA ───────────────────────
 *
 * Nothing here inspects whether the packaging tiers look costed, and the
 * button is never disabled on that basis. Marking packaging ready is a
 * judgement an operator makes; this records that they made it. A control that
 * waited for the fields to look finished would be answering a different
 * question and refusing work on the answer.
 *
 * ── A FAILED NOTIFICATION IS SAID OUT LOUD ───────────────────────────────
 *
 * The handoff exists whether or not Slack accepted the message, so the
 * delivery outcome is shown as what it was. Reporting a silent failure as a
 * success would leave a PM believing logistics had been told.
 */
export function FreightHandoffBar({
  quoteId,
  initial,
  viewerUserId,
  viewerIsAdmin,
  editable,
}: {
  quoteId: string;
  initial: FreightHandoffState | null;
  viewerUserId: string;
  viewerIsAdmin: boolean;
  editable: boolean;
}) {
  const [handoff, setHandoff] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Pattern 47(f) -- pending state is ACTION-SCOPED. One flag naming WHICH
  // action is in flight, so completing a handoff never greys out withdrawing
  // it, and neither disables anything else on the page.
  const run = (
    name: string,
    fn: (fd: FormData) => Promise<ActionResult<unknown>>,
    onOk: () => void,
  ) => {
    setError(null);
    setPendingAction(name);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const result = await fn(fd);
      setPendingAction(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onOk();
    });
  };

  const ready = () =>
    run("ready", markReadyForFreight, async () => {
      // Re-read rather than assume. The action returns the handoff that
      // actually exists -- including, on the second click of a double-click,
      // the one that was already open.
      const r = await getFreightHandoff(quoteId);
      if (r.ok) setHandoff(r.data);
    });

  const frame = (accent: string, bg: string) => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
    padding: "10px 14px",
    margin: "0 0 14px",
    border: `1px solid ${accent}`,
    borderLeft: `3px solid ${accent}`,
    borderRadius: 6,
    background: bg,
  });

  const label: React.CSSProperties = {
    fontSize: 13,
    color: "var(--ink)",
    minWidth: 0,
    flex: 1,
  };

  const btn = (primary: boolean): React.CSSProperties => ({
    fontSize: 12,
    padding: "5px 11px",
    borderRadius: 5,
    border: primary ? "1px solid var(--accent)" : "1px solid var(--rule)",
    background: primary ? "var(--accent)" : "var(--paper)",
    color: primary ? "var(--paper)" : "var(--ink-2)",
    cursor: "pointer",
    flexShrink: 0,
  });

  if (!handoff) {
    if (!editable) return null;
    return (
      <section style={frame("var(--rule)", "var(--paper-2)")} aria-label="Freight handoff">
        <span style={label}>
          Packaging finished? Hand the freight work to logistics.
        </span>
        {error && <Err text={error} />}
        <button
          type="button"
          style={btn(true)}
          onClick={ready}
          disabled={pendingAction === "ready"}
        >
          {pendingAction === "ready" ? "Sending…" : "Ready for freight"}
        </button>
      </section>
    );
  }

  const canComplete = viewerIsAdmin || viewerUserId === handoff.assignedToUserId;
  const accent = "oklch(from var(--accent) l c h / 0.30)";

  return (
    <section
      style={frame(accent, "oklch(from var(--accent) l c h / 0.07)")}
      aria-label="Freight handoff"
    >
      <span style={label}>
        <strong style={{ fontWeight: 500 }}>Packaging ready — freight needed.</strong>{" "}
        <span style={{ color: "var(--ink-3)" }}>
          With {handoff.assignedToEmail ?? "logistics"} since{" "}
          {handoff.requestedAt.toLocaleDateString()}.
          {handoff.notificationStatus === "failed" &&
            " Slack was not notified — tell them directly."}
          {handoff.notificationStatus === "not_configured" &&
            " No Slack notification was sent; none is configured."}
        </span>
      </span>
      {error && <Err text={error} />}
      {canComplete && (
        <button
          type="button"
          style={btn(true)}
          onClick={() =>
            run("complete", completeFreightHandoff, () => setHandoff(null))
          }
          disabled={pendingAction === "complete"}
        >
          {pendingAction === "complete" ? "Saving…" : "Freight complete"}
        </button>
      )}
      {editable && (
        <button
          type="button"
          style={btn(false)}
          onClick={() =>
            run("withdraw", withdrawFreightRequest, () => setHandoff(null))
          }
          disabled={pendingAction === "withdraw"}
        >
          {pendingAction === "withdraw" ? "Withdrawing…" : "Withdraw request"}
        </button>
      )}
    </section>
  );
}

function Err({ text }: { text: string }) {
  return (
    <span role="alert" style={{ fontSize: 12, color: "var(--danger, #b42318)" }}>
      {text}
    </span>
  );
}
