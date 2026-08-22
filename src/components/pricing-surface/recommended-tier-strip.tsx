"use client";

import { usePricingClassifier } from "./pricing-classifier-context";
import { fmtPct, fmtUsd } from "./format";

/**
 * Scope · recommended tier · order value · blended margin, on one line.
 *
 * ── WHY A STRIP AND NOT A CARD ───────────────────────────────────────────
 *
 * `SendableSummary` was a four-cell card titled "What you're sending", and it
 * spent most of its height saying things the operator had not asked. The
 * question it answers is real but small: which tier is this quote read at, and
 * what does that make it worth. A strip answers it in one line and gives the
 * height back to the grid, which is where the diagnosis happens.
 *
 * ── SELECTION CHANGES WHAT IS QUOTED, NOT WHAT IS GOVERNED ───────────────
 *
 * Picking a tier sets which tier the order is priced and read at. It does NOT
 * narrow compliance: every tier presented in the sent quote remains governed,
 * and the grid keeps showing all of them. So this strip changes two figures —
 * order value and blended margin — and nothing about the verdict above it.
 *
 * The verdict is computed from every tier by `evaluateProgression`, which never
 * sees this selection.
 */

export function RecommendedTierStrip({
  tiers,
  onSetRecommended,
  pending = false,
  error = null,
}: {
  /** Every tier, in order, with the UUID the write needs. */
  tiers: ReadonlyArray<{ numericId: number; uuid: string; label: string }>;
  /** Null clears the recommendation. Undefined means read-only. */
  onSetRecommended?: (tierUuid: string | null) => void;
  pending?: boolean;
  error?: string | null;
}) {
  const { state } = usePricingClassifier();
  const sc = state.summary_card;
  const recommended = sc?.recommended_tier ?? null;

  // Order value and blended margin are BOTH projected from the recommended
  // tier. Tiers are mutually exclusive quantity breaks — a customer buys at one
  // — so a cross-tier aggregate would price a transaction that cannot occur.
  // With no tier chosen there is no answer, and inventing one by defaulting to
  // the first tier would put a number here that nobody decided.
  const chosen = recommended != null;

  return (
    <section className="r13-strip">
      <div className="r13-strip-cell">
        <span className="lab">Scope</span>
        <span className="val">
          {sc?.sku_count ?? state.skus.length} SKU
          {(sc?.sku_count ?? state.skus.length) === 1 ? "" : "s"} ·{" "}
          {sc?.tier_count ?? state.tiers.length} tier
          {(sc?.tier_count ?? state.tiers.length) === 1 ? "" : "s"}
        </span>
      </div>

      <div className="r13-strip-tiers">
        <span className="lab">Recommended tier · sets what the customer is quoted</span>
        <div className="chips" role="group" aria-label="Recommended tier">
          {tiers.map((t) => {
            const roll = state.tiers.find((r) => r.id === t.numericId);
            const active = recommended === t.numericId;
            return (
              <button
                key={t.uuid}
                type="button"
                className={`r13-chip${active ? " on" : ""}`}
                aria-pressed={active}
                // Pattern 47(f): scoped to this action's own pending state.
                disabled={!onSetRecommended || pending}
                onClick={() => onSetRecommended?.(active ? null : t.uuid)}
              >
                {t.label}
                <span className="sub">
                  {roll?.blended_status === "below_floor"
                    ? "below floor"
                    : roll?.blended_margin_pct != null
                      ? `${fmtPct(roll.blended_margin_pct)}%`
                      : "—"}
                </span>
              </button>
            );
          })}
        </div>
        {error && (
          <span className="r13-note" role="alert">
            {error}
          </span>
        )}
      </div>

      <div className="r13-strip-cell num">
        <span className="lab">Order value</span>
        <span className={`val${chosen ? "" : " unset"}`}>
          {chosen && sc?.recommended_tier_value != null ? fmtUsd(sc.recommended_tier_value) : "Set a tier"}
        </span>
      </div>

      <div className="r13-strip-cell num">
        <span className="lab">Blended margin</span>
        <span className={`val${chosen ? "" : " unset"}`}>
          {chosen && sc?.blended_margin_pct != null
            ? `${fmtPct(sc.blended_margin_pct)}%`
            : "Set a tier"}
        </span>
      </div>
    </section>
  );
}
