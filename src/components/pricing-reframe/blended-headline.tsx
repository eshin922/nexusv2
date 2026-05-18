"use client";

// Pricing Reframe v1 — BlendedHeadline
//
// Top-band primary verdict. Pattern 30 path-B-default — class names match
// canonical pricing.jsx (`.pr-blended` + `.value-block` / `.room-state` /
// `.meta` children). Canonical CSS at src/styles/pricing-reframe.css.
//
// Scenario ③ lesson (brief Notes §2): pill copy + room copy DERIVE from
// computed state (`belowFloor` + `belowTarget` counts), never from static
// strings. Step 4 refines this further; current pill-copy derivation is
// already state-driven.

import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFirmSettings,
  selectQuoteRollup,
  selectQuoteSummary,
} from "@/lib/costing-store";

const fmtPct = (v: number | null) =>
  v == null ? "—" : (v * 100).toFixed(1);

type PillTone = "good" | "warn" | "bad" | "empty";

export function BlendedHeadline() {
  const rollup = useCostingStore(selectQuoteRollup);
  const summary = useCostingStore(selectQuoteSummary);
  const firm = useCostingStore(selectFirmSettings);

  const isEmpty = rollup.length === 0;
  if (isEmpty) return null;

  const target = Number(firm?.targetMarginPct ?? 0.35);
  const floor = Number(firm?.floorMarginPct ?? 0.25);
  const blended = summary?.blendedMarginPct ?? null;

  // ROOM-state derivation from live state. Per brief §11 Step 4 / ③ lesson:
  // counts compute from rollup, not from fixtures.
  const belowTarget = rollup.filter(
    (t) => t.blendedMarginPct < target,
  ).length;
  const belowFloor = rollup.filter(
    (t) => t.blendedMarginPct < floor,
  ).length;

  const { tone, pillCopy, roomLine } = derivePillAndRoom({
    blended,
    target,
    belowTarget,
    belowFloor,
  });

  return (
    <div className={`pr-blended ${tone}`}>
      <div className="value-block">
        <div className="v-eyebrow">Blended margin</div>
        <div className="v-number">
          {blended == null ? "—" : fmtPct(blended)}
          <span className="pct">%</span>
        </div>
        <div className="v-caption">
          Blended is the per-tier average — your realized margin is the tier
          the customer picks.
        </div>
      </div>

      <div className="room-state">
        <span className="verdict-pill">
          <span className="dot" />
          {pillCopy}
        </span>
        <div className="room-line">{roomLine}</div>
      </div>

      <div className="meta">
        <span>
          Target {(target * 100).toFixed(0)}% · Floor{" "}
          {(floor * 100).toFixed(0)}%
        </span>
        <span className="recompute">↻ Recomputed live</span>
      </div>
    </div>
  );
}

type DeriveInput = {
  blended: number | null;
  target: number;
  belowTarget: number;
  belowFloor: number;
};

type Derived = {
  tone: PillTone;
  pillCopy: string;
  roomLine: React.ReactNode;
};

function derivePillAndRoom({
  blended,
  target,
  belowTarget,
  belowFloor,
}: DeriveInput): Derived {
  if (belowFloor > 0) {
    return {
      tone: "bad",
      pillCopy: "BLOCKED · BELOW FLOOR",
      roomLine: (
        <>
          <strong>
            {belowFloor} tier{belowFloor === 1 ? "" : "s"} below floor
          </strong>{" "}
          · sends require admin override
        </>
      ),
    };
  }
  if (blended != null && blended < target) {
    return {
      tone: "warn",
      pillCopy: `BLENDED BELOW TARGET · ${belowTarget} TIER RISK`,
      roomLine: (
        <>
          <strong>
            Blended {(blended * 100).toFixed(1)}% under{" "}
            {(target * 100).toFixed(0)}% target
          </strong>{" "}
          · {belowTarget} tier{belowTarget === 1 ? "" : "s"} below target ·
          review before sending
        </>
      ),
    };
  }
  if (belowTarget > 0) {
    return {
      tone: "warn",
      pillCopy: `BLENDED SENDABLE · ${belowTarget} TIER RISK`,
      roomLine: (
        <>
          <strong>
            {belowTarget} tier{belowTarget === 1 ? "" : "s"} below target
          </strong>{" "}
          · review per-tier risk before sending
        </>
      ),
    };
  }
  return {
    tone: "good",
    pillCopy: "ALL TIERS AT TARGET · SENDABLE",
    roomLine: (
      <>
        All tiers at or above {(target * 100).toFixed(0)}% target · sendable
      </>
    ),
  };
}
