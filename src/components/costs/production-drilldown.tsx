"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { buildTreeRenderOrder, type SkuRow } from "@/lib/sku-tree";
import {
  updateAssemblyProductionPolicy,
  upsertAssemblyProductionInputs,
} from "@/app/actions/assembly-production-inputs";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectActiveTierId,
  selectUpdateProductionCell,
} from "@/lib/costing-store";

// Step 8 — drilldown consumes the structural SkuRow shape from
// sku-tree.ts (replaced typeof quoteSkus.$inferSelect dependency).
type QuoteSku = SkuRow;

// Slice RI.4 — Production drill-down per R6 source
// (`docs/design-prototypes/dist/source/round-6/production-drawer.jsx`).
//
// CC schema treats production as fixed cost fields per (SKU, tier);
// R6 treats production as variable lines per section. Bridge: map
// each fixed cost field to a virtual "line" with R6 line metadata
// (kind, category). Six virtual lines per SKU:
//   1. Filling/blending — per-unit, Manufacturing
//   2. CM assembly      — per-unit, Manufacturing
//   3. Setup fee        — NRE, Tooling
//   4. Tooling/artwork  — NRE, Tooling
//   5. R&D              — NRE, R&D
//   6. Other services   — per-unit, Other
// (bulk_raw_cost is a separate row only when raws_mode = cm_sources;
//  in dps_sources mode it lives in Bulk Raw section, in
//  customer_supplies mode it's excluded.)
//
// Per-SKU: render one r6-dt.prod table per leaf SKU. Multi-SKU
// quotes render multiple stacked tables (one per leaf SKU).

type ProductionInputRow = {
  production_inputs: {
    id: string;
    quoteSkuId: string;
    tierId: string;
    customerShipsRaws: boolean;
    allocateServiceFeesToCost: boolean;
    notes: string | null;
    fillingBlendingCost: string | null;
    cmAssemblyTotal: string | null;
    setupFeeTotal: string | null;
    toolingArtworkTotal: string | null;
    rdTotal: string | null;
    otherServiceTotal: string | null;
    bulkRawCost: string | null;
    actualUnitsProduced: number | null;
  };
};

type ProdRowForUI = {
  rowId: string;
  tierId: string;
  fillingBlendingCost: string | null;
  cmAssemblyTotal: string | null;
  setupFeeTotal: string | null;
  toolingArtworkTotal: string | null;
  rdTotal: string | null;
  otherServiceTotal: string | null;
  bulkRawCost: string | null;
  actualUnitsProduced: number | null;
};

type SkuPolicy = {
  customerShipsRaws: boolean;
  allocateServiceFeesToCost: boolean;
  notes: string | null;
};

type CostField =
  | "fillingBlendingCost"
  | "cmAssemblyTotal"
  | "setupFeeTotal"
  | "toolingArtworkTotal"
  | "rdTotal"
  | "otherServiceTotal"
  | "bulkRawCost";

type VirtualLine = {
  field: CostField;
  name: string;
  category: string;
  kind: "per_unit" | "amortized_nre";
};

const VIRTUAL_LINES: VirtualLine[] = [
  { field: "fillingBlendingCost", name: "Filling / blending", category: "Manufacturing", kind: "per_unit" },
  { field: "cmAssemblyTotal", name: "CM assembly", category: "Manufacturing", kind: "per_unit" },
  { field: "setupFeeTotal", name: "Setup fee", category: "Tooling", kind: "amortized_nre" },
  { field: "toolingArtworkTotal", name: "Tooling / artwork", category: "Tooling", kind: "amortized_nre" },
  { field: "rdTotal", name: "R&D", category: "R&D", kind: "amortized_nre" },
  { field: "otherServiceTotal", name: "Other services", category: "Other", kind: "per_unit" },
];

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

export function ProductionDrilldown({
  skus,
  tiers,
  inputRows,
  editable,
  rawsMode,
}: {
  skus: QuoteSku[];
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  inputRows: ProductionInputRow[];
  editable: boolean;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
}) {
  const rowsBySku = new Map<string, Map<string, ProdRowForUI>>();
  const policyBySku = new Map<string, SkuPolicy>();
  for (const r of inputRows) {
    const row = r.production_inputs;
    let byTier = rowsBySku.get(row.quoteSkuId);
    if (!byTier) {
      byTier = new Map();
      rowsBySku.set(row.quoteSkuId, byTier);
    }
    byTier.set(row.tierId, {
      rowId: row.id,
      tierId: row.tierId,
      fillingBlendingCost: row.fillingBlendingCost,
      cmAssemblyTotal: row.cmAssemblyTotal,
      setupFeeTotal: row.setupFeeTotal,
      toolingArtworkTotal: row.toolingArtworkTotal,
      rdTotal: row.rdTotal,
      otherServiceTotal: row.otherServiceTotal,
      bulkRawCost: row.bulkRawCost,
      actualUnitsProduced: row.actualUnitsProduced,
    });
    if (!policyBySku.has(row.quoteSkuId)) {
      policyBySku.set(row.quoteSkuId, {
        customerShipsRaws: row.customerShipsRaws,
        allocateServiceFeesToCost: row.allocateServiceFeesToCost,
        notes: row.notes,
      });
    }
  }

  const leafSkus = skus.filter((s) => s.skuRole === "leaf");

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
        Add at least one tier to the quote before entering production inputs.
      </div>
    );
  }

  if (leafSkus.length === 0) {
    return (
      <div className="r6-empty-drawer">
        <div className="glyph">∅</div>
        <h4>No leaf SKUs yet</h4>
        <p>Add at least one leaf SKU to the quote before entering production inputs.</p>
      </div>
    );
  }

  const firstLeaf = leafSkus[0];
  const sectionPolicy = policyBySku.get(firstLeaf.id) ?? {
    customerShipsRaws: false,
    allocateServiceFeesToCost: true,
    notes: null,
  };

  // Section-wide actuals — read first SKU's first tier
  const firstSkuRows = rowsBySku.get(firstLeaf.id);
  const firstTierRow = firstSkuRows?.values().next().value;
  const actualUnitsProduced = firstTierRow?.actualUnitsProduced ?? null;
  const yieldLocked = actualUnitsProduced !== null;

  // Lines visible — bulk_raw_cost only when raws_mode = cm_sources
  const visibleLines: VirtualLine[] = [
    ...VIRTUAL_LINES,
    ...(rawsMode === "cm_sources"
      ? [
          {
            field: "bulkRawCost" as CostField,
            name: "Bulk raw cost",
            category: "Manufacturing",
            kind: "per_unit" as const,
          },
        ]
      : []),
  ];

  return (
    <div>
      <SectionToggles
        leafSkus={leafSkus}
        policy={sectionPolicy}
        disabled={!editable}
        rawsMode={rawsMode}
      />

      {/* Canonical .drawer-toolbar inside .r6-drawer (parent applies
          .r6-drawer to the collapsible region). */}
      <div className="drawer-toolbar">
        <div className="lhs">
          <span>
            <strong>{leafSkus.length}</strong> production block
            {leafSkus.length === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>
            Service fees:{" "}
            <strong>
              {sectionPolicy.allocateServiceFeesToCost
                ? "amortized"
                : "billed separately"}
            </strong>
          </span>
        </div>
      </div>

      {/* Per-leaf-SKU production block */}
      {buildTreeRenderOrder(skus).map(({ sku, depth }) => {
        const indentStyle = { marginLeft: `${depth * 24}px` };
        const isAssembly = sku.skuRole === "assembly";

        if (isAssembly) {
          return (
            <div
              key={sku.id}
              style={{
                ...indentStyle,
                marginBottom: "12px",
                padding: "10px 14px",
                background: "oklch(from var(--accent) l c h / 0.05)",
                border: "1px solid oklch(from var(--accent) l c h / 0.30)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontSize: "13px",
              }}
            >
              <span className="r6-badge accent">Assembly</span>
              <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                {sku.skuLabel}
              </span>
              <span style={{ color: "var(--ink-3)" }}>· {sku.productName}</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "11px",
                  color: "var(--ink-3)",
                }}
              >
                Production rolls up from leaf children.
              </span>
            </div>
          );
        }

        const policy = policyBySku.get(sku.id) ?? sectionPolicy;
        const rowsByTier = rowsBySku.get(sku.id) ?? new Map();

        return (
          <div key={sku.id} style={{ ...indentStyle, marginBottom: "14px" }}>
            <SkuLabel sku={sku} />
            <ProductionTable
              sku={sku}
              policy={policy}
              tiers={tiers}
              rowsByTier={rowsByTier}
              visibleLines={visibleLines}
              disabled={!editable}
            />
          </div>
        );
      })}

      <PostProdReconcile
        actualUnitsProduced={actualUnitsProduced}
        yieldLocked={yieldLocked}
        firstTierQty={tiers[0]?.qty ?? null}
      />
    </div>
  );
}

function SkuLabel({ sku }: { sku: QuoteSku }) {
  return (
    <div
      style={{
        marginBottom: "6px",
        fontFamily: "var(--mono)",
        fontSize: "10px",
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        color: "var(--ink-4)",
      }}
    >
      {sku.skuLabel} · <span style={{ textTransform: "none", letterSpacing: "0.04em", fontSize: "11px", color: "var(--ink-3)" }}>{sku.productName}</span>
    </div>
  );
}

function ProductionTable({
  sku,
  policy,
  tiers,
  rowsByTier,
  visibleLines,
  disabled,
}: {
  sku: QuoteSku;
  policy: SkuPolicy;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  rowsByTier: Map<string, ProdRowForUI>;
  visibleLines: VirtualLine[];
  disabled: boolean;
}) {
  // Per-line × per-tier value computation:
  //   - per-unit lines: raw value as-is
  //   - amortized_nre lines (when allocate=true): NRE total / tier qty
  //   - amortized_nre lines (when allocate=false): NRE total shown,
  //     marked as "billed separately"
  function lineCellValue(
    line: VirtualLine,
    tier: { id: string; qty: number | null },
  ): { display: number | null; raw: number | null; perUnit: boolean } {
    const row = rowsByTier.get(tier.id);
    const raw = num(row?.[line.field] ?? null);
    if (raw === null) return { display: null, raw: null, perUnit: line.kind === "per_unit" };
    if (line.kind === "per_unit") return { display: raw, raw, perUnit: true };
    // amortized_nre
    if (policy.allocateServiceFeesToCost) {
      const tierQty = tier.qty ?? 0;
      const amortized = tierQty > 0 ? raw / tierQty : 0;
      return { display: amortized, raw, perUnit: false };
    }
    return { display: raw, raw, perUnit: false };
  }

  // Tier sums for foot — sum of all visible lines' display values per tier
  const tierSums = tiers.map((t) => {
    let sum = 0;
    let any = false;
    for (const line of visibleLines) {
      const v = lineCellValue(line, t).display;
      if (v !== null) {
        sum += v;
        any = true;
      }
    }
    return { tierId: t.id, value: any ? sum : null };
  });

  return (
    <div
      className="r6-dt prod"
      style={{ ["--cols" as string]: tiers.length } as React.CSSProperties}
    >
      <div className="r6-dt-head">
        <span>Line</span>
        <span>Category</span>
        <span>Supplier</span>
        <span>Kind</span>
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

      {visibleLines.map((line) => (
        <ProductionRow
          key={line.field}
          line={line}
          sku={sku}
          policy={policy}
          tiers={tiers}
          rowsByTier={rowsByTier}
          disabled={disabled}
        />
      ))}

      <div className="r6-dt-foot">
        <span className="total-lab">Total — production</span>
        <span></span>
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
  );
}

function ProductionRow({
  line,
  sku,
  policy,
  tiers,
  rowsByTier,
  disabled,
}: {
  line: VirtualLine;
  sku: QuoteSku;
  policy: SkuPolicy;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  rowsByTier: Map<string, ProdRowForUI>;
  disabled: boolean;
}) {
  const showAmortizedSub =
    line.kind === "amortized_nre" && policy.allocateServiceFeesToCost;
  const showBilledSeparatelySub =
    line.kind === "amortized_nre" && !policy.allocateServiceFeesToCost;

  return (
    <div className="r6-dt-row">
      <div className="name">
        <span className="lab">{line.name}</span>
        {showAmortizedSub && (
          <span className="sub">amortized into per-unit</span>
        )}
        {showBilledSeparatelySub && (
          <span className="sub">billed as one-time charge</span>
        )}
        {!showAmortizedSub && !showBilledSeparatelySub && line.kind === "per_unit" && (
          <span className="sub">priced per unit</span>
        )}
      </div>
      <div className="cat">{line.category}</div>
      <div className="sup">—</div>
      <div>
        <span className="r6-badge">
          {line.kind === "amortized_nre" ? "NRE" : "per-unit"}
        </span>
      </div>
      <div className="num">
        <span className="markup">—</span>
      </div>
      {tiers.map((t) => (
        <ProductionTierCell
          key={t.id}
          line={line}
          sku={sku}
          policy={policy}
          tier={t}
          rowsByTier={rowsByTier}
          disabled={disabled}
        />
      ))}
      <div className="actions">
        <span>···</span>
      </div>
    </div>
  );
}

function ProductionTierCell({
  line,
  sku,
  policy,
  tier,
  rowsByTier,
  disabled,
}: {
  line: VirtualLine;
  sku: QuoteSku;
  policy: SkuPolicy;
  tier: { id: string; label: string; qty: number | null };
  rowsByTier: Map<string, ProdRowForUI>;
  disabled: boolean;
}) {
  const row = rowsByTier.get(tier.id);
  const [pending, startTransition] = useTransition();
  const updateProductionCell = useCostingStore(selectUpdateProductionCell);
  const activeTierId = useCostingStore(selectActiveTierId);
  const isActive = activeTierId === tier.id;

  const initialValue = row?.[line.field] ?? "";
  const [value, setValue] = useState(initialValue);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setValue(row?.[line.field] ?? "");
  }, [row?.rowId, row?.[line.field]]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  function fireSave() {
    if (!row) return;
    const fd = new FormData();
    fd.set("quoteSkuId", sku.id);
    fd.set("tierId", tier.id);
    // Pass all current values; only the target field changes.
    fd.set("fillingBlendingCost", line.field === "fillingBlendingCost" ? valueRef.current : (row.fillingBlendingCost ?? ""));
    fd.set("cmAssemblyTotal", line.field === "cmAssemblyTotal" ? valueRef.current : (row.cmAssemblyTotal ?? ""));
    fd.set("setupFeeTotal", line.field === "setupFeeTotal" ? valueRef.current : (row.setupFeeTotal ?? ""));
    fd.set("toolingArtworkTotal", line.field === "toolingArtworkTotal" ? valueRef.current : (row.toolingArtworkTotal ?? ""));
    fd.set("rdTotal", line.field === "rdTotal" ? valueRef.current : (row.rdTotal ?? ""));
    fd.set("otherServiceTotal", line.field === "otherServiceTotal" ? valueRef.current : (row.otherServiceTotal ?? ""));
    fd.set("bulkRawCost", line.field === "bulkRawCost" ? valueRef.current : (row.bulkRawCost ?? ""));
    fd.set("actualUnitsProduced", row.actualUnitsProduced?.toString() ?? "");
    startTransition(async () => {
      await upsertAssemblyProductionInputs(fd);
    });
  }

  function handleChange(v: string) {
    setValue(v);
    const numeric = num(v);
    // Optimistic store update — pass the field-specific value
    if (row) {
      updateProductionCell(sku.id, tier.id, {
        [line.field]: numeric,
      });
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(fireSave, DEBOUNCE_MS);
  }

  // Display value: per-unit lines show raw; amortized_nre lines show
  // amortized when allocate=true, raw NRE total when allocate=false.
  const raw = num(value);
  const tierQty = tier.qty ?? 0;
  const display =
    raw !== null && line.kind === "amortized_nre" && policy.allocateServiceFeesToCost && tierQty > 0
      ? raw / tierQty
      : raw;

  const isEmpty = display === null || display === 0;

  return (
    <span
      className={`cell-num ${isEmpty ? "empty" : ""}`}
      style={isActive ? { background: "var(--accent-soft)" } : undefined}
    >
      <input
        type="number"
        step="0.01"
        min={0}
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="—"
        title={
          line.kind === "amortized_nre"
            ? policy.allocateServiceFeesToCost
              ? `NRE total $${raw ?? 0}, amortized over ${tierQty.toLocaleString()} units`
              : `NRE total $${raw ?? 0}, billed as one-time`
            : undefined
        }
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
      {line.kind === "amortized_nre" && raw !== null && policy.allocateServiceFeesToCost && tierQty > 0 && (
        <span className="raw">
          → {fmtCurr2(raw / tierQty)}/u
        </span>
      )}
    </span>
  );
}

function SectionToggles({
  leafSkus,
  policy,
  disabled,
  rawsMode,
}: {
  leafSkus: QuoteSku[];
  policy: SkuPolicy;
  disabled: boolean;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
}) {
  const [pending, startTransition] = useTransition();

  function flipToggle(field: "customerShipsRaws" | "allocateServiceFeesToCost") {
    if (disabled || pending) return;
    const newValue = !policy[field];
    startTransition(async () => {
      for (const sku of leafSkus) {
        const fd = new FormData();
        fd.set("quoteSkuId", sku.id);
        fd.set(
          "customerShipsRaws",
          (field === "customerShipsRaws"
            ? newValue
            : policy.customerShipsRaws
          ).toString(),
        );
        fd.set(
          "allocateServiceFeesToCost",
          (field === "allocateServiceFeesToCost"
            ? newValue
            : policy.allocateServiceFeesToCost
          ).toString(),
        );
        fd.set("notes", policy.notes ?? "");
        await updateAssemblyProductionPolicy(fd);
      }
    });
  }

  const customerShipsRawsEffective =
    rawsMode === "customer_supplies" || policy.customerShipsRaws;

  return (
    <div className="r6-prod-toggles">
      <button
        type="button"
        className={`r6-prod-toggle ${customerShipsRawsEffective ? "on" : ""}`}
        onClick={() => flipToggle("customerShipsRaws")}
        disabled={disabled || pending || rawsMode === "customer_supplies"}
        title={
          rawsMode === "customer_supplies"
            ? "Locked ON because Bulk Raw section is set to 'Customer supplies raws'."
            : undefined
        }
      >
        <span className="tog" />
        <div className="body">
          <div className="lab">Customer ships raws</div>
          <div className="desc">
            If ON, packaging components are excluded from the unit cost. Use
            when the customer hands raws to the CM.
          </div>
          <div className="consequence">
            {customerShipsRawsEffective
              ? "→ packaging cost excluded from this quote"
              : "→ packaging cost included as priced"}
          </div>
        </div>
      </button>

      <button
        type="button"
        className={`r6-prod-toggle ${policy.allocateServiceFeesToCost ? "on" : ""}`}
        onClick={() => flipToggle("allocateServiceFeesToCost")}
        disabled={disabled || pending}
      >
        <span className="tog" />
        <div className="body">
          <div className="lab">Allocate service fees to unit cost</div>
          <div className="desc">
            NRE, tooling, and R&amp;D amortize across units. If OFF, they
            invoice separately as one-time charges.
          </div>
          <div className="consequence">
            {policy.allocateServiceFeesToCost
              ? "→ NRE rolled into per-unit (smaller tiers carry more)"
              : "→ NRE invoiced as a separate line on the order"}
          </div>
        </div>
      </button>
    </div>
  );
}

function PostProdReconcile({
  actualUnitsProduced,
  yieldLocked,
  firstTierQty,
}: {
  actualUnitsProduced: number | null;
  yieldLocked: boolean;
  firstTierQty: number | null;
}) {
  return (
    <div className="r6-post-prod">
      <div className="r6-post-prod-head">
        <h4>Post-production reconcile</h4>
        <div className="meta">
          {yieldLocked ? "Locked · run complete" : "Pre-run · awaiting actuals"}
        </div>
      </div>
      <p className="desc">
        After the run, log actuals to reconcile NRE per-unit. Production yield
        (units actually filled vs. ordered) feeds NRE re-amortization. Formula
        yield (mass-axis reconcile) lands when raws math layer extends.
      </p>
      <div className="r6-yield-split">
        <div className={`r6-yield-block ${yieldLocked ? "locked" : ""}`}>
          <div className="r6-yield-block-head">
            <h5>Production yield</h5>
            <span className="axis">units</span>
          </div>
          <p className="desc">
            How many units actually came off the line, vs. quoted. Drives NRE
            per-unit reconciliation and any tier-bracket movement.
          </p>
          <div className="r6-yield-block-grid">
            <div className="r6-yield-block-cell">
              <div className="lab">Actual units produced</div>
              <div className={`val ${actualUnitsProduced === null ? "empty" : ""}`}>
                {actualUnitsProduced === null
                  ? "—"
                  : actualUnitsProduced.toLocaleString()}
              </div>
              {actualUnitsProduced !== null && firstTierQty !== null && firstTierQty > 0 && (
                <div
                  className={`delta ${
                    actualUnitsProduced < firstTierQty ? "neg" : "pos"
                  }`}
                >
                  {actualUnitsProduced > firstTierQty ? "+" : ""}
                  {(
                    ((actualUnitsProduced - firstTierQty) / firstTierQty) *
                    100
                  ).toFixed(1)}
                  % vs. quoted
                </div>
              )}
            </div>
            <div className="r6-yield-block-cell">
              <div className="lab">NRE per-unit delta</div>
              <div className={`val ${yieldLocked ? "" : "empty"}`}>—</div>
            </div>
          </div>
        </div>

        <div className="r6-yield-block">
          <div className="r6-yield-block-head">
            <h5>Formula yield</h5>
            <span className="axis">mass</span>
          </div>
          <p className="desc">
            Mass-axis yield (consumed vs. ordered, consumed vs. theoretical)
            lands when raws math layer extension ships.
          </p>
          <div className="r6-yield-block-grid">
            <div className="r6-yield-block-cell">
              <div className="lab">Mass consumed vs. ordered</div>
              <div className="val empty">—</div>
            </div>
            <div className="r6-yield-block-cell">
              <div className="lab">Mass consumed vs. theoretical</div>
              <div className="val empty">—</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
