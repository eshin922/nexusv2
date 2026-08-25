/**
 * ── RETAINED FOR PHASE 3, NOT DEAD CODE ─────────────────────────────────
 *
 * This has no production caller today. That is deliberate and dispositioned,
 * not an oversight: the recovery election is economically substantive, so
 * Edward's R5 disposition (2026-08-24) removed it from Quote Presentation --
 * "if a control can change customer economics, it is not a Quote Presentation
 * control" -- and its registered home is the Pricing workspace, where the
 * authority already shows the equivalent `allocate_service_fees_to_cost`
 * toggle (r10-designer-notes, lineage to the selected R12).
 *
 * Phase 3 has not started, so the destination exists in authority and not yet
 * in code. Everything here is certified and stays certified; deleting it would
 * mean rebuilding a proven engine when Pricing arrives.
 *
 * See docs/quote-presentation-restoration-brief.md §2.
 */
/**
 * The recovery workspace's read model.
 *
 * ── IT READS THE CONSTRUCTED STATE. IT DERIVES NOTHING. ─────────────────
 *
 * Every figure and every placement here comes from
 * `skuRollups[].perTier[].constructed` — the same state the tier totals, the
 * customer document, the frozen matrix and the Sales Order all read. A surface
 * that recomputed "what would this charge recover" would be the second
 * authority this whole workstream removed, reintroduced at the one layer an
 * operator actually looks at.
 *
 * There is no rate arithmetic in this file, and a test asserts its absence.
 *
 * ── PLACEMENT IS PER (OWNER, TIER); THE ELECTION IS PER QUOTE ───────────
 *
 * A quote can hold a charge at several owners, and three real quotes carry
 * `allocate_service_fees_to_cost` ON and OFF simultaneously — one of them
 * already sent. So a charge's placement is a SET, not a value, and the row says
 * so rather than picking one and calling it the answer. `mixed` is a fact about
 * the quote the operator needs to see before electing, not an edge case to
 * flatten.
 *
 * ── AVAILABILITY IS THE CONSERVATIVE INTERSECTION ───────────────────────
 *
 * A mode offered here must be electable for EVERY owner state present, because
 * the election is stored per quote and would otherwise be accepted while
 * mis-pricing one owner. That is the same rule the action layer enforces, asked
 * through the same `refusalFor`, so the surface cannot offer what the boundary
 * would refuse.
 */

import {
  RECOVERY_CHARGES,
  chargePolicy,
  type ChargeGrain,
  type RecoveryChargeKey,
  type RecoveryMode,
} from "./registry";
import { RECOVERY_MODES } from "./registry";
import { refusalFor, type ChargeElection } from "./resolve";
import {
  MODE_BY_PLACEMENT,
  ownedPlacedCharges,
  type ConstructedRollups,
} from "./construct";
import type { ChargePlacement, PlacedCharge } from "./construct";

export type ChargeModeOption = {
  mode: RecoveryMode;
  available: boolean;
  /** Governed reason, present exactly when `available` is false. */
  reason: string | null;
};

export type RecoveryChargeRow = {
  chargeKey: RecoveryChargeKey;
  label: string;
  grain: ChargeGrain;
  /** Whether this quote carries the charge at all. */
  present: boolean;
  /** Distinct placements across every (owner, tier) holding the charge. */
  placements: ChargePlacement[];
  /** True when the quote places this charge more than one way. */
  mixed: boolean;
  /** The stored election, or null when resolution fell through to legacy. */
  electedMode: RecoveryMode | null;
  source: "election" | "legacy";
  /**
   * The treatment IN FORCE — read off the construction, so it is the same
   * whether an operator elected it or the quote inherited it.
   *
   * ── WHY THIS IS NOT `electedMode` ───────────────────────────────────────
   *
   * A quote with no election row still has a real recovery treatment: the
   * legacy contract resolves to one, the engine prices it, and the customer
   * document prints it. Reading the selected state off `electedMode` conflated
   * *no election* with *no treatment*, so the surface showed every option
   * unselected on a quote that unambiguously had one in force.
   *
   * Null in exactly two cases, and neither is invented to fill the control:
   *   - the quote does not carry the charge;
   *   - it carries it more than one way (`mixed`), so no single treatment is
   *     in force and no segment can honestly claim to be it.
   */
  effectiveMode: RecoveryMode | null;
  /**
   * The ACTIONABLE cost — one-time fees only, the portion this row's control
   * can actually move. Summed straight off the constructed state, never
   * recomputed.
   */
  totalCost: number;
  /** Null when any instance's recovery is unknown — see BV-013. */
  totalRecovery: number | null;
  /**
   * A Direct Service contribution sharing this charge's accounting
   * destination, held APART from the actionable figures above.
   *
   * ── WHY THIS IS NOT ADDED IN ────────────────────────────────────────────
   *
   * `rd_total` and the `formulation` Direct Service both resolve to the BV-011
   * destination `OTC - Formulation`. Aggregating them is correct for
   * accounting and wrong for a control: the recovery election moves the fee,
   * and a Direct Service is ALREADY a priced customer line with no fee to
   * place, so an election over it is inert.
   *
   * Summed together, Card 1 advertised $12,510 of recovery on a production
   * quote where the control could move $5,600 -- and $9,800 on another where
   * it could move nothing whatever. The operator elected the largest number on
   * the surface and watched most of it sit still, which is exactly what it did.
   *
   * Null when the charge carries no service contribution, which is every
   * charge on all but two quotes in the current population. Not zero: zero
   * would put a Direct Service row on a charge that has none.
   *
   * Recovery treatment is NOT extended to Direct Service leaves -- that would
   * be new commercial functionality. This is presentation: the amount is
   * disclosed as context and carries no control.
   */
  serviceContext: { cost: number; recovery: number | null } | null;
  options: ChargeModeOption[];
};

/**
 * Build the workspace rows.
 *
 * `allocationStates` is every distinct `allocate_service_fees_to_cost` present
 * in the quote — the same set the action layer intersects over. Passing it in
 * rather than reading it here keeps this a pure projection of state it is
 * given.
 */
export function buildRecoveryWorkspace(input: {
  costing: ConstructedRollups;
  elections: readonly ChargeElection[];
  allocationStates: readonly boolean[];
  /**
   * Which rollups OWN their charges, as opposed to carrying a merge of their
   * children's.
   *
   * Required, not optional with a permissive default. This model summed every
   * rollup and reported DOUBLE the governed recovery and double the cost on the
   * operator's surface — $390 on a quote whose single $150 setup fee at a
   * pinned 0.30 recovers $195. A default would have let the same call sites
   * keep the same behaviour while looking fixed.
   */
  isLeaf: (skuId: string) => boolean;
}): RecoveryChargeRow[] {
  const electionByCharge = new Map<RecoveryChargeKey, RecoveryMode>();
  for (const e of input.elections) electionByCharge.set(e.chargeKey, e.mode);

  // Every placed instance, from the ONE constructed state, counted ONCE.
  const placedByCharge = new Map<RecoveryChargeKey, PlacedCharge[]>();
  for (const { charge } of ownedPlacedCharges(input.costing, input.isLeaf)) {
    const list = placedByCharge.get(charge.chargeKey) ?? [];
    list.push(charge);
    placedByCharge.set(charge.chargeKey, list);
  }

  const states = input.allocationStates.length ? input.allocationStates : [true];

  return RECOVERY_CHARGES.map((policy) => {
    const placed = placedByCharge.get(policy.key) ?? [];
    // Placement — and therefore the segment shown as in force — is scoped to
    // the ACTIONABLE charges. A Direct Service placed differently from the fee
    // made the row read `mixed`, so no segment could honestly claim to be in
    // force and the control rendered with nothing selected: the "R&D shows no
    // election on a quote that plainly has one" case. The service was never
    // something the control placed, so it must not be something the control
    // reports on.
    const actionable = placed.filter((p) => p.ownerKind !== "direct_service");
    const placements = [...new Set(actionable.map((p) => p.placement))];

    // Split by COMMERCIAL GRAIN, not by charge key. A one-time fee is
    // actionable; a Direct Service leaf is already a priced customer line.
    // Done for every charge uniformly rather than special-casing the one that
    // surfaced it -- the classification pass found `rd_formulation` is the only
    // charge carrying a service contribution today, and a rule that only knew
    // about that key would be a fix for this quote rather than for the shape.
    let totalCost = 0;
    let totalRecovery: number | null = 0;
    let svcCost = 0;
    let svcRecovery: number | null = 0;
    let svcPresent = false;
    for (const p of placed) {
      if (p.ownerKind === "direct_service") {
        svcPresent = true;
        svcCost += p.cost;
        if (svcRecovery !== null) {
          svcRecovery = p.recoverableSell === null ? null : svcRecovery + p.recoverableSell;
        }
        continue;
      }
      totalCost += p.cost;
      if (totalRecovery !== null) {
        // Unknown recovery makes the total unknown, not smaller. A number here
        // would state a figure nothing governs.
        totalRecovery = p.recoverableSell === null ? null : totalRecovery + p.recoverableSell;
      }
    }

    const elected = electionByCharge.get(policy.key) ?? null;

    const options: ChargeModeOption[] = RECOVERY_MODES.map((mode) => {
      // Refused if ANY owner state refuses it. The election is per quote, so
      // offering a mode that one owner cannot carry would be offering a
      // mis-price.
      let reason: string | null = null;
      for (const perAssemblyAllocate of states) {
        reason = refusalFor(policy.key, mode, {
          perAssemblyAllocate,
          // The Direct Service half is why `separate` is refused for this
          // charge. The control does not REPORT on that half (it is not
          // actionable), but it must still refuse on account of it — otherwise
          // it offers a placement that creates unbillable revenue.
          hasDirectServiceContribution: svcPresent,
        });
        if (reason) break;
      }
      return { mode, available: reason === null, reason };
    });

    return {
      chargeKey: policy.key,
      label: policy.label,
      grain: chargePolicy(policy.key).grain,
      // Actionable presence. A charge whose only contribution is a Direct
      // Service has no fee to place, so offering it a recovery control would
      // be offering an inert one -- which is the $9,800-moves-nothing case.
      present: placed.some((p) => p.ownerKind !== "direct_service"),
      placements,
      mixed: placements.length > 1,
      electedMode: elected,
      source: elected === null ? "legacy" : "election",
      // Derived from the construction, never from the election: one authority
      // for what is in force, whatever put it there.
      effectiveMode:
        placements.length === 1 ? MODE_BY_PLACEMENT[placements[0]] : null,
      totalCost,
      totalRecovery,
      serviceContext: svcPresent ? { cost: svcCost, recovery: svcRecovery } : null,
      options,
    };
  });
}
