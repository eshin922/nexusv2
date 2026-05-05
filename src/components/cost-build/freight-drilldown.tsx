import type { quoteSkus } from "@/db/schema";
import { buildTreeRenderOrder } from "@/lib/sku-tree";
import { AddFreightLineButton } from "@/app/projects/[id]/quotes/[quoteId]/freight/add-line-button";
import { CustomsRow } from "@/app/projects/[id]/quotes/[quoteId]/freight/customs-row";
import { FreightLineRow } from "@/app/projects/[id]/quotes/[quoteId]/freight/freight-line-row";

type QuoteSku = typeof quoteSkus.$inferSelect;

// Slice RI.4 — Freight drill-down panel. Reuses CustomsRow +
// FreightLineRow + AddFreightLineButton from the prior /freight page.

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
  cells: Array<{
    rowId: string;
    tierId: string;
    totalFreight: string | null;
    unitsInShipment: number | null;
    skuTotalCbm: string | null;
  }>;
};

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
  const tierBrief = tiers.map((t) => ({ id: t.id, label: t.label, qty: t.qty }));

  const linesBySku = new Map<string, Map<string, FreightLineForUI>>();
  for (const r of inputRows) {
    const row = r.freight_inputs;
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
        shipmentId: row.shipmentId,
        supplier: row.supplier,
        freightMode: row.freightMode,
        freightTreatment: row.freightTreatment,
        markupPct: row.markupPct,
        notes: row.notes,
        cells: [],
      };
      bySku.set(row.lineGroupId, line);
    }
    line.cells.push({
      rowId: row.id,
      tierId: row.tierId,
      totalFreight: row.totalFreight,
      unitsInShipment: row.unitsInShipment,
      skuTotalCbm: row.skuTotalCbm,
    });
  }

  if (tiers.length === 0) {
    return (
      <div className="rounded border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
        Add at least one tier to the quote before entering freight inputs.
      </div>
    );
  }

  if (skus.length === 0) {
    return (
      <div className="rounded border border-rule bg-paper-2 p-6 text-center text-sm text-ink-3">
        Add at least one SKU to the quote before entering freight inputs.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
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
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded border border-accent/40 bg-accent-soft px-1.5 py-0 font-mono text-[10px] font-medium uppercase tracking-wide text-accent-ink">
                  Assembly
                </span>
                <span className="font-medium text-ink">{sku.skuLabel}</span>
                <span className="text-ink-3">· {sku.productName}</span>
                <span className="ml-auto text-xs text-ink-3">
                  Freight costs roll up from leaf children.
                </span>
              </div>
              <CustomsRow
                quoteSkuId={sku.id}
                dutyPct={sku.dutyPct}
                tariffPct={sku.tariffPct}
                disabled={!editable}
              />
            </div>
          );
        }

        const lines = Array.from(linesBySku.get(sku.id)?.values() ?? []).sort(
          (a, b) => a.sortOrder - b.sortOrder,
        );

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
                  {lines.length} freight line{lines.length === 1 ? "" : "s"}
                </span>
              </span>
              {tiers.length > 0 && (
                <AddFreightLineButton
                  quoteSkuId={sku.id}
                  disabled={!editable}
                />
              )}
            </summary>

            <div className="border-t border-rule px-4 py-3">
              <CustomsRow
                quoteSkuId={sku.id}
                dutyPct={sku.dutyPct}
                tariffPct={sku.tariffPct}
                disabled={!editable}
              />

              {lines.length === 0 ? (
                <p className="mt-4 py-4 text-center text-sm text-ink-3">
                  No freight lines yet.
                </p>
              ) : (
                <div className="mt-4 grid gap-3">
                  {lines.map((line, i) => (
                    <FreightLineRow
                      key={line.lineGroupId}
                      line={line}
                      tiers={tierBrief}
                      isFirst={i === 0}
                      isLast={i === lines.length - 1}
                      disabled={!editable}
                    />
                  ))}
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
