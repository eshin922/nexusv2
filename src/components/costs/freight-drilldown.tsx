"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { quoteSkus } from "@/db/schema";
import { AddFreightLineButton } from "@/app/projects/[id]/quotes/[quoteId]/freight/add-line-button";
import { CustomsRow } from "@/app/projects/[id]/quotes/[quoteId]/freight/customs-row";
import {
  deleteFreightLine,
  updateFreightLineMetadata,
  updateFreightTierCell,
} from "@/app/actions/freight";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectActiveTierId,
  selectUpdateFreightCell,
  selectUpdateFreightLineMeta,
} from "@/lib/costing-store";

type QuoteSku = typeof quoteSkus.$inferSelect;

// Slice RI.4 — Freight drill-down per R6 source
// (`docs/design-prototypes/dist/source/round-6/freight-drawer.jsx`).
//
// Composition: per-line cards (.r6-fr-line) with head bar
// (label + meta + treatment toggle) + per-tier rollup row +
// customs sub-card when treatment = bundled. Customs data lives on
// quote_skus (cbm/duty/tariff) per SKU, not per freight line — so
// customs sub-card sources from the line's owning SKU.

type FreightInputRow = {
  freight_inputs: {
    id: string;
    quoteSkuId: string;
    tierId: string;
    lineGroupId: string;
    sortOrder: number;
    shipmentId: string | null;
    supplier: string | null;
    freightMode:
      | "parcel"
      | "ltl"
      | "ftl"
      | "ocean"
      | "air"
      | "courier"
      | "other"
      | null;
    freightTreatment: "bundled" | "pass_through";
    markupPct: string | null;
    notes: string | null;
    totalFreight: string | null;
    unitsInShipment: number | null;
    skuTotalCbm: string | null;
  };
};

type FreightLineForUI = {
  lineGroupId: string;
  quoteSkuId: string;
  sortOrder: number;
  shipmentId: string | null;
  supplier: string | null;
  freightMode:
    | "parcel"
    | "ltl"
    | "ftl"
    | "ocean"
    | "air"
    | "courier"
    | "other"
    | null;
  freightTreatment: "bundled" | "pass_through";
  markupPct: string | null;
  notes: string | null;
  cells: Map<
    string,
    {
      rowId: string;
      totalFreight: string | null;
      unitsInShipment: number | null;
      skuTotalCbm: string | null;
    }
  >;
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

export function FreightDrilldown({
  skus,
  tiers,
  inputRows,
  editable,
}: {
  skus: QuoteSku[];
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  inputRows: FreightInputRow[];
  editable: boolean;
}) {
  const skuMap = new Map(skus.map((s) => [s.id, s]));
  const linesById = new Map<string, FreightLineForUI>();
  for (const r of inputRows) {
    const row = r.freight_inputs;
    let line = linesById.get(row.lineGroupId);
    if (!line) {
      line = {
        lineGroupId: row.lineGroupId,
        quoteSkuId: row.quoteSkuId,
        sortOrder: row.sortOrder,
        shipmentId: row.shipmentId,
        supplier: row.supplier,
        freightMode: row.freightMode,
        freightTreatment: row.freightTreatment,
        markupPct: row.markupPct,
        notes: row.notes,
        cells: new Map(),
      };
      linesById.set(row.lineGroupId, line);
    }
    line.cells.set(row.tierId, {
      rowId: row.id,
      totalFreight: row.totalFreight,
      unitsInShipment: row.unitsInShipment,
      skuTotalCbm: row.skuTotalCbm,
    });
  }
  const lines = Array.from(linesById.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  const leafSkus = skus.filter((s) => s.skuRole === "leaf");

  if (tiers.length === 0) {
    return (
      <div className="rounded border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
        Add at least one tier to the quote before entering freight inputs.
      </div>
    );
  }

  if (leafSkus.length === 0) {
    return (
      <div className="r6-empty-drawer">
        <div className="glyph">∅</div>
        <h4>No leaf SKUs yet</h4>
        <p>Add at least one leaf SKU to the quote before entering freight inputs.</p>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="r6-empty-drawer">
        <div className="glyph">∅</div>
        <h4>No freight lines yet</h4>
        <p>
          Add inbound (raws → CM) and outbound (CM → customer) shipments. Each
          line can be bundled into the unit cost or passed through as a
          separate billable.
        </p>
        <div className="actions">
          <AddFreightLineButton
            quoteSkuId={leafSkus[0].id}
            disabled={!editable}
          />
        </div>
      </div>
    );
  }

  const bundledCount = lines.filter((l) => l.freightTreatment === "bundled").length;
  const passCount = lines.filter((l) => l.freightTreatment === "pass_through").length;

  return (
    <div>
      <div className="r6-drawer-toolbar">
        <div className="lhs">
          <span>
            <strong>{lines.length}</strong> freight line
            {lines.length === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>
            <strong>{bundledCount}</strong> bundled,{" "}
            <strong>{passCount}</strong> passthrough
          </span>
          <span>·</span>
          <span>Treatment is per-line, not section-wide</span>
        </div>
        <div className="rhs">
          <AddFreightLineButton
            quoteSkuId={leafSkus[0].id}
            disabled={!editable}
          />
        </div>
      </div>

      {lines.map((line) => (
        <FreightLineCard
          key={line.lineGroupId}
          line={line}
          tiers={tiers}
          sku={skuMap.get(line.quoteSkuId)}
          disabled={!editable}
        />
      ))}
    </div>
  );
}

function FreightLineCard({
  line,
  tiers,
  sku,
  disabled,
}: {
  line: FreightLineForUI;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  sku: QuoteSku | undefined;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const updateFreightLineMeta = useCostingStore(selectUpdateFreightLineMeta);

  const [supplier, setSupplier] = useState(line.supplier ?? "");
  const [treatment, setTreatment] = useState<"bundled" | "pass_through">(
    line.freightTreatment,
  );
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ supplier, treatment });
  stateRef.current = { supplier, treatment };

  useEffect(() => {
    setSupplier(line.supplier ?? "");
    setTreatment(line.freightTreatment);
  }, [line.lineGroupId, line.supplier, line.freightTreatment]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  function fireMetaSave(overrides: Partial<{
    supplier: string;
    treatment: "bundled" | "pass_through";
  }> = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("supplier", s.supplier);
    fd.set("freightMode", line.freightMode ?? "");
    fd.set("freightTreatment", s.treatment);
    fd.set("markupPct", line.markupPct ?? "");
    fd.set("notes", line.notes ?? "");
    fd.set("shipmentId", line.shipmentId ?? "");
    startTransition(async () => {
      await updateFreightLineMetadata(fd);
    });
    updateFreightLineMeta(line.lineGroupId, {
      freightTreatment: s.treatment,
      markupPct: num(line.markupPct),
    });
  }

  function selectTreatment(t: "bundled" | "pass_through") {
    if (disabled || pending || t === treatment) return;
    setTreatment(t);
    fireMetaSave({ treatment: t });
  }

  function scheduleSupplierSave(value: string) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fireMetaSave({ supplier: value }), DEBOUNCE_MS);
  }

  function handleDelete() {
    if (!confirm("Delete this freight line?")) return;
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    startTransition(async () => {
      await deleteFreightLine(fd);
    });
  }

  const lineLabel = supplier || `Freight line ${line.lineGroupId.slice(0, 8)}`;
  const skuLabel = sku?.skuLabel ?? "—";

  // Customs: duty/tariff per-SKU (quote_skus.dutyPct/tariffPct);
  // cbm per-(SKU, tier) on freight_inputs.skuTotalCbm. cbm is now
  // edited inline per-tier cell (see FreightTierCell). Customs editor
  // (CustomsRow) renders below the tier row when treatment = bundled.
  //
  // Slice RI.8 Option A hotfix — CustomsRow re-wired here after
  // orphaning during the RI.4 /freight → /costs unification.
  const showCustoms = treatment === "bundled";

  return (
    <div className="r6-fr-line">
      <div className="r6-fr-line-head">
        <div className="lhs">
          <input
            type="text"
            value={supplier}
            disabled={disabled || pending}
            onChange={(e) => {
              const v = e.target.value;
              setSupplier(v);
              scheduleSupplierSave(v);
            }}
            placeholder="Supplier / carrier"
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontFamily: "var(--display)",
              fontWeight: 500,
              fontSize: "15.5px",
              color: "var(--ink)",
              letterSpacing: "-0.005em",
              width: "100%",
            }}
          />
          <div className="meta">
            <span>{line.freightMode ?? "mode —"}</span>
            <span className="sep">·</span>
            <span>{skuLabel}</span>
            <span className="sep">·</span>
            <span>DDP</span>
          </div>
        </div>

        <div className="r6-fr-treat">
          <button
            type="button"
            className={treatment === "bundled" ? "on bundled" : ""}
            disabled={disabled || pending}
            onClick={() => selectTreatment("bundled")}
          >
            Bundled
          </button>
          <button
            type="button"
            className={treatment === "pass_through" ? "on pass_through" : ""}
            disabled={disabled || pending}
            onClick={() => selectTreatment("pass_through")}
          >
            Passthrough
          </button>
        </div>

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

      <div
        className="r6-fr-tiers"
        style={{
          gridTemplateColumns: `1.4fr ${tiers.map(() => "1fr").join(" ")}`,
        }}
      >
        <span className="lab">
          {treatment === "bundled"
            ? "Total $ per tier — divided by units → FRT"
            : "Total $ per tier — passed to customer separately"}
        </span>
        {tiers.map((t) => (
          <FreightTierCell
            key={t.id}
            tierId={t.id}
            tierQty={t.qty}
            line={line}
            disabled={disabled}
          />
        ))}
      </div>

      {showCustoms && sku && (
        <div style={{ marginTop: 12 }}>
          <CustomsRow
            quoteSkuId={sku.id}
            dutyPct={sku.dutyPct}
            tariffPct={sku.tariffPct}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

function FreightTierCell({
  tierId,
  tierQty,
  line,
  disabled,
}: {
  tierId: string;
  tierQty: number | null;
  line: FreightLineForUI;
  disabled: boolean;
}) {
  const cell = line.cells.get(tierId);
  const [pending, startTransition] = useTransition();
  const updateFreightCell = useCostingStore(selectUpdateFreightCell);
  const activeTierId = useCostingStore(selectActiveTierId);
  const isActive = activeTierId === tierId;

  const [totalFreight, setTotalFreight] = useState(cell?.totalFreight ?? "");
  // Slice RI.8 Option A hotfix — inline CBM input. cbm is the
  // load-bearing input for the container-freight share math
  // ((sku_total_cbm / total_shipment_cbm) × total_freight). Without
  // it set, freight contribution = 0 regardless of totalFreight.
  // Previously only editable on the orphaned /freight surface.
  const [skuTotalCbm, setSkuTotalCbm] = useState(cell?.skuTotalCbm ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ totalFreight, skuTotalCbm });
  stateRef.current = { totalFreight, skuTotalCbm };

  useEffect(() => {
    setTotalFreight(cell?.totalFreight ?? "");
    setSkuTotalCbm(cell?.skuTotalCbm ?? "");
  }, [cell?.rowId, cell?.totalFreight, cell?.skuTotalCbm]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  if (!cell) {
    return <span className="num empty">—</span>;
  }

  function fireSave() {
    if (!cell) return;
    const s = stateRef.current;
    const fd = new FormData();
    fd.set("rowId", cell.rowId);
    fd.set("totalFreight", s.totalFreight);
    fd.set("unitsInShipment", cell.unitsInShipment?.toString() ?? "");
    fd.set("skuTotalCbm", s.skuTotalCbm);
    startTransition(async () => {
      await updateFreightTierCell(fd);
    });
  }

  function scheduleSave() {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(fireSave, DEBOUNCE_MS);
  }

  function handleFreightChange(value: string) {
    setTotalFreight(value);
    if (cell) updateFreightCell(cell.rowId, { totalFreight: num(value) });
    scheduleSave();
  }
  function handleCbmChange(value: string) {
    setSkuTotalCbm(value);
    if (cell) updateFreightCell(cell.rowId, { skuTotalCbm: num(value) });
    scheduleSave();
  }

  const total = num(totalFreight);
  const units = cell.unitsInShipment ?? tierQty ?? 0;
  const perUnit = total !== null && units > 0 ? total / units : null;
  const cbmNum = num(skuTotalCbm);

  return (
    <span
      className={`num ${perUnit === null ? "empty" : ""}`}
      style={
        isActive
          ? { background: "var(--accent-soft)", display: "block" }
          : { display: "block" }
      }
    >
      <span
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "flex-end",
          gap: 4,
        }}
      >
        <span style={{ color: "var(--ink-4)", fontSize: 9 }}>$</span>
        <input
          type="number"
          step="0.01"
          min={0}
          value={totalFreight}
          disabled={disabled || pending}
          onChange={(e) => handleFreightChange(e.target.value)}
          placeholder="total $"
          aria-label="Total freight $ for this shipment"
          title="Total freight cost for this shipment (NOT per-unit — the per-unit value is derived below as $total ÷ tier units)"
          style={{
            background: "transparent",
            border: "none",
            font: "inherit",
            color: "inherit",
            width: "62px",
            textAlign: "right",
            padding: 0,
          }}
        />
      </span>
      {perUnit !== null && (
        <span className="raw">
          {fmtCurr2(perUnit)}/u · ${total?.toLocaleString()} ÷ {units.toLocaleString()}
        </span>
      )}
      <span
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "flex-end",
          gap: 4,
          marginTop: 2,
        }}
      >
        <input
          type="number"
          step="0.0001"
          min={0}
          value={skuTotalCbm}
          disabled={disabled || pending}
          onChange={(e) => handleCbmChange(e.target.value)}
          placeholder="—"
          aria-label="SKU CBM"
          title="SKU's CBM share of the shipment (m³). Required for container-freight math."
          style={{
            background: "transparent",
            border: "1px dotted var(--rule)",
            borderRadius: 3,
            font: "inherit",
            color: "var(--ink-3)",
            fontSize: "10.5px",
            width: "62px",
            textAlign: "right",
            padding: "1px 3px",
          }}
        />
        <span
          style={{
            color: "var(--ink-4)",
            fontFamily: "var(--mono)",
            fontSize: 9,
          }}
        >
          m³
        </span>
      </span>
      {cbmNum !== null && cbmNum > 0 && (
        <span
          className="raw"
          style={{ fontSize: 9, color: "var(--ink-4)" }}
        >
          CBM share
        </span>
      )}
    </span>
  );
}
