"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateQuoteLandedPresentation } from "@/app/actions/quotes";
import { runGoverned } from "@/lib/governed-action";

export function LandedPresentationControl({ quoteId, initialValue, disabled }: {
  quoteId: string;
  initialValue: "amortized" | "separate";
  disabled: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function choose(next: "amortized" | "separate") {
    if (pending || disabled || next === value) return;
    const form = new FormData();
    form.set("quoteId", quoteId);
    form.set("landedPresentation", next);
    startTransition(async () => {
      const result = await runGoverned(() => updateQuoteLandedPresentation(form));
      if (result.kind !== "ok") { setError(result.message); return; }
      setValue(result.data.landedPresentation);
      setError(null);
      router.refresh();
    });
  }
  return (
    <div className="cv-gov-row" style={{ display: "block" }}>
      <div className="cv-gov-k" style={{ marginBottom: 6 }}>Freight, duty &amp; tariff on customer quote</div>
      <div role="group" aria-label="Landed logistics presentation" style={{ display: "flex", gap: 6 }}>
        <button type="button" disabled={disabled || pending} aria-pressed={value === "amortized"}
          onClick={() => choose("amortized")}
          className={`setup-freight-option ${value === "amortized" ? "is-selected" : ""}`}>
          In unit prices
        </button>
        <button type="button" disabled={disabled || pending} aria-pressed={value === "separate"}
          onClick={() => choose("separate")}
          className={`setup-freight-option ${value === "separate" ? "is-selected" : ""}`}>
          Separate by SKU
        </button>
      </div>
      {pending && <p aria-live="polite">Updating quote…</p>}
      {error && <p role="alert" className="text-warn">{error}</p>}
    </div>
  );
}
