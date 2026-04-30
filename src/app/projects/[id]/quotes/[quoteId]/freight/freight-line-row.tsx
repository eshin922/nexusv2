"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  copyFreightTierValueToAllTiers,
  deleteFreightLine,
  moveFreightLine,
  updateFreightLineMetadata,
  updateFreightTierCell,
} from "@/app/actions/freight";

const DEBOUNCE_MS = 500;

const FREIGHT_MODES = [
  { value: "", label: "—" },
  { value: "parcel", label: "Parcel" },
  { value: "ltl", label: "LTL" },
  { value: "ftl", label: "FTL" },
  { value: "ocean", label: "Ocean" },
  { value: "air", label: "Air" },
  { value: "courier", label: "Courier" },
  { value: "other", label: "Other" },
] as const;

type FreightModeValue =
  | "parcel"
  | "ltl"
  | "ftl"
  | "ocean"
  | "air"
  | "courier"
  | "other"
  | null;

type Tier = { id: string; label: string; qty: number | null };

type CellRow = {
  rowId: string;
  tierId: string;
  totalFreight: string | null;
  unitsInShipment: number | null;
};

type Line = {
  lineGroupId: string;
  sortOrder: number;
  shipmentId: string | null;
  supplier: string | null;
  freightMode: FreightModeValue;
  freightTreatment: "bundled" | "pass_through";
  markupPct: string | null;
  notes: string | null;
  cells: CellRow[];
};

function decimalToPercentDisplay(d: string | null): string {
  if (d === null) return "";
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "";
  return Number(n.toFixed(4)).toString();
}

export function FreightLineRow({
  line,
  tiers,
  isFirst,
  isLast,
  disabled,
}: {
  line: Line;
  tiers: Tier[];
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
}) {
  // Per-line metadata state
  const [shipmentId, setShipmentId] = useState(line.shipmentId ?? "");
  const [supplier, setSupplier] = useState(line.supplier ?? "");
  const [freightMode, setFreightMode] = useState<string>(line.freightMode ?? "");
  const [freightTreatment, setFreightTreatment] = useState(line.freightTreatment);
  const [markup, setMarkup] = useState(decimalToPercentDisplay(line.markupPct));
  const [notes, setNotes] = useState(line.notes ?? "");

  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({
    shipmentId,
    supplier,
    freightMode,
    freightTreatment,
    markup,
    notes,
  });
  stateRef.current = {
    shipmentId,
    supplier,
    freightMode,
    freightTreatment,
    markup,
    notes,
  };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{
    shipmentId: string;
    supplier: string;
    freightMode: string;
    freightTreatment: "bundled" | "pass_through";
    markup: string;
    notes: string;
  }>;

  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("shipmentId", s.shipmentId);
    fd.set("supplier", s.supplier);
    fd.set("freightMode", s.freightMode);
    fd.set("freightTreatment", s.freightTreatment);
    fd.set("markupPct", s.markup);
    fd.set("notes", s.notes);
    startTransition(async () => {
      const r = await updateFreightLineMetadata(fd);
      if (r.ok) {
        // Hydrate from canonical server response (esp. markup, since
        // the server normalizes).
        setMarkup(decimalToPercentDisplay(r.data.markupPct));
        setSaveError(null);
      } else {
        setSaveError(r.error.message);
      }
    });
  }

  function scheduleSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(overrides), DEBOUNCE_MS);
  }

  function fireImmediateSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fireSave(overrides);
  }

  function handleDelete() {
    if (!confirm("Delete this freight line? Per-tier cost data will be lost."))
      return;
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    startTransition(async () => {
      const r = await deleteFreightLine(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function handleMove(direction: "up" | "down") {
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("direction", direction);
    startTransition(async () => {
      const r = await moveFreightLine(fd);
      if (!r.ok) setSaveError(r.error.message);
    });
  }

  function toggleTreatment() {
    const next: "bundled" | "pass_through" =
      freightTreatment === "bundled" ? "pass_through" : "bundled";
    setFreightTreatment(next);
    fireImmediateSave({ freightTreatment: next });
  }

  // Per-tier cell state (one row per tier)
  const cellByTier = new Map(line.cells.map((c) => [c.tierId, c]));

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      {/* Per-line metadata row */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_auto_2fr_auto] md:items-center">
        <input
          value={supplier}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setSupplier(v);
            scheduleSave({ supplier: v });
          }}
          placeholder="Supplier"
          className="rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <input
          value={shipmentId}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setShipmentId(v);
            scheduleSave({ shipmentId: v });
          }}
          placeholder="Shipment ID"
          className="rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <select
          value={freightMode}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setFreightMode(v);
            fireImmediateSave({ freightMode: v });
          }}
          className="rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        >
          {FREIGHT_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={markup}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              setMarkup(v);
              scheduleSave({ markup: v });
            }}
            placeholder="—"
            className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
          />
          <span className="text-xs text-gray-500">%</span>
        </div>
        <button
          type="button"
          onClick={toggleTreatment}
          disabled={disabled}
          title="Click to toggle freight treatment"
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            freightTreatment === "pass_through"
              ? "bg-amber-100 text-amber-900"
              : "bg-gray-200 text-gray-700"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {freightTreatment === "pass_through" ? "Pass-through" : "Bundled"}
        </button>
        <input
          value={notes}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setNotes(v);
            scheduleSave({ notes: v });
          }}
          placeholder="Notes"
          className="rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <div className="flex items-center justify-end gap-1">
          {saveError && (
            <span className="mr-1 text-xs text-red-700" role="alert">
              {saveError}
            </span>
          )}
          {pending && (
            <span className="mr-1 text-xs text-gray-400">saving…</span>
          )}
          <button
            type="button"
            onClick={() => handleMove("up")}
            disabled={disabled || isFirst}
            title="Move up"
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs hover:bg-white disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => handleMove("down")}
            disabled={disabled || isLast}
            title="Move down"
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs hover:bg-white disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={disabled}
            title="Delete this freight line"
            className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-30"
          >
            ×
          </button>
        </div>
      </div>

      {/* Per-tier cells */}
      <div className="mt-3 grid gap-2">
        {tiers.map((t) => {
          const cell = cellByTier.get(t.id);
          if (!cell) return null;
          return (
            <FreightTierCell
              key={t.id}
              tier={t}
              cell={cell}
              lineGroupId={line.lineGroupId}
              disabled={disabled}
            />
          );
        })}
      </div>
    </div>
  );
}

function FreightTierCell({
  tier,
  cell,
  lineGroupId,
  disabled,
}: {
  tier: Tier;
  cell: CellRow;
  lineGroupId: string;
  disabled: boolean;
}) {
  const [totalFreight, setTotalFreight] = useState(cell.totalFreight ?? "");
  const [units, setUnits] = useState(
    cell.unitsInShipment === null ? "" : String(cell.unitsInShipment),
  );
  const [pending, startTransition] = useTransition();
  const [copying, startCopy] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ totalFreight, units });
  stateRef.current = { totalFreight, units };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{ totalFreight: string; units: string }>;

  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("rowId", cell.rowId);
    fd.set("totalFreight", s.totalFreight);
    fd.set("unitsInShipment", s.units);
    startTransition(async () => {
      const r = await updateFreightTierCell(fd);
      if (!r.ok) setErr(r.error.message);
      else setErr(null);
    });
  }

  function scheduleSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(overrides), DEBOUNCE_MS);
  }

  function copyToAll(column: "total_freight" | "units_in_shipment") {
    setErr(null);
    const fd = new FormData();
    fd.set("lineGroupId", lineGroupId);
    fd.set("sourceTierId", cell.tierId);
    fd.set("column", column);
    startCopy(async () => {
      const r = await copyFreightTierValueToAllTiers(fd);
      if (!r.ok) setErr(r.error.message);
    });
  }

  const unitsPlaceholder =
    tier.qty !== null
      ? `default: ${tier.qty.toLocaleString()}`
      : "units";

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_auto_1fr_auto] sm:items-center text-sm">
      <span className="text-xs uppercase tracking-wide text-gray-500">
        {tier.label}
      </span>
      <label className="flex items-center gap-1">
        <span className="text-xs text-gray-500">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={totalFreight}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setTotalFreight(v);
            scheduleSave({ totalFreight: v });
          }}
          placeholder="Total freight"
          className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
      </label>
      <button
        type="button"
        disabled={disabled || copying || totalFreight === ""}
        onClick={() => copyToAll("total_freight")}
        title="Apply this Total Freight to all tiers"
        className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
      >
        →
      </button>
      <input
        type="number"
        inputMode="numeric"
        step="1"
        min={0}
        value={units}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setUnits(v);
          scheduleSave({ units: v });
        }}
        placeholder={unitsPlaceholder}
        className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={disabled || copying || units === ""}
          onClick={() => copyToAll("units_in_shipment")}
          title="Apply this Units in Shipment to all tiers"
          className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
        >
          →
        </button>
        {(pending || copying) && (
          <span className="text-xs text-gray-400">saving…</span>
        )}
        {err && (
          <span className="text-xs text-red-700" role="alert">
            {err}
          </span>
        )}
      </div>
    </div>
  );
}
