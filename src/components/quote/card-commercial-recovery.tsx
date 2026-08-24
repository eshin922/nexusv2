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
 * ── PICKING ELECTS. THERE IS NO CONFIRMATION STEP ───────────────────────
 *
 * The reference:
 *
 *     pick: permitted && !s.frozen ? () => this.setRecovery(c.id, o.id) : () => {}
 *
 * Immediate. The README says the same: *"Picking a permitted option sets that
 * charge's recovery mode."*
 *
 * An earlier version made this a two-step measure-then-confirm, to show the
 * customer-total delta before committing. That came from the superseded R5-era
 * framing, when this card lived alone at the bottom of a page and the operator
 * could not see what it changed.
 *
 * In this composition they can. The document is beside the control, the
 * margin-after-recovery cards are beneath it, and both re-render on the pick —
 * so the artifact IS the confirmation, and a modal restating it is a dialog in
 * front of the answer. That is the whole reason the surface is two panes.
 *
 * `measureRecoveryImpact` stays as a certified library. It is no longer a gate
 * on this control.
 */

import { useState, useTransition } from "react";
import { setChargeRecovery } from "@/app/actions/commercial-recovery";
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
  const [, startTransition] = useTransition();

  const present = rows.filter((r) => r.present);

  /** Picking elects. The document and the margin cards are the confirmation. */
  function pick(chargeKey: string, mode: RecoveryMode) {
    setError(null);
    setPendingKey(chargeKey);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("chargeKey", chargeKey);
    fd.set("mode", mode);
    startTransition(async () => {
      const res = await setChargeRecovery(fd);
      setPendingKey(null);
      // The governed reason, verbatim. The surface refuses too, but the surface
      // is not the boundary — this is what the boundary said.
      if (!res.ok) setError(res.error.message);
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
                {/* SAYING SO WHILE IT HAPPENS.
                    The write lands in about two seconds -- measured at 2369ms
                    and 1999ms on production. For that whole time the selection
                    did not move, the row's buttons were disabled, and nothing
                    on screen said anything. An operator clicked, saw nothing,
                    clicked again into dead buttons, and reported the control
                    as broken. It was not: every click persisted.
                    A consequential control that takes two silent seconds IS
                    broken from where the operator sits, whatever the database
                    did. */}
                {busy && <span className="cv-charge-saving">saving… </span>}
                policy: {allowed.length ? allowed.join(" / ") : "none available"} · cost governed
                {/* Provenance is a caption, never the selected state. A quote
                    that inherited its treatment still HAS that treatment. */}
                {row.mixed
                  ? " · placed more than one way"
                  : row.effectiveMode === null
                    ? ""
                    : row.source === "legacy"
                      ? " · inherited"
                      : " · elected"}
              </div>
              <div className="cv-opts">
                {row.options.map((opt) => {
                  // The treatment IN FORCE, whatever put it there. Reading this
                  // off `electedMode` meant a quote with no election row showed
                  // every option unselected while unambiguously carrying one.
                  const active = row.effectiveMode === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      aria-pressed={active}
                      // Pattern 47(e) permits `disabled` on BUTTONS -- the
                      // double-click protection is real and focus stability is
                      // not a button concern. 47(f) requires that a disabled
                      // control communicate WHY, which is what `aria-busy` and
                      // the title below now do.
                      aria-busy={busy || undefined}
                      data-busy={busy ? "yes" : undefined}
                      disabled={!editable || busy || !opt.available}
                      title={
                        !editable
                          ? "This quote is no longer a draft; recovery is frozen."
                          : busy
                            ? "Saving this change…"
                            : (opt.reason ?? undefined)
                      }
                      data-testid={`recovery-${row.chargeKey}-${opt.mode}`}
                      data-available={opt.available ? "yes" : "no"}
                      onClick={() => pick(row.chargeKey, opt.mode)}
                    >
                      {MODE_LABEL[opt.mode]}
                    </button>
                  );
                })}
              </div>

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
