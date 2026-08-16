"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteTier,
  setTierRecommended,
  updateTier,
} from "@/app/actions/quotes";

type Tier = {
  id: string;
  label: string;
  qty: number | null;
  recommended: boolean;
};

const DEBOUNCE_MS = 500;

// §6.b path-B migration commit 4 — Tier row renders canonical
// .r7b-tier-row structure (7bsetup.jsx TierRail rows lines 284-300
// + 7bstyles.css .r7b-tier-row rules at line 340).
//
// 4 grid columns per canonical: `1fr 100px 90px 28px` = label · qty
// · adj · actions.
//
// Recommended state:
// - Row gets `.recommended` modifier (canonical CSS adds
//   accent-tinted bg)
// - .label cell stacks .lab (italic display) + .rec (mono caps
//   accent-ink) when recommended=true
// - When recommended=false: hover-revealed "Mark as recommended"
//   affordance in same slot (nexus-specific; canonical has no
//   set affordance in JSX — display-only)
//
// Inline-edit pattern:
// - Label: kept as <input> (brief §3.4 spec) but styled to look
//   like canonical <span class="lab"> at rest. Pattern 29-style
//   transparent-→-focused border.
// - Qty + Price adj: canonical inputs already in JSX.

export function TierRow({
  tier,
  disabled = false,
}: {
  tier: Tier;
  disabled?: boolean;
}) {
  const [label, setLabel] = useState(tier.label);
  const [qty, setQty] = useState(tier.qty == null ? "" : String(tier.qty));
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ label, qty });
  stateRef.current = { label, qty };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{ label: string; qty: string }>;

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
    <div className={`r7b-tier-row${tier.recommended ? " recommended" : ""}`}>
      <div className="label">
        <input
          className="lab"
          value={label}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setLabel(v);
            scheduleLabelQtySave({ label: v });
          }}
          aria-label="Tier label"
        />
        {tier.recommended ? (
          <button
            type="button"
            className="rec rec-clickable"
            onClick={handleToggleRecommended}
            disabled={disabled || pending}
            aria-label="Recommended tier — click to clear"
            title="Recommended tier — click to clear"
          >
            ★ recommended
          </button>
        ) : (
          <button
            type="button"
            className="rec-set"
            onClick={handleToggleRecommended}
            disabled={disabled || pending}
            aria-label="Mark as recommended tier"
            title="Mark as recommended tier (clears siblings)"
          >
            ☆ mark recommended
          </button>
        )}
      </div>
      <div className="qty">
        <input
          type="number"
          min={0}
          step={1}
          placeholder="—"
          value={qty}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setQty(v);
            scheduleLabelQtySave({ qty: v });
          }}
          aria-label="Quantity"
        />
      </div>
      {/* The per-tier price adjustment used to be authored here.
          It is not a second way to do the same thing — it was a SECOND
          AUTHORITY over one column. This input wrote
          `quote_tiers.tier_price_adj_pct` on a debounce, immediately: no
          staging, no preview, no Discard, outside the plan that clears tier
          overrides when the quote-wide rate moves, and outside both staleness
          guards. An operator could change a committed price here and never see
          a chip for it.
          Pricing owns the lever now — staged, previewed against the exact
          state Apply will write, and refused when someone else moved it first.
          The column and its audit action are unchanged; only this door is. */}
      <div className="actions">
        <button
          type="button"
          onClick={handleDelete}
          disabled={disabled}
          title="Remove tier"
          aria-label={`Delete tier ${label}`}
        >
          ×
        </button>
      </div>
      {(saveError || pending) && (
        <div
          style={{
            gridColumn: "1 / -1",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "0.04em",
            marginTop: 2,
          }}
        >
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
