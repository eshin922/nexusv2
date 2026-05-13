"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteTier,
  setTierRecommended,
  updateTier,
} from "@/app/actions/quotes";
import { updateTierPriceAdj } from "@/app/actions/costing";

type Tier = {
  id: string;
  label: string;
  qty: number | null;
  recommended: boolean;
  tierPriceAdjPct: string | null;
};

const DEBOUNCE_MS = 500;

// §6.b Step 5 polish-amendment (Edward smoke) — Tier table per
// R7b screenshot fidelity. NOT a 5-column layout with ★ column.
//
// R7b reference (Screenshot 2026-05-12 225751):
// - 3 data columns: TIER · QTY · PRICE ADJ + × action
// - Recommended state renders as inline "★ RECOMMENDED" chip
//   BELOW the tier label cell (not as a separate column header
//   or per-row toggle)
// - Header label "TIER", not "LABEL"
//
// Toggle path:
// - When recommended=true: chip displays under label. Click chip
//   to clear (sets recommended=false).
// - When recommended=false: subtle hover-revealed "Mark as
//   recommended" affordance appears in the same slot. Click to
//   set (action layer clears siblings — one per quote).

export function TierRow({
  tier,
  disabled = false,
}: {
  tier: Tier;
  disabled?: boolean;
}) {
  const [label, setLabel] = useState(tier.label);
  const [qty, setQty] = useState(tier.qty == null ? "" : String(tier.qty));
  const [priceAdj, setPriceAdj] = useState(
    tier.tierPriceAdjPct === null
      ? ""
      : (Number(tier.tierPriceAdjPct) * 100).toString(),
  );

  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ label, qty, priceAdj });
  stateRef.current = { label, qty, priceAdj };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{ label: string; qty: string; priceAdj: string }>;

  function scheduleLabelQtySave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const s = { ...stateRef.current, ...overrides };
      const fd = new FormData();
      fd.set("tierId", tier.id);
      fd.set("label", s.label);
      fd.set("qty", s.qty);
      startTransition(async () => {
        const r = await updateTier(fd);
        if (!r.ok) setSaveError(r.error.message);
        else setSaveError(null);
      });
    }, DEBOUNCE_MS);
  }

  function schedulePriceAdjSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const s = { ...stateRef.current, ...overrides };
      const fd = new FormData();
      fd.set("tierId", tier.id);
      fd.set("tierPriceAdjPct", s.priceAdj);
      startTransition(async () => {
        const r = await updateTierPriceAdj(fd);
        if (!r.ok) setSaveError(r.error.message);
        else setSaveError(null);
      });
    }, DEBOUNCE_MS);
  }

  function handleDelete() {
    if (!confirm(`Delete tier "${label}"?`)) return;
    const fd = new FormData();
    fd.set("tierId", tier.id);
    startTransition(async () => {
      const r = await deleteTier(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function handleToggleRecommended() {
    const fd = new FormData();
    fd.set("tierId", tier.id);
    fd.set("recommended", tier.recommended ? "false" : "true");
    startTransition(async () => {
      const r = await setTierRecommended(fd);
      if (!r.ok) setSaveError(r.error.message);
      else setSaveError(null);
    });
  }

  return (
    <div className="r6b-tier-row">
      <div className="r6b-tier-label-cell">
        <input
          value={label}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setLabel(v);
            scheduleLabelQtySave({ label: v });
          }}
          className="r6b-tier-input r6b-tier-label"
          aria-label="Tier label"
        />
        {tier.recommended ? (
          <button
            type="button"
            onClick={handleToggleRecommended}
            disabled={disabled || pending}
            className="r6b-tier-recommended-chip"
            aria-label="Recommended tier — click to clear"
            title="Recommended tier — click to clear"
          >
            <span aria-hidden style={{ marginRight: 4 }}>
              ★
            </span>
            RECOMMENDED
          </button>
        ) : (
          <button
            type="button"
            onClick={handleToggleRecommended}
            disabled={disabled || pending}
            className="r6b-tier-recommend-set"
            aria-label="Mark as recommended tier"
            title="Mark as recommended tier (clears siblings)"
          >
            <span aria-hidden style={{ marginRight: 4 }}>
              ☆
            </span>
            Mark as recommended
          </button>
        )}
      </div>
      <input
        value={qty}
        type="number"
        min={0}
        step={1}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setQty(v);
          scheduleLabelQtySave({ qty: v });
        }}
        className="r6b-tier-input r6b-tier-numeric"
        aria-label="Quantity"
      />
      <input
        value={priceAdj}
        type="number"
        step="0.01"
        placeholder="—"
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setPriceAdj(v);
          schedulePriceAdjSave({ priceAdj: v });
        }}
        className="r6b-tier-input r6b-tier-numeric"
        aria-label="Per-tier price adjustment percent"
      />
      <button
        type="button"
        onClick={handleDelete}
        disabled={disabled}
        title="Delete tier"
        className="r6b-tier-delete"
        aria-label={`Delete tier ${label}`}
      >
        ×
      </button>
      {(saveError || pending) && (
        <div className="r6b-tier-status">
          {saveError ? (
            <span style={{ color: "var(--bad)" }} role="alert">
              {saveError}
            </span>
          ) : (
            <span style={{ color: "var(--ink-4)" }}>saving…</span>
          )}
        </div>
      )}
    </div>
  );
}
