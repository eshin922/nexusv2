"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { type SkuRow } from "@/lib/sku-tree";
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
import {
  aggregateAllocation,
  DEFAULT_ASSEMBLY_POLICY,
  describeAllocation,
  resolveBulkAllocation,
  type AllocationAggregate,
} from "@/lib/production-policy";
import { PRODUCTION_MARKUP_CATEGORY } from "@/lib/costing";
import {
  DirectServiceProduction,
  type DirectServiceProductionRow,
} from "./direct-service-production";

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
/**
 * Exported so the Direct Service table formats the rate the SAME way, rather
 * than restating the conversion.
 *
 * The node's value is a DECIMAL FRACTION (0.30), not a percentage. The service
 * table first rendered `pct.toFixed(1) + "%"` and displayed "0.3%" against a
 * 30% rate — a 100x error in a commercial figure, and a plausible-looking one.
 * Sharing the formatter removes the second place that conversion can be got
 * wrong.
 */
export function fmtPct1(v: number): string {
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
  directServices = [],
}: {
  skus: QuoteSku[];
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  inputRows: ProductionInputRow[];
  editable: boolean;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
  /** Stage 3 A · the other owner branch. Rendered by its own component,
   *  which has no capacity to show an Item Group's inputs. */
  directServices?: DirectServiceProductionRow[];
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

  // BV-012 — the display rows are now keyed by ASSEMBLY, so `policyBySku` IS
  // policy-by-assembly. The anchor-leaf indirection this used to walk (read an
  // assembly's policy through whichever child happened to carry it) is gone
  // with the re-key.
  //
  // Allocation authoring is quote-wide for V1 (separate disposition,
  // 2026-08-17); storage stays per-assembly, so a pre-existing divergent quote
  // is still read honestly as `mixed` rather than reported as whichever value
  // one component happened to hold.
  const assemblies = skus.filter((s) => s.skuRole === "assembly");

  // ── THE MARKUP NODE IS KEYED BY THE ANCHOR LEAF, NOT THE ASSEMBLY ───────
  //
  // The engine attaches an Item Group's production to the lowest-position
  // member leaf (`costing-adapter.ts` anchor-leaf fan-out), so that is the id
  // its markup resolution node is keyed under.
  //
  // #282 re-keyed this DISPLAY to `assembly.id`, correctly — production
  // belongs to the Item Group, not to one of its components. But the markup
  // read kept resolving `nodeKey(sku.id, ...)`, which after the re-key is an
  // assembly id and matches no node. `readSection` then fails closed and the
  // column renders an em-dash on EVERY row — including rows the engine is
  // actively marking up and carrying into quoted price, which is exactly the
  // C-1 defect the read was written to fix, reintroduced by a key change
  // rather than by a logic change.
  //
  // Display keys by assembly; the markup read keys by anchor leaf. Two
  // different questions, two different keys.
  const anchorLeafByAssembly = new Map<string, string>();
  for (const asm of assemblies) {
    const children = skus
      .filter((s) => s.skuRole !== "assembly" && s.parentSkuId === asm.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (children.length > 0) anchorLeafByAssembly.set(asm.id, children[0].id);
  }

  // EVERY Item Group contributes, persisted or not.
  //
  // This used to add an entry only when a row existed, so a quote whose
  // assemblies had no `assembly_production_inputs` rows yet produced an EMPTY
  // map — and `aggregateAllocation` reads empty as `none`, which the control
  // renders as "no assemblies on this quote" and disables. A quote's structure
  // comes from its Item Groups; a policy row is optional persisted state and
  // must not decide whether an Item Group exists.
  //
  // An unpersisted assembly contributes the governed default, which is
  // precisely the value a first write will persist — so the aggregate the
  // operator reads is the state they are actually in, and `none` now means
  // what it says: zero Item Groups.
  const policyByAssembly = new Map<string, SkuPolicy>();
  for (const asm of assemblies) {
    policyByAssembly.set(
      asm.id,
      policyBySku.get(asm.id) ?? { ...DEFAULT_ASSEMBLY_POLICY, notes: null },
    );
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

  if (assemblies.length === 0) {
    // BV-012 §1.b — no Item Group, no Production economics. A quote of Direct
    // Products has nothing to author here, and says so rather than showing an
    // empty table it would silently refuse to save.
    return (
      <div className="r6-empty-drawer">
        <div className="glyph">∅</div>
        <h4>No item groups yet</h4>
        <p>
          Production economics belong to a finished-good item group. Direct
          products carry packaging economics only.
        </p>
      </div>
    );
  }

  const firstAssembly = assemblies[0];
  const sectionPolicy = policyBySku.get(firstAssembly.id) ?? {
    customerShipsRaws: false,
    allocateServiceFeesToCost: true,
    notes: null,
  };

  // Allocation is per-assembly, so the quote-level view of it is an AGGREGATE,
  // not `sectionPolicy` — which is the first leaf's row and says nothing about
  // the other assemblies. Reading it as though it did is the broadcast defect
  // in the read direction.
  const allocation = aggregateAllocation(policyByAssembly.values());

  // Section-wide actuals — first ITEM GROUP's first tier. Re-pointed from the
  // first leaf as a necessary consequence of the display re-key: the rows this
  // reads are no longer keyed by leaf. Section-level semantics are unchanged.
  const firstSkuRows = rowsBySku.get(firstAssembly.id);
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
        assemblies={assemblies}
        policy={sectionPolicy}
        policyByAssembly={policyByAssembly}
        allocation={allocation}
        disabled={!editable}
        rawsMode={rawsMode}
      />

      {/* Canonical .drawer-toolbar inside .r6-drawer (parent applies
          .r6-drawer to the collapsible region). */}
      <div className="drawer-toolbar">
        <div className="lhs">
          <span>
            {/* Item Groups, not leaves — one production block per finished
                good is what the surface now renders, and what the storage has
                always held. */}
            <strong>{assemblies.length}</strong> production block
            {assemblies.length === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>
            {/* The aggregate, not the first leaf's row — this header states a
                fact about the whole quote and previously read one product's. */}
            Service fees: <strong>{describeAllocation(allocation)}</strong>
          </span>
        </div>
      </div>

      {/* BV-012 — one Production authoring surface per ITEM GROUP.
          
          This used to iterate the whole tree and render a full Production
          table for every non-assembly SKU. That produced N tables for one
          assembly-owned row (an edit persisted correctly but reloaded onto
          whichever leaf was the anchor, so the value looked like it moved),
          and it rendered tables on Direct Products whose writes were dropped
          by `if (!assemblyId) return` — a surface accepting values it could
          never save.
          
          Member leaves and Direct Products own no Production economics, so
          they get no Production surface. They keep their Packaging authoring
          in the Packaging section, which is unchanged. */}
      {assemblies.map((asm) => (
        <div key={asm.id} style={{ marginBottom: "18px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "10px",
              padding: "10px 14px",
              background: "oklch(from var(--accent) l c h / 0.05)",
              border: "1px solid oklch(from var(--accent) l c h / 0.30)",
              borderRadius: "8px",
              fontSize: "13px",
            }}
          >
            <span className="r6-badge accent">Item group</span>
            <span style={{ color: "var(--ink)", fontWeight: 500 }}>
              {asm.skuLabel}
            </span>
            <span style={{ color: "var(--ink-3)" }}>· {asm.productName}</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--ink-3)",
              }}
            >
              Production belongs to the finished good.
            </span>
          </div>
          <ProductionTable
            markupNodeId={anchorLeafByAssembly.get(asm.id) ?? asm.id}
            sku={asm}
            policy={policyByAssembly.get(asm.id) ?? sectionPolicy}
            tiers={tiers}
            rowsByTier={rowsBySku.get(asm.id) ?? new Map()}
            visibleLines={visibleLines}
            disabled={!editable}
          />
        </div>
      ))}

      {/* Stage 3 A · the other owner branch, in its own component. Rendered
          BELOW the Item Group tables rather than among them: a service is not
          an Item Group, and interleaving them would invite reading one as a
          variant of the other. */}
      {directServices.map((svc) => (
        <DirectServiceMarkupBridge
          key={svc.quoteLeafId}
          service={svc}
          tiers={tiers}
          editable={editable}
        />
      ))}

      <PostProdReconcile
        actualUnitsProduced={actualUnitsProduced}
        yieldLocked={yieldLocked}
        firstTierQty={tiers[0]?.qty ?? null}
      />
    </div>
  );
}

function ProductionTable({
  sku,
  markupNodeId,
  policy,
  tiers,
  rowsByTier,
  visibleLines,
  disabled,
}: {
  sku: QuoteSku;
  /** The engine's node key for this section's markup — the ANCHOR LEAF, which
   *  is not the same id the display is keyed by. See the note at the caller. */
  markupNodeId: string;
  policy: SkuPolicy;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  rowsByTier: Map<string, ProdRowForUI>;
  visibleLines: VirtualLine[];
  disabled: boolean;
}) {
  // One read for the whole section — the rate is firm-wide, so resolving it
  // per row would be the same traversal repeated once per line.
  const markup = useProductionMarkup(markupNodeId, tiers);

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
    // BV-012 — `sku` IS the Item Group now; the table is rendered once per
    // assembly. This previously read `sku.parentSkuId`, because the table was
    // rendered on member leaves and had to climb to the owner. An assembly's
    // parent is null, so leaving that read in place would have made
    // `if (!assemblyId) return` swallow EVERY production write — silently, in
    // a fire-and-forget transition. The same shape as the Direct Product
    // defect this slice removes, pointed at the whole surface.
    const assemblyId = sku.skuRole === "assembly" ? sku.id : sku.parentSkuId;
    if (!assemblyId) return;
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
  allocation,
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
  /** Aggregate of every assembly's OWN allocation value — see `aggregateAllocation`. */
  allocation: AllocationAggregate;
  disabled: boolean;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
}) {
  // Pattern 47(f): one transition per action. These two controls write the same
  // table through the same action, but they are separate operator decisions —
  // sharing a transition would make an in-flight raws write disable a control
  // the operator has every right to use, with nothing on screen saying why.
  const [rawsPending, startRaws] = useTransition();
  const [allocPending, startAlloc] = useTransition();
  const [writeError, setWriteError] = useState<string | null>(null);

  function flipToggle(field: "customerShipsRaws") {
    if (disabled || rawsPending) return;
    setWriteError(null);
    const newValue = !policy[field];
    startRaws(async () => {
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

  /**
   * Bulk-set allocation across every assembly.
   *
   * Quote-wide authority for V1 — the operator sets allocation once and it
   * applies to every assembly. The property that keeps this honest is the READ,
   * not the write: a divergent quote reads `mixed`, never a uniform value that
   * is only true of the first leaf, so the operator is told before the click
   * that one value is about to replace several.
   *
   * Each write still carries THAT assembly's own `customerShipsRaws` and
   * `notes`, because the action rewrites the whole policy row. Sourcing them
   * from the section would flatten a second field nobody asked to change.
   */
  function bulkSetAllocation() {
    if (disabled || allocPending) return;
    const next = resolveBulkAllocation(allocation);
    if (next === null) return;
    setWriteError(null);
    startAlloc(async () => {
      for (const asm of assemblies) {
        const own = policyByAssembly.get(asm.id);
        const fd = new FormData();
        // `quoteSkuId` carries the ASSEMBLY id — the field name is preserved for
        // backward compatibility; the semantic is assembly.id post-11.5.
        fd.set("quoteSkuId", asm.id);
        fd.set(
          "customerShipsRaws",
          (own?.customerShipsRaws ?? policy.customerShipsRaws).toString(),
        );
        fd.set("allocateServiceFeesToCost", next.toString());
        fd.set("notes", own?.notes ?? policy.notes ?? "");
        try {
          const res = await updateAssemblyProductionPolicy(fd);
          if (!res.ok) {
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
  const noAssemblies = allocation === "none";

  return (
    // Two-up, which is what `.r6-prod-toggles` was written for: the two
    // quote-level Production policy controls side by side. Both are quote-wide
    // operator authority for V1.
    <div className="r6-prod-toggles r6-prod-toggles-section">
      <button
        type="button"
        className={`r6-prod-toggle ${customerShipsRawsEffective ? "on" : ""}`}
        onClick={() => flipToggle("customerShipsRaws")}
        disabled={disabled || rawsPending || rawsMode === "customer_supplies"}
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

      <button
        type="button"
        className={`r6-prod-toggle ${allocation === "on" ? "on" : ""} ${
          allocation === "mixed" ? "mixed" : ""
        }`}
        onClick={bulkSetAllocation}
        disabled={disabled || allocPending || noAssemblies}
        // Every disabled operator control must say why (Pattern 47(f)).
        title={
          noAssemblies
            ? "No assemblies on this quote, so there is no allocation policy to set."
            : allocation === "mixed"
              ? "Products currently differ. Setting from here applies one value to all of them."
              : undefined
        }
      >
        <span className={`tog ${allocation === "mixed" ? "mixed" : ""}`} />
        <div className="body">
          <div className="lab">Allocate service fees to unit cost</div>
          <div className="desc">
            Setup, tooling/artwork, R&amp;D, and other service fees allocate
            across quoted units. If OFF, they invoice once as separate charges.
            Sets every product on the quote.
          </div>
          <div className="consequence">
            {noAssemblies
              ? "→ no assemblies on this quote"
              : allocation === "mixed"
                ? "→ products currently differ · setting here applies to all"
                : allocation === "on"
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


/**
 * Resolves a Direct Service's Production markup through the SAME read the
 * Item Group table uses, then hands it to the presentation component.
 *
 * A bridge rather than the hook inside `DirectServiceProduction` because the
 * hook must be called once per service, and one component rendering N services
 * cannot call a hook in a loop. The important property is which read it is:
 * the same one, so BV-013 changes both surfaces at once and neither carries a
 * private copy of the rate.
 *
 * The node key here needs no anchor translation — a Direct Service IS the math
 * leaf, so its quote-leaf id is already the key the engine used.
 */
function DirectServiceMarkupBridge({
  service,
  tiers,
  editable,
}: {
  service: DirectServiceProductionRow;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  editable: boolean;
}) {
  const markup = useProductionMarkup(service.quoteLeafId, tiers);
  return (
    <DirectServiceProduction
      services={[service]}
      tiers={tiers}
      editable={editable}
      categoryLabel={PRODUCTION_MARKUP_CATEGORY}
      markupPct={markup.prod.pct}
    />
  );
}
