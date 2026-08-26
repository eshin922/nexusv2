"use client";

// Slice 12 Step 1 — SubTabStrip.
// Pattern 30 port of R8 canonical `SubTabStrip` in
// docs/design-prototypes/dist/round-8/app/r8/umbrella.jsx:17-74.
//
// Structural + polish notes (Pattern 27 two-layer):
//   - `.r8-strip` root; 5 direct-child `.r8-tab` buttons + one
//     `.r8-threshold` marker between tabs 4 and 5 (the lock threshold,
//     designer notes §0 · the asymmetry is the deliverable).
//   - Client Review carries `.log` modifier (rounded-square numeral +
//     dotted underline + optional feed count) per designer notes §1.
//   - Numeral glyph: '✓' when done, '🔒' when locked, else the number.
//   - Sub-label register: mono lowercase; per-tab copy from subTabSubLabel.
//
// Behavior:
//   - Only `done` and `current` tabs are clickable (upcoming = disabled;
//     locked = disabled). `done` tabs are clickable because the model
//     is reversible below Complete.
//   - Clicking navigates via `onGo(id)` — the caller drives the URL
//     rewrite (query-param strategy per Step 1 planning).

import type { CSSProperties } from "react";
import {
  SUBTABS,
  subTabStatus,
  subTabSubLabel,
  type SubTabId,
} from "./subtabs";

export function SubTabStrip({
  activeId,
  quoteStatus,
  feedCount,
  hasSentHistory,
  lockBlocked = false,
  onGo,
}: {
  activeId: SubTabId;
  quoteStatus: string;
  feedCount: number;
  /** Slice 12 Step 7c review-fix (CB P2) — true when the quote has
   * been sent at least once (current status is sent+ OR a superseded
   * quote_snapshots row exists). Enables Client Review reachability
   * in draft-with-history state (post-Revise); a fresh pre-send
   * draft has neither and Client Review stays 'upcoming'. Derived
   * at the umbrella level from `quoteStatus + latestSupersededSnapshot`. */
  hasSentHistory: boolean;
  /** A predicted identity refusal on the Sales Order step. Renders the lock
   * tab as "blocked" so the strip cannot advertise a send that would refuse. */
  lockBlocked?: boolean;
  onGo: (id: SubTabId) => void;
}) {
  const children: React.ReactNode[] = [];

  SUBTABS.forEach((tab, i) => {
    // Lock threshold rule: sits BETWEEN tab 4 (Acceptance) and
    // tab 5 (Sales Order) — the reversible/irreversible boundary.
    // Slice 12 Step 8a — R9.1-2 rename: caption "lock threshold" →
    // "lock". Same visual role, tighter copy per data.js rename map.
    // Visual armed state (dashed → solid) driven by the parent's
    // `.r9-armed-strip` class per §4 "the rule is armed precisely
    // when the PM is cleared to cross it" — see r9-quote-umbrella-
    // addendum.css `.r9-armed-strip .r8-threshold` override.
    if (i === 4) {
      children.push(
        <div
          key="threshold"
          className="r8-threshold"
          aria-hidden="true"
          title="Everything left of this line is reversible"
        >
          <span className="glyph">🔒</span>
          <span className="cap">lock</span>
        </div>,
      );
    }

    const status = subTabStatus(tab, activeId, quoteStatus, hasSentHistory);
    const clickable = status === "done" || status === "current";
    // Slice 12 Step 8c-4 CB P2 — lock-kind tabs (Sales Order) never
    // render the ✓ glyph. "Done" for a lock-kind tab means
    // "reachable — quote has been accepted"; it does NOT mean the SO
    // has been placed. The ✓ collides visually with the genuinely-
    // completed done state on non-lock tabs (Preview / Send / Client
    // Review / Mark Accepted) and reads as "already sent" on the one
    // tab where that misread is worst. Keep the numeral until the
    // send actually lands — at which point quoteStatus flips to
    // 'complete' and this tab's status becomes 'locked' → 🔒 glyph.
    const numeralGlyph: string =
      status === "locked"
        ? "🔒"
        : status === "done" && tab.kind !== "lock"
          ? "✓"
          : String(tab.n);
    const classNames: string[] = ["r8-tab", status];
    if (tab.kind === "log") classNames.push("log");

    children.push(
      <button
        key={tab.id}
        role="tab"
        aria-selected={status === "current"}
        className={classNames.join(" ")}
        onClick={clickable ? () => onGo(tab.id) : undefined}
        disabled={!clickable}
      >
        <span className="num">{numeralGlyph}</span>
        <span className="txt">
          <span className="lab">
            {tab.label}
            {tab.kind === "log" && feedCount > 0 && (
              <span className="feedcount">{feedCount}</span>
            )}
          </span>
          <span className="sub">{subTabSubLabel(tab, status, lockBlocked)}</span>
        </span>
      </button>,
    );
  });

  const styleReset: CSSProperties = { fontFamily: "inherit" };
  // Slice 12 Step 8a — R9 §4: "the strip's lock threshold goes from
  // dashed to solid once acceptance is recorded — the rule is armed
  // precisely when the PM is cleared to cross it." Arm the strip
  // once the quote enters 'accepted' (or 'complete') state; the
  // paired CSS override lives in r9-quote-umbrella-addendum.css
  // (`.r9-armed-strip .r8-threshold`).
  const armed = quoteStatus === "accepted" || quoteStatus === "complete";
  const stripClass = "r8-strip" + (armed ? " r9-armed-strip" : "");
  return (
    <div className={stripClass} role="tablist" style={styleReset}>
      {children}
    </div>
  );
}
