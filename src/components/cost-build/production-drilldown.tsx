import type { quoteSkus } from "@/db/schema";
import { buildTreeRenderOrder } from "@/lib/sku-tree";
import { ProductionSection } from "@/app/projects/[id]/quotes/[quoteId]/production/production-section";

type QuoteSku = typeof quoteSkus.$inferSelect;

// Slice RI.4 — Production drill-down panel. Reuses ProductionSection
// from the prior /production page (token-aware after RI.0; toggle cards
// + table + bulk raw cost sub-section all preserved).
//
// Bulk-raw-cost-cell visibility (per Round 6 + Bulk Raw correction):
// when raws-mode = dps_sources, the bulk-raw-cost cells inside
// ProductionSection collapse to a "managed in Bulk Raw section"
// placeholder. ProductionSection doesn't know about raws-mode yet —
// passed via a prop hint; full integration in a follow-up sub-slice.

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

export function ProductionDrilldown({
  skus,
  tiers,
  inputRows,
  editable,
  rawsMode,
}: {
  skus: QuoteSku[];
  tiers: Array<{ id: string; label: string }>;
  inputRows: ProductionInputRow[];
  editable: boolean;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
}) {
  const tierBrief = tiers.map((t) => ({ id: t.id, label: t.label }));

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

  if (tiers.length === 0) {
    return (
      <div className="rounded border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
        Add at least one tier to the quote before entering production inputs.
      </div>
    );
  }

  if (skus.length === 0) {
    return (
      <div className="rounded border border-rule bg-paper-2 p-6 text-center text-sm text-ink-3">
        Add at least one SKU to the quote before entering production inputs.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Slice RI.4: mode-aware hint removed per Designer audit M-7
          follow-up to C-1. Mode selector now lives inside Bulk Raw
          drilldown (mode-declaration zone); the Bulk Raw section
          header status chip carries the mode signal across all
          sections, so the duplicate hint here is redundant. */}

      {buildTreeRenderOrder(skus).map(({ sku, depth }) => {
        const indentStyle = { marginLeft: `${depth * 24}px` };
        const isAssembly = sku.skuRole === "assembly";

        if (isAssembly) {
          return (
            <div
              key={sku.id}
              style={indentStyle}
              className="rounded border border-accent/40 bg-accent-soft px-4 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="rounded border border-accent/40 bg-accent-soft px-1.5 py-0 font-mono text-[10px] font-medium uppercase tracking-wide text-accent-ink">
                  Assembly
                </span>
                <span className="font-medium text-ink">{sku.skuLabel}</span>
                <span className="text-ink-3">· {sku.productName}</span>
                <span className="ml-auto text-xs text-ink-3">
                  Production costs roll up from leaf children.
                </span>
              </div>
            </div>
          );
        }

        const policy = policyBySku.get(sku.id) ?? {
          customerShipsRaws: false,
          allocateServiceFeesToCost: true,
          notes: null,
        };
        const rowsByTier = rowsBySku.get(sku.id) ?? new Map();
        const tierCells = tierBrief.map((t) => {
          const r = rowsByTier.get(t.id);
          return {
            tierId: t.id,
            tierLabel: t.label,
            rowId: r?.rowId ?? null,
            fillingBlendingCost: r?.fillingBlendingCost ?? null,
            cmAssemblyTotal: r?.cmAssemblyTotal ?? null,
            setupFeeTotal: r?.setupFeeTotal ?? null,
            toolingArtworkTotal: r?.toolingArtworkTotal ?? null,
            rdTotal: r?.rdTotal ?? null,
            otherServiceTotal: r?.otherServiceTotal ?? null,
            bulkRawCost: r?.bulkRawCost ?? null,
            actualUnitsProduced: r?.actualUnitsProduced ?? null,
          };
        });

        return (
          <details
            key={sku.id}
            open
            style={indentStyle}
            className="rounded border border-rule bg-paper"
          >
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-ink">
              <span>
                {sku.skuLabel} · {sku.productName}
              </span>
            </summary>

            <div className="border-t border-rule px-4 py-4">
              <ProductionSection
                quoteSkuId={sku.id}
                policy={policy}
                tierCells={tierCells}
                disabled={!editable}
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}
