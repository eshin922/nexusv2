"use client";

import { useTransition } from "react";
import { setRawsMode } from "@/app/actions/bulk-raw";

// Slice RI.4 — Raws-mode selector per Bulk Raw correction +
// R6 visual register (Designer audit M-3, M-4):
//   - Segmented control (single rounded outer container with internal
//     dividers), NOT three separate cards
//   - Active state: green-themed (anchors mode to the cost stack's
//     RAW color family) — 3px left inset shadow + green-soft bg fill
//
// Three modes:
//   - DPS sources raws — DPS purchases bulk raw inventory; ingredients
//     enter via Bulk Raw section; cost stack shows RAW row
//   - CM sources raws — CM sources; raws cost enters via Production's
//     bulk_raw_cost cell
//   - Customer supplies raws — Customer ships raws; production covers
//     labor + overhead only

const MODES: Array<{
  value: "cm_sources" | "dps_sources" | "customer_supplies";
  label: string;
  blurb: string;
}> = [
  {
    value: "cm_sources",
    label: "CM sources raws",
    blurb:
      "Contract manufacturer sources the bulk raw inventory. Raws cost enters via Production's bulk-raw-cost field.",
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
      "Customer ships raws to DPS. Production covers labor + overhead only. Raws cost excluded from landed cost.",
  },
];

const RAW_GREEN = "oklch(0.55 0.10 145)";
const RAW_GREEN_SOFT = "oklch(0.55 0.10 145 / 0.08)";
const RAW_GREEN_INK = "oklch(0.42 0.10 145)";

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
    <fieldset className="overflow-hidden rounded-[10px] border border-rule bg-paper">
      <legend className="px-2 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
        Raws mode
      </legend>
      <div className="grid grid-cols-1 sm:grid-cols-3">
        {MODES.map((m, i) => {
          const isActive = currentMode === m.value;
          const notLast = i < MODES.length - 1;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => handleSelect(m.value)}
              disabled={disabled || pending}
              className={`relative flex flex-col items-start gap-1.5 p-3.5 text-left transition-colors ${
                notLast ? "sm:border-r border-rule" : ""
              } ${
                isActive ? "" : "hover:bg-paper-2"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              style={
                isActive
                  ? {
                      background: RAW_GREEN_SOFT,
                      boxShadow: `inset 3px 0 0 ${RAW_GREEN}`,
                    }
                  : undefined
              }
              aria-pressed={isActive}
            >
              <span
                className="font-mono text-[10.5px] uppercase tracking-[0.13em]"
                style={{
                  color: isActive ? RAW_GREEN_INK : "var(--ink-3)",
                }}
              >
                {isActive ? "● " : "○ "}
                {m.label}
              </span>
              <span
                className="text-xs leading-snug"
                style={{
                  color: isActive ? RAW_GREEN_INK : "var(--ink-3)",
                }}
              >
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
