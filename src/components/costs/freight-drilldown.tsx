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
  // Slice RI.8 freight-markup feature — per-line markup % editable.
  // Display convention: percent display (e.g. "15" for 15%); action
  // layer divides by 100 to store as decimal. Same convention as
  // packaging line markup + duty/tariff.
  const markupDisplay = (() => {
    if (line.markupPct === null) return "";
    const n = Number(line.markupPct) * 100;
    if (!Number.isFinite(n)) return "";
    return Number(n.toFixed(4)).toString();
  })();
  const [markup, setMarkup] = useState(markupDisplay);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ supplier, treatment, markup });
  stateRef.current = { supplier, treatment, markup };

  useEffect(() => {
    setSupplier(line.supplier ?? "");
    setTreatment(line.freightTreatment);
    setMarkup(markupDisplay);
    // markupDisplay is derived from line.markupPct; dep-array uses
    // the source field rather than the derived value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.lineGroupId, line.supplier, line.freightTreatment, line.markupPct]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  function fireMetaSave(overrides: Partial<{
    supplier: string;
    treatment: "bundled" | "pass_through";
    markup: string;
  }> = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("supplier", s.supplier);
    fd.set("freightMode", line.freightMode ?? "");
    fd.set("freightTreatment", s.treatment);
    // markupPct is sent in PERCENT display form ("15" for 15%); the
    // action layer divides by 100 to store as decimal.
    fd.set("markupPct", s.markup);
    fd.set("notes", line.notes ?? "");
    fd.set("shipmentId", line.shipmentId ?? "");
    startTransition(async () => {
      await updateFreightLineMetadata(fd);
    });
    const markupDecimal =
      s.markup === "" ? null : Number(s.markup) / 100;
    updateFreightLineMeta(line.lineGroupId, {
      freightTreatment: s.treatment,
      markupPct: Number.isFinite(markupDecimal) ? markupDecimal : null,
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

  // Markup commits on blur/Enter per Slice RI.8 keystroke-focus
  // pattern (same as totalFreight, duty, tariff). Local state
  // updates on every keystroke; persist at commit boundaries.
  //
  // Edward smoke fix: read DOM value via e.currentTarget.value rather
  // than the `markup` closure variable. React state updates from
  // onChange are batched; when blur fires in the same synthetic task
  // (e.g., user types then immediately tabs), the closure-captured
  // `markup` can be stale relative to what's in the DOM. Reading from
  // the event target is closure-safe.
  function handleMarkupBlur(e: React.FocusEvent<HTMLInputElement>) {
    const currentValue = e.currentTarget.value;
    if (currentValue === markupDisplay) return; // no change
    fireMetaSave({ markup: currentValue });
  }
  function handleMarkupKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
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
          // Slice RI.8 freight-markup feature — MARKUP column inserted
          // between label + tier cells, mirroring packaging-drilldown's
          // table-head "Markup" column placement. Container-only
          // application; D+T pass through at customs rate.
          gridTemplateColumns: `1.4fr 130px ${tiers.map(() => "1fr").join(" ")}`,
        }}
      >
        <span className="lab">
          {treatment === "bundled"
            ? "Total $ per tier — divided by units → FRT"
            : "Total $ per tier — passed to customer separately"}
        </span>
        <label
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            justifyContent: "flex-end",
            gap: 4,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-3)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
          title="Freight markup % — applied to container freight only; duty + tariff pass through at customs-stated rate."
        >
          <span style={{ color: "var(--ink-4)" }}>Markup</span>
          <input
            type="number"
            step="1"
            min={0}
            value={markup}
            disabled={disabled || pending}
            onChange={(e) => setMarkup(e.target.value)}
            onBlur={handleMarkupBlur}
            onKeyDown={handleMarkupKeyDown}
            placeholder="—"
            aria-label="Freight markup percent"
            style={{
              background: "transparent",
              border: "1px dotted var(--rule)",
              borderRadius: 3,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink)",
              width: 48,
              textAlign: "right",
              padding: "1px 4px",
            }}
          />
          <span style={{ color: "var(--ink-4)" }}>%</span>
        </label>
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
  const valueRef = useRef(totalFreight);
  valueRef.current = totalFreight;

  // Slice RI.8 hotfix — blur+Enter save (replaces debounced-on-change).
  // Edward's UX call: numeric autosave on keystroke was making the
  // input lose focus mid-typing for PMs entering multi-digit numbers.
  // New pattern: save fires only on blur (tab out / click away) OR
  // when the user hits Enter. Local state updates on every keystroke
  // so the input renders correctly; the store + DB persist only at
  // commit boundaries. Smoke: type "10000" with pauses → focus
  // retained → Enter commits → tab commits.
  useEffect(() => {
    setTotalFreight(cell?.totalFreight ?? "");
  }, [cell?.rowId, cell?.totalFreight]);

  if (!cell) {
    return <span className="num empty">—</span>;
  }

  function fireSave() {
    if (!cell) return;
    // No-op if the value hasn't changed since last save
    if (valueRef.current === (cell.totalFreight ?? "")) return;
    const fd = new FormData();
    fd.set("rowId", cell.rowId);
    fd.set("totalFreight", valueRef.current);
    fd.set("unitsInShipment", cell.unitsInShipment?.toString() ?? "");
    // Slice RI.8 hotfix — CBM input removed from per-tier cell per
    // Edward's UX call. Awkward placement + redundant across tiers.
    // Sending the existing value through unchanged on save so the
    // row's saved CBM (if any) survives. Equal-allocation fallback
    // math in costing.ts handles the no-CBM case correctly. Future
    // work: single unit-CBM input per SKU on Setup or Costs surface;
    // logged in UX_BACKLOG.
    fd.set("skuTotalCbm", cell.skuTotalCbm ?? "");
    // Optimistic store push fires here, NOT on every keystroke —
    // keeps cost-stack + section header in sync at commit time.
    if (cell) updateFreightCell(cell.rowId, { totalFreight: num(valueRef.current) });
    startTransition(async () => {
      await updateFreightTierCell(fd);
    });
  }

  function handleFreightChange(value: string) {
    setTotalFreight(value);
  }

  function handleFreightKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  const total = num(totalFreight);
  const units = cell.unitsInShipment ?? tierQty ?? 0;
  const perUnit = total !== null && units > 0 ? total / units : null;
  // Slice RI.8 freight-markup feature — display marked-up per-unit
  // below raw per-unit (mirrors packaging line "raw → marked-up"
  // pattern). Container-only markup; D+T pass through. When markup
  // is 0/null, marked-up equals raw and the arrow row is suppressed.
  const lineMarkup = num(line.markupPct) ?? 0;
  const markedUpPerUnit =
    perUnit !== null && lineMarkup > 0 ? perUnit * (1 + lineMarkup) : null;

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
          step="1"
          min={0}
          value={totalFreight}
          disabled={disabled || pending}
          onChange={(e) => handleFreightChange(e.target.value)}
          onBlur={fireSave}
          onKeyDown={handleFreightKeyDown}
          placeholder="total $"
          aria-label="Total freight $ for this shipment"
          title="Total freight cost for this shipment (NOT per-unit). Save on tab/click-out or Enter."
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
        <span
          className="raw"
          title={
            total !== null
              ? `${fmtCurr2(perUnit)}/u · $${total.toLocaleString()} ÷ ${units.toLocaleString()} units`
              : undefined
          }
        >
          {fmtCurr2(perUnit)}/u
        </span>
      )}
      {markedUpPerUnit !== null && (
        <span
          className="raw"
          style={{ color: "var(--ink-3)", display: "block" }}
          title={`Marked-up per-unit = ${fmtCurr2(perUnit ?? 0)} × (1 + ${(lineMarkup * 100).toFixed(0)}%)`}
        >
          → {fmtCurr2(markedUpPerUnit)}
        </span>
      )}
    </span>
  );
}
