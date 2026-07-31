"use client";

import { useState, useTransition } from "react";
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
  existingPackagingLineCount,
  existingProductionCellsWithData,
  existingFreightLineCount,
  existingFreightCellsWithData,
}: {
  quoteId: string;
  existingTierCount: number;
  existingPackagingLineCount: number;
  existingProductionCellsWithData: number;
  existingFreightLineCount: number;
  existingFreightCellsWithData: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.currentTarget.value;
    if (!v) return;
    if (existingTierCount > 0) {
      const tierMsg = `${existingTierCount} existing tier${
        existingTierCount === 1 ? "" : "s"
      }`;
      const lineMsg =
        existingPackagingLineCount > 0
          ? `\n\nUnit costs on ${existingPackagingLineCount} packaging line${
              existingPackagingLineCount === 1 ? "" : "s"
            } will reset (line metadata — pricing provenance, legacy supplier, category, markup — is preserved).`
          : "";
      const productionMsg =
        existingProductionCellsWithData > 0
          ? `\n\nCost data on ${existingProductionCellsWithData} production cell${
              existingProductionCellsWithData === 1 ? "" : "s"
            } will reset (per-SKU policy — customer ships raws, allocate service fees, notes — is preserved). Forensic snapshot saved to audit log.`
          : "";
      const freightMsg =
        existingFreightCellsWithData > 0
          ? `\n\nPer-tier costs on ${existingFreightCellsWithData} freight cell${
              existingFreightCellsWithData === 1 ? "" : "s"
            } across ${existingFreightLineCount} line${
              existingFreightLineCount === 1 ? "" : "s"
            } will reset (line metadata — pricing provenance, legacy supplier, mode, markup, treatment, notes — is preserved). Forensic snapshot saved to audit log.`
          : existingFreightLineCount > 0
            ? `\n\n${existingFreightLineCount} freight line${
                existingFreightLineCount === 1 ? "" : "s"
              } preserved (no per-tier cost data yet).`
            : "";
      if (
        !confirm(
          `Replace ${tierMsg} with preset?${lineMsg}${productionMsg}${freightMsg}`,
        )
      ) {
        setSelected("");
        return;
      }
    }
    setSelected(v);
    setError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("preset", v);
    startTransition(async () => {
      const result = await applyTierPreset(fd);
      if (!result.ok) setError(result.error.message);
      setSelected("");
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <select
        value={selected}
        onChange={handleChange}
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
      {error && (
        <span className="text-xs text-red-700" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
