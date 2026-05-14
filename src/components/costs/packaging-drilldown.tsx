"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { quoteSkus } from "@/db/schema";
import {
  copyTierValueToAllTiers,
  deletePackagingLine,
  updatePackagingLineMetadata,
  updatePackagingTierCell,
} from "@/app/actions/packaging";
import { AddLineButton } from "@/app/projects/[id]/quotes/[quoteId]/packaging/add-line-button";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectActiveTierId,
  selectUpdatePackagingCell,
  selectUpdatePackagingLineMeta,
} from "@/lib/costing-store";

type QuoteSku = typeof quoteSkus.$inferSelect;

// Slice RI.4 — Packaging drill-down per R6 source
// (`docs/design-prototypes/dist/source/round-6/packaging-drawer.jsx`).
//
// Structure:
//   .r6-empty-drawer when no lines exist
//   .drawer-toolbar — line count + summary + + Line / From inventory
//   .r6-dt.pkg — flat table:
//     Component (name + sub) | Category | Supplier | Markup | per-tier | actions
//   Total row at bottom
//
// One flat list across all SKUs (R6 anchor-SKU pattern). When the
// quote has multiple SKUs, the SKU label appears in the row's name
// sub-text. v1 ships display + inline number inputs for tier cells +
// inline text/number inputs for supplier / markup.

type PackagingInputRow = {
  packaging_inputs: {
    id: string;
    quoteSkuId: string;
    tierId: string;
    lineGroupId: string;
    sortOrder: number;
    supplier: string | null;
    qtyPerSellableUnit: string | null;
    category: string | null;
    markupPct: string | null;
    markupPctSource: "category_default" | "manual_override" | null;
    inventoryEligible: boolean;
    notes: string | null;
    unitCost: string | null;
    purchaseQty: string | null;
  };
};

type LineForUI = {
  lineGroupId: string;
  sortOrder: number;
  quoteSkuId: string;
  supplier: string | null;
  qtyPerSellableUnit: string | null;
  category: string | null;
  markupPct: string | null;
  markupPctSource: "category_default" | "manual_override" | null;
  inventoryEligible: boolean;
  notes: string | null;
  cells: Map<string, { rowId: string; unitCost: string | null }>;
};

const DEBOUNCE_MS = 500;

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Compute per-line per-tier landed packaging value:
//   unit_cost × (1 + markup) × qty_per_sellable_unit
function lineValueForTier(line: LineForUI, tierId: string): number | null {
  const cell = line.cells.get(tierId);
  const unit = num(cell?.unitCost ?? null);
  const markup = num(line.markupPct) ?? 0;
  const qty = num(line.qtyPerSellableUnit) ?? 1;
  if (unit === null) return null;
  return unit * (1 + markup) * qty;
}

export function PackagingDrilldown({
  skus,
  tiers,
  inputRows,
  categories,
  editable,
}: {
  skus: QuoteSku[];
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  inputRows: PackagingInputRow[];
  categories: Array<{ category: string; defaultMarkupPct: string }>;
  editable: boolean;
}) {
  const skuMap = new Map(skus.map((s) => [s.id, s]));
  const linesById = new Map<string, LineForUI>();
  for (const r of inputRows) {
    const row = r.packaging_inputs;
    let line = linesById.get(row.lineGroupId);
    if (!line) {
      line = {
        lineGroupId: row.lineGroupId,
        sortOrder: row.sortOrder,
        quoteSkuId: row.quoteSkuId,
        supplier: row.supplier,
        qtyPerSellableUnit: row.qtyPerSellableUnit,
        category: row.category,
        markupPct: row.markupPct,
        markupPctSource: row.markupPctSource,
        inventoryEligible: row.inventoryEligible,
        notes: row.notes,
        cells: new Map(),
      };
      linesById.set(row.lineGroupId, line);
    }
    line.cells.set(row.tierId, {
      rowId: row.id,
      unitCost: row.unitCost,
    });
  }
  const lines = Array.from(linesById.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  if (tiers.length === 0) {
    return (
      <div
        style={{
          padding: "12px 14px",
          background: "var(--warn-soft)",
          border: "1px solid oklch(from var(--warn) l c h / 0.40)",
          borderRadius: 6,
          fontSize: 13,
          color: "var(--warn)",
        }}
      >
        Add at least one tier to the quote before entering packaging inputs.
      </div>
    );
  }

  const leafSkus = skus.filter((s) => s.skuRole === "leaf");
  if (leafSkus.length === 0) {
    return (
      <EmptyDrawer
        title="No leaf SKUs yet"
        body="Add at least one leaf SKU to the quote before entering packaging inputs."
      />
    );
  }

  if (lines.length === 0) {
    return (
      <EmptyDrawer
        title="No packaging components yet"
        body="Add the bottle, dropper, label, and any cartons. Markup defaults will fill in from the firm's category rates — adjust per-line if needed."
        actions={
          <AddLineButton
            quoteSkuId={leafSkus[0].id}
            disabled={!editable}
            tooltip={
              leafSkus.length > 1 ? `Adds to ${leafSkus[0].skuLabel}` : undefined
            }
          />
        }
      />
    );
  }

  const inventoryEligibleCount = lines.filter((l) => l.inventoryEligible).length;
  const supplierSet = new Set(
    lines.map((l) => l.supplier).filter((s): s is string => !!s),
  );

  // Tier sums for foot
  const tierSums = tiers.map((t) => {
    let sum = 0;
    let anyValue = false;
    for (const l of lines) {
      const v = lineValueForTier(l, t.id);
      if (v !== null) {
        sum += v;
        anyValue = true;
      }
    }
    return { tierId: t.id, value: anyValue ? sum : null };
  });

  return (
    <div>
      {/* Drawer toolbar — canonical .drawer-toolbar inside .r6-drawer
          (parent SectionWithDrilldown applies .r6-drawer to the
          collapsible region). 10/14 padding / paper bg / 1px rule /
          8px radius; .lhs flex baseline mono 11 / 0.04em ink-3 with
          strong ink 500 highlights; .rhs flex 6px gap. */}
      <div className="drawer-toolbar">
        <div className="lhs">
          <span>
            <strong>{lines.length}</strong> components
          </span>
          <span>·</span>
          <span>
            Markup defaults: <strong>per category</strong>
          </span>
          <span>·</span>
          <span>{inventoryEligibleCount} inventory-eligible · {supplierSet.size} supplier{supplierSet.size === 1 ? "" : "s"}</span>
        </div>
        <div className="rhs">
          <AddLineButton
            quoteSkuId={leafSkus[0].id}
            disabled={!editable}
            tooltip={
              leafSkus.length > 1 ? `Adds to ${leafSkus[0].skuLabel}` : undefined
            }
          />
        </div>
      </div>

      {/* Flat table */}
      <div
        className="r6-dt pkg"
        style={
          { ["--cols" as string]: tiers.length } as React.CSSProperties
        }
      >
        <div className="r6-dt-head">
          <span>Component</span>
          <span>Category</span>
          <span>Supplier</span>
          <span className="num">Markup</span>
          {tiers.map((t) => (
            <span key={t.id} className="num">
              {t.label}
              <br />
              <span
                style={{
                  fontSize: "9px",
                  letterSpacing: "0.04em",
                  opacity: 0.7,
                }}
              >
                {t.qty !== null ? t.qty.toLocaleString() : "—"}
              </span>
            </span>
          ))}
          <span></span>
        </div>

        {lines.map((line) => (
          <PackagingRow
            key={line.lineGroupId}
            line={line}
            tiers={tiers}
            sku={skuMap.get(line.quoteSkuId)}
            categories={categories}
            disabled={!editable}
          />
        ))}

        <div className="r6-dt-foot">
          <span className="total-lab">Total — packaging</span>
          <span></span>
          <span></span>
          <span></span>
          {tierSums.map((s) => (
            <span
              key={s.tierId}
              className={`num ${s.value === null ? "empty" : ""}`}
            >
              {s.value === null ? "—" : fmtCurr2(s.value)}
            </span>
          ))}
          <span></span>
        </div>
      </div>
    </div>
  );
}

function EmptyDrawer({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="r6-empty-drawer">
      <div className="glyph">∅</div>
      <h4>{title}</h4>
      <p>{body}</p>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

function PackagingRow({
  line,
  tiers,
  sku,
  categories,
  disabled,
}: {
  line: LineForUI;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  sku: QuoteSku | undefined;
  categories: Array<{ category: string; defaultMarkupPct: string }>;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const activeTierId = useCostingStore(selectActiveTierId);
  const updateLineMeta = useCostingStore(selectUpdatePackagingLineMeta);

  const [supplier, setSupplier] = useState(line.supplier ?? "");
  const [category, setCategory] = useState(line.category ?? "");
  const [markupPct, setMarkupPct] = useState(line.markupPct ?? "");
  const supplierDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ supplier, category, markupPct });
  stateRef.current = { supplier, category, markupPct };

  const initialId = useRef(line.lineGroupId);
  useEffect(() => {
    if (line.lineGroupId !== initialId.current) {
      initialId.current = line.lineGroupId;
      setSupplier(line.supplier ?? "");
      setCategory(line.category ?? "");
      setMarkupPct(line.markupPct ?? "");
    }
  }, [line.lineGroupId, line.supplier, line.category, line.markupPct]);

  useEffect(
    () => () => {
      if (supplierDebounce.current) clearTimeout(supplierDebounce.current);
    },
    [],
  );

  function fireMetaSave(overrides: Partial<{
    supplier: string;
    category: string;
    markupPct: string;
  }> = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("supplier", s.supplier);
    fd.set("category", s.category);
    fd.set("markupPct", s.markupPct);
    fd.set("qtyPerSellableUnit", line.qtyPerSellableUnit ?? "");
    fd.set("inventoryEligible", line.inventoryEligible ? "true" : "false");
    fd.set("notes", line.notes ?? "");
    startTransition(async () => {
      await updatePackagingLineMetadata(fd);
    });
    updateLineMeta(line.lineGroupId, {
      category: s.category || null,
      markupPct: num(s.markupPct),
      qtyPerSellableUnit: num(line.qtyPerSellableUnit),
    });
  }

  function scheduleMetaSave(overrides: Partial<{
    supplier: string;
    category: string;
    markupPct: string;
  }>) {
    if (supplierDebounce.current) clearTimeout(supplierDebounce.current);
    supplierDebounce.current = setTimeout(() => fireMetaSave(overrides), DEBOUNCE_MS);
  }

  function handleDelete() {
    if (!confirm("Delete this packaging line?")) return;
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    startTransition(async () => {
      await deletePackagingLine(fd);
    });
  }

  // Component name = supplier + qty/unit hint, fallback "Untitled line"
  const lineName = supplier || "Untitled line";
  const skuLabel = sku?.skuLabel ?? "";
  const productName = sku?.productName ?? "";

  return (
    <div className="r6-dt-row">
      {/* Component name + sub (SKU + qty/unit + inv-eligible badge) */}
      <div className="name">
        <span className="lab">{lineName}</span>
        {(skuLabel || productName) && (
          <span className="sub">
            {skuLabel}
            {skuLabel && productName ? " · " : ""}
            {productName}
            {line.qtyPerSellableUnit ? ` · ${line.qtyPerSellableUnit}/unit` : ""}
          </span>
        )}
        {line.inventoryEligible && (
          <div className="r6-badges" style={{ marginTop: 4 }}>
            <span className="r6-badge accent">inventory-eligible</span>
          </div>
        )}
      </div>

      {/* Category — inline editable select */}
      <div className="cat">
        <select
          value={category}
          disabled={disabled || pending}
          onChange={(e) => {
            const v = e.target.value;
            setCategory(v);
            // Auto-fill markup from category default
            const cat = categories.find((c) => c.category === v);
            if (cat) {
              setMarkupPct(cat.defaultMarkupPct);
              scheduleMetaSave({ category: v, markupPct: cat.defaultMarkupPct });
            } else {
              scheduleMetaSave({ category: v });
            }
          }}
          style={{
            background: "transparent",
            border: "none",
            font: "inherit",
            color: "inherit",
            letterSpacing: "inherit",
            cursor: disabled ? "not-allowed" : "pointer",
            padding: 0,
            width: "100%",
          }}
        >
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category}
            </option>
          ))}
        </select>
      </div>

      {/* Supplier — inline editable text */}
      <div className="sup">
        <input
          type="text"
          value={supplier}
          disabled={disabled || pending}
          onChange={(e) => {
            const v = e.target.value;
            setSupplier(v);
            scheduleMetaSave({ supplier: v });
          }}
          placeholder="—"
          style={{
            background: "transparent",
            border: "none",
            font: "inherit",
            color: "inherit",
            padding: 0,
            width: "100%",
          }}
        />
      </div>

      {/* Markup % chip — inline editable number */}
      <div className="num">
        <span className="markup">
          <input
            type="number"
            step="0.01"
            min={0}
            value={markupPct === "" ? "" : (Number(markupPct) * 100).toString()}
            disabled={disabled || pending}
            onChange={(e) => {
              const v = e.target.value;
              const decimal = v === "" ? "" : (Number(v) / 100).toString();
              setMarkupPct(decimal);
              scheduleMetaSave({ markupPct: decimal });
            }}
            placeholder="—"
            style={{
              background: "transparent",
              border: "none",
              font: "inherit",
              color: "inherit",
              width: "32px",
              textAlign: "right",
              padding: 0,
            }}
          />
          %
        </span>
      </div>

      {/* Per-tier cells */}
      {tiers.map((t) => (
        <PackagingTierCell
          key={t.id}
          tierId={t.id}
          line={line}
          markupPct={markupPct}
          isActive={activeTierId === t.id}
          disabled={disabled}
        />
      ))}

      {/* Actions */}
      <div className="actions">
        <button
          type="button"
          onClick={handleDelete}
          disabled={disabled || pending}
          title="Delete line"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ink-3)",
            cursor: "pointer",
            padding: "0 4px",
            fontFamily: "var(--mono)",
            fontSize: "14px",
          }}
        >
          ···
        </button>
      </div>
    </div>
  );
}

function PackagingTierCell({
  tierId,
  line,
  markupPct,
  isActive,
  disabled,
}: {
  tierId: string;
  line: LineForUI;
  markupPct: string;
  isActive: boolean;
  disabled: boolean;
}) {
  const cell = line.cells.get(tierId);
  const [pending, startTransition] = useTransition();
  const updatePackagingCell = useCostingStore(selectUpdatePackagingCell);
  const [unitCost, setUnitCost] = useState(cell?.unitCost ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(unitCost);
  valueRef.current = unitCost;

  const initialRowId = useRef(cell?.rowId);
  useEffect(() => {
    if (cell?.rowId !== initialRowId.current) {
      initialRowId.current = cell?.rowId;
      setUnitCost(cell?.unitCost ?? "");
    }
  }, [cell?.rowId, cell?.unitCost]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  if (!cell) {
    return <span className="cell-num empty">—</span>;
  }

  function fireSave() {
    if (!cell) return;
    const fd = new FormData();
    fd.set("rowId", cell.rowId);
    fd.set("unitCost", valueRef.current);
    fd.set("purchaseQty", "");
    startTransition(async () => {
      await updatePackagingTierCell(fd);
    });
  }

  function handleChange(value: string) {
    setUnitCost(value);
    if (cell) {
      const numeric = num(value);
      updatePackagingCell(cell.rowId, { unitCost: numeric });
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(fireSave, DEBOUNCE_MS);
  }

  // Computed per-tier landed value displayed alongside the unit_cost input
  const u = num(unitCost);
  const m = num(markupPct) ?? 0;
  const q = num(line.qtyPerSellableUnit) ?? 1;
  const landed = u !== null ? u * (1 + m) * q : null;

  const isEmpty = u === null;

  return (
    <span
      className={`cell-num ${isEmpty ? "empty" : ""}`}
      style={isActive ? { background: "var(--accent-soft)" } : undefined}
    >
      <input
        type="number"
        step="0.0001"
        min={0}
        value={unitCost}
        disabled={disabled || pending}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="—"
        style={{
          background: "transparent",
          border: "none",
          font: "inherit",
          color: "inherit",
          width: "100%",
          textAlign: "right",
          padding: 0,
        }}
      />
      {landed !== null && (
        <span
          className="raw"
          title={`Landed: cost × (1+${(m * 100).toFixed(0)}%) × ${q}/unit`}
        >
          → {fmtCurr2(landed)}
        </span>
      )}
    </span>
  );
}
