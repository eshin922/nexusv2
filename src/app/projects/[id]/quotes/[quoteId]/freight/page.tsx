import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  freightInputs,
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
import { CustomsRow } from "./customs-row";
import { FreightLineRow } from "./freight-line-row";
import { AddFreightLineButton } from "./add-line-button";

export default async function FreightInputsPage({
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

  const [skus, tiers, frtRows, bundle] = await Promise.all([
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
      .from(freightInputs)
      .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
      .where(eq(quoteSkus.quoteId, quote.id))
      .orderBy(
        asc(freightInputs.sortOrder),
        asc(freightInputs.lineGroupId),
        asc(freightInputs.createdAt),
      ),
    getCostingBundle(quoteId),
  ]);

  const editable = quote.status === "draft";
  const tierBrief = tiers.map((t) => ({
    id: t.id,
    label: t.label,
    qty: t.qty,
  }));

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

  const linesBySku = new Map<string, Map<string, FreightLineForUI>>();
  for (const r of frtRows) {
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
        <h1 className="text-2xl font-semibold">Freight inputs</h1>
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
          Add at least one tier to the quote before entering freight inputs.
        </div>
      )}

      {skus.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Add at least one SKU to the quote before entering freight inputs.
        </div>
      ) : (
        <div className="grid gap-4">
          {buildTreeRenderOrder(skus).map(({ sku, depth }) => {
            const indentStyle = { marginLeft: `${depth * 24}px` };
            const isAssembly = sku.skuRole === "assembly";

            if (isAssembly) {
              // Assembly customs row: assemblies can carry duty/tariff
              // when the import is declared as a fully-assembled finished
              // good (one HS code for the whole assembly). Leaves of such
              // assemblies should NOT also carry customs (would
              // double-count). Roman gummies pattern declares per-leaf
              // and leaves the assembly's customs blank.
              return (
                <div
                  key={sku.id}
                  style={indentStyle}
                  className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-800">
                      Assembly
                    </span>
                    <span className="font-semibold text-gray-900">
                      {sku.skuLabel}
                    </span>
                    <span className="text-gray-500">· {sku.productName}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      Freight costs roll up from leaf children.
                    </span>
                  </div>
                  {/* Customs row — populate only if customs declares at
                      the assembly level (fully-assembled finished goods).
                      Otherwise leave blank and put customs on the leaves. */}
                  <CustomsRow
                    quoteSkuId={sku.id}
                    dutyPct={sku.dutyPct}
                    tariffPct={sku.tariffPct}
                    disabled={!editable}
                  />
                </div>
              );
            }

            const lines = Array.from(
              linesBySku.get(sku.id)?.values() ?? [],
            ).sort((a, b) => a.sortOrder - b.sortOrder);

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

                <div className="border-t border-gray-200 px-4 py-3">
                  {/* Slice 6.5 — per-SKU customs row (duty/tariff only;
                      CBM moved to per-(line, tier) on freight rows in
                      Slice 8 schema correction). */}
                  <CustomsRow
                    quoteSkuId={sku.id}
                    dutyPct={sku.dutyPct}
                    tariffPct={sku.tariffPct}
                    disabled={!editable}
                  />

                  {/* Freight lines grid */}
                  {lines.length === 0 ? (
                    <p className="mt-4 py-4 text-center text-sm text-gray-500">
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
      )}

      <div className="mt-6">
        <QuoteSummaryCard
          variant="compact"
          editable={editable}
          currentPage="freight"
        />
      </div>
    </main>
    </CostingStoreProvider>
  );
}
