"use client";

import { createContext, useContext, useMemo } from "react";

import type { ApprovalTierState } from "@/lib/below-floor-approval-state";
import {
  evaluateProgression,
  type ProgressionTier,
  type ProgressionVerdict,
} from "@/lib/pricing-progression";
import { usePricingClassifier } from "./pricing-classifier-context";

/**
 * One progression verdict, for the whole surface.
 *
 * ── WHY A THIRD CONTEXT ──────────────────────────────────────────────────
 *
 * Progression needs both halves and belongs to neither. Compliance is LIVE —
 * the classifier recomputes from the costing store on every reconcile, so a
 * lift clears the floor on the same frame. Approval is SERVER state loaded with
 * the page and refreshed when a request is raised or decided.
 *
 * Folding it into the classifier would make a pure function of commercial
 * inputs own a workflow it has no business querying — the reason
 * `below-floor-approval-state.ts` gives for staying out of it, which applies
 * identically here. Computing it on the server instead would freeze it: it
 * would stop reflecting a lift the operator just applied until the next
 * refresh, which is precisely the staleness this slice exists to remove.
 *
 * So: live compliance from the classifier, server approval by prop, one
 * evaluation, two consumers — the banner and the decision panel. Neither
 * derives its own answer, which is what stops them disagreeing.
 */

const Ctx = createContext<ProgressionVerdict | null>(null);

export function PricingProgressionProvider({
  approvalStates,
  tiers: tierMeta,
  children,
}: {
  /** Keyed by tier UUID, as loaded by the page. */
  approvalStates: Record<string, ApprovalTierState>;
  /**
   * Tier identity and label, by UUID. Supplied rather than read from the
   * classifier because the classifier speaks numeric ids and carries no label —
   * and a component inventing one would put a name in a refusal that matches
   * nothing on screen.
   */
  tiers: ReadonlyArray<{ id: string; label: string }>;
  children: React.ReactNode;
}) {
  const { state, idMap } = usePricingClassifier();

  const verdict = useMemo<ProgressionVerdict>(() => {
    const labelByUuid = new Map(tierMeta.map((t) => [t.id, t.label]));
    const tiers: ProgressionTier[] = [];
    for (const t of state.tiers) {
      const uuid = idMap.numericToUuid.get(t.id);
      // NEVER guess an identity the map does not carry. A tier we cannot key
      // to its approval is omitted rather than defaulted, and omitting it can
      // only make the verdict more permissive in one direction — so the
      // classifier's own blocked mode still governs what the panel says, and
      // the SEND gate re-decides from the database regardless.
      if (!uuid) continue;
      tiers.push({
        tierId: uuid,
        label: labelByUuid.get(uuid) ?? `Tier ${t.id}`,
        // The GATE's basis. `t.status` is the worst cell's band and answers a
        // different question; using it here is the Pattern 50 defect this
        // module exists to close.
        blendedStatus: toBlendedStatus(t.blended_status, t.blended_margin_pct),
      });
    }

    return evaluateProgression({
      tiers,
      approvalByTier: approvalStates,
      unknownCellCount: state.cells.filter((c) => c.missing).length,
    });
  }, [state, idMap, approvalStates, tierMeta]);

  return <Ctx.Provider value={verdict}>{children}</Ctx.Provider>;
}

export function usePricingProgression(): ProgressionVerdict {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "usePricingProgression must be used inside <PricingProgressionProvider>",
    );
  }
  return v;
}

/**
 * The classifier's tier band → the engine's status vocabulary.
 *
 * The classifier collapses "unpriced" into `unknown`, which the engine splits
 * into `UNAVAILABLE` and `COST_WITHOUT_REVENUE`. Progression treats both the
 * same way — neither is a floor breach — so the distinction is not
 * reconstructed here; a guess between them would be a fact this layer does not
 * have. It reports `UNAVAILABLE`, and `unknownCellCount` is what actually
 * carries the readiness block.
 */
function toBlendedStatus(
  band: "above_target" | "below_target" | "below_floor" | "unknown",
  marginPct: number | null,
): ProgressionTier["blendedStatus"] {
  if (band === "below_floor") return "BELOW_FLOOR";
  if (band === "below_target") return "BELOW_TARGET";
  if (band === "above_target") return "GOOD";
  return marginPct === null ? "UNAVAILABLE" : "GOOD";
}
