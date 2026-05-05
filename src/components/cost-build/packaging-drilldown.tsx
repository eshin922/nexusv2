import type { quoteSkus } from "@/db/schema";
import { buildTreeRenderOrder } from "@/lib/sku-tree";
import { AddLineButton } from "@/app/projects/[id]/quotes/[quoteId]/packaging/add-line-button";
import { PackagingLineRow } from "@/app/projects/[id]/quotes/[quoteId]/packaging/packaging-line-row";

type QuoteSku = typeof quoteSkus.$inferSelect;

// Slice RI.4 — Packaging drill-down panel. Ported from the prior
// /packaging page composition; reuses PackagingLineRow + AddLineButton
// without modification (those components are token-aware after RI.0
// and don't need rebuilding for RI.4).

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
  supplier: string | null;
  qtyPerSellableUnit: string | null;
  category: string | null;
  markupPct: string | null;
  markupPctSource: "category_default" | "manual_override" | null;
  inventoryEligible: boolean;
  notes: string | null;
  cells: Array<{
    rowId: string;
    tierId: string;
    unitCost: string | null;
    purchaseQty: string | null;
  }>;
};

export function PackagingDrilldown({
  skus,
  tiers,
  inputRows,
  categories,
  editable,
}: {
  skus: QuoteSku[];
  tiers: Array<{ id: string; label: string }>;
  inputRows: PackagingInputRow[];
  categories: Array<{ category: string; defaultMarkupPct: string }>;
  editable: boolean;
}) {
  const tierBrief = tiers.map((t) => ({ id: t.id, label: t.label }));

  // Group input rows by SKU → line_group_id → array of (tier, cell).
  const linesBySku = new Map<string, Map<string, LineForUI>>();
  for (const r of inputRows) {
    const row = r.packaging_inputs;
    let bySku = linesBySku.get(row.quoteSkuId);
    if (!bySku) {
      bySku = new Map();
      linesBySku.set(row.quoteSkuId, bySku);
    }
    let line = bySku.get(row.lineGroupId);
    if (!line) {
      line = {
        lineGroupId: row.lineGroupId,
        sortOrder: row.sortOrder,
        supplier: row.supplier,
        qtyPerSellableUnit: row.qtyPerSellableUnit,
        category: row.category,
        markupPct: row.markupPct,
        markupPctSource: row.markupPctSource,
        inventoryEligible: row.inventoryEligible,
        notes: row.notes,
        cells: [],
      };
      bySku.set(row.lineGroupId, line);
    }
    line.cells.push({
      rowId: row.id,
      tierId: row.tierId,
      unitCost: row.unitCost,
      purchaseQty: row.purchaseQty,
    });
  }

  if (tiers.length === 0) {
    return (
      <div className="rounded border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
        Add at least one tier to the quote before entering packaging inputs.
      </div>
    );
  }

  if (skus.length === 0) {
    return (
      <div className="rounded border border-rule bg-paper-2 p-6 text-center text-sm text-ink-3">
        Add at least one SKU to the quote before entering packaging inputs.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {buildTreeRenderOrder(skus).map(({ sku, depth }) => {
        const lines = Array.from(linesBySku.get(sku.id)?.values() ?? []).sort(
          (a, b) => a.sortOrder - b.sortOrder,
        );
        const indentStyle = { marginLeft: `${depth * 24}px` };
        const isAssembly = sku.skuRole === "assembly";

        if (isAssembly) {
          return (
            <div
              key={sku.id}
              style={indentStyle}
              className="rounded border border-accent/40 bg-accent-soft px-4 py-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded border border-accent/40 bg-accent-soft px-1.5 py-0 font-mono text-[10px] font-medium uppercase tracking-wide text-accent-ink">
                    Assembly
                  </span>
                  <span className="font-medium text-ink">
                    {sku.skuLabel}
                  </span>
                  <span className="text-ink-3">· {sku.productName}</span>
                </div>
                <AddLineButton
                  quoteSkuId={sku.id}
                  disabled
                  tooltip="Packaging lines belong to leaf SKUs. Assemblies aggregate their leaf descendants' packaging."
                />
              </div>
            </div>
          );
        }

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
                <span className="ml-2 text-xs font-normal text-ink-3">
                  {lines.length} line{lines.length === 1 ? "" : "s"}
                </span>
              </span>
              {tiers.length > 0 && (
                <AddLineButton quoteSkuId={sku.id} disabled={!editable} />
              )}
            </summary>

            <div className="border-t border-rule px-4 py-3">
              {lines.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-3">
                  No packaging lines yet.
                </p>
              ) : (
                <>
                  <LineHeader />
                  <div className="mt-2 grid gap-2">
                    {lines.map((line, i) => (
                      <PackagingLineRow
                        key={line.lineGroupId}
                        line={line}
                        tiers={tierBrief}
                        isFirst={i === 0}
                        isLast={i === lines.length - 1}
                        categories={categories}
                        disabled={!editable}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function LineHeader() {
  return (
    <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_0.9fr_0.7fr_2fr_auto] gap-2 px-3 font-mono text-[10px] uppercase tracking-wide text-ink-3">
      <span>Supplier</span>
      <span>Qty/unit</span>
      <span>Category</span>
      <span>Markup</span>
      <span className="text-center">Inv?</span>
      <span>Notes</span>
      <span className="text-right">Actions</span>
    </div>
  );
}
