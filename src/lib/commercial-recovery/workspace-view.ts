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
  /**
   * WHICH CHARGE this row is — OD-032 recovery grain.
   *
   * Present on a component-owned row, where one row is one charge. Absent on a
   * legacy row, which stands for a production COLUMN and therefore for the one
   * charge of that type the quote can hold.
   *
   * A row without this places by type; a row with it places by instance. That
   * is the whole grain distinction, carried as data rather than inferred.
   */
  chargeInstanceId?: string;
  /**
   * The component that CAUSED this charge, named for the operator — and shown
   * ONLY when the type alone would be ambiguous.
   *
   * Two Print plates rows need telling apart; one does not, and labelling it
   * would put lineage on a surface where nature is what reads. The same
   * collision-only rule the customer document uses, so internal and external
   * copy agree.
   *
   * Null when the type is unambiguous, when no name is available, or on a
   * legacy row — whose owner is the engagement and whose anchor must never be
   * surfaced as a cause (OD-028).
   */
  ownerLabel?: string | null;
  /**
   * Nobody has decided who bears this charge yet.
   *
   * Distinct from every mode: absorbed is a decision to eat a cost, unplaced is
   * the absence of one. The surface must show it as outstanding rather than as
   * a treatment, and send is refused while any remains.
   */
  unplaced: boolean;
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
  /**
   * `quote_leaves.id` → the component's name, for collision-only labelling.
   *
   * Optional, and its absence is handled honestly: a row that would need a
   * label and has no name shows NONE rather than an id. An operator cannot act
   * on a uuid, and printing one would be worse than the ambiguity it was meant
   * to resolve.
   */
  ownerNames?: ReadonlyMap<string, string>;
}): RecoveryChargeRow[] {
  // ── TWO GRAINS, SPLIT ONCE, HERE ────────────────────────────────────────
  //
  // A LEGACY election names a type, because for a production column the type is
  // the identity. A COMPONENT election names an instance, because the type
  // distinguishes nothing — one carton can cause two sets of print plates.
  //
  // Kept apart for the same reason the engine keeps them apart: a component row
  // must never resolve through a type-grained election, and one map keyed
  // loosely is how that fallback returns.
  const electionByType = new Map<RecoveryChargeKey, RecoveryMode>();
  const electionByInstance = new Map<string, RecoveryMode>();
  for (const e of input.elections) {
    if (e.chargeInstanceId) electionByInstance.set(e.chargeInstanceId, e.mode);
    else electionByType.set(e.chargeKey, e.mode);
  }

  // Every placed instance, from the ONE constructed state, counted ONCE.
  const placedByCharge = new Map<RecoveryChargeKey, PlacedCharge[]>();
  const componentCharges: PlacedCharge[] = [];
  for (const { charge } of ownedPlacedCharges(input.costing, input.isLeaf)) {
    if (charge.chargeInstanceId) {
      // Component-owned. It gets its own row below and must NOT be aggregated
      // into the type row, or two charges would share one control again.
      componentCharges.push(charge);
      continue;
    }
    const list = placedByCharge.get(charge.chargeKey) ?? [];
    list.push(charge);
    placedByCharge.set(charge.chargeKey, list);
  }

  // ── COLLISION-ONLY OWNER NAMING ─────────────────────────────────────────
  //
  // A name appears only where the TYPE alone is ambiguous, which is the rule
  // the customer document already follows. One Print plates row reads "Print
  // plates"; two read "Print plates · Kids' Cough carton".
  //
  // Counted per (type, tier), because two rows for one type on one tier are
  // what an operator actually sees side by side.
  const perTypeTier = new Map<string, number>();
  for (const c of componentCharges) {
    const k = `${c.chargeKey}`;
    perTypeTier.set(k, (perTypeTier.get(k) ?? 0) + 1);
  }

  const states = input.allocationStates.length ? input.allocationStates : [true];

  const legacyRows: RecoveryChargeRow[] = RECOVERY_CHARGES.map((policy) => {
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

    const elected = electionByType.get(policy.key) ?? null;

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
      // No instance and no owner label: a legacy row stands for a production
      // column owned by the engagement, and its anchor is never a cause.
      unplaced: false,
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
      // `?? null` is not defensive padding: MODE_BY_PLACEMENT has no entry for
      // `unplaced`, because no MODE produces it. A legacy row can never BE
      // unplaced — a production column always had a treatment to inherit — but
      // the map's type is honest about the gap rather than asserting a mode
      // that does not exist, so the read states what it does with it.
      effectiveMode:
        placements.length === 1
          ? (MODE_BY_PLACEMENT[placements[0]] ?? null)
          : null,
      totalCost,
      totalRecovery,
      serviceContext: svcPresent ? { cost: svcCost, recovery: svcRecovery } : null,
      options,
    };
  });

  // ── ONE ROW PER COMPONENT CHARGE ────────────────────────────────────────
  //
  // Not per type. Two charges of one type are two commercial facts and get two
  // controls, which is the capability this grain exists to give back.
  const componentRows: RecoveryChargeRow[] = componentCharges.map((c) => {
    const policy = chargePolicy(c.chargeKey);
    const unplaced = c.placement === "unplaced";
    const ambiguous = (perTypeTier.get(c.chargeKey) ?? 0) > 1;
    const ownerName =
      c.ownerRef !== undefined ? (input.ownerNames?.get(c.ownerRef) ?? null) : null;

    const options: ChargeModeOption[] = RECOVERY_MODES.map((mode) => {
      let reason: string | null = null;
      for (const perAssemblyAllocate of states) {
        reason = refusalFor(c.chargeKey, mode, {
          perAssemblyAllocate,
          // A component charge is its own fee. It carries no Direct Service
          // half, so nothing refuses on account of one.
          hasDirectServiceContribution: false,
        });
        if (reason) break;
      }
      return { mode, available: reason === null, reason };
    });

    const elected = electionByInstance.get(c.chargeInstanceId!) ?? null;

    return {
      chargeKey: c.chargeKey,
      chargeInstanceId: c.chargeInstanceId,
      // Shown only on collision, and NEVER an id when the name is missing.
      ownerLabel: ambiguous ? ownerName : null,
      unplaced,
      label: policy.label,
      grain: policy.grain,
      present: true,
      // One charge, one placement. `mixed` is a property of an aggregate and
      // cannot arise here — which is itself part of the point.
      placements: [c.placement],
      mixed: false,
      electedMode: elected,
      source: elected === null ? "legacy" : "election",
      // Null while unplaced: there is no treatment in force, and a mode here
      // would show the operator a decision nobody made.
      effectiveMode: unplaced ? null : (MODE_BY_PLACEMENT[c.placement] ?? null),
      totalCost: c.cost,
      totalRecovery: c.recoverableSell,
      // A component charge is never a Direct Service, so there is no second
      // half to hold apart.
      serviceContext: null,
      options,
    };
  });

  return [...legacyRows, ...componentRows];
}
