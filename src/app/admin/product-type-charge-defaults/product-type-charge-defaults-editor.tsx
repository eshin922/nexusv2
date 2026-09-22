"use client";

import { useState, useTransition } from "react";
import {
  saveProductTypeChargeDefaults,
} from "@/app/actions/product-type-charge-defaults";
import type { ProductTypeChargeDefault } from "@/lib/product-type-charge-defaults";
import {
  COMPONENT_CHARGE_KEYS,
  COMPONENT_CHARGE_LABELS,
  type ComponentChargeKey,
} from "@/lib/commercial-recovery/registry";
import type { HubspotProductTypeOption } from "@/lib/hubspot-product-type-vocabulary";

export function ProductTypeChargeDefaultsEditor({
  options,
  rules,
}: {
  options: readonly HubspotProductTypeOption[];
  rules: readonly ProductTypeChargeDefault[];
}) {
  const initial: Record<string, ComponentChargeKey[]> = {};
  for (const rule of rules) {
    (initial[rule.productTypeValue] ??= []).push(rule.chargeKey);
  }
  const [selected, setSelected] = useState(initial);
  const [savedSelections, setSavedSelections] = useState(initial);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingType, setSavingType] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(typeValue: string, chargeKey: ComponentChargeKey) {
    setSelected((current) => {
      const next = new Set(current[typeValue] ?? []);
      if (next.has(chargeKey)) next.delete(chargeKey);
      else next.add(chargeKey);
      return { ...current, [typeValue]: [...next] };
    });
    setSaved((current) => ({ ...current, [typeValue]: false }));
    setErrors((current) => ({ ...current, [typeValue]: "" }));
  }

  function save(typeValue: string) {
    setSavingType(typeValue);
    setErrors((current) => ({ ...current, [typeValue]: "" }));
    startTransition(async () => {
      const result = await saveProductTypeChargeDefaults(
        typeValue,
        selected[typeValue] ?? [],
      );
      setSavingType(null);
      if (!result.ok) {
        setErrors((current) => ({ ...current, [typeValue]: result.error.message }));
        return;
      }
      setSelected((current) => ({ ...current, [typeValue]: result.data.chargeKeys }));
      setSavedSelections((current) => ({ ...current, [typeValue]: result.data.chargeKeys }));
      setSaved((current) => ({ ...current, [typeValue]: true }));
    });
  }

  return (
    <div className="ptcd-list">
      {options.map((option) => {
        const keys = selected[option.value] ?? [];
        const originally = [...(savedSelections[option.value] ?? [])].sort();
        const now = [...keys].sort();
        const dirty = originally.length !== now.length || originally.some((key, i) => key !== now[i]);
        const notes = [...new Set(
          rules
            .filter((rule) => rule.productTypeValue === option.value && rule.note)
            .map((rule) => rule.note),
        )];
        const saving = isPending && savingType === option.value;

        return (
          <section className="ptcd-row" key={option.value}>
            <div className="ptcd-row-head">
              <div>
                <h2>{option.label}</h2>
                <code>{option.value}</code>
              </div>
              <span className={`ptcd-status${keys.length ? " configured" : ""}`}>
                {keys.length ? `${keys.length} suggested` : "Needs review"}
              </span>
            </div>
            {notes.length > 0 && <p className="ptcd-note">{notes.join(" ")}</p>}
            <div className="ptcd-choices" aria-label={`Suggested charges for ${option.label}`}>
              {COMPONENT_CHARGE_KEYS.map((chargeKey) => (
                <label key={chargeKey} className="ptcd-choice">
                  <input
                    type="checkbox"
                    checked={keys.includes(chargeKey)}
                    onChange={() => toggle(option.value, chargeKey)}
                  />
                  <span>{COMPONENT_CHARGE_LABELS[chargeKey]}</span>
                </label>
              ))}
            </div>
            <div className="ptcd-row-foot">
              <span role="status" aria-live="polite">
                {errors[option.value] || (saved[option.value] ? "Saved" : "")}
              </span>
              <button
                type="button"
                className="r5-admin-button"
                disabled={!dirty || saving}
                onClick={() => save(option.value)}
              >
                {saving ? "Saving…" : "Save suggestions"}
              </button>
            </div>
          </section>
        );
      })}
      {options.length === 0 && (
        <p className="ptcd-empty">No Product Type options were returned by HubSpot.</p>
      )}
    </div>
  );
}
