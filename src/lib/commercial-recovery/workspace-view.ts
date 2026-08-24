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
  /** Summed straight off the constructed state. Never recomputed. */
  totalCost: number;
  /** Null when any instance's recovery is unknown — see BV-013. */
  totalRecovery: number | null;
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
    const placements = [...new Set(placed.map((p) => p.placement))];

    let totalCost = 0;
    let totalRecovery: number | null = 0;
    for (const p of placed) {
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
        reason = refusalFor(policy.key, mode, { perAssemblyAllocate });
        if (reason) break;
      }
      return { mode, available: reason === null, reason };
    });

    return {
      chargeKey: policy.key,
      label: policy.label,
      grain: chargePolicy(policy.key).grain,
      present: placed.length > 0,
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
      options,
    };
  });
}
