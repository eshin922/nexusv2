import {
  evaluateBelowFloorAuthorization,
  fingerprintCommercialState,
  type BelowFloorAuthorizationRecord,
} from "@/lib/below-floor-authorization";

/**
 * Whether this quote may proceed past the margin floor, and why not.
 *
 * ── WHY THIS IS SHARED AND NOT COMPUTED TWICE ────────────────────────────
 *
 * The send gate refuses a below-floor quote unless every below-floor tier
 * carries a valid authorization. The Customer View footer tells the operator
 * whether they may proceed. Those are the same question, and they were being
 * answered by two different pieces of code that disagreed in two ways:
 *
 *   - the gate asks `blendedMarginStatus === "BELOW_FLOOR"`, the governed
 *     verdict; the footer hand-rolled `blendedMarginPct < floor - 1e-6`. Two
 *     predicates for one threshold, free to drift the moment the governed one
 *     gains a rule the arithmetic does not have.
 *
 *   - the footer did not read authorizations AT ALL. So a quote whose
 *     below-floor tier had been properly authorized still showed `blocked` and
 *     offered "Request pricing approval" — asking an operator to seek approval
 *     they already hold, for a send the gate would have allowed.
 *
 * The footer was not merely wrong; it was wrong in the direction that wastes an
 * approver's time and teaches operators to distrust the surface.
 *
 * So the evaluation happens once, here, and both the gate and the surface read
 * it. Pattern 50: when two subsystems answer one question, the disagreement is
 * the defect, and the fix is one authority rather than two careful ones.
 *
 * Pure. It performs no query and no arithmetic on money — it reads the governed
 * status and the fingerprint of a state it is given.
 */

export type BelowFloorTierVerdict = {
  tierId: string;
  label: string;
  ok: boolean;
  /** Null when ok. Otherwise the reason, in the words the operator is shown. */
  message: string | null;
  code: string | null;
};

export type BelowFloorProjection = {
  /** True when nothing is below floor, or everything below floor is authorized. */
  ok: boolean;
  /** Only the tiers that are below floor. Empty on the ordinary path. */
  tiers: BelowFloorTierVerdict[];
  /** True when at least one tier is below floor, authorized or not. */
  anyBelowFloor: boolean;
};

type Rollup = {
  tierId: string;
  label: string;
  totalRevenue: number;
  totalCost: number;
  blendedMarginPct: number | null;
  blendedMarginStatus: string | null;
};

export function projectBelowFloorAuthorization(input: {
  rollups: readonly Rollup[];
  authorizations: readonly BelowFloorAuthorizationRecord[];
  quoteVersionNumber: number;
}): BelowFloorProjection {
  // The GOVERNED verdict, not a margin comparison. `blendedMarginStatus` is
  // what the costing layer decided; re-deriving it from percentages here would
  // be a second opinion about the firm's own floor.
  const belowFloor = input.rollups.filter(
    (r) => r.blendedMarginStatus === "BELOW_FLOOR",
  );

  if (belowFloor.length === 0) {
    return { ok: true, tiers: [], anyBelowFloor: false };
  }

  const tiers = belowFloor.map((tier) => {
    const verdict = evaluateBelowFloorAuthorization({
      authorizations: input.authorizations,
      scope: {
        quoteVersionNumber: input.quoteVersionNumber,
        tierId: tier.tierId,
      },
      // Fingerprinted from THIS read, so an authorization is current against
      // the economics in front of the operator rather than some other snapshot.
      currentFingerprint: fingerprintCommercialState({
        totalRevenue: tier.totalRevenue,
        totalCost: tier.totalCost,
        blendedMarginPct: tier.blendedMarginPct,
      }),
    });
    return {
      tierId: tier.tierId,
      label: tier.label,
      ok: verdict.ok,
      message: verdict.ok ? null : verdict.message,
      code: verdict.ok ? null : verdict.code,
    };
  });

  return {
    ok: tiers.every((t) => t.ok),
    tiers,
    anyBelowFloor: true,
  };
}
