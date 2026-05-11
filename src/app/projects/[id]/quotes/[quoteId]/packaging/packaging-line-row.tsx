"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  copyTierValueToAllTiers,
  deletePackagingLine,
  movePackagingLine,
  revertMarkupToDefault,
  updatePackagingLineMetadata,
  updatePackagingTierCell,
} from "@/app/actions/packaging";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectActiveTierId,
  selectUpdatePackagingCell,
  selectUpdatePackagingLineMeta,
} from "@/lib/costing-store";
import { validatePercentDecimal } from "@/lib/percent-validation";

function parseNumOrNull(v: string): number | null {
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type Tier = { id: string; label: string };

type CellRow = {
  rowId: string;
  tierId: string;
  unitCost: string | null;
  purchaseQty: string | null;
};

type Line = {
  lineGroupId: string;
  sortOrder: number;
  supplier: string | null;
  qtyPerSellableUnit: string | null;
  category: string | null;
  markupPct: string | null;
  markupPctSource: "category_default" | "manual_override" | null;
  inventoryEligible: boolean;
  notes: string | null;
  cells: CellRow[];
};

const DEBOUNCE_MS = 500;

export function PackagingLineRow({
  line,
  tiers,
  isFirst,
  isLast,
  categories,
  disabled = false,
}: {
  line: Line;
  tiers: Tier[];
  isFirst: boolean;
  isLast: boolean;
  categories: Array<{ category: string; defaultMarkupPct: string }>;
  disabled?: boolean;
}) {
  const [supplier, setSupplier] = useState(line.supplier ?? "");
  const [qty, setQty] = useState(line.qtyPerSellableUnit ?? "");
  const [category, setCategory] = useState(line.category ?? "");
  const [markup, setMarkup] = useState(line.markupPct ?? "");
  const [markupSource, setMarkupSource] = useState<
    "category_default" | "manual_override" | null
  >(line.markupPctSource);
  const [inventoryEligible, setInventoryEligible] = useState(line.inventoryEligible);
  const [notes, setNotes] = useState(line.notes ?? "");

  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [markupError, setMarkupError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ supplier, qty, category, markup, inventoryEligible, notes });
  stateRef.current = { supplier, qty, category, markup, inventoryEligible, notes };

  // Slice 8 sub-step 5: optimistic store push for the three metadata
  // fields that affect the costing rollup (qty, category, markup_pct).
  // The other line metadata (supplier, inventoryEligible, notes) is
  // display-only — costing rollup ignores it. Category alone affects
  // costing only via markup default lookup, so when the PM picks a
  // category we update both category and the resolved markup.
  const updatePackagingLineMeta = useCostingStore(
    selectUpdatePackagingLineMeta,
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{
    supplier: string;
    qty: string;
    category: string;
    markup: string;
    inventoryEligible: boolean;
    notes: string;
  }>;

  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("supplier", s.supplier);
    fd.set("qtyPerSellableUnit", s.qty);
    fd.set("category", s.category);
    fd.set("markupPct", s.markup);
    fd.set("inventoryEligible", s.inventoryEligible ? "on" : "");
    fd.set("notes", s.notes);
    startTransition(async () => {
      const result = await updatePackagingLineMetadata(fd);
      if (result.ok) {
        setMarkup(result.data.markupPct ?? "");
        setMarkupSource(result.data.markupPctSource);
        setSaveError(null);
      } else {
        setSaveError(result.error.message);
      }
    });
  }

  function scheduleSave(immediate: boolean, overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (immediate) {
      fireSave(overrides);
    } else {
      debounceRef.current = setTimeout(() => fireSave(overrides), DEBOUNCE_MS);
    }
  }

  function handleDelete() {
    if (!confirm("Delete this packaging line?")) return;
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    startTransition(async () => {
      const result = await deletePackagingLine(fd);
      if (!result.ok) setSaveError(result.error.message);
    });
  }

  function handleMove(direction: "up" | "down") {
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("direction", direction);
    startTransition(async () => {
      const result = await movePackagingLine(fd);
      if (!result.ok) setSaveError(result.error.message);
    });
  }

  function handleRevert() {
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    startTransition(async () => {
      const result = await revertMarkupToDefault(fd);
      if (result.ok) {
        if (result.data) {
          setMarkup(result.data.markupPct ?? "");
          setMarkupSource(result.data.markupPctSource);
        }
        setSaveError(null);
      } else {
        setSaveError(result.error.message);
      }
    });
  }

  const isOverride = markupSource === "manual_override";
  const categoryDefault = categories.find((c) => c.category === category)?.defaultMarkupPct;
  const inputClass = (extra = "") =>
    `rounded border bg-white px-1.5 py-1 text-sm focus:outline-none border-gray-200 focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed ${extra}`;

  return (
    <div className="rounded border border-gray-200 bg-white">
      <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_0.9fr_0.7fr_2fr_auto] items-center gap-2 px-3 py-2 text-sm">
        <input
          value={supplier}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setSupplier(v);
            scheduleSave(false, { supplier: v });
          }}
          placeholder="Supplier"
          className={inputClass()}
        />
        <input
          value={qty}
          type="number"
          step="0.0001"
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setQty(v);
            updatePackagingLineMeta(line.lineGroupId, {
              qtyPerSellableUnit: parseNumOrNull(v),
            });
            scheduleSave(false, { qty: v });
          }}
          placeholder="qty/unit"
          className={inputClass()}
        />
        <select
          value={category}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setCategory(v);
            // Optimistic: push the category change. The server response
            // (which may also update markupPct via category default
            // lookup) re-hydrates markup state for us.
            updatePackagingLineMeta(line.lineGroupId, {
              category: v === "" ? null : v,
            });
            scheduleSave(true, { category: v });
          }}
          className={inputClass()}
        >
          <option value="">— category —</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category} ({Math.round(Number(c.defaultMarkupPct) * 100)}%)
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <input
            value={markup}
            type="number"
            step="0.0001"
            min={0}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              setMarkup(v);
              // markup input is in raw decimal here (per existing UI
              // convention; freight + customs use percent-display
              // instead — UX_BACKLOG candidate to reconcile). So the
              // typed value IS the decimal — pass it straight to
              // validatePercentDecimal without the /100 conversion.
              if (v === "") {
                setMarkupError(null);
                updatePackagingLineMeta(line.lineGroupId, { markupPct: null });
                scheduleSave(false, { markup: v });
                return;
              }
              const decimal = Number(v);
              const r = validatePercentDecimal(decimal, "markup");
              if (!r.valid) {
                setMarkupError(r.message);
                return;
              }
              setMarkupError(null);
              updatePackagingLineMeta(line.lineGroupId, {
                markupPct: r.normalized,
              });
              scheduleSave(false, { markup: v });
            }}
            placeholder="markup"
            title={
              isOverride
                ? `Manual override${categoryDefault ? ` (default ${(Number(categoryDefault) * 100).toFixed(2)}%)` : ""}`
                : undefined
            }
            className={inputClass(
              `flex-1 ${isOverride ? "border-amber-300 ring-1 ring-amber-200 focus:border-amber-400" : ""}`,
            )}
          />
          {isOverride && !disabled && (
            <button
              type="button"
              onClick={handleRevert}
              title={
                categoryDefault
                  ? `Click to revert to category default (${(Number(categoryDefault) * 100).toFixed(2)}%)`
                  : "Click to revert to category default"
              }
              className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
            >
              ↺
            </button>
          )}
        </div>
        <label className="flex items-center justify-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={inventoryEligible}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.checked;
              setInventoryEligible(v);
              scheduleSave(true, { inventoryEligible: v });
            }}
          />
          Inv?
        </label>
        <input
          value={notes}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setNotes(v);
            scheduleSave(false, { notes: v });
          }}
          placeholder="notes"
          className={inputClass()}
        />
        <div className="flex items-center gap-1 justify-end">
          {markupError ? (
            <span className="text-xs text-red-700 mr-1" role="alert">
              {markupError}
            </span>
          ) : saveError ? (
            <span className="text-xs text-red-700 mr-1" role="alert">
              {saveError}
            </span>
          ) : pending ? (
            <span className="text-xs text-gray-400 mr-1">saving…</span>
          ) : null}
          <button
            type="button"
            onClick={() => handleMove("up")}
            disabled={disabled || isFirst}
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-gray-50"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => handleMove("down")}
            disabled={disabled || isLast}
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-gray-50"
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={disabled}
            className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-30"
            title="Delete line"
          >
            ×
          </button>
        </div>
      </div>

      <div className="border-t border-gray-100 bg-gray-50 px-3 py-2">
        <div
          className="grid items-center gap-2"
          style={{
            gridTemplateColumns: `min-content repeat(${tiers.length}, minmax(0, 1fr))`,
          }}
        >
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Unit cost
          </span>
          {tiers.map((t) => (
            <TierCostCell
              key={t.id}
              tier={t}
              cell={line.cells.find((c) => c.tierId === t.id)}
              lineGroupId={line.lineGroupId}
              disabled={disabled}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TierCostCell({
  tier,
  cell,
  lineGroupId,
  disabled,
}: {
  tier: Tier;
  cell: CellRow | undefined;
  lineGroupId: string;
  disabled: boolean;
}) {
  const [unitCost, setUnitCost] = useState(cell?.unitCost ?? "");
  const initialRowId = useRef(cell?.rowId);
  useEffect(() => {
    if (cell?.rowId !== initialRowId.current) {
      initialRowId.current = cell?.rowId;
      setUnitCost(cell?.unitCost ?? "");
    }
  }, [cell?.rowId, cell?.unitCost]);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(unitCost);
  valueRef.current = unitCost;

  // Slice 8 sub-step 4: push optimistic update into the costing store on
  // every onChange. Server save still fires on debounce as before.
  // Subscribers (QuoteSummaryCard) re-render <50ms; reconcile from
  // server settles ~700ms later, server-wins overwrite handles any drift.
  const updatePackagingCell = useCostingStore(selectUpdatePackagingCell);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Active-tier column highlight (RI.4 CR-13 amendment): cells in the
  // active tier column tint with accent-soft/30. Subscribes to the
  // store so re-renders are local to changed cells, not the whole row.
  const activeTierId = useCostingStore(selectActiveTierId);
  const isActive = activeTierId === tier.id;

  if (!cell)
    return (
      <span
        className={`text-xs text-gray-400 ${
          isActive ? "rounded bg-accent-soft/30 px-1" : ""
        }`}
      >
        —
      </span>
    );

  function fireSave() {
    if (!cell) return;
    const fd = new FormData();
    fd.set("rowId", cell.rowId);
    fd.set("unitCost", valueRef.current);
    fd.set("purchaseQty", cell.purchaseQty ?? "");
    startTransition(async () => {
      const result = await updatePackagingTierCell(fd);
      if (!result.ok) setError(result.error.message);
      else setError(null);
    });
  }

  function handleChange(value: string) {
    setUnitCost(value);
    // Optimistic store push (immediate). cell is checked above; non-null here.
    if (cell) {
      const numeric = value === "" ? null : Number(value);
      updatePackagingCell(cell.rowId, {
        unitCost: Number.isFinite(numeric as number) ? (numeric as number) : null,
      });
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fireSave, DEBOUNCE_MS);
  }

  function handleCopy() {
    if (!unitCost) {
      alert("Enter a unit cost first.");
      return;
    }
    if (!confirm(`Copy ${unitCost} to all other tiers on this line?`)) return;
    const fd = new FormData();
    fd.set("lineGroupId", lineGroupId);
    fd.set("sourceTierId", tier.id);
    fd.set("column", "unit_cost");
    startTransition(async () => {
      const result = await copyTierValueToAllTiers(fd);
      if (!result.ok) setError(result.error.message);
      else setError(null);
    });
  }

  return (
    <div
      className={`flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${
        isActive ? "bg-accent-soft/30" : ""
      }`}
    >
      <span
        className={`text-xs ${isActive ? "text-accent-ink" : "text-gray-500"}`}
      >
        {tier.label}
      </span>
      <input
        value={unitCost}
        type="number"
        step="0.0001"
        min={0}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="—"
        className="w-20 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
      />
      <button
        type="button"
        onClick={handleCopy}
        disabled={disabled}
        title="Apply this tier's unit cost to all tiers on this line"
        className="rounded border border-gray-200 px-1 py-0.5 text-xs text-blue-700 hover:bg-white disabled:opacity-30"
      >
        →
      </button>
      {error ? (
        <span className="text-[10px] text-red-700" role="alert">{error}</span>
      ) : pending ? (
        <span className="text-[10px] text-gray-400">saving…</span>
      ) : null}
    </div>
  );
}
