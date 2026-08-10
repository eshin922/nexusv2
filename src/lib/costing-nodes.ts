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
  /**
   * `operand ÷ basis`. A margin is the instance that motivated it (OD-019).
   *
   * GENERIC ON PURPOSE. A `margin` kind would name one business quantity in a
   * vocabulary whose other members name operations, and the next ratio would
   * have to reuse a misleading name or add a twelfth kind.
   *
   * The DENOMINATOR is `basis`, not a second operand, for the reason `rate`
   * already gives: the value is computed elsewhere in the chain, and making it
   * an operand here would put one arithmetic node under two parents. §4 rule 5
   * forbids that, and `resolveNode` enforces it — a key reachable twice
   * resolves to nothing.
   *
   * An UNDEFINED ratio is not this kind. Zero denominator means the quantity
   * does not exist, and a node valued 0 would assert a commercial zero where
   * there is none — the fabrication three scalar corrections removed. Emit
   * `flagged-out` with the reason instead.
   */
  | "ratio"
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
  "ratio",
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
  /**
   * A-2 · the address of the AUTHORITY that set this rung, in the key grammar.
   *
   * The engine knows which authority each rung came from — it is what makes a
   * ladder a ladder — so naming it costs nothing and is not a lookup. The
   * provenance layer classifies this address exactly as it classifies any
   * terminal's key, which is what keeps the resolver from having to match on
   * `label` and quietly break the day someone improves the wording.
   *
   * Absent on rungs whose authority has no record to point at.
   */
  provenanceKey?: string;
  /**
   * A-2 · who set this rung's value, and when.
   *
   * **Filled by the provenance overlay, never by the engine.** The engine is
   * pure and cannot read the audit trail; a field it populated would be a
   * guess. Absent means the overlay has not run or found nothing, and absent
   * must render as unattributed rather than as blank-but-sourced.
   *
   * This closes the model gap A-2 recorded: a resolution ends a chain
   * legitimately, but the value it resolves TO was still set by somebody, and
   * `NodeCandidate` had nowhere to say so. R10's `Resolution` renders
   * `node.chosen.origin`; this is that field.
   */
  origin?: NodeOrigin;
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
export const GRAPH_VERSION = 2;

/**
 * Which evaluation produced a graph.
 *
 * NOT a flag on the side: it is required on every `CostingGraph`, because the
 * hazard is a graph that says nothing about itself. Committed and preview
 * graphs share the key space by construction (§3.3) — `{sku}/{tier}/pkg` means
 * the same position in both — so a preview graph handed to a consumer expecting
 * authority answers every question exactly as confidently, and correctly for a
 * quote nobody has agreed to.
 *
 * §3.3 answers a different question well: staged-ness as
 * `committed[key] !== staged[key]` works when a caller holds BOTH and compares
 * them. It says nothing about a single graph in isolation, which is how one
 * would actually leak.
 *
 * WHY THIS BUMPS GRAPH_VERSION, when new kinds and new optional fields do not.
 * The rule in the block above is whether existing consumer code keeps being
 * CORRECT, not whether it keeps compiling — and this is the case that
 * distinguishes them. A v1 consumer handed a preview graph stays perfectly
 * type-correct and silently becomes semantically wrong: it cannot ask the
 * question, so it cannot get the answer wrong loudly. That is precisely the
 * failure the version exists to prevent.
 */
export type GraphEvaluation = "committed" | "preview";

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

/**
 * Quote-WIDE scope: facts that belong to the quote and are not scoped to a
 * tier at all.
 *
 * The effective target margin is the reference case. It is one decision per
 * quote, consumed by every tier's verdict and displayed by surfaces that show
 * no tier. Emitting it per tier would publish N copies of one fact and force a
 * quote-level reader to pick a tier arbitrarily to learn something no tier
 * owns — which is how a surface ends up reading tier 1's copy and calling it
 * the quote's policy.
 *
 * A distinct prefix rather than a reserved tier id, so the scope is decidable
 * from the key alone. `quote/{tierId}` and `quote-wide/{name}` cannot be
 * confused: no tier id is the literal `quote-wide`, and the parser branches
 * before it ever looks at a second segment.
 */
export const QUOTE_WIDE_PREFIX = "quote-wide";

export function graphIsComplete(nodes: CostingNode[]): boolean {
  // Roots are scoped: per-cell for cell computations, per-tier for quote-level
  // blends. Only cell roots carry sections, so only they are checked.
  //
  // Scope is read from the key prefix rather than inferred from kind. The
  // first version of this filtered on `kind !== "blend"` and was wrong: the
  // blend CONTAINER is a sum, so a quote-scope root was checked for cell
  // sections it could never have and completeness reported false forever.
  // Inferring scope from kind was guessing; the key states it.
  const cellRoots = nodes.filter((n) => isCellScoped(n.key));
  if (cellRoots.length === 0) return false;
  return cellRoots.every((root) => {
    const suffixes = new Set<string>();
    walkGraph(root, (n) => {
      const address = parseNodeKey(n.key);
      const last = address ? address.path.join("/") : "";
      if (last) suffixes.add(last);
    });
    return REQUIRED_CELL_SECTIONS.every((s) => suffixes.has(s));
  });
}

export type CostingGraph = {
  /** See GRAPH_VERSION. Consumers should assert the version they expect. */
  version: number;
  /**
   * REQUIRED, and deliberately not optional-defaulting-to-committed. An absent
   * evaluation must never read as authority — a graph that cannot say what it
   * is should be unusable, not assumed.
   */
  evaluation: GraphEvaluation;
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
 *
 * EXPORTED so the trace can display reconciliation rather than compute it. The
 * design prototype re-sums operands in its own render layer, because its data
 * source has no assertion facility to call. Ours does, and a trace that
 * re-derived the check would be asserting agreement between itself and itself
 * — which is the one arrangement that can never fail informatively.
 *
 * Returns null when the node reconciles, or a description of the discrepancy.
 */
export function reconcile(
  n: CostingNode,
  operands: CostingNode[],
): string | null {
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

    case "ratio": {
      // One operand over the basis. Both must be present: a ratio without a
      // denominator is not a ratio that happens to be missing something, it is
      // a node whose advertised operation cannot be performed.
      if (operands.length !== 1) {
        return `ratio has ${operands.length} operands, expected exactly 1`;
      }
      const denominator = n.basis?.value;
      if (denominator === undefined) return "ratio carries no basis to divide by";
      if (denominator === 0) {
        // Unreachable by construction — the emitter uses `flagged-out` for the
        // zero-denominator case — but a ratio that DID reach here would report
        // Infinity or NaN, and a reconciler that returned "fine" for NaN would
        // be worse than one that never ran.
        return "ratio divides by zero; an undefined quantity must be flagged-out";
      }
      const computed = operands[0].value / denominator;
      return closeEnough(computed, n.value)
        ? null
        : `${operands[0].value} / ${denominator} = ${computed}, node value is ${n.value}`;
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

/**
 * Graph-level duplicate detection — every canonical key reachable exactly once.
 *
 * `findGraphViolations` walks ONE root with a fresh `seenKeys`, so a node
 * reachable from two different roots is invisible to it. `resolveNode` sees the
 * same graph and returns null, because it walks every root and requires exactly
 * one match.
 *
 * That disagreement is the gap this closes, and it is worse than either
 * behaviour alone: the validator would pronounce a graph healthy while every
 * reader treated the duplicated keys as unresolvable. Nothing throws. Values
 * simply stop appearing, on a surface nobody changed.
 *
 * Surfaced while evaluating whether the margin ratio could share `revenue` and
 * `cost-total` with their existing roots (OD-019). The answer was no — and the
 * reason the answer was hard to see is that only one of the two mechanisms
 * could express it.
 *
 * SCOPE: this checks reachability across the WHOLE graph, so it is a sibling of
 * `findGraphViolations` rather than part of it. Terminals are included
 * deliberately. §4 rule 5 permits sharing them — "one firm setting used by many
 * nodes" — but `resolveNode` does not distinguish, and a shared terminal is
 * therefore just as unreadable as a shared sum. Where the rule and the reader
 * disagree, the reader is what consumers actually experience.
 */
export function findDuplicateKeys(nodes: readonly CostingNode[]): GraphViolation[] {
  const seen = new Map<string, { kind: NodeKind; count: number }>();
  for (const root of nodes) {
    walkGraph(root, (n) => {
      const prior = seen.get(n.key);
      if (prior) prior.count += 1;
      else seen.set(n.key, { kind: n.kind, count: 1 });
    });
  }
  const out: GraphViolation[] = [];
  for (const [key, { kind, count }] of seen) {
    if (count > 1) {
      out.push({
        key,
        kind,
        problem:
          `reachable ${count} times across the graph; resolveNode returns null ` +
          `for it, so every consumer of this key reads nothing`,
      });
    }
  }
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
 * `expect` defaults to `committed`, so reading preview authority is an explicit
 * act. A consumer that has not thought about evaluation gets the safe answer,
 * and a preview reader has to say so.
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
  graph: CostingGraph,
  key: string,
  expect: GraphEvaluation = "committed",
): number | null {
  if (graph.evaluation !== expect) return null;
  const node = resolveNode(graph.nodes, key);
  if (!node) return null;
  if (node.kind === "flagged-out") return null;
  return node.value;
}

/**
 * Resolve MANY keys in one traversal, with `resolveNode`'s exact semantics.
 *
 * A table reads one node per cell. Calling `resolveNode` per cell walks the
 * whole graph per cell — a fifteen-line, five-tier drilldown is seventy-five
 * full traversals to render one drawer. This walks once.
 *
 * Duplicate detection is per key and behaves identically to `resolveNode`: a
 * key seen twice maps to null, because a graph with two answers has none. The
 * returned map contains an entry for EVERY requested key, so a caller
 * distinguishes "not asked for" from "asked for, unavailable" without having to
 * remember what it asked.
 */
/**
 * ── THE KEY GRAMMAR, PARSED IN ONE PLACE ──────────────────────────────────
 *
 * Keys come in exactly two scopes:
 *
 *   CELL    `{skuId}/{tierId}/…`   one SKU at one tier
 *   QUOTE   `quote/{tierId}/…`     the whole quote at one tier
 *
 * They are distinguished ONLY by whether the first segment is the literal
 * `quote`, and that is easy to get wrong in a way that type-checks, runs, and
 * produces a plausible number.
 *
 * The concrete trap, hit twice while building Gate 1B's verifiers:
 * `{sku}/{tier}/pkg` and `quote/{tier}/pkg` are BOTH three segments ending in
 * `pkg`. The first is one SKU's packaging; the second is the Pricing blend
 * across all of them. A selector written as
 *
 *     p.length === 3 && p[2] === "pkg" && p[1] === tierId
 *
 * matches both and silently adds a mean to the sum it is checking the mean
 * against. It reported 37 of 40 production tiers diverging, and the graph was
 * fine. Nothing failed; the answer was simply wrong, and only an implausible
 * ratio — exactly 0.5000 — gave it away.
 *
 * So no caller parses keys by hand. Everything goes through `parseNodeKey`,
 * and the scope is a discriminated union rather than a convention each script
 * re-implements.
 */
export type NodeAddress =
  | {
      /** A fact about the whole quote, owned by no tier. */
      scope: "quote-wide";
      path: readonly string[];
    }
  | {
      scope: "cell";
      /** The math SKU id — see `mathSkuId` in the adapter. */
      skuId: string;
      tierId: string;
      /** Everything below the cell: `["pkg"]`, `["pkg", lineGroupId]`, … */
      path: readonly string[];
    }
  | {
      scope: "quote";
      tierId: string;
      /** `["sell-before"]`, `["per-unit", "pkg", "cost"]`, … */
      path: readonly string[];
    };

/**
 * Read a key's address, or null when it is not a well-formed one.
 *
 * Returns null rather than guessing. A key that does not parse is a finding —
 * either the grammar grew and this did not, or something is addressing a node
 * that does not exist.
 */
export function parseNodeKey(key: string): NodeAddress | null {
  const parts = key.split("/");
  if (parts[0] === QUOTE_WIDE_PREFIX) {
    if (parts.length < 2 || parts[1] === "") return null;
    return { scope: "quote-wide", path: parts.slice(1) };
  }
  if (parts[0] === QUOTE_SCOPE_PREFIX) {
    // `quote/{tier}` alone is a real key — the sell blend's own node.
    if (parts.length < 2 || parts[1] === "") return null;
    return { scope: "quote", tierId: parts[1], path: parts.slice(2) };
  }
  // A cell needs at least `{sku}/{tier}/{something}`; there is no bare
  // `{sku}/{tier}` node, and treating one as an address would invent a scope.
  if (parts.length < 3 || parts[0] === "" || parts[1] === "") return null;
  return { scope: "cell", skuId: parts[0], tierId: parts[1], path: parts.slice(2) };
}

/** True for `{sku}/{tier}/…`, false for `quote/{tier}/…` and for junk. */
export function isCellScoped(key: string): boolean {
  return parseNodeKey(key)?.scope === "cell";
}

/** True for `quote/{tier}/…`, false for cell keys and for junk. */
export function isQuoteScoped(key: string): boolean {
  return parseNodeKey(key)?.scope === "quote";
}

/**
 * A CELL-scope SECTION node: `{sku}/{tier}/{section}` and nothing deeper.
 *
 * Depth is part of the identity. `{sku}/{tier}/pkg/{lineGroupId}` is a LINE
 * within the section, not the section, and summing the two together
 * double-counts every line. `path.length === 1` is the whole distinction.
 */
export function isCellSectionNode(
  key: string,
  section: string,
  within?: { tierId?: string; skuId?: string },
): boolean {
  const a = parseNodeKey(key);
  if (!a || a.scope !== "cell") return false;
  if (a.path.length !== 1 || a.path[0] !== section) return false;
  if (within?.tierId !== undefined && a.tierId !== within.tierId) return false;
  if (within?.skuId !== undefined && a.skuId !== within.skuId) return false;
  return true;
}

/**
 * Every cell-scope section node for a section, in one traversal.
 *
 * This is what a caller summing "packaging across all SKUs at this tier"
 * actually wants, and writing it once means the quote scope cannot leak in.
 */
export function collectCellSectionNodes(
  graph: CostingGraph,
  section: string,
  within?: { tierId?: string; skuId?: string },
  expect: GraphEvaluation = "committed",
): CostingNode[] {
  const found: CostingNode[] = [];
  if (graph.evaluation !== expect) return found;
  for (const root of graph.nodes) {
    walkGraph(root, (n) => {
      if (isCellSectionNode(n.key, section, within)) found.push(n);
    });
  }
  return found;
}

/**
 * The effective target margin, and WHERE IT CAME FROM.
 *
 * One call, so a consumer cannot read the value correctly and then describe its
 * provenance wrongly — which is the state the surfaces were in: two of five
 * carried a source, three showed the number anonymously, and 12 of 62 quotes
 * override, so the same `35%` meant different things on different screens.
 *
 * Returns null when the node is absent or ambiguous. Callers must treat that as
 * "cannot display", never as the firm default — silently falling back would
 * reinstate the fifth private ladder this replaces.
 */
export type EffectiveTargetRead = {
  value: number;
  /** The rung the engine chose: "Quote override" or "Firm default". */
  source: string;
  isOverride: boolean;
  /** What would apply with no quote override — the ladder minus its top rung.
   *  The popover's "if you clear this" preview needs it, and deriving it from
   *  `firmSettings` there would be the sixth private copy of the ladder. */
  withoutOverride: number | null;
};

export function readEffectiveTargetMargin(
  graph: CostingGraph,
  expect: GraphEvaluation = "committed",
): EffectiveTargetRead | null {
  if (graph.evaluation !== expect) return null;
  const node = resolveNode(graph.nodes, quoteWideKey("target-margin"));
  if (!node || node.kind !== "resolution") return null;
  const chosen = (node.candidates ?? []).find((c) => c.chosen);
  if (!chosen) return null;
  const below = (node.candidates ?? []).find(
    (c) => c.label !== "Quote override" && c.value !== null,
  );
  return {
    value: node.value,
    source: chosen.label,
    isOverride: chosen.label === "Quote override",
    withoutOverride: below ? below.value : null,
  };
}

export function resolveNodes(
  graph: CostingGraph,
  keys: Iterable<string>,
  expect: GraphEvaluation = "committed",
): Map<string, CostingNode | null> {
  const wanted = new Set(keys);
  if (graph.evaluation !== expect) {
    const out = new Map<string, CostingNode | null>();
    for (const key of wanted) out.set(key, null);
    return out;
  }
  const nodes = graph.nodes;
  if (wanted.size === 0) return new Map();
  const found = new Map<string, CostingNode | null>();
  for (const root of nodes) {
    walkGraph(root, (n) => {
      if (!wanted.has(n.key)) return;
      // Second sighting demotes the entry to null and stays there; a third
      // must not resurrect it.
      found.set(n.key, found.has(n.key) ? null : n);
    });
  }
  const out = new Map<string, CostingNode | null>();
  for (const key of wanted) out.set(key, found.get(key) ?? null);
  return out;
}

/**
 * The exact quote-scope key for a per-tier node. Built here rather than
 * interpolated at each call site so consumers cannot drift from the emitter's
 * key grammar — a mistyped key is indistinguishable from a missing node.
 */
/** Address a quote-wide fact: `quote-wide/{name}`. */
/**
 * `quote-wide/{name}` — and, for a resolution's rungs, `.../{authority}`.
 *
 * The extra segment addresses WHICH AUTHORITY set a candidate's value, not a
 * new node. A-2 needs it because a resolution node has no author (nobody sets
 * a choice) while its winning rung does, and the two must be addressable
 * separately or provenance attaches to the wrong thing.
 */
export function quoteWideKey(name: string, authority?: string): string {
  return authority === undefined
    ? nodeKey(QUOTE_WIDE_PREFIX, name)
    : nodeKey(QUOTE_WIDE_PREFIX, name, authority);
}

export function quoteScopeKey(tierId: string, name: string): string {
  return nodeKey(QUOTE_SCOPE_PREFIX, tierId, name);
}
