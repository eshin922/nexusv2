"use client";

// slice-pricing-surface-redesign Step 6 — DETAIL zone components.
//
// Seven components, one shared discipline: every read flows from the
// classifier output (QuoteState). No component re-derives status,
// mode, qualifier copy, projected blended, per-cell bucket, or
// per-SKU rollup. The §3 source-of-truth rule (Round-2 fix #1) is
// preserved at the type system: every prop is a QuoteState field;
// the compiler refuses component-side derivation.
//
//   - DetailZone: toggle wrapper; sessionStorage-persisted
//     expand/collapse state. Content identical across modes per
//     data-source map §DETAIL.
//   - DetailGlobalAdjust: writable input bound to
//     quote.global_price_adj_pct (real production field name per
//     Catch #7 — NOT the prototype's "global_lift_pct"). onPreview
//     handler is page-composer-supplied (Step 7).
//   R12 §13 removed three surfaces from this zone, and the removals are the
//   substance of the change rather than tidying:
//     - DetailTierTable   the banner and the stack already state the verdict
//     - DetailPerSku      superseded by entry-at-node in the trace
//     - DetailMetaTiles   the client benchmark FOLDED into the grid, where it
//                         sits beside the decision it informs
//   Each had zero other consumers; leaving them on disk is the orphan the
//   consolidation checklist exists to prevent.
//
//   - (removed) DetailTierTable: per-tier compliance table from state.tiers[]
//     rollup; status badges + OVR chip read classifier-owned fields.
//   - DetailCostStack: per-tier × per-component rollup driving the
//     R6 cost-stack component. Q6 disposition: rollup formula lives
//     here temporarily until the costing math layer surfaces the
//     rolled-up shape (TODO banked at the bucket-formation site).
//   - DetailPerSku: per-SKU card grid; expand toggles SkuBreakdown.
//   - SkuBreakdown: per-tier rows for one SKU; cell.status +
//     cell.client_target_delta consumed verbatim from classifier
//     (Round-2 fix #1). Catch #5 hint: shared primitives
//     (MarginVerdictPill / MarginSparkline / TwoAxisVerdictPair /
//     ReverseSolveDialog) remain available for natural reuse if
//     PSR compositions surface need; v1 ships the prototype's
//     bd-row structure verbatim per Pattern 28.
//   - DetailMetaTiles: reference tiles (most-headroom-tier,
//     client-benchmark-count). Folded into DETAIL per CD §4.3
//     disposition.
//
// Canonical CSS register: `.psr-*` (Path B-default; r-psr-pricing.css
// from Step 4). JSX class names mirror CD prototype 1:1.

import { Fragment, useCallback, useState } from "react";
import { usePricingStaging } from "./pricing-staging-context";
import { useQuoteAdjustmentOrigin } from "./pricing-provenance-context";
import type {
  NoMarginReason,
  QuoteState,
  TierRollup,
} from "@/lib/pricing-classifier";
import type { GlobalPricingPreview } from "@/lib/pricing-lift";
import { fmtPct, fmtPct0, fmtQty, fmtUsd2 } from "./format";

// ──────────────────────────────────────────────────────────────────
// DetailZone — toggle wrapper.
// ──────────────────────────────────────────────────────────────────
//
// Session-persisted expand/collapse via sessionStorage key
// "psr.detail.open.{quoteId}". Per brief §6: "session-only in v1.
// No per-PM preference — that's v1.5+ if data shows the need."
//
// Mode transitions preserve the open/closed state per CD §4.6:
// "DETAIL's expanded/collapsed state is preserved across re-renders"
// + "No auto-expand on escalation." The sessionStorage key is
// quote-scoped so collapsing on one quote doesn't bleed across
// scenarios; closing the modal / navigating away clears v1 session
// state at logout.

const SS_KEY = (quoteId: string) => `psr.detail.open.${quoteId}`;

// Post-Step-6 fix batch — default state is OPEN. Absence of a
// session preference means "no PM has toggled yet" → open by
// default. Session-persisted collapse still works: if PM
// explicitly toggles closed ("0"), that sticks for the session.
function readSessionOpen(quoteId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.sessionStorage.getItem(SS_KEY(quoteId));
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

function writeSessionOpen(quoteId: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SS_KEY(quoteId), open ? "1" : "0");
  } catch {
    // sessionStorage may be unavailable (private mode + quota);
    // expand state degrades to per-mount only.
  }
}

export function DetailZone({
  state,
  blendedByTier,
  onPreviewGlobalAdjust,
  globalPreview,
  onCancelGlobalPreview,
  onApplyGlobalPreview,
  onUndoGlobalAdjust,
  canUndoGlobalAdjust,
  pricingMutationPending,
  pricingConfirmation,
  onTraceStackCell,
  tracedStackCell,
  renderStackTrace,
  renderStackDelta,
  renderStackMarginDelta,
}: {
  state: QuoteState;
  /** Blended per-unit values read from the canonical graph, keyed by the
   *  classifier's numeric tier id. Resolved once at the composition point. */
  blendedByTier: Map<number, BlendedTierComponents>;
  /**
   * Retained on the contract, unused by the zone.
   *
   * It keyed the session-persisted collapse that R12 removed. The prop stays
   * because callers pass it and a future per-quote detail preference would key
   * on it again; nothing here reads it today.
   */
  quoteId?: string;
  // CB Patch round 3 BUG-B — composer forwards an onPreview
  // handler that calls updateQuoteGlobalPriceAdj. Optional so
  // standalone consumers (storybook, test fixtures) can omit.
  onPreviewGlobalAdjust?: (liftPct: number) => void | Promise<void>;
  globalPreview?: GlobalPricingPreview | null;
  onCancelGlobalPreview?: () => void;
  onApplyGlobalPreview?: () => void | Promise<void>;
  onUndoGlobalAdjust?: () => void | Promise<void>;
  canUndoGlobalAdjust?: boolean;
  pricingMutationPending?: boolean;
  pricingConfirmation?: string | null;
  // Phase 3 mount — cost-stack trace + staged deltas. All four are supplied by
  // the composition point, which is the only place that holds the graphs and
  // the tier identity these need. Optional so standalone consumers (tests,
  // fixtures) mount the zone without them.
  onTraceStackCell?: (nodeKey: string, title: string) => void;
  tracedStackCell?: TracedStackCell | null;
  renderStackTrace?: () => React.ReactNode;
  renderStackDelta?: (nodeKey: string) => React.ReactNode;
  renderStackMarginDelta?: (nodeKey: string) => React.ReactNode;
}) {
  // R12 §8a — **`Show pricing detail` is gone as a control.** Not re-ordered,
  // removed: "The detail is the page", per Edward's standing directive that it
  // stay open. The session-persisted collapse went with it, along with the
  // hydration dance that defaulted OPEN on the server and then re-read
  // sessionStorage to find out whether the operator had closed it.
  //
  // ORDER IS THE CANONICAL ORDER (`app/r12/pricing-page.jsx`):
  //   ComplianceGrid → AdjustmentPanel → CostStack → trace
  //
  // The adjustment panel sits between the grid and the stack because it is the
  // lever you reach for after reading compliance and before reading where the
  // money lands. It used to sit first, above the thing it responds to.
  //
  // Three surfaces are NOT here any more, and their absence is the point —
  // R12 §13: "the page loses another surface."
  //
  //   · Per-tier compliance table — the banner states the verdict and the
  //     stack's margin column carries the number. A third statement of the
  //     same fact is a third thing that can disagree.
  //   · Per-SKU breakdown — superseded by entry-at-node. Pressing any number
  //     opens the trace AT that node, which is the same data in the role R11
  //     §12 said it belonged in.
  //   · Reference / client benchmark — FOLDED, not duplicated (§13). The
  //     benchmark is stated on the SKU row and compared on the cells, in the
  //     grid, next to the decision it informs. A tile at the foot counting how
  //     many SKUs carry one is the comparison sitting furthest from its use.
  return (
    <div className="psr-detail open">
      <div className="psr-detail-body">
        <DetailGlobalAdjust
          state={state}
          onPreview={onPreviewGlobalAdjust}
          preview={globalPreview}
          onCancel={onCancelGlobalPreview}
          onApply={onApplyGlobalPreview}
          onUndo={onUndoGlobalAdjust}
          canUndo={canUndoGlobalAdjust}
          pending={pricingMutationPending}
          confirmation={pricingConfirmation}
        />
        <DetailCostStack
          state={state}
          blendedByTier={blendedByTier}
          onTrace={onTraceStackCell}
          traced={tracedStackCell}
          renderTrace={renderStackTrace}
          renderDelta={renderStackDelta}
          renderMarginDelta={renderStackMarginDelta}
        />
      </div>
    </div>
  );
}

export function DetailGlobalAdjust({
  state,
  onPreview,
  preview,
  onCancel,
  onApply,
  onUndo,
  canUndo,
  pending,
  confirmation,
}: {
  state: QuoteState;
  onPreview?: (liftPct: number) => void;
  preview?: GlobalPricingPreview | null;
  onCancel?: () => void;
  onApply?: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  pending?: boolean;
  confirmation?: string | null;
}) {
  // Convert decimal global_price_adj_pct (e.g., 0.05) → integer %
  // for display (5). Use 0 when the input field is empty / unparseable
  // so the keystroke pipeline doesn't NaN. State.quote carries the
  // raw classifier input; the (state.quote as any).global_price_adj_pct
  // path is intentional — classifier consumers should treat
  // state.quote as opaque pass-through (see classifier doc comment).
  // Here we read it for the input default value only; recompute lives
  // in the page composer (Step 7).
  const quoteAdj =
    (state.quote as { global_price_adj_pct?: number | string | null })
      .global_price_adj_pct;
  const initial =
    quoteAdj == null || quoteAdj === ""
      ? 0
      : typeof quoteAdj === "string"
        ? Number(quoteAdj) * 100
        : quoteAdj * 100;
  const [draft, setDraft] = useState(String(initial));
  const handlePreview = useCallback(() => {
    const v = Number(draft);
    if (Number.isFinite(v)) onPreview?.(v);
  }, [draft, onPreview]);

  // The quote-wide lever, staged rather than committed on contact.
  //
  // `stageGlobalAdj` takes a DECIMAL; the input is a percentage, because that
  // is what an operator types. The conversion happens here, once, at the
  // boundary between the two vocabularies — the same discipline the action
  // layer uses for every other percentage column.
  const { stageGlobalAdj, working, committable } = usePricingStaging();
  // The quote-wide adjustment's own authority. `quote/global-adjustment` is not
  // a graph node — the graph carries the adjustment per CELL — so this asks the
  // overlay directly for the quote-scoped lever, which the classifier maps to
  // `global_price_adj_updated` on the quote.
  const adjustmentOrigin = useQuoteAdjustmentOrigin();
  const draftDecimal = Number(draft) / 100;
  const stageable =
    committable &&
    Number.isFinite(Number(draft)) &&
    Math.abs(draftDecimal - working.globalAdj) > 1e-9;
  const handleStage = useCallback(() => {
    const v = Number(draft);
    if (Number.isFinite(v)) stageGlobalAdj(v / 100);
  }, [draft, stageGlobalAdj]);
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Global price adjustment</h4>
        <span className="meta">Tuning lever · applies across all tiers</span>
      </div>
      <div className="psr-global-adjust">
        {/*
          R12 — "currently 2.5% · set by Maya Okafor, 2026-06-30".

          Read through the SAME A-2 overlay the trace and CellAction use, by
          node key, with no second lookup. The overlay is already mounted and
          already fetched for this page, so this costs a map read — it does NOT
          move the ~350ms attribution query onto the render path.

          Renders nothing when nothing is recorded. An adjustment nobody can be
          named for says "currently X%" and stops, rather than inventing an
          author to complete the sentence.
        */}
        {adjustmentOrigin && (
          <div className="lab" style={{ gridColumn: "1 / -1" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              currently {initial}%
            </span>
            <span className="hint">
              set by {adjustmentOrigin.actor}
              {adjustmentOrigin.when
                ? ` · ${new Date(adjustmentOrigin.when).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`
                : ""}
            </span>
          </div>
        )}
        <div className="lab">
          Lift all tiers proportionally to recover margin without distorting
          the volume curve.
          <span className="hint">
            Surgical (single-tier) lives on the per-tier table below.
          </span>
        </div>
        <div className="input-cluster">
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              onCancel?.();
            }}
            aria-label="Global lift percentage"
          />
          <span className="unit">% sell-price lift</span>
          {/*
            R12 §2 — the missing half.

            "Preview without commit is staging with the second half absent —
            the concept was half-built, which is exactly what R12 exists to
            finish." `Preview changes` previews only; `Stage this adjustment`
            puts the quote-wide lever in the working set with every other
            staged change, so ONE Apply governs the page (load-bearing 18).

            Ghost first, primary second: previewing is the cheaper act and the
            one an operator reaches for while deciding.
          */}
          <button
            type="button"
            className="btn ghost sm"
            onClick={handlePreview}
            disabled={pending}
          >
            Preview changes
          </button>
          <button
            type="button"
            className="btn primary sm"
            onClick={handleStage}
            disabled={pending || !stageable}
            title={
              stageable
                ? undefined
                : "Enter a percentage different from the one in effect."
            }
          >
            Stage this adjustment
          </button>
        </div>
      </div>
      {preview && (
        <div aria-label="Bulk pricing preview" style={{ marginTop: 12 }}>
          <p><strong>Preview only.</strong> No changes have been committed.</p>
          <table className="psr-tier-table">
            <thead><tr>
              <th>Tier</th><th>Current adjustment</th><th>Current price</th>
              <th>Delta</th><th>Resulting adjustment</th><th>Resulting price</th>
            </tr></thead>
            <tbody>
              {preview.tiers.map((tier) => (
                <tr key={tier.tierId}>
                  <td>{tier.label}</td>
                  <td>{fmtPct(tier.currentAdjustment)}%</td>
                  <td>{fmtUsd2(tier.currentCustomerPrice)}</td>
                  <td>{tier.adjustmentDelta >= 0 ? "+" : ""}{fmtPct(tier.adjustmentDelta)}%</td>
                  <td>{fmtPct(tier.resultingAdjustment)}%</td>
                  <td>{fmtUsd2(tier.resultingCustomerPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="button" className="cta" onClick={onApply} disabled={pending}>
              {pending ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      )}
      {confirmation && (
        <div role="status" style={{ marginTop: 10 }}>
          {confirmation}
          {canUndo && <> <button type="button" onClick={onUndo} disabled={pending}>Undo</button></>}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// DetailCostStack — per-tier × per-component rollup.
// ──────────────────────────────────────────────────────────────────
//
// Q6 disposition: the R6.2 multi-leg + customs JSONB → {pkg, prod,
// frt, dt} rollup is owned by the costing math layer. Until the math
// layer surfaces the rolled-up shape, this component computes the
// rollup inline from `cell.cost_stack` 4-bucket primitives (which
// classifier passes through verbatim from input). The TODO is banked
// at the bucket-formation site below + in the classifier header
// comment.
//
// R6 reuse: the prototype mounts a `window.NXR6CostStack` global.
// Production v1 ships without an R6-equivalent React component yet
// — the redesigned cost stack is its own next-up follow-up
// (designer notes §4.7 "v1 only renders cost stack inside DETAIL").
// v1 renders a structured placeholder showing the per-tier rollup
// data so PMs can verify the math while CC threads the R6 component
// import in a follow-up commit / slice.

const tierStatusToR6 = (
  s: TierRollup["status"],
): "good" | "below_target" | "bad" | "incomplete" =>
  s === "above_target"
    ? "good"
    : s === "below_target"
      ? "below_target"
      : s === "below_floor"
        ? "bad"
        : "incomplete";

interface CostStackBucketDisplay {
  key: "pkg" | "prod" | "raw" | "frt" | "dt" | "pass";
  label: string;
  /**
   * The blended SELL contribution per unit. Named `cost` for the column it
   * fills, which is a leftover from when this table computed cost — the value
   * has always been marked up. The heading now says so.
   */
  cost: number | null;
  markup: number | null;
  internal?: boolean;
}

/**
 * Blended per-unit values for one tier, read from the canonical graph.
 *
 * Arrives as a PROP rather than being fetched here. This file's discipline is
 * that every read is a QuoteState-shaped prop, so the compiler can refuse
 * component-side derivation; reaching for the graph with a hook would bypass
 * the mechanism that enforces that for everything else in the file. Resolution
 * happens once, at the composition point.
 */
export type BlendedTierComponents = {
  pkg: number;
  prod: number;
  raw: number;
  frt: number;
  dt: number;
  sellBefore: number;
  sell: number;
  /**
   * The governed blended margin for this tier, from `quote/{tier}/margin`.
   *
   * NULLABLE where the other six are not, and the row still renders. Blended
   * sell of zero makes the ratio undefined, the engine flags the node out
   * rather than publishing 0%, and `readNodeValue` refuses it — so a tier can
   * have a complete cost stack and no margin. Requiring it would blank six
   * real numbers to withhold a seventh that does not exist.
   */
  margin: number | null;
  /**
   * The canonical node key each of those seven values was read from.
   *
   * Carried alongside the value rather than rebuilt here, for the same reason
   * the value is: `quoteScopeKey` needs the tier UUID, and this file only has
   * the classifier's numeric id. A component that reconstructed the key would
   * be resolving identity, and would be one renaming away from opening a trace
   * on a different number than the one pressed.
   */
  keys: {
    pkg: string;
    prod: string;
    raw: string;
    frt: string;
    dt: string;
    sellBefore: string;
    sell: string;
    margin: string;
  };
};

interface TierCostStackDisplay {
  id: string;
  /** The classifier's numeric tier id — which row a trace belongs beneath. */
  numericId: number;
  label: string;
  units: number | null;
  subtotal: number | null;
  adjustment: number;
  sell: number | null;
  margin_pct: number | null;
  margin_state: "good" | "below_target" | "bad" | "incomplete";
  blended_no_margin_reason: NoMarginReason | null;
  components: CostStackBucketDisplay[];
  keys: BlendedTierComponents["keys"] | null;
}

/**
 * Which cell the trace is currently open at, and beneath which row it belongs.
 *
 * The tier id is carried explicitly rather than parsed back out of the node
 * key. Reading a UUID out of a string to decide where a panel renders is
 * identity derivation in the layout layer, and it would break silently the
 * first time the key grammar gained a segment.
 */
export interface TracedStackCell {
  tierId: number;
  nodeKey: string;
}

/** What each traceable column is called when it titles a trace panel. */
const COLUMN_TITLE = {
  pkg: "Packaging · blended per unit",
  prod: "Production · blended per unit",
  raw: "Raw materials · blended per unit",
  frt: "Freight · blended per unit",
  dt: "Duty + tariff · blended per unit",
  sellBefore: "Sell before adjustment · blended per unit",
  sell: "Quoted sell · blended per unit",
  margin: "Blended margin · this tier",
} as const;

/**
 * One numeric cell, pressable when the graph has a node behind it.
 *
 * A cell with no key is rendered as plain text rather than as a disabled
 * button. "Nothing to press" and "a control that refuses you" say different
 * things, and only the first is true: the value is there, the chain behind it
 * is not readable, and a dead affordance would suggest otherwise.
 */
function StackNumCell({
  text,
  nodeKey,
  title,
  traced,
  onTrace,
  renderDelta,
  cellClass = "num",
  note = null,
}: {
  text: string;
  nodeKey: string | null;
  title: string;
  traced?: TracedStackCell | null;
  onTrace?: (nodeKey: string, title: string) => void;
  renderDelta?: (nodeKey: string) => React.ReactNode;
  /** The margin column carries its verdict tone here. */
  cellClass?: string;
  /** Why there is no number, when there is none. */
  note?: string | null;
}) {
  const delta = nodeKey && renderDelta ? renderDelta(nodeKey) : null;
  const noteEl = note ? <span className="psr-num-note">{note}</span> : null;
  if (!nodeKey || !onTrace) {
    return (
      <td className={cellClass}>
        {text}
        {delta}
        {noteEl}
      </td>
    );
  }
  const isOpen = traced?.nodeKey === nodeKey;
  return (
    <td className={cellClass}>
      <button
        type="button"
        className={"psr-stack-cell" + (isOpen ? " open" : "")}
        onClick={() => onTrace(nodeKey, title)}
        aria-expanded={isOpen}
        title={isOpen ? "Close the trace" : `Why is this ${text}?`}
      >
        <span className="v">{text}</span>
        {delta}
        {noteEl}
        <span className="why">{isOpen ? "tracing ▾" : "why? ▸"}</span>
      </button>
    </td>
  );
}

export function DetailCostStack({
  state,
  blendedByTier,
  onTrace,
  traced,
  renderTrace,
  renderDelta,
  renderMarginDelta,
}: {
  state: QuoteState;
  blendedByTier: Map<number, BlendedTierComponents>;
  /** Press a cell → open the trace at that cell's canonical node. */
  onTrace?: (nodeKey: string, title: string) => void;
  traced?: TracedStackCell | null;
  /** The panel itself, supplied by the composition point that holds the graph. */
  renderTrace?: () => React.ReactNode;
  /**
   * The staged movement on one node, supplied as a render prop.
   *
   * Deliberately NOT "pass both graphs in and let this file mount the chip".
   * A delta is committed-minus-preview, and which graph is which is exactly
   * the pairing a call site can invert without anything failing. Stated once,
   * where both graphs are held, it cannot be inverted here at all.
   */
  renderDelta?: (nodeKey: string) => React.ReactNode;
  /**
   * The same join, in POINTS. Separate from `renderDelta` rather than a flag,
   * because dollars move by an amount and a margin moves by points — and a
   * flag at a call site is where the wrong one gets passed.
   */
  renderMarginDelta?: (nodeKey: string) => React.ReactNode;
}) {
  // Gate 1B increment 7 — this table READS THE CANONICAL GRAPH.
  //
  // What was here computed its own values: an unweighted mean across cells
  // (`avg`) plus a proportional redistribution of markup (`mkShare`). Both are
  // deleted rather than corrected. A second implementation that happens to be
  // right is still a second implementation, and `mkShare` was the specific
  // shortcut CLAUDE.md records causing a ~9% operator-visible mismatch between
  // two surfaces that both said "packaging".
  //
  // A tier the graph cannot answer for is absent from the map and renders
  // incomplete. It is never filled with zeroes: a zero is a commercial claim,
  // and "we could not read this" is not the same statement as "this is free".
  const tiers: TierCostStackDisplay[] = state.tiers.map((t) => {
    const blend = blendedByTier.get(t.id);
    if (!blend) {
      return {
        id: "T" + t.id,
        numericId: t.id,
        label: "T" + t.id,
        units: t.qty,
        subtotal: null,
        adjustment: 0,
        sell: null,
        margin_pct: null,
        margin_state: "incomplete",
        blended_no_margin_reason: t.blended_no_margin_reason ?? null,
        components: [],
        keys: null,
      };
    }
    return {
      id: "T" + t.id,
      numericId: t.id,
      label: "T" + t.id,
      keys: blend.keys,
      units: t.qty,
      subtotal: blend.sellBefore,
      adjustment: 0,
      sell: blend.sell,
      // BV-010 — the GOVERNED blended margin, and the verdict on THAT
      // margin. This column used to render `min_margin_pct`, the worst SKU's
      // margin in the tier, unlabelled, in a row whose every other cell is a
      // blended-across-SKUs figure — and it disagreed with the blend on 18 of
      // 52 tiers by up to 2.1pp.
      //
      // The value comes from the graph, like its six row-mates, so the trace
      // opens on the number that is displayed. The verdict comes from the
      // engine rollup. Those are two expressions of one governed quantity
      // (measured identical on every readable tier, and pinned by
      // `tests/unit/blended-margin-authority.test.ts`) — not two authorities.
      margin_pct: blend.margin,
      margin_state:
        blend.margin === null ? "incomplete" : tierStatusToR6(t.blended_status),
      blended_no_margin_reason: t.blended_no_margin_reason ?? null,
      // No cost/markup split any more. The split that used to appear was
      // `mkShare`, a proportional re-allocation invented at the display layer;
      // showing a segment the graph cannot account for would reinstate the
      // derivation under a different name.
      components: [
        { key: "pkg", label: "PKG", cost: blend.pkg, markup: null },
        { key: "prod", label: "PROD", cost: blend.prod, markup: null },
        { key: "raw", label: "RAW", cost: blend.raw, markup: null },
        { key: "frt", label: "FRT", cost: blend.frt, markup: null },
        { key: "dt", label: "D+T", cost: blend.dt, markup: null, internal: true },
      ],
    };
  });
  return (
    <div className="psr-detail-section psr-detail-section--cost-stack">
      <div className="section-head">
        <h4>Cost stack</h4>
        <span className="meta">
          Per-tier · sell-side contributions per unit, blended across SKUs ·
          D+T is internal layer
        </span>
      </div>
      <table className="psr-tier-table">
        <thead>
          <tr>
            <th>Tier</th>
            <th>PKG</th>
            <th>PROD</th>
            <th>RAW</th>
            <th>FRT</th>
            <th>D+T</th>
            {/* Was "Unit cost". These columns carry MARKED-UP component
                values, so the figure is sell-side; describing it as cost made
                the row read as impossible beside the sell column. */}
            <th>Sell before adj</th>
            <th>Quoted sell · unit</th>
            <th>Margin</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => {
            const rowTraced = traced != null && traced.tierId === t.numericId;
            return (
              <Fragment key={t.id}>
                <tr className={rowTraced ? "psr-stack-row pinned" : "psr-stack-row"}>
                  <td>
                    <strong>{t.label}</strong>
                  </td>
                  {(["pkg", "prod", "raw", "frt", "dt"] as const).map((bucket) => {
                    const comp = t.components.find((c) => c.key === bucket);
                    return (
                      <StackNumCell
                        key={bucket}
                        text={
                          comp == null || comp.cost == null
                            ? "—"
                            : fmtUsd2(comp.cost)
                        }
                        nodeKey={t.keys ? t.keys[bucket] : null}
                        title={`${t.label} · ${COLUMN_TITLE[bucket]}`}
                        traced={traced}
                        onTrace={onTrace}
                        renderDelta={renderDelta}
                      />
                    );
                  })}
                  <StackNumCell
                    text={t.subtotal == null ? "—" : fmtUsd2(t.subtotal)}
                    nodeKey={t.keys ? t.keys.sellBefore : null}
                    title={`${t.label} · ${COLUMN_TITLE.sellBefore}`}
                    traced={traced}
                    onTrace={onTrace}
                    renderDelta={renderDelta}
                  />
                  <StackNumCell
                    text={t.sell == null ? "—" : fmtUsd2(t.sell)}
                    nodeKey={t.keys ? t.keys.sell : null}
                    title={`${t.label} · ${COLUMN_TITLE.sell}`}
                    traced={traced}
                    onTrace={onTrace}
                    renderDelta={renderDelta}
                  />
                  {/*
                    Traceable now, and carrying the staged movement in POINTS
                    — both of which became honest the moment the column
                    started rendering the quantity the node holds. While it
                    showed the worst SKU's margin, either would have explained
                    a figure the operator did not press.
                  */}
                  <StackNumCell
                    text={
                      t.margin_pct == null ? "—" : fmtPct(t.margin_pct) + "%"
                    }
                    nodeKey={
                      // No node to open when the ratio is undefined. The cell
                      // renders an em-dash and does not invite a press.
                      t.margin_pct == null || !t.keys ? null : t.keys.margin
                    }
                    title={`${t.label} · ${COLUMN_TITLE.margin}`}
                    traced={traced}
                    onTrace={onTrace}
                    renderDelta={renderMarginDelta}
                    cellClass={"num " + t.margin_state}
                    note={
                      // The two no-margin states are named apart here for the
                      // same reason the grid names them apart: one has nothing
                      // priced and carries no judgement, the other has cost
                      // with nothing against it and is a certain loss.
                      t.blended_no_margin_reason === "cost_without_revenue"
                        ? "cost, no revenue"
                        : null
                    }
                  />

                </tr>
                {rowTraced && renderTrace && (
                  <tr className="psr-stack-tracerow">
                    <td colSpan={9}>{renderTrace()}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
