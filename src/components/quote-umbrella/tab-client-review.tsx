"use client";

// Slice 12 Step 6a — Client Review sub-tab body (read-only feed).
// Pattern 30 port of R8 canonical ReviewTab (umbrella.jsx:414-520).
//
// Ships the feed rendering + empty state + right sidecar. Deferred
// to later sub-steps of Step 6:
//   - AddEntry (Step 6b) — currently rendered as a disabled stub
//   - Revise action + inline "↺ Revise → v{N+1}" affordance (Step 6c)
//   - MismatchBanner (Step 6d)
//
// R8 §4 design intent: reads as a LOG, not a form. Hairline timeline,
// no cards, add-entry collapsed to a single line. The moment this
// surface acquires card chrome + a permanently-open form, it starts
// reading as a task to complete rather than a place to jot. Event
// types are chips, not a select.

import type { ReviewEventRow } from "@/lib/quote-review-events";
import type { SentSnapshotRow } from "@/lib/quote-snapshots";
import type { CustomerView } from "@/types/quote";
import { AdvanceBar } from "./advance-bar";
import { AddEntry } from "./add-entry";
import { computeUmbrellaAdvance } from "./advance-target";
import { MismatchBanner } from "./mismatch-banner";
import { ReviseButton } from "./revise-button";
import type { SubTabId } from "./subtabs";

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function shortDateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

function eventTypeLabel(t: string): string {
  switch (t) {
    case "sent":
      return "Sent";
    case "responded":
      return "Responded";
    case "asked":
      return "Asked";
    case "revision_requested":
      return "Revision requested";
    default:
      return t;
  }
}

function firstName(name: string | null): string {
  if (!name) return "the customer";
  const parts = name.trim().split(/\s+/);
  return parts[0] ?? "the customer";
}

export function TabClientReview({
  view,
  quoteId,
  quoteStatus,
  quoteVersionNumber,
  feed,
  latestSupersededSnapshot,
  onGo,
}: {
  view: CustomerView;
  /** Slice 12 Step 6b — passed through to AddEntry for the
   * addQuoteReviewEvent action FormData. */
  quoteId: string;
  quoteStatus: string;
  quoteVersionNumber: number;
  feed: ReviewEventRow[];
  /** Slice 12 Step 6d — most-recently-superseded snapshot for the
   * quote, if any. Present when the quote has been revised in-place
   * (a prior send exists + Revise fired). Powers the MismatchBanner
   * when combined with status=draft. */
  latestSupersededSnapshot: SentSnapshotRow | null;
  onGo: (id: SubTabId) => void;
}) {
  const customer = view.customer;
  const quote = view.quote;
  const isEmpty = feed.length === 0;
  const isSent = quoteStatus === "sent" || quoteStatus === "accepted";
  // Slice 12 Step 7c review-fix (CB P2 companion) — a draft quote
  // with a superseded snapshot is a POST-REVISE state (v{N+1} being
  // authored while v{N}'s send lives in the archive). In that state
  // the feed IS readable (subtab-strip enables the tab per
  // hasSentHistory), but writes are still blocked pending re-send —
  // so the disabled-reason copy needs to distinguish "not sent yet"
  // (pre-send draft) from "revising a sent quote" (draft w/ history).
  const isDraftWithHistory =
    quoteStatus === "draft" && latestSupersededSnapshot !== null;
  const addEntryDisabledReason: string | undefined = isSent
    ? undefined
    : isDraftWithHistory
      ? "Send the revised version first to log new entries. The prior review log stays readable here."
      : quoteStatus === "draft"
        ? "The Client Review feed opens once the quote is sent."
        : `Feed writes are blocked in '${quoteStatus}' state.`;

  return (
    <div className="r8-wrap">
      <div className="r8-cols">
        <div>
          <p className="eyebrow">Sub-tab 3 · Client Review</p>
          <h1 className="r8-h1">
            Track what comes back from{" "}
            <em>{customer.name ?? "the customer"}</em>
          </h1>
          <p className="r8-sub">
            Your log of the review window — not a message thread, and not
            visible to the customer. Note what they said, what you asked,
            and what they want changed.
          </p>

          {/* Slice 12 Step 6d — MismatchBanner renders when the
              quote is mid-Revise: status=draft AND a superseded
              snapshot exists (post-Revise, pre-re-send). Warns PM
              the customer is still responding to the last-sent
              version. */}
          {quoteStatus === "draft" && latestSupersededSnapshot && (
            <MismatchBanner
              sentSnapshot={latestSupersededSnapshot}
              draftVersion={quoteVersionNumber}
              onGo={onGo}
            />
          )}

          <div className="r8-card flush">
            <div className="r8-card-head">
              <p className="eyebrow" style={{ margin: 0 }}>
                Activity log
              </p>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--ink-4)",
                  letterSpacing: "0.04em",
                }}
              >
                {feed.length > 0
                  ? `${feed.length} ${feed.length === 1 ? "entry" : "entries"} · append-only`
                  : "append-only"}
              </span>
            </div>

            {isEmpty ? (
              <div className="r8-empty">
                <div className="glyph">▤</div>
                <h4>No customer activity logged yet.</h4>
                <p>
                  When {firstName(customer.name)} replies, asks something,
                  or requests changes, log it here so the review window
                  has a record.
                </p>
              </div>
            ) : (
              <div className="r8-feed">
                {feed.map((ev) => (
                  <div
                    key={ev.id}
                    className={`r8-fitem t-${ev.eventType}${ev.system ? " system" : ""}`}
                  >
                    <span className="spine">
                      <span className="dot" />
                    </span>
                    <div>
                      <div className="head">
                        <span className={`r8-etype ${ev.eventType}`}>
                          {eventTypeLabel(ev.eventType)}
                        </span>
                        <span className="who">{ev.authorName}</span>
                        <span className="when">
                          {shortDateTime(ev.createdAt)}
                        </span>
                      </div>
                      {ev.note && <div className="note">{ev.note}</div>}
                      {/* Slice 12 Step 6c — inline revise affordance
                          on revision_requested entries. `Mark handled`
                          is a UI-only convenience (no schema field to
                          persist per v3 — banked for a future feed
                          extension if PMs want it durable). Only shown
                          when the quote is currently revisable
                          (matches server guard). */}
                      {ev.eventType === "revision_requested" && isSent && (
                        <div className="inline-act">
                          <ReviseButton
                            quoteId={quoteId}
                            currentVersionNumber={quoteVersionNumber}
                            quoteNumber={quote.quoteNumber}
                            buttonLabel={`↺ Revise → v${quoteVersionNumber + 1}`}
                            buttonClassName="btn sm"
                            buttonTestId={`revise-from-feed-${ev.id}`}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Slice 12 Step 6b — real AddEntry with server-action
                write. Guard mirrors server-side requireRevisable
                (sent | accepted only). */}
            <AddEntry
              quoteId={quoteId}
              disabled={!isSent}
              disabledReason={addEntryDisabledReason}
            />
          </div>
        </div>

        <div className="r8-side">
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              Revise this quote
            </p>
            <p
              style={{
                margin: "0 0 11px",
                fontSize: 12.5,
                color: "var(--ink-2)",
                lineHeight: 1.55,
              }}
            >
              Returns the sent quote to editable draft as{" "}
              <strong>v{quoteVersionNumber + 1}</strong>. Same quote, same
              number — notes, associations, cost data and this log all
              carry over.
            </p>
            <ReviseButton
              quoteId={quoteId}
              currentVersionNumber={quoteVersionNumber}
              quoteNumber={quote.quoteNumber}
              disabled={!isSent}
              disabledReason={
                isSent
                  ? undefined
                  : `Revise is available on 'sent' and 'accepted' quotes. Current state: '${quoteStatus}'.`
              }
              buttonLabel={`↺ Revise → v${quoteVersionNumber + 1}`}
              buttonClassName="btn"
              buttonStyle={{ width: "100%" }}
              buttonTestId="revise-quote-sidecar"
            />
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 11.5,
                color: "var(--ink-3)",
                lineHeight: 1.5,
              }}
            >
              The customer sees "revised quote {quote.quoteNumber ?? "…"}"{" "}
              — the number never changes.
            </p>
          </div>
          <div className="r8-card">
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              This log is not
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
              <li>customer-facing</li>
              <li>a message thread</li>
              <li>a revision manager</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Slice 12 Step 9 CB P6 pattern-fix — the actual defect CA
          flagged in #154's re-walk. Prior version hardcoded
          "Mark Accepted →" regardless of quoteStatus, so an already-
          accepted quote showed the label pointing backward at a
          done tab. Helper derives target from quoteStatus:
            draft(with history) → Continue to Send →
            sent → Mark Accepted → (unchanged behavior)
            accepted → Sales Order →
            complete → no advance */}
      {(() => {
        const adv = computeUmbrellaAdvance("review", quoteStatus);
        const captionFallback =
          quoteStatus === "complete"
            ? "No advance — umbrella read-only"
            : "Advance available once the quote is sent";
        return (
          <AdvanceBar
            weight="light"
            back={{ label: "Send", onClick: () => onGo("send") }}
            mid={
              <span>
                {/* Slice 12 Step 7c review-fix (CB P4.4) — verbatim R8
                    canonical word order (umbrella.jsx:513):
                    "N logged entry/entries" not "N entries logged". */}
                quote state · {quoteStatus} · {feed.length} logged{" "}
                {feed.length === 1 ? "entry" : "entries"}
              </span>
            }
            caption={adv?.caption ?? captionFallback}
            label={adv?.label}
            onAdvance={adv ? () => onGo(adv.targetTab) : undefined}
            disabled={!adv}
          />
        );
      })()}
    </div>
  );
}
