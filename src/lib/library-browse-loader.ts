import "server-only";
import { and, asc, count, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  leaves,
  productTypes,
  projects,
  quotes,
} from "@/db/schema";
import { productTypeOrderExpression } from "@/lib/product-type-order";

// Phase A.1 v2 impl-5 — Library browse data loader.
//
// Returns paginated library leaves matching the browse filters, with
// per-row ref counts + per-target-quote attached flag.
//
// Scope filter semantics:
//   - "all"   → every non-archived leaf
//   - "this"  → leaves attached to any ASY in the target quote
//   - "other" → leaves attached to any ASY NOT in the target quote
//
// slice-library-first-creation-flow Step 2 — return shape extended:
//   - libraryTotal: unfiltered library size (used by modal to
//     distinguish library-empty vs filtered-empty empty states per
//     locked Q3/Q7 dispositions)
//   - scenarioLabel: target quote's scenario label (used by modal
//     sub-copy "Find or create a component for {scenarioLabel}"
//     per locked Q7 / Catch #7 disposition)
//
// slice-library-modal-polish Step 2 — return shape further extended:
//   - clientName: target quote's project client name (used by modal
//     header subtitle "{client} · {qid}" per CD designer notes +
//     Catch #2 disposition). Joined from projects via
//     quote.project_id. NULL when project has no client_name set
//     (projects.client_name is nullable).
//
// Returns:
//   - rows: leaves with type identity + total/scenario ref counts +
//     per-target-quote attached-to-some-ASY flag + the list of
//     attached assembly IDs (for the "already in" UI state)
//   - total: filtered row count (matches result-set size after
//     all filters applied)
//   - libraryTotal: unfiltered count (archived = false only)
//   - scenarioLabel: target quote's scenario label
//   - clientName: target quote's project client name (NULL when
//     project has no client name set)

export type LibraryBrowseFilters = {
  search?: string;
  typeFilter?: string; // product_type_id
  scopeFilter?: "all" | "this" | "other";
  targetQuoteId: string;
  limit?: number;
};

export type LibraryBrowseRow = {
  leafId: string;
  name: string;
  sku: string | null;
  productType: { id: string; name: string } | null;
  unitCost: string | null;
  url: string | null;
  // slice-hubspot-bidirectional — origin indicator. Non-null when
  // the leaf was created via the canonical HubSpot-first flow
  // (Step 4 createLeaf refactor) OR pulled from HubSpot (Step 5
  // pullFromHubSpot). Null for Nexus-local leaves (legacy createLeaf
  // pre-slice; manual library-side creation if surfaced later).
  // Library browse modal renders a ⤓ HS chip when non-null
  // distinguishes HubSpot-sourced from Nexus-local at a glance.
  hubspotProductId: string | null;
  // slice-library-modal-polish Step 5 — `archived` flag surfaced
  // per-row so the CD redesign can show archived leaves inline
  // with a "Restore" action (CD designer notes §7 readiness
  // states: ready / attached / archived). Loader's base row query
  // no longer filters archived out; client derives readiness from
  // (archived flag, target-ASY membership).
  archived: boolean;
  totalRefs: number;
  totalScenarios: number;
  attachedAssemblyIdsInTargetQuote: string[];
};

const DEFAULT_LIMIT = 50;

export type LibraryBrowseResult = {
  rows: LibraryBrowseRow[];
  total: number;
  libraryTotal: number;
  // slice-library-modal-polish Step 8 hotfix BUG-LMP-2-A —
  // separate the result-count denominator (libraryTotal, all
  // leaves including archived) from the empty-state-branching
  // signal (libraryTotalActive, archived = false only). With
  // Step 5's base query no longer filtering archived rows out,
  // the modal needs both:
  //   - libraryTotal aligns with rendered scope for the "N of M"
  //     denominator
  //   - libraryTotalActive triggers the library-empty (⊹) shape
  //     when all leaves are archived (a fresh-start state from
  //     the PM's perspective even if archived rows exist)
  libraryTotalActive: number;
  scenarioLabel: string;
  clientName: string | null;
};

export async function loadLibraryBrowse(
  filters: LibraryBrowseFilters,
): Promise<LibraryBrowseResult> {
  const limit = filters.limit ?? DEFAULT_LIMIT;
  const search = filters.search?.trim() ?? "";

  // Build the base leaves query — search + optional type filter.
  //
  // slice-library-modal-polish Step 5 — `archived = false` filter
  // removed from the base row query so archived leaves appear in
  // the result list with a "Restore" affordance (CD designer notes
  // §7 readiness states). libraryTotal below retains the
  // `archived = false` filter so the catalog-size figure PMs see
  // in empty-state copy reflects only active leaves.
  const conds: SQL[] = [];
  if (search.length > 0) {
    const pattern = `%${search}%`;
    const orClause = or(
      ilike(leaves.name, pattern),
      ilike(leaves.sku, pattern),
    );
    if (orClause) conds.push(orClause);
  }
  if (filters.typeFilter) {
    conds.push(eq(leaves.productTypeId, filters.typeFilter));
  }

  // Wave 1: filtered base rows + unfiltered library count + quote
  // context (scenario label + client name) in parallel. 3 queries;
  // well under pool capacity. The libraryTotal + quote context are
  // independent of the row filter set, so they only need to fire
  // once per loader call.
  //
  // The quote-context query joins projects via quote.project_id to
  // surface the project's client_name alongside the scenario label
  // (slice-library-modal-polish Step 2 Catch #2 disposition).
  const [
    baseRows,
    libraryTotalRow,
    libraryTotalActiveRow,
    quoteContextRow,
  ] = await Promise.all([
    // Scope filter applies after fetching ids; cheap because v1 has
    // <100 leaves total. If library grows past a few hundred, push
    // this into a CTE.
    db
      .select()
      .from(leaves)
      .where(and(...conds))
      .orderBy(asc(leaves.name))
      .limit(limit + 1), // +1 to detect "more available"
    // slice-library-modal-polish Step 8 hotfix — libraryTotal counts
    // ALL leaves (active + archived) so the result-count denominator
    // matches the rendered row scope. Prevents the "32 OF 30"
    // inversion observed during CB LMP smoke when CB restored an
    // archived leaf and saw the row count exceed the denominator.
    db.select({ n: count() }).from(leaves),
    // BUG-LMP-2-A hotfix — libraryTotalActive counts archived=false
    // only so the modal's library-empty (⊹) shape triggers when
    // all leaves are archived even though libraryTotal > 0.
    db
      .select({ n: count() })
      .from(leaves)
      .where(eq(leaves.archived, false)),
    db
      .select({
        scenarioLabel: quotes.scenarioLabel,
        clientName: projects.clientName,
      })
      .from(quotes)
      .innerJoin(projects, eq(projects.id, quotes.projectId))
      .where(eq(quotes.id, filters.targetQuoteId))
      .limit(1),
  ]);

  const libraryTotal = Number(libraryTotalRow[0]?.n ?? 0);
  const libraryTotalActive = Number(libraryTotalActiveRow[0]?.n ?? 0);
  const scenarioLabel = quoteContextRow[0]?.scenarioLabel ?? "";
  const clientName = quoteContextRow[0]?.clientName ?? null;

  const baseIds = baseRows.map((r) => r.id);
  if (baseIds.length === 0) {
    return {
      rows: [],
      total: 0,
      libraryTotal,
      libraryTotalActive,
      scenarioLabel,
      clientName,
    };
  }

  // Wave 2: junction + product_types in parallel.
  const [junctionRows, allTypes] = await Promise.all([
    db
      .select({
        junctionId: assemblyLeaves.id,
        leafId: assemblyLeaves.leafId,
        assemblyId: assembly_leaves_assembly_id,
        assemblyQuoteId: assemblies.quoteId,
      })
      .from(assemblyLeaves)
      .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
      .where(inArray(assemblyLeaves.leafId, baseIds)),
    db.select().from(productTypes),
  ]);

  // Group junctions by leaf for per-leaf stats + attached-flag.
  const junctionsByLeaf = new Map<string, typeof junctionRows>();
  for (const j of junctionRows) {
    const list = junctionsByLeaf.get(j.leafId) ?? [];
    list.push(j);
    junctionsByLeaf.set(j.leafId, list);
  }

  const typeMap = new Map(allTypes.map((t) => [t.id, t] as const));

  // Scope filter at row level.
  const filteredBase = baseRows.filter((r) => {
    const js = junctionsByLeaf.get(r.id) ?? [];
    if (filters.scopeFilter === "this") {
      return js.some((j) => j.assemblyQuoteId === filters.targetQuoteId);
    }
    if (filters.scopeFilter === "other") {
      return js.some((j) => j.assemblyQuoteId !== filters.targetQuoteId);
    }
    return true; // "all" or undefined
  });

  const total = filteredBase.length;
  const trimmed = filteredBase.slice(0, limit);

  const rows: LibraryBrowseRow[] = trimmed.map((r) => {
    const js = junctionsByLeaf.get(r.id) ?? [];
    const attachedAssemblyIdsInTargetQuote = js
      .filter((j) => j.assemblyQuoteId === filters.targetQuoteId)
      .map((j) => j.assemblyId);
    const distinctQuoteIds = new Set(js.map((j) => j.assemblyQuoteId));
    const type = r.productTypeId ? typeMap.get(r.productTypeId) : null;

    return {
      leafId: r.id,
      name: r.name,
      sku: r.sku,
      productType: type ? { id: type.id, name: type.name } : null,
      unitCost: r.unitCost,
      url: r.url,
      hubspotProductId: r.hubspotProductId,
      archived: r.archived,
      totalRefs: js.length,
      totalScenarios: distinctQuoteIds.size,
      attachedAssemblyIdsInTargetQuote,
    };
  });

  return {
    rows,
    total,
    libraryTotal,
    libraryTotalActive,
    scenarioLabel,
    clientName,
  };
}

/**
 * Loads the list of leaf-scope product types for the library
 * browse type filter. Mirrors the productTypeOptions loader from
 * impl-4 but trimmed to id + name + placeholder flag.
 */
export async function loadLeafTypesForFilter(): Promise<
  { id: string; name: string; placeholder: boolean }[]
> {
  // Canonical ordering per Edward §15.2 (Bug #L fix).
  const rows = await db
    .select()
    .from(productTypes)
    .where(and(eq(productTypes.scope, "leaf"), eq(productTypes.hidden, false)))
    .orderBy(productTypeOrderExpression, asc(productTypes.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    placeholder: r.placeholder,
  }));
}

// `assembly_leaves_assembly_id` import alias for the inner-join
// projection (Drizzle requires the column reference; this just
// re-exports the column with a clearer name for the SELECT shape).
const assembly_leaves_assembly_id = assemblyLeaves.assemblyId;
