import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  // Slice 11.5 — NEW-model cost-data tables (Step 2 schema).
  assemblies,
  assemblyLeafInputs,
  assemblyLeaves,
  assemblyProductionInputs,
  bulkRawSectionMeta,
  costSectionDeposits,
  leaves,
  projects,
  quoteLeaves,
  quotes,
  quoteClientTargets,
  quoteTiers,
} from "@/db/schema";
import { Suspense } from "react";
import { listMarkupDefaults } from "@/app/actions/markup-defaults";
import { getCostingBundle } from "@/app/actions/costing";
import { CostingStoreProvider } from "@/components/costing-store-provider";
import { isProductionRealtimeConfigured } from "@/lib/integrations/realtime-composition";
import { ActiveTierUrlSync } from "@/components/pricing/active-tier-url-sync";
import {
  CostsHeader,
  SentStatusBanner,
} from "@/components/costs/costs-header";
import { YourNextMoveBanner } from "@/components/nav/your-next-move-banner";
import { NavShell } from "@/components/nav/nav-shell";
import { resolveSurfaceHref } from "@/lib/nav/surface-routes";
import { SURFACE_META } from "@/lib/nav/surface-meta";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { CostStackHeader } from "@/components/costs/cost-stack-header";
import { CostBuildAccordion } from "@/components/costs/costs-accordion";
import { ScenarioContextStrip } from "@/components/costs/scenario-context-strip";
import { ClientTargetContext } from "@/components/costs/client-target-context";
import { SectionWithDrilldown } from "@/components/costs/section-with-drilldown";
import { PackagingDrilldown } from "@/components/costs/packaging-drilldown";
import { ProductionDrilldown } from "@/components/costs/production-drilldown";
import { FreightDrilldown } from "@/components/costs/freight-drilldown";
import { WarningSummaryChip } from "@/components/warnings/warning-summary-chip";
import { loadFreightWorkbook, type FreightWorkbook } from "@/lib/freight-workbook";

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
//   3. Section rows (Packaging / Production / Freight) — each with
//      summary header (chevron + name + status
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
// Slice R6.2 — FreightDrilldown rebuilt against the multi-leg journey
// schema; the original /freight subroute components were retired in
// commit 2. New surface lives in src/components/costs/freight-drilldown.tsx
// + canonical CSS at src/styles/r6-2-freight.css (Pattern 30 verbatim).

export default async function CostBuildPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quoteId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  // 2026-06-17 prod-hang Vercel-side instrumentation (per Edward's
  // CC handoff comm). Empirically confirmed via Client/ClientRead
  // wait state on the DB side that queries complete instantly but
  // the Vercel function dies before reading the result. This
  // logging surfaces WHICH phase the function dies in.
  //
  // Read pattern: grep Vercel function logs for `[costs:<8charuuid>]`.
  // The phases are sequential — the LAST log line printed before
  // a hang identifies the next operation as the hang point.
  //
  //   start      → recordSurfaceVisit (auth + 1 db write)
  //   post-auth  → meta query (quote + project)
  //   post-meta  → getCostingBundle (10 DB queries internally)
  //   post-bundle → outer Promise.all of 8 queries + phase 2 of 3
  //   pre-render → React tree build + RSC serialization (function returns)
  //
  // If we see "post-bundle" but no "pre-render": hang is in the
  // outer Promise.all + phase 2 (or some intermediate). If we see
  // "pre-render" but RSC fetch still hangs: hang is in RSC
  // streaming / React tree render.
  //
  // Memory deltas across phases isolate OOM kills. Vercel default
  // function memory is 1024 MB (Hobby) / 1024 MB or higher (Pro
  // configurable up to 3008 MB). If heap climbs past 900 MB before
  // a hang, OOM-kill is the explanation.
  const t0 = Date.now();
  const heapMb = () =>
    Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  const elapsed = () => `${Date.now() - t0}ms`;
  const { id: projectId, quoteId } = await params;
  const { section: expandedSection } = await searchParams;
  const tag = quoteId.slice(0, 8);
  console.log(`[costs:${tag}] start memory=${heapMb()}MB`);

  try {
    // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
    await recordSurfaceVisit({
      projectId,
      quoteId,
      surfaceKey: "cost_build",
    });
    console.log(`[costs:${tag}] post-auth ${elapsed()} memory=${heapMb()}MB`);

    const quoteRows = await db
      .select({ quote: quotes, project: projects })
      .from(quotes)
      .innerJoin(projects, eq(projects.id, quotes.projectId))
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (quoteRows.length === 0) notFound();
    const { quote, project } = quoteRows[0];
    if (project.id !== projectId) notFound();
    console.log(`[costs:${tag}] post-meta ${elapsed()} memory=${heapMb()}MB`);

    // getCostingBundle MUST run sequentially (not inside the outer
    // Promise.all). Its internal Promise.all of 8 queries combined with
    // 7 outer parallel queries used to demand 15+ pool slots from a
    // 10-slot pool — observed as indefinite hang in dev (Slice RI.4
    // infrastructure thread, May 2026). Sequencing caps peak demand
    // at max(8, 7) = 8. See CLAUDE.md "getCostingBundle parallel-query
    // discipline" for the durable convention.
    const bundle = await getCostingBundle(quote.id);
    console.log(`[costs:${tag}] post-bundle ${elapsed()} memory=${heapMb()}MB`);

  // Slice 11.5 Step 3 — NEW-model outer load. Queries the NEW
  // cost-data tables (assemblies + assembly_leaves + library leaves
  // + assembly_leaf_inputs + assembly_production_inputs) and
  // reshapes into the OLD wrapper shape (quote_skus, packaging_inputs,
  // production_inputs) so downstream drilldowns continue to work
  // unchanged per Q2 (a) disposition. Step 5 verifies the reshape
  // doesn't break drilldown rendering.
  //
  // Anchor-leaf production fan-out: assembly_production_inputs is
  // per-(assembly, tier) but the drilldown iterates leaf rows.
  // Adapter attaches production data to the FIRST assembly_leaf
  // under each assembly (lowest position). See
  // src/lib/costing-adapter.ts header comment for the rationale.
  const [
    newAssemblyRows,
    newAssemblyLeafJoinRows,
    newDirectProductRows,
    newPkgInputRows,
    newProdInputRows,
    tiers,
    categories,
    bulkRawMeta,
    freightWorkbook,
    clientTargetRows,
  ] = await Promise.all([
    db
      .select()
      .from(assemblies)
      .where(eq(assemblies.quoteId, quote.id))
      .orderBy(asc(assemblies.position), asc(assemblies.createdAt)),
    db
      .select({ assembly_leaves: assemblyLeaves, leaves })
      .from(assemblyLeaves)
      .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
      .innerJoin(leaves, eq(leaves.id, assemblyLeaves.leafId))
      .where(eq(assemblies.quoteId, quote.id))
      .orderBy(
        asc(assemblyLeaves.assemblyId),
        asc(assemblyLeaves.position),
      ),
    // Direct Products — attached to the quote with no assembly, so they have no
    // `assembly_leaves` row and the join above cannot see them. Their cost rows
    // DO arrive (the input query below scopes canonically through
    // `quote_leaves`), so without this the surface renders a priced row it
    // cannot name: "Unknown component".
    //
    // Found by the operator walk, not by the structural tests — those proved
    // the attachment and the Setup render, and this surface resolves identity
    // through a different query.
    db
      .select({ quote_leaves: quoteLeaves, leaves })
      .from(quoteLeaves)
      .innerJoin(leaves, eq(leaves.id, quoteLeaves.leafId))
      .where(
        and(eq(quoteLeaves.quoteId, quote.id), isNull(quoteLeaves.assemblyId)),
      )
      .orderBy(asc(quoteLeaves.position), asc(quoteLeaves.createdAt)),
    db
      .select({ assembly_leaf_inputs: assemblyLeafInputs })
      .from(assemblyLeafInputs)
      // OD-017 · canonical scoping, matching getCostingBundle. Joining through
      // `assemblies` here would hide a Direct Component's rows from the surface
      // that authors them.
      .innerJoin(
        quoteLeaves,
        eq(quoteLeaves.id, assemblyLeafInputs.quoteLeafId),
      )
      .where(eq(quoteLeaves.quoteId, quote.id))
      .orderBy(
        asc(assemblyLeafInputs.sortOrder),
        asc(assemblyLeafInputs.lineGroupId),
        asc(assemblyLeafInputs.createdAt),
      ),
    db
      .select({ assembly_production_inputs: assemblyProductionInputs })
      .from(assemblyProductionInputs)
      .innerJoin(
        assemblies,
        eq(assemblies.id, assemblyProductionInputs.assemblyId),
      )
      .where(eq(assemblies.quoteId, quote.id)),
    db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quote.id))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
    // Slice R6.2 — multi-leg journey freight: load groups + legs for
    // the sublabel / section-count rendering. The drilldown component
    // pulls leg-tier data from the CostingStore (already hydrated via
    // bundle.data above), so we don't need to re-load it here.
    listMarkupDefaults(),
    db
      .select()
      .from(bulkRawSectionMeta)
      .where(eq(bulkRawSectionMeta.quoteId, quote.id))
      .limit(1),
    loadFreightWorkbook(quote.id),
    // Client Target rows, read-only context for the strip below the stack.
    // A sibling of the existing batch rather than a nested fan-out: peak
    // demand stays max(N), which is the discipline `getCostingBundle`'s
    // header records.
    db
      .select()
      .from(quoteClientTargets)
      .where(eq(quoteClientTargets.quoteId, quote.id)),
  ]);

  // Slice 11.5 Step 3 — NEW-model → OLD-wrapper-shape reshape.
  // Synthesizes objects that match the shapes downstream drilldowns
  // already consume (typeof quoteSkus.$inferSelect, plus
  // `{packaging_inputs: <row>}` and `{production_inputs: <row>}`
  // wrappers). Per Q2 (a) disposition: preserve drilldown prop
  // shapes; point underlying row IDs at NEW tables.
  //
  // Cardinality:
  //   - One synthetic quote_sku per assembly (skuRole='assembly',
  //     parentSkuId=null)
  //   - One synthetic quote_sku per assembly_leaf (skuRole='leaf',
  //     parentSkuId=parent assembly.id, productName/skuLabel from
  //     library leaf)
  //   - One synthetic packaging_inputs row per assembly_leaf_inputs
  //     row (1:1)
  //   - One synthetic production_inputs row per assembly_production_inputs
  //     row, attached to the FIRST assembly_leaf under that assembly
  //     (anchor-leaf fan-out; see src/lib/costing-adapter.ts header
  //     for rationale)
  // Step 8 — synthetic shapes inlined (Slice 11.5 close-out). The
  // OLD `quote_skus` / `packaging_inputs` / `production_inputs`
  // schema types are dropped in this slice; downstream drilldowns
  // continue to consume the same field shape via these structural
  // types.
  type SyntheticQuoteSku = {
    id: string;
    // OD-017 governed cost-input identity. `id` remains the assembly_leaf id
    // because the production anchor-leaf fan-out and the assembly tree are
    // keyed on it, but every COST row now carries `quote_leaf_id` — so any
    // consumer joining against a cost row must key on THIS field, not `id`.
    // NOT NULL on assembly_leaves (unique index
    // `assembly_leaves_quote_leaf_idx`), so it is always present for a leaf;
    // null for an assembly, which owns no cost row.
    quoteLeafId: string | null;
    quoteId: string;
    hubspotProductId: string | null;
    skuLabel: string;
    productName: string;
    unitsPerPack: number;
    retailBenchmark: string | null;
    sortOrder: number;
    notes: string | null;
    lastHubspotRefreshAt: Date | null;
    parentSkuId: string | null;
    skuRole: "leaf" | "assembly";
    qtyPerParent: string | null;
    dutyPct: string | null;
    tariffPct: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type SyntheticPackagingRow = {
    packaging_inputs: {
      id: string;
      quoteSkuId: string;
      tierId: string;
      lineGroupId: string;
      sortOrder: number;
      pricingVendorHubspotCompanyId: string | null;
      pricingVendorNameSnapshot: string | null;
      supplier: string | null;
      qtyPerSellableUnit: string | null;
      category: string | null;
      markupPct: string | null;
      markupPctSource: "category_default" | "manual_override" | null;
      inventoryEligible: boolean;
      notes: string | null;
      unitCost: string | null;
      purchaseQty: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
  };
  type SyntheticProductionRow = {
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
      createdAt: Date;
      updatedAt: Date;
    };
  };
  const newAssemblyLeafRows = newAssemblyLeafJoinRows.map((r) => ({
    leaf: r.leaves,
    al: r.assembly_leaves,
  }));

  const skus: SyntheticQuoteSku[] = [];
  for (const a of newAssemblyRows) {
    skus.push({
      id: a.id,
      // An assembly owns no cost row, so it has no governed cost-input identity.
      quoteLeafId: null,
      quoteId: a.quoteId,
      hubspotProductId: null,
      skuLabel: a.sku,
      productName: a.name,
      unitsPerPack: 1,
      retailBenchmark: null,
      sortOrder: a.position,
      notes: a.internalNotes,
      lastHubspotRefreshAt: null,
      parentSkuId: null,
      skuRole: "assembly",
      qtyPerParent: null,
      dutyPct: null,
      tariffPct: null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    });
  }
  for (const { al, leaf } of newAssemblyLeafRows) {
    skus.push({
      id: al.id,
      // The identity every assembly_leaf_inputs row carries (see type comment).
      quoteLeafId: al.quoteLeafId,
      quoteId: quote.id,
      hubspotProductId: leaf.hubspotProductId ?? null,
      // leaves.sku is nullable; quote_skus.skuLabel is NOT NULL.
      // Empty string fallback satisfies the synthetic shape.
      skuLabel: leaf.sku ?? "",
      productName: leaf.name,
      unitsPerPack: 1,
      retailBenchmark: null,
      sortOrder: al.position,
      notes: null,
      lastHubspotRefreshAt: null,
      parentSkuId: al.assemblyId,
      skuRole: "leaf",
      qtyPerParent: al.quantity,
      dutyPct: null,
      tariffPct: null,
      createdAt: al.createdAt,
      updatedAt: al.createdAt,
    });
  }
  // Direct Products enter the same synthetic-SKU list as leaves. `id` carries
  // the canonical quote_leaf id because there is no legacy junction id to carry
  // — and `parentSkuId` stays null, which is what makes the row a quote-level
  // product rather than a member of anything.
  for (const { quote_leaves: ql, leaves: leaf } of newDirectProductRows) {
    skus.push({
      id: ql.id,
      quoteLeafId: ql.id,
      quoteId: quote.id,
      hubspotProductId: leaf.hubspotProductId ?? null,
      skuLabel: leaf.sku ?? "",
      productName: leaf.name,
      unitsPerPack: 1,
      retailBenchmark: null,
      sortOrder: ql.position,
      notes: null,
      lastHubspotRefreshAt: null,
      parentSkuId: null,
      skuRole: "leaf",
      qtyPerParent: ql.quantity,
      dutyPct: null,
      tariffPct: null,
      createdAt: ql.createdAt,
      updatedAt: ql.createdAt,
    });
  }

  const pkgRows: SyntheticPackagingRow[] = newPkgInputRows.map((r) => ({
    packaging_inputs: {
      id: r.assembly_leaf_inputs.id,
      quoteSkuId: r.assembly_leaf_inputs.quoteLeafId,
      tierId: r.assembly_leaf_inputs.tierId,
      lineGroupId: r.assembly_leaf_inputs.lineGroupId,
      sortOrder: r.assembly_leaf_inputs.sortOrder,
      pricingVendorHubspotCompanyId:
        r.assembly_leaf_inputs.pricingVendorHubspotCompanyId,
      pricingVendorNameSnapshot:
        r.assembly_leaf_inputs.pricingVendorNameSnapshot,
      supplier: r.assembly_leaf_inputs.supplier,
      qtyPerSellableUnit: r.assembly_leaf_inputs.qtyPerSellableUnit,
      category: r.assembly_leaf_inputs.category,
      markupPct: r.assembly_leaf_inputs.markupPct,
      markupPctSource: r.assembly_leaf_inputs.markupPctSource,
      inventoryEligible: r.assembly_leaf_inputs.inventoryEligible,
      notes: r.assembly_leaf_inputs.notes,
      unitCost: r.assembly_leaf_inputs.unitCost,
      purchaseQty: r.assembly_leaf_inputs.purchaseQty,
      createdAt: r.assembly_leaf_inputs.createdAt,
      updatedAt: r.assembly_leaf_inputs.updatedAt,
    },
  }));

  // Anchor-leaf fan-out for production. assembly_production_inputs
  // is keyed by (assembly_id, tier_id); the math layer + drilldown
  // iterate leaf skus. Pick the lowest-position assembly_leaf per
  // assembly as the anchor.
  const anchorLeafByAssembly = new Map<string, string>();
  {
    const leavesByAssembly = new Map<
      string,
      typeof newAssemblyLeafRows
    >();
    for (const r of newAssemblyLeafRows) {
      const arr = leavesByAssembly.get(r.al.assemblyId) ?? [];
      arr.push(r);
      leavesByAssembly.set(r.al.assemblyId, arr);
    }
    for (const [assemblyId, group] of leavesByAssembly) {
      const sorted = [...group].sort((a, b) => a.al.position - b.al.position);
      if (sorted.length > 0)
        anchorLeafByAssembly.set(assemblyId, sorted[0].al.id);
    }
  }

  const prodRows: SyntheticProductionRow[] = [];
  for (const r of newProdInputRows) {
    const api = r.assembly_production_inputs;
    const anchorLeafId = anchorLeafByAssembly.get(api.assemblyId);
    if (!anchorLeafId) continue;
    prodRows.push({
      production_inputs: {
        id: api.id,
        quoteSkuId: anchorLeafId,
        tierId: api.tierId,
        customerShipsRaws: api.customerShipsRaws,
        allocateServiceFeesToCost: api.allocateServiceFeesToCost,
        notes: api.notes,
        fillingBlendingCost: api.fillingBlendingCost,
        cmAssemblyTotal: api.cmAssemblyTotal,
        setupFeeTotal: api.setupFeeTotal,
        toolingArtworkTotal: api.toolingArtworkTotal,
        rdTotal: api.rdTotal,
        otherServiceTotal: api.otherServiceTotal,
        bulkRawCost: api.bulkRawCost,
        actualUnitsProduced: api.actualUnitsProduced,
        createdAt: api.createdAt,
        updatedAt: api.updatedAt,
      },
    });
  }

  const deposits = await db
    .select()
    .from(costSectionDeposits)
    .where(eq(costSectionDeposits.quoteId, quote.id));

  if (!bundle.ok) {
    console.log(
      `[costs:${tag}] pre-render(error) ${elapsed()} memory=${heapMb()}MB`,
    );
    return (
      <NavShell
        surfaceKey="cost_build"
        projectId={projectId}
        quoteId={quoteId}
        activeScenarioLabel={quote.scenarioLabel}
      >
      <main className="p-6">
        <div
          role="alert"
          className="rounded border border-bad bg-bad-soft p-4 text-sm text-bad"
        >
          Costing data unavailable: {bundle.error.message}
        </div>
      </main>
      </NavShell>
    );
  }

  const editable = quote.status === "draft";
  const rawsMode = bulkRawMeta[0]?.rawsMode ?? "cm_sources";

  const tierBrief = tiers.map((t) => ({
    id: t.id,
    label: t.label,
    qty: t.qty,
  }));

  // Bulk Raw plumbing remains available for compatibility, but its operator
  // surface is outside V1. The Costs workspace exposes the three active
  // operator sections only.
  const validSections = ["packaging", "production", "freight"];
  const openSection =
    expandedSection && validSections.includes(expandedSection)
      ? expandedSection
      : "packaging";

  console.log(`[costs:${tag}] pre-render ${elapsed()} memory=${heapMb()}MB`);
  return (
    <NavShell
      surfaceKey="cost_build"
      projectId={projectId}
      quoteId={quoteId}
      activeScenarioLabel={quote.scenarioLabel}
    >
    <CostingStoreProvider
      snapshot={bundle.data}
      realtimeEnabled={isProductionRealtimeConfigured()}
    >
      {/* URL ↔ store sync for active-tier selection. Suspense
          boundary required for useSearchParams in app router. */}
      <Suspense fallback={null}>
        <ActiveTierUrlSync />
      </Suspense>
      {/* §6.b path-B Costs migration commit 2/5 — canonical
          .r6-page wrapper (6styles.css line 19: padding 28px 40px
          80px, max-width 1480px). Replaces Tailwind utility chrome
          (mx-auto px-10 pt-7 pb-20 max-width: 1480px) which
          interpreted the canonical values. Now via canonical CSS
          directly. */}
      <main className="r6-page">
        {/* Sweep Step 2 — back-link above the page chrome, mirroring
            Setup's pattern. Edward seed finding: Costs page chrome
            missing eyebrow + back-link. Same Tailwind-styled
            register Setup uses; both will get extracted to a shared
            primitive in a follow-up (Designer audit Finding 12). */}
        <div style={{ marginBottom: 12, fontSize: 13 }}>
          <Link
            href={`/projects/${project.id}`}
            className="text-ink-3 hover:text-ink"
          >
            ← {project.dealName}
          </Link>
        </div>

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
          tierCount={tiers.length}
          unitsTotal={tiers.reduce((sum, t) => sum + (t.qty ?? 0), 0)}
        />

        {/* Cost stack header — multi-tier side-by-side */}
        <section className="mb-6">
          <CostStackHeader tiers={tierBrief} rawsMode={rawsMode} />
        </section>

        {/* Client Target — read-only context, beneath the stack rather than
            inside it. The stack's column is a whole-quote figure; a target
            belongs to one sellable unit, and comparing the two would read as
            though they measured the same thing. Renders nothing when no unit
            on the quote carries a target. */}
        <ClientTargetContext
          clientTargets={clientTargetRows.map((r) => ({
            assemblyId: r.assemblyId,
            quoteLeafId: r.quoteLeafId,
            tierId: r.tierId,
            clientTargetPricePerUnit: Number(r.clientTargetPricePerUnit),
          }))}
          tiers={tiers.map((t) => ({ id: t.id, label: t.label }))}
        />

        {/* Sections — accordion-style summary-with-drill-down. Open
            state is client-managed via <CostBuildAccordion> context
            (RI.4 perf fix per Edward smoke item (a)). All drawer
            content stays mounted server-side; CSS hides/shows on
            toggle. */}
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

          <SectionWithDrilldown
            id="freight"
            name="Freight"
            sublabel={freightSublabel(
              freightWorkbook.subcategories.length,
              freightWorkbook.destinations.length,
              freightUndecidedCount(freightWorkbook),
              freightWorkbook.subcategories.filter((row) => row.crossesInternationalBorder).length,
            )}
            indicatorChip={freightIndicatorChip(freightUndecidedCount(freightWorkbook))}
            statusChip={freightStatusChip(freightWorkbook.subcategories.length)}
            tiers={tierBrief}
            sectionKind="freight"
            lineCount={freightWorkbook.subcategories.length}
          >
            <FreightDrilldown
              quoteId={quote.id}
              tiers={tiers}
              editable={editable}
              workbook={freightWorkbook}
              products={newAssemblyRows.map((row) => ({ id: row.id, label: row.name || row.sku }))}
              components={newAssemblyLeafJoinRows.map((row) => ({
                id: row.assembly_leaves.id,
                assemblyId: row.assembly_leaves.assemblyId,
                label: row.leaves.name,
                sku: row.leaves.sku,
              }))}
            />
          </SectionWithDrilldown>
        </CostBuildAccordion>
      </main>
    </CostingStoreProvider>
    </NavShell>
  );
  } catch (e) {
    // 2026-06-17 prod-hang instrumentation — surface uncaught
    // exceptions in the render path with phase context. Re-throws
    // so Next.js error boundary handling is preserved (notFound +
    // redirect intrinsics propagate normally).
    console.error(`[costs:${tag}] FAIL ${elapsed()} memory=${heapMb()}MB`, e);
    throw e;
  }
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
// Sublabel helpers — semantic meta per R6 source
// (cost-build-page.jsx lines 144-146, 160-164, 184-192, 210-214).
// PMs read these to understand "what's the shape of this section's
// data?" not "how many rows are in it?". When empty, evocative copy
// describes what the section will hold (drives PM toward population).

function packagingSublabel(
  rows: Array<{
    packaging_inputs: {
      lineGroupId: string;
      pricingVendorNameSnapshot: string | null;
      supplier: string | null;
      inventoryEligible: boolean;
    };
  }>,
): string {
  if (rows.length === 0)
    return "Bottle, dropper, label, carton — markup defaults from category";
  // Dedup by lineGroupId — one logical line has N tier rows in DB
  const lines = new Map<
    string,
    { vendor: string | null; inventoryEligible: boolean }
  >();
  for (const r of rows) {
    if (!lines.has(r.packaging_inputs.lineGroupId)) {
      lines.set(r.packaging_inputs.lineGroupId, {
        vendor:
          r.packaging_inputs.pricingVendorNameSnapshot ??
          r.packaging_inputs.supplier,
        inventoryEligible: r.packaging_inputs.inventoryEligible,
      });
    }
  }
  const inventoryCount = [...lines.values()].filter((l) => l.inventoryEligible).length;
  const vendorSet = new Set(
    [...lines.values()].map((l) => l.vendor).filter((s): s is string => !!s),
  );
  return `${inventoryCount} inventory-eligible · ${vendorSet.size} pricing vendor${vendorSet.size === 1 ? "" : "s"}`;
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

// Slice R6.2 — sublabel describes the journey shape: total legs +
// treatment split + customs-eligible count. Replaces the legacy
// per-(line, SKU) phrasing.
// Freight family summary — disposition C1.
//
// The `freight-1a` bundle carried this line inside its own `cw-shead`
// section header. Design Authority here is MIGRATE, not reinstate: the
// bundle's authority is the operator information, not its original
// Costs-page shell. The accordion header is the single owner of the
// title and section ownership, so the summary is published upward into
// it rather than re-created in a second header inside the body.
//
// The collapsed section therefore keeps exposing operator-critical state,
// which is the property the bundle's placement provided.
//
// "shipment" is the approved operator term (disposition C3); the schema
// entity remains `freight_subcategories`.
function freightSublabel(
  subcategories: number,
  destinations: number,
  undecided: number,
  clearsCustoms: number,
): string {
  if (subcategories === 0) return "Record freight decisions by shipment, destination, and quantity break";
  return [
    `${subcategories} shipment${subcategories === 1 ? "" : "s"}`,
    `${destinations} destination${destinations === 1 ? "" : "s"} priced`,
    ...(undecided > 0 ? [`${undecided} undecided`] : []),
    `${clearsCustoms} clears customs`,
  ].join(" · ");
}

// Unresolved-work indicator on the collapsed header (disposition C1).
// A multi-destination shipment with no selection makes the freight total
// provisional; the operator must be able to see that without opening the
// section. `indicatorChip` renders inline with the sublabel in the
// always-visible header, so no new host affordance is required.
function freightIndicatorChip(undecided: number) {
  if (undecided === 0) return undefined;
  return {
    label: `${undecided} shipment${undecided === 1 ? "" : "s"} undecided`,
    tone: "warn" as const,
  };
}

// A shipment is undecided when it has priced alternatives but no chosen
// destination. Single-destination shipments are never undecided — there is
// nothing to choose between.
function freightUndecidedCount(workbook: FreightWorkbook): number {
  return workbook.subcategories.filter(
    (shipment) =>
      workbook.destinations.filter((row) => row.freightSubcategoryId === shipment.id).length > 1 &&
      !shipment.selectedDestinationId,
  ).length;
}
