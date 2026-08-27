"use client";

/**
 * Add one-time charges — the two-phase sheet.
 *
 * Pattern 30: the geometry, copy and register are the Design Authority's, taken
 * from `Nexus OD-032 Round Trip` §03 rather than interpreted from a screenshot.
 * Where this diverges it is recorded at the divergence, not in a changelog.
 *
 * ── WHY TWO PHASES AND NOT ONE ──────────────────────────────────────────
 *
 * The operator's real motion is "this carton causes plates, dies and samples" —
 * one thought, three charges. Add-row makes that three trips through a modal;
 * a checklist alone leaves three rows with no economics and no prompt to
 * finish them. So: pick the types together, price them together, and then they
 * are ordinary rows.
 *
 * ── WHAT THIS SHEET NEVER ASKS ──────────────────────────────────────────
 *
 * Recovery placement. Rows arrive in Commercial Recovery as `unplaced` and the
 * send checklist holds until each has one. Asking here would fuse the two
 * decisions the model keeps apart.
 *
 * And basis, which is `one_time` for every component-owned charge — "no
 * exceptions, and the sheet never asks". It is DISPLAYED, because the operator
 * should see what is being assumed on their behalf; it is not a control.
 */

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  COMPONENT_CHARGE_KEYS,
  COMPONENT_CHARGE_LABELS,
  labelRequiredFor,
  type ComponentChargeKey,
} from "@/lib/commercial-recovery/registry";
import { createComponentCharges } from "@/app/actions/component-charges";
import { runGoverned, failureMessage } from "@/lib/governed-action";

/**
 * The hint under each type, from the Design Authority's picker.
 *
 * Written for the operator looking at a carton, not for a data dictionary —
 * "cutting die for this carton" rather than "tooling".
 */
const HINT: Record<ComponentChargeKey, string> = {
  print_plates: "plate or cylinder making for this artwork",
  tooling: "cutting die, mould or collar for this component",
  artwork_plate: "design, adaptation and proofing labour",
  samples_proofs: "pre-production samples of this component",
  other_service: "label required · e.g. “foil stamping die spec”",
};

/**
 * Suggestions, by product type.
 *
 * SUGGESTED, NEVER PRE-CHECKED. A pre-checked box is how a phantom charge
 * reaches a customer document with nobody having decided it — suggestion is a
 * prompt, selection is an act. The chips render; the boxes stay empty.
 */
const SUGGESTED_BY_TYPE: Record<string, ComponentChargeKey[]> = {
  "secondary packaging": ["print_plates", "tooling", "samples_proofs"],
  "primary packaging": ["tooling", "samples_proofs"],
};

type Tier = { id: string; label: string };

type Draft = {
  key: ComponentChargeKey;
  label: string;
  /** Keyed by tier id, as typed. Strings, because the operator types strings. */
  cost: Record<string, string>;
  recovery: Record<string, string>;
};

export function AddComponentChargesSheet({
  quoteId,
  quoteLeafId,
  componentSku,
  componentName,
  productTypeLabel,
  tiers,
  existingKeys,
  onClose,
}: {
  quoteId: string;
  quoteLeafId: string;
  componentSku: string | null;
  componentName: string;
  productTypeLabel: string | null;
  tiers: readonly Tier[];
  /**
   * Types this component ALREADY owns, with their labels.
   *
   * Used to warn — never to block. Two dies on one carton is a real thing, and
   * the model must not out-argue the shop floor.
   */
  existingKeys: readonly { chargeKey: string; label: string | null }[];
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"select" | "economics">("select");
  const [picked, setPicked] = useState<Set<ComponentChargeKey>>(new Set());
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const suggestions =
    SUGGESTED_BY_TYPE[(productTypeLabel ?? "").toLowerCase()] ?? [];

  const ownedCount = (k: ComponentChargeKey) =>
    existingKeys.filter((e) => e.chargeKey === k).length;

  function toggle(k: ComponentChargeKey) {
    setError(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toEconomics() {
    const chosen = [...picked];
    if (chosen.length === 0) return;
    setDrafts(
      chosen.map((key) => ({
        key,
        label: "",
        cost: {},
        recovery: {},
      })),
    );
    setPhase("economics");
  }

  function submit() {
    setError(null);
    startSaving(async () => {
      const outcome = await runGoverned(() =>
        createComponentCharges({
          quoteId,
          quoteLeafId,
          charges: drafts.map((d) => ({
            chargeKey: d.key,
            label: d.label.trim() || null,
            // Every quoted tier, as typed. A blank stays blank rather than
            // becoming "0" here — the action refuses a missing cost, and
            // filling one in on the way would defeat the refusal by supplying
            // the very fact it exists to demand.
            amounts: tiers.map((t) => ({
              tierId: t.id,
              cost: d.cost[t.id] ?? "",
              recoveryAsk: d.recovery[t.id] ?? null,
            })),
          })),
        }),
      );
      const failed = failureMessage(outcome);
      if (failed) {
        setError(failed);
        return;
      }
      onClose();
    });
  }

  if (!mounted) return null;

  const firstTier = tiers[0];

  /**
   * The staging grid, widened by one column per tier.
   *
   * The fixed widths are the Design Authority's — `1fr` for the charge, `108px`
   * for an amount, `132px` for basis. At one tier this is the source's grid
   * exactly; each additional tier repeats the amount column rather than
   * changing any measure.
   */
  const grid = {
    gridTemplateColumns: `1fr ${tiers.map(() => "108px").join(" ")} 108px 132px`,
  } as const;

  const sheet = (
    // The scope class travels to the portal root. `createPortal` mounts outside
    // the React tree's DOM ancestry, so a parent CSS scope does not follow —
    // the escape that left a dialog's canonical classes unresolved before.
    <div className="od032-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="od032-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Add one-time charges"
        data-testid="add-component-charges-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="od032-sheet-head">
          <div className="od032-sheet-head-row">
            <h2>Add one-time charges</h2>
            <span className="od032-step">
              {phase === "select" ? "PHASE 1 · SELECT TYPES" : "PHASE 2 · ENTER ECONOMICS"}
            </span>
          </div>
          <p className="od032-owner">
            Owned by <span className="mono">{componentSku ?? "—"}</span> · {componentName}
          </p>
        </header>

        {phase === "select" ? (
          <div className="od032-sheet-body">
            {suggestions.length > 0 && (
              <div className="od032-suggest">
                <span className="od032-suggest-label">
                  Common on {productTypeLabel?.toLowerCase()}
                </span>
                <span className="od032-chips">
                  {suggestions.map((k) => (
                    <span key={k} className="od032-chip">
                      {COMPONENT_CHARGE_LABELS[k]}
                    </span>
                  ))}
                </span>
                <span className="od032-suggest-note">suggested · never pre-checked</span>
              </div>
            )}

            <ul className="od032-picker">
              {COMPONENT_CHARGE_KEYS.map((k) => {
                const owned = ownedCount(k);
                const on = picked.has(k);
                return (
                  <li key={k}>
                    <button
                      type="button"
                      className="od032-pick"
                      role="checkbox"
                      aria-checked={on}
                      data-testid={`pick-${k}`}
                      onClick={() => toggle(k)}
                    >
                      <span className="od032-box" data-on={on ? "yes" : undefined}>
                        {on ? "✓" : ""}
                      </span>
                      <span className="od032-pick-text">
                        <span className="od032-pick-name">
                          {COMPONENT_CHARGE_LABELS[k]}
                        </span>
                        <span className="od032-pick-hint">{HINT[k]}</span>
                        {/* A WARNING, NOT A BLOCK. Two dies on one carton is a
                            real thing; selecting a type the component already
                            owns offers a second and then requires a distinct
                            label to tell them apart. */}
                        {owned > 0 && (
                          <span className="od032-pick-warn" data-testid={`owned-${k}`}>
                            already has {owned} — adding another needs a distinct label
                          </span>
                        )}
                      </span>
                      <span className="od032-basis">one-time</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <footer className="od032-sheet-foot">
              <span className="od032-count">
                {picked.size} selected · amounts entered next
              </span>
              <span className="od032-spacer" />
              <button type="button" className="od032-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="od032-btn primary"
                disabled={picked.size === 0}
                data-testid="to-economics"
                onClick={toEconomics}
              >
                Enter economics →
              </button>
            </footer>
          </div>
        ) : (
          <div className="od032-sheet-body">
            {/* ── A COLUMN PER TIER ────────────────────────────────────
                The Design Authority draws ONE cost column, headed `Cost · T1`,
                because its mock quote has one tier. Every quoted tier now
                requires an explicit positive cost, so a single column would
                make a multi-tier quote unauthorable — the operator could not
                supply what the save demands.

                So the column repeats per tier and keeps the source's header
                grammar (`Cost · <tier>`) and its measures. A one-tier quote
                renders exactly what the prototype draws. */}
            <div className="od032-econ-head" style={grid}>
              <span>Charge</span>
              {tiers.map((t) => (
                <span key={t.id} className="right">
                  Cost · {t.label}
                </span>
              ))}
              <span className="right">Recovery ask</span>
              <span>Basis</span>
            </div>

            {drafts.map((d, i) => (
              <div
                key={d.key}
                className="od032-econ-row"
                style={grid}
                data-testid={`econ-${d.key}`}
              >
                <div>
                  <div className="od032-pick-name">{COMPONENT_CHARGE_LABELS[d.key]}</div>
                  <div className="od032-pick-hint">{HINT[d.key]}</div>
                  {(labelRequiredFor(d.key) || ownedCount(d.key) > 0) && (
                    <input
                      className="od032-label-input"
                      placeholder={
                        labelRequiredFor(d.key)
                          ? "What is it for? (required)"
                          : "Distinct label (required — this component already has one)"
                      }
                      value={d.label}
                      // Pattern 47(e): `pending` never reaches an input's
                      // disabled attribute. Blocking it mid-save drops focus.
                      onChange={(e) => {
                        const v = e.target.value;
                        setDrafts((p) =>
                          p.map((x, j) => (j === i ? { ...x, label: v } : x)),
                        );
                      }}
                      data-testid={`label-${d.key}`}
                    />
                  )}
                </div>
                {tiers.map((t) => (
                  <input
                    key={t.id}
                    className="od032-amt"
                    inputMode="decimal"
                    // REQUIRED, and said so: every quoted tier needs an
                    // explicit positive cost. A blank is not zero — it means
                    // the operator has not supplied the fact.
                    aria-required="true"
                    placeholder="required"
                    aria-label={`Cost for ${COMPONENT_CHARGE_LABELS[d.key]} at ${t.label}`}
                    value={d.cost[t.id] ?? ""}
                    // Pattern 47(e): `saving` never reaches an input's
                    // disabled attribute — blocking it mid-save drops focus.
                    onChange={(e) => {
                      const v = e.target.value;
                      setDrafts((p) =>
                        p.map((x, j) =>
                          j === i ? { ...x, cost: { ...x.cost, [t.id]: v } } : x,
                        ),
                      );
                    }}
                    data-testid={`cost-${d.key}-${t.id}`}
                  />
                ))}
                <input
                  className="od032-amt"
                  inputMode="decimal"
                  // OPTIONAL, and a blank stays NULL. Zero says the charge
                  // recovers nothing; NULL says nothing governs what it
                  // recovers yet. Different questions, different answers.
                  placeholder="optional"
                  aria-label={`Recovery ask for ${COMPONENT_CHARGE_LABELS[d.key]}`}
                  value={firstTier ? (d.recovery[firstTier.id] ?? "") : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!firstTier) return;
                    setDrafts((p) =>
                      p.map((x, j) =>
                        j === i
                          ? { ...x, recovery: { ...x.recovery, [firstTier.id]: v } }
                          : x,
                      ),
                    );
                  }}
                  data-testid={`recovery-${d.key}`}
                />
                {/* DISPLAYED, not asked. Every component-owned charge is
                    one-time, so a control here would offer a choice that does
                    not exist — but the operator should still see what is being
                    assumed on their behalf. */}
                <span className="od032-basis-cell">one-time</span>
              </div>
            ))}

            <p className="od032-note">
              Recovery placement is not asked here. These rows arrive in
              Commercial Recovery as <span className="mono">unplaced</span>, and
              the send checklist holds until each has a placement. Asking for it
              in this sheet would fuse the two decisions the model keeps apart.
            </p>

            {error && (
              <p className="od032-error" role="alert" data-testid="sheet-error">
                {error}
              </p>
            )}

            <footer className="od032-sheet-foot">
              <button
                type="button"
                className="od032-back"
                onClick={() => setPhase("select")}
              >
                ← Back to types
              </button>
              <span className="od032-spacer" />
              <button
                type="button"
                className="od032-btn primary"
                // Pattern 47(f): action-scoped, and it says why it is disabled.
                disabled={saving}
                aria-busy={saving || undefined}
                title={saving ? "Saving these charges…" : undefined}
                data-testid="submit-charges"
                onClick={submit}
              >
                {saving
                  ? "Adding…"
                  : `Add ${drafts.length} charge${drafts.length === 1 ? "" : "s"}`}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
