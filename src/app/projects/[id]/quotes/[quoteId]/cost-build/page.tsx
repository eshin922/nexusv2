import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bulkRawCategories,
  bulkRawIngredients,
  bulkRawSectionMeta,
  costSectionDeposits,
  freightInputs,
  packagingInputs,
  productionInputs,
  projects,
  quotes,
  quoteSkus,
  quoteTiers,
} from "@/db/schema";
import { listMarkupDefaults } from "@/app/actions/markup-defaults";
import { getCostingBundle } from "@/app/actions/costing";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { CostBuildHeader } from "@/components/cost-build/cost-build-header";
import { CostStackHeader } from "@/components/cost-build/cost-stack-header";
import { SectionWithDrilldown } from "@/components/cost-build/section-with-drilldown";
import { PackagingDrilldown } from "@/components/cost-build/packaging-drilldown";
import { ProductionDrilldown } from "@/components/cost-build/production-drilldown";
import { FreightDrilldown } from "@/components/cost-build/freight-drilldown";
import { BulkRawDrilldown } from "@/components/cost-build/bulk-raw-drilldown";
import { ModeSelector } from "@/components/cost-build/mode-selector";
import { WarningSummaryChip } from "@/components/warnings/warning-summary-chip";

// Slice RI.4 — Cost Build unification per Round 6 + Bulk Raw correction.
//
// Replaces the prior three pages (/packaging, /production, /freight)
// with a single Cost Build page composed of summary-with-drill-down
// sections + horizontal cost stack header at top.
//
// Page composition (top to bottom):
//   1. Page header — "Cost build · [Scenario] vN" + meta strip + warning chip
//   2. Cost stack header — multi-tier side-by-side per-tier columns
//      (5 rows by default; 6 rows when raws-mode = dps_sources)
//   3. Mode selector — three radio cards for raws-mode (drives Bulk Raw
//      visibility + cost-stack-row composition)
//   4. Section rows (Packaging / Production / Bulk Raw [conditional] /
//      Freight) — each with summary header (chevron + name + status
//      chip + per-tier mini-stack + open/close + deposit badge) + inline
//      drill-down panel below when expanded
//
// One drawer open at a time per page (UI state in <SectionWithDrilldown>
// composition; expanded section ID kept in URL searchParam for
// deep-linkability + page-refresh persistence).
//
// What's removed vs the prior three pages:
//   - Embedded Pricing Control Summary at bottom of each page (PCS lives
//     on Costing Sheet only after RI.5)
//   - Per-page navigation header (page-level header now)
//   - Per-page warning chip (cumulative chip in page header now)
//
// What's preserved (delegated to existing line-row components):
//   - PackagingLineRow + AddLineButton (packaging input UI)
//   - ProductionSection (production toggles + table + bulk raw cost)
//   - FreightLineRow + CustomsRow + AddFreightLineButton (freight UI)
//   These components are token-aware after RI.0 and don't need rebuilding
//   for RI.4. They'll be polished in a later sub-slice.

export default async function CostBuildPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quoteId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { id: projectId, quoteId } = await params;
  const { section: expandedSection } = await searchParams;

  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();

  // Single bundle fetch — all four sections + bulk raw schema state +
  // deposit lifecycle + costing bundle for the optimistic store.
  const [
    skus,
    tiers,
    pkgRows,
    prodRows,
    frtRows,
    categories,
    bundle,
    bulkRawMeta,
    bulkRawCats,
    bulkRawIngs,
    deposits,
  ] = await Promise.all([
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
    db
      .select()
      .from(productionInputs)
      .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
      .where(eq(quoteSkus.quoteId, quote.id)),
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
    listMarkupDefaults(),
    getCostingBundle(quote.id),
    db
      .select()
      .from(bulkRawSectionMeta)
      .where(eq(bulkRawSectionMeta.quoteId, quote.id))
      .limit(1),
    db
      .select()
      .from(bulkRawCategories)
      .where(eq(bulkRawCategories.quoteId, quote.id))
      .orderBy(asc(bulkRawCategories.sortOrder)),
    db
      .select()
      .from(bulkRawIngredients)
      .innerJoin(
        bulkRawCategories,
        eq(bulkRawCategories.id, bulkRawIngredients.categoryId),
      )
      .where(eq(bulkRawCategories.quoteId, quote.id))
      .orderBy(asc(bulkRawIngredients.sortOrder)),
    db
      .select()
      .from(costSectionDeposits)
      .where(eq(costSectionDeposits.quoteId, quote.id)),
  ]);

  if (!bundle.ok) {
    return (
      <main className="p-6">
        <div
          role="alert"
          className="rounded border border-bad bg-bad-soft p-4 text-sm text-bad"
        >
          Costing data unavailable: {bundle.error.message}
        </div>
      </main>
    );
  }

  const editable = quote.status === "draft";
  const rawsMode = bulkRawMeta[0]?.rawsMode ?? "cm_sources";
  const showBulkRawSection = rawsMode === "dps_sources";

  // Default open section: query param OR Packaging (most-common entry).
  const validSections = showBulkRawSection
    ? ["packaging", "production", "bulk_raw", "freight"]
    : ["packaging", "production", "freight"];
  const openSection =
    expandedSection && validSections.includes(expandedSection)
      ? expandedSection
      : "packaging";

  return (
    <CostingStoreProvider snapshot={bundle.data}>
      <main className="p-6">
        <CostBuildHeader
          project={project}
          quote={quote}
          editable={editable}
        >
          <WarningSummaryChip />
        </CostBuildHeader>

        {/* Cost stack header — multi-tier side-by-side */}
        <section className="mb-6">
          <CostStackHeader
            tiers={tiers.map((t) => ({
              id: t.id,
              label: t.label,
              qty: t.qty,
            }))}
            rawsMode={rawsMode}
          />
        </section>

        {/* Mode selector — drives Bulk Raw section visibility +
            cost-stack RAW row */}
        <section className="mb-6">
          <ModeSelector
            quoteId={quote.id}
            currentMode={rawsMode}
            disabled={!editable}
          />
        </section>

        {/* Sections — accordion-style summary-with-drill-down */}
        <div className="flex flex-col gap-3">
          <SectionWithDrilldown
            id="packaging"
            name="Packaging"
            sublabel={`${pkgRows.length} input rows`}
            statusChip={packagingStatusChip(pkgRows.length)}
            tiers={tiers.map((t) => ({ id: t.id, label: t.label, qty: t.qty }))}
            quoteId={quote.id}
            sectionKind="packaging"
            deposit={deposits.find((d) => d.sectionKind === "packaging")}
            isOpen={openSection === "packaging"}
            projectId={project.id}
          >
            <PackagingDrilldown
              skus={skus}
              tiers={tiers}
              inputRows={pkgRows}
              categories={categories}
              editable={editable}
            />
          </SectionWithDrilldown>

          <SectionWithDrilldown
            id="production"
            name="Production"
            sublabel={`${prodRows.length} input rows`}
            statusChip={productionStatusChip(prodRows.length)}
            tiers={tiers.map((t) => ({ id: t.id, label: t.label, qty: t.qty }))}
            quoteId={quote.id}
            sectionKind="production"
            deposit={deposits.find((d) => d.sectionKind === "production")}
            isOpen={openSection === "production"}
            projectId={project.id}
          >
            <ProductionDrilldown
              skus={skus}
              tiers={tiers}
              inputRows={prodRows}
              editable={editable}
              rawsMode={rawsMode}
            />
          </SectionWithDrilldown>

          {/* Bulk Raw section — only visible when raws-mode = dps_sources */}
          {showBulkRawSection && (
            <SectionWithDrilldown
              id="bulk_raw"
              name="Bulk Raw"
              sublabel={`${bulkRawCats.length} categor${bulkRawCats.length === 1 ? "y" : "ies"} · ${bulkRawIngs.length} ingredient${bulkRawIngs.length === 1 ? "" : "s"}`}
              statusChip={bulkRawStatusChip(
                bulkRawCats.length,
                bulkRawIngs.length,
              )}
              tiers={tiers.map((t) => ({ id: t.id, label: t.label, qty: t.qty }))}
              quoteId={quote.id}
              sectionKind="bulk_raw"
              deposit={deposits.find((d) => d.sectionKind === "bulk_raw")}
              isOpen={openSection === "bulk_raw"}
              projectId={project.id}
            >
              <BulkRawDrilldown
                quoteId={quote.id}
                categories={bulkRawCats}
                ingredients={bulkRawIngs.map((r) => ({
                  ...r.bulk_raw_ingredients,
                }))}
                editable={editable}
              />
            </SectionWithDrilldown>
          )}

          <SectionWithDrilldown
            id="freight"
            name="Freight"
            sublabel={`${frtRows.length} input rows`}
            statusChip={freightStatusChip(frtRows.length)}
            tiers={tiers.map((t) => ({ id: t.id, label: t.label, qty: t.qty }))}
            quoteId={quote.id}
            sectionKind="freight"
            isOpen={openSection === "freight"}
            projectId={project.id}
          >
            <FreightDrilldown
              skus={skus}
              tiers={tiers}
              inputRows={frtRows}
              editable={editable}
            />
          </SectionWithDrilldown>
        </div>
      </main>
    </CostingStoreProvider>
  );
}

function packagingStatusChip(rowCount: number) {
  if (rowCount === 0) return { label: "EMPTY", tone: "neutral" as const };
  return { label: "IN PROGRESS", tone: "active" as const };
}
function productionStatusChip(rowCount: number) {
  if (rowCount === 0) return { label: "EMPTY", tone: "neutral" as const };
  return { label: "IN PROGRESS", tone: "active" as const };
}
function freightStatusChip(rowCount: number) {
  if (rowCount === 0) return { label: "EMPTY", tone: "neutral" as const };
  return { label: "IN PROGRESS", tone: "active" as const };
}
function bulkRawStatusChip(catCount: number, ingCount: number) {
  if (catCount === 0) return { label: "EMPTY", tone: "neutral" as const };
  if (ingCount === 0)
    return { label: "CATEGORIES ONLY", tone: "neutral" as const };
  return { label: "IN PROGRESS", tone: "active" as const };
}
