"use client";

// Slice 12 Step 7a — Mark Accepted sub-tab body.
// Pattern 30 port of R8 canonical AcceptedTab (umbrella.jsx:522-648).
//
// Two variants driven by quote.status:
//   - sent:     pre-accept form + Mark Accepted button + "recording
//               against" version-info card
//   - accepted: confirmation card + roll-back button (Q7 per R8 §6:
//               "rollback is a peer of the advance, not a hidden
//               admin escape")
//
// Step 7a scope: DB write-path only. HubSpot deal-stage push is
// STUBBED — the sub-tab explicitly banks the pending-HubSpot state
// with a warn-tinted note ("Step 7b wires the real Closed Won push;
// until then, move the HubSpot deal stage manually"). Once Step 7b
// lands, the .r8-push confirmed/error blocks become live indicators
// of the HubSpot API state (per R8 §6 canonical shape).
//
// R8 §6 design intent: the rollback affordance sits PROMINENTLY on
// the surface (not buried in admin), because Mark Accepted is the
// last reversible step and the surface most likely to be
// mis-clicked. Rollback is styled as a peer of the advance.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerView } from "@/types/quote";
import { markAccepted, unmarkAccepted } from "@/app/actions/quotes";
import { AdvanceBar } from "./advance-bar";
import type { SubTabId } from "./subtabs";

function shortDateTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

type ActionState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

export function TabMarkAccepted({
  view,
  quoteId,
  quoteStatus,
  quoteVersionNumber,
  quoteAcceptedAt,
  onGo,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  quoteVersionNumber: number;
  /** PM-internal — the DB row's acceptedAt timestamp for the
   * "accepted by · when" line. Kept off CustomerView per Pattern
   * 45 (accepted status is a PM-facing record, not customer-facing). */
  quoteAcceptedAt: Date | null;
  onGo: (id: SubTabId) => void;
}) {
  const router = useRouter();
  const [_pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>({ kind: "idle" });

  const customer = view.customer;
  const quote = view.quote;

  const isSent = quoteStatus === "sent";
  const isAccepted = quoteStatus === "accepted";

  function fireMark() {
    setState({ kind: "pending" });
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const r = await markAccepted(fd);
      if (!r.ok) {
        setState({ kind: "error", message: r.error.message });
        return;
      }
      setState({ kind: "idle" });
      router.refresh();
    });
  }

  function fireRollback() {
    if (
      !window.confirm(
        "Roll back this acceptance? Quote returns to 'sent'. (Step 7b: HubSpot deal-stage rollback will also fire.)",
      )
    ) {
      return;
    }
    setState({ kind: "pending" });
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const r = await unmarkAccepted(fd);
      if (!r.ok) {
        setState({ kind: "error", message: r.error.message });
        return;
      }
      setState({ kind: "idle" });
      router.refresh();
    });
  }

  const isPending = state.kind === "pending";
  const hasError = state.kind === "error";

  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 4 · Mark Accepted</p>
          <h1 className="r8-h1">
            {isAccepted ? (
              <>
                Acceptance recorded for{" "}
                <em>{customer.name ?? "customer"}</em>
              </>
            ) : (
              <>
                Record <em>{customer.name ?? "customer"}&apos;s</em>{" "}
                acceptance
              </>
            )}
          </h1>
          <p className="r8-sub">
            {isAccepted
              ? "Recorded against the sent version. Reversible — roll back if it was recorded in error."
              : "You're recording acceptance on the customer's behalf. This is reversible: it can be rolled back to Send to Client, which reverses the HubSpot stage."}
          </p>

          {/* Step 7b bank — HubSpot push stubbed. Surface the pending
              integration state so PMs know to move the deal stage
              manually until 7b wires it. */}
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 6,
              background: "var(--warn-soft, #fff4e5)",
              border: "1px solid var(--warn, #d97706)",
              color: "var(--warn, #92400e)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
            data-testid="hubspot-push-deferred-note"
          >
            <strong>HubSpot push not yet wired (Step 7b).</strong> Marking
            accepted flips Nexus state only. For now, move the HubSpot
            deal stage to <strong>Closed Won</strong> manually. Step 7b
            wires the automated push + rollback via{" "}
            <code>getWriteClient()</code>.
          </div>

          {hasError && (
            <div className="r8-push error" style={{ marginTop: 14 }}>
              <span className="mark">!</span>
              <div className="txt">
                <div className="t">Action failed</div>
                <div className="s">{state.message}</div>
              </div>
              <div className="acts">
                <button
                  className="btn sm"
                  onClick={isAccepted ? fireRollback : fireMark}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          <div className="r8-card" style={{ marginTop: 14 }}>
            <p className="eyebrow" style={{ marginBottom: 10 }}>
              Recording against
            </p>
            <div className="r8-defs">
              <div className="row">
                <span className="k">version</span>
                <span className="v">
                  <strong>v{quoteVersionNumber}</strong>
                  {quote.sentDate && (
                    <> — sent {shortDateTime(quote.sentDate)}</>
                  )}
                </span>
              </div>
              <div className="row">
                <span className="k">quote number</span>
                <span className="v">
                  <code>{quote.quoteNumber ?? "—"}</code>
                </span>
              </div>
              <div className="row">
                <span className="k">customer</span>
                <span className="v">{customer.name ?? "—"}</span>
              </div>
              <div className="row">
                <span className="k">accepted by</span>
                <span className="v">
                  {isAccepted
                    ? "you (PM proxy) · " + shortDateTime(quoteAcceptedAt)
                    : "you (PM proxy)"}
                </span>
              </div>
              <div className="row">
                <span className="k">hubspot</span>
                <span className="v">
                  Quote Sent →{" "}
                  <code>Closed Won</code>{" "}
                  <span style={{ color: "var(--ink-4)", fontSize: 11 }}>
                    (manual for now — Step 7b)
                  </span>
                </span>
              </div>
            </div>
          </div>

          {isAccepted && (
            <div className="r8-rollback" style={{ marginTop: 14 }}>
              <div className="t">
                <strong>Recorded in error?</strong> Roll back to Send to
                Client — returns the quote to <code>sent</code>. The
                review log is untouched. (Step 7b will also reverse the
                HubSpot stage.)
              </div>
              <button
                className="btn"
                onClick={fireRollback}
                disabled={isPending}
                data-testid="mark-accepted-rollback"
              >
                {isPending ? "Rolling back…" : "↺ Roll back to Send to Client"}
              </button>
            </div>
          )}
        </div>

        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              Tier comes next
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--ink-2)",
                lineHeight: 1.55,
              }}
            >
              Acceptance records <em>that</em> they accepted. Which tier
              they committed to is Tier Selection — the step that
              finalizes and pushes the Sales Order.
            </p>
          </div>
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              Still reversible here
            </p>
            <ul
              style={{
                margin: 0,
                padding: "0 0 0 18px",
                fontSize: 12,
                color: "var(--ink-3)",
                lineHeight: 1.7,
              }}
            >
              <li>
                Roll back to <code>sent</code>
              </li>
              <li>HubSpot stage reverses (Step 7b)</li>
              <li>Revise into a new version (Step 7b)</li>
              <li>Nothing has entered NetSuite</li>
            </ul>
          </div>
        </div>
      </div>

      {isAccepted ? (
        <AdvanceBar
          weight="light"
          back={{ label: "Client Review", onClick: () => onGo("review") }}
          mid={<span>quote state · accepted · reversible</span>}
          caption="Next step is the irreversible one"
          label="Continue to Tier Selection →"
          onAdvance={() => onGo("tier")}
        />
      ) : (
        <AdvanceBar
          weight="light"
          back={{ label: "Client Review", onClick: () => onGo("review") }}
          mid={<span>quote state · {quoteStatus}</span>}
          caption={
            isSent
              ? "Reversible — rollback available after recording"
              : "Advance available once the quote is sent"
          }
          label={isPending ? "Recording…" : "Record acceptance"}
          onAdvance={isSent ? fireMark : undefined}
          disabled={!isSent || isPending}
        />
      )}
    </div>
  );
}
