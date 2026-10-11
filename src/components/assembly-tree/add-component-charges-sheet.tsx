"use client";

/**
 * Associated costs — the Setup sheet for component charges and product services.
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

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  COMPONENT_CHARGE_KEYS,
  COMPONENT_CHARGE_LABELS,
  type ComponentChargeKey,
} from "@/lib/commercial-recovery/registry";
import { createComponentCharges } from "@/app/actions/component-charges";
import { runGoverned, failureMessage } from "@/lib/governed-action";
import { attachQuoteProduct } from "@/app/actions/quote-products";
import { useRouter } from "next/navigation";
import { DIRECT_SERVICE_LABELS } from "@/lib/product-structure/direct-service";
import {
  PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES,
  type ProductAssociableServiceIdentity,
} from "@/lib/product-structure/service-association";

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
  samples: "pre-production samples of this component",
  project_setup: "one-off set-up or changeover for this product's run",
  rd_formulation: "development or formulation work quoted separately",
  other_service: "e.g. foil stamping die spec",
};

export function AddComponentChargesSheet({
  quoteId,
  quoteLeafId,
  componentSku,
  componentName,
  productTypeLabel,
  suggestedKeys,
  associatedServices = [],
  enableAssociatedServices = false,
  suggestedServiceIdentities = [],
  existingServices = [],
  existingKeys,
  onClose,
}: {
  quoteId: string;
  quoteLeafId: string;
  componentSku: string | null;
  componentName: string;
  productTypeLabel: string | null;
  /** Configured by admins against the raw HubSpot Product Type value. */
  suggestedKeys: readonly ComponentChargeKey[];
  associatedServices?: ReadonlyArray<{ id: string; serviceIdentity: string }>;
  enableAssociatedServices?: boolean;
  suggestedServiceIdentities?: readonly ProductAssociableServiceIdentity[];
  existingServices?: ReadonlyArray<{ serviceIdentity: ProductAssociableServiceIdentity; serviceInstanceLabel: string | null }>;
  /**
   * Types this component ALREADY owns, with their labels.
   *
   * Used to warn — never to block. Two dies on one carton is a real thing, and
   * the model must not out-argue the shop floor.
   */
  existingKeys: readonly {
    chargeInstanceId: string;
    chargeKey: string;
    label: string | null;
  }[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Array<{ id: number; key: ComponentChargeKey; note: string }>>([]);
  const [pickedServices, setPickedServices] = useState<Array<{ id: number; identity: ProductAssociableServiceIdentity; note: string }>>([]);
  const nextId = useRef(0);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const suggestions = suggestedKeys;
  // Keep every governed charge available, but make the Product Type
  // association visible in the picker itself. Previously the type only
  // appeared in the summary chip while the rows were rendered as one flat
  // list, which made a configured association look disconnected from the
  // choices it was meant to guide.
  const suggestedSet = new Set<ComponentChargeKey>(suggestions);
  const chargeRows = COMPONENT_CHARGE_KEYS.map((key) => ({
    key,
    suggested: suggestedSet.has(key),
  }));
  const suggestedRows = chargeRows.filter((row) => row.suggested).map((row) => row.key);
  const otherRows = chargeRows.filter((row) => !row.suggested).map((row) => row.key);

  const ownedCount = (k: ComponentChargeKey) =>
    existingKeys.filter((e) => e.chargeKey === k).length;
  /** Labels already in use for this type — what a second one must differ from. */
  const ownedLabels = (k: ComponentChargeKey) =>
    existingKeys
      .filter((e) => e.chargeKey === k)
      .map((e) => e.label)
      .filter((l): l is string => !!l);

  function addCharge(key: ComponentChargeKey) {
    setError(null);
    const id = nextId.current++;
    setPicked((prev) => [...prev, { id, key, note: "" }]);
  }

  function addService(identity: ProductAssociableServiceIdentity) {
    setError(null);
    const id = nextId.current++;
    setPickedServices((prev) => [...prev, { id, identity, note: "" }]);
  }

  /**
   * Why the sheet cannot be submitted yet, or null.
   *
   * The action refuses all of these too, and THAT is the enforcement. This
   * exists so the operator is told before they press a button rather than by a
   * failure afterwards.
   */
  const blocked = (): string | null => {
    const seen = new Set<string>();
    for (const charge of picked) {
      const note = charge.note.trim();
      if (!note) return `Add a note for ${COMPONENT_CHARGE_LABELS[charge.key]} so this cost can be identified.`;
      if (note.length > 120) return "Associated cost notes must be 120 characters or fewer.";
      const key = `${charge.key}\u0000${note.toLowerCase()}`;
      if (seen.has(key) || ownedLabels(charge.key).some((owned) => owned.trim().toLowerCase() === note.toLowerCase())) {
        return `${COMPONENT_CHARGE_LABELS[charge.key]} already has the note "${note}". Give each instance a different note.`;
      }
      seen.add(key);
    }
    const seenServices = new Set<string>();
    for (const service of pickedServices) {
      const note = service.note.trim();
      if (!note) return `Add a note for ${DIRECT_SERVICE_LABELS[service.identity]} so this service can be identified.`;
      if (note.length > 120) return "Associated service notes must be 120 characters or fewer.";
      const key = `${service.identity}\u0000${note.toLowerCase()}`;
      if (seenServices.has(key) || existingServices.some((existing) => existing.serviceIdentity === service.identity && existing.serviceInstanceLabel?.trim().toLowerCase() === note.toLowerCase())) {
        return `${DIRECT_SERVICE_LABELS[service.identity]} already has the note "${note}". Give each instance a different note.`;
      }
      seenServices.add(key);
    }
    return null;
  };

  function submit() {
    setError(null);
    startSaving(async () => {
      if (picked.length > 0) {
        const outcome = await runGoverned(() => createComponentCharges({
          quoteId,
          quoteLeafId,
          // TYPE, OWNER, LABEL. No amounts: this surface does not know what
          // DPS pays and is not the place to ask.
          charges: picked.map((charge) => ({
            chargeKey: charge.key,
            label: charge.note.trim(),
          })),
        }));
        const failed = failureMessage(outcome);
        if (failed) {
          setError(failed);
          return;
        }
        setPicked([]);
      }
      for (const service of pickedServices) {
        const leaf = associatedServices.find((entry) => entry.serviceIdentity === service.identity);
        if (!leaf) {
          setError(`${DIRECT_SERVICE_LABELS[service.identity]} is not available in the service library.`);
          return;
        }
        const formData = new FormData();
        formData.set("quoteId", quoteId);
        formData.set("leafId", leaf.id);
        formData.set("associatedProductQuoteLeafId", quoteLeafId);
        formData.set("serviceInstanceLabel", service.note.trim());
        const result = await attachQuoteProduct(formData);
        if (!result.ok) {
          setError(result.error.message);
          router.refresh();
          return;
        }
        setPickedServices((current) => current.filter((entry) => entry.id !== service.id));
      }
      onClose();
      router.refresh();
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
        aria-label="Add associated costs"
        data-testid="add-component-charges-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="od032-sheet-head">
          <div className="od032-sheet-head-row">
            <h2>Add associated costs</h2>
            <span className="od032-step">SELECT TYPES</span>
          </div>
          <p className="od032-owner">
            Owned by <span className="mono">{componentSku ?? "—"}</span> · {componentName}
          </p>
          <p className="od032-owner">Add as many costs as needed. Give each one a short note to distinguish its costing line.</p>
        </header>

        <div className="od032-sheet-body">
          {suggestions.length > 0 ? (
            <div className="od032-suggest">
              <span className="od032-suggest-label">
                Common on {productTypeLabel ?? "this product type"}
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
          ) : (
            <div className="od032-suggest" data-testid="charge-suggestions-needs-review">
              <span className="od032-suggest-label">
                {productTypeLabel
                  ? `No charge suggestions are configured for ${productTypeLabel}.`
                  : "This product has no HubSpot Product Type."}
              </span>
              <span className="od032-suggest-note">
                needs review · existing quote charges are unchanged
              </span>
            </div>
          )}

          <ul className="od032-picker">
            {suggestedRows.length > 0 && (
              <li className="od032-picker-section" aria-hidden="true">
                <span>Suggested for {productTypeLabel ?? "this product type"}</span>
              </li>
            )}
            {[...suggestedRows, ...otherRows].map((k, index) => {
              const owned = ownedCount(k);
              const selected = picked.filter((charge) => charge.key === k);
              return (
                <Fragment key={k}>
                  {index === suggestedRows.length && suggestedRows.length > 0 && (
                    <li className="od032-picker-section od032-picker-section-secondary" aria-hidden="true">
                      <span>All other charge types</span>
                    </li>
                  )}
                <li data-suggested={suggestedSet.has(k) ? "yes" : undefined}>
                  <button
                    type="button"
                    className="od032-pick"
                    data-testid={`pick-${k}`}
                    onClick={() => addCharge(k)}
                  >
                    <span className="od032-add-symbol" aria-hidden="true">+</span>
                    <span className="od032-pick-text">
                      <span className="od032-pick-name">
                        {COMPONENT_CHARGE_LABELS[k]}
                      </span>
                      {suggestedSet.has(k) && (
                        <span className="od032-pick-suggested">common on this type</span>
                      )}
                      <span className="od032-pick-hint">{HINT[k]}</span>
                      {/* A WARNING, NOT A BLOCK. Two dies on one carton is a
                          real thing; selecting a type the component already
                          owns offers a second and then requires a distinct
                          label to tell them apart. */}
                      {owned > 0 && (
                        <span className="od032-pick-warn" data-testid={`owned-${k}`}>
                          {/* NAMES what is already there. "Adding another needs
                              a distinct label" states a rule; the labels state
                              what to be distinct FROM, which is the thing the
                              operator actually has to decide. */}
                          already has {owned}
                          {ownedLabels(k).length > 0
                            ? ` (${ownedLabels(k).join(", ")})`
                            : ""}{" "}
                          — add another with its own note
                        </span>
                      )}
                    </span>
                    <span className="od032-basis">one-time</span>
                  </button>

                  {selected.map((charge, chargeIndex) => (
                    <div className="od032-instance-row" key={charge.id}>
                      <input
                        className="od032-label-input"
                        placeholder={`Note for ${COMPONENT_CHARGE_LABELS[k]} #${chargeIndex + 1}`}
                        aria-label={`Note for ${COMPONENT_CHARGE_LABELS[k]} #${chargeIndex + 1}`}
                        value={charge.note}
                        maxLength={120}
                        onChange={(event) => setPicked((current) => current.map((entry) => entry.id === charge.id ? { ...entry, note: event.target.value } : entry))}
                        data-testid={`label-${k}-${chargeIndex}`}
                      />
                      <button type="button" className="od032-btn" aria-label={`Remove ${COMPONENT_CHARGE_LABELS[k]} #${chargeIndex + 1}`} onClick={() => setPicked((current) => current.filter((entry) => entry.id !== charge.id))}>Remove</button>
                    </div>
                  ))}
                </li>
                </Fragment>
              );
            })}
          </ul>

          {enableAssociatedServices && (
            <ul className="od032-picker" aria-label="Production services for this product">
              <li className="od032-picker-section" aria-hidden="true">
                <span>Production services · separate NetSuite lines</span>
              </li>
              {PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES.map((identity) => {
                const available = associatedServices.some((service) => service.serviceIdentity === identity);
                const owned = existingServices.filter((service) => service.serviceIdentity === identity);
                const selected = pickedServices.filter((service) => service.identity === identity);
                return (
                  <li key={identity}>
                    <button
                      type="button"
                      className="od032-pick"
                      disabled={!available}
                      onClick={() => addService(identity)}
                    >
                      <span className="od032-add-symbol" aria-hidden="true">+</span>
                      <span className="od032-pick-text">
                        <span className="od032-pick-name">{DIRECT_SERVICE_LABELS[identity]}</span>
                        {suggestedServiceIdentities.includes(identity) && <span className="od032-pick-suggested">common on this type</span>}
                        <span className="od032-pick-hint">{available ? `${owned.length} already attached · each added service gets its own cost line` : "Unavailable in the service library"}</span>
                      </span>
                      <span className="od032-basis">service line</span>
                    </button>
                    {selected.map((service, serviceIndex) => (
                      <div className="od032-instance-row" key={service.id}>
                        <input
                          className="od032-label-input"
                          aria-label={`Note for ${DIRECT_SERVICE_LABELS[identity]} #${serviceIndex + 1}`}
                          placeholder={`Note for ${DIRECT_SERVICE_LABELS[identity]} #${serviceIndex + 1}`}
                          value={service.note}
                          maxLength={120}
                          onChange={(event) => setPickedServices((current) => current.map((entry) => entry.id === service.id ? { ...entry, note: event.target.value } : entry))}
                        />
                        <button type="button" className="od032-btn" aria-label={`Remove ${DIRECT_SERVICE_LABELS[identity]} #${serviceIndex + 1}`} onClick={() => setPickedServices((current) => current.filter((entry) => entry.id !== service.id))}>Remove</button>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}

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

          {/* Said on the surface, not only in the button's title. Pattern 47(f):
              a disabled control must communicate why, and hover-to-discover is
              a navigation pattern rather than a presentation one. */}
          {blocked() !== null && !error && (
            <p className="od032-error" data-testid="sheet-blocked">
              {blocked()}
            </p>
          )}
          {error && (
            <p className="od032-error" role="alert" data-testid="sheet-error">
              {error}
            </p>
          )}

          <footer className="od032-sheet-foot">
            <span className="od032-count">
              {picked.length + pickedServices.length} selected · cost is entered on Costs
            </span>
            <span className="od032-spacer" />
            <button type="button" className="od032-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="od032-btn primary"
              // Pattern 47(f): action-scoped, and it says why it is disabled.
              disabled={picked.length + pickedServices.length === 0 || saving || blocked() !== null}
              aria-busy={saving || undefined}
              title={
                saving
                  ? "Adding these charges…"
                  : picked.length + pickedServices.length === 0
                    ? "Select at least one associated cost."
                    : (blocked() ?? undefined)
              }
              data-testid="submit-charges"
              onClick={submit}
            >
              {saving
                ? "Adding…"
                : `Add ${picked.length + pickedServices.length} associated cost${picked.length + pickedServices.length === 1 ? "" : "s"}`}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
