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

import { useState } from "react";
import { usePricingClassifier } from "./pricing-classifier-context";
import type { Cell } from "@/lib/pricing-classifier";

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

// ── the grid ──────────────────────────────────────────────────────────────

export interface ComplianceGridProps {
  /** Firm thresholds, for the header caption ONLY. Never compared against. */
  targetPct: number;
  floorPct: number;
  /** Tier labels and the ★ recommendation, by classifier tier id. */
  tierMeta: ReadonlyMap<number, { label: string; recommended: boolean }>;
}

export function ComplianceGrid({
  targetPct,
  floorPct,
  tierMeta,
}: ComplianceGridProps) {
  const { state } = usePricingClassifier();
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
        <div className="r11-brow" key={sku.id}>
          <div className="r11-bsku">
            <span>
              <span className="n">{sku.name}</span>
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
                  "r11-bcell r11-cg" +
                  (cell.actionable ? " act" : " inert") +
                  (isSel ? " sel" : "")
                }
                onClick={
                  cell.actionable
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
      ))}
    </div>
  );
}
