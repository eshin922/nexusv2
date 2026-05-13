"use client";

// §6.b Step 6 — Tier preset picker (R7b §3.5).
//
// Renders the empty-state preset card grid INSIDE the tier card,
// between the .r7b-card-head and the .r7b-tier-footer. Click a
// preset → tiers populate via applyTierPreset → picker collapses
// (component unmounts on next render because tiers.length > 0).
//
// Canonical structure (r7b-setup.css L422-446 + 7bsetup.jsx L264-274):
//   .r7b-presets
//     h6 "Start with a preset"
//     .r7b-presets-grid (2x2)
//       .r7b-preset × 4
//         .lab — preset label
//         .desc — comma-separated tier qtys
//
// Adding a 4th tier to a 3-tier preset does NOT re-show the picker
// (brief §3.5) — the picker is keyed strictly on count === 0.

import { useTransition } from "react";
import { applyTierPreset } from "@/app/actions/quotes";

type Preset = {
  id: "pst_3step" | "pst_4step" | "pst_first" | "pst_volume";
  label: string;
  desc: string;
};

const PRESETS: Preset[] = [
  { id: "pst_3step", label: "3-tier step", desc: "5k · 10k · 25k" },
  { id: "pst_4step", label: "4-tier step", desc: "5k · 10k · 25k · 50k" },
  { id: "pst_first", label: "First-PO", desc: "10k single tier" },
  { id: "pst_volume", label: "Volume break", desc: "10k · 50k · 100k" },
];

export function TierPresetPicker({
  quoteId,
  disabled,
}: {
  quoteId: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function applyPreset(id: Preset["id"]) {
    if (disabled || pending) return;
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("preset", id);
    startTransition(async () => {
      await applyTierPreset(fd);
    });
  }

  return (
    <div className="r7b-presets" aria-busy={pending || undefined}>
      <h6>Start with a preset</h6>
      <div className="r7b-presets-grid">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="r7b-preset"
            onClick={() => applyPreset(p.id)}
            disabled={disabled || pending}
            style={{
              textAlign: "left",
              font: "inherit",
              color: "inherit",
              width: "100%",
            }}
            title={`${p.label} — ${p.desc}`}
          >
            <div className="lab">{p.label}</div>
            <div className="desc">{p.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
