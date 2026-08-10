"use client";

// Phase 3 · the staging model.
//
// Canonical source: `app/r12/pricing-page.jsx` — `committed` / `working`, the
// `changes` diff, `unstage`, `reset`, `apply`.
//
// ── WHAT STAGING IS, AND WHY IT IS NOT PERSISTENCE ────────────────────────
//
// Phase 3 §2: session-scoped working state; one Apply commits the whole set;
// Reset discards. *"Nothing persists across navigation. There is no third
// state."*
//
// That sentence is the reason this file needs no schema and is not blocked on
// OD-012. What OD-012 blocks is persisting an APPLIED lift — the committed set
// surviving a page load. The staging layer above it is session state, and
// session state is legitimately the presentation's to own: "what has the
// operator asked for and not yet committed" is not a commercial fact about the
// quote, it is a fact about this browser tab.
//
// The OUTCOMES of a staged set are a different matter entirely, and they are
// not owned here. They come from the engine, run over an input carrying the
// working set — the preview evaluation. This layer decides what is staged; it
// never decides what staging produces.
//
// ── H3, WHICH IS THE WHOLE DESIGN OF THIS FILE ────────────────────────────
//
//     `isStaged` is a DIFFERENCE, not a property.
//
// Phase 3 lists it High severity, and the failure it names is specific:
// derived from the working set alone, `isStaged` stays true forever after
// Apply, and *"the failure is silent"* — the page keeps offering to commit
// changes that are already committed, and nothing looks broken.
//
// So there is no `dirty` flag anywhere below. `changes` is computed by
// comparing the two sets on every render, and `isStaged` is
// `changes.length > 0`. After Apply the sets are identical, so the comparison
// yields nothing, so it is false. It cannot get stuck, because there is no
// state to get stuck in.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  computeQuoteCosting,
  type CostingLift,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "@/lib/costing";
import { buildCostingInput } from "@/lib/costing-store";
import {
  ADJ_EPSILON,
  cellKey,
  diffSets,
  parseCellKey,
  resolveCanonicalCell,
  resolveEngineCell,
  type CellRef,
  type PricingSet,
  type StagedChange,
} from "@/lib/pricing-staging";
import { useCostingStoreApi } from "@/components/costing-store-provider";

export {
  cellKey,
  diffSets,
  type CellRef,
  type PricingSet,
  type StagedChange,
} from "@/lib/pricing-staging";

// ── context ───────────────────────────────────────────────────────────────

export interface PricingStagingValue {
  committed: PricingSet;
  working: PricingSet;
  changes: StagedChange[];
  /** `changes.length > 0`. A difference, never a flag. */
  isStaged: boolean;
  /** How many levers are in effect on the committed set. */
  appliedCount: number;

  stageLift: (ref: CellRef, pct: number | null) => void;
  stageOverride: (ref: CellRef, value: number | null) => void;
  stageGlobalAdj: (pct: number) => void;
  /** Discard ONE pending change: restore that key to its committed value. */
  unstage: (change: StagedChange) => void;
  /** Discard everything pending. */
  reset: () => void;
  /**
   * Commit the working set.
   *
   * In-memory only. Persisting an applied lift is OD-012 and is not reached
   * from here; when it lands, this is the seam it lands at — `committed` gains
   * a server round-trip and nothing else in this file changes.
   */
  apply: () => void;
  /** Return to the computed baseline: no lifts, no overrides, no adjustment. */
  toBaseline: () => void;

  /**
   * The engine's result for the WORKING set, labelled `preview`.
   *
   * Null when nothing is staged — there is no preview of the committed state,
   * because the committed state is not a preview. Consumers reading this must
   * name preview authority to get anything out of it; the committed readers
   * refuse it by construction.
   */
  previewResult: QuoteCostingResult | null;
}

const Ctx = createContext<PricingStagingValue | null>(null);

export function usePricingStaging(): PricingStagingValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("usePricingStaging must be used inside <PricingStagingProvider>");
  }
  return v;
}

// ── provider ──────────────────────────────────────────────────────────────

export function PricingStagingProvider({
  initialGlobalAdj,
  children,
}: {
  initialGlobalAdj: number;
  children: ReactNode;
}) {
  const storeApi = useCostingStoreApi();

  /**
   * The computed baseline: every lever at rest.
   *
   * `toBaseline` returns here in one act, which is only safe because every
   * adjustment is an additive layer over a base that does not move. H6 asserts
   * the return is EXACT — not close, the same float — and it can be exact
   * precisely because removing a layer is not an operation on the base.
   */
  const baseline: PricingSet = useMemo(
    () => ({ lifts: {}, overrides: {}, globalAdj: 0 }),
    [],
  );

  /**
   * COMMITTED IS WHAT IS IN EFFECT ON THE QUOTE, not what this session has
   * applied.
   *
   * `globalAdj` was already seeded from `quotes.global_price_adj_pct`;
   * `overrides` was not, and the inconsistency was the defect. With an empty
   * override set, "Remove direct price" on a persisted override deleted a key
   * that had never been there — no diff, no chip, no preview change, and
   * `appliedCount` under-reported what the quote actually carried.
   *
   * Persisted overrides arrive keyed the ENGINE's way and the staging model
   * addresses cells canonically, so each is translated on the way in. One that
   * cannot be translated is NOT dropped: it stays in the costing input
   * untouched (see the preview run) and is simply not stageable, because there
   * is no key with which to stage against it.
   *
   * Seeded ONCE, at mount. A reconcile that changes persisted overrides
   * mid-session does not re-seed — staging is session state, and silently
   * moving the baseline under an operator mid-edit would be worse than a
   * baseline that is one navigation stale.
   *
   * `lifts` stays empty. No persisted lift authority exists yet; that is
   * OD-012, and inventing one here would pre-empt it.
   */
  const initial: PricingSet = useMemo(() => {
    const state = storeApi.getState();
    const overrides: Record<string, number> = {};
    for (const o of state.cellOverrides) {
      const canonical = resolveCanonicalCell(
        { quoteSkuId: o.quoteSkuId, tierId: o.tierId },
        state.skus,
      );
      if (canonical === null) continue;
      overrides[cellKey(canonical)] = o.sellPriceOverride;
    }
    return { lifts: {}, overrides, globalAdj: initialGlobalAdj };
    // Mount-time only, deliberately — see above. `storeApi` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGlobalAdj, storeApi]);

  const [committed, setCommitted] = useState<PricingSet>(initial);
  const [working, setWorking] = useState<PricingSet>(initial);

  const changes = useMemo(() => diffSets(committed, working), [committed, working]);

  const stageLift = useCallback((ref: CellRef, pct: number | null) => {
    const key = cellKey(ref);
    setWorking((w) => {
      const lifts = { ...w.lifts };
      if (pct === null) delete lifts[key];
      else lifts[key] = pct;
      return { ...w, lifts };
    });
  }, []);

  const stageOverride = useCallback((ref: CellRef, value: number | null) => {
    const key = cellKey(ref);
    setWorking((w) => {
      const overrides = { ...w.overrides };
      if (value === null) delete overrides[key];
      else overrides[key] = value;
      return { ...w, overrides };
    });
  }, []);

  const stageGlobalAdj = useCallback((pct: number) => {
    setWorking((w) => ({ ...w, globalAdj: pct }));
  }, []);

  /**
   * Discard one change by RESTORING ITS COMMITTED VALUE — not by deleting it.
   *
   * The distinction matters for a staged REMOVAL. Unstaging "remove the lift
   * on this cell" has to put the committed lift back; deleting the key would
   * carry out the very removal the operator just cancelled.
   */
  const unstage = useCallback(
    (change: StagedChange) => {
      setWorking((w) => {
        if (change.kind === "adj") return { ...w, globalAdj: committed.globalAdj };
        const field = change.kind.startsWith("lift") ? "lifts" : "overrides";
        const next = { ...w[field] };
        const committedValue = committed[field][change.key];
        if (committedValue === undefined) delete next[change.key];
        else next[change.key] = committedValue;
        return { ...w, [field]: next };
      });
    },
    [committed],
  );

  const reset = useCallback(() => setWorking(committed), [committed]);
  const apply = useCallback(() => setCommitted(working), [working]);
  const toBaseline = useCallback(() => {
    setWorking(baseline);
    setCommitted(baseline);
  }, [baseline]);

  /**
   * The preview run.
   *
   * Clones the committed input and changes only what is staged, then runs the
   * SAME pure engine. No new arithmetic: the outcome of a staged set is stated
   * by the engine, exactly as the outcome of a committed one is.
   *
   * Null when nothing is staged, deliberately. A "preview" identical to the
   * committed state is not a preview, and returning one would let a consumer
   * read preview authority on every render without noticing.
   */
  const previewResult = useMemo<QuoteCostingResult | null>(() => {
    if (changes.length === 0) return null;
    const base = buildCostingInput(storeApi.getState());
    // Lifts stay on CANONICAL identity — `CostingLift.quoteLeafId` is keyed
    // that way by design, so the staging key needs no translation. Parsed
    // through the named helper so no site hand-splits and renames a half.
    const lifts: CostingLift[] = Object.entries(working.lifts).map(([key, pct]) => {
      const { quoteLeafId, tierId } = parseCellKey(key);
      return { quoteLeafId, tierId, liftPct: pct };
    });

    /**
     * Overrides cross the identity boundary, and must.
     * `CostingCellOverride.quoteSkuId` is the ENGINE's SKU id, not the
     * canonical quote-leaf id the staging key carries. Emitting the canonical
     * one produced a row the engine matched against nothing and dropped in
     * silence — the chip appeared, the price staged, and the preview did not
     * move by a cent.
     *
     * Unresolvable staged overrides are DROPPED rather than emitted, because an
     * override row the engine cannot consume is indistinguishable from no
     * override while looking like one in the staging bar. Dropping is also
     * observable: `unresolvedOverrides` is surfaced so a caller can say so.
     */
    const stagedOverrides: QuoteCostingInput["cellOverrides"] = [];
    let unresolvedOverrides = 0;
    for (const [key, value] of Object.entries(working.overrides)) {
      const engine = resolveEngineCell(parseCellKey(key), base.skus);
      if (engine === null) {
        unresolvedOverrides++;
        continue;
      }
      stagedOverrides.push({ ...engine, sellPriceOverride: value });
    }
    if (unresolvedOverrides > 0) {
      // Loud rather than silent. Reaching this means the staging key named a
      // canonical attachment the engine's SKU set does not carry, which is a
      // contract break upstream of here.
      console.error(
        `[staging] ${unresolvedOverrides} staged override(s) did not resolve to an engine cell and were not applied to the preview.`,
      );
    }
    const preview: QuoteCostingInput = {
      ...base,
      quote: { ...base.quote, globalPriceAdjPct: working.globalAdj },
      // A new array with new objects for the touched cells only; the committed
      // input's own objects are never written to. A permanent test asserts it.
      //
      // The filter compares ENGINE key to ENGINE key. It used to build a
      // staging-shaped key out of a committed row's engine id and look it up
      // in the canonical-keyed working set — which never matched, so a
      // committed override was never removed. Fixing only the emission would
      // have left both rows present and made replacement depend on the engine's
      // map insertion order: correct by accident, which is the thing this
      // surface keeps being rebuilt to stop relying on.
      // `working.overrides` is now the COMPLETE intended set, seeded from what
      // is persisted, so the preview's overrides are exactly its resolution —
      // not the committed rows with staged ones layered over them. That is
      // what makes a staged REMOVAL work: an override absent from `working`
      // has been removed by the operator, and rebuilding from the committed
      // rows would keep resurrecting it.
      //
      // Untranslatable persisted rows pass through unchanged. They are real
      // and in effect; they are simply not addressable as staging keys, so
      // nothing the operator does can be about them.
      cellOverrides: [
        ...base.cellOverrides.filter(
          (o) =>
            resolveCanonicalCell(
              { quoteSkuId: o.quoteSkuId, tierId: o.tierId },
              base.skus,
            ) === null,
        ),
        ...stagedOverrides,
      ],
      lifts,
    };
    return computeQuoteCosting(preview, "preview");
  }, [changes.length, storeApi, working]);

  const appliedCount =
    Object.keys(committed.lifts).length +
    Object.keys(committed.overrides).length +
    (Math.abs(committed.globalAdj - baseline.globalAdj) > ADJ_EPSILON ? 1 : 0);

  const value: PricingStagingValue = {
    committed,
    working,
    changes,
    isStaged: changes.length > 0,
    appliedCount,
    stageLift,
    stageOverride,
    stageGlobalAdj,
    unstage,
    reset,
    apply,
    toBaseline,
    previewResult,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
