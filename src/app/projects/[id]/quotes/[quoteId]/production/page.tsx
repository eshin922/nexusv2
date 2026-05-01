import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  productionInputs,
  projects,
  quotes,
  quoteSkus,
  quoteTiers,
} from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { buildTreeRenderOrder } from "@/lib/sku-tree";
import { IdBadge } from "@/components/id-badge";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { QuoteSummaryCard } from "@/components/quote-summary-card";
import { ProductionSection } from "./production-section";

export default async function ProductionInputsPage({
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

  const [skus, tiers, prodRows, bundle] = await Promise.all([
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
      .from(productionInputs)
      .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
      .where(eq(quoteSkus.quoteId, quote.id)),
    getCostingBundle(quoteId),
  ]);

  const editable = quote.status === "draft";
  const tierBrief = tiers.map((t) => ({ id: t.id, label: t.label }));

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

  const rowsBySku = new Map<string, Map<string, ProdRowForUI>>();
  const policyBySku = new Map<string, SkuPolicy>();
  for (const r of prodRows) {
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

  if (!bundle.ok) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Costing bundle unavailable: {bundle.error.message}
        </div>
      </main>
    );
  }

  return (
    <CostingStoreProvider snapshot={bundle.data}>
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-2 text-sm">
        <Link
          href={`/projects/${project.id}/quotes/${quote.id}`}
          className="text-gray-500 hover:text-gray-900"
        >
          ← Quote builder
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Production inputs</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
          <span>{project.dealName}</span>
          <span>·</span>
          <span>
            {quote.scenarioLabel} v{quote.versionNumber}
          </span>
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
          Add at least one tier to the quote before entering production inputs.
        </div>
      )}

      {skus.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Add at least one SKU to the quote before entering production inputs.
        </div>
      ) : (
        <div className="grid gap-4">
          {buildTreeRenderOrder(skus).map(({ sku, depth }) => {
            const indentStyle = { marginLeft: `${depth * 24}px` };
            const isAssembly = sku.skuRole === "assembly";

            if (isAssembly) {
              return (
                <div
                  key={sku.id}
                  style={indentStyle}
                  className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-800">
                      Assembly
                    </span>
                    <span className="font-semibold text-gray-900">
                      {sku.skuLabel}
                    </span>
                    <span className="text-gray-500">· {sku.productName}</span>
                    <span className="ml-auto text-xs text-gray-500">
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
                className="rounded-md border border-gray-200 bg-white"
              >
                <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900">
                  <span>
                    {sku.skuLabel} · {sku.productName}
                  </span>
                </summary>

                <div className="border-t border-gray-200 px-4 py-4">
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
      )}

      <div className="mt-6">
        <QuoteSummaryCard
          variant="compact"
          editable={editable}
          currentPage="production"
        />
      </div>
    </main>
    </CostingStoreProvider>
  );
}
