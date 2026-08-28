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
import type { ChargeEconomicsState } from "@/lib/component-charges/readiness";
import { RECOVERY_MODES } from "./registry";
import { refusalFor, type ChargeElection } from "./resolve";
import {
  MODE_BY_PLACEMENT,
  ownedPlacedCharges,
  type ConstructedRollups,
} from "./construct";
import type {
  ChargePlacement,
  OwnedPlacedCharge,
  PlacedCharge,
} from "./construct";

export type ChargeModeOption = {
  mode: RecoveryMode;
  available: boolean;
  /** Governed reason, present exactly when `available` is false. */
  reason: string | null;
};

/**
 * One tier's economics for one decision — the unit that is never summed away.
 *
 * `cost` is what DPS pays IN THAT SCENARIO, already summed across any owners
 * legitimately additive within it. `recovery` is null when nothing governs
 * what the charge recovers (BV-013): unknown, never zero.
 */
export type TierAmount = {
  tierId: string;
  cost: number;
  recovery: number | null;
};

/**
 * What to print for a decision whose economics vary by scenario.
 *
 * PRESENTATION ONLY. Nothing stores a range, nothing computes from one, and no
 * downstream consumer may treat `min`/`max` as an economic figure — they are
 * two members of the vector, chosen because they bound it.
 */
export type AmountDisplay =
  | { kind: "none" }
  | { kind: "unpriced" }
  | { kind: "single"; value: number }
  | { kind: "range"; min: number; max: number };

/**
 * Collapse a tier vector for display.
 *
 *   equal across tiers  → one amount        Tooling 700/700/700/700 → $700
 *   differing           → min–max           Setup 100/500/1000/1000 → $100–$1,000
 *
 * A range says two true things at once — the charge is this much in some
 * scenario and that much in another — where a sum said one false thing. And it
 * makes variance VISIBLE, which the operator should see before choosing a
 * treatment rather than after.
 */
export function displayRecovery(perTier: readonly TierAmount[]): AmountDisplay {
  if (perTier.length === 0) return { kind: "none" };
  // Unknown recovery makes the whole display unknown, not smaller. One tier
  // with no governed rate is enough: printing the others would state a figure
  // for a decision whose economics are not fully governed.
  if (perTier.some((t) => t.recovery === null)) return { kind: "unpriced" };
  const values = perTier.map((t) => t.recovery as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Compared on cents, so floating-point noise cannot turn a flat charge into
  // a range of itself.
  return Math.round(min * 100) === Math.round(max * 100)
    ? { kind: "single", value: min }
    : { kind: "range", min, max };
}

/** The same collapse over cost rather than recovery. */
export function displayCost(perTier: readonly TierAmount[]): AmountDisplay {
  if (perTier.length === 0) return { kind: "none" };
  const values = perTier.map((t) => t.cost);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Math.round(min * 100) === Math.round(max * 100)
    ? { kind: "single", value: min }
    : { kind: "range", min, max };
}

/**
 * Group placed charges into a tier vector.
 *
 * ── THE ONE PLACE THE DIMENSIONAL RULE LIVES ────────────────────────────
 *
 * Owners within a tier are summed; tiers are kept apart. Both halves are here
 * so neither can be applied without the other — the defect this replaces was
 * exactly one loop doing both at once.
 */
export function tierVector(charges: readonly OwnedPlacedCharge[]): TierAmount[] {
  const byTier = new Map<string, TierAmount>();
  for (const { tierId, charge } of charges) {
    const at = byTier.get(tierId);
    if (!at) {
      byTier.set(tierId, {
        tierId,
        cost: charge.cost,
        recovery: charge.recoverableSell,
      });
      continue;
    }
    // ADDITIVE WITHIN THE TIER. Two owners each causing this charge in this
    // scenario cost the sum of both, and that is a real number the customer
    // would pay.
    at.cost += charge.cost;
    at.recovery =
      at.recovery === null || charge.recoverableSell === null
        ? null
        : at.recovery + charge.recoverableSell;
  }
  return [...byTier.values()];
}

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
  /**
   * Whether an operator has stated what this charge COSTS — OD-032 step B.
   *
   * ── WHY A RECOVERY SURFACE CARES ────────────────────────────────────────
   *
   * Recovery decides how a cost is recovered. A charge with no cost has
   * nothing to recover, so a control over it is inert — the same shape as the
   * Direct Service case, where a row advertised $9,800 for an election that
   * could move nothing.
   *
   * Worse, before this the charge did not appear at all: it produces no
   * economics, so it reached neither this surface nor the send gate, and an
   * operator could author a charge, have nothing price it, and send with
   * nothing reporting the loss. Rendering it as OUTSTANDING is the repair;
   * omitting it was the defect.
   *
   * Null when economics were not assessed by the caller — stated as unknown
   * rather than assumed complete.
   */
  economics: ChargeEconomicsState | null;
  /** Quoted tiers with no cost stated. Empty unless `economics` is `partial`. */
  missingTierLabels: string[];
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
   * THE AUTHORITATIVE ECONOMIC REPRESENTATION — one entry per quoted tier.
   *
   * ── WHY THIS REPLACED A SINGLE TOTAL ────────────────────────────────────
   *
   * The row used to carry `totalCost` / `totalRecovery`, summed across every
   * `(owner, tier)` entry the construction yielded. `ownedPlacedCharges` emits
   * per (owner, tier), so for a single-owner charge that total was literally
   * the per-tier amount multiplied by the number of tiers.
   *
   * Measured on production 2026-08-27, quote 4781e4bb with four tiers:
   *
   *   Tooling        $500 flat per tier  → row showed $2,000 / $2,800 shown
   *   Artwork        $2,000 flat          → $8,000 / $11,200
   *   Project setup  100 / 500 / 1000 / 1000 → $2,600
   *
   * The customer document on the SAME PAGE stated Tooling at $700 per tier.
   * The card said $2,800. And project setup's $2,600 is true of no tier the
   * customer can buy — it is not an overstatement of a real figure, it is a
   * figure with no referent.
   *
   * ── THE DIMENSIONAL RULE ────────────────────────────────────────────────
   *
   * Owners within the same tier MAY be additive: two cartons each causing
   * print plates really do cost the sum of both, in that scenario. Tiers are
   * ALTERNATIVE SCENARIOS and are never additive — the customer buys one.
   *
   * So the collapse groups by tier, sums across owners inside a tier where the
   * legacy model requires it, and never sums one tier into another. What
   * survives is a vector, and the vector is the authority. A range is derived
   * from it for display and is stored nowhere.
   */
  perTier: TierAmount[];
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
  serviceContext: { perTier: TierAmount[] } | null;
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
  /**
   * Per-instance economics state — OD-032 step B.
   *
   * Supplied by the caller from `readComponentChargeReadiness`, which reads the
   * instance and tier tables directly. It is NOT derivable here: this function
   * projects the CONSTRUCTED costing, and a charge with no economics was never
   * constructed. That is the whole reason an uncosted charge was invisible.
   *
   * Optional, and its absence is handled honestly — rows report `economics:
   * null`, meaning "not assessed", rather than being assumed complete.
   */
  chargeEconomics?: ReadonlyMap<
    string,
    {
      state: ChargeEconomicsState;
      chargeKey: RecoveryChargeKey;
      ownLabel: string | null;
      missingTierLabels: string[];
    }
  >;
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
  const placedByCharge = new Map<RecoveryChargeKey, OwnedPlacedCharge[]>();
  const componentCharges: OwnedPlacedCharge[] = [];
  for (const owned of ownedPlacedCharges(input.costing, input.isLeaf)) {
    const charge = owned.charge;
    if (charge.chargeInstanceId) {
      // Component-owned. It gets its own row below and must NOT be aggregated
      // into the type row, or two charges would share one control again.
      componentCharges.push(owned);
      continue;
    }
    const list = placedByCharge.get(charge.chargeKey) ?? [];
    list.push(owned);
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
  // ── COUNTED BY INSTANCE, NEVER BY TIER ENTRY ──────────────────────────
  //
  // `componentCharges` holds one entry per (instance, tier), so counting it
  // directly told an operator a charge costed at four tiers was four charges —
  // and the group control offered "All 4 print plates charges" for one.
  const instancesPerKey = new Map<string, Set<string>>();
  for (const { charge } of componentCharges) {
    const set = instancesPerKey.get(charge.chargeKey) ?? new Set<string>();
    set.add(charge.chargeInstanceId as string);
    instancesPerKey.set(charge.chargeKey, set);
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
    const actionable = placed.filter((p) => p.charge.ownerKind !== "direct_service");
    const placements = [...new Set(actionable.map((p) => p.charge.placement))];

    // Split by COMMERCIAL GRAIN, not by charge key. A one-time fee is
    // actionable; a Direct Service leaf is already a priced customer line.
    // Done for every charge uniformly rather than special-casing the one that
    // surfaced it -- the classification pass found `rd_formulation` is the only
    // charge carrying a service contribution today, and a rule that only knew
    // about that key would be a fix for this quote rather than for the shape.
    //
    // ── AND BY TIER, WHICH IS THE OTHER HALF ─────────────────────────────
    //
    // This used to be one loop accumulating a single total across every
    // (owner, tier) entry, which multiplied a flat charge by the tier count
    // and gave a varying one a figure true of no tier at all. `tierVector`
    // sums owners WITHIN a tier and keeps tiers apart, which is the only
    // combination that is true in every scenario.
    const svc = placed.filter((p) => p.charge.ownerKind === "direct_service");
    const perTier = tierVector(actionable);
    const svcPerTier = tierVector(svc);

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
          hasDirectServiceContribution: svc.length > 0,
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
      present: actionable.length > 0,
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
      perTier,
      // A legacy row stands for a production column, whose amount lives on that
      // column. There is no instance and no per-tier economics to be missing,
      // so this is not "complete" — the question does not apply.
      economics: null,
      missingTierLabels: [],
      // Held apart, and now per tier for the same reason the actionable half
      // is: a Direct Service contribution summed across scenarios is the same
      // false figure in a smaller font.
      serviceContext: svc.length > 0 ? { perTier: svcPerTier } : null,
      options,
    };
  });
  // ── ONE ROW PER CHARGE INSTANCE ─────────────────────────────────────────
  //
  // Not per type — two charges of one type are two commercial facts and get
  // two controls, which is the capability this grain exists to give back.
  //
  // And not per (instance, tier), which is what this used to be. `componentCharges`
  // holds one entry per tier, so a single charge costed at four tiers rendered
  // as FOUR identical rows with four controls, and the group control — which
  // appears when a type has two or more rows — offered "All 4 print plates
  // charges" for one charge. Using it would have sent four proposals carrying
  // the same instance id, which `persistChargeRecoverySet` refuses outright:
  // "two proposals for one instance is a surface defect". The guard was right.
  //
  // Measured on production 2026-08-27: 10 rendered rows, 7 distinct ids, one
  // instance appearing 4 times. Legacy rows were unaffected because they were
  // already aggregated by key — the two grains simply never met on a quote
  // where a component charge had been costed at more than one tier.
  const byInstance = new Map<string, OwnedPlacedCharge[]>();
  for (const owned of componentCharges) {
    const id = owned.charge.chargeInstanceId as string;
    byInstance.set(id, [...(byInstance.get(id) ?? []), owned]);
  }

  const componentRows: RecoveryChargeRow[] = [...byInstance.entries()].map(
    ([chargeInstanceId, entries]) => {
      // Every entry is the same charge in a different scenario, so the
      // identity-bearing fields are read from any of them.
      const c = entries[0].charge;
      const policy = chargePolicy(c.chargeKey);
      // The decision is one decision. A charge placed in one tier and not
      // another is not a state the model can produce — placement is keyed by
      // instance — so `unplaced` is a property of the instance, and asserting
      // it from every entry rather than the first would only hide that.
      const unplaced = entries.every((e) => e.charge.placement === "unplaced");
      const ambiguous = (instancesPerKey.get(c.chargeKey)?.size ?? 0) > 1;
      const ownerName =
        c.ownerRef !== undefined ? (input.ownerNames?.get(c.ownerRef) ?? null) : null;
      const perTier = tierVector(entries);

    const economics = input.chargeEconomics?.get(c.chargeInstanceId!)?.state ?? null;
    const missingTierLabels =
      input.chargeEconomics?.get(c.chargeInstanceId!)?.missingTierLabels ?? [];

    const options: ChargeModeOption[] = RECOVERY_MODES.map((mode) => {
      // ── INCOMPLETE COST, NO PLACEMENT ────────────────────────────────
      //
      // Refused before every other rule, because it is prior to them: a
      // treatment applies to an amount, and there is not a whole one yet.
      //
      // BOTH incomplete states, not just the empty one. `partial` is the more
      // interesting refusal: that charge has a real amount, so a control over
      // it looks perfectly serviceable and would take a decision made against
      // economics that are still moving. The operator would then have to come
      // back and re-decide once the missing tiers were costed — and nothing
      // would tell them to.
      //
      // Disposition, Edward 2026-08-27: "I don't think we should let Recovery
      // make a commercial decision until Costs has completed the charge across
      // all quoted tiers." Setup defines it → Costs completes it → Recovery
      // decides it, in that order, with the surface enforcing the order rather
      // than the operator remembering it.
      let reason: string | null =
        economics === "none"
          ? "This charge has no cost yet. Enter what DPS pays on Costs before deciding how it is recovered."
          : economics === "partial"
            ? `This charge has no cost at ${missingTierLabels.join(", ")}. ` +
              "Complete it on Costs before deciding how it is recovered."
            : null;
      if (reason === null) {
        for (const perAssemblyAllocate of states) {
          reason = refusalFor(c.chargeKey, mode, {
            perAssemblyAllocate,
            // A component charge is its own fee. It carries no Direct Service
            // half, so nothing refuses on account of one.
            hasDirectServiceContribution: false,
          });
          if (reason) break;
        }
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
      perTier,
      economics,
      missingTierLabels,
      // A component charge is never a Direct Service, so there is no second
      // half to hold apart.
      serviceContext: null,
      options,
      };
    },
  );

  // ── CHARGES THE ENGINE NEVER SAW ────────────────────────────────────────
  //
  // A charge with no economics at all produces no `PlacedCharge`, so it has no
  // row above. Before this it therefore appeared NOWHERE — not on this surface
  // and not at the send gate — and an operator could author a charge, have
  // nothing price it, and send the quote with nothing reporting the omission.
  //
  // Synthesized from the structural fact instead. The row exists because the
  // CHARGE exists; that it has no amount is what the row is there to say.
  const placedInstances = new Set(
    componentCharges
      .map((o) => o.charge.chargeInstanceId)
      .filter(Boolean) as string[],
  );
  const uncostedRows: RecoveryChargeRow[] = [];
  for (const [chargeInstanceId, e] of input.chargeEconomics ?? []) {
    if (e.state !== "none" || placedInstances.has(chargeInstanceId)) continue;
    const policy = chargePolicy(e.chargeKey);
    uncostedRows.push({
      chargeKey: e.chargeKey,
      chargeInstanceId,
      // The operator's own label, which is what tells two charges of a type
      // apart. Not the collision-only owner name — that is computed from placed
      // charges, and this one is not among them.
      ownerLabel: e.ownLabel,
      // Nobody has decided who bears it, because nobody could: there is no
      // amount to bear. Both facts are true and both are said.
      unplaced: true,
      economics: "none",
      missingTierLabels: e.missingTierLabels,
      label: policy.label,
      grain: policy.grain,
      present: true,
      placements: [],
      mixed: false,
      electedMode: null,
      source: "election",
      effectiveMode: null,
      // EMPTY, NOT ZERO. There are no tier economics at all — the cost is
      // unknown, not nothing, which is BV-013s distinction applied to the
      // other side of it. An empty vector displays as `none`; a vector of
      // zeroes would claim the charge costs nothing in every scenario.
      perTier: [],
      serviceContext: null,
      options: RECOVERY_MODES.map((mode) => ({
        mode,
        available: false,
        reason:
          "This charge has no cost yet. Enter what DPS pays on Costs before deciding how it is recovered.",
      })),
    });
  }

  return [...legacyRows, ...componentRows, ...uncostedRows];
}
