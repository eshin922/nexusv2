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
  selectGraph,
  selectUpdateProductionCell,
} from "@/lib/costing-store";
import { nodeKey, resolveNodes } from "@/lib/costing-nodes";

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
//   1. Filling/blending — tier-total COGS, Manufacturing
//   2. CM assembly      — tier-total COGS, Manufacturing
//   3. Setup fee        — NRE, Tooling
//   4. Tooling/artwork  — NRE, Tooling
//   5. R&D              — NRE, R&D
//   6. Other services   — one-time fee total, Other
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
  kind: "tier_total_cogs" | "one_time_fee";
};

const VIRTUAL_LINES: VirtualLine[] = [
  { field: "fillingBlendingCost", name: "Filling / blending tier total", category: "Manufacturing", kind: "tier_total_cogs" },
  { field: "cmAssemblyTotal", name: "CM assembly tier total", category: "Manufacturing", kind: "tier_total_cogs" },
  { field: "setupFeeTotal", name: "Setup fee total", category: "Tooling", kind: "one_time_fee" },
  { field: "toolingArtworkTotal", name: "Tooling / artwork total", category: "Tooling", kind: "one_time_fee" },
  { field: "rdTotal", name: "R&D fee total", category: "R&D", kind: "one_time_fee" },
  { field: "otherServiceTotal", name: "Other service fee total", category: "Other", kind: "one_time_fee" },
];

const DEBOUNCE_MS = 500;

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A resolved markup rate, as the operator reads it: `32.0%`. */
function fmtPct1(v: number): string {
  return (v * 100).toFixed(1) + "%";
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

  // V1 Costs defect repair (2026-08-11) — allocation policy is ASSEMBLY-scoped.
  //
  // `assembly_production_inputs.allocate_service_fees_to_cost` is keyed by
  // `assembly_id`; costing consumes it per assembly and so does the
  // customer-view resolver. The UI was the outlier: one section-level control,
  // read from the first leaf and broadcast to every assembly on change. An
  // operator could not express A=ON / B=OFF, which the model has always
  // supported.
  //
  // `policyBySku` is keyed by the ANCHOR LEAF (the adapter's per-assembly ->
  // per-leaf coercion puts production data on the lowest-position child), so an
  // assembly's own policy is read through its first child that has one.
  const policyByAssembly = new Map<string, SkuPolicy>();
  for (const asm of skus) {
    if (asm.skuRole !== "assembly") continue;
    for (const child of skus) {
      if (child.parentSkuId !== asm.id) continue;
      const p = policyBySku.get(child.id);
      if (p) {
        policyByAssembly.set(asm.id, p);
        break;
      }
    }
  }

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
            kind: "tier_total_cogs" as const,
          },
        ]
      : []),
  ];

  return (
    <div>
      <SectionToggles
        // Post-Slice-11.5 fix (2026-07-15) — pass ASSEMBLIES not
        // leaves. assembly_production_inputs is keyed by assembly_id
        // so the toggle action needs assembly IDs to find rows.
        assemblies={skus.filter((s) => s.skuRole === "assembly")}
        policy={sectionPolicy}
        policyByAssembly={policyByAssembly}
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
            <div key={sku.id} style={indentStyle}>
            <div
              style={{
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
              <AssemblyAllocationToggle
                assemblyId={sku.id}
                policy={policyByAssembly.get(sku.id) ?? sectionPolicy}
                disabled={!editable}
              />
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
  // One read for the whole section — the rate is firm-wide, so resolving it
  // per row would be the same traversal repeated once per line.
  const markup = useProductionMarkup(sku.id, tiers);

  // Per-line × per-tier value computation:
  // Every production input is persisted and entered as a total. Resulting
  // per-unit contributions are derived output, never the stored cell value.
  function lineCellValue(
    line: VirtualLine,
    tier: { id: string; qty: number | null },
  ): { display: number | null; raw: number | null; perUnit: boolean } {
    const row = rowsByTier.get(tier.id);
    const raw = num(row?.[line.field] ?? null);
    if (raw === null) return { display: null, raw: null, perUnit: false };
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
          markup={markup}
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

/**
 * The Manufacturing markup this section is actually priced at — READ, not
 * resolved here.
 *
 * C-1. This column rendered a bare em-dash while the engine applied
 * `markupDefaults["Manufacturing"]` to every production cost
 * (`costing.ts:1687`) and carried it into quoted price. In the same column on
 * the same page, packaging shows a resolved rate and names the rung it came
 * from — so an operator reading down the page saw markups on packaging and a
 * dash on production, which says *production is quoted at cost*. It is not.
 *
 * Read the way packaging reads it, off the engine's own `resolution` operand,
 * and for the reason recorded there: reimplementing a ladder the engine already
 * walks is the defect, and a wrong fallback is what that always eventually
 * looks like. Production's ladder has no per-line rung — there is no markup
 * column on `assembly_production_inputs`, and this repair adds none — so the
 * answer is one rate for the whole section.
 *
 * FAILS CLOSED, and more strictly than it strictly needs to. Production markup
 * takes no tier input, so every tier must resolve the same rate; if they ever
 * disagree this renders nothing rather than electing one tier's rate to speak
 * for the section. A dash is honest about not knowing. A number that is right
 * for one column and shown against all of them is not.
 */
interface ProductionMarkupRead {
  pct: number | null;
  /**
   * Which rung supplied it — "Category default", "Other", and so on.
   *
   * NOT RENDERED. Edward's call on seeing it: the caption earned nothing, since
   * production has one firm-wide rate and no ladder for a source line to
   * disambiguate — unlike packaging, where "line override" versus "category
   * default" is a real distinction about a real choice. Kept on the read
   * because it is one field of a node already being traversed, and because a
   * future rung would make it meaningful again; dropping it would mean
   * re-deriving it then.
   */
  source: string | null;
}

/**
 * TWO SECTIONS, TWO RATES, and conflating them was a bug in the first cut of
 * this repair.
 *
 * The drilldown renders bulk raw as a row inside the production table, but the
 * engine marks it up at `RAW_MARKUP_CATEGORY`, not at Manufacturing
 * (`costing.ts:1676`). Showing the production rate against it would have been
 * the same false-cell defect C-1 exists to remove, one row lower. It was
 * invisible in the validation estate because both categories currently resolve
 * to 30% — which is exactly how a cell like this hides until the day the two
 * rates differ and nobody is looking.
 */
interface SectionMarkups {
  prod: ProductionMarkupRead;
  raw: ProductionMarkupRead;
}

function readSection(
  graph: ReturnType<typeof selectGraph>,
  skuId: string,
  tiers: Array<{ id: string }>,
  section: "prod" | "raw",
): ProductionMarkupRead {
  const keys = tiers.map((t) => nodeKey(skuId, t.id, section));
  const resolved = resolveNodes(graph, keys);

  let pct: number | null = null;
  let source: string | null = null;
  for (const key of keys) {
    const node = resolved.get(key) ?? null;
    if (!node || node.kind === "flagged-out") continue;
    // Operand 1 is the `resolution` node the engine built for this section's
    // markup — the same position packaging reads for its per-line rate.
    const markupOperand = node.operands?.[1];
    if (!markupOperand || markupOperand.kind !== "resolution") continue;
    if (pct !== null && Math.abs(markupOperand.value - pct) > 1e-12) {
      return { pct: null, source: null };
    }
    pct = markupOperand.value;
    source = markupOperand.candidates?.find((c) => c.chosen)?.label ?? source;
  }
  return { pct, source };
}

function useProductionMarkup(
  skuId: string,
  tiers: Array<{ id: string }>,
): SectionMarkups {
  const graph = useCostingStore(selectGraph);
  return {
    prod: readSection(graph, skuId, tiers, "prod"),
    raw: readSection(graph, skuId, tiers, "raw"),
  };
}

function ProductionRow({
  line,
  sku,
  policy,
  tiers,
  rowsByTier,
  disabled,
  markup,
}: {
  line: VirtualLine;
  sku: QuoteSku;
  policy: SkuPolicy;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  rowsByTier: Map<string, ProdRowForUI>;
  disabled: boolean;
  /** Both section rates, resolved once — see `useProductionMarkup`. */
  markup: SectionMarkups;
}) {
  const showAmortizedSub =
    line.kind === "one_time_fee" && policy.allocateServiceFeesToCost;
  const showBilledSeparatelySub =
    line.kind === "one_time_fee" && !policy.allocateServiceFeesToCost;

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
        {line.kind === "tier_total_cogs" && (
          <span className="sub">tier total · allocated across quoted units</span>
        )}
      </div>
      <div className="cat">{line.category}</div>
      <div className="sup">—</div>
      <div>
        <span className="r6-badge">
          {line.kind === "one_time_fee" ? "one-time" : "tier total"}
        </span>
      </div>
      {/*
        READ-ONLY, and it stays that way. Production markup is firm-wide policy
        set at /admin/markup-defaults; there is no per-line column behind this
        cell and C-1 explicitly does not add one. What was wrong was rendering
        an em-dash while a rate was being applied, not the absence of an input.
      */}
      <div className="num">
        <span className="markup">
          {(() => {
            // Bulk raw sits in this table but is priced off the RAW rate.
            const read = line.field === "bulkRawCost" ? markup.raw : markup.prod;
            return read.pct === null ? "—" : fmtPct1(read.pct);
          })()}
        </span>
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
  const [validationError, setValidationError] = useState<string | null>(null);
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
    // Slice 11 Step 8 gate fix (2026-07-27) — Pattern 70 cross-consumer
    // audit shape, 4th instance in Slice 11 chain. The Section-level
    // toggle fix (fff95b6) swapped `leaf.id` → assembly IDs for
    // updateAssemblyProductionPolicy; this per-cell fireSave still
    // sent `sku.id` (leaf ID) as `quoteSkuId`, so
    // upsertAssemblyProductionInputs' `quoteForAssembly(leafId)`
    // failed with "Assembly not found" and runAction returned
    // ok=false — silently swallowed by the fire-and-forget transition.
    // Result: PM types a fee value, nothing persists to
    // assembly_production_inputs.
    //
    // Fix: pass sku.parentSkuId (assembly ID) — the same key the
    // server action needs. sku is a leaf (iteration below); its
    // parent IS the assembly whose production row we're mutating.
    // Also: dropped the `if (!row) return` guard — when no
    // assembly_production_inputs row exists for (assembly, tier),
    // the action's INSERT branch creates one. Previously the guard
    // silently discarded the PM's first-typed value for un-seeded
    // (assembly, tier) cells.
    const assemblyId = sku.parentSkuId;
    if (!assemblyId) return; // leaf without a parent — shouldn't happen for prod cells
    const fd = new FormData();
    fd.set("quoteSkuId", assemblyId);
    fd.set("tierId", tier.id);
    fd.set("changedField", line.field);
    // Pass all current values; only the target field changes. Row may
    // be undefined for un-seeded (assembly, tier) cells; server INSERT
    // treats missing fields as null → defaults to policy defaults.
    fd.set("fillingBlendingCost", line.field === "fillingBlendingCost" ? valueRef.current : (row?.fillingBlendingCost ?? ""));
    fd.set("cmAssemblyTotal", line.field === "cmAssemblyTotal" ? valueRef.current : (row?.cmAssemblyTotal ?? ""));
    fd.set("setupFeeTotal", line.field === "setupFeeTotal" ? valueRef.current : (row?.setupFeeTotal ?? ""));
    fd.set("toolingArtworkTotal", line.field === "toolingArtworkTotal" ? valueRef.current : (row?.toolingArtworkTotal ?? ""));
    fd.set("rdTotal", line.field === "rdTotal" ? valueRef.current : (row?.rdTotal ?? ""));
    fd.set("otherServiceTotal", line.field === "otherServiceTotal" ? valueRef.current : (row?.otherServiceTotal ?? ""));
    fd.set("bulkRawCost", line.field === "bulkRawCost" ? valueRef.current : (row?.bulkRawCost ?? ""));
    fd.set("actualUnitsProduced", row?.actualUnitsProduced?.toString() ?? "");
    startTransition(async () => {
      // Restores the last server-confirmed value in both the local input and
      // the store the Cost Stack reads from. Without this on the THROWN path,
      // a failed write leaves the optimistic projection on screen looking
      // saved — see docs/costs-certification-handover.md §0.1.
      const rollback = (message: string) => {
        const previous = row?.[line.field] ?? "";
        setValue(previous);
        setValidationError(message);
        if (row) {
          updateProductionCell(sku.id, tier.id, {
            [line.field]: num(previous),
          });
        }
      };
      let result: Awaited<ReturnType<typeof upsertAssemblyProductionInputs>>;
      try {
        result = await upsertAssemblyProductionInputs(fd);
      } catch {
        rollback(
          "The value could not be saved and has been reverted. Please try again; if this keeps happening, report this quote.",
        );
        return;
      }
      if (!result.ok) {
        rollback(result.error.message);
        return;
      }
      const canonical = result.data[line.field] ?? "";
      setValue(canonical);
      setValidationError(null);
      updateProductionCell(sku.id, tier.id, {
        [line.field]: num(canonical),
      });
    });
  }

  function handleChange(v: string) {
    setValue(v);
    setValidationError(null);
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

  // The input always shows the persisted total. The per-unit value below is
  // explanatory output from that total and is never saved into the field.
  const raw = num(value);
  const tierQty = tier.qty ?? 0;
  const display = raw;

  const isEmpty = display === null || display === 0;

  return (
    <span
      className={`cell-num ${isEmpty ? "empty" : ""}`}
      style={isActive ? { background: "var(--accent-soft)" } : undefined}
    >
      <input
        type="number"
        aria-label={`${line.name} · ${tier.label}`}
        step="0.01"
        min={0}
        value={value}
        aria-invalid={validationError !== null}
        aria-describedby={
          validationError ? `${sku.id}-${tier.id}-${line.field}-error` : undefined
        }
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="—"
        title={
          line.kind === "one_time_fee"
            ? policy.allocateServiceFeesToCost
              ? `One-time fee total $${raw ?? 0}, allocated over ${tierQty.toLocaleString()} quoted units`
              : `One-time fee total $${raw ?? 0}, billed once outside unit pricing`
            : `Production COGS tier total $${raw ?? 0}, allocated over ${tierQty.toLocaleString()} quoted units`
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
      {validationError && (
        <span
          id={`${sku.id}-${tier.id}-${line.field}-error`}
          role="alert"
          className="raw"
          style={{ color: "var(--danger)" }}
        >
          {validationError}
        </span>
      )}
      {raw !== null &&
        tierQty > 0 &&
        (line.kind === "tier_total_cogs" ||
          (line.kind === "one_time_fee" &&
            policy.allocateServiceFeesToCost)) && (
        <span className="raw">
          → {fmtCurr2(raw / tierQty)}/u
        </span>
      )}
    </span>
  );
}

function SectionToggles({
  assemblies,
  policy,
  policyByAssembly,
  disabled,
  rawsMode,
}: {
  // Post-Slice-11.5 production is per-assembly (not per-leaf). Toggle
  // fans across all assemblies visible in the drilldown; each call to
  // updateAssemblyProductionPolicy resolves the assembly's tier-row
  // fanout on the server. Passing leaf IDs (pre-11.5 shape) caused
  // the action to no-op silently — assembly_production_inputs is
  // keyed by assembly_id, not leaf id.
  assemblies: QuoteSku[];
  policy: SkuPolicy;
  /** Each assembly's OWN persisted policy. Used so the raws fan-out cannot
   *  overwrite a divergent per-assembly allocation value. */
  policyByAssembly: Map<string, SkuPolicy>;
  disabled: boolean;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
}) {
  const [pending, startTransition] = useTransition();
  const [writeError, setWriteError] = useState<string | null>(null);

  function flipToggle(field: "customerShipsRaws") {
    if (disabled || pending) return;
    setWriteError(null);
    const newValue = !policy[field];
    startTransition(async () => {
      for (const asm of assemblies) {
        const fd = new FormData();
        // Action reads formData.get("quoteSkuId") as the assembly id
        // (name preserved for backward compat; semantic is assembly.id
        // post-11.5).
        fd.set("quoteSkuId", asm.id);
        fd.set(
          "customerShipsRaws",
          (field === "customerShipsRaws"
            ? newValue
            : policy.customerShipsRaws
          ).toString(),
        );
        // Each assembly's OWN allocation value, never the section's. Writing
        // `policy.allocateServiceFeesToCost` here would let a raws toggle
        // silently flatten A=ON / B=OFF back to whichever value the first leaf
        // happened to carry — the same broadcast defect one level down.
        fd.set(
          "allocateServiceFeesToCost",
          (
            policyByAssembly.get(asm.id)?.allocateServiceFeesToCost ??
            policy.allocateServiceFeesToCost
          ).toString(),
        );
        fd.set("notes", policy.notes ?? "");
        // No optimistic projection here — the toggle renders from the RSC
        // prop, so a failure cannot leave an unpersisted value on screen and
        // the rollback contract does not apply. It DOES currently discard the
        // result, so a governed failure is invisible to the operator; that is
        // logged as a separate finding rather than fixed here, since surfacing
        // it needs an error slot this control does not have. The catch exists
        // so a thrown failure cannot become an unhandled rejection.
        try {
          const res = await updateAssemblyProductionPolicy(fd);
          if (!res.ok) {
            // Control-integrity: this button renders from the RSC prop, so a
            // rejected write leaves the OLD value on screen — indistinguishable
            // from "nothing happened". Surface it rather than implying success.
            setWriteError(res.error.message);
            break;
          }
        } catch (e) {
          setWriteError(
            e instanceof Error ? e.message : "Policy update failed.",
          );
          break;
        }
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
            If ON, customer-supplied bulk raw material is excluded from unit
            cost. Packaging components remain included.
          </div>
          <div className="consequence">
            {customerShipsRawsEffective
              ? "→ bulk raw cost excluded from this quote"
              : "→ bulk raw cost included as priced"}
          </div>
        </div>
      </button>

      {/* The allocation control lives on the ASSEMBLY it governs — see
          `AssemblyAllocationToggle`. It used to sit here and broadcast to every
          assembly, which made the per-assembly policy that the schema, costing
          and the customer-view resolver all model unreachable for operators. */}
      {writeError && (
        <div className="r6-prod-toggle-error" role="alert">
          Could not save: {writeError}
        </div>
      )}
    </div>
  );
}

/**
 * Allocation policy for ONE assembly.
 *
 * Owned by the assembly whose production inputs it governs. It writes exactly
 * one policy fan-out — its own — so A=ON / B=OFF is expressible, and it
 * survives reconcile because no other control writes this field.
 *
 * `customerShipsRaws` and `notes` are carried through from THIS assembly's
 * persisted policy, because the action rewrites the whole policy row. Sourcing
 * them from anywhere else would reintroduce the broadcast defect one field over.
 */
function AssemblyAllocationToggle({
  assemblyId,
  policy,
  disabled,
}: {
  assemblyId: string;
  policy: SkuPolicy;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [writeError, setWriteError] = useState<string | null>(null);

  function flip() {
    if (disabled || pending) return;
    setWriteError(null);
    const newValue = !policy.allocateServiceFeesToCost;
    startTransition(async () => {
      const fd = new FormData();
      // Action reads formData.get("quoteSkuId") as the assembly id (name
      // preserved for backward compat; semantic is assembly.id post-11.5).
      fd.set("quoteSkuId", assemblyId);
      fd.set("customerShipsRaws", policy.customerShipsRaws.toString());
      fd.set("allocateServiceFeesToCost", newValue.toString());
      fd.set("notes", policy.notes ?? "");
      try {
        const res = await updateAssemblyProductionPolicy(fd);
        if (!res.ok) setWriteError(res.error.message);
      } catch (e) {
        setWriteError(e instanceof Error ? e.message : "Policy update failed.");
      }
    });
  }

  return (
    <div className="r6-prod-toggles r6-prod-toggles-asm">
      <button
        type="button"
        className={`r6-prod-toggle ${policy.allocateServiceFeesToCost ? "on" : ""}`}
        onClick={flip}
        disabled={disabled || pending}
      >
        <span className="tog" />
        <div className="body">
          <div className="lab">Allocate service fees to unit cost</div>
          <div className="desc">
            Setup, tooling/artwork, R&amp;D, and other service fees allocate
            across quoted units. If OFF, they invoice once as separate charges.
            This choice belongs to this product.
          </div>
          <div className="consequence">
            {policy.allocateServiceFeesToCost
              ? "→ NRE rolled into per-unit (smaller tiers carry more)"
              : "→ NRE invoiced as a separate line on the order"}
          </div>
        </div>
      </button>
      {writeError && (
        <div className="r6-prod-toggle-error" role="alert">
          Could not save: {writeError}
        </div>
      )}
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
        Actual output is an operational reference only. It does not recalculate
        draft customer pricing or mutate sent, accepted, snapshot, or PDF
        values. A future reconciliation workflow requires a separate decision.
      </p>
      <div className="r6-yield-split">
        <div className={`r6-yield-block ${yieldLocked ? "locked" : ""}`}>
          <div className="r6-yield-block-head">
            <h5>Production yield</h5>
            <span className="axis">units</span>
          </div>
          <p className="desc">
            How many units actually came off the line versus quoted. The delta
            below is informational and has no customer-pricing effect.
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
              <div className="lab">Pricing reconciliation</div>
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
