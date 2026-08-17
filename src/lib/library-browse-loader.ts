import "server-only";
import { UNCLASSIFIED_SOURCE_TYPE } from "@/lib/library-source-type";
import { and, asc, count, eq, exists, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  leaves,
  productTypes,
  projects,
  quotes,
  quoteLeaves,
} from "@/db/schema";
import { productTypeOrderExpression } from "@/lib/product-type-order";
import {
  evaluateAttachmentEligibility,
  type AttachmentEligibility,
} from "@/lib/product-structure/attachment-eligibility";

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
  /**
   * HubSpot classification filter — the RAW internal `hs_product_type` value,
   * or the sentinel `UNCLASSIFIED_SOURCE_TYPE` for products HubSpot has not
   * classified. This is the filter the Library's type chips drive, because it
   * is the vocabulary that is actually populated (1,032 of 1,037 products).
   */
  sourceTypeFilter?: string;
  scopeFilter?: "all" | "this" | "other";
  targetQuoteId: string;
  limit?: number;
  /** B-11 · rows to skip. Page N is `offset = (N - 1) * limit`. */
  offset?: number;
};

export type LibraryBrowseRow = {
  leafId: string;
  name: string;
  sku: string | null;
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
  /** B-14 · attached at quote level with no Item Group. */
  attachedDirectInTargetQuote: boolean;
  /** B-14 · attached to this quote at all, however structured. */
  attachedInTargetQuote: boolean;
  /**
   * Whether the attach gate would REFUSE this product, and why — computed
   * server-side by `evaluateAttachmentEligibility`, the same function both
   * attach actions call.
   *
   * ONE CLASSIFIER, TWO SURFACES. The client must not decide eligibility for
   * itself: a second implementation could disagree with the server, and the
   * disagreement would show as a product that looks attachable and is refused,
   * or worse, looks refused and is not. The rejection stays authoritative; this
   * only lets the operator see it before spending an action on it.
   */
  eligibility: AttachmentEligibility;
  /**
   * HubSpot's `hs_product_type`, raw internal value. NULL means the product is
   * genuinely unclassified — either Nexus-local (no HubSpot record) or HubSpot
   * has no value for it. Those two remain distinguishable via
   * `hubspotProductId`; neither is given a fabricated type.
   */
  hubspotProductType: string | null;
};

/**
 * Sentinel for "no HubSpot classification".
 *
 * A filter value rather than an absence, so the unclassified population is
 * SELECTABLE instead of silently excluded. Before this, choosing any type
 * dropped 1,051 of 1,077 products with nothing on screen saying so — which is
 * why the filter read as untrustworthy rather than as unpopulated.
 */
export { UNCLASSIFIED_SOURCE_TYPE } from "@/lib/library-source-type";

const DEFAULT_LIMIT = 50;

export type LibraryBrowseResult = {
  rows: LibraryBrowseRow[];
  /**
   * How many products match the CURRENT filters, across the whole library.
   *
   * B-11 · this used to be `filteredBase.length` — the count of matches inside
   * the first `limit + 1` rows alphabetically. On a 1,082-product library that
   * made the denominator top out at 51 and read as the whole answer.
   */
  total: number;
  /** B-11 · more matches exist beyond this page. */
  hasMore: boolean;
  /** B-11 · the window these rows came from, echoed so a caller can page. */
  offset: number;
  limit: number;
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
  // Step 8 · the Nexus-taxonomy filter is retired. `sourceTypeFilter` below
  // matches on authoritative HubSpot classification, which is the only
  // classification a leaf now has.
  if (filters.sourceTypeFilter) {
    // Equality on the RAW internal value — never on a display label. The three
    // largest categories have labels that differ from their values, so a
    // label-matched predicate would return nothing for them and look like an
    // empty catalogue rather than a wrong query.
    conds.push(
      filters.sourceTypeFilter === UNCLASSIFIED_SOURCE_TYPE
        ? isNull(leaves.hubspotProductType)
        : eq(leaves.hubspotProductType, filters.sourceTypeFilter),
    );
  }

  // B-11 · SCOPE IS A SQL PREDICATE, not a post-filter on the fetched page.
  //
  // It used to run in JS over whatever `limit + 1` rows came back, so on a
  // 1,082-product library "attached to another quote" was answered from the
  // first 51 products alphabetically. A product attached elsewhere but sorting
  // 200th was invisible, and the surface reported no matches rather than a
  // truncated view — the filter looked like it worked and returned the wrong
  // answer.
  //
  // The loader's own note anticipated this ("cheap because v1 has <100 leaves
  // total ... if the library grows past a few hundred, push this into a CTE").
  // The library is 1,082. The premise expired; this is the push.
  const attachedToTarget = (leafId: typeof leaves.id) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(quoteLeaves)
        .where(
          and(
            eq(quoteLeaves.leafId, leafId),
            eq(quoteLeaves.quoteId, filters.targetQuoteId),
          ),
        ),
    );
  const attachedElsewhere = (leafId: typeof leaves.id) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(quoteLeaves)
        .where(
          and(
            eq(quoteLeaves.leafId, leafId),
            ne(quoteLeaves.quoteId, filters.targetQuoteId),
          ),
        ),
    );
  if (filters.scopeFilter === "this") conds.push(attachedToTarget(leaves.id));
  if (filters.scopeFilter === "other") conds.push(attachedElsewhere(leaves.id));

  const offset = Math.max(0, filters.offset ?? 0);

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
    matchCountRow,
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
      .orderBy(asc(leaves.name), asc(leaves.id))
      // `id` breaks name ties so paging is a total order. Without it two
      // products sharing a name can swap between pages and one is seen twice
      // while the other is never seen at all.
      .offset(offset)
      .limit(limit + 1), // +1 to detect "more available"
    // slice-library-modal-polish Step 8 hotfix — libraryTotal counts
    // ALL leaves (active + archived) so the result-count denominator
    // matches the rendered row scope. Prevents the "32 OF 30"
    // inversion observed during CB LMP smoke when CB restored an
    // archived leaf and saw the row count exceed the denominator.
    // B-11 · the TRUE match count for the current filters, counted in SQL over
    // the same predicates the rows come from. Previously `total` was the length
    // of the fetched page, so the denominator could never exceed `limit + 1`
    // and "50 of 51" was reported for a 1,082-product library.
    db.select({ n: count() }).from(leaves).where(and(...conds)),
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
      // The window is empty; the match count is not necessarily zero — an
      // offset past the end has matches, just none here. Reporting 0 would
      // make "page 30 of a 1,082-product library" look like an empty library.
      total: Number(matchCountRow[0]?.n ?? 0),
      hasMore: false,
      offset,
      limit,
      libraryTotal,
      libraryTotalActive,
      scenarioLabel,
      clientName,
    };
  }

  // B-14 · attachment is read from `quote_leaves`, the CANONICAL attachment
  // table — not from `assembly_leaves`.
  //
  // The legacy junction only records GROUP MEMBERSHIP. A Direct Product is
  // attached with `assembly_id NULL` and produces no junction row at all, so a
  // junction-derived reading could never see it: the operator attached a
  // product, the attach succeeded, and the row kept offering `Add`. Same defect
  // family as OD-017/OD-028 — a consumer matching on the legacy identity.
  //
  // `quote_leaves.assembly_id` carries the membership too (NULL = Direct), so
  // one query answers both "is it in this quote" and "which group".
  const [attachmentRows] = await Promise.all([
    db
      .select({
        leafId: quoteLeaves.leafId,
        assemblyId: quoteLeaves.assemblyId,
        quoteId: quoteLeaves.quoteId,
      })
      .from(quoteLeaves)
      .where(inArray(quoteLeaves.leafId, baseIds)),
  ]);

  const attachmentsByLeaf = new Map<string, typeof attachmentRows>();
  for (const a of attachmentRows) {
    const list = attachmentsByLeaf.get(a.leafId) ?? [];
    list.push(a);
    attachmentsByLeaf.set(a.leafId, list);
  }

  // B-11 · scope was applied HERE, in JS, over the fetched page. It is now a
  // SQL predicate above, so `baseRows` is already the correct match set for
  // every filter and this step is gone rather than moved.
  //
  // The `+1` probe is finally READ. It was being computed and then thrown away
  // by `slice`, so a 50-row page out of 1,082 matches rendered with no signal
  // that anything followed — the exact silent-truncation shape the platform
  // rules forbid ("silent truncation reads as 'covered everything' when it
  // didn't").
  const total = matchCountRow[0]?.n ?? 0;
  const hasMore = baseRows.length > limit;
  const trimmed = baseRows.slice(0, limit);

  const rows: LibraryBrowseRow[] = trimmed.map((r) => {
    const at = attachmentsByLeaf.get(r.id) ?? [];
    const inTargetQuote = at.filter((a) => a.quoteId === filters.targetQuoteId);
    const attachedAssemblyIdsInTargetQuote = inTargetQuote
      .map((a) => a.assemblyId)
      .filter((id): id is string => id !== null);
    // Attached at quote level with no group. The case the junction could not
    // represent, and the one the operator hit.
    const attachedDirectInTargetQuote = inTargetQuote.some(
      (a) => a.assemblyId === null,
    );
    // Attached to this quote AT ALL, however it is structured. What the row
    // badge should reflect when no specific group is the target.
    const attachedInTargetQuote = inTargetQuote.length > 0;
    const distinctQuoteIds = new Set(at.map((a) => a.quoteId));

    return {
      leafId: r.id,
      name: r.name,
      sku: r.sku,
      unitCost: r.unitCost,
      url: r.url,
      hubspotProductId: r.hubspotProductId,
      archived: r.archived,
      // The gate's own verdict, not a re-derivation of it.
      eligibility: evaluateAttachmentEligibility({ sku: r.sku, archived: r.archived }),
      hubspotProductType: r.hubspotProductType,
      totalRefs: at.length,
      totalScenarios: distinctQuoteIds.size,
      attachedAssemblyIdsInTargetQuote,
      attachedDirectInTargetQuote,
      attachedInTargetQuote,
    };
  });

  return {
    rows,
    total,
    hasMore,
    offset,
    limit,
    libraryTotal,
    libraryTotalActive,
    scenarioLabel,
    clientName,
  };
}

// `assembly_leaves_assembly_id` import alias for the inner-join
// projection (Drizzle requires the column reference; this just
// re-exports the column with a clearer name for the SELECT shape).
const assembly_leaves_assembly_id = assemblyLeaves.assemblyId;
