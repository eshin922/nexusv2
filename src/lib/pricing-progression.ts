/**
 * May this quote move forward to the Quote surface?
 *
 * ── WHY THIS IS NOT IN THE CLASSIFIER ────────────────────────────────────
 *
 * `classify()` is a pure function of commercial inputs: given costs, prices and
 * policy it says what the quote IS. Whether an approval exists is asynchronous
 * workflow state living in two other tables, which changes when nobody is
 * looking at the page. `below-floor-approval-state.ts` already refuses to fold
 * that into the classifier, for the same reason.
 *
 * So progression is a THIRD thing that composes the two, and it is pure for the
 * same reason the authorization core is: everything it needs arrives as an
 * argument, so every rule below is a unit test over a function rather than a
 * walk through two surfaces.
 *
 * ── THE BASIS IS THE GATE'S BASIS ────────────────────────────────────────
 *
 * Tier BLENDED margin, not worst cell.
 *
 * This is the correction, not an incidental choice. The surface used to derive
 * progression from the classifier's mode, which is the worst CELL's band, while
 * `markAccepted`, `markComplete` and now `sendQuote` all read the tier's
 * BLENDED status. Two bases for one question is Pattern 50, and it produced a
 * dead Request control: a below-floor cell inside a tier whose blend is above
 * floor put the surface in `blocked` with no tier to raise a request against.
 *
 * A predicate that predicts something other than what the gate does is worse
 * than no predicate, because the operator learns to trust it.
 *
 * Below-floor CELLS have not stopped mattering — they are what the compliance
 * grid is for, and `suggestion_manual_only` already speaks to exactly this
 * asymmetry. They are guidance about where to look, not a claim about what the
 * firm will permit.
 *
 * ── WHAT `allowed: true` MEANS ───────────────────────────────────────────
 *
 * That a valid authorization exists for every tier that needs one — right
 * version, right tier, current fingerprint, not invalidated.
 *
 * It is a PREDICTION of the gate, never a substitute for it. The commercial
 * state can move between this render and the send, which is exactly what the
 * fingerprint catches, so `evaluateBelowFloorAuthorization` is still evaluated
 * at the moment of commitment and remains authoritative.
 *
 * It carries no view on WHO approved. Policy (2026-08-22) places no
 * independence requirement on below-floor approval, so there is nothing about
 * the acting user for this function to know or to ask.
 */

import type { ApprovalTierState } from "./below-floor-approval-state";

/** The tier facts progression depends on. Nothing else about a tier is relevant. */
export interface ProgressionTier {
  tierId: string;
  label: string;
  /** From the governed engine — `quoteRollup[].blendedMarginStatus`. */
  blendedStatus: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR" | "UNAVAILABLE" | "COST_WITHOUT_REVENUE";
}

export type ProgressionBlockCode =
  /** At least one tier is below the floor and has no valid authorization. */
  | "BELOW_FLOOR_UNAUTHORIZED"
  /** Margins cannot be judged because some cells have no margin yet. */
  | "DATA_INCOMPLETE";

export type ProgressionVerdict =
  | {
      allowed: true;
      /**
       * Tiers proceeding on an authorization rather than on compliance. Empty
       * on the ordinary path. Carried so the surface can say which — an
       * operator continuing below floor should see that they are, and on whose
       * decision.
       */
      authorizedTiers: ReadonlyArray<{ tierId: string; label: string }>;
    }
  | {
      allowed: false;
      code: ProgressionBlockCode;
      message: string;
      /** Tiers responsible, for a work list rather than a sentence. */
      tiers: ReadonlyArray<{ tierId: string; label: string; approval: ApprovalTierState["kind"] }>;
    };

/**
 * ORDER OF REFUSAL.
 *
 * A known floor breach outranks incomplete data, matching the classifier's
 * existing disposition that "blocked stays blocked — known floor breach is
 * decisive". Telling an operator to finish entering raws, when what actually
 * stands between them and sending is a price below the firm's floor, sends them
 * to the wrong surface.
 *
 * `UNAVAILABLE` and `COST_WITHOUT_REVENUE` tiers are NOT treated as floor
 * breaches here. They are unpriced rather than underpriced, they arrive with
 * `unknownCellCount > 0` in every case the engine produces them, and the
 * acceptance gate refuses them on their own separate grounds with their own
 * message. Folding them into the floor code would tell an operator to seek an
 * approval that would not help.
 */
export function evaluateProgression(input: {
  tiers: readonly ProgressionTier[];
  /**
   * Per-tier approval, keyed by tier id. Read ONLY for tiers that are below
   * floor — which is what makes "a lift that clears the floor progresses
   * without consulting approval" structural rather than a promise.
   */
  approvalByTier: Readonly<Record<string, ApprovalTierState>>;
  /** Cells whose margin cannot be computed yet. */
  unknownCellCount: number;
}): ProgressionVerdict {
  const belowFloor = input.tiers.filter((t) => t.blendedStatus === "BELOW_FLOOR");

  // Nothing below floor: approval is not consulted at all. Not "consulted and
  // found irrelevant" — not read. A stale approval, a rejection, a superseded
  // request: none of them can reach this path, so none of them can hold back a
  // quote that is now compliant on its own terms.
  if (belowFloor.length > 0) {
    const unauthorized = belowFloor.filter(
      (t) => (input.approvalByTier[t.tierId]?.kind ?? "none") !== "approved",
    );

    if (unauthorized.length > 0) {
      const names = unauthorized.map((t) => t.label).join(", ");
      return {
        allowed: false,
        code: "BELOW_FLOOR_UNAUTHORIZED",
        message:
          unauthorized.length === 1
            ? `${names} is below the firm's margin floor. Lift it above the floor, or have an authorized commercial approver other than you approve it.`
            : `${unauthorized.length} tiers are below the firm's margin floor (${names}). Lift them above the floor, or have an authorized commercial approver other than you approve each one.`,
        tiers: unauthorized.map((t) => ({
          tierId: t.tierId,
          label: t.label,
          approval: input.approvalByTier[t.tierId]?.kind ?? "none",
        })),
      };
    }
  }

  if (input.unknownCellCount > 0) {
    const n = input.unknownCellCount;
    return {
      allowed: false,
      code: "DATA_INCOMPLETE",
      message: `${n} ${n === 1 ? "cell has" : "cells have"} no margin yet. Finish the cost inputs on Costs — a quote cannot be checked against the floor where there is nothing to check.`,
      tiers: [],
    };
  }

  return {
    allowed: true,
    authorizedTiers: belowFloor.map((t) => ({ tierId: t.tierId, label: t.label })),
  };
}
