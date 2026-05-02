"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateSkuCustomsData } from "@/app/actions/freight";
import { useCostingStore } from "@/components/costing-store-provider";
import { HelpTooltip } from "@/components/help-tooltip";
import { selectUpdateCustoms } from "@/lib/costing-store";
import { validatePercentDecimal } from "@/lib/percent-validation";

const DEBOUNCE_MS = 500;

// Display convention (per CLAUDE.md percent rule): UI shows percent values
// (e.g. "25" for 25%); the action layer divides by 100 to store as decimal
// ("0.2500"). Symmetric on read — DB returns "0.2500" and we render "25"
// (numeric coerce, strip trailing zeros).
function decimalToPercentDisplay(d: string | null): string {
  if (d === null) return "";
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "";
  return Number(n.toFixed(4)).toString();
}

// Slice 8 schema correction: cbm_per_unit was dropped from quote_skus
// (it didn't match PM workflow). CBM is now captured per-(SKU, line, tier)
// on freight_inputs.sku_total_cbm — see freight-line-row.tsx.
export function CustomsRow({
  quoteSkuId,
  dutyPct,
  tariffPct,
  disabled,
}: {
  quoteSkuId: string;
  dutyPct: string | null;
  tariffPct: string | null;
  disabled: boolean;
}) {
  const [duty, setDuty] = useState(decimalToPercentDisplay(dutyPct));
  const [tariff, setTariff] = useState(decimalToPercentDisplay(tariffPct));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Per-field validation errors (separate from the shared save error
  // so a duty validation failure doesn't blank out a tariff save error).
  const [dutyError, setDutyError] = useState<string | null>(null);
  const [tariffError, setTariffError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ duty, tariff });
  stateRef.current = { duty, tariff };

  // Slice 8 sub-step 5: optimistic store push on every onChange. Server
  // save still fires on debounce; reconcile from server settles ~700ms
  // later (server-wins overwrite handles any drift).
  const updateCustoms = useCostingStore(selectUpdateCustoms);

  // Validate a percent input (display value, e.g. "25" for 25%).
  // Returns the normalized decimal on success or null on empty input;
  // returns undefined on validation failure (caller should bail).
  function validatePctInput(
    v: string,
    setFieldError: (msg: string | null) => void,
  ): number | null | undefined {
    if (v === "") {
      setFieldError(null);
      return null;
    }
    const decimal = Number(v) / 100;
    const r = validatePercentDecimal(decimal, "rate");
    if (!r.valid) {
      setFieldError(r.message);
      return undefined;
    }
    setFieldError(null);
    return r.normalized;
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{ duty: string; tariff: string }>;

  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
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
        <HelpTooltip>
          <p className="font-medium text-gray-900">
            Internal only — never shown to the customer.
          </p>
          <p className="mt-2">
            <strong>CBM share</strong> determines this SKU&apos;s portion of
            the shipment&apos;s freight cost.
          </p>
          <p className="mt-1">
            <strong>Duty %</strong> and <strong>Tariff %</strong> apply to
            the SKU&apos;s factory cost.
          </p>
          <p className="mt-2">
            All three roll up into the customer-facing freight number
            invisibly.
          </p>
        </HelpTooltip>
        {pending && <span className="text-[10px] text-gray-500">saving…</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-700">Duty %</span>
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
                const normalized = validatePctInput(v, setDutyError);
                // undefined = validation failed; do NOT push junk into
                // the costing store and do NOT schedule a save. Local
                // input state still shows the user's typed value so they
                // can correct it.
                if (normalized === undefined) return;
                updateCustoms(quoteSkuId, { dutyPct: normalized });
                scheduleSave({ duty: v });
              }}
              placeholder="—"
              className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-500">%</span>
          </div>
          {dutyError && (
            <span className="text-[10px] text-red-700" role="alert">
              {dutyError}
            </span>
          )}
          {!dutyError && dutyWarn && (
            <span className="text-[10px] text-amber-700">{dutyWarn}</span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-700">Tariff %</span>
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
                const normalized = validatePctInput(v, setTariffError);
                if (normalized === undefined) return;
                updateCustoms(quoteSkuId, { tariffPct: normalized });
                scheduleSave({ tariff: v });
              }}
              placeholder="—"
              className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-500">%</span>
          </div>
          {tariffError && (
            <span className="text-[10px] text-red-700" role="alert">
              {tariffError}
            </span>
          )}
          {!tariffError && tariffWarn && (
            <span className="text-[10px] text-amber-700">{tariffWarn}</span>
          )}
        </label>
      </div>
      <p className="mt-2 text-[11px] italic text-gray-500">
        Duty and tariff apply to factory cost. CBM is captured per shipment
        on each freight line below. Internal use only — not shown to customer.
      </p>
      {error && (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
