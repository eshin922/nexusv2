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
 * ELEVEN kinds. Ten were inherited; `difference` was added for the Costs
 * cost-stack header, where the gap between the quoted price and the rendered
 * component rows is a real governed quantity with no kind to express it.
 *
 * It was added rather than improvised because both improvisations available
 * were worse: `adjustment` means `base x (1 + rate)` and would not reconcile,
 * and a `sum` with a synthesised negative operand would invent a node nothing
 * computed. Adding a kind is a design decision, and this is the second one
 * the vocabulary has taken — see the restraint note below.
 *
 * Additive under the compatibility rule that consumers ignore unknown node
 * kinds unless they explicitly require them, so GRAPH_VERSION does not bump.
 *
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
  | "difference"
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
  "difference",
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
  /**
   * `blend` only — the weight of each contributor, positionally aligned with
   * `operands`.
   *
   * A blend is a weighted mean, so the operands alone cannot prove it: the same
   * contributor values produce different blends under different weights, and a
   * reader shown only the contributors has no way to check the result. Carrying
   * the weights is what turns the node from a display into evidence.
   *
   * Positional alignment is enforced — a length mismatch is a violation, not a
   * shape to tolerate, because a silently truncated weight list would reconcile
   * a blend over the wrong contributors.
   *
   * Additive optional field; no GRAPH_VERSION bump.
   */
  weights?: number[];
  /**
   * `rate` only — the dollar amount the rate is applied TO.
   *
   * A rate node must identify both the percentage and the basis. A correct
   * dollar result with an ambiguous basis is insufficient provenance: duty of
   * $0.16 could be 4% of factory cost or 2% of landed cost, and an operator
   * cannot tell which without being told, nor check whether the right base was
   * used. "The number is right" is not the same claim as "the number is right
   * for the right reason", and only the second is what a trace is for.
   *
   * Carried as data rather than as an operand because the basis is computed
   * elsewhere in the chain — embedding its subtree here would duplicate
   * arithmetic nodes, and duplicated arithmetic nodes double-count under
   * reconciliation.
   *
   * Additive optional field; no GRAPH_VERSION bump.
   */
  basis?: { label: string; value: number };
  /**
   * `allocation` only — the denominator, as DATA.
   *
   * An allocation is `total / Q`, and Q is not one of the operands: the
   * operands are the numerator's components. Before this field the divisor
   * existed only inside the `op` string, which meant the reconciler could not
   * check the operation the node was advertising. A node that shows an
   * operation and asserts nothing is the R6 failure in miniature.
   *
   * Additive optional field, so it does not bump GRAPH_VERSION.
   */
  divisor?: number;
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

/**
 * The graph's compatibility version.
 *
 * A consumer reads nodes it did not build, so it needs to know whether the
 * shape it was written against is the shape it received. This is that contract,
 * declared before any consumer exists rather than retrofitted once one breaks.
 *
 * BUMP THIS when a change could break a consumer that reads the graph:
 *
 *   · a field is removed or renamed
 *   · the key format changes (a consumer holding a stored key would resolve
 *     nothing, or worse, resolve the wrong node)
 *   · an existing field's MEANING changes — the dangerous case, because the
 *     shape still typechecks and the consumer keeps rendering, wrongly
 *   · a node kind is removed, or an existing kind's operand structure changes
 *
 * DO NOT BUMP for additive change:
 *
 *   · a new section's nodes appearing — that is what `complete` and the
 *     presence of a section's nodes are for
 *   · a new optional field
 *   · a new node kind, provided consumers already handle unknown kinds by
 *     ignoring them rather than throwing
 *
 * The distinction is whether existing consumer code keeps being CORRECT, not
 * whether it keeps compiling.
 */
export const GRAPH_VERSION = 1;

/**
 * The sections a cell's chain must contain before the graph can claim to be
 * complete.
 *
 * Completeness is a property of the EMITTED graph, checked against this list —
 * not a flag flipped on reaching a planned increment number. Those two can
 * disagree, and when they do the flag is the thing that lies: a consumer told
 * the graph is complete will stop checking whether the section it needs is
 * present.
 */
export const REQUIRED_CELL_SECTIONS = ["pkg", "prod", "raw", "frt", "sell-before"] as const;

/**
 * Is every required section represented on every cell root?
 *
 * A cell whose root is an `override` still has to carry its chain — the
 * superseded computation holds the sections, and it is traversable precisely so
 * that this check does not have to special-case it.
 */
export const QUOTE_SCOPE_PREFIX = "quote";

export function graphIsComplete(nodes: CostingNode[]): boolean {
  // Roots are scoped: per-cell for cell computations, per-tier for quote-level
  // blends. Only cell roots carry sections, so only they are checked.
  //
  // Scope is read from the key prefix rather than inferred from kind. The
  // first version of this filtered on `kind !== "blend"` and was wrong: the
  // blend CONTAINER is a sum, so a quote-scope root was checked for cell
  // sections it could never have and completeness reported false forever.
  // Inferring scope from kind was guessing; the key states it.
  const cellRoots = nodes.filter((n) => !n.key.startsWith(QUOTE_SCOPE_PREFIX + "/"));
  if (cellRoots.length === 0) return false;
  return cellRoots.every((root) => {
    const suffixes = new Set<string>();
    walkGraph(root, (n) => {
      const last = n.key.split("/").slice(2).join("/");
      if (last) suffixes.add(last);
    });
    return REQUIRED_CELL_SECTIONS.every((s) => suffixes.has(s));
  });
}

export type CostingGraph = {
  /** See GRAPH_VERSION. Consumers should assert the version they expect. */
  version: number;
  nodes: CostingNode[];
  /**
   * False while sections are still being emitted. A consumer must not read a
   * section that is not present yet, and stating that in the payload is
   * cheaper than a consumer discovering it as a missing node.
   *
   * Note this is NOT the same question as `version`: `complete` says how much
   * of the graph is here, `version` says what shape it is in.
   */
  complete: boolean;
};

export type GraphViolation = { key: string; kind: NodeKind; problem: string };

/**
 * Tolerance that scales with magnitude.
 *
 * A fixed absolute epsilon is wrong in both directions on multiplicative
 * relations: too strict on large values, where float error grows with the
 * operands, and too loose on tiny ones. Relative comparison keeps the check
 * meaningful across a $0.0004 packaging line and a $250,000 tooling total.
 */
function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= RECONCILE_EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Does this node's stated operation actually produce its stated value?
 *
 * Returns a description of the discrepancy, or null. Each arithmetic kind is
 * checked against the operation it ADVERTISES — the point is not that the
 * number is plausible but that the explanation is true.
 *
 * Every arithmetic kind is now checked. `resolution` asserts nothing by design:
 * its children are alternatives, exactly one of which is chosen, and
 * alternatives do not combine.
 */
function reconcile(n: CostingNode, operands: CostingNode[]): string | null {
  switch (n.kind) {
    case "sum": {
      const summed = operands.reduce((s, o) => s + o.value, 0);
      return closeEnough(summed, n.value)
        ? null
        : `operands sum to ${summed}, node value is ${n.value}`;
    }

    case "markup": {
      // `base x (1 + rate)`. The base and the rate are identified by UNIT, not
      // by position — a positional convention would silently reconcile the
      // wrong pair the first time an emitter ordered operands differently.
      const bases = operands.filter((o) => o.unit === "usd");
      const rates = operands.filter((o) => o.unit === "pct");
      if (bases.length !== 1 || rates.length !== 1) {
        return `markup needs exactly one usd operand and one pct operand, found ${bases.length} and ${rates.length}`;
      }
      const expected = bases[0].value * (1 + rates[0].value);
      return closeEnough(expected, n.value)
        ? null
        : `${bases[0].value} x (1 + ${rates[0].value}) = ${expected}, node value is ${n.value}`;
    }

    case "allocation": {
      // `numerator / divisor`, where the operands ARE the numerator's
      // components and the divisor is carried as data.
      if (n.divisor === undefined) {
        return "allocation carries no divisor, so its operation cannot be checked";
      }
      const numerator = operands.reduce((s, o) => s + o.value, 0);
      // Zero-quantity semantics, already established by the engine: there is
      // nothing to spread the total over, so the allocation contributes
      // nothing. The numerator is still a real fact and stays visible — that
      // is the answer to "why is this zero".
      const expected = n.divisor > 0 ? numerator / n.divisor : 0;
      return closeEnough(expected, n.value)
        ? null
        : `${numerator} / ${n.divisor} = ${expected}, node value is ${n.value}`;
    }

    case "difference": {
      // `left - right`, and ORDER IS THE IDENTIFICATION. A difference read the
      // wrong way round is not a smaller error than a wrong number; it inverts
      // the business meaning, turning a price above the build-up into one
      // below it. So the reconciler checks the subtraction in the stated
      // direction, and reversing the operands fails it.
      if (operands.length !== 2) {
        return `difference needs exactly two operands, found ${operands.length}`;
      }
      const expected = operands[0].value - operands[1].value;
      return closeEnough(expected, n.value)
        ? null
        : `${operands[0].value} - ${operands[1].value} = ${expected}, node value is ${n.value}`;
    }

    case "adjustment": {
      const bases = operands.filter((o) => o.unit === "usd");
      const rates = operands.filter((o) => o.unit === "pct");
      if (bases.length !== 1 || rates.length !== 1) {
        return `adjustment needs exactly one usd operand and one pct operand, found ${bases.length} and ${rates.length}`;
      }
      const expected = bases[0].value * (1 + rates[0].value);
      return closeEnough(expected, n.value)
        ? null
        : `${bases[0].value} x (1 + ${rates[0].value}) = ${expected}, node value is ${n.value}`;
    }

    case "blend": {
      // A weighted mean AVERAGES to its value rather than summing to it:
      // Sigma(value x weight) / Sigma(weight).
      if (!n.weights) {
        return "blend carries no weights, so the mean it advertises cannot be checked";
      }
      if (n.weights.length !== operands.length) {
        // Not a tolerable shape. A truncated weight list would reconcile the
        // blend over a subset of its contributors and report it as correct.
        return `blend has ${operands.length} contributors and ${n.weights.length} weights`;
      }
      const totalWeight = n.weights.reduce((a, b) => a + b, 0);
      // Zero total weight is a real state, not an error: a tier with no
      // quantity has nothing to weight by. The contributors stay visible —
      // they are the answer to "why is this zero".
      const expected =
        totalWeight > 0
          ? operands.reduce((acc, o, i) => acc + o.value * n.weights![i], 0) / totalWeight
          : 0;
      return closeEnough(expected, n.value)
        ? null
        : `weighted mean is ${expected}, node value is ${n.value}`;
    }

    case "rate": {
      // `basis x rate`. Note this is NOT the markup shape: a markup multiplies
      // by (1 + rate) because it adds to a cost, while a rate multiplies by
      // the rate itself because it IS the charge. Collapsing the two would
      // reconcile duty at 104% of factory cost and report it as correct.
      if (!n.basis) {
        return "rate carries no basis, so the dollar amount it applies to is ambiguous";
      }
      const rates = operands.filter((o) => o.unit === "pct");
      if (rates.length !== 1) {
        return `rate needs exactly one pct operand, found ${rates.length}`;
      }
      const expected = n.basis.value * rates[0].value;
      return closeEnough(expected, n.value)
        ? null
        : `${n.basis.value} x ${rates[0].value} = ${expected}, node value is ${n.value}`;
    }

    default:
      return null;
  }
}

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

    if (n.kind === "flagged-out" && Math.abs(n.value) > RECONCILE_EPSILON) {
      // Structural, not arithmetic. A flagged-out node asserts that an input
      // was EXCLUDED, so it contributes nothing by definition. A non-zero one
      // would be claiming both that the input is out of the chain and that it
      // is in the price.
      out.push({
        key: n.key,
        kind: n.kind,
        problem: `flagged-out asserts ${n.value}; an excluded input contributes nothing`,
      });
    }

    if (ARITHMETIC_KINDS.has(n.kind) && operands.length > 0) {
      const problem = reconcile(n, operands);
      if (problem) out.push({ key: n.key, kind: n.kind, problem });
    }

    for (const o of operands) visit(o);
    // The superseded chain is DEMOTED, not discarded. It is deliberately not
    // an operand — it takes no part in the arithmetic, and counting it would
    // double the sum — but it must still be validated and reachable, or an
    // operator asking "what would this have been" gets a number with no chain
    // behind it. Demoted must not mean unreachable.
    if (n.superseded) visit(n.superseded);
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
    // Reachable, so entry-at-node can open the chain an override replaced.
    // See findGraphViolations for why it is not an operand.
    if (n.superseded) go(n.superseded, d + 1);
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

/**
 * Resolve one node by EXACT key across a whole graph, failing closed.
 *
 * This is the API a consumer reads commercial values through. `findNode` takes
 * a single root and stops at the first hit; a consumer needs to search every
 * root, and needs the two failure modes to be distinguishable from a legitimate
 * answer:
 *
 *   - MISSING   — the value is not in the graph. Rendering anything at all
 *                 would be inventing it.
 *   - DUPLICATE — the same key appears more than once. The graph does not have
 *                 one answer, so no single answer can be read from it. Taking
 *                 the first would be a coin toss the operator never sees.
 *
 * Both return null rather than a value, and callers must treat null as
 * "cannot display" rather than as zero. A zero is a commercial claim; an
 * absence is not.
 *
 * Reaching for `graph.nodes.find(...)` instead is the specific mistake that
 * shipped a non-functional Cost Stack: the component blends are nested
 * operands of `sell-before`, not roots, so a root-only search silently
 * returned nothing for every tier. Nodes legitimately nest — a node cannot be
 * both a root and an operand without double-counting under reconciliation — so
 * traversal is not an optimisation here, it is the only correct read.
 */
export function resolveNode(
  nodes: readonly CostingNode[],
  key: string,
): CostingNode | null {
  const matches: CostingNode[] = [];
  for (const root of nodes) {
    walkGraph(root, (n) => {
      if (n.key === key) matches.push(n);
    });
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Read a commercial NUMBER out of the graph, or nothing at all.
 *
 * `resolveNode` answers "which node is at this key". This answers the question
 * a display actually asks — "what number may I show here" — and it fails closed
 * on THREE things, not two:
 *
 *   - MISSING    — nothing at that key.
 *   - DUPLICATE  — more than one, so the graph has no single answer.
 *   - FLAGGED-OUT — a node IS there, and it exists precisely to say that no
 *                  number belongs here. Its `value` is 0 by invariant, so a
 *                  caller that reads `.value` off it reads a commercial zero
 *                  out of a node whose entire purpose was to deny one.
 *
 * That third case is why this helper exists rather than each consumer writing
 * `node ? node.value : null`. A zero-quantity tier emits `flagged-out` AT THE
 * KEY THE HEADER ADDRESSES, so the naive read does not fail — it succeeds, and
 * renders $0.00 where the honest answer is a dash. Encoding the check once, at
 * the authority, means a consumer cannot get it wrong by omission.
 */
export function readNodeValue(
  nodes: readonly CostingNode[],
  key: string,
): number | null {
  const node = resolveNode(nodes, key);
  if (!node) return null;
  if (node.kind === "flagged-out") return null;
  return node.value;
}

/**
 * The exact quote-scope key for a per-tier node. Built here rather than
 * interpolated at each call site so consumers cannot drift from the emitter's
 * key grammar — a mistyped key is indistinguishable from a missing node.
 */
export function quoteScopeKey(tierId: string, name: string): string {
  return nodeKey(QUOTE_SCOPE_PREFIX, tierId, name);
}
