"use client";

import { useState } from "react";
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
  | "bothGates"
  | "pending"
  | "locked";

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
  showStateSwitcher,
}: {
  initialSubState: MarkAcceptedSubState;
  blendedMarginPct: number;
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
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
  showStateSwitcher: boolean;
}) {
  const [subState, setSubState] =
    useState<MarkAcceptedSubState>(initialSubState);

  const recommendedTier =
    tiers.find((t) => t.recommended) ?? tiers[Math.floor(tiers.length / 2)];

  return (
    <div className="macc-stage">
      <div
        style={{
          padding: "10px 24px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--paper-2)",
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: 0.04,
          }}
        >
          <span style={{ color: "var(--ink-4)" }}>
            Costing Sheet · {customerName} · {quoteNumber} ·{" "}
          </span>
          <strong style={{ color: "var(--ink)" }}>Mark accepted</strong>
        </div>
        {showStateSwitcher && (
          <div
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              className="mono"
              style={{
                fontSize: 9.5,
                color: "var(--ink-4)",
                letterSpacing: 0.06,
              }}
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
                className={subState === "bothGates" ? "active" : ""}
                onClick={() => setSubState("bothGates")}
              >
                ② Both gates
              </button>
              <button
                className={subState === "pending" ? "active" : ""}
                onClick={() => setSubState("pending")}
              >
                ③ Pending approval
              </button>
              <button
                className={subState === "locked" ? "active" : ""}
                onClick={() => setSubState("locked")}
              >
                ④ Locked
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
        />
      )}
      {subState === "bothGates" && (
        <MarkAcceptedBothGates
          blendedMarginPct={blendedMarginPct}
          targetPct={targetPct}
          floorPct={floorPct}
          flaggedLines={flaggedLines}
          customerName={customerName}
          quoteNumber={quoteNumber}
        />
      )}
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
  );
}
