import { createStore } from "zustand";
import {
  computeQuoteCosting,
  type CostingCellOverride,
  type CostingCellTarget,
  type CostingFreightLeg,
  type CostingFreightLegGroup,
  type CostingFreightLegTier,
  type CostingLegCustoms,
  type CostingPackagingInput,
  type CostingProductionInput,
  type CostingSku,
  type CostingTier,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "./costing";
import { validateQuote, type WarningSpec } from "./validation";

// ============================================================================
// Slice 8 — Costing store (Zustand, per-quote instance)
// ============================================================================
//
// Holds a snapshot of all costing inputs + the computed result. Components
// subscribe to slices of state via the selector helpers exported below.
// On any input edit, the store mutates the relevant input row and re-runs
// computeQuoteCosting() to produce a fresh result. The QuoteSummaryCard
// (and any future per-cell margin display) is subscribed to the result and
// re-renders within ~50ms — no server round-trip.
//
// Architectural note: ALL math display reads from this store, including
// the /costing page's per-SKU breakdown tables. The original sub-step
// plan framed /costing as "review surface, not iteration surface" and
// kept it server-rendered, but PMs iterate on GPA and margin on /costing
// directly. Hybrid stale/fresh display (summary card optimistic, per-SKU
// stale) destroyed PM trust in the numbers. Now the costing page is a
// thin server shell (auth, header, provider hydration) and every
// math-bearing section subscribes via selectors. See
// app/.../pricing/page.tsx + the PricingSurfaceShell composer that
// subscribes via granular selectors.
//
// ----------------------------------------------------------------------------
// Architectural rule 1: Optimistic edits ONLY on existing rows.
// ----------------------------------------------------------------------------
// Add and delete operations (addPackagingLine, addFreightLine, deleteSku,
// addTier, applyTierPreset, etc.) ALWAYS go through a server roundtrip.
// No temp IDs, no optimistic add. Click Add → server creates → revalidation
// hydrates store → summary card updates. ~700ms latency on add is acceptable
// because adds are rare. Iteration speed only matters on edits to existing
// rows — that's where this store earns its keep.
//
// If a future contributor is tempted to add `addPackagingRowOptimistic`:
// don't. The temp-ID round-trip choreography is much more failure-prone
// than the modest add-latency it would shave.
//
// ----------------------------------------------------------------------------
// Architectural rule 2: Selector strategy is enforced via typed helpers.
// ----------------------------------------------------------------------------
// Components MUST use the exported `selectFoo` helpers, NOT inline
// `useStore(s => s.foo.bar)` selectors at the call site. Reasons:
//   - Granularity is intentional and reviewable (one source of truth for
//     "what does this component depend on")
//   - A wrong selector at one call site doesn't silently re-render every
//     consumer; the cost shows up in the helper definition
//   - Future memoization (shallowEqual / isEqual options) is centralized
//
// Each cost cell that displays a derived margin should subscribe to its
// own row's slice — NOT the whole costing result. With ~120 cells in a
// 30-SKU × 4-tier quote, whole-state subscription would tank perf.
//
// ----------------------------------------------------------------------------
// Architectural rule 3: Per-quote instances via factory.
// ----------------------------------------------------------------------------
// makeCostingStore() returns a fresh createStore each call — NOT a singleton
// hook. Each <CostingStoreProvider> wraps one quote and creates its own
// instance. Two quotes in two tabs keep separate state.

// ============================================================================
// Stored row shapes — extend the pure costing input types with row IDs
// ============================================================================
//
// The pure src/lib/costing.ts types don't carry DB row IDs (the math doesn't
// need them). The store does — actions key on rowId for cell updates, and
// hydration reads them out of DB rows. We extend the input types with `rowId`
// where applicable and pass through to computeQuoteCosting unchanged
// (extra fields are ignored by the pure function).

export type StoredPackagingRow = CostingPackagingInput & {
  rowId: string;
  pricingVendorHubspotCompanyId: string | null;
  pricingVendorNameSnapshot: string | null;
  legacySupplier: string | null;
};
export type StoredProductionRow = CostingProductionInput; // keyed by (skuId, tierId)

// Slice R6.2 — freight is per-quote, not per-SKU. Stored rows mirror
// the pure-math types 1:1; identity is by leg-group id, leg id,
// leg-tier id. The store mutators key on these directly.
export type StoredFreightLegGroup = CostingFreightLegGroup;
export type StoredFreightLeg = CostingFreightLeg;
export type StoredFreightLegTier = CostingFreightLegTier & { rowId: string };

// Customer-arranges-mode metadata per leg. Mirrors the DB shape on
// `freight_customer_arranges_meta` 1:1. Optional entries — only legs
// in customer-arranges mode have a row.
export type StoredFreightCustomerArrangesMeta = {
  freightLegId: string;
  customerContact: string | null;
  auditNote: string | null;
};

// ============================================================================
// State shape
// ============================================================================

export type CostingStoreState = {
  // Identity (set on hydrate, never mutated by edits)
  quoteId: string;
  projectId: string;

  // Mutable inputs (PM edits flow here; recompute fires on every change)
  globalPriceAdjPct: number;
  // Slice 9.2 — per-quote target margin override. NULL = inherit
  // firm-level. Reverse-solve goal + verdict bands use the effective
  // value (`?? firmSettings.targetMarginPct`).
  targetMarginPct: number | null;
  firmSettings: { targetMarginPct: number; floorMarginPct: number };
  markupDefaults: Record<string, number>;
  skus: CostingSku[];
  tiers: CostingTier[];
  packaging: StoredPackagingRow[];
  production: StoredProductionRow[];
  // Slice R6.2 — multi-leg journey freight model. Three sparse arrays
  // (groups → legs → leg-tiers) + customer-arranges-meta. The store
  // mutates one array at a time on PM edit; recompute pipes through
  // all three into the pure rollup.
  freightLegGroups: StoredFreightLegGroup[];
  freightLegs: StoredFreightLeg[];
  freightLegTiers: StoredFreightLegTier[];
  freightCustomerArrangesMeta: StoredFreightCustomerArrangesMeta[];
  // Slice 9.3 — sparse per-cell sell-price overrides. Empty array =
  // no overrides. Mutated by `updateCellOverride(skuId, tierId, value)`
  // (upsert / clear pattern; see action below).
  cellOverrides: CostingCellOverride[];
  // Slice 9.4b — sparse per-cell client target benchmarks. Mirror
  // shape to cellOverrides; mutated by updateCellTarget action below.
  cellTargets: CostingCellTarget[];

  // Slice 9.4a — VIEW STATE (not a costing input). The currently-active
  // tier on the Pricing. Determines which tier's per-SKU summary
  // row values render (active-tier required sell, active-tier margin
  // pill, active-tier client-target gap when 9.4b lands). Initial value
  // is null; <ActiveTierUrlSync> sets it on mount from URL `?tier=`
  // (or defaults to first tier in sort_order). Mutating this does NOT
  // re-run computeQuoteCosting — the math is per-tier-uniform; what
  // changes is which tier's slice the UI surfaces. Mirrors the URL
  // (URL is canonical for shareability; store is the local cache for
  // sub-50ms subscriber re-renders without round-tripping the router).
  activeTierId: string | null;

  // Derived (always reflects current inputs)
  costing: QuoteCostingResult;
  // Slice 9.5 — validation engine output, recomputed alongside costing
  // on every input change. Pure-function engine; no DB write from here
  // (server-side persistence happens on action commit per architect
  // verdict — see warnings.ts reconcileWarnings). This in-store slice
  // drives inline icon surfacing, summary chip count, and the
  // Pricing aggregation panel for IMMEDIATE feedback as PMs
  // type, without server round-trip.
  warnings: WarningSpec[];
  // Slice 9.5 — server-persisted warning rows (active + accepted),
  // refreshed on every snapshot via hydrate/reconcile. The UI merges
  // by identity tuple onto the in-memory `warnings` specs to attach
  // DB ids, enabling per-row Accept actions.
  persistedWarnings: PersistedQuoteWarning[];

  // Bookkeeping
  hydrated: boolean; // false until first hydrate() call
  /**
   * Revision of the most recently APPLIED snapshot. Reconciliation compares
   * against this and rejects anything not strictly newer.
   *
   * Replaces `lastReconcileAt`, which was written on every hydrate/reconcile
   * and never read — a client-clock timestamp cannot order server renders, so
   * it could not have served as the authority even if it had been consulted.
   */
  lastAppliedRevision: number;
  // ms epoch of the user's most recent input edit (any updateXxx call).
  // The provider's reconcile path reads this to defer overwriting
  // optimistic state while the user is actively typing — see
  // costing-store-provider.tsx wait-for-quiet pattern. Reset to 0 on
  // each successful reconcile so the next typing burst starts fresh.
  // The race this prevents:
  //   t=0  type "0.55" → store=0.55, save@500
  //   t=600 type "0.6"  → store=0.6,  save@1100
  //   t=1200 first save's snapshot lands (has 0.55, not 0.6)
  //   t=1300 reconcile would overwrite store to 0.55 — clobbering 0.6
  // With wait-for-quiet, reconcile defers until user pauses, by which
  // time the second save's snapshot has arrived with 0.6.
  lastUserEditAt: number;

  /**
   * F-3 Phase B — write causality.
   *
   * `lastAppliedRevision` guarantees reconciliation never goes BACKWARDS. It
   * does not guarantee a snapshot contains the operator's own write. With
   * lastApplied=100 and a write committed at 120, a snapshot at 110 is newer
   * than what is applied — so the monotonic gate passes it — yet predates the
   * write, and applying it reverts the operator's value on screen until a
   * later snapshot restores it.
   *
   * This holds the revision the most recent local write committed at. Until a
   * snapshot at or beyond it is applied, sub-threshold candidates are held
   * rather than applied. Null means no write is outstanding, which is the
   * common case and must stay on the untouched fast path.
   */
  awaitedRevision: number | null;
  /** ms epoch the current await began — bounds the gate so it cannot wedge. */
  awaitedSince: number;

  // Actions
  hydrate: (snapshot: HydrateSnapshot) => void;
  reconcile: (snapshot: HydrateSnapshot) => void;
  /** Record the revision a local write committed at. Highest outstanding wins. */
  awaitCommitted: (revision: number) => void;
  /** Abandon the causal requirement without claiming it was satisfied. */
  releaseAwaited: () => void;
  updatePackagingCell: (rowId: string, fields: PackagingCellFields) => void;
  updatePackagingLineMeta: (
    lineGroupId: string,
    fields: PackagingLineMetaFields,
  ) => void;
  updateProductionCell: (
    quoteSkuId: string,
    tierId: string,
    fields: ProductionCellFields,
  ) => void;
  updateProductionPolicy: (
    quoteSkuId: string,
    fields: ProductionPolicyFields,
  ) => void;
  // Slice R6.2 — freight mutators against the multi-leg journey
  // model. Five actions, mirroring the action-layer surface:
  //   · updateFreightLegTier — PM enters per-tier total_freight /
  //     units_in_shipment on a leg's rate row
  //   · updateFreightLegMeta — leg head fields (mode, carrier,
  //     incoterm, dates, treatment, crosses_international_border)
  //   · updateFreightLegMarkup — per-component markup pill override
  //     (component = 'freight' | 'duty' | 'tariff')
  //   · updateFreightLegCustoms — duty_pct / tariff_pct in JSONB
  //   · updateFreightCustomerArrangesMeta — customer contact +
  //     audit note for customer-arranges legs
  updateFreightLegTier: (
    rowId: string,
    fields: FreightLegTierFields,
  ) => void;
  updateFreightLegMeta: (
    legId: string,
    fields: FreightLegMetaFields,
  ) => void;
  updateFreightLegMarkup: (
    legId: string,
    component: "duty" | "tariff",
    value: number,
  ) => void;
  updateFreightLegCustoms: (
    legId: string,
    fields: FreightLegCustomsFields,
  ) => void;
  updateFreightCustomerArrangesMeta: (
    legId: string,
    fields: FreightCustomerArrangesMetaFields,
  ) => void;
  updateGlobalAdj: (value: number) => void;
  // Slice 9.2 — per-tier price-adj override (NULL = inherit global).
  updateTierPriceAdj: (tierId: string, value: number | null) => void;
  // Slice 9.2 — per-quote target-margin override (NULL = inherit firm).
  updateTargetMargin: (value: number | null) => void;
  // Slice 9.3 — per-cell sell-price override. value === null clears
  // the override (DELETEs the entry from cellOverrides + the DB row).
  // value > 0 upserts. Action layer rejects value <= 0; store does
  // not enforce (defense in depth lives at the action boundary).
  updateCellOverride: (
    quoteSkuId: string,
    tierId: string,
    value: number | null,
  ) => void;
  // Slice 9.4b — per-cell client target benchmark. Same contract as
  // updateCellOverride: value === null clears (DELETEs entry); value > 0
  // upserts. Action layer rejects value <= 0; store doesn't enforce here.
  updateCellTarget: (
    quoteSkuId: string,
    tierId: string,
    value: number | null,
  ) => void;
  // Slice 9.4a — view-state mutator. Sets the active-tier selection.
  // Pure mutation; no side effects. URL sync is the caller's
  // responsibility (selector click handler + ActiveTierUrlSync
  // component handle the URL writeback to keep the store free of
  // router/navigation knowledge).
  setActiveTier: (tierId: string | null) => void;
};

export type HydrateSnapshot = {
  /**
   * Freshness authority for reconciliation ordering.
   *
   * A Postgres transaction marker — `pg_snapshot_xmax(pg_current_snapshot())`
   * — captured on the FIRST read of `getCostingBundle`. It advances when a
   * transaction commits, so it orders snapshots by **what they could see**,
   * not by when they finished.
   *
   * A wall clock cannot do this job. Stamped at completion it orders render
   * completion, which loses the earlier-start/later-finish race:
   *
   *     A begins (reads pre-mutation data)
   *     mutation commits
   *     B begins (reads post-mutation data)
   *     B completes first
   *     A completes LAST  ->  higher completion time, older data, A wins
   *
   * Taken at the start and sourced from the database counter, A's revision is
   * strictly lower than B's and is rejected regardless of arrival order. It is
   * also skew-free: one database clock rather than N function-instance clocks.
   *
   * Conservative by construction. A read beginning before a commit may still
   * observe it, so its revision can understate freshness — that costs a
   * discarded update, never a corrupted one.
   *
   * This exists because reconciliation previously had NO ordering guarantee:
   * the provider cancelled a pending *timer*, but each scheduled call had
   * already captured its own snapshot in closure, so whichever was scheduled
   * last won by arrival order rather than by freshness. A server render that
   * predated an operator's save could therefore land after it and overwrite
   * it — Packaging values vanishing after a tab-out, one returning later as a
   * fresher snapshot arrived.
   */
  revision: number;
  quoteId: string;
  projectId: string;
  globalPriceAdjPct: number;
  // Slice 9.2 — per-quote target margin override (NULL = inherit firm).
  targetMarginPct: number | null;
  firmSettings: { targetMarginPct: number; floorMarginPct: number };
  markupDefaults: Record<string, number>;
  skus: CostingSku[];
  tiers: CostingTier[];
  packaging: StoredPackagingRow[];
  production: StoredProductionRow[];
  freightLegGroups: StoredFreightLegGroup[];
  freightLegs: StoredFreightLeg[];
  freightLegTiers: StoredFreightLegTier[];
  freightCustomerArrangesMeta: StoredFreightCustomerArrangesMeta[];
  // Slice 9.3 — sparse per-cell sell-price overrides (rows that exist
  // in DB at hydration time). Empty array if no overrides on this quote.
  cellOverrides: CostingCellOverride[];
  // Slice 9.4b — sparse per-cell client target benchmarks (rows that
  // exist in DB at hydration time).
  cellTargets: CostingCellTarget[];
  costing: QuoteCostingResult; // pre-computed on the server side
  // Slice 9.5 — persisted warnings on this quote (active + accepted).
  // Used to attach DB ids onto client-computed engine specs by
  // identity tuple, enabling per-row Accept actions. Auto_resolved
  // rows omitted (historical noise; surface separately if PM
  // forensic mode is added).
  persistedWarnings: PersistedQuoteWarning[];
};

// Minimal shape — fields the UI needs to render + actions need to
// reference. Mirrors src/app/actions/warnings.ts QuoteWarning but
// kept here to avoid action-layer import in the store.
export type PersistedQuoteWarning = {
  id: string;
  quoteId: string;
  scope: "line" | "quote";
  tableName: string | null;
  rowId: string | null;
  fieldName: string | null;
  tierId: string | null;
  kind: string;
  severity: "info" | "review" | "action_required";
  status: "active" | "accepted";
  acceptReasonKind: string | null;
};

// Field shapes for each action — these mirror the input rows but allow
// partial updates so callers only specify what changed.

export type PackagingCellFields = Partial<
  Pick<StoredPackagingRow, "unitCost" | "qtyPerSellableUnit">
>;
// Includes qtyPerSellableUnit even though it's stored per-row: PMs edit it
// at the line level (it's a property of "how this packaging slots into the
// finished SKU"), and the server action fans the value out across all tier
// rows on save. The store mirrors that behavior — updatePackagingLineMeta
// writes the field to every row sharing the lineGroupId.
export type PackagingLineMetaFields = Partial<
  Pick<
    StoredPackagingRow,
    | "category"
    | "markupPct"
    | "qtyPerSellableUnit"
    | "pricingVendorHubspotCompanyId"
    | "pricingVendorNameSnapshot"
  >
>;
export type ProductionCellFields = Partial<
  Omit<
    StoredProductionRow,
    | "quoteSkuId"
    | "tierId"
    | "customerShipsRaws"
    | "allocateServiceFeesToCost"
  >
>;
export type ProductionPolicyFields = Partial<
  Pick<
    StoredProductionRow,
    "customerShipsRaws" | "allocateServiceFeesToCost"
  >
>;
// Slice R6.2 — per-(leg, tier) rate fields. PM enters total freight
// cost; units_in_shipment overrides tier.qty when yield mismatch.
export type FreightLegTierFields = Partial<
  Pick<StoredFreightLegTier, "totalFreight" | "unitsInShipment">
>;
// Leg head fields. Excludes the per-component markup pcts + customs
// JSONB (separate mutators per Gap 3 / 14 audit-key dispositions).
export type FreightLegMetaFields = Partial<
  Pick<
    StoredFreightLeg,
    | "direction"
    | "label"
    | "origin"
    | "destination"
    | "crossesInternationalBorder"
    | "treatment"
    | "mode"
    | "carrier"
    | "incoterm"
    | "cargoReadyDate"
    | "vesselEtd"
    | "vesselEta"
    | "actualDeliveryDate"
  >
>;
// Customs JSONB shape. Either field nullable; the action layer rejects
// out-of-range values per Gap 5.
export type FreightLegCustomsFields = Partial<CostingLegCustoms>;
// Customer-arranges metadata; legs only render this in customer-
// arranges mode. Per Gap 18 the meta lives in its own table for
// independent audit-log diff per field.
export type FreightCustomerArrangesMetaFields = Partial<
  Pick<StoredFreightCustomerArrangesMeta, "customerContact" | "auditNote">
>;

// ============================================================================
// Internal recompute helper
// ============================================================================
//
// Takes the current state, projects to QuoteCostingInput, runs the pure
// rollup. Stripping `rowId` is unnecessary — the pure function ignores
// extra fields — but we project explicitly to make the data flow obvious.
//
// Performance: synchronous, <5ms target at Nexus scale (10–30 SKUs × 4–5
// tiers × small input cardinality). Empirically verified during sub-step 4
// smoke testing. If profile data ever shows recompute >10ms on a real
// quote, investigate before making the rollup async or memoized.

function recompute(
  s: Omit<CostingStoreState, "costing" | "warnings" | "hydrated" | "lastAppliedRevision"> & {
    [K in keyof CostingStoreState as K extends `update${string}` | "hydrate" | "reconcile"
      ? never
      : K]: CostingStoreState[K];
  },
): { costing: QuoteCostingResult; warnings: WarningSpec[] } {
  const input: QuoteCostingInput = {
    quote: {
      id: s.quoteId,
      globalPriceAdjPct: s.globalPriceAdjPct,
      targetMarginPct: s.targetMarginPct,
    },
    firmSettings: s.firmSettings,
    markupDefaults: s.markupDefaults,
    skus: s.skus,
    tiers: s.tiers,
    packaging: s.packaging,
    production: s.production,
    freightLegGroups: s.freightLegGroups,
    freightLegs: s.freightLegs,
    freightLegTiers: s.freightLegTiers,
    cellOverrides: s.cellOverrides,
    cellTargets: s.cellTargets,
  };
  const costing = computeQuoteCosting(input);
  const warnings = validateQuote(input, costing);
  return { costing, warnings };
}

// Slice 9.5 — compute warnings from a hydrate/reconcile snapshot.
// Snapshots arrive with server-pre-computed `costing`; warnings are
// computed client-side from the snapshot's inputs + costing. Keeps
// the server-precompute optimization for costing while letting the
// client populate the warnings slice without extending HydrateSnapshot.
function warningsFromSnapshot(snapshot: HydrateSnapshot): WarningSpec[] {
  const input: QuoteCostingInput = {
    quote: {
      id: snapshot.quoteId,
      globalPriceAdjPct: snapshot.globalPriceAdjPct,
      targetMarginPct: snapshot.targetMarginPct,
    },
    firmSettings: snapshot.firmSettings,
    markupDefaults: snapshot.markupDefaults,
    skus: snapshot.skus,
    tiers: snapshot.tiers,
    packaging: snapshot.packaging,
    production: snapshot.production,
    freightLegGroups: snapshot.freightLegGroups,
    freightLegs: snapshot.freightLegs,
    freightLegTiers: snapshot.freightLegTiers,
    cellOverrides: snapshot.cellOverrides,
    cellTargets: snapshot.cellTargets,
  };
  return validateQuote(input, snapshot.costing);
}

// ============================================================================
// Factory: makeCostingStore(initial)
// ============================================================================
//
// Returns a fresh Zustand vanilla store. Caller wraps in a React context
// (sub-step 3) and exposes via a hook. Each <CostingStoreProvider> calls
// this once per mount; different quotes get different store instances.

export type CostingStore = ReturnType<typeof makeCostingStore>;

export function makeCostingStore(initial: HydrateSnapshot) {
  return createStore<CostingStoreState>()((set, get) => ({
    quoteId: initial.quoteId,
    projectId: initial.projectId,
    globalPriceAdjPct: initial.globalPriceAdjPct,
    targetMarginPct: initial.targetMarginPct,
    firmSettings: initial.firmSettings,
    markupDefaults: initial.markupDefaults,
    skus: initial.skus,
    tiers: initial.tiers,
    packaging: initial.packaging,
    production: initial.production,
    freightLegGroups: initial.freightLegGroups,
    freightLegs: initial.freightLegs,
    freightLegTiers: initial.freightLegTiers,
    freightCustomerArrangesMeta: initial.freightCustomerArrangesMeta,
    cellOverrides: initial.cellOverrides,
    cellTargets: initial.cellTargets,
    // Slice 9.4a — view-state. Defaults to null on store creation;
    // <ActiveTierUrlSync> sets it on mount from URL `?tier=` (or
    // first tier in sort_order if URL absent/invalid). Hydrate /
    // reconcile preserve the existing value across server snapshots
    // (server snapshots don't carry view-state).
    activeTierId: null,
    costing: initial.costing,
    warnings: warningsFromSnapshot(initial),
    persistedWarnings: initial.persistedWarnings,
    hydrated: true,
    lastAppliedRevision: initial.revision,
    awaitedRevision: null,
    awaitedSince: 0,
    lastUserEditAt: 0,

    // Highest outstanding revision governs: two rapid writes must not let the
    // earlier one's lower threshold retire the later one's requirement.
    awaitCommitted: (revision) =>
      set((s) => {
        if (!Number.isFinite(revision)) return {};
        if (revision <= s.lastAppliedRevision) return {};
        if (s.awaitedRevision !== null && revision <= s.awaitedRevision) return {};
        return { awaitedRevision: revision, awaitedSince: Date.now() };
      }),

    releaseAwaited: () => set(() => ({ awaitedRevision: null, awaitedSince: 0 })),

    hydrate: (snapshot) =>
      set({
        quoteId: snapshot.quoteId,
        projectId: snapshot.projectId,
        globalPriceAdjPct: snapshot.globalPriceAdjPct,
        targetMarginPct: snapshot.targetMarginPct,
        firmSettings: snapshot.firmSettings,
        markupDefaults: snapshot.markupDefaults,
        skus: snapshot.skus,
        tiers: snapshot.tiers,
        packaging: snapshot.packaging,
        production: snapshot.production,
        freightLegGroups: snapshot.freightLegGroups,
        freightLegs: snapshot.freightLegs,
        freightLegTiers: snapshot.freightLegTiers,
        freightCustomerArrangesMeta: snapshot.freightCustomerArrangesMeta,
        cellOverrides: snapshot.cellOverrides,
        cellTargets: snapshot.cellTargets,
        costing: snapshot.costing,
        warnings: warningsFromSnapshot(snapshot),
        persistedWarnings: snapshot.persistedWarnings,
        hydrated: true,
        lastAppliedRevision: snapshot.revision,
        lastUserEditAt: 0,
      }),

    // Same as hydrate but tagged so the provider can debounce bursts of
    // post-server-action reconciles. Provider applies the 100ms debounce
    // + wait-for-quiet (won't overwrite while user is actively typing);
    // this method itself is immediate. Resets lastUserEditAt: now that
    // the server snapshot is canonical, the next user typing burst
    // starts a fresh "in-flight" window.
    reconcile: (snapshot) =>
      set((s) => {
        // Ordering guard. A snapshot must be strictly newer than the one
        // already applied, or it is discarded untouched.
        //
        // Equality is rejected as well as staleness: two renders stamped in
        // the same millisecond carry the same data, so re-applying one can
        // only cost work and risk clobbering an optimistic edit made in
        // between.
        //
        // Returning `{}` leaves every slice — packaging, production, freight,
        // overrides, targets — exactly as it is. This is what stops a server
        // render that predates an operator's save from erasing it.
        if (snapshot.revision <= s.lastAppliedRevision) return {};
        return {
        // Causal requirement is satisfied only by a snapshot that actually
        // reaches the awaited revision. Anything lower is held by the
        // provider and never arrives here.
        awaitedRevision:
          s.awaitedRevision !== null && snapshot.revision >= s.awaitedRevision
            ? null
            : s.awaitedRevision,
        quoteId: snapshot.quoteId,
        projectId: snapshot.projectId,
        globalPriceAdjPct: snapshot.globalPriceAdjPct,
        targetMarginPct: snapshot.targetMarginPct,
        firmSettings: snapshot.firmSettings,
        markupDefaults: snapshot.markupDefaults,
        skus: snapshot.skus,
        tiers: snapshot.tiers,
        packaging: snapshot.packaging,
        production: snapshot.production,
        freightLegGroups: snapshot.freightLegGroups,
        freightLegs: snapshot.freightLegs,
        freightLegTiers: snapshot.freightLegTiers,
        freightCustomerArrangesMeta: snapshot.freightCustomerArrangesMeta,
        cellOverrides: snapshot.cellOverrides,
        cellTargets: snapshot.cellTargets,
        costing: snapshot.costing,
        warnings: warningsFromSnapshot(snapshot),
        persistedWarnings: snapshot.persistedWarnings,
        lastAppliedRevision: snapshot.revision,
        lastUserEditAt: 0,
        };
      }),

    // Every updateXxx action below stamps lastUserEditAt = Date.now()
    // so the provider's wait-for-quiet reconcile can defer overwriting
    // optimistic state while the user is actively typing. See
    // costing-store-provider.tsx and the lastUserEditAt comment above.

    updatePackagingCell: (rowId, fields) =>
      set((s) => {
        const packaging = s.packaging.map((p) =>
          p.rowId === rowId ? { ...p, ...fields } : p,
        );
        return {
          packaging,
          ...recompute({ ...s, packaging }),
          lastUserEditAt: Date.now(),
        };
      }),

    updatePackagingLineMeta: (lineGroupId, fields) =>
      set((s) => {
        const packaging = s.packaging.map((p) =>
          p.lineGroupId === lineGroupId ? { ...p, ...fields } : p,
        );
        return {
          packaging,
          ...recompute({ ...s, packaging }),
          lastUserEditAt: Date.now(),
        };
      }),

    updateProductionCell: (quoteSkuId, tierId, fields) =>
      set((s) => {
        const production = s.production.map((p) =>
          p.quoteSkuId === quoteSkuId && p.tierId === tierId
            ? { ...p, ...fields }
            : p,
        );
        return {
          production,
          ...recompute({ ...s, production }),
          lastUserEditAt: Date.now(),
        };
      }),

    updateProductionPolicy: (quoteSkuId, fields) =>
      // Single set() call: builds the new production array (all matching
      // tier rows updated atomically), recomputes once, returns the new
      // state. Subscribers see one transition. Don't ever loop set() per
      // row in a fan-out — N recomputes + N subscriber-notify cycles.
      // Same rule for any future action that touches multiple rows in
      // one user gesture.
      set((s) => {
        const production = s.production.map((p) =>
          p.quoteSkuId === quoteSkuId ? { ...p, ...fields } : p,
        );
        return {
          production,
          ...recompute({ ...s, production }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice R6.2 — per-(leg, tier) rate row: total_freight + units_in_shipment.
    updateFreightLegTier: (rowId, fields) =>
      set((s) => {
        const freightLegTiers = s.freightLegTiers.map((lt) =>
          lt.rowId === rowId ? { ...lt, ...fields } : lt,
        );
        return {
          freightLegTiers,
          ...recompute({ ...s, freightLegTiers }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice R6.2 — leg head fields (mode, carrier, incoterm, dates,
    // treatment, crosses_international_border).
    updateFreightLegMeta: (legId, fields) =>
      set((s) => {
        const freightLegs = s.freightLegs.map((leg) =>
          leg.id === legId ? { ...leg, ...fields } : leg,
        );
        return {
          freightLegs,
          ...recompute({ ...s, freightLegs }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice R6.2 — per-component markup pill override. Component
    // discriminator keys which of the three markup pct fields to
    // mutate. Per Gap 3 disposition the audit-log action is shared
    // (`freight_leg_markup_updated`) with diff_json.component flag.
    updateFreightLegMarkup: (legId, component, value) =>
      set((s) => {
        const key = component === "duty" ? "dutyMarkupPct" : "tariffMarkupPct";
        const freightLegs = s.freightLegs.map((leg) =>
          leg.id === legId ? { ...leg, [key]: value } : leg,
        );
        return {
          freightLegs,
          ...recompute({ ...s, freightLegs }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice R6.2 — customs JSONB update. Merges fields into the leg's
    // existing customs object. Both keys nullable.
    updateFreightLegCustoms: (legId, fields) =>
      set((s) => {
        const freightLegs = s.freightLegs.map((leg) =>
          leg.id === legId
            ? { ...leg, customs: { ...leg.customs, ...fields } }
            : leg,
        );
        return {
          freightLegs,
          ...recompute({ ...s, freightLegs }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice R6.2 — customer-arranges metadata. Per Gap 18 the meta
    // lives in its own table for independent audit-log diff per
    // field. Upsert: if no row exists for this leg, prepend a new
    // one (server action ensures the row exists at write time).
    updateFreightCustomerArrangesMeta: (legId, fields) =>
      set((s) => {
        const existing = s.freightCustomerArrangesMeta.find(
          (m) => m.freightLegId === legId,
        );
        const freightCustomerArrangesMeta = existing
          ? s.freightCustomerArrangesMeta.map((m) =>
              m.freightLegId === legId ? { ...m, ...fields } : m,
            )
          : [
              ...s.freightCustomerArrangesMeta,
              {
                freightLegId: legId,
                customerContact: null,
                auditNote: null,
                ...fields,
              },
            ];
        return {
          freightCustomerArrangesMeta,
          ...recompute({ ...s, freightCustomerArrangesMeta }),
          lastUserEditAt: Date.now(),
        };
      }),

    updateGlobalAdj: (value) =>
      set((s) => ({
        globalPriceAdjPct: value,
        ...recompute({ ...s, globalPriceAdjPct: value }),
        lastUserEditAt: Date.now(),
      })),

    // Slice 9.2 — per-tier price-adj override. value === null clears
    // back to "inherit global"; otherwise the tier's revenue uses the
    // override (REPLACES global, does not stack — see costing.ts).
    updateTierPriceAdj: (tierId, value) =>
      set((s) => {
        const tiers = s.tiers.map((t) =>
          t.id === tierId ? { ...t, tierPriceAdjPct: value } : t,
        );
        return {
          tiers,
          ...recompute({ ...s, tiers }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice 9.2 — per-quote target-margin override. value === null
    // reverts to firm-level target. Drives verdict bands + suggestion
    // goal (see computeQuoteCosting).
    updateTargetMargin: (value) =>
      set((s) => ({
        targetMarginPct: value,
        ...recompute({ ...s, targetMarginPct: value }),
        lastUserEditAt: Date.now(),
      })),

    // Slice 9.3 — per-cell sell-price override. value === null clears
    // (filter out the entry, mirrors the server's DELETE semantics).
    // value > 0 upserts (replace existing or append). The action layer
    // rejects non-positive values; the store does not enforce here so
    // the optimistic path can stay simple — if a non-positive value
    // somehow reaches here, the costing math's defensive guard handles
    // negative `requiredSellPerUnit` via the -1 sentinel.
    updateCellOverride: (quoteSkuId, tierId, value) =>
      set((s) => {
        const filtered = s.cellOverrides.filter(
          (c) => !(c.quoteSkuId === quoteSkuId && c.tierId === tierId),
        );
        const cellOverrides =
          value === null
            ? filtered
            : [...filtered, { quoteSkuId, tierId, sellPriceOverride: value }];
        return {
          cellOverrides,
          ...recompute({ ...s, cellOverrides }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice 9.4b — per-cell client target benchmark. Same shape as
    // updateCellOverride; mirrors the lazy-row pattern. value === null
    // clears (filter); value > 0 upserts. Action layer rejects value
    // <= 0 — store doesn't enforce here. Recompute fires so the
    // competitive verdict on this cell re-classifies optimistically.
    updateCellTarget: (quoteSkuId, tierId, value) =>
      set((s) => {
        const filtered = s.cellTargets.filter(
          (c) => !(c.quoteSkuId === quoteSkuId && c.tierId === tierId),
        );
        const cellTargets =
          value === null
            ? filtered
            : [
                ...filtered,
                { quoteSkuId, tierId, clientTargetPricePerUnit: value },
              ];
        return {
          cellTargets,
          ...recompute({ ...s, cellTargets }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice 9.4a — view-state mutator for the active-tier selection.
    // Pure mutation; no costing recompute (active tier doesn't affect
    // math, only which tier's slice the UI surfaces). Does NOT stamp
    // lastUserEditAt — selecting a tier isn't an input edit and
    // shouldn't defer reconcile via wait-for-quiet.
    setActiveTier: (tierId) => set({ activeTierId: tierId }),
  }));
}

// ============================================================================
// Selector helpers (typed, exported, enforced)
// ============================================================================
//
// Components import these by name. NEVER use inline `useStore(s => ...)` at
// a call site — the helper file is the single source of truth for which
// components depend on which slices.

// Quote-level
/**
 * The canonical computation graph. Consumers READ commercial values from here
 * rather than deriving them — see docs/gate-1b-canonical-node-tree.md.
 */
export const selectGraph = (s: CostingStoreState) => s.costing.graph;

export const selectQuoteRollup = (s: CostingStoreState) =>
  s.costing.quoteRollup;
export const selectFirmSettings = (s: CostingStoreState) => s.firmSettings;
export const selectGlobalAdj = (s: CostingStoreState) => s.globalPriceAdjPct;
export const selectQuoteId = (s: CostingStoreState) => s.quoteId;
export const selectProjectId = (s: CostingStoreState) => s.projectId;

// Status / suggested adj for a specific tier (for compact card display)
export const selectStatusForTier =
  (tierId: string) => (s: CostingStoreState) =>
    s.costing.quoteRollup.find((t) => t.tierId === tierId);

// Lead-tier suggested adj. The "lead" tier is the LARGEST-REVENUE tier
// in the rollup, not Tier 1 and not the first non-GOOD tier.
//
// Rationale: the largest-revenue tier is the most representative case
// for the customer's likely commitment volume. PMs care about "what
// global adj makes the deal acceptable at the volume the customer is
// most likely to land on." We don't always know which tier that is,
// so largest-revenue is the best proxy.
//
// Alternatives considered:
//   - First non-GOOD tier: surfaces issues earliest but ignores the case
//     where Tier 1 is BELOW_FLOOR while Tier 4 is GOOD (PM might happily
//     accept a small-volume loss leader; we shouldn't suggest pulling
//     up the whole quote to fix it).
//   - Tier 1 fixed: arbitrary. Real DPS quotes typically have a "target
//     tier" that's mid-range, not Tier 1.
//
// If the lead tier is GOOD, return null (no suggestion needed). PMs see
// no "Apply suggested" button when blended margin already hits target.
export const selectSuggestedAdj = (s: CostingStoreState) => {
  const rollup = s.costing.quoteRollup;
  if (rollup.length === 0) return null;
  const lead = rollup.reduce((a, b) =>
    b.totalRevenue > a.totalRevenue ? b : a,
  );
  return lead.blendedMarginStatus !== "GOOD"
    ? lead.suggestedGlobalAdjPct
    : null;
};

// Tiers list (for header rendering — derived from costing output;
// shape: { tierId, label, qty } per QuoteCostingResult.tiers).
export const selectTiers = (s: CostingStoreState) => s.costing.tiers;

// Input-shape tiers with tier_price_adj_pct override + sortOrder.
// Use when consuming code needs the persisted-shape per-tier data
// (e.g., Pricing reframe suggestion engine's pre-check that the
// composed new_adj fits the numeric(5,4) schema bound — Bug #2 fix).
export const selectQuoteTierInputs = (s: CostingStoreState) => s.tiers;

// Per-SKU breakdown
export const selectSkuRollups = (s: CostingStoreState) => s.costing.skuRollups;
export const selectSkuRollup =
  (skuId: string) => (s: CostingStoreState) =>
    s.costing.skuRollups.find((r) => r.skuId === skuId);
export const selectPerTierForSku =
  (skuId: string, tierId: string) => (s: CostingStoreState) => {
    const sr = s.costing.skuRollups.find((r) => r.skuId === skuId);
    return sr?.perTier.find((pt) => pt.tierId === tierId);
  };

// Hydration state — for components that need to know if the store has been
// populated yet (vs. falling back to a server-rendered snapshot).
export const selectHydrated = (s: CostingStoreState) => s.hydrated;

// Used by the provider's wait-for-quiet reconcile. Not subscribed via
// useStore — read directly via getState() at debounce time. Exposed as
// a selector for consistency with the "no inline access" rule.
export const selectLastUserEditAt = (s: CostingStoreState) => s.lastUserEditAt;

// ---- Action selectors ----
//
// Actions are stable references in Zustand (set across the store's
// lifetime), so subscribing to them never causes re-renders. We still
// export per-action selectors to keep the "no inline selectors" rule
// uniform — every store interaction at a consumer site goes through a
// named selector helper, action or read. Consistency makes future
// refactors mechanical.

export const selectUpdatePackagingCell = (s: CostingStoreState) =>
  s.updatePackagingCell;
export const selectUpdatePackagingLineMeta = (s: CostingStoreState) =>
  s.updatePackagingLineMeta;
export const selectUpdateProductionCell = (s: CostingStoreState) =>
  s.updateProductionCell;
export const selectUpdateProductionPolicy = (s: CostingStoreState) =>
  s.updateProductionPolicy;
// Slice R6.2 — per-leg-tier rate update (total_freight, units_in_shipment).
export const selectUpdateFreightLegTier = (s: CostingStoreState) =>
  s.updateFreightLegTier;
// Slice R6.2 — leg head metadata (mode, carrier, incoterm, dates,
// treatment, crosses_international_border).
export const selectUpdateFreightLegMeta = (s: CostingStoreState) =>
  s.updateFreightLegMeta;
// Slice R6.2 — per-component markup pill override.
export const selectUpdateFreightLegMarkup = (s: CostingStoreState) =>
  s.updateFreightLegMarkup;
// Slice R6.2 — customs JSONB update (duty_pct, tariff_pct).
export const selectUpdateFreightLegCustoms = (s: CostingStoreState) =>
  s.updateFreightLegCustoms;
// Slice R6.2 — customer-arranges metadata.
export const selectUpdateFreightCustomerArrangesMeta = (
  s: CostingStoreState,
) => s.updateFreightCustomerArrangesMeta;

// Slice R6.2 — freight reads. UI consumers grab the full sets;
// further filtering is per-component. (Granular per-leg selectors
// would explode the surface area; v1 reads are coarse and re-renders
// are bounded by the store's recompute granularity.)
export const selectFreightLegGroups = (s: CostingStoreState) =>
  s.freightLegGroups;
export const selectFreightLegs = (s: CostingStoreState) => s.freightLegs;
export const selectFreightLegTiers = (s: CostingStoreState) =>
  s.freightLegTiers;
export const selectFreightCustomerArrangesMeta = (s: CostingStoreState) =>
  s.freightCustomerArrangesMeta;
export const selectUpdateGlobalAdj = (s: CostingStoreState) =>
  s.updateGlobalAdj;
export const selectUpdateTierPriceAdj = (s: CostingStoreState) =>
  s.updateTierPriceAdj;
export const selectUpdateTargetMargin = (s: CostingStoreState) =>
  s.updateTargetMargin;

// Slice 9.2 — per-quote target-margin override (NULL = inherit firm).
// Effective value at any consumer is `target ?? firmSettings.targetMarginPct`.
export const selectTargetMargin = (s: CostingStoreState) => s.targetMarginPct;

// Slice 9.2 — quote-wide blended summary (revenue, cost, status,
// suggested-GPA partition output). Single source for the GPA banner.
export const selectQuoteSummary = (s: CostingStoreState) =>
  s.costing.quoteSummary;

// Slice 9.2 — per-tier price-adj override (NULL = inherit global).
// Components rendering a single tier slider should subscribe via this
// curried selector to avoid re-render on unrelated tier changes.
export const selectTierPriceAdj =
  (tierId: string) => (s: CostingStoreState) => {
    const t = s.tiers.find((t) => t.id === tierId);
    return t ? t.tierPriceAdjPct : null;
  };

// Slice 11.5.1 MIG-8 close-gate — packaging input rows (live store
// state). Cost cells in `packaging-drilldown.tsx` subscribe via this
// to pick up cross-tab realtime reconciles; the page-level
// `inputRows` prop is an RSC server snapshot that doesn't refresh on
// store changes, so prop-driven cells display stale values after a
// remote edit. With ~27 rows per quote at v1 scale, subscribing to
// the full array is fine — every cell re-renders on every reconcile.
export const selectPackaging = (s: CostingStoreState) => s.packaging;

// Slice 9.3 — per-cell override action selector.
export const selectUpdateCellOverride = (s: CostingStoreState) =>
  s.updateCellOverride;

// Slice 9.3 — single-cell override value selector. Returns the
// override number when set, null when the cell is computed-only.
// Curried so consumer subscribes only to its own (SKU, tier) cell;
// changes elsewhere don't trigger re-renders.
export const selectCellOverride =
  (quoteSkuId: string, tierId: string) => (s: CostingStoreState) => {
    const c = s.cellOverrides.find(
      (c) => c.quoteSkuId === quoteSkuId && c.tierId === tierId,
    );
    return c ? c.sellPriceOverride : null;
  };

// Slice 9.4b — per-cell client target action selector.
export const selectUpdateCellTarget = (s: CostingStoreState) =>
  s.updateCellTarget;

// Slice 9.4b — single-cell client target value selector. Returns the
// target number when set, null when no benchmark on this cell. Curried
// for per-cell subscription granularity, mirrors selectCellOverride.
export const selectCellTarget =
  (quoteSkuId: string, tierId: string) => (s: CostingStoreState) => {
    const c = s.cellTargets.find(
      (c) => c.quoteSkuId === quoteSkuId && c.tierId === tierId,
    );
    return c ? c.clientTargetPricePerUnit : null;
  };

// Slice 9.4a — view-state. The currently-active tier on the Costing
// Sheet (drives per-SKU summary row's active-tier columns). null
// before <ActiveTierUrlSync> initializes from URL or defaults to
// first tier in sort_order.
export const selectActiveTierId = (s: CostingStoreState) => s.activeTierId;

// Slice 9.4a — view-state mutator selector. Used by <ActiveTierUrlSync>
// (to set from URL) and by the active-tier selector UI (to set from
// click). The selector also writes the URL via router.replace; the
// store mutation here is the pure view-state update only.
export const selectSetActiveTier = (s: CostingStoreState) => s.setActiveTier;

// Slice 9.4a — convenience selector returning the QuotePerTierRollup
// for the currently-active tier (or null when no active tier or the
// active tier doesn't appear in quoteRollup — which can happen
// momentarily after a reconcile that removed the prior active tier
// before <ActiveTierUrlSync> falls back to first tier).
export const selectActiveTierRollup = (s: CostingStoreState) => {
  if (s.activeTierId === null) return null;
  return s.costing.quoteRollup.find((q) => q.tierId === s.activeTierId) ?? null;
};

// ============================================================================
// Slice 9.5 — validation warning selectors
// ============================================================================
//
// Engine output is recomputed alongside costing on every input change.
// Selectors below provide granular subscription patterns so individual
// components don't re-render on warnings unrelated to them.
//
// Note on identity tuples (per architect option 2b-A): row_id is TEXT.
// Genuine row warnings store UUID-as-text. Cross-row pattern warnings
// synthesize keys like "sku:<id>:col:setup_fee_total". Cell-lookup
// selectors below match on the synthesized-or-uuid row_id; callers that
// need to render an inline icon next to a specific input cell pass
// the row's UUID-as-text.

// All active warnings on this quote (client-side computed, not yet
// persisted — server-side persistence happens on action commit).
// Most consumers want the count or a filtered slice; subscribe via
// the more granular selectors below to avoid re-rendering on
// unrelated warning changes.
export const selectWarnings = (s: CostingStoreState) => s.warnings;

// Count of active warnings. Curried so summary chip + inline counters
// can subscribe without pulling the full array (though Zustand's
// shallow-equal still triggers when the array reference changes).
// Most consumers should prefer this over selectWarnings.length to
// keep the subscription dependency explicit.
export const selectWarningCount = (s: CostingStoreState) => s.warnings.length;

// Counts grouped by severity. Drives the per-page chip's color
// (highest-severity wins for chip register; mixed-severity uses
// highest-severity color per Designer extension memo CR-11).
export const selectWarningCountsBySeverity = (s: CostingStoreState) => {
  let info = 0;
  let review = 0;
  let action_required = 0;
  for (const w of s.warnings) {
    if (w.severity === "info") info += 1;
    else if (w.severity === "review") review += 1;
    else if (w.severity === "action_required") action_required += 1;
  }
  return { info, review, action_required, total: s.warnings.length };
};

// Highest severity present among active warnings, or null when zero.
// Used by the per-page chip + Pricing aggregation panel to pick
// the chip color register (info → muted, review → warn, action_required → bad).
export const selectHighestSeverity = (
  s: CostingStoreState,
): "info" | "review" | "action_required" | null => {
  let highest: "info" | "review" | null = null;
  for (const w of s.warnings) {
    if (w.severity === "action_required") return "action_required";
    if (w.severity === "review") {
      highest = "review";
    } else if (w.severity === "info" && highest === null) {
      highest = "info";
    }
  }
  return highest;
};

// Curried selector: warnings matching a specific (table_name, row_id)
// pair, used by inline warning icons. row_id can be a UUID-as-text
// (genuine row warning) or a synthesized composite key (cross-row
// pattern warning). The matcher is exact; identity-tuple stability
// is preserved by the engine across consecutive runs.
export const selectWarningsForRow =
  (tableName: string, rowId: string) => (s: CostingStoreState) =>
    s.warnings.filter(
      (w) => w.table_name === tableName && w.row_id === rowId,
    );

// Curried selector: warnings matching a specific (table_name,
// row_id, tier_id) triple. Stricter than selectWarningsForRow —
// used when the inline icon is per-(cell, tier) rather than per-row.
// tier_id null on the warning matches any tier_id query (cross-tier
// warnings like service_fee_tier_variance attach to the SKU/column
// pair, not a specific tier).
export const selectWarningsForCell =
  (tableName: string, rowId: string, tierId: string | null) =>
  (s: CostingStoreState) =>
    s.warnings.filter(
      (w) =>
        w.table_name === tableName &&
        w.row_id === rowId &&
        (w.tier_id === null || w.tier_id === tierId),
    );

// Curried selector: warnings filtered by table_name (e.g., all
// packaging-page warnings). Drives per-page summary chips.
export const selectWarningsForTable =
  (tableName: string) => (s: CostingStoreState) =>
    s.warnings.filter((w) => w.table_name === tableName);

// Slice 9.5 — server-persisted warnings (active + accepted) snapshot.
// The UI merges by identity tuple onto in-memory engine specs to
// attach DB ids for per-row Accept. Refreshed on every snapshot via
// hydrate/reconcile.
export const selectPersistedWarnings = (s: CostingStoreState) =>
  s.persistedWarnings;

// Helper: build a Map keyed by identity tuple from the persisted
// warnings list (active rows only). UI components use this to look
// up the DB id for a given engine spec (so Accept can fire).
// Memoization is the caller's responsibility — typically map is
// built once per render via useMemo.
export function buildPersistedWarningIndex(
  persisted: PersistedQuoteWarning[],
): Map<string, PersistedQuoteWarning> {
  const map = new Map<string, PersistedQuoteWarning>();
  for (const w of persisted) {
    if (w.status !== "active") continue;
    const key = `${w.tableName ?? ""}::${w.rowId ?? ""}::${w.fieldName ?? ""}::${w.tierId ?? ""}::${w.kind}`;
    map.set(key, w);
  }
  return map;
}

// Slice 9.5 — accepted-tuple Set. Per architect option (iii),
// accepted warnings stay suppressed even when the engine continues
// to fire on the same data. UI filters engine specs against this
// Set to hide accepted "ghost" warnings from the chip + panel.
export function buildAcceptedWarningKeySet(
  persisted: PersistedQuoteWarning[],
): Set<string> {
  const set = new Set<string>();
  for (const w of persisted) {
    if (w.status !== "accepted") continue;
    const key = `${w.tableName ?? ""}::${w.rowId ?? ""}::${w.fieldName ?? ""}::${w.tierId ?? ""}::${w.kind}`;
    set.add(key);
  }
  return set;
}

export function persistedWarningKey(spec: WarningSpec): string {
  return `${spec.table_name ?? ""}::${spec.row_id ?? ""}::${spec.field_name ?? ""}::${spec.tier_id ?? ""}::${spec.kind}`;
}
