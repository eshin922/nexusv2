"use client";

import { useState, useTransition } from "react";
import { updateFirmSettings } from "@/app/actions/firm-settings";
import { validatePercentDecimal } from "@/lib/percent-validation";

// Display convention: percent inputs accept "35" for 35%; the action
// layer divides by 100 to store as decimal. Same rule as freight,
// customs, and global-price-adj inputs.

function decimalToPctDisplay(d: string | null): string {
  if (d === null) return "";
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "";
  // Strip trailing zeros: 35.0000 → 35, 35.5 → 35.5
  return Number(n.toFixed(4)).toString();
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function FirmSettingsForm({
  current,
}: {
  current: {
    targetMarginPct: string;
    floorMarginPct: string;
    effectiveFrom: string;
  } | null;
}) {
  const [target, setTarget] = useState(
    decimalToPctDisplay(current?.targetMarginPct ?? null),
  );
  const [floor, setFloor] = useState(
    decimalToPctDisplay(current?.floorMarginPct ?? null),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function clientValidate(): string | null {
    const tDec = target === "" ? null : Number(target) / 100;
    const fDec = floor === "" ? null : Number(floor) / 100;
    if (tDec === null) return "Target margin is required.";
    if (fDec === null) return "Floor margin is required.";
    const tv = validatePercentDecimal(tDec, "rate");
    if (!tv.valid) return `Target: ${tv.message}`;
    const fv = validatePercentDecimal(fDec, "rate");
    if (!fv.valid) return `Floor: ${fv.message}`;
    if (!(tDec > 0 && tDec < 1))
      return "Target margin must be between 0% and 100%.";
    if (!(fDec > 0 && fDec < 1))
      return "Floor margin must be between 0% and 100%.";
    if (!(fDec < tDec))
      return "Floor margin must be less than target margin.";
    return null;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const v = clientValidate();
    if (v) {
      setError(v);
      return;
    }
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateFirmSettings(fd);
      if (!r.ok) {
        setError(r.error.message);
      } else {
        setSuccess(
          `Saved. New current row effective from ${r.data.effectiveFrom}.`,
        );
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Target margin</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              name="targetMarginPct"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-right text-sm focus:border-slate-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
          <span className="text-xs text-slate-500">
            Quotes below this trigger BELOW_TARGET status.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Floor margin</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              name="floorMarginPct"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              required
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-right text-sm focus:border-slate-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
          <span className="text-xs text-slate-500">
            Quotes below this trigger BELOW_FLOOR status.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Effective from</span>
          <input
            type="date"
            name="effectiveFrom"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">
            Today by default. Prior current row's effective_until is set to
            this date.
          </span>
        </label>
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="r2-btn primary"
          style={{ opacity: pending ? 0.5 : 1 }}
        >
          {pending ? "Saving…" : "Save new version"}
        </button>
        <span className="text-xs text-slate-500">
          Open quote tabs reflect changes after reload.
        </span>
      </div>
    </form>
  );
}
