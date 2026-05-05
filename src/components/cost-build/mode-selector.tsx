"use client";

import { useTransition } from "react";
import { setRawsMode } from "@/app/actions/bulk-raw";

// Slice RI.4 — Raws-mode selector per Bulk Raw correction. Three radio
// cards stacked horizontally:
//   - DPS sources raws — DPS purchases the bulk raw inventory; ingredients
//     enter via Bulk Raw section. Cost stack shows RAW row.
//   - CM sources raws — Contract manufacturer sources; raws cost
//     enters via Production section's bulk_raw_cost cell.
//   - Customer supplies raws — Customer ships raws; production covers
//     labor + overhead only. Bulk-raw-cost cells render but are
//     excluded from landed cost.
//
// Mode selection drives:
//   - Bulk Raw section visibility (visible only when dps_sources)
//   - Cost stack RAW row visibility (per Round 6 Change A 6-row composition)
//   - Production drill-down's bulk-raw-cost cell behavior (hint at top
//     of production-drilldown.tsx)

const MODES: Array<{
  value: "cm_sources" | "dps_sources" | "customer_supplies";
  label: string;
  blurb: string;
}> = [
  {
    value: "cm_sources",
    label: "CM sources raws",
    blurb:
      "Contract manufacturer sources the bulk raw inventory. Raws cost enters via Production section's bulk-raw-cost field.",
  },
  {
    value: "dps_sources",
    label: "DPS sources raws",
    blurb:
      "DPS purchases the bulk raw inventory. Ingredients enter via the Bulk Raw section below. Cost stack shows a separate RAW row.",
  },
  {
    value: "customer_supplies",
    label: "Customer supplies raws",
    blurb:
      "Customer ships raws to DPS. Production covers labor + overhead only. Raws cost is excluded from landed cost.",
  },
];

export function ModeSelector({
  quoteId,
  currentMode,
  disabled,
}: {
  quoteId: string;
  currentMode: "cm_sources" | "dps_sources" | "customer_supplies";
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function handleSelect(mode: typeof MODES[number]["value"]) {
    if (disabled || pending || mode === currentMode) return;
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("rawsMode", mode);
    startTransition(async () => {
      await setRawsMode(fd);
    });
  }

  return (
    <fieldset className="rounded border border-rule bg-paper">
      <legend className="px-2 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
        Raws mode
      </legend>
      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-3">
        {MODES.map((m) => {
          const isActive = currentMode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => handleSelect(m.value)}
              disabled={disabled || pending}
              className={`flex flex-col items-start gap-1 rounded border p-3 text-left transition-colors ${
                isActive
                  ? "border-accent bg-accent-soft text-accent-ink"
                  : "border-rule bg-paper text-ink-3 hover:border-rule-2 hover:bg-paper-2"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              aria-pressed={isActive}
            >
              <span
                className={`font-mono text-[10.5px] uppercase tracking-[0.13em] ${
                  isActive ? "text-accent-ink" : "text-ink-3"
                }`}
              >
                {isActive ? "● " : "○ "}
                {m.label}
              </span>
              <span className="text-xs leading-snug">
                {m.blurb}
              </span>
            </button>
          );
        })}
      </div>
      {pending && (
        <div className="border-t border-rule px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-4">
          Saving…
        </div>
      )}
    </fieldset>
  );
}
