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

// §6.b Step 5 — Tier table parallel register per R7b designer notes
// §3.4 / Decision 5 ("SKU × Tier coupled register"). 5-column row:
// Tier label · ★ Recommended · Qty · Price adj % · ×.
//
// Inline-edit cells follow R7b's transparent-border-→-focused-border
// pattern (always-input mode), not the read↔edit pattern (Pattern 29)
// used for SKU retail bench. Rationale: tier rows are short (3-4
// items max) and frequently edited; read-mode would add click
// overhead. SKU rows can be 20+ items and rarely-edited per cell —
// read↔edit fits there.
//
// ★ Recommended toggle calls setTierRecommended which clears
// siblings (one per quote invariant; Pattern 22 #7).
// Price adj % writes via Slice 9.2's existing updateTierPriceAdj.
// Label + Qty write via updateTier.
//
// Footer "+ Add tier" lives on the parent Section, not per-row.
// ↑↓ row reordering dropped per brief §3.4 column list (× only);
// existing moveTier action retained but no UI surface.

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
      : // numeric(5,4) stored as decimal (0.0250 = 2.5%);
        // surface as percent string for the inline input
        (Number(tier.tierPriceAdjPct) * 100).toString(),
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

  function handleStarToggle() {
    const fd = new FormData();
    fd.set("tierId", tier.id);
    // Toggle: set true if not currently recommended, false if currently set
    fd.set("recommended", tier.recommended ? "false" : "true");
    startTransition(async () => {
      const r = await setTierRecommended(fd);
      if (!r.ok) setSaveError(r.error.message);
      else setSaveError(null);
    });
  }

  return (
    <div className="r6b-tier-row">
      <input
        value={label}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setLabel(v);
          scheduleLabelQtySave({ label: v });
        }}
        className="r6b-tier-input"
        aria-label="Tier label"
      />
      <button
        type="button"
        onClick={handleStarToggle}
        disabled={disabled || pending}
        aria-pressed={tier.recommended}
        aria-label={
          tier.recommended
            ? "Recommended tier (click to clear)"
            : "Mark as recommended tier"
        }
        title={
          tier.recommended
            ? "Recommended tier — click to clear"
            : "Mark as recommended tier (clears siblings)"
        }
        className="r6b-tier-star"
        data-active={tier.recommended ? "true" : "false"}
      >
        ★
      </button>
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
        className="r6b-tier-input"
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
        className="r6b-tier-input"
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
