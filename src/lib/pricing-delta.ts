// Phase 3 · transient deltas — committed against preview, on one key.
//
// §3.3 of the node specification is what makes this possible in three lines:
//
//     "Committed and staged graphs share the key space by construction."
//
// So a delta is a JOIN on node identity, not a recomputation. Both sides are
// values the engine already stated; the only new operation is a subtraction
// performed to display the gap between two authoritative numbers.
//
// That distinction is the whole discipline here. Subtracting two governed
// values is presentation. Deriving either of them would be a second authority,
// and would be one refactor away from disagreeing with the first.
//
// §3.1 records why the keys must be deterministic, and says so in exactly
// these terms: "Phase 3 computes twice — committed and staged — and renders
// the delta per component row. A delta is a join between two graphs on node
// identity. Non-deterministic keys make that join impossible and the
// transient-delta feature unbuildable."

import { readNodeValue, type CostingGraph } from "./costing-nodes.ts";

export interface NodeDelta {
  /** The value in effect now. */
  committed: number;
  /** The value the staged set would produce. */
  preview: number;
  /** `preview − committed`. A subtraction between two stated values. */
  delta: number;
}

/**
 * Read one key from both graphs and report the gap.
 *
 * Null — meaning "show no delta" — in every case where a delta would be a
 * claim rather than an observation:
 *
 *   - nothing is staged, so there is no preview graph;
 *   - either graph declines the key (missing, duplicated, or flagged out —
 *     `readNodeValue` fails closed on all three);
 *   - the two agree, so there is no movement to report.
 *
 * The last is a display decision, not a computation: a delta of exactly zero
 * is visual noise on every row that did not move, and the operator is looking
 * for the ones that did.
 *
 * NOTE the `expect` arguments. Each side names the evaluation it requires, so
 * handing this two committed graphs — or two previews — yields nothing rather
 * than a plausible zero. The readers refuse the wrong authority by
 * construction; this function does not have to check.
 */
export function nodeDelta(
  committedGraph: CostingGraph,
  previewGraph: CostingGraph | null,
  key: string,
): NodeDelta | null {
  if (previewGraph === null) return null;
  const committed = readNodeValue(committedGraph, key, "committed");
  const preview = readNodeValue(previewGraph, key, "preview");
  if (committed === null || preview === null) return null;
  const delta = preview - committed;
  if (delta === 0) return null;
  return { committed, preview, delta };
}

/**
 * Percentage-point movement, for a margin.
 *
 * Kept separate from `nodeDelta` rather than folded in as a unit switch,
 * because the two answer different questions and an operator reads them
 * differently: dollars move by an amount, a margin moves by points. Folding
 * them together would mean one call site deciding which it wanted by passing
 * a flag, and flags at call sites are where the wrong one gets passed.
 *
 * Still a subtraction between two stated values — `× 100` is a unit
 * conversion, not a derivation.
 */
export function marginPointsDelta(
  committedGraph: CostingGraph,
  previewGraph: CostingGraph | null,
  key: string,
): NodeDelta | null {
  const d = nodeDelta(committedGraph, previewGraph, key);
  if (d === null) return null;
  return {
    committed: d.committed * 100,
    preview: d.preview * 100,
    delta: d.delta * 100,
  };
}
