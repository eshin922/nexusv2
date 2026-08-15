"use client";

// Phase 3 · the R12 compliance grid.
//
// Canonical source: `docs/design-authority/r12-pricing-workspace/app/r12/
// pricing-page.jsx` → `ComplianceGrid`, with the `.r11-*` / `.r12-*` class
// vocabulary from that bundle's stylesheets, copied verbatim per Pattern 30
// into `src/styles/r1{0,1,2}-pricing-workspace.css`.
//
// ── WHAT THIS COMPONENT IS NOT ALLOWED TO DO ──────────────────────────────
//
// It computes nothing commercial. Not a margin, not a band, not whether a
// lift is needed or permitted, not whether a cell is missing. Every one of
// those is already decided in `PricingClassifierProvider`, which is the single
// evaluation both this grid and the banner read — the property that makes
// "they cannot disagree" structural instead of a convention two surfaces are
// asked to honour.
//
// The design source itself has a line for this, and it is the reason the
// prototype passes `ev` in rather than recomputing from `rollups`:
//
//     "Reads the shared evaluation — never its own."
//
// Concretely, none of the following may appear below: a comparison against
// `floor_margin_pct` or `target_margin_pct`; a `sell === 0` or `cost === 0`
// test standing in for "no data"; an inference that a lift is blocked because
// an override exists. Each of those has been a second authority in this
// codebase at some point, and each was individually correct while it lasted.
//
// What the component DOES own: layout, ordering, formatting, and which words
// name a state. Those are presentation, and the design bundle governs them.

import { Fragment, useState } from "react";
import { usePricingClassifier } from "./pricing-classifier-context";
import { CellAction } from "./cell-action";
import { usePricingStaging } from "./pricing-staging-context";
import type { Cell } from "@/lib/pricing-classifier";
import type { CellRef } from "@/lib/pricing-staging";

// ── formatting ────────────────────────────────────────────────────────────
//
// `fmtPct` takes an already-decided number. It has no opinion about what the
// number means and no branch on its size — a formatter that classified would
// be a predicate wearing a formatter's name.

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v: number, dp = 2): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/**
 * The class the canonical stylesheet colours a margin with.
 *
 * A pure mapping from a decided status to a token name — the status arrives
 * classified. Note there is no `else`: every member is named, so a future
 * addition to the union fails to compile here rather than inheriting whatever
 * the last branch happened to be. Four surfaces learned that the hard way when
 * `UNAVAILABLE` landed and silently took the `bad` branch.
 */
const STATUS_CLASS: Record<Cell["status"], string> = {
  above_target: "good",
  below_target: "below_target",
  below_floor: "below_floor",
  unknown: "unknown",
};

/**
 * What a cell says where its margin would go, and beneath it.
 *
 * The two no-margin states are named APART, because they are apart: one has
 * nothing entered and carries no commercial judgement; the other has cost with
 * nothing priced against it and is a certain loss. Coercing either into a
 * percentage — or into each other — is the failure the engine corrections
 * removed across three scopes, and it must not be reintroduced one layer up in
 * a formatter.
 *
 * Both show an em-dash where the number would be, because in both cases there
 * is no number. What differs is what the cell SAYS, and the tone it says it
 * in: absence is muted, a loss is not.
 */
function marginDisplay(cell: Cell): {
  value: string;
  note: string | null;
  noteClass: string;
} {
  if (cell.margin_pct !== null) {
    return { value: fmtPct(cell.margin_pct), note: null, noteClass: "" };
  }
  if (cell.no_margin_reason === "cost_without_revenue") {
    return {
      value: "—",
      note: "cost, no revenue",
      noteClass: "cgnote bad",
    };
  }
  return { value: "—", note: "not priced", noteClass: "cgnote" };
}

/**
 * Headroom against the customer's stated benchmark — its own channel.
 *
 * Phase 3 §7: the benchmark is stated ONCE per SKU row, because it does not
 * vary by tier and a column would assert something untrue. The HEADROOM is
 * per cell, because the price is.
 *
 * Three separations hold here, and each is load-bearing:
 *
 *   1. The verdict comes from `competitive_status`, which the ENGINE decided.
 *      Nothing here compares a price to a benchmark.
 *   2. The magnitude comes from `client_target_delta`, which the classifier
 *      already computed. `Math.abs` is formatting — the sign is carried by the
 *      status, so no comparison happens to recover direction.
 *   3. The colours are `.r12-head`'s own, not the policy palette. The
 *      canonical stylesheet gives them distinct oklch values rather than
 *      reusing `--good` / `--bad` for exactly this reason: a price above what
 *      the customer asked for is a commercial risk, not a floor breach, and
 *      making them look alike would collapse two different questions into one
 *      colour.
 */
function Headroom({ cell }: { cell: Cell }) {
  if (cell.competitive_status === null || cell.client_target_delta === null) {
    return null;
  }
  const magnitude = fmtUsd(Math.abs(cell.client_target_delta));
  if (cell.competitive_status === "OVER_CLIENT_TARGET") {
    return <span className="r12-head over">▲ {magnitude} vs client</span>;
  }
  return <span className="r12-head under">▼ {magnitude} vs client</span>;
}

// ── the grid ──────────────────────────────────────────────────────────────

export interface ComplianceGridProps {
  /** Firm thresholds, for the header caption ONLY. Never compared against. */
  targetPct: number;
  floorPct: number;
  /** Tier labels and the ★ recommendation, by classifier tier id. */
  tierMeta: ReadonlyMap<number, { label: string; recommended: boolean }>;
  /**
   * Classifier ids → the canonical staging address, resolved by the caller.
   *
   * The grid does not do this itself, and the reason is specific rather than
   * stylistic: `sku.id` here is the ENGINE's SKU id, while a staged change is
   * keyed on `canonicalQuoteLeafId` — a separate field on the same rollup. A
   * component resolving that mapping is a component that can resolve it
   * wrongly, and the cost of being wrong is a price change landing on a
   * different commercial line.
   *
   * Returns null when either half is unresolved; `CellAction` then refuses to
   * stage rather than addressing a guess.
   */
  resolveCell?: (skuId: string, tierId: number) => CellRef | null;
}

/**
 * P-Lift-2 · the tier's breach that no lift can reach.
 *
 * A direct price is terminal, so a below-floor cell carrying one is not a
 * failure of the bulk action — it is outside its authority. The operator needs
 * three things and this says all three: that something is still below floor,
 * that a percentage lift is not the instrument, and which cell it is.
 *
 * Navigable rather than descriptive. Pressing it opens the same `CellAction`
 * panel the grid opens anywhere else, so "adjust directly" is a step the
 * operator can take from here instead of a hunt through the grid for a red
 * cell they have already been told about.
 */
function ManualPriceRemains({
  cells,
  onSelect,
}: {
  cells: ReadonlyArray<Cell>;
  onSelect: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className="r11-manual-remains"
      title={cells.map((c) => c.sku_name).join(" · ")}
      onClick={() => onSelect(`${cells[0].sku_id}:${cells[0].tier_id}`)}
    >
      {cells.length} manual price{cells.length === 1 ? "" : "s"} remain
      {cells.length === 1 ? "s" : ""} below floor · adjust directly
    </button>
  );
}

export function ComplianceGrid({
  targetPct,
  floorPct,
  tierMeta,
  resolveCell,
}: ComplianceGridProps) {
  const { state } = usePricingClassifier();
  const { stageLift } = usePricingStaging();
  const [selected, setSelected] = useState<string | null>(null);

  // One lookup over the one evaluation. Not a second pass, not a re-partition
  // — an index into `state.cells` so a row can find its cell in constant time.
  const byCell = new Map<string, Cell>();
  for (const c of state.cells) byCell.set(`${c.sku_id}:${c.tier_id}`, c);

  return (
    <div className="r11-stack">
      <div className="r11-srow head">
        <div className="r11-slab">
          <span className="colhead">Compliance · margin by cell</span>
          <span className="s">
            target {fmtPct(targetPct)} · floor {fmtPct(floorPct)}
          </span>
        </div>
        {state.tiers.map((t) => {
          const meta = tierMeta.get(t.id);
          return (
            <div className="r11-scell flat" key={t.id}>
              <span
                className="sell"
                style={{ fontSize: 11, letterSpacing: "0.06em" }}
              >
                {meta?.label ?? `T${t.id}`}
                {meta?.recommended && (
                  <span style={{ color: "oklch(0.56 0.13 72)" }}> ★</span>
                )}
              </span>
              <span className="cost">{t.qty.toLocaleString()} units</span>
            </div>
          );
        })}
      </div>

      {state.skus.map((sku) => (
        <Fragment key={sku.id}>
        <div className="r11-brow">
          <div className="r11-bsku">
            <span>
              <span className="n">{sku.name}</span>
              {/*
                The canonical sub-label is `{code} · {pack}`. `pack` does not
                exist on the model — Slice 11 deferral — so only the code
                renders, and it renders NULL-SAFELY: the moment pack lands the
                sub-label completes with no rework here, and until then nothing
                shows a placeholder for a field nobody has filled.
              */}
              {sku.code != null && <span className="m">{sku.code}</span>}
              {/*
                Client target is stated ONCE per SKU row, not per cell — it
                does not vary by tier, so a column would assert something
                untrue. It is a benchmark and never a verdict: it has its own
                channel, never colours a cell, and never reaches the banner.
                Firm floor and target are policy; this is what the customer
                said they wanted.
              */}
              {sku.client_target_unit != null && (
                <span className="r12-benchmark">
                  client target {fmtUsd(sku.client_target_unit)}
                </span>
              )}
            </span>
          </div>

          {state.tiers.map((t) => {
            const cell = byCell.get(`${sku.id}:${t.id}`);
            if (!cell) {
              // The classifier emits a cell per (SKU × tier); a gap is a
              // contract violation, not an empty state. Rendered as a gap
              // rather than filled in, because inventing a value here is
              // exactly the behaviour this component is written to avoid.
              return <div className="r11-bcell inert" key={t.id} />;
            }
            const key = `${sku.id}:${t.id}`;
            const isSel = selected === key;
            const display = marginDisplay(cell);
            return (
              <button
                type="button"
                key={t.id}
                className={
                  // Pressability follows `selectable`, remediation follows
                  // `actionable`. They were one flag, and a compliant quote
                  // rendered 27 cells nobody could open.
                  // B-16 · the compliance state belongs to the CELL, not to
                  // the percentage inside it.
                  //
                  // Next Move already told the operator a cell was below
                  // target or floor; the grid did not say WHICH, so they read
                  // the verdict and then scanned percentages to find it. A
                  // tinted digit is still a read. A tinted cell is a scan.
                  //
                  // The status is FORWARDED, never recomputed:
                  // `cell.status` is the classifier's own per-cell verdict,
                  // the same authority Next Move speaks from. Nothing here
                  // knows what a target or a floor is, which is what keeps
                  // the grid and the banner from disagreeing.
                  "r11-bcell r11-cg cg-" + cell.status +
                  (cell.selectable ? " act" : " inert") +
                  (isSel ? " sel" : "")
                }
                onClick={
                  cell.selectable
                    ? () => setSelected(isSel ? null : key)
                    : undefined
                }
              >
                <span className={"cgm " + STATUS_CLASS[cell.status]}>
                  {display.value}
                </span>
                {cell.sell_unit !== null && (
                  <span
                    className="p"
                    style={{ fontSize: 10.5, color: "var(--ink-4)" }}
                  >
                    {fmtUsd(cell.sell_unit)}
                  </span>
                )}
                {display.note && (
                  <span className={display.noteClass}>{display.note}</span>
                )}
                <Headroom cell={cell} />

                {/*
                  Every badge below reads a decided fact. None is inferred
                  from another: "a lift is applied" is not derived from the
                  offer being absent, and "blocked" is not derived from an
                  override existing — the classifier states each, because the
                  reasoning that connects them lives with the authority.
                */}
                {cell.override_applied && <span className="ov">PM-set</span>}
                {cell.lift_applied_pct !== null && (
                  <span className="lifted">
                    lifted {fmtPct(cell.lift_applied_pct)}
                  </span>
                )}
                {cell.lift_blocked && (
                  <span className="ov">lift blocked</span>
                )}
                {cell.outstanding && cell.lift_offer_pct !== null && (
                  <span className="needs">
                    needs {fmtPct(cell.lift_offer_pct)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/*
          The panel opens beneath the SKU row whose cell was pressed — the same
          shape as the cost stack's inline trace, and for the same reason: an
          action names a cell, and the cell should still be visible while it is
          being acted on.
        */}
        {selected?.startsWith(`${sku.id}:`) &&
          (() => {
            const cell = byCell.get(selected);
            if (!cell) return null;
            const meta = tierMeta.get(cell.tier_id);
            return (
              <CellAction
                cell={cell}
                cellRef={resolveCell?.(cell.sku_id, cell.tier_id) ?? null}
                floorPct={floorPct}
                // Display identity, built here from what the caller supplied.
                // Falls back to the numeric tier id rather than inventing a
                // label — an ugly heading beats a wrong one.
                label={`${cell.sku_name} · ${meta?.label ?? `T${cell.tier_id}`}`}
                onClose={() => setSelected(null)}
              />
            );
          })()}
        </Fragment>
      ))}

      {/*
        THE TIER-LEVEL READ — the one fact that is genuinely per-tier, kept as a
        rollup row rather than a panel standing in for the cells.

        This is where the removed per-tier compliance table's content belongs.
        Same numbers, one surface: a table below the grid restated what the grid
        already showed, and two statements of one fact are two things that can
        disagree.

        `blended_margin_pct` is the GOVERNED blend — revenue-weighted, from the
        engine — not a mean of the cells above it. BV-010 settled that those are
        different quantities, and this row is the one that is the blend.
      */}
      <div className="r11-brow rule">
        <div className="r11-slab">
          <span className="n">Blended margin</span>
          <span className="s">the tier-level read</span>
        </div>
        {state.tiers.map((t) => {
          const below = state.cells.filter(
            (c) => c.tier_id === t.id && c.outstanding,
          ).length;
          return (
            <div className="r11-scell flat" key={t.id}>
              <span
                className={"mg " + STATUS_CLASS[t.blended_status]}
                style={{ fontSize: 15, fontWeight: 600 }}
              >
                {t.blended_margin_pct === null
                  ? "—"
                  : `${fmtPct(t.blended_margin_pct)}`}
              </span>
              <span className="cost">
                {below
                  ? `${below} cell${below === 1 ? "" : "s"} below floor`
                  : "all cells clear the floor"}
              </span>
            </div>
          );
        })}
      </div>

      {/*
        CORRECT THE TIER — present only while something is outstanding.

        It introduces no arithmetic. Each cell's lift is `lift_offer_pct`, which
        the SOLVER decided; this stages the offers that already exist, one per
        breaching cell, through the same `stageLift` every other path uses. The
        button is a bulk of existing acts, not a new one.

        Nothing is written. These land in the working set with everything else
        and wait for the one Apply that governs the page.
      */}
      {state.cells.some((c) => c.outstanding && c.lift_offer_pct !== null && !c.lift_blocked) && (
        <div className="r11-brow">
          <div className="r11-slab">
            <span className="n" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              Correct the tier
            </span>
          </div>
          {state.tiers.map((t) => {
            // Only cells the solver actually offered a lift for. An outstanding
            // cell with no offer is one the solver declined — bulk-staging a
            // number it refused to name would be inventing the correction.
            //
            // P-Lift-2 · AND ONLY CELLS A LIFT CAN REACH. `lift_offer_pct` is
            // computed for ANY below-floor cell, deliberately, so a cell can
            // show what WOULD clear it. Counting on that alone put direct-priced
            // cells in the batch: the button promised "Lift all 2 to floor",
            // staged both, and the engine refused the one whose price a person
            // had set. A direct price is terminal, so the correction was never
            // available — the count was the thing that was wrong.
            //
            // The exclusion is here, on the set the button both COUNTS and
            // MUTATES, so the promise and the act cannot drift apart.
            const outstanding = state.cells.filter(
              (c) => c.tier_id === t.id && c.outstanding && resolveCell?.(c.sku_id, c.tier_id) != null,
            );
            const need = outstanding.filter((c) => c.lift_offer_pct !== null && !c.lift_blocked);
            const blocked = outstanding.filter((c) => c.lift_blocked);
            return (
              <div className="r11-scell flat" key={t.id}>
                {need.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="btn sm"
                      style={{ width: "100%" }}
                      onClick={() => {
                        for (const c of need) {
                          const ref = resolveCell?.(c.sku_id, c.tier_id);
                          if (ref) stageLift(ref, c.lift_offer_pct as number);
                        }
                      }}
                    >
                      Lift all {need.length} to floor
                    </button>
                    {/*
                      The lift is available AND cannot finish the job. Saying
                      only "Lift all 3" would let an operator press it, watch
                      the tier stay red, and have nothing on screen account for
                      the difference.
                    */}
                    {blocked.length > 0 && (
                      <ManualPriceRemains cells={blocked} onSelect={setSelected} />
                    )}
                  </>
                ) : blocked.length > 0 ? (
                  // Nothing is liftable and something is still breaching. An
                  // em-dash here reads as "nothing to do", which is the exact
                  // opposite of true, and the previous CTA was worse: it was
                  // actionable and did nothing. State the real condition and
                  // point at the cell that owns it.
                  <ManualPriceRemains cells={blocked} onSelect={setSelected} />
                ) : (
                  <span className="cost">—</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
