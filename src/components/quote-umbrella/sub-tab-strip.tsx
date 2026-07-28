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
  onGo,
}: {
  activeId: SubTabId;
  quoteStatus: string;
  feedCount: number;
  onGo: (id: SubTabId) => void;
}) {
  const children: React.ReactNode[] = [];

  SUBTABS.forEach((tab, i) => {
    // Lock threshold rule: sits BETWEEN tab 4 (Mark Accepted) and
    // tab 5 (Tier Selection) — the reversible/irreversible boundary.
    if (i === 4) {
      children.push(
        <div
          key="threshold"
          className="r8-threshold"
          aria-hidden="true"
          title="Everything left of this line is reversible"
        >
          <span className="glyph">🔒</span>
          <span className="cap">lock threshold</span>
        </div>,
      );
    }

    const status = subTabStatus(tab, activeId, quoteStatus);
    const clickable = status === "done" || status === "current";
    const numeralGlyph: string =
      status === "done" ? "✓" : status === "locked" ? "🔒" : String(tab.n);
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
          <span className="sub">{subTabSubLabel(tab, status)}</span>
        </span>
      </button>,
    );
  });

  const styleReset: CSSProperties = { fontFamily: "inherit" };
  return (
    <div className="r8-strip" role="tablist" style={styleReset}>
      {children}
    </div>
  );
}
