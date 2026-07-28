"use client";

// Slice 12 Step 5c — Send to Client sub-tab body.
// Pattern 30 port of R8 canonical SendTab (umbrella.jsx:226-343).
//
// TWO variants driven by quote.status:
//   - draft:  pre-send state — recipient info card + "what sending does"
//             sidecar. Send button + confirm modal deferred to Step 5d
//             (needs to lift PDF axis state to URL first so this tab
//             can access PM's current toggle choices). For Step 5c,
//             pre-send state directs PMs back to Preview for the Send
//             action; Advance-bar caption + disabled label reflect it.
//   - sent+:  waiting state — .r8-wait pulse dot + sent-to details +
//             days-elapsed + valid-until + feed count. Revise
//             affordance stub (real Revise action = Step 6).
//
// Nexus adaptations (Pattern 39 extensions):
//   - Sent-only status → waiting. Nexus supports accepted / complete
//     too; for the Send tab both render the waiting-state UI
//     (informational; the actual acceptance/completion happens on
//     subsequent sub-tabs). Pattern 39.
//   - "Days elapsed" computed client-side from sentAt. R8 hardcodes 13
//     for its fixture; Nexus computes.
//   - Feed count comes from real quote_review_events data (Step 5c
//     shipped the count reader; Step 5b was the first writer so any
//     sent quote has at least 1 entry — the system 'sent' log).

import type { CustomerView } from "@/types/quote";
import { AdvanceBar } from "./advance-bar";
import type { SubTabId } from "./subtabs";

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysElapsedSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso.length === 10 ? iso + "T00:00:00" : iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (24 * 60 * 60 * 1000)));
}

// Extract first name from a full name for the "awaiting {name}" copy.
function firstName(name: string | null): string {
  if (!name) return "customer";
  const parts = name.trim().split(/\s+/);
  return parts[0] ?? "customer";
}

export function TabSendToClient({
  view,
  quoteId,
  quoteStatus,
  quoteVersionNumber,
  reviewFeedCount,
  isHubspotLinked,
  onGo,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  /** PM-internal version number for the "v{N}" copy + Revise's
   * "flips to v{N+1}" preview. Kept out of CustomerView per
   * Pattern 45 (customer-facing type stays PM-versioning-clean). */
  quoteVersionNumber: number;
  reviewFeedCount: number;
  isHubspotLinked: boolean;
  onGo: (id: SubTabId) => void;
}) {
  const isDraft = quoteStatus === "draft";
  const isSent = !isDraft; // sent | accepted | complete | superseded | lost

  const customer = view.customer;
  const quote = view.quote;
  const sentAtIso = quote.sentDate;
  const daysAgo = daysElapsedSince(sentAtIso);
  const firstNameOfCustomer = firstName(customer.name);

  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 2 · Send to Client</p>

          {isSent ? (
            <>
              <h1 className="r8-h1">
                Sent — <em>awaiting {firstNameOfCustomer}</em>
              </h1>
              <p className="r8-sub">
                The quote is with the customer. Nothing further is required
                of you here; log what comes back in Client Review.
              </p>
              <div className="r8-wait">
                <span className="pulse" />
                <div className="txt">
                  <h4>
                    {quote.quoteNumber ?? "(draft)"} sent to{" "}
                    {customer.name ?? "customer"}
                  </h4>
                  <p>
                    Sent {shortDate(sentAtIso)}
                    {daysAgo !== null && ` · ${daysAgo} days ago`}. Valid
                    until {shortDate(quote.validUntil)}.
                    Customer activity gets logged in Client Review — {reviewFeedCount}{" "}
                    {reviewFeedCount === 1 ? "entry" : "entries"} so far.
                  </p>
                  <span className="meta">
                    quote.state = {quoteStatus} · sent_at{" "}
                    {sentAtIso ?? "—"}
                  </span>
                  <div className="acts">
                    <button
                      className="btn sm"
                      onClick={() => onGo("review")}
                    >
                      Open Client Review →
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        // Re-send stub — Step 5d wires the real re-send
                        // once the Send button moves to this tab.
                        window.alert(
                          "Re-send action lands in Step 5d (Send button move). Until then, use Preview → Send to send.",
                        );
                      }}
                    >
                      Re-send PDF
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        window.open(
                          `/api/quotes/${quoteId}/customer-pdf?download=1`,
                          "_blank",
                        );
                      }}
                    >
                      ⤓ Download sent PDF
                    </button>
                  </div>
                </div>
              </div>

              {/* Revise affordance — R8 §5. Real Revise action lands in
                  Step 6. Button here + stub so PMs see the shape now. */}
              <div className="r8-revise" style={{ marginTop: 14 }}>
                <div className="txt">
                  <div className="t">Need to change something?</div>
                  <div className="s">
                    Revise returns this quote to editable draft as v
                    {quoteVersionNumber + 1}. Same quote, same number —
                    nothing is lost.
                  </div>
                </div>
                <button
                  className="btn sm"
                  onClick={() => {
                    window.alert(
                      "Revise-in-place action lands in Step 6. This affordance ships its final wire-up then.",
                    );
                  }}
                  title="Revise action lands in Step 6 (Client Review + Revise-in-place)."
                >
                  ↺ Revise quote
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="r8-h1">
                Send {quote.quoteNumber ?? "this quote"} to{" "}
                <em>{customer.name ?? "customer"}</em>
              </h1>
              <p className="r8-sub">
                {customer.name ?? "The customer"} will receive the customer
                PDF by email. Sending is reversible — you can revise and
                re-send as a new version at any point before acceptance
                is finalized.
              </p>
              <div className="r8-card">
                <div className="r8-defs">
                  <div className="row">
                    <span className="k">recipient</span>
                    <span className="v">{customer.name ?? "—"}</span>
                  </div>
                  <div className="row">
                    <span className="k">version</span>
                    <span className="v">
                      v{quoteVersionNumber} (draft)
                    </span>
                  </div>
                  <div className="row">
                    <span className="k">valid until</span>
                    <span className="v">
                      {shortDate(quote.validUntil)}
                    </span>
                  </div>
                </div>
              </div>
              {/* Send-button placement note — Step 5c ships the visual;
                  Step 5d moves the Send button + confirm modal here from
                  the Preview toolbar (deferred because it requires lifting
                  PM's PDF axis state to URL params first, so this tab can
                  read the current toggle state at send time). */}
              <div
                style={{
                  marginTop: 16,
                  padding: "12px 14px",
                  borderRadius: 6,
                  background: "var(--paper-2)",
                  border: "1px solid var(--rule)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "var(--ink-2)",
                }}
              >
                <div style={{ marginBottom: 4 }}>
                  <strong>Sending action stays on Preview for now.</strong>
                </div>
                Use{" "}
                <button
                  className="btn ghost sm"
                  style={{ padding: "1px 8px", verticalAlign: "baseline" }}
                  onClick={() => onGo("preview")}
                >
                  ← back to Preview
                </button>{" "}
                to review the PDF and hit the Send button in the toolbar.
                Step 5d moves the Send action here once PDF axis state is
                URL-driven.
                {!isHubspotLinked && (
                  <div
                    role="alert"
                    style={{
                      marginTop: 8,
                      padding: 8,
                      borderRadius: 4,
                      background: "var(--warn-soft, #fff4e5)",
                      color: "var(--warn, #92400e)",
                      fontSize: 12,
                    }}
                  >
                    This deal isn&apos;t linked to HubSpot. Push it to
                    HubSpot before sending.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right column — R8 §"What sending does" sidecar */}
        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              What sending does
            </p>
            <ol
              style={{
                margin: 0,
                padding: "0 0 0 18px",
                fontSize: 12.5,
                color: "var(--ink-2)",
                lineHeight: 1.7,
              }}
            >
              <li>Renders and stores the customer PDF</li>
              <li>
                Quote state <code>draft</code> → <code>sent</code>
              </li>
              <li>
                Stamps <code>sent_at</code> and assigns a customer-facing
                quote number
              </li>
              <li>Opens Client Review for logging</li>
              <li>
                Logs a <code>sent</code> feed entry
              </li>
            </ol>
            <p
              style={{
                margin: "12px 0 0",
                fontSize: 11.5,
                color: "var(--ink-3)",
                lineHeight: 1.5,
              }}
            >
              It does <strong>not</strong> lock anything. Revise stays
              available.
            </p>
          </div>
        </div>
      </div>

      {isSent ? (
        <AdvanceBar
          weight="light"
          back={{ label: "Preview", onClick: () => onGo("preview") }}
          mid={<span>quote state · {quoteStatus} · awaiting customer</span>}
          caption="Reversible — Mark Accepted can be rolled back"
          label="Mark Accepted →"
          onAdvance={() => onGo("accepted")}
        />
      ) : (
        <AdvanceBar
          weight="light"
          back={{ label: "Preview", onClick: () => onGo("preview") }}
          mid={<span>quote state · draft</span>}
          caption="Send from Preview — Step 5d moves the action here"
          label="Send from Preview →"
          onAdvance={() => onGo("preview")}
        />
      )}
    </div>
  );
}
