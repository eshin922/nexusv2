"use client";

// slice-pricing-surface-redesign Step 7 — page composer + recompute
// pipeline + mode-transition flash + 30s persistent hint.
//
// **Patch round 2 (CB Step 9 re-walk, 2026-06-16):** classifier was
// lifted to the page-level `<PricingClassifierProvider>` so both
// the head and the composer consume the SAME classifier output.
// What used to live here (adapter + classify call + store
// subscriptions) now lives in `pricing-classifier-context.tsx`.
// Composer is now a thin consumer of `usePricingClassifier()`.
//
// What this composer still owns:
//   - STATE / ACTION / DETAIL zone mount predicates per state.mode
//     (CD designer notes §2.1 single-responsibility — composer
//     decides what mounts; zone components don't gate on mode)
//   - Mode-transition flash via `previousModeRef` + 30s timer
//     (rendering chrome, not classifier responsibility)
//   - Recommendation handlers, which STAGE into the working set
//     (P3-016 — they used to write at click time), read-only bulk
//     preview, and receipt-based exact bulk Undo
//   - Local UI state: applyError, justUpdatedAt
//
// Apply-delta + apply-to resolution: the classifier QuoteState's
// `state.quote.suggestions.surgical.lift_pct` IS the applyDelta
// from rankPricingSuggestions (set by the adapter inside the
// provider). For global lifts, `buildGlobal`'s applyTo is always
// the full tier set per the engine implementation
// (`rollup.map(t => t.tierId)`), so the composer derives applyTo
// from `idMap.numericToUuid.values()` rather than re-invoking the
// engine. One classify, one engine call per render.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Mode } from "@/lib/pricing-classifier";
import {
  applyGlobalAdj,
  previewGlobalAdj,
  undoGlobalAdj,
} from "@/app/actions/pricing-apply";
import { requestBelowFloorApproval } from "@/app/actions/below-floor-approval-request";
import {
  mayRequestApproval,
  type ApprovalTierState,
} from "@/lib/below-floor-approval-state";
import { composePricingAdjustment } from "@/lib/pricing-adjustment";
import type { GlobalPricingPreview } from "@/lib/pricing-lift";
import {
  ActionCard,
  AcceptRiskBanner,
  SendableSummary,
  SuggestionCard,
} from "./action-zone";
import { StateCallout, StateCard, StateLine } from "./state-zone";
import {
  DetailZone,
  type BlendedTierComponents,
  type TracedStackCell,
} from "./detail-zone";
import { usePricingClassifier } from "./pricing-classifier-context";
import { ComplianceGrid } from "./compliance-grid";
import { PricingTrace } from "./pricing-trace";
import { useProvenantNodes } from "./pricing-provenance-context";
import { StagingBar } from "./staging-bar";
import { RequestOverrideModal } from "./request-override-modal";
import { ApprovalStateCard } from "./approval-state-card";
import { StagedDelta, StagedMarginDelta } from "./staged-delta";
import { usePricingStaging } from "./pricing-staging-context";
import { parseCellKey, type CellRef } from "@/lib/pricing-staging";
import { useCostingStore } from "@/components/costing-store-provider";
import { selectGraph, selectSkuRollups } from "@/lib/costing-store";
import { readNodeValue, quoteScopeKey } from "@/lib/costing-nodes";

// 30s persistent "↻ just updated" hint after a mode transition. CD
// §4.6 / §9.2 pushback 2. Restart on each subsequent transition.
const JUST_UPDATED_MS = 30_000;

export interface PricingSurfaceShellProps {
  projectId: string;
  quoteId: string;
  /**
   * Tier display metadata, resolved at the page boundary and keyed by the tier
   * UUID — the real identity, not the classifier's numeric id.
   *
   * The page cannot key it numerically: the numeric ids are the classifier's
   * own, minted inside the provider, and reconstructing them server-side would
   * be an identity derivation with no authority behind it. So the page supplies
   * label + ★ against the UUID, and the join to numeric happens here, through
   * `idMap` — the map that already owns that correspondence.
   */
  tiers: ReadonlyArray<{ id: string; label: string; recommended: boolean }>;
  /**
   * Workflow state, projected server-side and composed here. Deliberately NOT
   * classifier output — the classifier is a pure function of commercial inputs
   * and must not own asynchronous approval persistence.
   */
  approvalStates: Record<string, ApprovalTierState>;
}

export function PricingSurfaceShell({
  projectId: _projectId,
  quoteId,
  tiers,
  approvalStates,
}: PricingSurfaceShellProps) {
  // Single source of truth — `state` is the classifier output,
  // identical to what `<PricingPageHead>` consumes.
  const { state, idMap } = usePricingClassifier();
  const { uuidToNumeric, numericToUuid } = idMap;
  const router = useRouter();

  // Mode-transition flash + 30s persistent hint ─────────────────
  const previousModeRef = useRef<Mode | null>(null);
  const justUpdatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [justUpdatedAt, setJustUpdatedAt] = useState<number | null>(null);

  // Below-floor approval request — modal, in-flight, error.
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    const prev = previousModeRef.current;
    previousModeRef.current = state.mode;
    if (prev !== null && prev !== state.mode) {
      // Mode transition — fire the persistent hint. Restart timer
      // if another transition fires within the 30s window
      // (most-recent transition's hint is the visible one).
      if (justUpdatedTimerRef.current) {
        clearTimeout(justUpdatedTimerRef.current);
      }
      setJustUpdatedAt(Date.now());
      justUpdatedTimerRef.current = setTimeout(() => {
        setJustUpdatedAt(null);
        justUpdatedTimerRef.current = null;
      }, JUST_UPDATED_MS);
    }
  }, [state.mode]);

  useEffect(() => {
    return () => {
      if (justUpdatedTimerRef.current) {
        clearTimeout(justUpdatedTimerRef.current);
      }
    };
  }, []);

  const justUpdated = justUpdatedAt !== null;

  // Apply-path handlers ─────────────────────────────────────────
  //
  // Read here rather than further down because the recommendation handlers
  // below stage into this set. They are the surface's operator pricing levers,
  // and every one of them now goes through the same door.
  const { stageTierAdj, committed, working, previewResult } = usePricingStaging();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [globalPreview, setGlobalPreview] =
    useState<GlobalPricingPreview | null>(null);
  const [bulkAuditId, setBulkAuditId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [pricingConfirmation, setPricingConfirmation] =
    useState<string | null>(null);

  /**
   * A recommendation STAGES. It does not write.
   *
   * P3-016: both CTAs used to call an immediate-write action at click time.
   * The write landed, with its audit row, and produced no chip, no preview and
   * no Discard — so the operator saw the below-floor headline they had just
   * acted on still standing, and the button they had pressed gone. A committed
   * pricing change presenting as a no-op.
   *
   * The recommendation is a solver output, and this is the whole of what
   * happens to it: it enters the working set. `composePricingAdjustment` is
   * the surface's one composition rule — the same one the bulk-lift preview
   * uses — so no arithmetic is invented here, and the page-level Apply owns
   * persistence for these levers exactly as it does for lifts and overrides.
   */
  function onApply(kind: "apply_surgical" | "apply_global") {
    setApplyError(null);
    const sugg = state.quote.suggestions ?? {};

    /**
     * What the tier carries on the COMMITTED set — its own value, or the
     * quote-wide fallback.
     *
     * Committed, not working, and the distinction is load-bearing. The
     * classifier computes this recommendation from committed state: after
     * staging, the compliance grid, the blocked count and the suggestion all
     * still describe the quote as it is persisted. So `lift_pct` is a lift
     * measured from committed — and composing it onto a working value that
     * already contains it applies it twice.
     *
     * That is not hypothetical. It is what put `0.4123` on a production quote:
     * two presses 727ms apart, each composing onto the result of the last,
     * `1.1884² − 1`. Reading committed makes a repeat press IDEMPOTENT — the
     * second stages the same value as the first, so the chip does not move and
     * nothing compounds.
     *
     * Pattern 50: two subsystems answering the same question from different
     * bases. The fix is to use the basis the recommendation was computed from.
     */
    const effectiveAdj = (tierUuid: string) =>
      committed.tierAdj[tierUuid] ?? committed.globalAdj;

    if (kind === "apply_surgical") {
      // FAIL LOUDLY. A rendered surgical CTA with no surgical suggestion used
      // to fall through two guarded branches to a silent return — the operator
      // pressed a recommended action and nothing happened, anywhere, with no
      // account of why. If this state is reachable the operator finds out.
      if (!sugg.surgical) {
        setApplyError(
          "This surgical recommendation is no longer available — the quote has changed since it was offered. Reload to see the current recommendation.",
        );
        return;
      }
      const targetTierUuid = idMap.numericToUuid.get(sugg.surgical.tier_id);
      if (!targetTierUuid) {
        setApplyError("Surgical lift target tier not found");
        return;
      }
      stageTierAdj(
        targetTierUuid,
        composePricingAdjustment(effectiveAdj(targetTierUuid), sugg.surgical.lift_pct),
      );
      return;
    }

    if (!sugg.global) {
      setApplyError(
        "This global recommendation is no longer available — the quote has changed since it was offered. Reload to see the current recommendation.",
      );
      return;
    }
    // `buildGlobal` always returns `applyTo: rollup.map(t => t.tierId)` — all
    // tiers in the rollup. Derived from the idMap to avoid re-invoking the
    // suggestion engine. Each tier composes against its OWN current value, so
    // a tier already carrying an adjustment is lifted from where it stands
    // rather than being flattened to a shared figure.
    for (const tierUuid of idMap.numericToUuid.values()) {
      stageTierAdj(
        tierUuid,
        composePricingAdjustment(effectiveAdj(tierUuid), sugg.global.lift_pct),
      );
    }
  }

  function onActivate(
    kind:
      | "preview_pdf"
      | "apply_surgical"
      | "apply_global"
      | "request_override"
      | "override_unavailable"
      | "tighten_to_target"
      | "calculating_suggestion"
      | "suggestion_infeasible"
      | "suggestion_manual_only",
  ) {
    if (kind === "apply_surgical" || kind === "apply_global") {
      onApply(kind);
      return;
    }
    // The existing Request action, connected to the existing lifecycle.
    // Eligibility is decided upstream: the classifier emits this kind only in
    // the below-floor branch and only when `policy.allow_override`. Nothing
    // here re-decides that.
    if (kind === "request_override") {
      setRequestError(null);
      setRequestOpen(true);
      return;
    }
    // preview_pdf ActionCard was removed from the shell render per
    // Edward's disposition (redundant with the YourNextMoveBanner
    // that already surfaces "Preview quote PDF →" in sendable
    // mode). The kind is retained in the enum for banner lookup
    // (recommendedOrPrimary in pricing-page-head.tsx picks
    // preview_pdf as primary → banner label) but never reaches
    // this handler because the shell filter drops it.
    // tighten_to_target — still a no-op placeholder; that automation is
    // banked v1.1+. override_unavailable +
    // calculating_suggestion + suggestion_infeasible +
    // suggestion_manual_only are inert kinds (ActionCard renders
    // no CTA button for them; this branch is unreachable but kept
    // for closed-enum exhaustiveness).
  }

  // PB-004: Preview is read-only. Apply is the only mutation boundary.
  // The server recomputes the projection with canonical costing math.
  async function onPreviewGlobalAdjust(liftPct: number) {
    setApplyError(null);
    setPricingConfirmation(null);
    setBulkPending(true);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("applyDelta", String(liftPct / 100));
    const r = await previewGlobalAdj(fd);
    setBulkPending(false);
    if (!r.ok) setApplyError(r.error.message);
    else setGlobalPreview(r.data);
  }

  async function onApplyGlobalPreview() {
    if (!globalPreview) return;
    setApplyError(null);
    setBulkPending(true);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("applyTo", globalPreview.tiers.map((tier) => tier.tierId).join(","));
    fd.set("applyDelta", String(globalPreview.applyDelta));
    fd.set("optionRecommended", "false");
    fd.set("expectedPreview", JSON.stringify(globalPreview.tiers.map((tier) => ({
      tierId: tier.tierId,
      priorPersistedAdjustment: tier.priorPersistedAdjustment,
      resultingAdjustment: tier.resultingAdjustment,
    }))));
    const r = await applyGlobalAdj(fd);
    setBulkPending(false);
    if (!r.ok) {
      setApplyError(r.error.message);
      return;
    }
    setBulkAuditId(r.data.auditId);
    setGlobalPreview(null);
    setPricingConfirmation("Pricing updated.");
  }

  async function onUndoGlobalAdjust() {
    if (!bulkAuditId) return;
    setApplyError(null);
    setBulkPending(true);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("auditId", bulkAuditId);
    const r = await undoGlobalAdj(fd);
    setBulkPending(false);
    if (!r.ok) {
      setApplyError(r.error.message);
      return;
    }
    setBulkAuditId(null);
    setPricingConfirmation("Pricing restored.");
  }

  // Per-mode mount — single-responsibility zones; composer decides
  // what's visible per state.mode (CD §2.1).
  // Gate 1B increment 7 — canonical blended values for the Cost Stack,
  // resolved HERE and passed down as data.
  //
  // Resolution goes through the graph traversal API. The component blends are
  // nested operands of `sell-before`, not roots — a node cannot be both
  // without double-counting under reconciliation — so a root-only
  // `graph.nodes.find(...)` returns nothing for every tier. That is not a
  // hypothetical: it is what shipped a Cost Stack that rendered every tier
  // incomplete.
  //
  // `resolveNode` fails closed on BOTH missing and duplicate matches, and a
  // tier missing any one of its governed values is omitted from the map
  // entirely rather than partially filled. Half a stack read from the graph and
  // half invented is the exact failure this increment exists to remove.
  const graph = useCostingStore(selectGraph);
  const blendedByTier = useMemo(() => {
    const byNumeric = new Map<number, BlendedTierComponents>();
    for (const [tierUuid, numeric] of uuidToNumeric) {
      // `readNodeValue` also fails closed on a flagged-out node, which
      // `node ? node.value : null` did not. No blend key carries one today, so
      // this changes no rendered value — it removes the trap where adding one
      // later would surface a commercial zero here instead of a dash.
      const read = (name: string): number | null =>
        readNodeValue(graph, quoteScopeKey(tierUuid, name));
      const pkg = read("pkg");
      const prod = read("prod");
      const raw = read("raw");
      const frt = read("frt");
      const dt = read("dt");
      const sellBefore = read("sell-before");
      const sell = read("sell");
      const cost = read("cost");
      // P3-017 — the levers BETWEEN the first level and the last. The blend
      // used to publish only its ends, so the ladder the Cost Stack renders was
      // unstateable at this scope and the reconciliation could not be asserted
      // against anything. These five are read, never derived: a delta obtained
      // by subtracting two published levels telescopes through the aggregation
      // and yields an identity true for any four numbers.
      const adjDelta = read("adj-delta");
      const sellAfterAdj = read("sell-after-adj");
      const liftDelta = read("lift-delta");
      const sellAfterLift = read("sell-after-lift");
      const overrideDelta = read("override-delta");
      if (
        pkg === null || prod === null || raw === null || frt === null ||
        dt === null || sellBefore === null || sell === null || cost === null ||
        adjDelta === null || sellAfterAdj === null || liftDelta === null ||
        sellAfterLift === null || overrideDelta === null
      ) {
        continue;
      }
      // OPTIONAL, unlike the six above: the ratio is undefined at zero blended
      // sell, the engine flags that node out rather than publishing 0%, and
      // `readNodeValue` refuses it. Requiring it would blank a complete cost
      // stack to withhold a seventh value that does not exist.
      const margin = readNodeValue(graph, quoteScopeKey(tierUuid, "margin"));
      byNumeric.set(numeric, {
        pkg, prod, raw, frt, dt, sellBefore, sell, cost, margin,
        adjDelta, sellAfterAdj, liftDelta, sellAfterLift, overrideDelta,
        // The same keys the values were just read from, carried down so the
        // trace opens at the node the operator pressed rather than at one
        // reconstructed from a numeric id the graph has never heard of.
        keys: {
          pkg: quoteScopeKey(tierUuid, "pkg"),
          prod: quoteScopeKey(tierUuid, "prod"),
          raw: quoteScopeKey(tierUuid, "raw"),
          frt: quoteScopeKey(tierUuid, "frt"),
          dt: quoteScopeKey(tierUuid, "dt"),
          sellBefore: quoteScopeKey(tierUuid, "sell-before"),
          sell: quoteScopeKey(tierUuid, "sell"),
          cost: quoteScopeKey(tierUuid, "cost"),
          margin: quoteScopeKey(tierUuid, "margin"),
          adjDelta: quoteScopeKey(tierUuid, "adj-delta"),
          sellAfterAdj: quoteScopeKey(tierUuid, "sell-after-adj"),
          liftDelta: quoteScopeKey(tierUuid, "lift-delta"),
          sellAfterLift: quoteScopeKey(tierUuid, "sell-after-lift"),
          overrideDelta: quoteScopeKey(tierUuid, "override-delta"),
        },
      });
    }
    return byNumeric;
  }, [graph, uuidToNumeric]);

  // ── display metadata ────────────────────────────────────────────
  //
  // Both maps below are JOINS on identity that something else already owns:
  // `idMap` owns tier UUID ↔ numeric, and `skuRollups` owns the canonical
  // quote-leaf id alongside the product name. Neither invents a
  // correspondence, and neither guesses when one is absent.

  const tierMeta = useMemo(() => {
    const byNumeric = new Map<number, { label: string; recommended: boolean }>();
    for (const t of tiers) {
      const numeric = uuidToNumeric.get(t.id);
      // A tier the classifier does not carry is skipped, not defaulted. The
      // grid renders `T{id}` for a missing entry, which is at least honestly
      // unhelpful; a label attached to the wrong tier is not.
      if (numeric === undefined) continue;
      byNumeric.set(numeric, { label: t.label, recommended: t.recommended });
    }
    return byNumeric;
  }, [tiers, uuidToNumeric]);

  /**
   * The tier a request would authorize.
   *
   * `blended_status`, NOT `status`. The acceptance gate reads the tier's BLENDED
   * margin; `status` is the worst CELL's band and answers a different question.
   * Requesting against the worst-cell tier could seek authorization for a tier
   * the gate never blocks while leaving the blocking one unauthorized.
   *
   * Worst-first when several qualify, matching StateCard's existing convention.
   * An authorization covers ONE tier, so a quote with several blocking tiers
   * needs one request each — the modal names the tier so that is visible.
   */
  const requestTier = useMemo(() => {
    const blocking = state.tiers.filter((t) => t.blended_status === "below_floor");
    if (blocking.length === 0) return null;
    const worst = blocking.reduce((a, b) =>
      (b.blended_margin_pct ?? Infinity) < (a.blended_margin_pct ?? Infinity) ? b : a,
    );
    const uuid = numericToUuid.get(worst.id);
    if (!uuid) return null; // never guess an identity the map does not carry
    return {
      tierId: uuid,
      label: tierMeta.get(worst.id)?.label ?? `Tier ${worst.id}`,
      blendedMarginPct: worst.blended_margin_pct,
    };
  }, [state.tiers, numericToUuid, tierMeta]);

  const approvalState: ApprovalTierState = requestTier
    ? (approvalStates[requestTier.tierId] ?? { kind: "none" })
    : { kind: "none" };

  async function onSubmitOverrideRequest(justification: string) {
    if (!requestTier) return;
    setRequestError(null);
    setRequestPending(true);
    const r = await requestBelowFloorApproval({
      quoteId,
      tierId: requestTier.tierId,
      justification,
    });
    setRequestPending(false);
    // On failure: surface the message, keep the modal open, mutate NO pricing
    // state — nothing about the quote changed, so the classifier's view of it
    // must not change either.
    if (!r.ok) {
      setRequestError(r.error.message);
      return;
    }
    setRequestOpen(false);
    // The pending state is persisted, so a refresh shows it too. Re-reading the
    // server projection is what makes that true rather than a local flag.
    router.refresh();
  }

  // VERIFIED at mount time, and it is not the obvious field: the staging key's
  // SKU half is `canonicalQuoteLeafId`, which is a SEPARATE field from the
  // engine's `skuId` that the classifier's `state.skus[].id` carries. Keying
  // this on the classifier id matches nothing, and every chip would fall back
  // to two raw UUIDs in the one place the operator looks before committing.
  const skuRollups = useCostingStore(selectSkuRollups);
  const cellLabel = useMemo(() => {
    const nameByQuoteLeafId = new Map<string, string>();
    for (const sr of skuRollups) {
      if (sr.canonicalQuoteLeafId) {
        nameByQuoteLeafId.set(sr.canonicalQuoteLeafId, sr.productName);
      }
    }
    const labelByTierUuid = new Map<string, string>();
    for (const t of tiers) labelByTierUuid.set(t.id, t.label);

    return (cellKey: string): string => {
      const { quoteLeafId, tierId } = parseCellKey(cellKey);
      const name = nameByQuoteLeafId.get(quoteLeafId);
      const tierLabel = labelByTierUuid.get(tierId);
      // FAIL CLOSED. Either half unresolved and the operator sees the raw key.
      // Ugly, and recoverable. A chip naming the wrong SKU beside a price
      // change is neither.
      if (name === undefined || tierLabel === undefined) return cellKey;
      return `${name} · ${tierLabel}`;
    };
  }, [skuRollups, tiers]);

  /**
   * The same fail-closed contract as `cellLabel`, for the tier a per-tier
   * adjustment chip names. An unresolved tier shows its raw id rather than a
   * blank — ugly and recoverable, where a chip naming the wrong tier beside an
   * adjustment about to be committed is neither.
   */
  const tierLabel = useMemo(() => {
    const byId = new Map(tiers.map((t) => [t.id, t.label]));
    return (tierId: string): string => byId.get(tierId) ?? tierId;
  }, [tiers]);

  /**
   * Classifier ids → the canonical staging address.
   *
   * The same two-sided join the labeller does, in the same place and for the
   * same reason. `sr.skuId` is what the classifier carries as `sku.id`;
   * `sr.canonicalQuoteLeafId` is what a staged change is keyed on. They are
   * different fields on the same rollup, and only the second one addresses a
   * commercial attachment.
   *
   * Fails closed on either half. A null return makes `CellAction` refuse to
   * stage; the alternative is a price change on whichever line the wrong id
   * happens to hit.
   */
  /**
   * WHICH TIERS CARRY A LEVER — from the governed WORKING set.
   *
   * B-2. This used to be derived inside the Cost Stack from
   * `state.cells[].lift_applied_pct`, which is the CLASSIFIER, which describes
   * COMMITTED state. The Design Authority keys the same rows on `rollups`,
   * computed from the WORKING set — so canonically the `Surgical lifts` row
   * appears the moment a lift is STAGED, and in the shipped build it appeared
   * only once one was applied. On a quote with no committed lifts it never
   * appeared at all, and a staged lift moved `Quoted sell` with no row
   * accounting for it. R11 §4 marks that contract load-bearing: every lever
   * that can change a quoted price owes the cost stack a row.
   *
   * UNION, not replacement. `working` is the complete intended set and is the
   * right basis, but the staging model documents one case it cannot carry:
   * persisted overrides whose identity does not translate to a staging key
   * "pass through unchanged — they are real and in effect". Keying purely on
   * `working` would drop the row for those. Existence is monotone, so a lever
   * shown when either source knows about it is correct in both directions; a
   * union cannot lose a row, which is the whole property under repair.
   *
   * CONTRIBUTION IS NOT SOURCED HERE. Only existence. What each lever moved is
   * read from its governed node in `blendedByTier`, so a refused lift still
   * gets its row and renders the zero the graph actually holds — the
   * existence-over-delta rule, preserved rather than reasoned about twice.
   */
  const leversByTier = useMemo(() => {
    const byNumeric = new Map<number, { lifts: string[]; overrides: string[] }>();
    const nameByQuoteLeafId = new Map<string, string>();
    for (const sr of skuRollups) {
      if (sr.canonicalQuoteLeafId) {
        nameByQuoteLeafId.set(sr.canonicalQuoteLeafId, sr.productName);
      }
    }
    const slot = (numeric: number) => {
      let e = byNumeric.get(numeric);
      if (!e) {
        e = { lifts: [], overrides: [] };
        byNumeric.set(numeric, e);
      }
      return e;
    };
    const addStaged = (kind: "lifts" | "overrides", cellKey: string) => {
      const { quoteLeafId, tierId } = parseCellKey(cellKey);
      const numeric = uuidToNumeric.get(tierId);
      // Fail closed. A tier the classifier does not carry has no column to put
      // this in, and attaching it to the wrong one is worse than omitting it.
      if (numeric === undefined) return;
      const name = nameByQuoteLeafId.get(quoteLeafId) ?? quoteLeafId;
      const list = slot(numeric)[kind];
      if (!list.includes(name)) list.push(name);
    };
    for (const key of Object.keys(working.lifts)) addStaged("lifts", key);
    for (const key of Object.keys(working.overrides)) addStaged("overrides", key);
    // The committed half of the union — reaches persisted rows the staging keys
    // cannot name.
    for (const c of state.cells) {
      const name = c.sku_name;
      if (c.lift_applied_pct !== null) {
        const l = slot(c.tier_id).lifts;
        if (!l.includes(name)) l.push(name);
      }
      if (c.override_applied) {
        const o = slot(c.tier_id).overrides;
        if (!o.includes(name)) o.push(name);
      }
    }
    return byNumeric;
  }, [working, skuRollups, uuidToNumeric, state.cells]);

  const resolveCell = useCallback(
    (skuId: string, tierId: number): CellRef | null => {
      const sr = skuRollups.find((r) => r.skuId === skuId);
      const quoteLeafId = sr?.canonicalQuoteLeafId ?? null;
      const tierUuid = idMap.numericToUuid.get(tierId) ?? null;
      if (quoteLeafId === null || tierUuid === null) return null;
      return { quoteLeafId, tierId: tierUuid };
    },
    [skuRollups, idMap],
  );

  // ── staged state ────────────────────────────────────────────────
  //
  // The preview graph, and the roles are explicit at this one call site. The
  // readers refuse the wrong authority by construction — `readNodeValue`
  // returns null when a graph's own `evaluation` is not what the caller named
  // — so inverting these yields no deltas rather than plausible ones.
  const previewGraph = previewResult?.graph ?? null;

  const renderStackDelta = useCallback(
    (nodeKey: string) => (
      <StagedDelta
        committedGraph={graph}
        previewGraph={previewGraph}
        nodeKey={nodeKey}
      />
    ),
    [graph, previewGraph],
  );

  // The same join in points, for the margin row. Both graph roles are stated
  // once, here, for the same reason as above.
  const renderStackMarginDelta = useCallback(
    (nodeKey: string) => (
      <StagedMarginDelta
        committedGraph={graph}
        previewGraph={previewGraph}
        nodeKey={nodeKey}
      />
    ),
    [graph, previewGraph],
  );

  // ── entry-at-node ───────────────────────────────────────────────
  const [traced, setTraced] = useState<
    (TracedStackCell & { title: string }) | null
  >(null);

  const tracedTierId = traced?.tierId ?? null;
  const onTraceStackCell = useCallback(
    (nodeKey: string, title: string) => {
      // Which row the panel belongs beneath comes from the classifier's tier
      // list, matched on the key the cell was built from — not parsed out of
      // the key string.
      let tierId: number | null = null;
      for (const [numeric, blend] of blendedByTier) {
        if (Object.values(blend.keys).includes(nodeKey)) {
          tierId = numeric;
          break;
        }
      }
      if (tierId === null) return;
      setTraced((prev) =>
        prev?.nodeKey === nodeKey ? null : { tierId, nodeKey, title },
      );
    },
    [blendedByTier],
  );

  // A traced node whose tier has dropped out of the graph closes itself rather
  // than leaving a panel pinned beneath a row that no longer renders.
  useEffect(() => {
    if (tracedTierId !== null && !blendedByTier.has(tracedTierId)) {
      setTraced(null);
    }
  }, [blendedByTier, tracedTierId]);

  // A-2 · the trace reads the graph with attribution merged in. The merge is
  // per-node and returns the same object where nothing resolved, so an
  // unattributed graph is not copied and nothing re-renders for nothing.
  const provenantNodes = useProvenantNodes(graph?.nodes ?? []);
  const provenantGraph = useMemo(
    () => (graph ? { ...graph, nodes: provenantNodes } : graph),
    [graph, provenantNodes],
  );

  const renderStackTrace = useCallback(() => {
    if (!traced) return null;
    // `.r11-tracewrap` is the canonical vocabulary for "the trace as an
    // expansion inside a section", and carries the three R11 overrides of the
    // standalone R10 panel — no outer border, the depth badge dropped because
    // depth 0 is whatever was pressed, and the anchor bar released from
    // `position: sticky`. That last one is why the PRESSED ROW can pin: two
    // elements both sticking to top: 0 would overlay each other.
    return (
      <div className="r11-tracewrap">
        <PricingTrace
          graph={provenantGraph}
          nodeKey={traced.nodeKey}
          title={traced.title}
          onClose={() => setTraced(null)}
        />
      </div>
    );
  }, [provenantGraph, traced]);

  return (
    <section className="psr-section">
      {applyError && (
        <div
          role="alert"
          style={{
            marginBottom: 8,
            padding: 10,
            borderRadius: 8,
            background: "var(--bad-soft)",
            border: "1px solid var(--bad)",
            color: "var(--bad)",
            fontSize: 12,
          }}
        >
          {applyError}
        </div>
      )}

      {/*
        STAGING — at the top, where the canonical page puts it, and absent when
        there is nothing to say. Its own component decides which of the two
        bars renders; neither is a state this file computes.
      */}
      <StagingBar label={cellLabel} tierLabel={tierLabel} />

      {/* STATE — always visible. justUpdated chrome on mode transition. */}
      <StateLine state={state} justUpdated={justUpdated} />

      {state.mode === "suggestion_led" && <StateCallout state={state} />}
      {state.mode === "blocked" && <StateCard state={state} />}
      {/*
        R12 §8a — "What you're sending" is preserved in EVERY state, not only
        the sendable one. The tiles describe the quote's composition; a PM
        looking at a blocked verdict is exactly who needs to know its scope,
        recommended tier and order value. It renders after the verdict and
        before the corrective actions, as the prototype does.
      */}
      <SendableSummary state={state} />

      {/* ACTION — ranked actions per mode.
          CB Patch round 3 BUG-C disposition: in suggestion_led mode
          SuggestionCard IS the recommended-action presentation
          surface. ActionCard list filters out the recommended
          action so PMs see ONE ★ marker per render (the
          SuggestionCard's). Other modes pass through unfiltered.
          CB Patch round 3 BUG-D — `id` on the action zone container
          + suggestion-card wrapper anchors the YOUR NEXT MOVE
          banner's in-page navigation. */}
      {/* ActionCard render — filters:
          - `preview_pdf` kind is EXCLUDED everywhere; the top
            YourNextMoveBanner already surfaces "Preview quote PDF →"
            as its CTA in sendable mode (via classifier's primary
            action lookup). Duplicating it as a middle-page action
            card was confusing PMs. Kind stays in the classifier +
            enum for banner label wiring.
          - In `suggestion_led` mode, also drop the recommended
            action because SuggestionCard IS the recommended-action
            presentation surface (single ★ marker per render). */}
      <div id="psr-actions" className="psr-actions">
        {state.actions
          .filter((a) => a.kind !== "preview_pdf")
          .filter(
            (a) => state.mode !== "suggestion_led" || !a.recommended,
          )
          // A request that is open, approved or already decided must not keep
          // presenting an actionable Request card. Suppressed HERE rather than
          // in the classifier: eligibility is policy (classifier's job),
          // whether one is already in flight is workflow state (not its job).
          .filter(
            (a) => a.kind !== "request_override" || mayRequestApproval(approvalState),
          )
          .map((action) => (
            <ActionCard
              key={action.kind}
              action={action}
              onActivate={onActivate}
            />
          ))}
      </div>

      {state.mode === "suggestion_led" && (
        <div id="psr-suggestion-card">
          <SuggestionCard state={state} onApply={onApply} />
        </div>
      )}

      {state.flags.accept_risk_unavailable && <AcceptRiskBanner />}

      {/*
        COMPLIANCE — margin by cell, across every tier, always open.
        `targetPct` / `floorPct` are the classifier's own policy inputs,
        forwarded for the header caption. The grid never compares against
        them; it renders bands the classifier already decided.
      */}
      {/*
        R12 §8a — the sub-line that replaced `Show pricing detail`.
        Copy verbatim from `app/r12/pricing-page.jsx`. It states the two things
        the removed control used to imply and no longer can: that the detail is
        always open, and that any number can be asked why.
      */}
      <div className="r12-gridtop" style={{ marginTop: 16 }}>
        <p className="r10-sub" style={{ marginBottom: 10 }}>
          Pricing detail — compliance and composition across every tier, always
          open. Any number can say why it is what it is, and the trace opens
          where you pressed.
        </p>
        <ComplianceGrid
          targetPct={state.policy.target_margin_pct}
          floorPct={state.policy.floor_margin_pct}
          tierMeta={tierMeta}
          resolveCell={resolveCell}
        />
      </div>

      {/* DETAIL — always available; session-persisted open state.
          onPreviewGlobalAdjust forwards via DetailZone →
          DetailGlobalAdjust (CB Patch round 3 BUG-B wire). */}
      <DetailZone
        state={state}
        blendedByTier={blendedByTier}
        tierMeta={tierMeta}
        leversByTier={leversByTier}
        onPreviewGlobalAdjust={onPreviewGlobalAdjust}
        globalPreview={globalPreview}
        onCancelGlobalPreview={() => setGlobalPreview(null)}
        onApplyGlobalPreview={onApplyGlobalPreview}
        onUndoGlobalAdjust={onUndoGlobalAdjust}
        canUndoGlobalAdjust={bulkAuditId !== null}
        pricingMutationPending={bulkPending}
        pricingConfirmation={pricingConfirmation}
        onTraceStackCell={onTraceStackCell}
        tracedStackCell={traced}
        renderStackTrace={renderStackTrace}
        renderStackDelta={renderStackDelta}
        renderStackMarginDelta={renderStackMarginDelta}
      />

      {/* Workflow state, composed with — never folded into — classifier output. */}
      {requestTier && approvalState.kind !== "none" && (
        <ApprovalStateCard state={approvalState} tierLabel={requestTier.label} />
      )}

      {requestTier && (
        <RequestOverrideModal
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          onSubmit={onSubmitOverrideRequest}
          tierLabel={requestTier.label}
          blendedMarginPct={requestTier.blendedMarginPct}
          floorPct={state.policy.floor_margin_pct}
          pending={requestPending}
          error={requestError}
        />
      )}
    </section>
  );
}
