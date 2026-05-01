import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  packagingInputs,
  projects,
  quotes,
  quoteSkus,
  quoteTiers,
} from "@/db/schema";
import { listMarkupDefaults } from "@/app/actions/markup-defaults";
import { getCostingBundle } from "@/app/actions/costing";
import { buildTreeRenderOrder } from "@/lib/sku-tree";
import { IdBadge } from "@/components/id-badge";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { QuoteSummaryCard } from "@/components/quote-summary-card";
import { AddLineButton } from "./add-line-button";
import { PackagingLineRow } from "./packaging-line-row";

export default async function PackagingInputsPage({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id: projectId, quoteId } = await params;

  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();

  // Slice 8 sub-step 4: fetch costing bundle for the optimistic store.
  // Hydrates the CostingStoreProvider that wraps all interactive content.
  const bundle = await getCostingBundle(quote.id);

  const [skus, tiers, inputRows, categories] = await Promise.all([
    db
      .select()
      .from(quoteSkus)
      .where(eq(quoteSkus.quoteId, quote.id))
      .orderBy(asc(quoteSkus.sortOrder), asc(quoteSkus.createdAt)),
    db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quote.id))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
    db
      .select()
      .from(packagingInputs)
      .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
      .where(eq(quoteSkus.quoteId, quote.id))
      .orderBy(
        asc(packagingInputs.sortOrder),
        asc(packagingInputs.lineGroupId),
        asc(packagingInputs.createdAt),
      ),
    listMarkupDefaults(),
  ]);

  const editable = quote.status === "draft";
  const tierBrief = tiers.map((t) => ({ id: t.id, label: t.label }));

  // Group input rows by SKU → line_group_id → array of (tier, cell) records.
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

  if (!bundle.ok) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          Costing data unavailable: {bundle.error.message}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <CostingStoreProvider snapshot={bundle.data}>
      <div className="mb-2 text-sm">
        <Link
          href={`/projects/${project.id}/quotes/${quote.id}`}
          className="text-gray-500 hover:text-gray-900"
        >
          ← Quote builder
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Packaging inputs</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
          <span>{project.dealName}</span>
          <span>·</span>
          <span>{quote.scenarioLabel} v{quote.versionNumber}</span>
          <span>·</span>
          <IdBadge id={quote.id} />
          <span>·</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
            {quote.status}
          </span>
        </p>
      </header>

      {!editable && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">
            This quote is in <span className="font-mono">{quote.status}</span>{" "}
            status. Editing is disabled.
          </p>
          <p className="mt-1">
            To make changes, create a new draft version from the project page.
          </p>
        </div>
      )}

      {tiers.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Add at least one tier to the quote before entering packaging inputs.
        </div>
      )}

      {skus.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Add at least one SKU to the quote before entering packaging inputs.
        </div>
      ) : (
        <div className="grid gap-4">
          {buildTreeRenderOrder(skus).map(({ sku, depth }) => {
            const lines = Array.from(linesBySku.get(sku.id)?.values() ?? []).sort(
              (a, b) => a.sortOrder - b.sortOrder,
            );
            const indentStyle = { marginLeft: `${depth * 24}px` };
            const isAssembly = sku.skuRole === "assembly";

            // Assemblies: read-only summary row, no packaging UI. Their
            // leaf descendants get the full per-(line, tier) cost-cell UI.
            if (isAssembly) {
              return (
                <div
                  key={sku.id}
                  style={indentStyle}
                  className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-800">
                        Assembly
                      </span>
                      <span className="font-semibold text-gray-900">
                        {sku.skuLabel}
                      </span>
                      <span className="text-gray-500">· {sku.productName}</span>
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

            // Leaves: full packaging UI.
            return (
              <details
                key={sku.id}
                open
                style={indentStyle}
                className="rounded-md border border-gray-200 bg-white"
              >
                <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900">
                  <span>
                    {sku.skuLabel} · {sku.productName}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {lines.length} line{lines.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  {tiers.length > 0 && (
                    <AddLineButton quoteSkuId={sku.id} disabled={!editable} />
                  )}
                </summary>

                <div className="border-t border-gray-200 px-4 py-3">
                  {lines.length === 0 ? (
                    <p className="py-4 text-center text-sm text-gray-500">
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
      )}

      <div className="mt-6">
        <QuoteSummaryCard
          variant="compact"
          editable={editable}
          currentPage="packaging"
        />
      </div>
      </CostingStoreProvider>
    </main>
  );
}

function LineHeader() {
  return (
    <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_0.9fr_0.7fr_2fr_auto] gap-2 px-3 text-xs font-medium uppercase tracking-wide text-gray-500">
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
