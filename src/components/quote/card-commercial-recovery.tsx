"use client";

/**
 * Card 1 · Commercial recovery.
 *
 * AUTHORITY: `docs/design-authority/customer-view/` — the reference of record's
 * rail, card 1. Header sub-line verbatim: *"Changes sell price and margin. Runs
 * through pricing governance."*
 *
 * ── WHY THIS CARD IS ON THIS SURFACE ────────────────────────────────────
 *
 * It moves economics, it is governed by Pricing, and it lives here. All three
 * at once — D3. An earlier reconciliation read *"not a presentation control"*
 * as *"must not appear on the workspace"* and deleted this card; that was a
 * misreading of a sentence scoped to card 2. See BUNDLE.md D3.
 *
 * ── OPERATOR VOCABULARY, NOT ENGINE VOCABULARY ──────────────────────────
 *
 * The deleted card said "Use governed amortization", "legacy pricing",
 * "elected", and cited BV-011 by number. Every sentence was true and none of
 * them was the operator's question. The authority's words are
 * `In unit price` / `Separate` / `Absorbed`, with a policy line that states
 * what is allowed and that the cost is governed elsewhere.
 *
 * The legacy/elected distinction stays load-bearing underneath — `source` still
 * decides how the engine prices the charge — but it is not the operator's
 * vocabulary and does not appear as a label here.
 *
 * ── DENIED OPTIONS ARE RENDERED, NOT HIDDEN ─────────────────────────────
 *
 * *"Options not permitted by the charge's governed policy render disabled …
 * with a title giving the reason. Disabled options are still rendered — the
 * constraint must be visible, not hidden."* Same rule the action layer enforces
 * through the same `refusalFor`, so the surface cannot offer what the boundary
 * would refuse.
 *
 * ── THE MEASURED IMPACT STAYS ───────────────────────────────────────────
 *
 * Electing is a commercial act and its effect on the customer's total is
 * measured before it is committed, by running the engine on the real input with
 * the candidate election substituted. That is certified and is kept — the
 * authority does not describe it, and it does not contradict anything the
 * authority does describe.
 */

import { useState, useTransition } from "react";
import {
  previewChargeRecovery,
  setChargeRecovery,
} from "@/app/actions/commercial-recovery";
import type { RecoveryImpact } from "@/lib/commercial-recovery/impact";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { RecoveryMode } from "@/lib/commercial-recovery/registry";
import type { QuotePerTierRollup } from "@/lib/costing";

/** The authority's words for the three treatments. */
const MODE_LABEL: Record<RecoveryMode, string> = {
  included: "In unit price",
  separate: "Separate",
  absorbed: "Absorbed",
};

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function marginState(
  m: number | null,
  floor: number,
  target: number,
): "below_floor" | "below_target" | "on_target" | "unknown" {
  if (m === null) return "unknown";
  const eps = 1e-6;
  if (m < floor - eps) return "below_floor";
  if (m < target - eps) return "below_target";
  return "on_target";
}

export function CardCommercialRecovery({
  quoteId,
  rows,
  rollups,
  shownTierIds,
  floorMarginPct,
  targetMarginPct,
  editable,
}: {
  quoteId: string;
  rows: RecoveryChargeRow[];
  /** Every governed tier — the gate evaluates all of them, not only those shown. */
  rollups: readonly QuotePerTierRollup[];
  shownTierIds: readonly string[];
  floorMarginPct: number;
  targetMarginPct: number;
  editable: boolean;
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<{
    chargeKey: string;
    mode: RecoveryMode | null;
    impact: RecoveryImpact | null;
  } | null>(null);
  const [, startTransition] = useTransition();

  const present = rows.filter((r) => r.present);

  function post(
    chargeKey: string,
    mode: RecoveryMode | null,
    commit: boolean,
  ) {
    setError(null);
    setProposed(null);
    setPendingKey(chargeKey);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("chargeKey", chargeKey);
    fd.set("mode", mode ?? "");
    startTransition(async () => {
      const res = commit
        ? await setChargeRecovery(fd)
        : await previewChargeRecovery(fd);
      setPendingKey(null);
      if (!res.ok) {
        // The governed reason, verbatim. The surface refuses too, but the
        // surface is not the boundary — this is what the boundary said.
        setError(res.error.message);
        return;
      }
      if (!commit) {
        setProposed({ chargeKey, mode, impact: res.data as RecoveryImpact | null });
      }
    });
  }

  // The gate reads EVERY governed tier. A display choice can never clear a
  // floor breach, so tiers the customer will not see are still evaluated and
  // still shown — dimmed, and labelled.
  const shown = new Set(shownTierIds);
  const cards = rollups.map((t) => ({
    tierId: t.tierId,
    label: t.label,
    pct: t.blendedMarginPct,
    state: marginState(t.blendedMarginPct, floorMarginPct, targetMarginPct),
    shown: shown.size === 0 || shown.has(t.tierId),
  }));
  const blocked = cards.some((c) => c.state === "below_floor");

  return (
    <section className="cv-card cv-card-recovery" data-testid="card-commercial-recovery">
      <div className="cv-card-head">
        <span className="cv-step">1</span>
        <div>
          <div className="cv-card-title">Commercial recovery</div>
          <div className="cv-card-sub">
            Changes sell price and margin. Runs through pricing governance.
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="cv-charge" data-testid="recovery-error"
           style={{ color: "var(--danger, #b3261e)", font: "400 11.5px/1.45 var(--sans)" }}>
          {error}
        </p>
      )}

      {present.length === 0 ? (
        <p className="cv-charge cv-note">
          This quote carries no governed recoverable charges.
        </p>
      ) : (
        present.map((row) => {
          const busy = pendingKey === row.chargeKey;
          const allowed = row.options.filter((o) => o.available).map((o) => MODE_LABEL[o.mode].toLowerCase());
          return (
            <div key={row.chargeKey} className="cv-charge" data-testid={`charge-${row.chargeKey}`}>
              <div className="cv-charge-head">
                <span className="cv-charge-label">{row.label}</span>
                <span className="cv-charge-amt">
                  {/* BV-013 · D5: unknown recovery is unavailable, never $0. */}
                  {row.totalRecovery === null ? "not priced" : usd(row.totalRecovery)}
                </span>
              </div>
              <div className="cv-charge-policy">
                policy: {allowed.length ? allowed.join(" / ") : "none available"} · cost governed
              </div>
              <div className="cv-opts">
                {row.options.map((opt) => {
                  const active =
                    row.source === "election" && row.electedMode === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      aria-pressed={active}
                      disabled={!editable || busy || !opt.available}
                      title={
                        !editable
                          ? "This quote is no longer a draft; recovery is frozen."
                          : (opt.reason ?? undefined)
                      }
                      data-testid={`recovery-${row.chargeKey}-${opt.mode}`}
                      data-available={opt.available ? "yes" : "no"}
                      onClick={() => post(row.chargeKey, opt.mode, false)}
                    >
                      {MODE_LABEL[opt.mode]}
                    </button>
                  );
                })}
              </div>

              {proposed?.chargeKey === row.chargeKey && proposed.impact && (
                <div className="cv-note" data-testid={`recovery-confirm-${row.chargeKey}`}
                     style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 500, color: "var(--ink)" }}>
                    {proposed.mode === null
                      ? "Restore the inherited treatment"
                      : MODE_LABEL[proposed.mode]}
                  </div>
                  <div data-testid={`recovery-impact-${row.chargeKey}`}>
                    Customer total {usd(proposed.impact.customerTotalBefore)} →{" "}
                    {usd(proposed.impact.customerTotalAfter)}
                    {Math.round(proposed.impact.customerTotalAfter) ===
                      Math.round(proposed.impact.customerTotalBefore) && " — unchanged"}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button type="button" disabled={!editable || busy}
                            data-testid={`recovery-commit-${row.chargeKey}`}
                            onClick={() => post(row.chargeKey, proposed.mode, true)}>
                      Confirm
                    </button>
                    <button type="button" onClick={() => setProposed(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      <div className="cv-margin-block">
        <div className="cv-eyebrow">
          Margin after recovery · all governed tiers · floor {pct(floorMarginPct)} · target{" "}
          {pct(targetMarginPct)}
        </div>
        <div className="cv-margin-cards">
          {cards.map((c) => (
            <div key={c.tierId} className="cv-margin" data-state={c.state}
                 data-shown={c.shown ? "yes" : "no"}
                 data-testid={`margin-${c.tierId}`}>
              <div className="cv-margin-label">
                {c.label}
                {c.shown ? "" : " · not shown"}
              </div>
              <div className="cv-margin-pct">{c.pct === null ? "—" : pct(c.pct)}</div>
              <div className="cv-margin-state">{c.state.replace("_", " ")}</div>
            </div>
          ))}
        </div>
        <div className="cv-gov-note" data-blocked={blocked ? "yes" : "no"}>
          {blocked
            ? "A governed tier is below the margin floor. Pricing approval is required before this quote can be frozen and sent."
            : "Every governed tier is at or above the margin floor."}
        </div>
      </div>
    </section>
  );
}
