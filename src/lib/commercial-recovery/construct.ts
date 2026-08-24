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
  /**
   * Whether an operator elected this placement or it fell through to the
   * legacy per-assembly boolean.
   *
   * ── WHY THE ENGINE NEEDS TO KNOW ────────────────────────────────────────
   *
   * The two are priced DIFFERENTLY, by decision (2026-08-24):
   *
   *   legacy    keeps historical behaviour exactly — an allocated fee sits in
   *             the unit rate and the quote's price adjustment reaches it,
   *             which is what every existing quote was priced with.
   *
   *   election  is revenue-NEUTRAL: the charge recovers `recoverableSell`
   *             wherever it is placed, and the adjustment does not re-mark-up
   *             a charge already priced by its own governed rate.
   *
   * Without this discriminator the engine cannot honour both, and honouring
   * only one either silently reprices 89 existing quotes or leaves relocation
   * as a pricing lever. Absence of a row stays the load-bearing state; this is
   * what lets it stay load-bearing at the pricing layer too.
   */
  source: "election" | "legacy";
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
  /**
   * The amortization basis, present exactly when the charge is recovered
   * INSIDE the unit price.
   *
   * ── WHY REVENUE-NEUTRALITY MUST NOT ERASE THIS ──────────────────────────
   *
   * Accounting has to know that a charge was amortized, and must not invoice
   * it separately. "The customer pays the same either way" is a statement about
   * the AMOUNT; it says nothing about the INVOICE, and collapsing the two would
   * leave the frozen record unable to distinguish a $1,400 setup fee embedded
   * at $0.14 across 10,000 units from a $1,400 setup fee billed on its own
   * line. Those are the same revenue and different invoices.
   *
   * So the placement answers "invoice separately?" — `unit_price` means NO —
   * and this carries what an amortized charge needs stated alongside it: the
   * total recovered and the quoted-unit basis it was spread over.
   *
   * `perUnit` is derived here rather than left to a consumer because a consumer
   * dividing it again is a second derivation, and the quantity it divided by
   * would be the one it happened to have.
   */
  amortization: { totalRecovered: number; tierQuantity: number; perUnit: number } | null;
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
  /**
   * The unit-price bucket, SPLIT BY PROVENANCE.
   *
   * A legacy-placed charge enters the unit rate as cost and is marked up and
   * adjusted along with everything else — historical behaviour, preserved.
   * An ELECTED one must recover exactly `recoverableSell`, so the adjustment
   * must not reach it, and the engine needs the two amounts apart to do that.
   *
   * `unitPriceCost` remains their sum, so a consumer that does not care about
   * provenance is unaffected.
   */
  unitPriceCostLegacy: number;
  unitPriceCostElected: number;
  /** Elected unit-price recovery — placed WITHOUT the price adjustment. */
  unitPriceRecoveryElected: number | null;
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
  const costInBySource = (p: ChargePlacement, src: "election" | "legacy"): number => {
    let sum = 0;
    for (const c of charges) if (c.placement === p && c.source === src) sum += c.cost;
    return sum;
  };
  const recoveryInBySource = (
    p: ChargePlacement,
    src: "election" | "legacy",
  ): number | null => {
    let sum = 0;
    for (const c of charges) {
      if (c.placement !== p || c.source !== src) continue;
      if (c.revenueContribution === null) return null;
      sum += c.revenueContribution;
    }
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
    unitPriceCostLegacy: costInBySource("unit_price", "legacy"),
    unitPriceCostElected: costInBySource("unit_price", "election"),
    unitPriceRecoveryElected: recoveryInBySource("unit_price", "election"),
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
  placementOf: (charge: ChargeEconomicsInput) => {
    placement: ChargePlacement;
    source: "election" | "legacy";
  },
  /**
   * The tier's quoted quantity — the amortization basis for a charge placed
   * inside the unit price.
   *
   * The QUOTED quantity, not actual output: a customer quote's pricing is what
   * it is regardless of what production later yields, and an amortization basis
   * that moved with actuals would restate a sent quote.
   */
  tierQuantity = 0,
): ConstructedCommercialState {
  return totalsOf(
    economics.map((e) => {
      const { placement, source } = placementOf(e);
      return {
        chargeKey: e.chargeKey,
        placement,
        source,
        // Copied. Not recomputed, not re-rated, not rounded.
        cost: e.cost,
        recoverableSell: e.recoverableSell,
        // Absorbed contributes zero even when the amount is unknown: what is
        // given up need not be known to know the customer pays nothing for it.
        revenueContribution: placement === "absorbed" ? 0 : e.recoverableSell,
        // Stated only where it is a fact. A separately-billed charge has no
        // amortization basis, and inventing one — or emitting a zero — would
        // let a reader take it for an amortized charge spread over nothing.
        amortization:
          placement === "unit_price" && e.recoverableSell !== null && tierQuantity > 0
            ? {
                totalRecovered: e.recoverableSell,
                tierQuantity,
                perUnit: e.recoverableSell / tierQuantity,
              }
            : null,
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
  tierQuantity = 0,
): ConstructedCommercialState {
  const byCharge = new Map<RecoveryChargeKey, ChargeElection>();
  for (const e of elections) byCharge.set(e.chargeKey, e);

  return composeFromPlacements(economics, (e) => {
    const resolved = resolveCharge(
      e.chargeKey,
      byCharge.get(e.chargeKey) ?? null,
      perAssemblyAllocate,
    );
    // Provenance travels with the placement, because the two are priced
    // differently and the engine has to be able to tell them apart.
    return { placement: PLACEMENT_BY_MODE[resolved.mode], source: resolved.source };
  }, tierQuantity);
}
