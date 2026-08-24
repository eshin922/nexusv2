/**
 * Commercial sell construction.
 *
 * THE MIDDLE LAYER the boundary correction called for. Cost truth is the
 * engine's; presentation is the projection's; this decides WHERE an
 * already-priced recovery lives.
 *
 *     cost engine  ->  charge economics        INVARIANT under recovery
 *     commercial   ->  sell / recovery build   HERE
 *     projection   ->  render + freeze         decides nothing
 *
 * ── IT CONSUMES `recoverableSell` VERBATIM ───────────────────────────────
 *
 * The cost layer states what a charge would recover. This layer never
 * re-resolves the rate and never recomputes the amount — not because
 * recomputing would be hard, but because a second derivation of one number is a
 * second authority for it, and the two agree exactly until the day a rate moves
 * or a pin applies to one and not the other.
 *
 * `93a5d4bb` is the standing example: it is `sent` and pins Production at 0.30
 * against a live default of 0.40. A constructor that reached for the live
 * default would price a sent quote's charge at a rate that quote was never
 * priced at, and every total would still look plausible.
 *
 * So there is no markup import here, and no `1 + rate` anywhere in this file.
 * A test asserts the absence rather than trusting it.
 *
 * ── COST NEVER MOVES ─────────────────────────────────────────────────────
 *
 * Recovery must never change cost truth; it may change sell composition and
 * revenue. `cost` is copied through under every election, and that is the
 * accounting guarantee stated as an implementation property.
 *
 * ── REVENUE-NEUTRALITY IS STRUCTURAL, NOT ARITHMETIC ─────────────────────
 *
 * `included` and `separate` place THE SAME VALUE in different buckets. Nothing
 * is added on one side and subtracted from the other, so there is no
 * subtraction whose result has to be trusted — the OD-025 shape, where
 * `(v - f) x 1 + f` is exact algebra and inexact IEEE-754, never arises.
 *
 * The revenue total is summed over charges in a FIXED order, independent of
 * placement, so the two election sets produce the identical sequence of
 * addends and therefore the identical float. Bit-for-bit, by construction.
 */

import type { RecoveryChargeKey } from "./registry";
import type { ChargeElection } from "./resolve";
import { resolveCharge } from "./resolve";

/** Where a recovery lands. One charge, exactly one of these. */
export type ChargePlacement = "unit_price" | "separate_line" | "absorbed";

/**
 * The subset of the cost layer's record this layer reads.
 *
 * Declared structurally rather than imported from `costing` so the dependency
 * runs one way: the constructor consumes charge economics, and the cost engine
 * knows nothing about recovery.
 */
export type ChargeEconomicsInput = {
  chargeKey: RecoveryChargeKey;
  cost: number;
  recoverableSell: number | null;
};

export type PlacedCharge = {
  chargeKey: RecoveryChargeKey;
  placement: ChargePlacement;
  /** Copied through. Invariant under every election. */
  cost: number;
  /** Copied through, never recomputed. */
  recoverableSell: number | null;
  /**
   * What this charge contributes to customer revenue under its placement.
   *
   * NULL only when the charge is recovered but its recoverable amount is
   * unknown — no governed rate resolved (BV-013). `absorbed` is never null:
   * giving up an unknown amount still contributes exactly zero.
   */
  revenueContribution: number | null;
};

export type ConstructedCommercialState = {
  charges: PlacedCharge[];
  /** Sum of costs. The same under every election set. */
  totalChargeCost: number;
  /**
   * Sum of revenue contributions, or NULL if any recovered charge's amount is
   * unknown. A total containing an unknown is unknown — reporting it as a
   * number would state a figure nothing governs.
   */
  totalChargeRevenue: number | null;
  /** Recovered inside the unit price. */
  unitPriceRecovery: number | null;
  /** Billed as its own customer line. */
  separateLineRecovery: number | null;
  /** Given up: cost retained, no customer revenue. */
  absorbedRecovery: number;
  /**
   * Cost by placement. Split because the consumer that adds a charge's cost to
   * a total has to know whether that cost is ALREADY somewhere else: a
   * unit-price charge's cost is inside the unit rate already, and adding it
   * again at the tier would count it twice (Pattern 59).
   */
  unitPriceCost: number;
  separateLineCost: number;
  absorbedCost: number;
};

const PLACEMENT_BY_MODE = {
  included: "unit_price",
  separate: "separate_line",
  absorbed: "absorbed",
} as const;

/**
 * ── WHY PLACEMENT AND COMPOSITION ARE SEPARATE FUNCTIONS ─────────────────
 *
 * Deciding WHERE a charge goes is policy. Working out what the totals are once
 * it is there is arithmetic. They are split because they are answerable at
 * different times, and today that difference is load-bearing rather than
 * tidy-minded.
 *
 * Every election that CHANGES anything is currently refused — correctly, and
 * until this layer is wired into the projection, because until then the
 * projection can only suppress or emit a line and cannot move a charge between
 * the two places. So the arithmetic below cannot be exercised end-to-end
 * through resolution yet.
 *
 * Testing it by bypassing resolution would be testing a path that cannot
 * happen. Testing it HERE, over placements directly, proves the properties the
 * refusals are waiting on — and the same function is what runs when they lift,
 * so nothing is proven about a thing that is later replaced.
 */
/**
 * Totals over a placed set.
 *
 * Extracted so composition and merging cannot drift: two implementations of
 * "what does this set add up to" would agree until one of them was changed.
 */
function totalsOf(charges: PlacedCharge[]): ConstructedCommercialState {
  let totalChargeCost = 0;
  for (const c of charges) totalChargeCost += c.cost;

  // ONE PASS, FIXED ORDER, PLACEMENT-INDEPENDENT.
  //
  // Summing per bucket and adding the buckets would make the addend ORDER
  // depend on placement, and float addition is not associative — moving a
  // charge from one bucket to another could then move the total in the last
  // places while "the same value, placed differently" was the entire claim.
  // This walks `charges` once, in input order, whatever the placements are.
  let totalChargeRevenue: number | null = 0;
  for (const c of charges) {
    if (c.revenueContribution === null) {
      totalChargeRevenue = null;
      break;
    }
    totalChargeRevenue += c.revenueContribution;
  }

  const revenueIn = (p: ChargePlacement): number | null => {
    let sum = 0;
    for (const c of charges) {
      if (c.placement !== p) continue;
      if (c.revenueContribution === null) return null;
      sum += c.revenueContribution;
    }
    return sum;
  };
  const costIn = (p: ChargePlacement): number => {
    let sum = 0;
    for (const c of charges) if (c.placement === p) sum += c.cost;
    return sum;
  };

  return {
    charges,
    totalChargeCost,
    totalChargeRevenue,
    unitPriceRecovery: revenueIn("unit_price"),
    separateLineRecovery: revenueIn("separate_line"),
    absorbedRecovery: revenueIn("absorbed") ?? 0,
    unitPriceCost: costIn("unit_price"),
    separateLineCost: costIn("separate_line"),
    absorbedCost: costIn("absorbed"),
  };
}

/** A set with no charges. A function, not a shared constant — a shared object
 * would be one mutable value handed to every caller. */
export function emptyConstructed(): ConstructedCommercialState {
  return totalsOf([]);
}

/**
 * Merge constructed states up a tree.
 *
 * CONCATENATES, never re-places and never re-prices. Placement was decided
 * where the owner's allocation state was known; a parent has no standing to
 * revisit it, and re-deriving here would be the second authority this layer
 * exists to avoid.
 *
 * Totals are recomputed over the concatenation rather than summed from the
 * parts, so the addend order stays a property of the charge list and not of
 * how the tree happened to be walked.
 */
export function mergeConstructed(
  parts: readonly ConstructedCommercialState[],
): ConstructedCommercialState {
  const charges: PlacedCharge[] = [];
  for (const p of parts) charges.push(...p.charges);
  return totalsOf(charges);
}

/**
 * ── WHY PLACEMENT AND COMPOSITION ARE SEPARATE FUNCTIONS ─────────────────
 *
 * Deciding WHERE a charge goes is policy. Working out what the totals are once
 * it is there is arithmetic. They are split because they are answerable at
 * different times, and today that difference is load-bearing rather than
 * tidy-minded.
 *
 * Every election that CHANGES anything is currently refused — correctly, and
 * until this layer is wired into the projection, because until then the
 * projection can only suppress or emit a line and cannot move a charge between
 * the two places. So the arithmetic below cannot be exercised end-to-end
 * through resolution yet.
 *
 * Testing it by bypassing resolution would be testing a path that cannot
 * happen. Testing it HERE, over placements directly, proves the properties the
 * refusals are waiting on — and the same function is what runs when they lift,
 * so nothing is proven about a thing that is later replaced.
 */
export function composeFromPlacements(
  economics: readonly ChargeEconomicsInput[],
  placementOf: (charge: ChargeEconomicsInput) => ChargePlacement,
): ConstructedCommercialState {
  return totalsOf(
    economics.map((e) => {
      const placement = placementOf(e);
      return {
        chargeKey: e.chargeKey,
        placement,
        // Copied. Not recomputed, not re-rated, not rounded.
        cost: e.cost,
        recoverableSell: e.recoverableSell,
        // Absorbed contributes zero even when the amount is unknown: what is
        // given up need not be known to know the customer pays nothing for it.
        revenueContribution: placement === "absorbed" ? 0 : e.recoverableSell,
      };
    }),
  );
}

/**
 * Place every charge according to its election, then compose.
 *
 * `perAssemblyAllocate` is the owner's `allocate_service_fees_to_cost`, passed
 * through to resolution unchanged — it decides only what a charge resolves to
 * in the ABSENCE of an election, and is never written.
 *
 * Throws `RecoveryPolicyError` on an election policy denies. The surface
 * refuses too, but the surface is not the boundary.
 */
export function constructCommercial(
  economics: readonly ChargeEconomicsInput[],
  elections: readonly ChargeElection[] = [],
  perAssemblyAllocate?: boolean | null,
): ConstructedCommercialState {
  const byCharge = new Map<RecoveryChargeKey, ChargeElection>();
  for (const e of elections) byCharge.set(e.chargeKey, e);

  return composeFromPlacements(economics, (e) => {
    const resolved = resolveCharge(
      e.chargeKey,
      byCharge.get(e.chargeKey) ?? null,
      perAssemblyAllocate,
    );
    return PLACEMENT_BY_MODE[resolved.mode];
  });
}
