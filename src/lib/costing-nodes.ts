/**
 * The canonical computation node graph — Gate 1B.
 *
 * THE CONTRACT (docs/gate-1b-canonical-node-tree.md §0):
 *
 *   The engine produces one node graph. Every commercial value any surface
 *   displays is a node in that graph, read — never recomputed.
 *
 * This module defines the shape. The engine fills it while it computes; it does
 * NOT re-traverse afterwards. That distinction is the whole point: a second
 * traversal reproducing the engine's values is correct the day it is written and
 * silently wrong after the first refactor of either side.
 *
 * A trace is arithmetic made visible, not a breakdown (R10 §0). Every non-
 * terminal node states the OPERATION that produced it before the operands the
 * operation consumed. Dropping `op` turns this back into a breakdown, which
 * answers a question nobody asked.
 *
 * WHY THIS EXISTS AT ALL. Two surfaces labelled "packaging" disagreed by ~9%
 * because one re-allocated a weighted-average markup and the other summed
 * per-line markups. Neither was wrong; they answered different questions with
 * different formulas under one label. That is unfixable by care and fixable by
 * structure: if both read the same node, they cannot disagree.
 */

/**
 * TEN kinds, not the nine the prose counts.
 *
 * R10's notes say eight, R11 and Phase 3 say nine — but `app/r10/data.js:386`
 * emits `kind: "flagged-out"` and the renderer branches on it. Under Pattern 30
 * the canonical source is the contract, so `flagged-out` is a kind. Building to
 * the prose would produce a renderer with no branch for a kind that appears on
 * the live `customer_ships_raws` path.
 *
 * Three of these are not arithmetic, and that is the point of the vocabulary
 * rather than an awkwardness in it:
 *
 *   resolution   a CHOICE among candidates. The losing rungs are what make the
 *                winner legible; collapsing to the resolved value restores
 *                exactly the opacity this exists to remove.
 *   override     a human act. Deliberately NOT an arithmetic node — no
 *                operation above it. The superseded chain is retained and
 *                demoted, never presented as the reason the number is what it is.
 *   flagged-out  an input EXCLUDED, with the reason. Not a zero: a zero-valued
 *                markup node and a flagged-out node carry different facts and
 *                must never be collapsed.
 *
 * Adding a kind is a design decision, not an implementation one. R11 §11.2
 * records the surgical lift declining to add one because `adjustment` already
 * fit; that restraint is the norm to keep.
 */
export type NodeKind =
  | "sum"
  | "markup"
  | "allocation"
  | "rate"
  | "adjustment"
  | "blend"
  | "resolution"
  | "origin"
  | "override"
  | "flagged-out";

/** Kinds that terminate a chain. Every root-to-leaf path must reach one. */
export const TERMINAL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "origin",
  "override",
  "flagged-out",
]);

/**
 * Kinds whose operands must reproduce their value.
 *
 * `blend` asserts it AVERAGES to its value rather than sums to it (R11 §7c) — a
 * reconciler that only handles `sum` leaves blend nodes silently unasserted,
 * which was a real R10 defect. `resolution` asserts nothing: its children are
 * alternatives, exactly one of which is chosen, and they do not sum.
 */
export const ARITHMETIC_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "sum",
  "markup",
  "allocation",
  "rate",
  "adjustment",
  "blend",
]);

export type NodeUnit = "usd" | "pct" | "count";

/** One rung of a resolution ladder — including the ones that lost, and why. */
export type NodeCandidate = {
  label: string;
  /** Present when this rung could have supplied a value. */
  value: number | null;
  /** True for exactly one candidate per resolution node. */
  chosen: boolean;
  /** Why this rung was unavailable. Null when it was available. */
  unavailableReason: string | null;
};

/** Event-time provenance for a terminal. Read from the audit trail, never
 *  synthesised — an unattributable terminal is a finding, not a value to fill.
 *
 *  `grade` mirrors the two-grade discipline Gate 1A implemented for actor
 *  identity: a thin terminal states an absence and must never be rendered as a
 *  sourced one, or provenance silently upgrades. */
export type NodeOrigin = {
  grade: "sourced" | "thin";
  actor: string | null;
  when: string | null;
  doc: string | null;
};

export type CostingNode = {
  /** Deterministic and recomputation-stable — see `nodeKey`. */
  key: string;
  kind: NodeKind;
  /** What this node IS, self-describing when read in isolation. */
  label: string;
  /** UNROUNDED. Rounding here would break the node's own reconciliation
   *  assertion, and an assertion that can fail silently is worse than none. */
  value: number;
  unit: NodeUnit;
  /** The operation, as displayed. Absent ONLY on terminals. */
  op?: string;
  /** Ordered; ordering is significant and must be deterministic. */
  operands?: CostingNode[];
  /** `resolution` only. Alternatives, not operands: they do not sum. */
  candidates?: NodeCandidate[];
  /** `origin` / `override` only. */
  origin?: NodeOrigin;
  /** `override` only — what the chain would have produced. Retained and
   *  demoted; never an operand. */
  superseded?: CostingNode;
  /** `flagged-out` only — why this input is excluded. Never inferred from the
   *  value, because an excluded input and an absent one both read 0.00. */
  reason?: string;
  /** Free-text caption. `warn` marks a provisional node (e.g. Bulk Raw). */
  note?: string;
  noteLevel?: "info" | "warn";
};

/**
 * Deterministic key.
 *
 * MUST be a pure function of the node's position in the computation — never a
 * UUID, a counter, or anything that varies between runs. This is a hard
 * requirement from Phase 3, not a preference: the staging model computes twice
 * (committed and staged) and renders the delta per row, and a delta is a JOIN
 * between two graphs on node identity. Generated keys make that join impossible
 * and the transient-delta feature unbuildable.
 *
 * Built from durable identifiers only — `quoteLeafId`, `tierId`, `lineGroupId`
 * — never array positions, so adding a packaging line cannot change a freight
 * node's key.
 */
export function nodeKey(...parts: (string | number)[]): string {
  return parts.map((p) => String(p)).join("/");
}

export function node(n: CostingNode): CostingNode {
  return n;
}

/**
 * Reconciliation tolerance.
 *
 * Values are IEEE doubles accumulated across many operations, so exact equality
 * would report float noise as a broken chain. 1e-9 is far below any commercial
 * significance (a ten-millionth of a cent) and far above accumulated float
 * error at this depth.
 *
 * OPEN — A-3: whether this must equal the tolerance the compliance comparison
 * uses. Phase 3 already records a floor-comparison defect where `m >= floor`
 * read 0.2499999… as breaching. If the two tolerances differ, a cell can
 * reconcile and breach on the same numbers. Not resolved here; recorded so the
 * question is not lost in an implementation detail.
 */
export const RECONCILE_EPSILON = 1e-9;

export type GraphViolation = { key: string; kind: NodeKind; problem: string };

/**
 * Assert the traversal guarantees. Returns violations rather than throwing, so
 * a caller can report them all rather than the first.
 *
 * A violation is a defect in the engine, not a data condition. §7 of the
 * specification: a violation must fail loudly rather than render — a trace built
 * on numbers that do not reconcile is worse than no trace, because it teaches
 * operators that the explanation is decorative.
 */
export function findGraphViolations(root: CostingNode): GraphViolation[] {
  const out: GraphViolation[] = [];
  const seenKeys = new Set<string>();
  const onPath = new Set<string>();

  const visit = (n: CostingNode) => {
    if (onPath.has(n.key)) {
      out.push({ key: n.key, kind: n.kind, problem: "cycle" });
      return;
    }
    // Terminals may legitimately be shared (one firm setting used by many
    // nodes). Arithmetic nodes may not, or reconciliation double-counts.
    if (seenKeys.has(n.key) && !TERMINAL_KINDS.has(n.kind)) {
      out.push({ key: n.key, kind: n.kind, problem: "duplicate key on a non-terminal" });
    }
    seenKeys.add(n.key);
    onPath.add(n.key);

    const operands = n.operands ?? [];
    const terminal = TERMINAL_KINDS.has(n.kind);

    if (terminal && operands.length > 0) {
      out.push({ key: n.key, kind: n.kind, problem: "terminal carries operands" });
    }
    if (!terminal && n.kind !== "resolution" && operands.length === 0) {
      // An EMPTY SUM is legitimate and must stay expressible: a quote with no
      // packaging lines is a real state, the section still needs a row, and
      // Sigma of nothing is 0. So the rule is not "every non-terminal has
      // operands" — it is that a non-terminal must not assert a value it
      // cannot account for.
      //
      // The distinction is the whole point of the rule. An empty sum valued 0
      // accounts for itself. An empty sum valued 4.20 is a number from
      // nowhere, which is precisely the broken terminal this catches. Relaxing
      // the rule to "empty is fine" would have let the second case through.
      const emptySumAtZero = n.kind === "sum" && Math.abs(n.value) <= RECONCILE_EPSILON;
      if (!emptySumAtZero) {
        out.push({
          key: n.key,
          kind: n.kind,
          problem:
            n.kind === "sum"
              ? `empty sum asserts ${n.value}, which nothing accounts for`
              : "non-terminal has no operands",
        });
      }
    }
    if (!terminal && !n.op) {
      out.push({ key: n.key, kind: n.kind, problem: "non-terminal has no operation" });
    }
    if (n.kind === "resolution") {
      const chosen = (n.candidates ?? []).filter((c) => c.chosen);
      if (chosen.length !== 1) {
        out.push({
          key: n.key,
          kind: n.kind,
          problem: `resolution has ${chosen.length} chosen candidates, expected exactly 1`,
        });
      }
    }
    if (n.kind === "flagged-out" && !n.reason) {
      out.push({ key: n.key, kind: n.kind, problem: "flagged-out carries no reason" });
    }

    if (ARITHMETIC_KINDS.has(n.kind) && operands.length > 0) {
      const expected =
        n.kind === "sum"
          ? operands.reduce((s, o) => s + o.value, 0)
          : n.kind === "blend"
            ? null // weights are not on the operands; asserted by the emitter
            : null;
      if (expected !== null && Math.abs(expected - n.value) > RECONCILE_EPSILON) {
        out.push({
          key: n.key,
          kind: n.kind,
          problem: `operands sum to ${expected}, node value is ${n.value}`,
        });
      }
    }

    for (const o of operands) visit(o);
    onPath.delete(n.key);
  };

  visit(root);
  return out;
}

/** Depth-first walk in operand order. Deterministic, so a digest over the graph
 *  is stable. */
export function walkGraph(root: CostingNode, fn: (n: CostingNode, depth: number) => void): void {
  const go = (n: CostingNode, d: number) => {
    fn(n, d);
    for (const o of n.operands ?? []) go(o, d + 1);
  };
  go(root, 0);
}

/** Locate a node by key — the entry-at-node lookup (R11 §9 `findPath`). */
export function findNode(root: CostingNode, key: string): CostingNode | null {
  let found: CostingNode | null = null;
  walkGraph(root, (n) => {
    if (found === null && n.key === key) found = n;
  });
  return found;
}
