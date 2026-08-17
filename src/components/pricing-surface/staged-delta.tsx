"use client";

// Phase 3 · the transient delta, rendered.
//
// §3: while anything is staged, the cost stack shows the movement against
// last-applied on every component row, on quoted sell, and on margin in
// points. **Deltas disappear on Apply** — their absence is the signal that
// nothing is pending.
//
// That last sentence is the reason this renders nothing rather than a zero
// when the sets agree. A row reading "+$0.00" would say something happened
// here and it came to nothing; an empty row says nothing happened. The
// operator is scanning for what moved.
//
// The component performs one arithmetic operation, and it is a subtraction
// between two numbers the engine stated — see `nodeDelta`. It does not compute
// either side, and it cannot: `readNodeValue` refuses a graph whose evaluation
// does not match what the caller named.

import { nodeDelta, marginPointsDelta, type NodeDelta } from "@/lib/pricing-delta";
import type { CostingGraph } from "@/lib/costing-nodes";
import { ladderAmount } from "@/lib/money-display";

function sign(n: number): string {
  return n > 0 ? "+" : "−";
}

/** A dollar movement on a cost-stack row. */
export function StagedDelta({
  committedGraph,
  previewGraph,
  nodeKey,
}: {
  committedGraph: CostingGraph;
  previewGraph: CostingGraph | null;
  nodeKey: string;
}) {
  const d = nodeDelta(committedGraph, previewGraph, nodeKey);
  if (d === null) return null;
  // Magnitude only — DeltaChip renders the direction. Governed money display.
  return <DeltaChip d={d} format={(v) => ladderAmount(Math.abs(v))} />;
}

/** A margin movement, in points. */
export function StagedMarginDelta({
  committedGraph,
  previewGraph,
  nodeKey,
}: {
  committedGraph: CostingGraph;
  previewGraph: CostingGraph | null;
  nodeKey: string;
}) {
  const d = marginPointsDelta(committedGraph, previewGraph, nodeKey);
  if (d === null) return null;
  return <DeltaChip d={d} format={(v) => `${Math.abs(v).toFixed(1)}pp`} />;
}

/**
 * The chip itself.
 *
 * `.delta.pos` / `.delta.neg` are the canonical stylesheet's own classes, and
 * they carry `--good` / `--warn`. Note what that means and what it does not:
 * the tone tracks the DIRECTION of the movement, not compliance. A rise is
 * green because more revenue is what the operator was reaching for, not
 * because the result clears any threshold — whether it does is the compliance
 * grid's question, answered from the classifier, on a different surface.
 */
function DeltaChip({
  d,
  format,
}: {
  d: NodeDelta;
  format: (v: number) => string;
}) {
  return (
    <span
      className={"delta " + (d.delta > 0 ? "pos" : "neg")}
      title={`was ${format(d.committed)} · staged ${format(d.preview)}`}
    >
      {sign(d.delta)}
      {format(d.delta)}
    </span>
  );
}
