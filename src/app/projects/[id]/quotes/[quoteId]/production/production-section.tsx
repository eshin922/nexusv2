"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  updateSkuProductionPolicy,
  upsertProductionInputs,
} from "@/app/actions/production";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectUpdateProductionCell,
  selectUpdateProductionPolicy,
} from "@/lib/costing-store";

const DEBOUNCE_MS = 500;

function parseNumOrNull(v: string): number | null {
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type TierCell = {
  tierId: string;
  tierLabel: string;
  rowId: string | null;
  fillingBlendingCost: string | null;
  cmAssemblyTotal: string | null;
  setupFeeTotal: string | null;
  toolingArtworkTotal: string | null;
  rdTotal: string | null;
  otherServiceTotal: string | null;
  bulkRawCost: string | null;
  actualUnitsProduced: number | null;
};

type Policy = {
  customerShipsRaws: boolean;
  allocateServiceFeesToCost: boolean;
  notes: string | null;
};

type CellState = {
  fillingBlendingCost: string;
  cmAssemblyTotal: string;
  setupFeeTotal: string;
  toolingArtworkTotal: string;
  rdTotal: string;
  otherServiceTotal: string;
  bulkRawCost: string;
  actualUnitsProduced: string;
};

type CellField = keyof CellState;

const COST_ROWS: Array<{ key: CellField; label: string }> = [
  { key: "fillingBlendingCost", label: "Filling / Blending" },
  { key: "cmAssemblyTotal", label: "CM / Assembly" },
  { key: "setupFeeTotal", label: "Setup Fee" },
  { key: "toolingArtworkTotal", label: "Tooling / Artwork" },
  { key: "rdTotal", label: "R&D" },
  { key: "otherServiceTotal", label: "Other Service" },
];
const BULK_RAW_ROW: { key: CellField; label: string } = {
  key: "bulkRawCost",
  label: "Bulk Raw Cost",
};

function fromCell(c: TierCell): CellState {
  return {
    fillingBlendingCost: c.fillingBlendingCost ?? "",
    cmAssemblyTotal: c.cmAssemblyTotal ?? "",
    setupFeeTotal: c.setupFeeTotal ?? "",
    toolingArtworkTotal: c.toolingArtworkTotal ?? "",
    rdTotal: c.rdTotal ?? "",
    otherServiceTotal: c.otherServiceTotal ?? "",
    bulkRawCost: c.bulkRawCost ?? "",
    actualUnitsProduced:
      c.actualUnitsProduced === null ? "" : String(c.actualUnitsProduced),
  };
}

export function ProductionSection({
  quoteSkuId,
  policy,
  tierCells,
  disabled,
}: {
  quoteSkuId: string;
  policy: Policy;
  tierCells: TierCell[];
  disabled: boolean;
}) {
  // Policy state (per-SKU; fanned out across all tier rows by the action).
  const [customerShipsRaws, setCustomerShipsRaws] = useState(
    policy.customerShipsRaws,
  );
  const [allocate, setAllocate] = useState(policy.allocateServiceFeesToCost);
  const [notes, setNotes] = useState(policy.notes ?? "");
  const [policyError, setPolicyError] = useState<string | null>(null);
  const policyRef = useRef({ customerShipsRaws, allocate, notes });
  policyRef.current = { customerShipsRaws, allocate, notes };
  const policyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-tier state. One CellState per tier index (parallel to tierCells).
  const [tierStates, setTierStates] = useState<CellState[]>(() =>
    tierCells.map(fromCell),
  );
  const tierStatesRef = useRef(tierStates);
  tierStatesRef.current = tierStates;
  const cellDebounceRefs = useRef<(ReturnType<typeof setTimeout> | null)[]>(
    tierCells.map(() => null),
  );
  const [cellErrors, setCellErrors] = useState<(string | null)[]>(
    tierCells.map(() => null),
  );

  const [pending, startTransition] = useTransition();

  // Slice 8 sub-step 5: optimistic store push. Notes is metadata-only
  // (no impact on costing rollup) so it doesn't push.
  const updateProductionCell = useCostingStore(selectUpdateProductionCell);
  const updateProductionPolicy = useCostingStore(selectUpdateProductionPolicy);

  // Map from CellState field name to the costing input field name.
  // The two are identical; declared explicitly for type-safety against
  // future renames.
  const CELL_FIELD_MAP: Record<
    Exclude<CellField, never>,
    | "fillingBlendingCost"
    | "cmAssemblyTotal"
    | "setupFeeTotal"
    | "toolingArtworkTotal"
    | "rdTotal"
    | "otherServiceTotal"
    | "bulkRawCost"
    | "actualUnitsProduced"
  > = {
    fillingBlendingCost: "fillingBlendingCost",
    cmAssemblyTotal: "cmAssemblyTotal",
    setupFeeTotal: "setupFeeTotal",
    toolingArtworkTotal: "toolingArtworkTotal",
    rdTotal: "rdTotal",
    otherServiceTotal: "otherServiceTotal",
    bulkRawCost: "bulkRawCost",
    actualUnitsProduced: "actualUnitsProduced",
  };

  useEffect(() => {
    return () => {
      if (policyDebounceRef.current) clearTimeout(policyDebounceRef.current);
      for (const t of cellDebounceRefs.current) {
        if (t) clearTimeout(t);
      }
    };
  }, []);

  // ---------- policy save ----------

  type PolicyOverrides = Partial<{
    customerShipsRaws: boolean;
    allocate: boolean;
    notes: string;
  }>;

  function firePolicySave(overrides: PolicyOverrides = {}) {
    const s = { ...policyRef.current, ...overrides };
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    fd.set("customerShipsRaws", s.customerShipsRaws ? "on" : "");
    fd.set("allocateServiceFeesToCost", s.allocate ? "on" : "");
    fd.set("notes", s.notes);
    startTransition(async () => {
      const r = await updateSkuProductionPolicy(fd);
      if (!r.ok) setPolicyError(r.error.message);
      else setPolicyError(null);
    });
  }

  function schedulePolicySave(overrides: PolicyOverrides = {}) {
    if (policyDebounceRef.current) clearTimeout(policyDebounceRef.current);
    policyDebounceRef.current = setTimeout(
      () => firePolicySave(overrides),
      DEBOUNCE_MS,
    );
  }

  function fireImmediatePolicySave(overrides: PolicyOverrides = {}) {
    if (policyDebounceRef.current) clearTimeout(policyDebounceRef.current);
    firePolicySave(overrides);
  }

  // ---------- per-tier cell save ----------

  function fireCellSave(tierIndex: number, overrides: Partial<CellState> = {}) {
    const cell = tierCells[tierIndex];
    const s = { ...tierStatesRef.current[tierIndex], ...overrides };
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    fd.set("tierId", cell.tierId);
    fd.set("fillingBlendingCost", s.fillingBlendingCost);
    fd.set("cmAssemblyTotal", s.cmAssemblyTotal);
    fd.set("setupFeeTotal", s.setupFeeTotal);
    fd.set("toolingArtworkTotal", s.toolingArtworkTotal);
    fd.set("rdTotal", s.rdTotal);
    fd.set("otherServiceTotal", s.otherServiceTotal);
    fd.set("bulkRawCost", s.bulkRawCost);
    fd.set("actualUnitsProduced", s.actualUnitsProduced);
    startTransition(async () => {
      const r = await upsertProductionInputs(fd);
      if (!r.ok) {
        setCellErrors((prev) => {
          const next = [...prev];
          next[tierIndex] = r.error.message;
          return next;
        });
      } else {
        setCellErrors((prev) => {
          if (prev[tierIndex] === null) return prev;
          const next = [...prev];
          next[tierIndex] = null;
          return next;
        });
      }
    });
  }

  function scheduleCellSave(
    tierIndex: number,
    overrides: Partial<CellState> = {},
  ) {
    const t = cellDebounceRefs.current[tierIndex];
    if (t) clearTimeout(t);
    cellDebounceRefs.current[tierIndex] = setTimeout(
      () => fireCellSave(tierIndex, overrides),
      DEBOUNCE_MS,
    );
  }

  function updateCellField(
    tierIndex: number,
    field: CellField,
    value: string,
  ) {
    setTierStates((prev) => {
      const next = [...prev];
      next[tierIndex] = { ...next[tierIndex], [field]: value };
      return next;
    });
    // Optimistic store push: every cost field on this row is numeric.
    // CELL_FIELD_MAP gives us the costing input field name (1:1 with
    // CellField today; declared explicitly to fail at compile time if
    // either side is renamed).
    const tierId = tierCells[tierIndex].tierId;
    const costingField = CELL_FIELD_MAP[field];
    updateProductionCell(quoteSkuId, tierId, {
      [costingField]: parseNumOrNull(value),
    });
    scheduleCellSave(tierIndex, { [field]: value });
  }

  // ---------- render ----------

  const N = tierCells.length;
  const gridCols = `minmax(180px, 1fr) repeat(${N}, minmax(110px, 1fr))`;

  return (
    <div className="grid gap-4">
      {/* Policy row */}
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr]">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={customerShipsRaws}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.checked;
                setCustomerShipsRaws(v);
                updateProductionPolicy(quoteSkuId, { customerShipsRaws: v });
                fireImmediatePolicySave({ customerShipsRaws: v });
              }}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>
              Customer ships raws
              <span className="ml-1 text-xs text-gray-500">
                (hides Bulk Raw Cost)
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allocate}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.checked;
                setAllocate(v);
                updateProductionPolicy(quoteSkuId, {
                  allocateServiceFeesToCost: v,
                });
                fireImmediatePolicySave({ allocate: v });
              }}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>
              Allocate service fees to unit cost
              <span className="ml-1 text-xs text-gray-500">
                (NRE amortizes vs. carried separately)
              </span>
            </span>
          </label>
          <div>
            <textarea
              value={notes}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                setNotes(v);
                schedulePolicySave({ notes: v });
              }}
              placeholder="Notes…"
              rows={2}
              className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>
        {policyError && (
          <p className="mt-2 text-xs text-red-700" role="alert">
            {policyError}
          </p>
        )}
      </div>

      {/* Cost grid */}
      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        {/* Header row */}
        <div
          className="grid items-center border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="px-3 py-2">Field</div>
          {tierCells.map((c) => (
            <div key={c.tierId} className="px-3 py-2 text-right">
              {c.tierLabel}
            </div>
          ))}
        </div>

        {/* Cost rows */}
        {COST_ROWS.map((row) => (
          <CellRow
            key={row.key}
            label={row.label}
            field={row.key}
            tierStates={tierStates}
            tierCells={tierCells}
            cellErrors={cellErrors}
            disabled={disabled}
            onChange={(idx, v) => updateCellField(idx, row.key, v)}
            gridCols={gridCols}
            inputType="numeric"
          />
        ))}

        {/* bulk_raw_cost — hidden when customer_ships_raws=true. Data
            preserved in DB; toggling back restores the value. */}
        {!customerShipsRaws && (
          <CellRow
            label={BULK_RAW_ROW.label}
            field={BULK_RAW_ROW.key}
            tierStates={tierStates}
            tierCells={tierCells}
            cellErrors={cellErrors}
            disabled={disabled}
            onChange={(idx, v) => updateCellField(idx, BULK_RAW_ROW.key, v)}
            gridCols={gridCols}
            inputType="numeric"
          />
        )}

        {/* Post-production section */}
        <div
          className="grid items-center border-t-2 border-amber-200 bg-amber-50 text-xs font-medium uppercase tracking-wide text-amber-800"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="px-3 py-2 flex items-center gap-2">
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
              Post-production
            </span>
          </div>
          {tierCells.map((c) => (
            <div key={c.tierId} className="px-3 py-2" />
          ))}
        </div>
        <CellRow
          label="Actual units produced"
          field="actualUnitsProduced"
          tierStates={tierStates}
          tierCells={tierCells}
          cellErrors={cellErrors}
          disabled={disabled}
          onChange={(idx, v) =>
            updateCellField(idx, "actualUnitsProduced", v)
          }
          gridCols={gridCols}
          inputType="integer"
          rowClass="bg-amber-50/40"
        />
      </div>

      {pending && (
        <p className="text-xs text-gray-400">saving…</p>
      )}
    </div>
  );
}

function CellRow({
  label,
  field,
  tierStates,
  tierCells,
  cellErrors,
  disabled,
  onChange,
  gridCols,
  inputType,
  rowClass = "",
}: {
  label: string;
  field: CellField;
  tierStates: CellState[];
  tierCells: TierCell[];
  cellErrors: (string | null)[];
  disabled: boolean;
  onChange: (tierIndex: number, value: string) => void;
  gridCols: string;
  inputType: "numeric" | "integer";
  rowClass?: string;
}) {
  return (
    <div
      className={`grid items-center border-b border-gray-100 text-sm ${rowClass}`}
      style={{ gridTemplateColumns: gridCols }}
    >
      <div className="px-3 py-2 text-gray-700">{label}</div>
      {tierCells.map((c, idx) => (
        <div key={c.tierId} className="px-2 py-1.5">
          <input
            type="number"
            inputMode={inputType === "integer" ? "numeric" : "decimal"}
            step={inputType === "integer" ? "1" : "0.01"}
            min={0}
            value={tierStates[idx][field]}
            disabled={disabled}
            onChange={(e) => onChange(idx, e.target.value)}
            placeholder="—"
            className="w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-right text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
          />
          {cellErrors[idx] && (
            <p className="mt-1 text-[10px] text-red-700" role="alert">
              {cellErrors[idx]}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
