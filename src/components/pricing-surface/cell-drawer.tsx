"use client";

/**
 * The detail of one pressed cell, at the side rather than inside the grid.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 *
 * Two full-width blocks that the grids grew when a cell was selected: the cell
 * action panel spliced under a SKU row, and the calculation trace spliced under
 * a Price Build row. Both were honest and both were expensive — pressing a cell
 * pushed every row beneath it down by the height of the panel, so asking about
 * one number rearranged the table that number lives in, and the neighbours you
 * wanted to compare it against moved off screen.
 *
 * The capability is unchanged. Everything that was in those panels is here:
 * identity, tier, the figures, the trace, the actions, the policy sentence.
 * Only the shape moved.
 *
 * ── ONE SURFACE, TWO KINDS OF CELL ────────────────────────────────────────
 *
 * A compliance cell is a (product, tier) commercial line: it has a quoted
 * price, a cost, a margin, and acts that can be performed on it.
 *
 * A Price Build cell is a CONTRIBUTION at a tier — packaging across the quote,
 * freight for one unit. It has a number and a derivation, and no acts: there is
 * nothing to "set directly" about the packaging component of a tier, because
 * the thing an operator prices is the line, not the layer.
 *
 * So the drawer renders what the cell actually has rather than a fixed set of
 * sections with blanks in them. A section that would say nothing is absent, not
 * empty — an empty Margin row on a contribution cell is a claim that the
 * contribution has no margin, which is a category error rather than a gap.
 */

import { useState } from "react";
import { Drawer, DrawerBody, DrawerHead, DrawerSection } from "@/components/modal/drawer";
import type { Cell } from "@/lib/pricing-classifier";
import type { CellRef } from "@/lib/pricing-staging";
import type { CostingGraph } from "@/lib/costing-nodes";
import { CellAction } from "./cell-action";
import { PricingTrace } from "./pricing-trace";
import { ladderAmount } from "@/lib/money-display";

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Governed money display at ladder precision — see `src/lib/money-display.ts`. */
const fmtUsd = ladderAmount;

/**
 * What the drawer is open on.
 *
 * A discriminated union rather than one shape with optional halves, so a
 * contribution cell cannot be handed a `cell` and quietly grow pricing actions
 * that do not apply to it.
 */
export type DrawerTarget =
  | {
      kind: "compliance";
      /** The classifier's cell — figures, policy state, action eligibility. */
      cell: Cell;
      /** Canonical address. Null means unaddressable; CellAction refuses. */
      cellRef: CellRef | null;
      /** "GLW-50 · T2" */
      label: string;
      /** Tier display label, e.g. "Tier 2". */
      tierLabel: string;
      /** Graph key for the quoted price, when the cell resolves to one. */
      quotedNodeKey: string | null;
    }
  | {
      kind: "contribution";
      /** "Packaging", "Base sell" — the row that was pressed. */
      rowLabel: string;
      /** "Tier 1", and the unit the build is scoped to. */
      tierLabel: string;
      scopeLabel: string;
      nodeKey: string;
    };

export function CellDrawer({
  target,
  graph,
  floorPct,
  onClose,
}: {
  target: DrawerTarget | null;
  graph: CostingGraph | null;
  floorPct: number;
  onClose: () => void;
}) {
  // Collapsed by default. The trace is the deepest thing here and the least
  // often wanted first — an operator opens a cell to see what it is and what
  // they can do about it, and asks how it was derived second. Opening it
  // expanded would push the actions below the fold on the tall chains.
  const [showCalc, setShowCalc] = useState(false);

  // Keyed remount on target change, so the disclosure does not carry a
  // previous cell's state onto a new one.
  const key =
    target === null
      ? ""
      : target.kind === "compliance"
        ? `c:${target.quotedNodeKey ?? target.label}`
        : `n:${target.nodeKey}`;

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      label={target === null ? "Cell detail" : headingOf(target)}
    >
      {target !== null && (
        <DrawerInner
          key={key}
          target={target}
          graph={graph}
          floorPct={floorPct}
          onClose={onClose}
          showCalc={showCalc}
          setShowCalc={setShowCalc}
        />
      )}
    </Drawer>
  );
}

function headingOf(t: DrawerTarget): string {
  return t.kind === "compliance" ? t.label : `${t.rowLabel} · ${t.tierLabel}`;
}

function DrawerInner({
  target,
  graph,
  floorPct,
  onClose,
  showCalc,
  setShowCalc,
}: {
  target: DrawerTarget;
  graph: CostingGraph | null;
  floorPct: number;
  onClose: () => void;
  showCalc: boolean;
  setShowCalc: (v: boolean) => void;
}) {
  const nodeKey =
    target.kind === "compliance" ? target.quotedNodeKey : target.nodeKey;

  return (
    <>
      <DrawerHead>
        <div className="psr-drawer-title">
          <span className="who">
            {target.kind === "compliance" ? target.cell.sku_name : target.rowLabel}
          </span>
          <span className="where">
            {target.kind === "compliance"
              ? `${target.tierLabel} · ${target.cell.tier_qty.toLocaleString()} units`
              : `${target.tierLabel} · ${target.scopeLabel}`}
          </span>
        </div>
        <button className="btn ghost sm" type="button" onClick={onClose}>
          ✕
        </button>
      </DrawerHead>

      <DrawerBody>
        {target.kind === "compliance" ? (
          <ComplianceFigures cell={target.cell} />
        ) : null}

        {/* Only where acts exist. See the note at the top of the file. */}
        {target.kind === "compliance" && (
          <DrawerSection title="Pricing actions">
            <CellAction
              cell={target.cell}
              cellRef={target.cellRef}
              floorPct={floorPct}
              label={target.label}
            />
          </DrawerSection>
        )}

        <DrawerSection title="Calculation">
          {nodeKey === null || graph === null ? (
            <p className="psr-drawer-empty">
              No derivation is recorded for this figure, so there is nothing to
              show rather than an empty chain.
            </p>
          ) : !showCalc ? (
            <button
              className="btn ghost sm"
              type="button"
              onClick={() => setShowCalc(true)}
            >
              Show calculation
            </button>
          ) : (
            <div className="r11-tracewrap">
              <PricingTrace
                graph={graph}
                nodeKey={nodeKey}
                title={headingOf(target)}
                onClose={() => setShowCalc(false)}
              />
            </div>
          )}
        </DrawerSection>
      </DrawerBody>
    </>
  );
}

/**
 * The three figures the disposition names, in the order a price is read:
 * what we quote, what it costs, what that leaves.
 *
 * Four decimal places, matching the Price Build rather than the grid's two.
 * The grid is scanned and rounds for density; this is the place someone came to
 * look closely, and $2.8350 shown as $2.84 here would be the surface that is
 * supposed to answer the question introducing the ambiguity.
 */
function ComplianceFigures({ cell }: { cell: Cell }) {
  const marginClass =
    cell.margin_pct === null
      ? "none"
      : cell.outstanding
        ? "bad"
        : cell.margin_pct < 0.35
          ? "warn"
          : "good";
  return (
    <DrawerSection title="This cell">
      <div className="psr-drawer-figs">
        <div className="psr-drawer-fig">
          <span className="k">Final quoted sell</span>
          <span className="v lead">
            {cell.sell_unit === null ? "—" : fmtUsd(cell.sell_unit)}
          </span>
        </div>
        <div className="psr-drawer-fig">
          <span className="k">Unit cost</span>
          <span className="v">
            {cell.cost_unit === null ? "—" : fmtUsd(cell.cost_unit)}
          </span>
        </div>
        <div className="psr-drawer-fig">
          <span className="k">Margin</span>
          <span className={`v ${marginClass}`}>
            {cell.margin_pct === null ? "—" : fmtPct(cell.margin_pct)}
          </span>
        </div>
      </div>
    </DrawerSection>
  );
}
