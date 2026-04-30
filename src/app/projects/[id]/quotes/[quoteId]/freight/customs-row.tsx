"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateSkuCustomsData } from "@/app/actions/freight";

const DEBOUNCE_MS = 500;

// Display convention (per CLAUDE.md percent rule): UI shows percent values
// (e.g. "25" for 25%); the action layer divides by 100 to store as decimal
// ("0.2500"). Symmetric on read — DB returns "0.2500" and we render "25"
// (numeric coerce, strip trailing zeros).
function decimalToPercentDisplay(d: string | null): string {
  if (d === null) return "";
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "";
  // Strip trailing zeros: 25.0000 → "25", 12.5 stays "12.5"
  return Number(n.toFixed(4)).toString();
}

export function CustomsRow({
  quoteSkuId,
  cbmPerUnit,
  dutyPct,
  tariffPct,
  disabled,
}: {
  quoteSkuId: string;
  cbmPerUnit: string | null;
  dutyPct: string | null;
  tariffPct: string | null;
  disabled: boolean;
}) {
  const [cbm, setCbm] = useState(cbmPerUnit ?? "");
  const [duty, setDuty] = useState(decimalToPercentDisplay(dutyPct));
  const [tariff, setTariff] = useState(decimalToPercentDisplay(tariffPct));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ cbm, duty, tariff });
  stateRef.current = { cbm, duty, tariff };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{ cbm: string; duty: string; tariff: string }>;

  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    fd.set("cbmPerUnit", s.cbm);
    fd.set("dutyPct", s.duty);
    fd.set("tariffPct", s.tariff);
    startTransition(async () => {
      const r = await updateSkuCustomsData(fd);
      if (!r.ok) setError(r.error.message);
      else setError(null);
    });
  }

  function scheduleSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(overrides), DEBOUNCE_MS);
  }

  // Soft warning if PM types a duty/tariff value < 0.5 (unlikely real-world).
  // Display-only hint; not a save block.
  function lowPctWarn(value: string): string | null {
    if (value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n > 0 && n < 0.5)
      return `Did you mean ${(n * 100).toFixed(0)}%? (Current value: ${n}%)`;
    return null;
  }

  const dutyWarn = lowPctWarn(duty);
  const tariffWarn = lowPctWarn(tariff);

  return (
    <div className="rounded-md border border-gray-200 bg-amber-50/40 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-900">
        <span>Customs / Landed cost</span>
        <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
          Internal — not shown to customer
        </span>
        {pending && <span className="text-[10px] text-gray-500">saving…</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-700">
            CBM per unit
            <span
              className="ml-1 cursor-help text-gray-400"
              title="Cubic meters per single unit. Used to allocate container freight cost across SKUs by volume share."
            >
              ⓘ
            </span>
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              step="0.0001"
              min={0}
              value={cbm}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                setCbm(v);
                scheduleSave({ cbm: v });
              }}
              placeholder="—"
              className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-500">m³</span>
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-700">
            Duty %
            <span
              className="ml-1 cursor-help text-gray-400"
              title="Import duty applied to factory cost. Confirm with freight forwarder for new items."
            >
              ⓘ
            </span>
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={duty}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                setDuty(v);
                scheduleSave({ duty: v });
              }}
              placeholder="—"
              className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-500">%</span>
          </div>
          {dutyWarn && (
            <span className="text-[10px] text-amber-700">{dutyWarn}</span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-700">
            Tariff %
            <span
              className="ml-1 cursor-help text-gray-400"
              title="Country-specific tariff (e.g., Section 301) applied to factory cost. Confirm with freight forwarder for new items."
            >
              ⓘ
            </span>
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={tariff}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                setTariff(v);
                scheduleSave({ tariff: v });
              }}
              placeholder="—"
              className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-500">%</span>
          </div>
          {tariffWarn && (
            <span className="text-[10px] text-amber-700">{tariffWarn}</span>
          )}
        </label>
      </div>
      <p className="mt-2 text-[11px] italic text-gray-500">
        These values are used to compute landed-freight cost. Internal use
        only — not shown to customer.
      </p>
      {error && (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
