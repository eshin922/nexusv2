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
//   - DetailTierTable: per-tier compliance table from state.tiers[]
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

import { useCallback, useEffect, useState } from "react";
import type { QuoteState, TierRollup } from "@/lib/pricing-classifier";
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
  quoteId,
  onPreviewGlobalAdjust,
  globalPreview,
  onCancelGlobalPreview,
  onApplyGlobalPreview,
  onUndoGlobalAdjust,
  canUndoGlobalAdjust,
  pricingMutationPending,
  pricingConfirmation,
}: {
  state: QuoteState;
  /** Canonical blended component values, threaded from the composition point. */
  blendedByTier: Map<number, BlendedTierComponents>;
  quoteId: string;
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
}) {
  // Hydration safety: default OPEN on both SSR and initial client
  // render (matches readSessionOpen's "no preference → open"
  // default). useEffect then reads session and only flips to
  // closed if the PM has explicitly set "0".
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setOpen(readSessionOpen(quoteId));
  }, [quoteId]);
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      writeSessionOpen(quoteId, next);
      return next;
    });
  }, [quoteId]);
  return (
    <div className="psr-detail">
      <button
        type="button"
        className={"psr-detail-toggle " + (open ? "open" : "")}
        onClick={toggle}
        aria-expanded={open}
      >
        <span>
          <span className="twirl">▸</span>Show pricing detail
        </span>
        <span className="lab"></span>
        <span className="meta">
          {state.quote.skus.length} SKUs · {state.quote.tiers.length} tiers ·
          cost stack · per-SKU breakdown
        </span>
      </button>
      {open && (
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
          <DetailTierTable state={state} />
          <DetailCostStack state={state} blendedByTier={blendedByTier} />
          <DetailPerSku state={state} />
          <DetailMetaTiles state={state} />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// DetailGlobalAdjust — writable input bound to global_price_adj_pct.
// ──────────────────────────────────────────────────────────────────
//
// Catch #7 production field name: `quote.global_price_adj_pct`
// (numeric(5,4) decimal; UI shows the % integer). The prototype's
// "global_lift_pct" was design-side notation. Input value is the
// PM-edited integer percentage; onPreview receives the percentage
// number (caller converts to the decimal for canonical preview/apply).
//
// onPreview is page-composer-supplied and performs no persistence.

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
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Global price adjustment</h4>
        <span className="meta">Tuning lever · applies across all tiers</span>
      </div>
      <div className="psr-global-adjust">
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
          <button
            type="button"
            className="cta"
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              background: "var(--ink)",
              color: "var(--paper)",
              border: "1px solid var(--ink)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
            onClick={handlePreview}
            disabled={pending}
          >
            Preview Changes
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
// DetailTierTable — per-tier compliance from state.tiers[].
// ──────────────────────────────────────────────────────────────────
//
// Status badge + OVR chip read directly from TierRollup (classifier-
// owned). Underscore→space in status label is a presentation
// transform, not derivation.

export function DetailTierTable({ state }: { state: QuoteState }) {
  const target = state.policy.target_margin_pct;
  const floor = state.policy.floor_margin_pct;
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Per-tier compliance</h4>
        <span className="meta">
          Worst margin across SKUs · {state.quote.tiers.length} tiers
        </span>
      </div>
      <table className="psr-tier-table">
        <thead>
          <tr>
            <th>Tier</th>
            <th>Qty</th>
            <th>Worst margin</th>
            <th>Blended</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {state.tiers.map((t) => (
            <tr key={t.id}>
              <td>
                <strong>T{t.id}</strong>
              </td>
              <td className="num">{fmtQty(t.qty)}</td>
              <td className="num">
                {t.min_margin_pct == null
                  ? "—"
                  : fmtPct(t.min_margin_pct) + "%"}
              </td>
              <td className="num">
                {t.blended_margin_pct == null
                  ? "—"
                  : fmtPct(t.blended_margin_pct) + "%"}
              </td>
              <td>
                <span className={"row-pill " + t.status}>
                  <span className="dot" />
                  {t.status.replace(/_/g, " ")}
                </span>
                {t.has_override && <span className="ovr-chip">OVR</span>}
              </td>
              <td
                style={{
                  textAlign: "right",
                  color: "var(--ink-4)",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                }}
              >
                tgt {fmtPct0(target)}% · flr {fmtPct0(floor)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  // `raw` joins the union because bulk raw is a real component of the chain
  // and the canonical graph blends it separately. It was previously folded
  // into production for display, which meant the column could not be traced
  // back to a node. `pass` is retained for the passthrough row.
  key: "pkg" | "prod" | "raw" | "frt" | "dt" | "pass";
  label: string;
  cost: number | null;
  markup: number | null;
  internal?: boolean;
}

interface TierCostStackDisplay {
  id: string;
  label: string;
  units: number | null;
  subtotal: number | null;
  adjustment: number;
  sell: number | null;
  margin_pct: number | null;
  margin_state: "good" | "below_target" | "bad" | "incomplete";
  components: CostStackBucketDisplay[];
}

/**
 * Blended, sell-side component contributions per unit, read from the canonical
 * graph and keyed by the classifier's numeric tier id.
 *
 * Arrives as a PROP rather than being fetched here, because this file's
 * discipline is that every read is a QuoteState-shaped prop so the compiler can
 * refuse component-side derivation. Reading the graph is not derivation, but
 * reaching for it with a hook would bypass the mechanism that enforces the
 * rule for everything else in the file.
 */
export type BlendedTierComponents = {
  pkg: number;
  prod: number;
  raw: number;
  frt: number;
  dt: number;
  sellBefore: number;
  sell: number | null;
};

export function DetailCostStack({
  state,
  blendedByTier,
}: {
  state: QuoteState;
  blendedByTier: Map<number, BlendedTierComponents>;
}) {
  // Gate 1B increment 7 — this table reads the CANONICAL GRAPH.
  //
  // What was here before computed its own values: an unweighted mean across
  // SKUs plus a proportional redistribution of markup. On the current fixture
  // those agreed with the canonical blend by coincidence, because every
  // product carries the same tier quantity — and they stop agreeing the moment
  // per-product quantities differ. The derivation was removed rather than
  // corrected, because a second implementation that happens to be right is
  // still a second implementation.
  const tiers: TierCostStackDisplay[] = state.tiers.map((t) => {
    const blend = blendedByTier.get(t.id);
    const pkg = blend?.pkg ?? null;
    const prod = blend?.prod ?? null;
    const raw = blend?.raw ?? null;
    const frt = blend?.frt ?? null;
    const dt = blend?.dt ?? null;
    const sellBefore = blend?.sellBefore ?? null;
    const sell = blend?.sell ?? null;

    if (pkg === null || sellBefore === null) {
      return {
        id: "T" + t.id,
        label: "T" + t.id,
        units: t.qty,
        subtotal: null,
        adjustment: 0,
        sell: null,
        margin_pct: null,
        margin_state: "incomplete",
        components: [],
      };
    }

    return {
      id: "T" + t.id,
      label: "T" + t.id,
      units: t.qty,
      subtotal: sellBefore,
      adjustment: 0,
      sell,
      margin_pct: t.min_margin_pct,
      margin_state: tierStatusToR6(t.status),
      // Each value is a marked-up SELL contribution per unit, blended across
      // products. There is no cost/markup split here any more: the split that
      // used to appear was `mkShare`, a proportional re-allocation invented at
      // the display layer. Showing a segment the graph cannot account for
      // would be reinstating the derivation under a different name.
      components: [
        { key: "pkg", label: "PKG", cost: pkg, markup: null },
        { key: "prod", label: "PROD", cost: prod, markup: null },
        { key: "raw", label: "RAW", cost: raw, markup: null },
        { key: "frt", label: "FRT", cost: frt, markup: null },
        { key: "dt", label: "D+T", cost: dt, markup: null, internal: true },
      ],
    };
  });
  return (
    <div className="psr-detail-section psr-detail-section--cost-stack">
      <div className="section-head">
        <h4>Cost stack</h4>
        <span className="meta">
          Per-tier · sell-side contributions per unit, blended across SKUs · D+T
          is internal layer
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
            {/* Was "Unit cost". These columns sum MARKED-UP component values,
                so the figure is sell-side; the old heading described it as
                cost and made the row read as impossible next to Sell · unit. */}
            <th>Sell before adj</th>
            <th>Quoted sell · unit</th>
            <th>Margin</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t.id}>
              <td>
                <strong>{t.label}</strong>
              </td>
              {(["pkg", "prod", "frt", "dt"] as const).map((bucket) => {
                const comp = t.components.find((c) => c.key === bucket);
                return (
                  <td className="num" key={bucket}>
                    {comp == null || comp.cost == null
                      ? "—"
                      : fmtUsd2(comp.cost)}
                  </td>
                );
              })}
              <td className="num">
                {t.subtotal == null ? "—" : fmtUsd2(t.subtotal)}
              </td>
              <td className="num">{t.sell == null ? "—" : fmtUsd2(t.sell)}</td>
              <td className={"num " + t.margin_state}>
                {t.margin_pct == null ? "—" : fmtPct(t.margin_pct) + "%"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// DetailPerSku — per-SKU card grid; SkuBreakdown on expand.
// ──────────────────────────────────────────────────────────────────
//
// Open state keyed by sku.id (component-local). Mini bars consume
// at.status directly from classifier (Round-2 fix #1) — no
// in-component status derivation.

export function DetailPerSku({ state }: { state: QuoteState }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Per-SKU breakdown</h4>
        <span className="meta">
          {state.skus.length} SKUs · expand to see per-tier numbers
        </span>
      </div>
      <div className="psr-sku-grid">
        {state.skus.map((sku, i) => {
          const isOpen = !!open[sku.id];
          return (
            <div
              key={sku.id}
              className={"psr-sku-card " + (isOpen ? "expanded" : "")}
            >
              <button
                type="button"
                className="psr-sku-summary"
                onClick={() => toggle(sku.id)}
                aria-expanded={isOpen}
              >
                <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="name-cell">
                  <span className="name">{sku.name}</span>
                  <span className="meta">
                    <span>{sku.id}</span>
                    <span className="sep">·</span>
                    <span>worst tier: {fmtPct(sku.min_margin_pct)}%</span>
                    {sku.client_target_unit != null && (
                      <>
                        <span className="sep">·</span>
                        <span>
                          client target ${sku.client_target_unit.toFixed(2)}
                          /unit
                        </span>
                      </>
                    )}
                    {sku.over_client_target && (
                      <>
                        <span className="sep">·</span>
                        <span className="over-target">
                          over client target
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <span className="psr-tier-strip">
                  {sku.all_tiers.map((at) => {
                    // Round-2 fix #1: consume classifier-assigned status;
                    // no re-derivation.
                    const status = at.status ?? "unknown";
                    const h =
                      at.margin_pct == null
                        ? 4
                        : Math.max(4, at.margin_pct * 40);
                    return (
                      <span
                        key={at.tier_id}
                        className={"bar " + status}
                        style={{ height: h + "px" }}
                        title={
                          "T" +
                          at.tier_id +
                          " · " +
                          fmtPct(at.margin_pct) +
                          "%"
                        }
                      >
                        <span className="lab">T{at.tier_id}</span>
                      </span>
                    );
                  })}
                </span>
                <span className={"status-pill " + sku.status}>
                  <span className="dot" />
                  {sku.status.replace(/_/g, " ")}
                </span>
                <span className="psr-show-breakdown">
                  <span className="twirl">▸</span>
                  {isOpen ? "Hide breakdown" : "Show breakdown"}
                </span>
              </button>

              {isOpen && <SkuBreakdown sku={sku} state={state} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// SkuBreakdown — per-tier rows for one SKU.
// ──────────────────────────────────────────────────────────────────
//
// cell.status + cell.client_target_delta + cell.override_applied
// all classifier-owned per Round-2 fix #1. Component reads via
// state.cells.find for the (sku.id, tier.id) pair; never re-derives.
//
// Catch #5 hint: shared primitives (MarginVerdictPill /
// MarginSparkline / TwoAxisVerdictPair / ReverseSolveDialog) stay
// shipped. PSR v1 doesn't import them here per Pattern 28 (CD
// prototype uses bd-row structure); if PM workflow surfaces a need
// for them later (e.g., reverse-solve from SKU row), the primitives
// are imported into the existing composition without re-shipping
// the underlying components.

export function SkuBreakdown({
  sku,
  state,
}: {
  sku: QuoteState["skus"][number];
  state: QuoteState;
}) {
  const rows = state.quote.tiers.map((t) => {
    const cell = state.cells.find(
      (c) => c.sku_id === sku.id && c.tier_id === t.id,
    );
    return { tier: t, cell };
  });
  return (
    <div className="psr-sku-breakdown">
      <div className="bd-head">
        <span>Tier</span>
        <span className="num">Qty</span>
        <span className="num">Unit cost</span>
        <span className="num">Sell · unit</span>
        <span className="num">Margin</span>
        <span className="num">vs client target</span>
        <span>Status</span>
      </div>
      {rows.map(({ tier, cell }) => {
        if (!cell || cell.missing) {
          return (
            <div key={tier.id} className="bd-row unknown">
              <span className="tier-cell">
                <strong>T{tier.id}</strong>
              </span>
              <span className="num">{fmtQty(tier.qty)}</span>
              <span className="num">—</span>
              <span className="num">—</span>
              <span className="num">—</span>
              <span className="num">—</span>
              <span>
                <span className="row-pill unknown">
                  <span className="dot" />
                  awaiting raws
                </span>
              </span>
            </div>
          );
        }
        const delta = cell.client_target_delta;
        const deltaCls =
          delta == null ? "" : delta > 0 ? "over" : delta < 0 ? "under" : "";
        return (
          <div key={tier.id} className={"bd-row " + cell.status}>
            <span className="tier-cell">
              <strong>T{tier.id}</strong>
              {cell.override_applied && (
                <span className="ovr-chip">OVR</span>
              )}
            </span>
            <span className="num">{fmtQty(tier.qty)}</span>
            <span className="num">{fmtUsd2(cell.cost_unit)}</span>
            <span className="num">{fmtUsd2(cell.sell_unit)}</span>
            <span className="num strong">{fmtPct(cell.margin_pct)}%</span>
            <span className={"num " + deltaCls}>
              {delta == null
                ? "—"
                : (delta > 0 ? "+" : "") + "$" + delta.toFixed(2)}
            </span>
            <span>
              <span className={"row-pill " + cell.status}>
                <span className="dot" />
                {cell.status.replace(/_/g, " ")}
              </span>
            </span>
          </div>
        );
      })}
      {sku.client_target_unit == null && (
        <div className="bd-note">
          No client target on file for this SKU — vs-target column shows —.
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// DetailMetaTiles — reference tiles. Folded into DETAIL per CD §4.3.
// ──────────────────────────────────────────────────────────────────
//
// most_headroom_tier = tier with highest min_margin_pct across SKUs.
// client_benchmark_count = count of SKUs with non-null
// client_target_unit. Both selections from classifier-owned rollups
// (state.tiers + state.skus); no in-component status derivation.

export function DetailMetaTiles({ state }: { state: QuoteState }) {
  const headroom = state.tiers
    .filter((t) => t.min_margin_pct != null)
    .reduce<TierRollup | null>(
      (a, b) =>
        a == null ||
        (b.min_margin_pct != null &&
          (a.min_margin_pct == null || b.min_margin_pct > a.min_margin_pct))
          ? b
          : a,
      null,
    );
  const benchmarked = state.skus.filter(
    (s) => s.client_target_unit != null,
  ).length;
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Reference</h4>
        <span className="meta">Diagnostic context · not action-adjacent</span>
      </div>
      <div className="psr-meta-tiles">
        <div className="psr-meta-tile">
          <div className="lab">Most headroom</div>
          <div className="val">
            {headroom
              ? `Tier ${headroom.id} · ${fmtPct(headroom.min_margin_pct)}%`
              : "—"}
          </div>
          <div className="sub">Highest worst-case margin across tiers</div>
        </div>
        <div className="psr-meta-tile">
          <div className="lab">Client benchmark</div>
          <div className="val">
            {benchmarked} of {state.skus.length} SKUs priced against target
          </div>
          <div className="sub">Stated unit-price ceilings from client RFP</div>
        </div>
      </div>
    </div>
  );
}
