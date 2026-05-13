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
import { Suspense } from "react";
import { listMarkupDefaults } from "@/app/actions/markup-defaults";
import { getCostingBundle } from "@/app/actions/costing";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { ActiveTierUrlSync } from "@/components/pricing/active-tier-url-sync";
import {
  CostsHeader,
  SentStatusBanner,
} from "@/components/costs/costs-header";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { CostStackHeader } from "@/components/costs/cost-stack-header";
import { CostBuildAccordion } from "@/components/costs/costs-accordion";
import { ScenarioContextStrip } from "@/components/costs/scenario-context-strip";
import { SectionWithDrilldown } from "@/components/costs/section-with-drilldown";
import { PackagingDrilldown } from "@/components/costs/packaging-drilldown";
import { ProductionDrilldown } from "@/components/costs/production-drilldown";
import { FreightDrilldown } from "@/components/costs/freight-drilldown";
import { BulkRawDrilldown } from "@/components/costs/bulk-raw-drilldown";
import { WarningSummaryChip } from "@/components/warnings/warning-summary-chip";

// Slice RI.4 — Costs unification per Round 6 + Bulk Raw correction.
//
// Replaces the prior three pages (/packaging, /production, /freight)
// with a single Costs page composed of summary-with-drill-down
// sections + horizontal cost stack header at top.
//
// Page composition (top to bottom):
//   1. Page header — "Costs · [Scenario] vN" + meta strip + warning chip
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
//     on Pricing only after RI.5)
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

  // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
  await recordSurfaceVisit({
    projectId,
    quoteId,
    surfaceKey: "cost_build",
  });

  const quoteRows = await db
    .select({ quote: quotes, project: projects })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (quoteRows.length === 0) notFound();
  const { quote, project } = quoteRows[0];
  if (project.id !== projectId) notFound();

  // getCostingBundle MUST run sequentially (not inside the outer
  // Promise.all). Its internal Promise.all of 8 queries combined with
  // 7 outer parallel queries used to demand 15+ pool slots from a
  // 10-slot pool — observed as indefinite hang in dev (Slice RI.4
  // infrastructure thread, May 2026). Sequencing caps peak demand
  // at max(8, 7) = 8. See CLAUDE.md "getCostingBundle parallel-query
  // discipline" for the durable convention.
  const bundle = await getCostingBundle(quote.id);

  const [
    skus,
    tiers,
    pkgRows,
    prodRows,
    frtRows,
    categories,
    bulkRawMeta,
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
    db
      .select()
      .from(bulkRawSectionMeta)
      .where(eq(bulkRawSectionMeta.quoteId, quote.id))
      .limit(1),
  ]);

  // Phase 2: Bulk Raw categories/ingredients only when in dps_sources
  // mode (the only time the data is rendered). Skip otherwise — saves
  // 2 queries per page load when mode = cm_sources / customer_supplies.
  const rawsModeForFetch =
    bulkRawMeta[0]?.rawsMode ?? "cm_sources";
  const [bulkRawCats, bulkRawIngs, deposits] = await Promise.all([
    rawsModeForFetch === "dps_sources"
      ? db
          .select()
          .from(bulkRawCategories)
          .where(eq(bulkRawCategories.quoteId, quote.id))
          .orderBy(asc(bulkRawCategories.sortOrder))
      : Promise.resolve(
          [] as (typeof bulkRawCategories.$inferSelect)[],
        ),
    rawsModeForFetch === "dps_sources"
      ? db
          .select()
          .from(bulkRawIngredients)
          .innerJoin(
            bulkRawCategories,
            eq(bulkRawCategories.id, bulkRawIngredients.categoryId),
          )
          .where(eq(bulkRawCategories.quoteId, quote.id))
          .orderBy(asc(bulkRawIngredients.sortOrder))
      : Promise.resolve(
          [] as Array<{
            bulk_raw_ingredients: typeof bulkRawIngredients.$inferSelect;
            bulk_raw_categories: typeof bulkRawCategories.$inferSelect;
          }>,
        ),
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

  const tierBrief = tiers.map((t) => ({
    id: t.id,
    label: t.label,
    qty: t.qty,
  }));

  // Bulk Raw section ALWAYS renders as a peer (per Round 6 + Bulk Raw
  // correction; Designer audit C-1). Mode selector lives INSIDE the
  // section (mode-declaration zone). When raws-mode != dps_sources,
  // the drilldown shows the mode selector + INACTIVE message; when
  // dps_sources, full categories + ingredients UI.
  const validSections = ["packaging", "production", "bulk_raw", "freight"];
  const openSection =
    expandedSection && validSections.includes(expandedSection)
      ? expandedSection
      : "packaging";

  return (
    <CostingStoreProvider snapshot={bundle.data}>
      {/* URL ↔ store sync for active-tier selection. Suspense
          boundary required for useSearchParams in app router. */}
      <Suspense fallback={null}>
        <ActiveTierUrlSync />
      </Suspense>
      {/* Body bg is now paper-2 globally (matches R6); cost-stack +
          section bg-paper cards read as contrast field. Max-width
          1480px + 40px horizontal padding per R6 `.r6-page`
          (Designer audit C-6). 28px top + 80px bottom matches R6. */}
      <main
        className="mx-auto px-10 pt-7 pb-20"
        style={{ maxWidth: "1480px" }}
      >
        <CostsHeader
          project={project}
          quote={{
            ...quote,
            projectId: project.id,
          }}
          tierCount={tiers.length}
          editable={editable}
        >
          <WarningSummaryChip />
        </CostsHeader>

        {/* Slice RI.7 — page-level state notice. Banner moved out of
            CostsHeader's flex container (was squeezing the title
            column to 1-2-word wraps once it appeared on sent quotes). */}
        {!editable && <SentStatusBanner status={quote.status} />}

        {/* Slice RI.9 § 3.3 — YOUR NEXT MOVE banner. Cost build →
            Costing (Pricing) is the canonical forward step. Hides on
            non-draft quotes (banner makes no sense once sent). */}
        {editable && (
          <YourNextMoveBanner
            state="default"
            label={SURFACE_META.cost_build.nextMove?.label ?? "Review pricing →"}
            href={resolveSurfaceHref("costing", project.id, quote.id)}
          />
        )}

        {/* Scenario context strip — anchor SKU + tier count + units
            total + scenario-switch affordance per Round 6 data-source-
            map page-level identity table. Renders ABOVE cost stack. */}
        <ScenarioContextStrip
          projectId={project.id}
          scenarioLabel={quote.scenarioLabel}
          scenarioVersion={quote.versionNumber}
          anchorSku={(() => {
            // V1 anchor SKU = first leaf SKU. There's no `is_anchor`
            // column today; per-quote anchor pinning is a future
            // enhancement (UX_BACKLOG candidate when surfaces need it).
            const leaves = skus.filter((s) => s.skuRole === "leaf");
            const first = leaves[0] ?? skus[0] ?? null;
            return first
              ? {
                  id: first.id,
                  skuLabel: first.skuLabel,
                  productName: first.productName,
                  skuRole: first.skuRole,
                }
              : null;
          })()}
          otherSkus={(() => {
            const leaves = skus.filter((s) => s.skuRole === "leaf");
            const anchor = leaves[0] ?? skus[0];
            return skus
              .filter((s) => s.id !== anchor?.id)
              .map((s) => ({
                id: s.id,
                skuLabel: s.skuLabel,
                productName: s.productName,
                skuRole: s.skuRole,
              }));
          })()}
          tierCount={tiers.length}
          unitsTotal={tiers.reduce((sum, t) => sum + (t.qty ?? 0), 0)}
        />

        {/* Cost stack header — multi-tier side-by-side */}
        <section className="mb-6">
          <CostStackHeader tiers={tierBrief} rawsMode={rawsMode} />
        </section>

        {/* Sections — accordion-style summary-with-drill-down. Open
            state is client-managed via <CostBuildAccordion> context
            (RI.4 perf fix per Edward smoke item (a)). All drawer
            content stays mounted server-side; CSS hides/shows on
            toggle. Mode selector lives inside the Bulk Raw drilldown
            per Round 6 + Bulk Raw correction (Designer audit C-1). */}
        <CostBuildAccordion
          initialOpen={openSection}
          projectId={project.id}
          quoteId={quote.id}
        >
          <SectionWithDrilldown
            id="packaging"
            name="Packaging"
            sublabel={packagingSublabel(pkgRows)}
            statusChip={packagingStatusChip(pkgRows.length)}
            tiers={tierBrief}
            sectionKind="packaging"
            lineCount={pkgRows.length}
            deposit={deposits.find((d) => d.sectionKind === "packaging")}
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
            sublabel={productionSublabel(prodRows)}
            statusChip={productionStatusChip(prodRows.length)}
            tiers={tierBrief}
            sectionKind="production"
            lineCount={prodRows.length}
            deposit={deposits.find((d) => d.sectionKind === "production")}
            indicatorChip={productionIndicatorChip(prodRows)}
          >
            <ProductionDrilldown
              skus={skus}
              tiers={tiers}
              inputRows={prodRows}
              editable={editable}
              rawsMode={rawsMode}
            />
          </SectionWithDrilldown>

          {/* Bulk Raw section — always renders per Round 6 + Bulk Raw
              correction (mode-declaration zone). Drilldown content
              varies by mode: when dps_sources, categories + ingredients;
              when cm_sources or customer_supplies, INACTIVE message
              with explanation. Designer audit C-1. */}
          <SectionWithDrilldown
            id="bulk_raw"
            name="Bulk Raw"
            sublabel={bulkRawSublabel(rawsMode, bulkRawCats.length, bulkRawIngs.length)}
            statusChip={bulkRawStatusChip(
              rawsMode,
              bulkRawCats.length,
              bulkRawIngs.length,
            )}
            tiers={tierBrief}
            sectionKind="bulk_raw"
            lineCount={bulkRawCats.length}
            deposit={deposits.find((d) => d.sectionKind === "bulk_raw")}
          >
            <BulkRawDrilldown
              quoteId={quote.id}
              rawsMode={rawsMode}
              categories={bulkRawCats}
              ingredients={bulkRawIngs.map((r) => ({
                ...r.bulk_raw_ingredients,
              }))}
              editable={editable}
            />
          </SectionWithDrilldown>

          <SectionWithDrilldown
            id="freight"
            name="Freight"
            sublabel={freightSublabel(frtRows)}
            statusChip={freightStatusChip(frtRows.length)}
            tiers={tierBrief}
            sectionKind="freight"
            lineCount={frtRows.length}
          >
            <FreightDrilldown
              skus={skus}
              tiers={tiers}
              inputRows={frtRows}
              editable={editable}
            />
          </SectionWithDrilldown>
        </CostBuildAccordion>
      </main>
    </CostingStoreProvider>
  );
}

// R6 status chip is driven by kind enum only — no custom labels (per
// Designer audit C-3 + R6 section-summary-row.jsx:18-23).
function packagingStatusChip(rowCount: number) {
  if (rowCount === 0) return { kind: "empty" as const };
  return { kind: "in_progress" as const };
}
function productionStatusChip(rowCount: number) {
  if (rowCount === 0) return { kind: "empty" as const };
  return { kind: "in_progress" as const };
}
function freightStatusChip(rowCount: number) {
  if (rowCount === 0) return { kind: "empty" as const };
  return { kind: "in_progress" as const };
}
function bulkRawStatusChip(
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies",
  catCount: number,
  ingCount: number,
) {
  // R6 cost-build-page.jsx:174-180: when raws are accounted for
  // elsewhere (cm_sources / customer_supplies), Bulk Raw section is
  // semantically "complete." NOT "INACTIVE."
  if (rawsMode !== "dps_sources") return { kind: "complete" as const };
  if (catCount === 0) return { kind: "empty" as const };
  return { kind: "in_progress" as const };
}

function bulkRawSublabel(
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies",
  catCount: number,
  ingCount: number,
): string {
  switch (rawsMode) {
    case "cm_sources":
      return "CM sources raws — folded into Production";
    case "customer_supplies":
      return "Customer supplies raws — no cost contribution";
    case "dps_sources":
      if (catCount === 0)
        return "Oil base, actives, fragrance, preservatives — billed in kg / L / mL";
      return `${catCount} categor${catCount === 1 ? "y" : "ies"} · ${ingCount} ingredient${ingCount === 1 ? "" : "s"} · native units`;
  }
}

// Sublabel helpers — semantic meta per R6 source
// (cost-build-page.jsx lines 144-146, 160-164, 184-192, 210-214).
// PMs read these to understand "what's the shape of this section's
// data?" not "how many rows are in it?". When empty, evocative copy
// describes what the section will hold (drives PM toward population).

function packagingSublabel(
  rows: Array<{ packaging_inputs: { lineGroupId: string; supplier: string | null; inventoryEligible: boolean } }>,
): string {
  if (rows.length === 0)
    return "Bottle, dropper, label, carton — markup defaults from category";
  // Dedup by lineGroupId — one logical line has N tier rows in DB
  const lines = new Map<string, { supplier: string | null; inventoryEligible: boolean }>();
  for (const r of rows) {
    if (!lines.has(r.packaging_inputs.lineGroupId)) {
      lines.set(r.packaging_inputs.lineGroupId, {
        supplier: r.packaging_inputs.supplier,
        inventoryEligible: r.packaging_inputs.inventoryEligible,
      });
    }
  }
  const inventoryCount = [...lines.values()].filter((l) => l.inventoryEligible).length;
  const supplierSet = new Set(
    [...lines.values()].map((l) => l.supplier).filter((s): s is string => !!s),
  );
  return `${inventoryCount} inventory-eligible · ${supplierSet.size} supplier${supplierSet.size === 1 ? "" : "s"}`;
}

function productionSublabel(
  rows: Array<{ production_inputs: { allocateServiceFeesToCost: boolean; actualUnitsProduced: number | null } }>,
): string {
  if (rows.length === 0)
    return "Filling, assembly, NRE — service fees & per-unit price";
  // R6 sublabel: "fees amortized · run locked" / "fees billed separately".
  // Nexus has allocate_service_fees_to_cost per SKU; majority-vote.
  const allocCount = rows.filter((r) => r.production_inputs.allocateServiceFeesToCost).length;
  const allocText = allocCount > rows.length / 2 ? "fees amortized" : "fees billed separately";
  // Run-locked = any row has actualUnitsProduced set.
  const runLocked = rows.some((r) => r.production_inputs.actualUnitsProduced != null);
  return runLocked ? `${allocText} · run locked` : allocText;
}

// Slice RI.8 Option A hotfix — when production rows are MAJORITY
// billed-separately, the cost-stack PROD column reads em-dash even
// though services are real costs. The chip surfaces "why" so PMs
// don't read em-dash as a broken compute. Services still flow to
// revenue via separateServicesMarkupSum and margin is correct;
// they just don't roll into the production-cost bucket.
//
// Pattern: chip only renders when the visual surface is at risk of
// being misread. If all rows allocate (default), no chip needed.
function productionIndicatorChip(
  rows: Array<{ production_inputs: { allocateServiceFeesToCost: boolean } }>,
): { label: string; tone: "warn" | "neutral" | "accent" } | undefined {
  if (rows.length === 0) return undefined;
  const allocCount = rows.filter(
    (r) => r.production_inputs.allocateServiceFeesToCost,
  ).length;
  const majorityBilledSeparately = allocCount <= rows.length / 2;
  if (!majorityBilledSeparately) return undefined;
  return {
    label: "services billed separately · not in cost bucket",
    tone: "neutral",
  };
}

function freightSublabel(
  rows: Array<{ freight_inputs: { lineGroupId: string; freightTreatment: "bundled" | "pass_through" } }>,
): string {
  if (rows.length === 0)
    return "Inbound, outbound, customs — per-line treatment";
  // Dedup by lineGroupId. Count bundled vs passthrough.
  const lines = new Map<string, "bundled" | "pass_through">();
  for (const r of rows) {
    if (!lines.has(r.freight_inputs.lineGroupId)) {
      lines.set(r.freight_inputs.lineGroupId, r.freight_inputs.freightTreatment);
    }
  }
  const bundled = [...lines.values()].filter((t) => t === "bundled").length;
  const pass = [...lines.values()].filter((t) => t === "pass_through").length;
  const lineCount = lines.size;
  return `${lineCount} line${lineCount === 1 ? "" : "s"} · ${bundled} bundled, ${pass} passthrough · customs on DDP`;
}
