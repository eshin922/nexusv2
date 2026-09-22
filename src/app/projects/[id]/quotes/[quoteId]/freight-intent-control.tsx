"use client";

import { useState, useTransition } from "react";
import { updateQuoteFreightIntent } from "@/app/actions/quotes";
import type { QuoteFreightIntent } from "@/db/schema";

const OPTIONS: { value: QuoteFreightIntent; label: string }[] = [
  { value: "include", label: "Include" },
  { value: "exclude", label: "Exclude" },
  { value: "undecided", label: "Decide later" },
];

export function FreightIntentControl({
  quoteId,
  initialValue,
  disabled,
}: {
  quoteId: string;
  initialValue: QuoteFreightIntent;
  disabled: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: QuoteFreightIntent) {
    if (disabled || pending || next === value) return;
    const formData = new FormData();
    formData.set("quoteId", quoteId);
    formData.set("freightIntent", next);
    startTransition(async () => {
      const result = await updateQuoteFreightIntent(formData);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setValue(result.data.freightIntent);
      setError(null);
    });
  }

  const status = value === "include" ? "included" : value === "exclude" ? "excluded" : "not decided";

  return (
    <div className="r7b-card setup-freight-card">
      <div className="setup-freight-card-head">
        <div className="text-[12.5px] font-medium text-ink">Does DPS need to arrange or quote freight?</div>
        <span aria-live="polite" className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${value === "undecided" ? "border-warn bg-warn-soft text-warn" : "border-rule bg-paper-3 text-ink-3"}`}>
          {pending ? "saving" : status}
        </span>
      </div>
      <div className="setup-freight-card-body">
      <div className="setup-freight-options" role="group" aria-label="Freight intention">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            disabled={disabled || pending}
            onClick={() => choose(option.value)}
            className={`setup-freight-option ${value === option.value ? "is-selected" : ""}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-[9px] text-[11.5px] leading-relaxed text-ink-4">One intention for the whole quote. Carriers, destinations, rates and terms are not asked here.</p>
      {error && <p role="alert" className="mt-1 text-xs text-warn">{error}</p>}
      </div>
    </div>
  );
}
