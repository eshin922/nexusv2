"use client";

// Phase 3 · progressive traceability — the trace overlay.
//
// Canonical source: `docs/design-authority/r12-pricing-workspace/app/r10/
// pricing-trace.jsx`, with its `.r10-*` class vocabulary, copied verbatim into
// `src/styles/r10-pricing-workspace.css`.
//
// ── THE GOVERNING RULE ────────────────────────────────────────────────────
//
//     Render the canonical graph. Do not reconstruct or reinterpret it.
//
// The design source states the same thing about itself, and it is the reason
// the prototype splits the way it does:
//
//     "This file is PRESENTATION ONLY. Every number and every trace node comes
//      from data.js, which computes the chain rather than storing it."
//
// So this component walks `CostingNode` and renders what it finds. It does not
// decide what a node means, does not compute a value, and — the one place it
// deviates from the prototype — does not check reconciliation itself.
//
// ── WHERE THIS DEPARTS FROM THE PROTOTYPE, AND WHY ────────────────────────
//
// R10's `Recon` re-sums a node's operands in the render layer. That is correct
// there: its `data.js` has no assertion facility to call, so the check has to
// live somewhere and the renderer is the only place available.
//
// We have `reconcile()` in the node module, which is the same check the graph
// validates itself with. Calling it means the trace displays the engine's
// verdict. Re-summing here would mean the trace asserts agreement between
// itself and itself, which is the one arrangement that can never fail
// informatively — and reconciliation is precisely the property the whole
// design rests on.
//
// ── PROVENANCE, AND A-2 ───────────────────────────────────────────────────
//
// Origin terminals render at whatever grade they carry. Most are `thin` today:
// the input-type → audit-row query (A-2) is not written, so the engine cannot
// name a person for most inputs and says so rather than defaulting one.
//
// A thin terminal is NOT rendered as broken. "This is where the chain ends and
// we cannot yet say who" is a true statement, and the structural trace is
// navigable to that point today. When A-2 lands, the same component renders
// the richer grade with no change here.

import { useState } from "react";
import {
  TERMINAL_KINDS,
  reconcile,
  resolveNode,
  type CostingGraph,
  type CostingNode,
} from "@/lib/costing-nodes";

// ── formatting ────────────────────────────────────────────────────────────

function fmtPct(v: number): string {
  const p = v * 100;
  return `${p.toFixed(Math.abs(p % 1) < 0.001 ? 0 : 1)}%`;
}

function fmtUsd(v: number, dp = 4): string {
  return `$${v.toFixed(dp)}`;
}

/** By the node's own declared unit. The component does not infer one. */
function valueOf(n: CostingNode): string {
  if (n.unit === "pct") return fmtPct(n.value);
  if (n.unit === "count") return n.value.toLocaleString();
  return fmtUsd(n.value);
}

/**
 * The vocabulary the trace speaks, one label per kind.
 *
 * An exhaustive `Record`, so adding a kind to the union fails to compile here
 * rather than falling through to a default. Eleven kinds; the prototype's
 * table listed nine, which is how a renderer meets a node it has no branch
 * for.
 */
const KIND_LABEL: Record<CostingNode["kind"], string> = {
  sum: "sum",
  markup: "cost × markup",
  allocation: "allocation",
  rate: "rate",
  adjustment: "adjustment",
  blend: "weighted mean",
  difference: "difference",
  resolution: "resolution",
  origin: "origin",
  override: "human act",
  "flagged-out": "not in chain",
};

/** Somewhere further to go: operands, candidates, or a superseded chain. */
function expandable(n: CostingNode): boolean {
  return (
    (n.operands?.length ?? 0) > 0 ||
    (n.candidates?.length ?? 0) > 0 ||
    n.superseded !== undefined
  );
}

// ── terminals ─────────────────────────────────────────────────────────────

/**
 * A human act, at whatever grade the engine could establish.
 *
 * Two grades, and the thin one is not a deficiency. "Who set this and when" is
 * a complete answer to the stopping rule; a source document exists only where
 * one was recorded. Until A-2 lands, most terminals cannot even name the
 * person — and saying so is still the end of the chain, honestly reported.
 */
function Origin({ node, stop }: { node: CostingNode; stop?: string }) {
  const o = node.origin;
  if (!o) return null;
  const sourced = o.grade !== "thin" && o.doc !== null;
  const line =
    stop ??
    (sourced
      ? "end of chain · entered from a supplier source"
      : o.actor !== null
        ? "end of chain · a person set this figure; no source document is recorded"
        : // The honest statement of the A-2 gap, at the point it is felt.
          "end of chain · provenance for this input type is not yet queryable");
  return (
    <div className={"r10-origin" + (sourced ? " sourced" : "")}>
      <span className="seal">✎</span>
      <div className="body">
        <div className="who">{o.actor ?? "not yet attributed"}</div>
        {o.when && <div className="when">{o.when}</div>}
        {o.doc && <span className="doc">{o.doc}</span>}
        <span className="stop">{line}</span>
      </div>
    </div>
  );
}

/**
 * A choice, shown with the alternatives it beat.
 *
 * The losing rungs are the point. An adjustment that reads "10%" tells an
 * operator what happened; a ladder showing that a tier adjustment was not set
 * and the global one therefore applied tells them WHY, and what to change.
 */
function Resolution({ node }: { node: CostingNode }) {
  return (
    <div className="r10-res">
      {(node.candidates ?? []).map((c, i) => (
        <div
          className={
            "r10-res-row " + (c.chosen ? "won" : c.value === null ? "absent" : "")
          }
          key={i}
        >
          <span className="mark">{c.chosen ? "●" : c.value === null ? "✕" : "○"}</span>
          <span className="lvl">{c.label}</span>
          <span className="pv">
            {c.value === null ? "not set" : fmtPct(c.value)}
          </span>
          {c.unavailableReason && <span className="why">{c.unavailableReason}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Reconciliation, as the graph asserts it — not as the trace recomputes it.
 *
 * Rendered for every arithmetic node that has operands, including the ones a
 * naive checker would skip. A `blend` averages rather than sums and a `markup`
 * multiplies; each is checked against the operation it ADVERTISES, because the
 * claim being made is not that the number is plausible but that the
 * explanation is true.
 */
function Recon({ node }: { node: CostingNode }) {
  const operands = node.operands ?? [];
  if (operands.length === 0) return null;
  const problem = reconcile(node, operands);
  if (problem === null) {
    return (
      <div className="r10-recon">
        <span>✓</span>
        <span>
          {operands.length} operand{operands.length === 1 ? "" : "s"} reconcile
          exactly
        </span>
      </div>
    );
  }
  // Shown, loudly, rather than suppressed. A level that does not reconcile is
  // the one thing the design says must fail visibly instead of rendering as
  // though nothing were wrong.
  return (
    <div className="r10-recon">
      <span className="x">✕</span>
      <span>does NOT reconcile — {problem}</span>
    </div>
  );
}

// ── one level ─────────────────────────────────────────────────────────────

function Level({
  node,
  depth,
  openPath,
  onToggle,
}: {
  node: CostingNode;
  depth: number;
  openPath: Record<number, string>;
  onToggle: (depth: number, key: string | null) => void;
}) {
  const operands = node.operands ?? [];
  const openChild = operands.find((o) => openPath[depth + 1] === o.key);

  return (
    <div className="r10-level">
      <div className="r10-lhead">
        <span className="depth">{depth === 0 ? "the number" : `level ${depth}`}</span>
        <span className="what">{node.label}</span>
        <span className="val">
          {valueOf(node)} <span className="unit">{node.unit}</span>
        </span>
      </div>

      {node.op && (
        <div className="r10-op">
          <span className="eq">=</span>
          <span className="expr">{node.op}</span>
          <span className="kindtag">{KIND_LABEL[node.kind]}</span>
        </div>
      )}

      {node.kind === "flagged-out" && (
        <div className="r10-flagged">
          <strong>Not part of this price.</strong> {node.reason}
        </div>
      )}

      {node.kind === "resolution" && <Resolution node={node} />}

      {node.origin && node.kind !== "resolution" && <Origin node={node} />}

      {operands.length > 0 && (
        <div>
          <div className="r10-operands">
            {operands.map((o) => {
              const can = expandable(o) || TERMINAL_KINDS.has(o.kind);
              const open = openPath[depth + 1] === o.key;
              return (
                <button
                  type="button"
                  key={o.key}
                  className={"r10-operand" + (can ? "" : " leaf")}
                  onClick={can ? () => onToggle(depth + 1, open ? null : o.key) : undefined}
                >
                  <span className="chev">{can ? (open ? "▾" : "▸") : "·"}</span>
                  <span className="oname">{o.label}</span>
                  {!can && <span className="otag">flat</span>}
                  <span className="oval">{valueOf(o)}</span>
                </button>
              );
            })}
          </div>
          <Recon node={node} />
        </div>
      )}

      {openChild && (
        <div className={"r10-nest d" + Math.min(depth + 1, 4)}>
          <Level
            node={openChild}
            depth={depth + 1}
            openPath={openPath}
            onToggle={onToggle}
          />
        </div>
      )}
    </div>
  );
}

// ── the panel ─────────────────────────────────────────────────────────────

export interface PricingTraceProps {
  graph: CostingGraph;
  /** Entry point. The trace opens AT this node, not at the root. */
  nodeKey: string;
  title: string;
  onClose: () => void;
}

export function PricingTrace({ graph, nodeKey, title, onClose }: PricingTraceProps) {
  const [openPath, setOpenPath] = useState<Record<number, string>>({});

  // One chain open at a time: opening at depth d discards everything below it.
  const toggle = (depth: number, key: string | null) =>
    setOpenPath((prev) => {
      const next: Record<number, string> = {};
      for (const d of Object.keys(prev)) {
        if (Number(d) < depth) next[Number(d)] = prev[Number(d)];
      }
      if (key) next[depth] = key;
      return next;
    });

  // FAIL CLOSED. `resolveNode` returns null for a key that is missing AND for
  // one that appears more than once — a duplicate is not a near-miss to
  // recover from by taking the first, because "the first" is an ordering
  // accident and the two may differ.
  //
  // A trace that cannot find its node says so. The alternative is a panel
  // rendering a chain for a different number than the one that was pressed,
  // which is worse than no panel: it is confidently wrong, and nothing about
  // it looks wrong.
  const root = resolveNode(graph.nodes, nodeKey);

  return (
    <div className="r10-trace">
      <div className="r10-anchor">
        <span className="q">{title}</span>
        <span className="acts">
          <button className="btn ghost sm" type="button" onClick={() => setOpenPath({})}>
            Collapse chain
          </button>
          <button className="btn ghost sm" type="button" onClick={onClose}>
            ✕ Close
          </button>
        </span>
      </div>

      <div className="r10-levels">
        {root === null ? (
          <div className="r10-flagged">
            <strong>This number cannot be traced.</strong> No single node
            answers to <code>{nodeKey}</code> in the computation graph — it is
            either absent or duplicated. Rather than show a chain that might
            belong to a different figure, the trace stops here.
          </div>
        ) : root.kind === "override" ? (
          <div>
            {/*
              A price someone set directly. There is no arithmetic above it —
              saying so plainly matters more than showing the chain it replaced,
              because the operator's question ("why is it this?") has a
              one-sentence answer: a person decided.
            */}
            <div className="r10-override">
              <div className="lead">
                This price was set by a person, not calculated.
              </div>
              <div className="sub">
                {fmtUsd(root.value, 2)} was entered directly. It replaces the
                computed chain entirely — tier and global adjustments no longer
                reach this cell.
              </div>
              <div className="nochain">
                <span>⊘</span> no arithmetic above this point
              </div>
            </div>
            <Origin
              node={root}
              stop="end of chain · the price is this because someone decided it"
            />
            {/*
              The superseded chain is DEMOTED, not discarded. An operator asking
              "what would this have been" gets a real answer with a real chain
              behind it — which is only possible because the graph keeps it
              reachable rather than dropping it.
            */}
            {root.superseded && (
              <div className="r10-superseded">
                <Level
                  node={root.superseded}
                  depth={0}
                  openPath={openPath}
                  onToggle={toggle}
                />
              </div>
            )}
          </div>
        ) : (
          <Level node={root} depth={0} openPath={openPath} onToggle={toggle} />
        )}
      </div>
    </div>
  );
}
