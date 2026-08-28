"use client";

/**
 * Add one-time charges — the Setup sheet.
 *
 * Pattern 30: the geometry, copy and register are the Design Authority's, taken
 * from `Nexus OD-032 Round Trip` §03 rather than interpreted from a screenshot.
 * Where this diverges it is recorded at the divergence, not in a changelog.
 *
 * ── WHAT THIS SHEET ANSWERS, AND WHAT IT DOES NOT ───────────────────────
 *
 *   Setup    what does this component require?   ← this sheet
 *   Costs    what does DPS pay?
 *   Recovery how does DPS recover it?
 *
 * So it collects a charge's TYPE, its causal COMPONENT, and a LABEL where one
 * is needed to tell two charges of a type apart. That is the whole of the
 * structural fact, and it is exactly the shape of a `quote_charge_instances`
 * row — the split falls on a table boundary rather than across one.
 *
 * ── IT ASKED FOR COST, AND THAT WAS THE BOUNDARY ERROR ──────────────────
 *
 * It used to have a second phase collecting per-tier cost and a recovery ask.
 * Structurally tidy — pick the types together, price them together — and it
 * put economics on the surface that defines structure. What DPS pays is a
 * Costs question, answered on Costs, where the operator has the rest of the
 * cost picture in front of them rather than a modal opened from a tree.
 *
 * A charge therefore arrives here with NO economics, which is an expected
 * intermediate state and not an error: readiness reports it, Costs is where it
 * is completed, and send refuses the quote until it is. Setup is not blocked
 * for creating one.
 *
 * ── AND IT NEVER ASKED FOR PLACEMENT ────────────────────────────────────
 *
 * Rows arrive in Commercial Recovery as `unplaced` and the send checklist holds
 * until each has one. Asking here would fuse decisions the model keeps apart.
 *
 * Basis is `one_time` for every component-owned charge — "no exceptions, and
 * the sheet never asks". It is DISPLAYED, because the operator should see what
 * is being assumed on their behalf; it is not a control.
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

export function AddComponentChargesSheet({
  quoteId,
  quoteLeafId,
  componentSku,
  componentName,
  productTypeLabel,
  existingKeys,
  onClose,
}: {
  quoteId: string;
  quoteLeafId: string;
  componentSku: string | null;
  componentName: string;
  productTypeLabel: string | null;
  /**
   * Types this component ALREADY owns, with their labels.
   *
   * Used to warn — never to block. Two dies on one carton is a real thing, and
   * the model must not out-argue the shop floor.
   */
  existingKeys: readonly { chargeKey: string; label: string | null }[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<ComponentChargeKey>>(new Set());
  /** Per type, as typed. Only read for the types that need one. */
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const suggestions =
    SUGGESTED_BY_TYPE[(productTypeLabel ?? "").toLowerCase()] ?? [];

  const ownedCount = (k: ComponentChargeKey) =>
    existingKeys.filter((e) => e.chargeKey === k).length;

  /** A label is demanded by the type itself, or by a collision with one the
   *  component already has. Two charges of a type are told apart by their
   *  labels, so a second one without one would collapse into the first. */
  const needsLabel = (k: ComponentChargeKey) =>
    labelRequiredFor(k) || ownedCount(k) > 0;

  function toggle(k: ComponentChargeKey) {
    setError(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function submit() {
    setError(null);
    startSaving(async () => {
      const outcome = await runGoverned(() =>
        createComponentCharges({
          quoteId,
          quoteLeafId,
          // TYPE, OWNER, LABEL. No amounts: this surface does not know what
          // DPS pays and is not the place to ask.
          charges: [...picked].map((key) => ({
            chargeKey: key,
            label: labels[key]?.trim() || null,
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
            <span className="od032-step">SELECT TYPES</span>
          </div>
          <p className="od032-owner">
            Owned by <span className="mono">{componentSku ?? "—"}</span> · {componentName}
          </p>
        </header>

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

                  {/* ── THE LABEL, WHERE THE TYPE IS ────────────────────────
                      It used to live in the economics phase, which is where it
                      happened to fit rather than where it belongs: a label is
                      part of a charge's IDENTITY, and identity is what this
                      surface owns. It appears under the type it names, the
                      moment that type is picked. */}
                  {on && needsLabel(k) && (
                    <input
                      className="od032-label-input"
                      placeholder={
                        labelRequiredFor(k)
                          ? "What is it for? (required)"
                          : "Distinct label (required — this component already has one)"
                      }
                      aria-label={`Label for ${COMPONENT_CHARGE_LABELS[k]}`}
                      value={labels[k] ?? ""}
                      // Pattern 47(e): `saving` never reaches an input's
                      // disabled attribute. Blocking it mid-save drops focus.
                      onChange={(e) => {
                        const v = e.target.value;
                        setLabels((p) => ({ ...p, [k]: v }));
                      }}
                      data-testid={`label-${k}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {/* WHERE THE REST OF THE ANSWER IS GIVEN. The operator has just said
              what this component requires and is entitled to know what happens
              to it next — otherwise a charge created with no cost reads as an
              omission rather than as the intermediate state it is. */}
          <p className="od032-note">
            Cost is entered on <span className="mono">Costs</span>, beneath this
            component, for every quoted tier. Recovery is decided in{" "}
            <span className="mono">Commercial recovery</span> once the cost is
            complete. The quote cannot be sent until both are done.
          </p>

          {error && (
            <p className="od032-error" role="alert" data-testid="sheet-error">
              {error}
            </p>
          )}

          <footer className="od032-sheet-foot">
            <span className="od032-count">
              {picked.size} selected · cost is entered on Costs
            </span>
            <span className="od032-spacer" />
            <button type="button" className="od032-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="od032-btn primary"
              // Pattern 47(f): action-scoped, and it says why it is disabled.
              disabled={picked.size === 0 || saving}
              aria-busy={saving || undefined}
              title={
                saving
                  ? "Adding these charges…"
                  : picked.size === 0
                    ? "Select at least one type of charge."
                    : undefined
              }
              data-testid="submit-charges"
              onClick={submit}
            >
              {saving
                ? "Adding…"
                : `Add ${picked.size} charge${picked.size === 1 ? "" : "s"}`}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
