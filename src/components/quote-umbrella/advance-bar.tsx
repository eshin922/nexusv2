"use client";

// Slice 12 Step 1 — AdvanceBar primitive.
// Pattern 30 port of R8 canonical `AdvanceBar` in umbrella.jsx:86-105.
//
// The `weight` prop encodes the design asymmetry from R8 §0:
//   light — 4 reversible transitions (Preview → Send, Send → …,
//           Client Review → Mark Accepted, Mark Accepted → …).
//           Ordinary primary button.
//   heavy — the ONE irreversible transition (Tier Selection →
//           Complete). Dark ceremonial slab, lock glyph, 2px top rule
//           on the bar. Do NOT normalize this asymmetry — designer
//           notes §0 explicitly names it "the deliverable."
//
// Step 1 renders the primitive; heavy variant only wires up in Step 8
// (the actual NetSuite Advance). Every Advance in Steps 4-7 uses light.

import type { ReactNode } from "react";

export type AdvanceBarProps = {
  weight?: "light" | "heavy";
  label?: string;
  caption?: string;
  mid?: ReactNode;
  back?: { label: string; onClick: () => void };
  onAdvance?: () => void;
  disabled?: boolean;
};

export function AdvanceBar({
  weight = "light",
  label,
  caption,
  mid,
  back,
  onAdvance,
  disabled,
}: AdvanceBarProps) {
  const heavy = weight === "heavy";
  const barClass = "r8-advance" + (heavy ? " heavy" : "");
  const btnClass = "r8-adv-btn" + (heavy ? " heavy" : "");
  return (
    <div className={barClass}>
      <div className="back">
        {back && (
          <button className="btn ghost sm" onClick={back.onClick}>
            ← {back.label}
          </button>
        )}
      </div>
      <div className="mid">{mid}</div>
      <div className="fwd">
        {caption && <span className="cap">{caption}</span>}
        {label && (
          <button
            className={btnClass}
            onClick={onAdvance}
            disabled={disabled}
          >
            {heavy && <span className="lock">🔒</span>}
            {label}
          </button>
        )}
      </div>
    </div>
  );
}
