import { createStore } from "zustand";
import {
  computeQuoteCosting,
  type CostingCellOverride,
  type CostingFreightInput,
  type CostingPackagingInput,
  type CostingProductionInput,
  type CostingSku,
  type CostingTier,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "./costing";

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
// app/.../costing/sku-breakdowns.tsx + costing/page.tsx.
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

export type StoredPackagingRow = CostingPackagingInput & { rowId: string };
export type StoredFreightRow = CostingFreightInput & { rowId: string };
export type StoredProductionRow = CostingProductionInput; // keyed by (skuId, tierId)

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
  freight: StoredFreightRow[];
  // Slice 9.3 — sparse per-cell sell-price overrides. Empty array =
  // no overrides. Mutated by `updateCellOverride(skuId, tierId, value)`
  // (upsert / clear pattern; see action below).
  cellOverrides: CostingCellOverride[];

  // Derived (always reflects current inputs)
  costing: QuoteCostingResult;

  // Bookkeeping
  hydrated: boolean; // false until first hydrate() call
  lastReconcileAt: number; // ms epoch; used by debounce in provider
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

  // Actions
  hydrate: (snapshot: HydrateSnapshot) => void;
  reconcile: (snapshot: HydrateSnapshot) => void;
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
  updateFreightCell: (rowId: string, fields: FreightCellFields) => void;
  updateFreightLineMeta: (
    lineGroupId: string,
    fields: FreightLineMetaFields,
  ) => void;
  updateCustoms: (quoteSkuId: string, fields: CustomsFields) => void;
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
};

export type HydrateSnapshot = {
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
  freight: StoredFreightRow[];
  // Slice 9.3 — sparse per-cell sell-price overrides (rows that exist
  // in DB at hydration time). Empty array if no overrides on this quote.
  cellOverrides: CostingCellOverride[];
  costing: QuoteCostingResult; // pre-computed on the server side
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
  Pick<StoredPackagingRow, "category" | "markupPct" | "qtyPerSellableUnit">
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
export type FreightCellFields = Partial<
  Pick<StoredFreightRow, "totalFreight" | "unitsInShipment" | "skuTotalCbm">
>;
export type FreightLineMetaFields = Partial<
  Pick<StoredFreightRow, "markupPct" | "freightTreatment">
>;
export type CustomsFields = Partial<Pick<CostingSku, "dutyPct" | "tariffPct">>;

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
  s: Omit<CostingStoreState, "costing" | "hydrated" | "lastReconcileAt"> & {
    [K in keyof CostingStoreState as K extends `update${string}` | "hydrate" | "reconcile"
      ? never
      : K]: CostingStoreState[K];
  },
): QuoteCostingResult {
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
    freight: s.freight,
    cellOverrides: s.cellOverrides,
  };
  return computeQuoteCosting(input);
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
    freight: initial.freight,
    cellOverrides: initial.cellOverrides,
    costing: initial.costing,
    hydrated: true,
    lastReconcileAt: Date.now(),
    lastUserEditAt: 0,

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
        freight: snapshot.freight,
        cellOverrides: snapshot.cellOverrides,
        costing: snapshot.costing,
        hydrated: true,
        lastReconcileAt: Date.now(),
        lastUserEditAt: 0,
      }),

    // Same as hydrate but tagged so the provider can debounce bursts of
    // post-server-action reconciles. Provider applies the 100ms debounce
    // + wait-for-quiet (won't overwrite while user is actively typing);
    // this method itself is immediate. Resets lastUserEditAt: now that
    // the server snapshot is canonical, the next user typing burst
    // starts a fresh "in-flight" window.
    reconcile: (snapshot) =>
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
        freight: snapshot.freight,
        cellOverrides: snapshot.cellOverrides,
        costing: snapshot.costing,
        lastReconcileAt: Date.now(),
        lastUserEditAt: 0,
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
          costing: recompute({ ...s, packaging }),
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
          costing: recompute({ ...s, packaging }),
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
          costing: recompute({ ...s, production }),
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
          costing: recompute({ ...s, production }),
          lastUserEditAt: Date.now(),
        };
      }),

    updateFreightCell: (rowId, fields) =>
      set((s) => {
        const freight = s.freight.map((f) =>
          f.rowId === rowId ? { ...f, ...fields } : f,
        );
        return {
          freight,
          costing: recompute({ ...s, freight }),
          lastUserEditAt: Date.now(),
        };
      }),

    updateFreightLineMeta: (lineGroupId, fields) =>
      set((s) => {
        const freight = s.freight.map((f) =>
          f.lineGroupId === lineGroupId ? { ...f, ...fields } : f,
        );
        return {
          freight,
          costing: recompute({ ...s, freight }),
          lastUserEditAt: Date.now(),
        };
      }),

    updateCustoms: (quoteSkuId, fields) =>
      set((s) => {
        const skus = s.skus.map((sk) =>
          sk.id === quoteSkuId ? { ...sk, ...fields } : sk,
        );
        return {
          skus,
          costing: recompute({ ...s, skus }),
          lastUserEditAt: Date.now(),
        };
      }),

    updateGlobalAdj: (value) =>
      set((s) => ({
        globalPriceAdjPct: value,
        costing: recompute({ ...s, globalPriceAdjPct: value }),
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
          costing: recompute({ ...s, tiers }),
          lastUserEditAt: Date.now(),
        };
      }),

    // Slice 9.2 — per-quote target-margin override. value === null
    // reverts to firm-level target. Drives verdict bands + suggestion
    // goal (see computeQuoteCosting).
    updateTargetMargin: (value) =>
      set((s) => ({
        targetMarginPct: value,
        costing: recompute({ ...s, targetMarginPct: value }),
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
          costing: recompute({ ...s, cellOverrides }),
          lastUserEditAt: Date.now(),
        };
      }),
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

// Tiers list (for header rendering)
export const selectTiers = (s: CostingStoreState) => s.costing.tiers;

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
export const selectUpdateFreightCell = (s: CostingStoreState) =>
  s.updateFreightCell;
export const selectUpdateFreightLineMeta = (s: CostingStoreState) =>
  s.updateFreightLineMeta;
export const selectUpdateCustoms = (s: CostingStoreState) => s.updateCustoms;
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
