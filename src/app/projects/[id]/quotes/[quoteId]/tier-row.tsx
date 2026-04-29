"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteTier, moveTier, updateTier } from "@/app/actions/quotes";

type Tier = {
  id: string;
  label: string;
  qty: number | null;
};

const DEBOUNCE_MS = 500;

export function TierRow({
  tier,
  isFirst,
  isLast,
  disabled = false,
}: {
  tier: Tier;
  isFirst: boolean;
  isLast: boolean;
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

  function fireSave(overrides: Overrides = {}) {
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
  }

  function scheduleSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(overrides), DEBOUNCE_MS);
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

  function handleMove(direction: "up" | "down") {
    const fd = new FormData();
    fd.set("tierId", tier.id);
    fd.set("direction", direction);
    startTransition(async () => {
      const r = await moveTier(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  return (
    <div className="grid grid-cols-[2fr_1fr_auto] items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
      <input
        value={label}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setLabel(v);
          scheduleSave({ label: v });
        }}
        className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
      />
      <input
        value={qty}
        type="number"
        min={0}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setQty(v);
          scheduleSave({ qty: v });
        }}
        className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-1 justify-end">
        {saveError ? (
          <span className="text-xs text-red-700 mr-1" role="alert">
            {saveError}
          </span>
        ) : pending ? (
          <span className="text-xs text-gray-400 mr-1">saving…</span>
        ) : null}
        <button
          type="button"
          onClick={() => handleMove("up")}
          disabled={disabled || isFirst}
          title="Move up"
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => handleMove("down")}
          disabled={disabled || isLast}
          title="Move down"
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={disabled}
          title="Delete tier"
          className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-30"
        >
          ×
        </button>
      </div>
    </div>
  );
}
