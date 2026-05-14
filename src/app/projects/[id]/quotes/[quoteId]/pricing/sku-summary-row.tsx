"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateClientTarget } from "@/app/actions/costing";
import {
  selectActiveTierId,
  selectActiveTierRollup,
  selectCellTarget,
  selectPerTierForSku,
  selectSkuRollups,
  selectTiers,
  selectUpdateCellTarget,
  type CostingStoreState,
} from "@/lib/costing-store";
import {
  useCostingStore,
  useCostingStoreApi,
} from "@/components/costing-store-provider";
import { TwoAxisVerdictPair } from "@/components/pricing/two-axis-verdict";
import {
  MarginSparkline,
  type SparklinePoint,
} from "@/components/pricing/margin-sparkline";
import { ReverseSolveDialog } from "@/components/pricing/reverse-solve-dialog";
import { RequiredSellCell } from "@/components/required-sell-cell";
import {
  naiveTierAdjForCostExceedsTarget,
  suggestTierAdjForClientTarget,
  type QuoteCostingInput,
  type SkuRollup,
} from "@/lib/costing";
import { SkuBreakdown } from "./sku-breakdowns";

// Slice RI.5 Room 3 sweep — per-SKU breakdown rebuilt as card-per-
// SKU per R2 source (`docs/design-prototypes/dist/source/round-2/
// app/r2/costing.jsx:383-509`). Replaces the prior 9.4a table+drawer
// invention which had no R2 source.
//
// Each SKU = `<article>` with R2 .r2-card register, conditional
// `borderLeft: 3px solid var(--bad)` when active-tier marginStatus
// is BELOW_FLOOR. Inner grid: 4 columns (1.4fr 1.4fr 1.5fr 1.4fr,
// gap 0) with borderRight separators. Columns:
//   1. SKU identity (mono label + UNDERPRICED + Assembly chips →
//      display 17px name → mono metadata)
//   2. Contribution → required sell (eyebrow → inline arrow grammar
//      with RequiredSellCell + retail readout)
//   3. Margin (eyebrow → 28px display → TwoAxisVerdictPair → gap-
//      readout with inline ClientTarget edit + reverse-solve button)
//   4. All tiers (eyebrow → MarginSparkline preserved per brief
//      §3.3:368 + Q2 PM call as authorized R2 extension)
//
// Drawer + ▾/▴ mechanic deleted (R2 has no drawer; decomposition
// lives on Costs per R6 IA split). Per-SKU navigation to Cost
// Build is post-MVP per UX_BACKLOG.

const selectSkus = (s: CostingStoreState) => s.skus;

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtCurr4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function SkuSummaryRowList({ editable }: { editable: boolean }) {
  const skuRollups = useCostingStore(selectSkuRollups);
  const activeTier = useCostingStore(selectActiveTierRollup);
  // Single-source-of-truth: one drawer open at a time per page. Per-row
  // ▾/▴ toggle on the SKU identity column expands the cost-decomposition
  // drawer below the row.
  const [expandedSkuId, setExpandedSkuId] = useState<string | null>(null);

  function handleToggleExpand(skuId: string) {
    setExpandedSkuId((prev) => (prev === skuId ? null : skuId));
  }

  if (skuRollups.length === 0) {
    return (
      <div
        className="r2-card"
        style={{ padding: "32px 20px", textAlign: "center" }}
      >
        <p
          className="r2-mono"
          style={{ fontSize: 12, color: "var(--ink-4)", margin: 0 }}
        >
          No SKUs in this quote yet.
        </p>
      </div>
    );
  }

  if (!activeTier) {
    return (
      <div
        className="r2-card"
        style={{ padding: "32px 20px", textAlign: "center" }}
      >
        <p
          className="r2-mono"
          style={{ fontSize: 12, color: "var(--ink-4)", margin: 0 }}
        >
          Add a tier to see required sell.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {skuRollups.map((sku) => (
        <SkuSummaryRow
          key={sku.skuId}
          sku={sku}
          editable={editable}
          expanded={expandedSkuId === sku.skuId}
          onToggleExpand={handleToggleExpand}
        />
      ))}
    </div>
  );
}

function SkuSummaryRow({
  sku,
  editable,
  expanded,
  onToggleExpand,
}: {
  sku: SkuRollup;
  editable: boolean;
  expanded: boolean;
  onToggleExpand: (skuId: string) => void;
}) {
  const activeTierId = useCostingStore(selectActiveTierId);
  const tiers = useCostingStore(selectTiers);
  const skus = useCostingStore(selectSkus);
  const perTier = sku.perTier.find((pt) => pt.tierId === activeTierId);

  if (!activeTierId || !perTier) {
    // Mid-reconcile placeholder — minimal card chrome
    return (
      <article className="r2-card" style={{ padding: "16px 20px" }}>
        <span
          className="r2-mono"
          style={{ fontSize: 11, color: "var(--ink-4)" }}
        >
          {sku.skuLabel} · waiting for tier…
        </span>
      </article>
    );
  }

  const isAssembly = sku.skuRole === "assembly";
  const isBelowFloor = perTier.marginStatus === "BELOW_FLOOR";
  const indentPx = sku.indentDepth * 16;
  const activeTierLabel =
    tiers.find((t) => t.tierId === activeTierId)?.label ?? "";

  // Look up retail benchmark from skus list (input-side data)
  const skuInput = skus.find((s) => s.id === sku.skuId);
  const retailBenchmark = skuInput?.retailBenchmark ?? null;

  // Edward smoke (2026-05-13) — extend left-accent frame to ALL
  // margin states (not just BELOW_FLOOR). Color-codes match the
  // verdict pill on the same row: GOOD=good, BELOW_TARGET=warn,
  // BELOW_FLOOR=bad. Provides at-a-glance row scanability across
  // the per-SKU breakdown table.
  const accentColor = (() => {
    switch (perTier.marginStatus) {
      case "BELOW_FLOOR":
        return "var(--bad)";
      case "BELOW_TARGET":
        return "var(--warn)";
      case "GOOD":
        return "var(--good)";
    }
  })();

  return (
    <article
      className="r2-card"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1.4fr 1.5fr 1.4fr",
          gap: 0,
        }}
      >
        {/* Column 1 — SKU identity (vertical stack) */}
        <div
          style={{
            padding: "16px 20px",
            borderRight: "1px solid var(--rule)",
            paddingLeft: `${20 + indentPx}px`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
              flexWrap: "wrap",
            }}
          >
            <span
              className="r2-mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
            >
              {sku.skuLabel}
            </span>
            {isAssembly && <span className="r2-chip accent">Assembly</span>}
            {isBelowFloor && (
              <span
                className="r2-chip bad"
                style={{ fontSize: 9 }}
              >
                UNDERPRICED
              </span>
            )}
          </div>
          <div
            style={{
              fontFamily: "var(--display)",
              fontSize: 17,
              letterSpacing: "-0.01em",
              color: "var(--ink)",
              lineHeight: 1.25,
            }}
          >
            {sku.productName}
          </div>
          {sku.qtyPerParent !== null && (
            <div
              className="r2-mono"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                marginTop: 2,
              }}
            >
              × {sku.qtyPerParent} per parent
            </div>
          )}
        </div>

        {/* Column 2 — Contribution → Required sell */}
        <div
          style={{
            padding: "16px 20px",
            borderRight: "1px solid var(--rule)",
          }}
        >
          <p
            className="r2-eyebrow"
            style={{ marginBottom: 4, fontSize: 9.5 }}
          >
            Contribution → required sell
          </p>
          <div
            className="r2-mono"
            style={{ fontSize: 13, display: "flex", alignItems: "baseline", gap: 4 }}
          >
            <span style={{ color: "var(--ink-2)" }}>
              {fmtCurr2(perTier.contributionCostPerUnit)}
            </span>
            <span style={{ color: "var(--ink-3)" }}>→</span>
            {!isAssembly ? (
              <RequiredSellCell
                quoteSkuId={sku.skuId}
                tierId={activeTierId}
                editable={editable}
              />
            ) : (
              <span
                className="r2-mono"
                style={{ fontSize: 13, color: "var(--ink-2)" }}
              >
                {fmtCurr2(perTier.requiredSellPerUnit)}
              </span>
            )}
          </div>
          {retailBenchmark !== null && perTier.requiredSellPerUnit > 0 && (
            <div
              className="r2-mono"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                marginTop: 4,
              }}
            >
              retail {fmtCurr2(retailBenchmark)} ·{" "}
              {((perTier.requiredSellPerUnit / retailBenchmark) * 100).toFixed(0)}
              % of retail
            </div>
          )}
        </div>

        {/* Column 3 — Margin (eyebrow → 28px → two-axis → gap-readout) */}
        <div
          style={{
            padding: "16px 20px",
            borderRight: "1px solid var(--rule)",
          }}
        >
          <p
            className="r2-eyebrow"
            style={{ marginBottom: 4, fontSize: 9.5 }}
          >
            Margin · {activeTierLabel}
          </p>
          <div
            style={{
              fontFamily: "var(--display)",
              fontSize: 28,
              letterSpacing: "-0.02em",
              lineHeight: 1,
              color: marginColorToken(perTier.marginStatus),
              marginBottom: 10,
            }}
          >
            {(perTier.marginPct * 100).toFixed(1)}
            <span style={{ fontSize: 14, opacity: 0.7 }}>%</span>
          </div>
          <TwoAxisVerdictPair
            marginStatus={perTier.marginStatus}
            competitiveStatus={perTier.competitiveStatus}
            renderClientChip={!isAssembly}
          />
          {!isAssembly && (
            <ClientTargetGapReadout
              quoteSkuId={sku.skuId}
              skuLabel={sku.skuLabel}
              tierId={activeTierId}
              requiredSellPerUnit={perTier.requiredSellPerUnit}
              competitiveStatus={perTier.competitiveStatus}
              editable={editable}
            />
          )}
        </div>

        {/* Column 4 — All tiers sparkline + expand toggle */}
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 6,
          }}
        >
          <p
            className="r2-eyebrow"
            style={{ marginBottom: 0, fontSize: 9.5 }}
          >
            All tiers
          </p>
          <MarginSparkline
            points={sku.perTier.map((pt): SparklinePoint => {
              const tierMeta = tiers.find((t) => t.tierId === pt.tierId);
              return {
                tierId: pt.tierId,
                tierLabel: tierMeta?.label ?? pt.tierId,
                marginPct: pt.marginPct,
                hasRevenue: pt.revenue > 0,
              };
            })}
            activeTierId={activeTierId}
          />
          <button
            type="button"
            onClick={() => onToggleExpand(sku.skuId)}
            title={expanded ? "Hide breakdown" : "Show breakdown"}
            aria-label={expanded ? "Hide breakdown" : "Show breakdown"}
            aria-expanded={expanded}
            style={{
              marginTop: 4,
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              background: "transparent",
              border: "1px solid var(--rule)",
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            {expanded ? "▴ Hide breakdown" : "▾ Show breakdown"}
          </button>
        </div>
      </div>

      {/* Expandable cost-decomposition drawer — Designer-authorized
          R2 extension. R2 prototype doesn't have this drawer, but the
          rollup is load-bearing PM workflow ("show me why this number
          is what it is"). Restyled to R2 register with paper-2 card
          chrome. Single-source-of-truth: SkuSummaryRowList owns
          expandedSkuId; opening another row collapses prior. */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--rule)",
            padding: "16px 20px",
            background: "var(--paper)",
          }}
        >
          <SkuBreakdown sku={sku} tiers={tiers} />
        </div>
      )}
    </article>
  );
}

function marginColorToken(
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR",
): string {
  switch (status) {
    case "GOOD":
      return "var(--good)";
    case "BELOW_TARGET":
      return "var(--warn)";
    case "BELOW_FLOOR":
      return "var(--bad)";
  }
}

// ─── Client target gap-readout (consolidates ClientTargetCell into
// margin column per Designer audit Finding #16) ─────────────────────
//
// R2 source `costing.jsx:468-478`: when client target is set, render
// gap-readout below the verdict chips: "client target $X.XX · gap
// $Y.YY" + (when competitive === "over") inline "→ apply suggested
// adj" button.
//
// Q7 decision (PM call): preserve click-to-set discoverability via
// empty placeholder ("set client target →") when no target is set.
// Documented as R2 extension authorized for discoverability.
//
// Click-to-edit pattern matches RequiredSellCell (auto-focus, select-
// all, Enter/blur commit, Esc cancel). Empty input commits as clear
// (per ClientTargetCell convention from 9.4b — empty IS the natural
// "no benchmark" state).

function ClientTargetGapReadout({
  quoteSkuId,
  skuLabel,
  tierId,
  requiredSellPerUnit,
  competitiveStatus,
  editable,
}: {
  quoteSkuId: string;
  skuLabel: string;
  tierId: string;
  requiredSellPerUnit: number;
  competitiveStatus: "COMPETITIVE" | "OVER_CLIENT_TARGET" | null;
  editable: boolean;
}) {
  const cellTarget = useCostingStore(selectCellTarget(quoteSkuId, tierId));
  const updateLocal = useCostingStore(selectUpdateCellTarget);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editMode && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editMode]);

  function openEditor() {
    if (!editable || pending) return;
    setDraft(cellTarget !== null ? cellTarget.toFixed(4) : "");
    setError(null);
    setEditMode(true);
  }

  function commit(value: string) {
    setError(null);
    const trimmed = value.trim();
    if (trimmed === "") {
      // Empty input clears — different from RequiredSellCell. For
      // client target, empty IS the natural "no benchmark" state.
      updateLocal(quoteSkuId, tierId, null);
      const fd = new FormData();
      fd.set("quoteSkuId", quoteSkuId);
      fd.set("tierId", tierId);
      fd.set("clientTargetPricePerUnit", "");
      startTransition(async () => {
        const r = await updateClientTarget(fd);
        if (!r.ok) setError(r.error.message);
      });
      setEditMode(false);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setError("Enter a numeric value.");
      return;
    }
    if (n <= 0) {
      setError("Target must be > 0.");
      return;
    }
    if (cellTarget !== null && Math.abs(n - cellTarget) < 0.00005) {
      setEditMode(false);
      return;
    }
    updateLocal(quoteSkuId, tierId, n);
    setEditMode(false);
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    fd.set("tierId", tierId);
    fd.set("clientTargetPricePerUnit", n.toString());
    startTransition(async () => {
      const r = await updateClientTarget(fd);
      if (!r.ok) setError(r.error.message);
    });
  }

  if (editMode) {
    return (
      <div
        className="r2-mono"
        style={{ marginTop: 6, fontSize: 10.5, position: "relative" }}
      >
        <span style={{ color: "var(--ink-4)" }}>client target </span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={pending}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditMode(false);
            }
          }}
          onBlur={() => commit(draft)}
          style={{
            width: 80,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            background: "var(--paper)",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            padding: "1px 6px",
            color: "var(--ink)",
          }}
          placeholder="$X.XX"
        />
        {error && (
          <span
            role="alert"
            style={{
              position: "absolute",
              right: 0,
              top: "100%",
              marginTop: 2,
              background: "var(--bad-soft)",
              color: "var(--bad)",
              padding: "2px 6px",
              fontSize: 10,
              borderRadius: 4,
              border: "1px solid var(--bad)",
              whiteSpace: "nowrap",
            }}
          >
            {error}
          </span>
        )}
      </div>
    );
  }

  // No target set: render empty placeholder click-to-set affordance
  // (per Q7 — preserve discoverability)
  if (cellTarget === null) {
    if (!editable) return null;
    return (
      <button
        type="button"
        onClick={openEditor}
        className="r2-mono"
        style={{
          marginTop: 6,
          fontSize: 10.5,
          color: "var(--ink-4)",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
        title="Click to set client target benchmark"
      >
        set client target →
      </button>
    );
  }

  // Target set: render gap-readout
  const gap = requiredSellPerUnit - cellTarget;
  const isOver = competitiveStatus === "OVER_CLIENT_TARGET";

  return (
    <div
      className="r2-mono"
      style={{
        marginTop: 6,
        fontSize: 10.5,
        color: "var(--ink-4)",
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={openEditor}
        disabled={!editable}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-4)",
          cursor: editable ? "pointer" : "default",
        }}
        title={editable ? "Click to edit client target" : undefined}
      >
        client target {fmtCurr2(cellTarget)}
      </button>
      <span style={{ color: "var(--ink-4)" }}>·</span>
      <span style={{ color: isOver ? "var(--warn)" : "var(--ink-3)" }}>
        gap {gap >= 0 ? "+" : ""}
        {fmtCurr2(gap)}
      </span>
      {isOver && editable && (
        <ApplySuggestedAdjButton
          quoteSkuId={quoteSkuId}
          skuLabel={skuLabel}
          tierId={tierId}
          clientTarget={cellTarget}
        />
      )}
    </div>
  );
}

// Reverse-solve "→ apply suggested adj" button — opens
// ReverseSolveDialog with consequence-framing for cost_exceeds_target
// case (Designer audit Finding #6). Compute logic ported verbatim
// from ClientTargetCell to preserve the exact reverse-solve actionability
// rules (Edward's pressure-test resolution: hidden-not-disabled for
// non-actionable failure modes; cost_exceeds_target is applyable with
// explicit consequence framing in the dialog).
function ApplySuggestedAdjButton({
  quoteSkuId,
  skuLabel,
  tierId,
  clientTarget,
}: {
  quoteSkuId: string;
  skuLabel: string;
  tierId: string;
  clientTarget: number;
}) {
  const storeApi = useCostingStoreApi();
  const cellRollup = useCostingStore(selectPerTierForSku(quoteSkuId, tierId));
  const tiers = useCostingStore(selectTiers);
  const [open, setOpen] = useState(false);

  if (!cellRollup) return null;

  // Derive reverse-solve actionability — same logic as ClientTargetCell
  let solveActionable = false;
  let solveSuggestedAdj = 0;
  let solveConsequenceCostExceedsTarget = false;
  const state = storeApi.getState();
  const input: QuoteCostingInput = {
    quote: {
      id: state.quoteId,
      globalPriceAdjPct: state.globalPriceAdjPct,
      targetMarginPct: state.targetMarginPct,
    },
    firmSettings: state.firmSettings,
    markupDefaults: state.markupDefaults,
    skus: state.skus,
    tiers: state.tiers,
    packaging: state.packaging,
    production: state.production,
    freight: state.freight,
    cellOverrides: state.cellOverrides,
    cellTargets: state.cellTargets,
  };
  const result = suggestTierAdjForClientTarget(
    quoteSkuId,
    tierId,
    state.costing,
    input,
  );
  if (result.ok) {
    solveActionable = true;
    solveSuggestedAdj = result.suggestedTierAdj;
  } else if (result.reason === "cost_exceeds_target") {
    const skuRollup = state.costing.skuRollups.find(
      (r) => r.skuId === quoteSkuId,
    );
    const cell = skuRollup?.perTier.find((p) => p.tierId === tierId);
    const tierRow = state.tiers.find((t) => t.id === tierId);
    if (cell && tierRow) {
      const currentTierAdj =
        tierRow.tierPriceAdjPct ?? state.globalPriceAdjPct;
      const denom = 1 + currentTierAdj;
      if (denom !== 0) {
        const base = cell.computedSellPerUnit / denom;
        const naive = naiveTierAdjForCostExceedsTarget(base, clientTarget);
        if (naive !== null) {
          solveActionable = true;
          solveSuggestedAdj = naive;
          solveConsequenceCostExceedsTarget = true;
        }
      }
    }
  }

  if (!solveActionable) return null;

  const tierMeta = tiers.find((t) => t.tierId === tierId);
  if (!tierMeta) return null;

  const buttonStyle: React.CSSProperties = solveConsequenceCostExceedsTarget
    ? {
        marginLeft: 4,
        fontSize: 10,
        padding: "1px 6px",
        fontFamily: "var(--ui)",
        background: "var(--warn-soft)",
        color: "var(--warn)",
        border: "1px solid var(--warn)",
        borderRadius: 4,
        cursor: "pointer",
      }
    : {
        marginLeft: 4,
        fontSize: 10,
        padding: "1px 6px",
        fontFamily: "var(--ui)",
        background: "transparent",
        color: "var(--ink-3)",
        border: "none",
        cursor: "pointer",
      };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={buttonStyle}
        title={
          solveConsequenceCostExceedsTarget
            ? "Apply suggested tier adjustment to match client target — would price below cost (consequence)"
            : "Apply suggested tier adjustment to match client target"
        }
      >
        {solveConsequenceCostExceedsTarget
          ? "⚠ apply (drops margin)"
          : "→ apply suggested adj"}
      </button>
      {open && (
        <ReverseSolveDialog
          open={open}
          onClose={() => setOpen(false)}
          originSkuId={quoteSkuId}
          originSkuLabel={skuLabel}
          affectedTierId={tierId}
          affectedTierLabel={tierMeta.label}
          affectedTierQty={tierMeta.qty}
          clientTarget={clientTarget}
          suggestedTierAdj={solveSuggestedAdj}
          consequenceCostExceedsTarget={solveConsequenceCostExceedsTarget}
          quoteId={state.quoteId}
        />
      )}
    </>
  );
}
