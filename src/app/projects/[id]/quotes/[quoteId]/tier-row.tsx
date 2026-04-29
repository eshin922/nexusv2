"use client";

import { useRef, useState } from "react";
import { deleteTier, moveTier, updateTier } from "@/app/actions/quotes";

type Tier = {
  id: string;
  label: string;
  qty: number | null;
};

export function TierRow({
  tier,
  isFirst,
  isLast,
}: {
  tier: Tier;
  isFirst: boolean;
  isLast: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);

  const initialRef = useRef<Record<string, string>>({
    label: tier.label,
    qty: tier.qty == null ? "" : String(tier.qty),
  });

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const name = e.currentTarget.name;
    const value = e.currentTarget.value;
    if (initialRef.current[name] !== value) {
      initialRef.current[name] = value;
      setSaving(true);
      formRef.current?.requestSubmit();
      setTimeout(() => setSaving(false), 600);
    }
  }

  return (
    <form
      ref={formRef}
      action={updateTier}
      className="grid grid-cols-[2fr_1fr_auto] items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
    >
      <input type="hidden" name="tierId" value={tier.id} />
      <input
        name="label"
        defaultValue={tier.label}
        onBlur={handleBlur}
        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-gray-300 focus:bg-white focus:outline-none"
      />
      <input
        name="qty"
        type="number"
        min={0}
        defaultValue={tier.qty == null ? "" : String(tier.qty)}
        placeholder="—"
        onBlur={handleBlur}
        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-gray-300 focus:bg-white focus:outline-none"
      />
      <div className="flex items-center gap-1 justify-end">
        {saving && <span className="text-xs text-gray-400 mr-1">saving…</span>}
        <button
          type="submit"
          formAction={moveTier}
          name="direction"
          value="up"
          disabled={isFirst}
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="submit"
          formAction={moveTier}
          name="direction"
          value="down"
          disabled={isLast}
          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-white"
          title="Move down"
        >
          ↓
        </button>
        <button
          type="submit"
          formAction={deleteTier}
          onClick={(e) => {
            if (!confirm(`Delete tier "${tier.label}"?`)) e.preventDefault();
          }}
          className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50"
          title="Delete tier"
        >
          ×
        </button>
      </div>
    </form>
  );
}
