"use client";

import { useState } from "react";
import type { QuoteMarginStatus } from "@/lib/costing";
import { MarkAcceptedGood } from "./mark-accepted-good";
import {
  MarkAcceptedBothGates,
  type FlaggedLine,
} from "./mark-accepted-both-gates";
import { MarkAcceptedPending } from "./mark-accepted-pending";
import { MarkAcceptedLocked } from "./mark-accepted-locked";
import type { TierCardData } from "./tier-card";

export type MarkAcceptedSubState =
  | "good"
  | "awaitingMark"
  | "bothGates"
  | "pending"
  | "locked";

// Slice RI.7 — customer-acceptance signal recorded but PM hasn't
// finalized Mark-Accepted yet. Same component tree as `good`; the
// affirmation chip + auto-select-tier are the visual differences.
// (Per CR-SM DEC-6: extend the `good` sub-state with an affirmation
// chip rather than spinning up a new component.)
export type CustomerAcceptanceContext = {
  tierId: string;
  tierLabel: string;
  recordedAt: Date;
};

export function MarkAcceptedHost({
  initialSubState,
  blendedMarginPct,
  status,
  targetPct,
  floorPct,
  tiers,
  customerName,
  quoteNumber,
  flaggedLines,
  activeSiblings,
  customerAcceptance,
  showStateSwitcher,
}: {
  initialSubState: MarkAcceptedSubState;
  /** Percent units (0..100), or null when the quote has no margin. */
  blendedMarginPct: number | null;
  status: QuoteMarginStatus;
  targetPct: number;
  floorPct: number;
  tiers: TierCardData[];
  customerName: string;
  quoteNumber: string;
  flaggedLines: FlaggedLine[];
  activeSiblings: ReadonlyArray<{
    id: string;
    label: string;
    margin: number;
    lastEdit: string;
  }>;
  customerAcceptance: CustomerAcceptanceContext | null;
  showStateSwitcher: boolean;
}) {
  const [subState, setSubState] =
    useState<MarkAcceptedSubState>(initialSubState);

  // The recorded recommendation, or none.
  //
  // This fell back to `tiers[Math.floor(tiers.length / 2)]` — the middle tier —
  // so a quote with no recommendation showed one anyway, and the `locked` panel
  // named it as the ACCEPTED tier. Position is not a recommendation: the same
  // inference the customer PDF made with index 0 and Mark-Accepted's page made
  // with the middle tier, all three now removed.
  //
  // The `locked` render already guards on this being present, so a quote
  // without one renders nothing there rather than a tier nobody chose.
  const recommendedTier = tiers.find((t) => t.recommended);

  return (
    // Sweep Step 5/N — adopt `r3-shared` parent-scope class so the
    // canonical R3 rules (now under .r3-shared { ... } in
    // src/styles/r3-shared.css) resolve for Mark-Accepted's
    // .macc-* / .state-sub / .mono / .muted vocabulary. Same shape
    // Quote adopted in Step 4.1/N — the shared file serves both
    // surfaces under the single namespace.
    //
    // Step 10 Edward smoke fix (2026-05-14) — `r3-shared` lives on a
    // dedicated PARENT div, separate from `macc-stage`. CSS Nesting
    // Level 1 compiles `.r3-shared { .macc-stage { ... } }` to
    // `.r3-shared .macc-stage` (descendant combinator), not same-
    // element compound. Splitting into nested divs makes the rule
    // resolve. Same regression Quote caught (diagonal-pattern
    // .preview-chrome background was missing).
    <div className="r3-shared">
    <div className="macc-stage">
      {/* Step 10 audit MEDIUM-7 fix — top breadcrumb strip migrated
          from inline-style hardcodes to canonical `.r3-surface-bar`
          register from r3-shared.css. Same shape as the Quote
          surface's preview-toolbar (sticky top, paper-2 background,
          rule border, mono crumb copy). `.r3-surface-bar` provides
          all the visual register; `justify-content: space-between`
          + `flex-1` on .crumb let the state-switcher cluster sit
          right-aligned in the dev mode. */}
      <div
        className="r3-surface-bar"
        style={{ justifyContent: "space-between" }}
      >
        <div className="crumb">
          Pricing · {customerName} · {quoteNumber} ·{" "}
          <strong>Mark accepted</strong>
        </div>
        {showStateSwitcher && (
          <div
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              className="mono muted"
              style={{ fontSize: 9.5, letterSpacing: 0.06 }}
            >
              prototype state →
            </span>
            <div className="state-sub">
              <button
                className={subState === "good" ? "active" : ""}
                onClick={() => setSubState("good")}
              >
                ① GOOD
              </button>
              <button
                className={subState === "awaitingMark" ? "active" : ""}
                onClick={() => setSubState("awaitingMark")}
              >
                ② Awaiting mark
              </button>
              <button
                className={subState === "bothGates" ? "active" : ""}
                onClick={() => setSubState("bothGates")}
              >
                ③ Both gates
              </button>
              <button
                className={subState === "pending" ? "active" : ""}
                onClick={() => setSubState("pending")}
              >
                ④ Pending approval
              </button>
              <button
                className={subState === "locked" ? "active" : ""}
                onClick={() => setSubState("locked")}
              >
                ⑤ Locked
              </button>
            </div>
          </div>
        )}
      </div>

      {subState === "good" && (
        <MarkAcceptedGood
          blendedMarginPct={blendedMarginPct}
          status={status}
          targetPct={targetPct}
          floorPct={floorPct}
          tiers={tiers}
          customerName={customerName}
          quoteNumber={quoteNumber}
          sentVersion="v1 (sent)"
          draftVersion="current draft"
          showVersionMismatch={false}
          activeSiblings={activeSiblings}
          customerAcceptance={null}
        />
      )}
      {subState === "awaitingMark" && (
        <MarkAcceptedGood
          blendedMarginPct={blendedMarginPct}
          status={status}
          targetPct={targetPct}
          floorPct={floorPct}
          tiers={tiers}
          customerName={customerName}
          quoteNumber={quoteNumber}
          sentVersion="v1 (sent)"
          draftVersion="current draft"
          showVersionMismatch={false}
          activeSiblings={activeSiblings}
          // Null when nothing has been recorded, which is the truth and which
          // this component already renders — the `good` sub-state above passes
          // null unconditionally.
          //
          // It used to synthesise one at the middle tier, described as a
          // "switcher-only fallback for prototype state preview". It was not
          // switcher-only: `awaitingMark` is a real sub-state, so a PM whose
          // customer had accepted nothing was shown an acceptance, at a tier
          // chosen by position, stamped with the current time.
          customerAcceptance={customerAcceptance}
        />
      )}
      {/*
        The below-floor override gate requires a margin to be below the floor,
        so it keeps a non-null `number`. Derivation never sends an unassessed
        quote here — `statusToSubState` cannot return `bothGates` for
        UNAVAILABLE — but the dev state switcher can force the sub-state
        directly, and that combination gets said out loud rather than rendering
        a gate about a margin that does not exist.
      */}
      {subState === "bothGates" &&
        (blendedMarginPct !== null ? (
          <MarkAcceptedBothGates
            blendedMarginPct={blendedMarginPct}
            targetPct={targetPct}
            floorPct={floorPct}
            flaggedLines={flaggedLines}
            customerName={customerName}
            quoteNumber={quoteNumber}
          />
        ) : (
          <div className="macc-note">
            This quote has no revenue, so it has no blended margin. The
            below-floor override gate does not apply.
          </div>
        ))}
      {subState === "pending" && (
        <MarkAcceptedPending
          blendedMarginPct={blendedMarginPct}
          targetPct={targetPct}
          floorPct={floorPct}
          customerName={customerName}
        />
      )}
      {subState === "locked" && recommendedTier && (
        <MarkAcceptedLocked
          blendedMarginPct={blendedMarginPct}
          targetPct={targetPct}
          floorPct={floorPct}
          acceptedTier={recommendedTier}
          acceptedAt="(stub) accepted_at pending Slice 12"
          acceptedByName="(stub) accepted_by pending"
          sentVersion="v1 (sent)"
        />
      )}
    </div>
    </div>
  );
}
