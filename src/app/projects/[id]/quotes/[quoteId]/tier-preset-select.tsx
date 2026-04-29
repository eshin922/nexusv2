"use client";

import { useRef, useTransition } from "react";
import { applyTierPreset } from "@/app/actions/quotes";

const PRESETS = [
  { value: "single_volume", label: "Single Volume" },
  { value: "reorder", label: "Reorder" },
  { value: "packaging_domestic", label: "Packaging — Domestic (5k/10k/25k/50k)" },
  { value: "packaging_overseas", label: "Packaging — Overseas (25k/50k/100k/250k)" },
  { value: "soft_goods", label: "Soft Goods (1k/5k/10k)" },
  { value: "custom", label: "Custom (start blank)" },
];

export function TierPresetSelect({
  quoteId,
  existingTierCount,
}: {
  quoteId: string;
  existingTierCount: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form ref={formRef} action={applyTierPreset} className="inline-flex items-center gap-2">
      <input type="hidden" name="quoteId" value={quoteId} />
      <select
        name="preset"
        disabled={pending}
        defaultValue=""
        onChange={(e) => {
          if (!e.currentTarget.value) return;
          if (
            existingTierCount > 0 &&
            !confirm(
              `Apply preset? This will delete the ${existingTierCount} existing tier${
                existingTierCount === 1 ? "" : "s"
              } and replace them.`,
            )
          ) {
            e.currentTarget.value = "";
            return;
          }
          startTransition(() => formRef.current?.requestSubmit());
        }}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-gray-500 focus:outline-none disabled:opacity-50"
      >
        <option value="" disabled>
          Apply preset…
        </option>
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-gray-500">applying…</span>}
    </form>
  );
}
