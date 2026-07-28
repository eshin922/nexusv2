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
import { ReviseButton } from "./revise-button";
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
  quoteNumberDb,
  quoteSentAtDb,
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
  /** Slice 12 Step 7c review-fix — PM-facing quote_number from the
   * DB row, bypassing the customer-view projection (which masks
   * quoteNumber to null in draft). This panel is PM-internal;
   * post-Revise the number is preserved on the row and PMs need
   * to see it for continuity assurance. See quote-umbrella.tsx
   * prop docs for full rationale. */
  quoteNumberDb: string | null;
  /** Slice 12 Step 7c review-fix — PM-facing sent_at from the DB
   * row. Present ⟺ quote has been sent at least once. Post-Revise
   * this stays populated (v1's send timestamp). The "sent DATE"
   * line only renders when the CURRENT status is sent/accepted;
   * a draft (post-Revise) suppresses it to avoid the confusing
   * "sent Jul 26 · DRAFT" surface CB flagged. */
  quoteSentAtDb: Date | null;
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
        "Roll back this acceptance? Quote returns to 'sent' AND the HubSpot deal stage reverses to the pre-Accept snapshot.",
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

          {/* Slice 12 Step 7b — HubSpot push is now live. Success
              flips this to a .r8-push.ok confirmation via
              router.refresh; failure shows the .r8-push.error block
              below with retry. */}

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
                  {/* Slice 12 Step 7c review-fix — only render "sent
                      DATE" when the CURRENT status is sent or accepted.
                      A draft (post-Revise) row still carries v1's
                      sent_at (per reviseQuote header rationale — see
                      quote-umbrella.tsx quoteSentAtDb prop docs), so
                      reading it unconditionally shipped "sent Jul 26
                      · DRAFT" post-Revise (CB report P4.5). */}
                  {(isSent || isAccepted) && quoteSentAtDb && (
                    <> — sent {shortDateTime(quoteSentAtDb)}</>
                  )}
                </span>
              </div>
              <div className="row">
                <span className="k">quote number</span>
                <span className="v">
                  {/* Slice 12 Step 7c review-fix — read from PM-facing
                      DB prop, not view.quote.quoteNumber (resolver
                      masks to null in draft; see quote-umbrella.tsx
                      quoteNumberDb prop docs). Post-Revise the DB
                      row's quote_number is preserved (v3 §5.1
                      invariant) and PMs need continuity assurance
                      here. Falls back to em-dash only when the DB
                      column is genuinely NULL (fresh pre-send draft). */}
                  <code>{quoteNumberDb ?? "—"}</code>
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
                  {isAccepted
                    ? "pushed on accept · rollback available"
                    : "pushes deal stage to firm's accept target on record"}
                </span>
              </div>
            </div>
          </div>

          {isAccepted && (
            <div className="r8-rollback" style={{ marginTop: 14 }}>
              <div className="t">
                <strong>Recorded in error?</strong> Roll back to Send to
                Client — returns the quote to <code>sent</code> AND
                reverses the HubSpot deal stage to where it was before
                Accept fired. The review log is untouched.
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <button
                  className="btn"
                  onClick={fireRollback}
                  disabled={isPending}
                  data-testid="mark-accepted-rollback"
                >
                  {isPending
                    ? "Rolling back…"
                    : "↺ Roll back to Send to Client"}
                </button>
                {/* Slice 12 Step 7c — Revise-from-accepted peer of
                    Rollback. Server action rolls back the HubSpot
                    stage first (single primitive; delegates to
                    unmarkAccepted internally) then flips the quote
                    to editable draft with a version bump. Same
                    modal + copy as the Client Review sidecar. */}
                <ReviseButton
                  quoteId={quoteId}
                  currentVersionNumber={quoteVersionNumber}
                  quoteNumber={quote.quoteNumber}
                  disabled={isPending}
                  buttonLabel={`↺ Revise → v${quoteVersionNumber + 1}`}
                  buttonClassName="btn"
                  buttonTestId="mark-accepted-revise"
                />
              </div>
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
              <li>HubSpot stage reverses to the pre-Accept snapshot</li>
              <li>Revise into a new version (rolls back the accept
                first, then flips to editable draft)</li>
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
