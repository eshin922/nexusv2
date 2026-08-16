"use client";

// Phase 3 · the staging model.
//
// Canonical source: `app/r12/pricing-page.jsx` — `committed` / `working`, the
// `changes` diff, `unstage`, `reset`, `apply`.
//
// ── WHAT STAGING IS, AND WHERE PERSISTENCE BEGINS ─────────────────────────
//
// Phase 3 §2: session-scoped working state; one Apply commits the whole set;
// Reset discards. *"Nothing persists across navigation. There is no third
// state."*
//
// That is still true of the WORKING set, and it is why this layer owns it:
// "what has the operator asked for and not yet committed" is a fact about
// this browser tab, not a commercial fact about the quote.
//
// It is no longer true of the COMMITTED set. Package 1 gives an applied
// adjustment a home in the database, so `committed` is now seeded from what is
// persisted and Apply is a server round-trip. Two consequences follow, and both
// are the point of the package:
//
//   - `appliedCount` describes the QUOTE, not the session. A reload no longer
//     resets it to zero while the prices it produced stay on screen.
//   - Removing an adjustment survives navigation, because a removal is written
//     rather than forgotten.
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
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { applyPricingAdjustments } from "@/app/actions/pricing-lifts";
import { costBaseFingerprint } from "@/lib/pricing-cost-base";
import { pricingAuthorityBaseline, staleMessage } from "@/lib/pricing-stale-guard";
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
  seedCommittedSet,
  type CellRef,
  type PricingSet,
  type StagedChange,
} from "@/lib/pricing-staging";
import {
  useCostingStore,
  useCostingStoreApi,
} from "@/components/costing-store-provider";

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
  /**
   * Stage a per-tier adjustment. `null` removes it, so the tier falls back to
   * the quote-wide adjustment.
   *
   * The value is the RESULTING adjustment, not a delta. A caller composing a
   * recommendation onto what a tier already carries does so with
   * `composePricingAdjustment` — the one composition rule on this surface —
   * and stages the result.
   */
  stageTierAdj: (tierId: string, pct: number | null) => void;
  stageGlobalAdj: (pct: number) => void;
  /** Discard ONE pending change: restore that key to its committed value. */
  unstage: (change: StagedChange) => void;
  /** Discard everything pending. */
  reset: () => void;
  /**
   * Commit the working set. Writes, then moves `committed` — in that order.
   *
   * `committed` moves only on a successful write. Moving it first would clear
   * the chips and leave the operator looking at an APPLIED bar for adjustments
   * the quote does not carry, which is the exact failure the bar exists to
   * prevent.
   */
  apply: () => void;
  /** Return to the computed baseline: no lifts, no overrides, no adjustment. */
  toBaseline: () => void;

  /** True while Apply's own write is in flight. Scoped to Apply (Pattern 47f). */
  applyPending: boolean;
  /** True while Return-to-baseline's own write is in flight. Its own scope. */
  baselinePending: boolean;
  /**
   * Why the last commit did not happen, in the operator's words.
   *
   * Surfaced rather than logged. A failed Apply that says nothing leaves chips
   * on screen that look pending when they are in fact refused.
   */
  commitError: string | null;
  /** False when the quote is not a draft: nothing here may be committed. */
  committable: boolean;
  /**
   * The cost base the current staged set was evaluated against, or null when
   * nothing is staged.
   *
   * Exposed so a surface can say WHICH decision is at risk rather than only
   * that one is. Nothing reads it today; the guard that uses it does not need
   * a consumer to be correct.
   */
  stagedAgainstCostBase: string | null;

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
  quoteId,
  initialGlobalAdj,
  committable = true,
  children,
}: {
  quoteId: string;
  initialGlobalAdj: number;
  /** Draft-only. The action refuses a sent quote too; this stops the offer. */
  committable?: boolean;
  children: ReactNode;
}) {
  const storeApi = useCostingStoreApi();
  // Two transitions, not one. Pattern 47(f): a control may be disabled only by
  // the pending state of the action IT initiates. Sharing one flag would make
  // Return to baseline dead while an Apply is in flight, and the operator would
  // have nothing on screen explaining why.
  const [applyPending, startApply] = useTransition();
  const [baselinePending, startBaseline] = useTransition();
  const [commitError, setCommitError] = useState<string | null>(null);

  /**
   * The computed baseline: every lever at rest.
   *
   * `toBaseline` returns here in one act, which is only safe because every
   * adjustment is an additive layer over a base that does not move. H6 asserts
   * the return is EXACT — not close, the same float — and it can be exact
   * precisely because removing a layer is not an operation on the base.
   */
  const baseline: PricingSet = useMemo(
    () => ({ lifts: {}, overrides: {}, tierAdj: {}, globalAdj: 0 }),
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
   * Lifts need no translation on the way in. `quote_leaf_lifts` keys on the
   * canonical attachment, which is the identity a staging key already carries —
   * the one sparse table for which the persisted row and the staging address
   * are the same thing. Overrides key on the legacy junction and so must cross.
   *
   * Per-tier adjustments are seeded here too, and a mount-time seed is now the
   * RIGHT reading of them rather than a stale one: nothing writes
   * `quote_tiers.tier_price_adj_pct` behind this layer's back any more. That
   * was the whole of P3-016 — a lever the set did not carry, written by a CTA
   * at click time, which the operator could neither preview nor discard.
   */
  const initial: PricingSet = useMemo(() => {
    const state = storeApi.getState();
    return seedCommittedSet({
      lifts: state.lifts,
      cellOverrides: state.cellOverrides,
      skus: state.skus,
      tierAdj: state.tiers.map((t) => ({
        tierId: t.id,
        adjPct: t.tierPriceAdjPct,
      })),
      globalAdj: initialGlobalAdj,
    });
    // Mount-time only, deliberately — see above. `storeApi` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGlobalAdj, storeApi]);

  const [committed, setCommitted] = useState<PricingSet>(initial);
  const [working, setWorking] = useState<PricingSet>(initial);

  const changes = useMemo(() => diffSets(committed, working), [committed, working]);

  /**
   * R12 load-bearing 22 — the cost base the staged decision was evaluated
   * against.
   *
   * Captured when staging BEGINS and held until the working set is empty
   * again. §7: the levers on this page belong to the PM; the cost base under
   * them does not. A PM stages three lifts, Logistics updates a freight leg,
   * the PM applies — against which costs? The staged figures came from a
   * snapshot, and committing against a different one commits a decision
   * nobody made.
   *
   * A ref, not state: reading it must not re-render, and writing it must not
   * schedule one. It is a note about when, not a thing on screen.
   */
  const stagedAgainst = useRef<string | null>(null);
  if (changes.length === 0) stagedAgainst.current = null;
  else if (stagedAgainst.current === null) {
    stagedAgainst.current = costBaseFingerprint(
      buildCostingInput(storeApi.getState()),
    );
  }

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

  const stageTierAdj = useCallback((tierId: string, pct: number | null) => {
    setWorking((w) => {
      const tierAdj = { ...w.tierAdj };
      if (pct === null) delete tierAdj[tierId];
      else tierAdj[tierId] = pct;
      return { ...w, tierAdj };
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
        if (change.kind.startsWith("tier-adj")) {
          const tierAdj = { ...w.tierAdj };
          const committedValue = committed.tierAdj[change.key];
          if (committedValue === undefined) delete tierAdj[change.key];
          else tierAdj[change.key] = committedValue;
          return { ...w, tierAdj };
        }
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

  const reset = useCallback(() => {
    setWorking(committed);
    setCommitted((c) => c);
    setCommitError(null);
  }, [committed]);

  /**
   * Write a whole intended set, and move `committed` only if the write took.
   *
   * The set is sent COMPLETE rather than as a delta: an absent cell is a
   * removal, and a delta-shaped call has no way to say that a thing is gone.
   * Removal is the change an operator most needs to survive a reload, so it is
   * the one the wire shape has to be able to express.
   */
  const commit = useCallback(
    (next: PricingSet, intent: "apply" | "baseline", start: typeof startApply) => {
      if (!committable) {
        setCommitError("This quote is no longer a draft, so pricing cannot be changed.");
        return;
      }
      // The guard, at the moment of acting. `intent === "baseline"` removes
      // every lever and is therefore safe against any base — there is no
      // staged figure to be committed against the wrong numbers, and refusing
      // it would strand an operator with adjustments they had decided to drop.
      if (intent === "apply" && stagedAgainst.current !== null) {
        const now = costBaseFingerprint(buildCostingInput(storeApi.getState()));
        if (now !== stagedAgainst.current) {
          // Same wording as the server's COSTS_STALE refusal. The two guards
          // compare different reads on purpose — the client sees what has
          // reconciled into this tab, the server reads fresh — so an operator
          // can meet either. Meeting the same sentence twice reads as one
          // condition; meeting two different sentences reads as two problems.
          setCommitError(staleMessage({ stale: true, kind: "economic_basis" }));
          return;
        }
      }
      setCommitError(null);
      start(async () => {
        const result = await applyPricingAdjustments({
          quoteId,
          lifts: Object.entries(next.lifts).map(([key, liftPct]) => ({
            ...parseCellKey(key),
            liftPct,
          })),
          overrides: Object.entries(next.overrides).map(([key, sellPrice]) => ({
            ...parseCellKey(key),
            sellPrice,
          })),
          // From the SET, like every other lever. It used to be read live from
          // the store, because a CTA outside this layer wrote it at click time
          // and a set-derived value would have reverted it. That CTA stages
          // now, so the set is authoritative — and being authoritative is what
          // lets a per-tier adjustment be previewed, discarded and removed.
          // `baseline` carries none, so Return to baseline still clears them.
          tierAdjustments: Object.entries(next.tierAdj).map(([tierId, adjPct]) => ({
            tierId,
            adjPct,
          })),
          globalAdjPct: next.globalAdj,
          // STALENESS. What the client believed was COMMITTED when it staged —
          // the server refuses if a lever moved since. `committed` is exactly
          // that belief, kept in step with the server by the same repair that
          // stopped it drifting after a clearing Apply.
          authorityBaseline: pricingAuthorityBaseline({
            globalAdj: String(committed.globalAdj),
            tierAdj: new Map(
              Object.entries(committed.tierAdj).map(([k, v]) => [k, String(v)]),
            ),
            lifts: new Map(
              Object.entries(committed.lifts).map(([k, v]) => [k, String(v)]),
            ),
            overrides: new Map(
              Object.entries(committed.overrides).map(([k, v]) => [k, String(v)]),
            ),
          }),
          // The economic basis this decision was STAGED against — the same
          // fingerprint the client-side guard above compares, now sent so the
          // server can enforce it too. The client can only see costs that have
          // reconciled into this tab; the server reads them fresh.
          economicFingerprint: stagedAgainst.current,
          intent,
        });
        if (!result.ok) {
          // Committed does not move. The chips stay, the operator can read what
          // went wrong, and nothing on screen claims a state the quote is not in.
          setCommitError(result.error.message);
          return;
        }
        // ADOPT THE SERVER'S RESULTING STATE, do not assume the request was it.
        //
        // This set both to `next` — what the client SENT. Fine while every write
        // was something the client asked for; wrong the moment a global Apply
        // began clearing tier overrides the client never mentioned. The client
        // kept believing those rows existed, resent them next Apply against an
        // empty quote, the server wrote them back as `null -> 0.0000`, and the
        // sweep cleared them again — a strict alternation where every second
        // Apply suppressed the global with explicit zeros.
        //
        // The entered percentage was never involved. 11% and 101% landed on the
        // failing phase and 12% and 50% on the passing one, which is what made
        // it read as a value problem.
        const serverTierAdj: Record<string, number> = {};
        for (const t of result.data.tierAdjustments) serverTierAdj[t.tierId] = t.adjPct;
        const reconciled: PricingSet = {
          ...next,
          tierAdj: serverTierAdj,
          globalAdj: result.data.globalAdjPct,
        };
        setCommitted(reconciled);
        setWorking(reconciled);
      });
    },
    // `committed` IS a dependency, and leaving it out was a live defect.
    //
    // Before the stale guard, this callback read only `next`, `quoteId` and the
    // store, so the list was complete. Adding the authority baseline made it
    // read `committed` too — and the memo kept handing the server the value
    // from whichever render created the callback. After a successful apply the
    // component's `committed` advanced while the closure's did not, so the next
    // Apply sent a baseline that was two states old and the server refused a
    // mismatch that existed nowhere but in the closure.
    //
    // A guard that falsely refuses is worse than no guard: it teaches operators
    // to distrust the one refusal that matters.
    [committable, committed, quoteId, storeApi],
  );

  const apply = useCallback(
    () => commit(working, "apply", startApply),
    [commit, working],
  );
  const toBaseline = useCallback(
    () => commit(baseline, "baseline", startBaseline),
    [baseline, commit],
  );

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
      // The fourth lever, resolved the same way as the others: the working set
      // is the COMPLETE intended state, so a tier absent from it has no
      // adjustment of its own and falls back to the quote-wide one. Rebuilding
      // from the committed rows and layering staged values over them would
      // make a staged REMOVAL invisible in the preview — the chip would say
      // the adjustment was gone while the figures still carried it.
      tiers: base.tiers.map((t) => ({
        ...t,
        tierPriceAdjPct: working.tierAdj[t.id] ?? null,
      })),
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

  /**
   * How many adjustments the QUOTE carries — all four levers, all read from
   * the committed set.
   *
   * The per-tier component used to be subscribed to the store instead, because
   * it was written outside this layer and a seed would have gone stale the
   * moment a CTA wrote one. Nothing writes it from outside now, so the
   * committed set is both correct and the same source as the other three —
   * and a count assembled from two sources is a count that can disagree with
   * itself.
   */
  const appliedCount =
    Object.keys(committed.lifts).length +
    Object.keys(committed.overrides).length +
    Object.keys(committed.tierAdj).length +
    (Math.abs(committed.globalAdj - baseline.globalAdj) > ADJ_EPSILON ? 1 : 0);

  const value: PricingStagingValue = {
    committed,
    working,
    changes,
    isStaged: changes.length > 0,
    appliedCount,
    stageLift,
    stageOverride,
    stageTierAdj,
    stageGlobalAdj,
    unstage,
    reset,
    apply,
    toBaseline,
    applyPending,
    baselinePending,
    commitError,
    committable,
    stagedAgainstCostBase: stagedAgainst.current,
    previewResult,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
