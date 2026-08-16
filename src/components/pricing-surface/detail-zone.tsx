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
import { fmtPct, fmtPct0, fmtQty, fmtUsd2, fmtUsd4 } from "./format";
import { tiersFailingReconciliation } from "@/lib/cost-stack-reconciliation";

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



/**
 * The view switch. Entire Quote first, then every sellable unit — including
 * unpriced ones, labelled.
 *
 * Unpriced units stay LISTED rather than hidden: they are real products on the
 * quote, and an operator who cannot see one cannot discover that its costs are
 * missing. What changes is that the list says so before they select it.
 */
function UnitSwitch({
  units,
  selected,
  onSelect,
}: {
  units: ReadonlyArray<{ id: string; label: string; isFinishedGood: boolean; priced: boolean }>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <select
      className="r11-unit-switch"
      value={selected}
      onChange={(e) => onSelect(e.target.value)}
      aria-label="Which price build to show"
    >
      <option value={ENTIRE_QUOTE}>Entire quote</option>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.label}
          {u.priced ? "" : " · not priced"}
        </option>
      ))}
    </select>
  );
}

/** No sellable unit has resolved economics. There is no price to build. */
function NothingPriced() {
  return (
    <div className="r11-unpriced">
      <span className="r11-unpriced-t">Nothing on this quote is priced yet.</span>
      <span className="r11-unpriced-s">
        No product carries a unit cost, so there is no price to build. Enter
        costs on Costs, then come back.
      </span>
    </div>
  );
}


/**
 * TIER ADJUSTMENT — the Pricing-owned replacement for Setup's Price Adj.
 *
 * AUTHORITY, stated on the cell rather than inferred. A tier either follows the
 * quote-wide rate or carries one of its own, and the difference decides what an
 * Apply does: precedence is `tier ?? global`, so an override REPLACES the
 * quote-wide rate for that tier rather than compounding with it. A surface that
 * shows only the resulting percentage cannot tell an operator which of those
 * two situations they are in — which is exactly how a legacy Setup-origin tier
 * rate silently made a 300% global inert.
 *
 * An explicit 0% is a real override: it suppresses the quote-wide rate for that
 * tier. So it is offered, and it is never confused with "no override".
 *
 * Stages like every other lever. Nothing is written until the one page-level
 * Apply, and a tier change is covered by the same stale guards.
 */
function TierAdjustCell({
  tierUuid,
  label,
}: {
  tierUuid: string | undefined;
  label: string;
}) {
  const { working, plannedTierAdj, stageTierAdj, committable } = usePricingStaging();
  const [draft, setDraft] = useState<string | null>(null);

  if (tierUuid === undefined) {
    return <div className="r11-scell flat"><span className="cost">—</span></div>;
  }
  // TIER-PREV-1 · the PLANNED rate, which is what the figures beside it use.
  //
  // Reading `working.tierAdj` here read the operator's intent while the sell
  // above read the planned result, so staging a new quote-wide rate labelled
  // Tier 2 "10% TIER OVERRIDE" next to a sell computed at 30%. The label
  // contradicted the number it was there to explain.
  const override = plannedTierAdj[tierUuid];
  const hasOverride = override !== undefined;
  const globalPct = working.globalAdj * 100;
  const shownPct = (hasOverride ? override : working.globalAdj) * 100;

  const commit = (raw: string) => {
    setDraft(null);
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    // Only stage a real change. Re-entering the rate already in force must not
    // create an override out of nothing — the same no-op discipline the
    // recommendation path uses.
    if (hasOverride && Math.abs(v / 100 - override) < 5e-7) return;
    if (!hasOverride && Math.abs(v / 100 - working.globalAdj) < 5e-7) return;
    stageTierAdj(tierUuid, v / 100);
  };

  return (
    <div className="r11-scell flat r11-tieradj">
      {draft !== null ? (
        <input
          className="r11-tieradj-in"
          autoFocus
          value={draft}
          disabled={!committable}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraft(null);
          }}
          aria-label={`${label} adjustment, percent`}
        />
      ) : (
        <button
          type="button"
          className={"r11-tieradj-v" + (hasOverride ? " own" : "")}
          onClick={() => setDraft(String(Number(shownPct.toFixed(4))))}
          disabled={!committable}
          title={
            hasOverride
              ? `Tier override — replaces the quote-wide ${fmtPct(working.globalAdj)}%`
              : "Following the quote-wide rate. Click to set an override for this tier."
          }
        >
          {fmtPct(shownPct / 100)}%
        </button>
      )}
      <span className="r11-tieradj-a">
        {hasOverride ? (
          <>
            Tier override · replaces quote-wide {fmtPct(globalPct / 100)}%
            {" "}
            <button
              type="button"
              className="r11-tieradj-revert"
              onClick={() => stageTierAdj(tierUuid, null)}
              disabled={!committable}
            >
              Revert to quote-wide
            </button>
          </>
        ) : (
          <>Quote-wide</>
        )}
      </span>
    </div>
  );
}

/** The sentinel for the aggregate view. Not a unit id; no unit can collide. */
export const ENTIRE_QUOTE = "__entire_quote__";

/**
 * The default Pricing view: everything being quoted, at each tier.
 *
 * Reads `quote/{tier}/per-unit/*` — the same governed family the Costs Price
 * build header renders — so the two surfaces reconcile by construction. Not
 * derived by averaging leaves, and not by summing the displayed per-unit rows
 * of the drill-downs.
 */
function EntireQuoteBuild({
  columns,
  byTier,
  tierUuidByNumeric,
  traced,
  onTrace,
}: {
  columns: ReadonlyArray<{ numericId: number; label: string; qty: number | null; recommended: boolean }>;
  byTier: ReadonlyMap<number, EntireQuoteTier>;
  tierUuidByNumeric: ReadonlyMap<number, string>;
  traced?: TracedStackCell | null;
  onTrace?: (nodeKey: string, title: string) => void;
}) {

  const cell = (
    c: { numericId: number; label: string },
    field: keyof EntireQuoteTier["keys"],
    fmt: (n: number) => string,
    valueClass = "sell",
  ) => {
    const t = byTier.get(c.numericId);
    if (!t) return <div className="r11-scell flat" key={c.numericId}><span className="cost">—</span></div>;
    const v = t[field] as number | null;
    return (
      <StackCell
        key={c.numericId}
        text={v === null ? "—" : fmt(v)}
        nodeKey={v === null ? null : t.keys[field]}
        title={`${c.label} · ${field}`}
        traced={traced}
        onTrace={onTrace}
        valueClass={valueClass}
      />
    );
  };

  const row = (
    key: string,
    className: string,
    slab: React.ReactNode,
    field: keyof EntireQuoteTier["keys"],
    fmt: (n: number) => string,
    valueClass?: string,
  ) => (
    <Fragment key={key}>
      <div className={className}>
        <div className="r11-slab">{slab}</div>
        {columns.map((c) => cell(c, field, fmt, valueClass))}
      </div>
    </Fragment>
  );

  const band = (key: string, title: string, authority: string) => (
    <div className="r11-srow r11-band" key={key}>
      <div className="r11-slab">
        <span className="r11-band-t">{title}</span>
        <span className="r11-band-a">{authority}</span>
      </div>
      {columns.map((c) => <div className="r11-scell flat" key={c.numericId} />)}
    </div>
  );

  const anyCharges = columns.some((c) => (byTier.get(c.numericId)?.oneTimeCharges ?? 0) !== 0);

  return (
    <div className="r11-stack">
      <div className="r11-srow head">
        <div className="r11-slab"><span className="colhead">Entire quote · per unit</span></div>
        {columns.map((c) => (
          <div className="r11-scell flat" key={c.numericId}>
            <span className="sell" style={{ fontSize: 11, letterSpacing: "0.06em" }}>
              {c.label}{c.recommended && <span style={{ color: "oklch(0.56 0.13 72)" }}> ★</span>}
            </span>
            <span className="cost">{c.qty == null ? "—" : c.qty.toLocaleString()} units</span>
          </div>
        ))}
      </div>

      {band("eq-base", "Base price", "from Costs · read-only here")}
      {row("eq-pkg", "r11-srow", <><span className="n">Packaging</span><span className="s">sell per unit</span></>, "pkg", (n) => fmtUsd4(n))}
      {row("eq-prod", "r11-srow", <><span className="n">Production</span><span className="s">sell per unit</span></>, "prod", (n) => fmtUsd4(n))}
      {row("eq-raw", "r11-srow", <><span className="n">Bulk raw</span><span className="s">sell per unit</span></>, "raw", (n) => fmtUsd4(n))}
      {row("eq-frt", "r11-srow", <><span className="n">Freight</span><span className="s">sell per unit</span></>, "frt", (n) => fmtUsd4(n))}
      {row("eq-dt", "r11-srow", <><span className="n">Duty + tariff</span><span className="s">sell per unit</span></>, "dt", (n) => fmtUsd4(n))}
      {row("eq-base-sell", "r11-srow rule r11-band-total",
        <><span className="n">Base sell</span><span className="s">per unit, before any pricing decision</span></>,
        "baseSell", (n) => fmtUsd4(n))}

      {band("eq-pricing", "Pricing decisions", "editable here")}
      {/*
        Tier authority is TIER-scoped, not unit-scoped, so it belongs on the
        aggregate view as much as on a drill-down. Rendering it only on the unit
        views would make a quote-level decision reachable solely by first
        choosing a product it does not belong to.
      */}
      <div className="r11-srow" key="eq-tier-adj">
        <div className="r11-slab">
          <span className="n">Tier adjustment</span>
          <span className="s">replaces the quote-wide rate for that tier</span>
        </div>
        {columns.map((c) => (
          <TierAdjustCell key={c.numericId} tierUuid={tierUuidByNumeric.get(c.numericId)} label={c.label} />
        ))}
      </div>
      {row("eq-decision", "r11-srow",
        <><span className="n">Pricing decision</span><span className="s">quoted less base, all levers combined</span></>,
        "decision", (n) => (n >= 0 ? "+" : "") + fmtUsd4(n), "delta")}

      {band("eq-result", "Final quoted sell", "result")}
      {row("eq-quoted", "r11-srow total rule r11-band-total",
        <><span className="n">Final quoted sell</span><span className="s">per unit · everything quoted</span></>,
        "quoted", (n) => fmtUsd4(n))}
      {row("eq-cost", "r11-srow", <><span className="n">Unit cost</span><span className="s">from Costs</span></>, "unitCost", (n) => fmtUsd4(n))}
      {row("eq-margin", "r11-srow", <span className="n">Margin</span>, "margin", (n) => fmtPct(n) + "%", "mg")}

      {/*
        ONE-TIME CHARGES sit OUTSIDE the per-unit build, because they are not
        per-unit. Folding a fixed fee into a unit price makes the price depend
        on the tier quantity in a way the customer document does not, and the
        two would stop reconciling. The Production/OTC accounting semantics are
        a separate body of work; this only keeps the distinction visible.
      */}
      {anyCharges && (
        <>
          {band("eq-otc", "One-time charges", "billed separately · not per unit")}
          <div className="r11-srow">
            <div className="r11-slab">
              <span className="n">Project &amp; SKU fees</span>
              <span className="s">tier total, excluded from the per-unit figure above</span>
            </div>
            {columns.map((c) => (
              <div className="r11-scell flat" key={c.numericId}>
                <span className="sell">{fmtUsd2(byTier.get(c.numericId)?.oneTimeCharges ?? 0)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DetailZone({
  state,
  blendedByTier,
  units,
  entireQuoteByTier,
  previewing,
  adjScopeByTier,
  tierUuidByNumeric,
  selectedUnitId,
  onSelectUnit,
  tierMeta,
  leversByTier,
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
  renderStackDelta,
  renderStackMarginDelta,
}: {
  state: QuoteState;
  /** Price-build values for the SELECTED unit of account, read from the
   *  canonical graph and keyed by the classifier's numeric tier id. Resolved
   *  once at the composition point. */
  blendedByTier: Map<number, BlendedTierComponents>;
  /** Top-level sellable units — Item Groups, and Direct Components alone. */
  units: ReadonlyArray<{ id: string; label: string; isFinishedGood: boolean; priced: boolean }>;
  entireQuoteByTier: ReadonlyMap<number, EntireQuoteTier>;
  /** True while the stack is showing STAGED economics rather than committed. */
  previewing: boolean;
  /** Which authority set each tier's adjustment, by numeric tier id. */
  adjScopeByTier: ReadonlyMap<number, "tier" | "quote-wide">;
  /** Numeric tier id -> tier UUID. Staging keys on the real identity. */
  tierUuidByNumeric: ReadonlyMap<number, string>;
  selectedUnitId: string | null;
  onSelectUnit: (id: string) => void;
  /** Tier label + ★ by numeric id, forwarded to the stack's header row. */
  tierMeta?: Map<number, { label: string; recommended: boolean }>;
  /** Which tiers carry a lever, from the governed working set. See B-2. */
  leversByTier: Map<number, { lifts: string[]; overrides: string[] }>;
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
          units={units}
          entireQuoteByTier={entireQuoteByTier}
          previewing={previewing}
          adjScopeByTier={adjScopeByTier}
          tierUuidByNumeric={tierUuidByNumeric}
          selectedUnitId={selectedUnitId}
          onSelectUnit={onSelectUnit}
          tierMeta={tierMeta}
          leversByTier={leversByTier}
          onTrace={onTraceStackCell}
          traced={tracedStackCell}
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
              {/*
                "Change" in POINTS, not "Delta". The column carried the entered
                figure and rendered "+30%" beside a current of 20% and a
                resulting of 56% — three numbers that cohere only under
                compounding, which is not what Apply does. Under set-semantics
                20% to 30% is a change of +10 points, and the header has to say
                which of the two it means.
              */}
              <th>Tier</th><th>Current adjustment</th><th>Current price</th>
              <th>Change (pts)</th><th>Proposed adjustment</th><th>Proposed price</th>
            </tr></thead>
            <tbody>
              {preview.tiers.map((tier) => (
                <tr key={tier.tierId}>
                  <td>{tier.label}</td>
                  <td>{fmtPct(tier.currentAdjustment)}%</td>
                  <td>{fmtUsd2(tier.currentCustomerPrice)}</td>
                  <td>{tier.adjustmentDeltaPoints >= 0 ? "+" : ""}{fmtPct(tier.adjustmentDeltaPoints)}</td>
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
/**
 * ENTIRE QUOTE — one tier's aggregate economics.
 *
 * A DIFFERENT SHAPE from `BlendedTierComponents`, deliberately. The unit ladder
 * has rungs the quote scope does not publish — sell-after-adjustment,
 * per-cell lifts, per-cell overrides — and reusing that type would have meant
 * filling them with zeros. A fabricated zero in a pricing ladder is the exact
 * defect this workstream keeps removing, so the aggregate gets the rows it can
 * actually answer for and no others.
 *
 * The aggregate pricing movement is `departure`: quoted price less the
 * component build-up. It is one governed number rather than a decomposition,
 * because at quote scope the individual levers do not aggregate — a global, a
 * tier rate and a cell override are not summable into "the decision".
 */
export type EntireQuoteTier = {
  pkg: number;
  prod: number;
  raw: number;
  frt: number;
  dt: number;
  baseSell: number;
  decision: number;
  quoted: number;
  unitCost: number;
  margin: number | null;
  /** Tier TOTAL, not per unit. Billed as fixed charges; never folded in. */
  oneTimeCharges: number;
  keys: Record<
    "pkg" | "prod" | "raw" | "frt" | "dt" | "baseSell" | "decision" | "quoted" | "unitCost" | "margin",
    string
  >;
};

export type BlendedTierComponents = {
  pkg: number;
  prod: number;
  raw: number;
  frt: number;
  dt: number;
  sellBefore: number;
  sell: number;
  /** The governed blended unit cost, from `quote/{tier}/cost`. */
  cost: number;
  /**
   * The price ladder's three CONTRIBUTIONS and its two intermediate LEVELS,
   * from `quote/{tier}/{adj-delta,sell-after-adj,lift-delta,sell-after-lift,
   * override-delta}`.
   *
   * Every one is read. None is obtained by subtracting one published level from
   * another, and that is a correctness property rather than a stylistic one:
   * blending is linear over a shared weight vector, so `blend(a − b)` is
   * exactly `blend(a) − blend(b)` and a subtraction-derived delta telescopes
   * straight through the aggregation. The reconciliation strip would then be
   * asserting `before + (a − before) + (l − a) + (sell − l) === sell`, which
   * holds for any four numbers and can never fail. The engine multiplies each
   * lever by its own rate instead — see `tests/unit/p3-017-tier-ladder-authority.test.ts`.
   */
  adjDelta: number;
  sellAfterAdj: number;
  liftDelta: number;
  sellAfterLift: number;
  overrideDelta: number;
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
    cost: string;
    margin: string;
    adjDelta: string;
    sellAfterAdj: string;
    liftDelta: string;
    sellAfterLift: string;
    overrideDelta: string;
  };
};

/**
 * One TIER — which is one COLUMN, the stack being transposed.
 *
 * `blend` is null for a tier the graph cannot answer for, and every cell in
 * that column renders an em-dash. It is never filled with zeroes: a zero is a
 * commercial claim, and "we could not read this" is not the same statement as
 * "this is free".
 */
interface TierStackColumn {
  /** The classifier's numeric tier id — which row a trace belongs beneath. */
  numericId: number;
  label: string;
  recommended: boolean;
  qty: number | null;
  skuCount: number;
  blend: BlendedTierComponents | null;
  margin_state: "good" | "below_target" | "bad" | "incomplete";
  blended_no_margin_reason: NoMarginReason | null;
  /**
   * The SKUs carrying a lift and an override at this tier, by EXISTENCE.
   *
   * Not by "the contribution is non-zero". A lift refused by an override
   * contributes exactly nothing — §13.3, and pinned by the ladder authority
   * test — so keying the row on the delta would delete the one rendering that
   * shows a refusal happened. The row appears because the lever was pulled; the
   * contribution says what it moved, including when the answer is nothing.
   */
  liftSkus: string[];
  overrideSkus: string[];
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
// "blended" is gone from every DOLLAR title. These are one sellable unit's own
// economics now, not a mean across the quote's leaves, and the old word made a
// scoped figure read as an average. Margin keeps it, because the tier's blended
// margin genuinely is the revenue-weighted blend and its authority is unchanged.
const COLUMN_TITLE = {
  pkg: "Packaging · per unit",
  prod: "Production · per unit",
  raw: "Raw materials · per unit",
  frt: "Freight · per unit",
  dt: "Duty + tariff · per unit",
  sellBefore: "Base sell · per unit",
  sell: "Final quoted sell · per unit",
  cost: "Unit cost · per unit",
  margin: "Blended margin · this tier",
  adjDelta: "Price adjustment contribution · per unit",
  sellAfterAdj: "Sell after adjustment · per unit",
  liftDelta: "Surgical lift contribution · per unit",
  sellAfterLift: "Sell after lifts · per unit",
  overrideDelta: "PM override contribution · per unit",
} as const;

/**
 * One numeric cell in the transposed stack, pressable when the graph has a node
 * behind it.
 *
 * A cell with no key renders as a flat `div` rather than as a disabled button.
 * "Nothing to press" and "a control that refuses you" say different things, and
 * only the first is true: the value is there, the chain behind it is not
 * readable, and a dead affordance would suggest otherwise.
 */
function StackCell({
  text,
  nodeKey,
  title,
  traced,
  onTrace,
  renderDelta,
  valueClass = "sell",
  sub = null,
  note = null,
}: {
  text: string;
  nodeKey: string | null;
  title: string;
  traced?: TracedStackCell | null;
  onTrace?: (nodeKey: string, title: string) => void;
  renderDelta?: (nodeKey: string) => React.ReactNode;
  /** `sell` for a level, `delta pos|neg` for a contribution, `mg …` for margin. */
  valueClass?: string;
  /** The mono sub-caption beneath the figure — a rate, or the SKUs affected. */
  sub?: React.ReactNode;
  /** Why there is no number, when there is none. */
  note?: string | null;
}) {
  const delta = nodeKey && renderDelta ? renderDelta(nodeKey) : null;
  const body = (
    <>
      <span className={valueClass}>{text}</span>
      {delta}
      {sub != null && <span className="cost">{sub}</span>}
      {note && <span className="psr-num-note">{note}</span>}
    </>
  );
  if (!nodeKey || !onTrace) {
    return <div className="r11-scell flat">{body}</div>;
  }
  const isOpen = traced?.nodeKey === nodeKey;
  return (
    <button
      type="button"
      className={"r11-scell" + (isOpen ? " open" : "")}
      onClick={() => onTrace(nodeKey, title)}
      aria-expanded={isOpen}
      title={isOpen ? "Close the trace" : `Why is this ${text}?`}
    >
      {body}
      <span className="why">{isOpen ? "tracing ▾" : "why? ▸"}</span>
    </button>
  );
}

/**
 * The reconciliation strip — the stack's own audit of itself.
 *
 * Reads the same numbers the rows above it rendered, and states whether they
 * add up. It CAN say no: `tiersFailingReconciliation` is a pure predicate over
 * five governed quantities, none of them derived from the others.
 *
 * A tier the graph could not answer for is neither reconciling nor failing —
 * it is unread, and it is counted separately. Folding it into the ✓ would put a
 * green tick over a column of em-dashes.
 */
function ReconStrip({ columns }: { columns: TierStackColumn[] }) {
  const readable = columns.filter(
    (c): c is TierStackColumn & { blend: BlendedTierComponents } =>
      c.blend !== null,
  );
  const unread = columns.length - readable.length;
  const bad = tiersFailingReconciliation(readable.map((c) => c.blend));
  const ok = bad.length === 0;
  return (
    // NO `role="status"`. It is not in the Design Authority, and it does not
    // belong: an ARIA live region announces a TRANSIENT message about something
    // that just happened, and this is a standing assertion about the numbers
    // above it. Adding one also made every `getByRole("status")` on the pricing
    // surface ambiguous — it collided with the "Pricing updated." confirmation
    // that VAL-208 waits on. The failing state signals through the ✕ and the
    // `.bad` register, which is what the design specifies.
    <div className={"r11-recon" + (ok ? "" : " bad")}>
      <span>{ok ? "✓" : "✕"}</span>
      <span>
        {ok
          ? `every readable column reconciles — sections + adjustment + lifts + overrides = quoted sell, at ${readable.length} tier${readable.length === 1 ? "" : "s"}`
          : `${bad.length} column(s) do NOT reconcile`}
        {unread > 0 &&
          ` · ${unread} tier(s) could not be read and are not asserted`}
      </span>
    </div>
  );
}

export function DetailCostStack({
  state,
  blendedByTier,
  units,
  entireQuoteByTier,
  previewing,
  adjScopeByTier,
  tierUuidByNumeric,
  selectedUnitId,
  onSelectUnit,
  tierMeta,
  leversByTier,
  onTrace,
  traced,
  renderDelta,
  renderMarginDelta,
}: {
  state: QuoteState;
  /**
   * Price build per COMMERCIAL UNIT OF ACCOUNT, keyed by unit id then numeric
   * tier. Not a quote-wide blend: on a mixed quote that averaged across
   * unrelated sellable products and divided an Item Group's economics by the
   * whole quote's leaf count.
   */
  blendedByTier: Map<number, BlendedTierComponents>;
  /** Top-level sellable units — Item Groups, and Direct Components standing alone. */
  units: ReadonlyArray<{ id: string; label: string; isFinishedGood: boolean; priced: boolean }>;
  entireQuoteByTier: ReadonlyMap<number, EntireQuoteTier>;
  previewing: boolean;
  adjScopeByTier: ReadonlyMap<number, "tier" | "quote-wide">;
  /** Numeric tier id -> tier UUID. Staging keys on the real identity. */
  tierUuidByNumeric: ReadonlyMap<number, string>;
  /** Null until the operator chooses. Never auto-selected on a mixed quote. */
  selectedUnitId: string | null;
  onSelectUnit: (id: string) => void;
  /**
   * Tier label + ★, keyed by the classifier's numeric id.
   *
   * Optional, and the fallback is `T{id}` — the label the whole table used
   * before. Passed rather than derived for the same reason the blend is: the
   * real identity is the tier UUID, and this file only holds the numeric id.
   */
  tierMeta?: Map<number, { label: string; recommended: boolean }>;
  /**
   * Which tiers carry a lift and an override, by numeric tier id.
   *
   * REQUIRED, and arrives as a prop rather than being derived here. B-2: this
   * was computed in-component from `state.cells[].lift_applied_pct` — the
   * classifier, which describes COMMITTED state — while the Design Authority
   * keys the same rows on the WORKING set. A staged lift therefore moved
   * `Quoted sell` with no row accounting for it, which is the one thing R11 §4
   * marks load-bearing. Resolved at the composition point, where the staging
   * working set and the tier identity both live.
   */
  leversByTier: Map<number, { lifts: string[]; overrides: string[] }>;
  /** Press a cell → open the trace at that cell's canonical node. */
  onTrace?: (nodeKey: string, title: string) => void;
  traced?: TracedStackCell | null;
  /** The panel itself, supplied by the composition point that holds the graph. */
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
  //
  // R11/R12 LAYOUT RESTORATION. The stack is TRANSPOSED — quantities are rows,
  // tiers are columns — which is what makes the ladder legible: a column is one
  // tier's price, read top to bottom from what the sections cost to what the
  // customer is quoted, with every lever that moved it in between.
  //
  // The R6 shape this replaces put tiers on the rows and could only show the
  // ladder's two ENDS, because those were the only levels published at tier
  // scope. It is not evolved into the canonical shape; it is replaced by it.

  const columns: TierStackColumn[] = state.tiers.map((t) => {
    const blend = blendedByTier.get(t.id) ?? null;
    const meta = tierMeta?.get(t.id);
    const levers = leversByTier.get(t.id);
    return {
      numericId: t.id,
      label: meta?.label ?? "T" + t.id,
      recommended: meta?.recommended ?? false,
      qty: t.qty,
      skuCount: state.skus.length,
      blend,
      // BV-010 — the verdict on the GOVERNED blended margin, from the engine
      // rollup. Two expressions of one quantity (pinned by
      // `tests/unit/blended-margin-authority.test.ts`), not two authorities.
      margin_state:
        blend == null || blend.margin === null
          ? "incomplete"
          : tierStatusToR6(t.blended_status),
      blended_no_margin_reason: t.blended_no_margin_reason ?? null,
      liftSkus: levers?.lifts ?? [],
      overrideSkus: levers?.overrides ?? [],
    };
  });

  // Rows for the five blended sections, in canonical order. No cost/markup
  // split: the split that used to appear was `mkShare`, a proportional
  // re-allocation invented at the display layer, and showing a segment the
  // graph cannot account for would reinstate the derivation under a new name.
  const SECTIONS = [
    { key: "pkg", label: "Packaging" },
    { key: "prod", label: "Production" },
    { key: "raw", label: "Bulk raw" },
    { key: "frt", label: "Freight" },
    { key: "dt", label: "Duty + tariff" },
  ] as const;

  // The two conditional rows key on EXISTENCE across any column, exactly as the
  // Design Authority does — never on the contribution being non-zero.
  const anyLifts = columns.some((c) => c.liftSkus.length > 0);
  const anyOverrides = columns.some((c) => c.overrideSkus.length > 0);

  /**
   * A row of cells, one per tier.
   *
   * The trace used to render INLINE beneath whichever row owned the open node —
   * an accepted Nexus extension over the Design Authority, which puts it after
   * the whole stack (`pricing-page.jsx:978`). The reason held: transposed, this
   * stack is thirteen rows tall, so a panel at its foot sits ~1200px from the
   * cell that opened it and reads as an unrelated block.
   *
   * Both placements have the same cost, and it is the one the disposition
   * names: a full-width block appears INSIDE the table because a cell was
   * pressed, and every row below it moves. The trace is now in the cell drawer,
   * beside the grid rather than within it, so nothing moves and the neighbours
   * an operator wants to compare stay where they were. The row renders cells
   * and raises the press; it renders nothing for the open state but the
   * pressed cell's own `open` styling.
   */
  /**
   * A band header. Three of them, and they are the substance of Item 3.
   *
   * The table read as one flat list, so a Costs-derived figure and a Pricing
   * decision sat in the same visual register and nothing said which half the
   * operator owns. The bands name the authority and the direction of travel:
   * base from Costs, decisions here, result.
   */
  const band = (key: string, title: string, authority: string) => (
    <div className="r11-srow r11-band" key={key}>
      <div className="r11-slab">
        <span className="r11-band-t">{title}</span>
        <span className="r11-band-a">{authority}</span>
      </div>
      {columns.map((c) => (
        <div className="r11-scell flat" key={c.numericId} />
      ))}
    </div>
  );

  const row = (
    key: string,
    className: string,
    slab: React.ReactNode,
    cell: (c: TierStackColumn) => React.ReactNode,
    field?: string,
  ) => (
    <Fragment key={key}>
      <div className={className}>
        <div className="r11-slab">{slab}</div>
        {columns.map((c) => (
          <Fragment key={c.numericId}>{cell(c)}</Fragment>
        ))}
      </div>
    </Fragment>
  );

  /** A LEVEL — a price at a point on the ladder. */
  const level = (
    c: TierStackColumn,
    field: "pkg" | "prod" | "raw" | "frt" | "dt" | "sellBefore" | "sellAfterAdj" | "sellAfterLift" | "sell" | "cost",
  ) => (
    <StackCell
      text={c.blend == null ? "—" : fmtUsd4(c.blend[field])}
      nodeKey={c.blend ? c.blend.keys[field] : null}
      title={`${c.label} · ${COLUMN_TITLE[field]}`}
      traced={traced}
      onTrace={onTrace}
      renderDelta={renderDelta}
    />
  );

  /**
   * A CONTRIBUTION — what one lever moved. Signed, and read from the graph.
   *
   * The sign comes from the value itself. A price adjustment can be negative
   * and an override can be either, so a hardcoded `+` on the adjustment row
   * (which the prototype's fixture data made safe) would misstate a discount.
   */
  const contribution = (
    c: TierStackColumn,
    field: "adjDelta" | "liftDelta" | "overrideDelta",
    sub: React.ReactNode,
  ) => {
    if (c.blend == null) return <div className="r11-scell flat"><span className="cost">—</span></div>;
    const v = c.blend[field];
    return (
      <StackCell
        text={(v < 0 ? "−" : "+") + fmtUsd4(Math.abs(v))}
        nodeKey={c.blend.keys[field]}
        title={`${c.label} · ${COLUMN_TITLE[field]}`}
        traced={traced}
        onTrace={onTrace}
        renderDelta={renderDelta}
        valueClass={"delta " + (v < 0 ? "neg" : "pos")}
        sub={sub}
      />
    );
  };

  const scopes = new Set(
    columns.map((c) => adjScopeByTier.get(c.numericId) ?? "quote-wide"),
  );
  const adjScopeLabel =
    scopes.size > 1 ? "per-tier and quote-wide" : scopes.has("tier") ? "Tier" : "Quote-wide";

  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null;
  const unitLabel = selectedUnit?.label ?? null;
  const selectedIsFinishedGood = selectedUnit?.isFinishedGood ?? true;

  // NO AUTO-SELECTION on a mixed quote. Picking one for the operator would put
  // a single product's economics under a heading they will read as the quote's,
  // which is the same category error the leaf blend made one level up. A single
  // sellable unit is not a choice, so it resolves itself.
  // ── WHICH VIEW ────────────────────────────────────────────────────────
  //
  // Entire Quote is the default and answers "what are the economics of
  // everything we are quoting at this tier". A unit view answers "what drives
  // them for this one sellable unit". Different questions, so different tables.
  if (selectedUnitId === ENTIRE_QUOTE || selectedUnitId === null) {
    return (
      <div className="psr-detail-section psr-detail-section--cost-stack">
        <div className="section-head">
          <h4>Price build · Entire quote</h4>
          <span className="meta">
            Per-tier · everything being quoted · one-time charges shown
            separately
          </span>
          {previewing && (
            <span className="r11-pb-preview">previewing staged changes</span>
          )}
          <UnitSwitch units={units} selected={ENTIRE_QUOTE} onSelect={onSelectUnit} />
        </div>
        {entireQuoteByTier.size === 0 ? (
          <NothingPriced />
        ) : (
          <EntireQuoteBuild
            columns={columns}
            byTier={entireQuoteByTier}
            tierUuidByNumeric={tierUuidByNumeric}
            traced={traced}
            onTrace={onTrace}
          />
        )}
      </div>
    );
  }

  // AN UNPRICED UNIT IS NOT A $0.0000 PRICE BUILD.
  //
  // PB-UNIT-UX1: a unit whose costs were never entered rendered every row at
  // zero with a green reconciliation footer. The zeros were real sums of
  // nothing; the defect was presenting "no data" in the vocabulary reserved
  // for "data, and it balances".
  if (selectedUnit != null && !selectedUnit.priced) {
    return (
      <div className="psr-detail-section psr-detail-section--cost-stack">
        <div className="section-head">
          <h4>Price build · {selectedUnit.label}</h4>
          <span className="meta">Not priced · costs incomplete</span>
          <UnitSwitch units={units} selected={selectedUnit.id} onSelect={onSelectUnit} />
        </div>
        <div className="r11-unpriced">
          <span className="r11-unpriced-t">
            {selectedUnit.label} has no costs entered yet.
          </span>
          <span className="r11-unpriced-s">
            {selectedUnit.isFinishedGood
              ? "Its products are on the quote, but none carries a unit cost — so there is no price to build."
              : "It is on the quote, but carries no unit cost — so there is no price to build."}{" "}
            Enter costs on Costs, then come back.
          </span>
        </div>
      </div>
    );
  }

  // Past both early returns: a unit is selected and it is priced.
  if (selectedUnit == null) return null;

  return (
    <div className="psr-detail-section psr-detail-section--cost-stack">
      <div className="section-head">
        <h4>Price build{unitLabel === null ? "" : ` · ${unitLabel}`}</h4>
        <span className="meta">
          Per-tier · sell-side contributions per finished unit · D+T is internal
          layer
        </span>
        {/*
          P-PriceBuild-2. The stack now follows staged economics, so it must say
          when it is doing that. A previewed figure and a committed one look
          identical, and the operator acts on the difference.
        */}
        {previewing && (
          <span className="r11-pb-preview" title="These figures include changes you have not applied yet">
            previewing staged changes
          </span>
        )}
        {/*
          The SHARED switch, and it is shared for a reason. This branch kept an
          inline select of its own that listed units only — so from a unit view
          there was no route back to Entire Quote, and unpriced units appeared
          unlabelled. Two switches for one navigation is how half of it goes
          stale; caught in the browser walk, not by a test.

          Rendered unconditionally, unlike the old one: even with a single unit
          there are two views, and hiding the control strands the operator on
          whichever they landed on.
        */}
        <UnitSwitch units={units} selected={selectedUnit.id} onSelect={onSelectUnit} />
      </div>

      <div className="r11-stack">
        <div className="r11-srow head">
          <div className="r11-slab">
            <span className="colhead">
              {selectedIsFinishedGood
                ? "Price build · per finished unit"
                : "Price build · per unit"}
            </span>
          </div>
          {columns.map((c) => (
            <div className="r11-scell flat" key={c.numericId}>
              <span
                className="sell"
                style={{ fontSize: 11, letterSpacing: "0.06em" }}
              >
                {c.label}
                {c.recommended && (
                  <span style={{ color: "oklch(0.56 0.13 72)" }}> ★</span>
                )}
              </span>
              <span className="cost">
                {c.qty == null ? "—" : c.qty.toLocaleString()} × {c.skuCount} SKU
              </span>
            </div>
          ))}
        </div>

        {band("band-base", "Base price", "from Costs · read-only here")}

        {SECTIONS.map((s) =>
          row(
            s.key,
            "r11-srow",
            <>
              <span className="n">{s.label}</span>
              <span className="s">sell per unit</span>
            </>,
            (c) => level(c, s.key),
            s.key,
          ),
        )}

        {row(
          "sell-before",
          "r11-srow rule r11-band-total",
          <>
            <span className="n">Base sell</span>
            <span className="s">per unit, before any pricing decision</span>
          </>,
          (c) => level(c, "sellBefore"),
          "sellBefore",
        )}

        {band("band-pricing", "Pricing decisions", "editable here")}

        {/*
          TIER AUTHORITY, above the dollar it produces. The rate decides the
          amount, so reading them in the other order asks the operator to infer
          the cause from the effect.
        */}
        <div className="r11-srow" key="tier-adj">
          <div className="r11-slab">
            <span className="n">Tier adjustment</span>
            <span className="s">replaces the quote-wide rate for that tier</span>
          </div>
          {columns.map((c) => (
            <TierAdjustCell
              key={c.numericId}
              tierUuid={tierUuidByNumeric.get(c.numericId)}
              label={c.label}
            />
          ))}
        </div>

        {row(
          "adj",
          "r11-srow",
          <>
            <span className="n">Price adjustment</span>
            {/*
              This used to render the nullish-coalescing expression itself —
              source notation shown to an operator. The precedence it gestured
              at is real: a tier's own rate REPLACES the quote-wide one rather
              than compounding with it. Which one applies is knowable per tier,
              so the row states the resolved scope instead of printing the
              expression that resolves it. Mixed scopes across tiers are named
              as mixed rather than collapsed to either.
            */}
            <span className="s">{adjScopeLabel} rate — replaces, not compounds</span>
          </>,
          (c) => contribution(c, "adjDelta", null),
          "adjDelta",
        )}

        {/*
          The intermediate levels are rendered so a column can be read as a
          running total rather than as a start, three jumps and an end. They are
          published nodes, not sums taken here.
        */}
        {row(
          "sell-after-adj",
          "r11-srow",
          <>
            <span className="n">Sell after adjustment</span>
            <span className="s">running</span>
          </>,
          (c) => level(c, "sellAfterAdj"),
          "sellAfterAdj",
        )}

        {anyLifts &&
          row(
            "lifts",
            "r11-srow",
            <>
              <span className="n">Surgical lifts</span>
              <span className="s">corrective — one cell each</span>
            </>,
            (c) =>
              c.liftSkus.length
                ? contribution(c, "liftDelta", c.liftSkus.join(", "))
                : (
                  <div className="r11-scell flat">
                    <span className="cost">—</span>
                  </div>
                ),
            "liftDelta",
          )}

        {anyLifts &&
          row(
            "sell-after-lift",
            "r11-srow",
            <>
              <span className="n">Sell after lifts</span>
              <span className="s">running</span>
            </>,
            (c) => level(c, "sellAfterLift"),
            "sellAfterLift",
          )}

        {anyOverrides &&
          row(
            "overrides",
            "r11-srow",
            <>
              <span className="n">PM overrides</span>
              <span className="s">not derived — a human act</span>
            </>,
            (c) =>
              c.overrideSkus.length
                ? contribution(c, "overrideDelta", c.overrideSkus.join(", "))
                : (
                  <div className="r11-scell flat">
                    <span className="cost">—</span>
                  </div>
                ),
            "overrideDelta",
          )}

        {band("band-result", "Final quoted sell", "result")}

        {row(
          "quoted",
          "r11-srow total rule r11-band-total",
          <>
            <span className="n">Final quoted sell</span>
            <span className="s">
              per unit{selectedIsFinishedGood ? " · finished good" : " · product"}
            </span>
          </>,
          (c) => level(c, "sell"),
          "sell",
        )}

        {row(
          "cost",
          "r11-srow",
          <>
            <span className="n">Unit cost</span>
            <span className="s">from Costs</span>
          </>,
          (c) => level(c, "cost"),
          "cost",
        )}

        {row(
          "margin",
          "r11-srow",
          <span className="n">Margin</span>,
          (c) => (
            <StackCell
              text={
                c.blend == null || c.blend.margin === null
                  ? "—"
                  : fmtPct(c.blend.margin) + "%"
              }
              nodeKey={
                // No node to open when the ratio is undefined. The cell renders
                // an em-dash and does not invite a press.
                c.blend == null || c.blend.margin === null
                  ? null
                  : c.blend.keys.margin
              }
              title={`${c.label} · ${COLUMN_TITLE.margin}`}
              traced={traced}
              onTrace={onTrace}
              renderDelta={renderMarginDelta}
              valueClass={"mg " + c.margin_state}
              note={
                // The two no-margin states are named apart here for the same
                // reason the grid names them apart: one has nothing priced and
                // carries no judgement, the other has cost with nothing against
                // it and is a certain loss.
                c.blended_no_margin_reason === "cost_without_revenue"
                  ? "cost, no revenue"
                  : null
              }
            />
          ),
          "margin",
        )}

        <ReconStrip columns={columns} />
      </div>

    </div>
  );
}
