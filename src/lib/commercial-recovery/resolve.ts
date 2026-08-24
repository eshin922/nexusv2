/**
 * Commercial recovery — resolution.
 *
 * THE MIDDLE LAYER. Internal cost truth is the engine's; customer presentation
 * is the PDF's; this is the operator's answer to "how is each governed charge
 * recovered, and what does the customer see of it".
 *
 * ── THE INVARIANT THIS LAYER EXISTS TO PROTECT ───────────────────────────
 *
 * CORRECTED 2026-08-23. The earlier form of this was "Layer 1 is invariant
 * under recovery", which treated one property as two:
 *
 *     Recovery must NEVER change cost truth.
 *     Recovery MAY change sell composition and revenue.
 *
 * Cost truth — vendor cost, production cost, raw, duty and freight inputs —
 * is invariant under every election, and that is the accounting guarantee.
 * SELL CONSTRUCTION is not, and requiring it to be is what made recovery
 * unimplementable: moving a charge between the unit price, its own line and
 * nowhere is BY DEFINITION a change in how revenue is built.
 *
 * The stronger invariant was not merely inconvenient. It was the reason
 * `included` deleted a charge and `separate` billed it twice — the projection
 * was asked to relocate a charge while forbidden to touch the only layer that
 * decides where the charge lives. See
 * `tests/unit/commercial-recovery-election-effect.test.ts`.
 *
 * The boundary being carried forward is three parts, not two:
 *
 *     cost engine  ->  charge economics (invariant)
 *     commercial   ->  sell / recovery construction (the election applies HERE)
 *     projection   ->  render + freeze (consumes the result, decides nothing)
 *
 * The middle layer does not exist yet. Until it does, this file refuses every
 * election that would require it — which is every election that changes
 * anything.
 *
 * ── ABSENCE OF A ROW IS THE LOAD-BEARING STATE ───────────────────────────
 *
 * There is no fourth mode. `per_assembly` was never a commercial election — it
 * is the ABSENCE of one, and modelling it as a row that does not exist is what
 * keeps two different things apart:
 *
 *     no row          ->  nobody elected; read the legacy source
 *     row 'included'  ->  someone elected 'included'
 *
 * A fourth enum member would collapse those into one value and lose the
 * provenance. It also means NO BACKFILL is required: 89 existing quotes and 29
 * frozen snapshots resolve to exactly the behaviour that produced them with
 * zero rows in the table.
 *
 * ── LEGACY RESOLUTION IS PER-ASSEMBLY, NOT PER-QUOTE ─────────────────────
 *
 * `allocate_service_fees_to_cost` is a PER-ASSEMBLY boolean, and three real
 * quotes carry OFF and ON simultaneously — one of them already sent. So legacy
 * resolution for a one-time charge takes the assembly's own value; resolving
 * it once at quote level would flatten exactly the mixed state that must be
 * preserved.
 *
 * ── EXPLICIT ELECTIONS OVERRIDE PROJECTION ONLY ──────────────────────────
 *
 * An election NEVER writes `allocate_service_fees_to_cost`. That is what makes
 * the override non-destructive: clearing the election restores the preserved
 * per-assembly exceptions rather than resurrecting nothing.
 */

import {
  chargePolicy,
  refusalReason,
  RECOVERY_MODES,
  type RecoveryChargeKey,
  type RecoveryMode,
} from "./registry";

/** One stored election. Absence of a row for a charge is meaningful. */
export type ChargeElection = {
  chargeKey: RecoveryChargeKey;
  mode: RecoveryMode;
};

export type ResolvedCharge = {
  key: RecoveryChargeKey;
  mode: RecoveryMode;
  /**
   * Where the mode came from.
   *
   * `legacy` means no election row existed and the pre-recovery behaviour was
   * reproduced — which a surface may want to say out loud rather than
   * presenting an inherited value as a choice someone made.
   */
  source: "election" | "legacy";
};

/**
 * Resolve one charge for one assembly.
 *
 * `perAssemblyAllocate` is the assembly's own `allocate_service_fees_to_cost`.
 * It is ignored for `landed` charges, which have no assembly dimension.
 *
 * The legacy mapping is the existing behaviour restated, not a new decision:
 * allocating a fee into unit cost IS recovering it in the unit price
 * (`included`); not allocating it IS billing it separately (`separate`).
 */
export function resolveCharge(
  key: RecoveryChargeKey,
  election: ChargeElection | null | undefined,
  perAssemblyAllocate: boolean | null | undefined,
): ResolvedCharge {
  if (election) {
    // An election on a mode this charge cannot carry — statically, or in THIS
    // assembly's allocation state — is a defect upstream, not something to
    // honour quietly. Both refusal kinds resolve through one call so neither
    // can be enforced in one place and forgotten in another.
    const reason = refusalFor(key, election.mode, {
      perAssemblyAllocate,
    });
    if (reason) throw new RecoveryPolicyError(key, election.mode, reason);
    return { key, mode: election.mode, source: "election" };
  }

  const policy = chargePolicy(key);
  if (policy.grain === "landed") {
    // Today: `freightLines: []` and customs embedded silently in unit price.
    return { key, mode: "included", source: "legacy" };
  }

  // `?? true` carries the existing default from `commercial-projection`
  // unchanged. It is the pre-recovery behaviour, not a new choice.
  const allocate = perAssemblyAllocate ?? true;
  return { key, mode: allocate ? "included" : "separate", source: "legacy" };
}

/**
 * ── UNWIRED REFUSAL: `separate` ON A LANDED CHARGE ───────────────────────
 *
 * A DIFFERENT KIND OF REFUSAL from a policy one, and it says so rather than
 * borrowing its language. The Authority PERMITS freight and duty to be billed
 * separately; the registry records that. What refuses here is not policy — it
 * is that electing it today would do NOTHING.
 *
 * `projectCommercial` emits no freight or customs line: the whole landed cost
 * sits inside the unit rate. So a stored `separate` election on a landed
 * charge would be persisted, audited, shown as chosen, and change no number
 * anyone sees. That is the worst available outcome — worse than refusing, and
 * worse than a visible failure — because it looks settled.
 *
 * It is ALSO the open decision, not merely an implementation gap. Open
 * decision 2 (BV-011 §4.5) records that freight's PRESENTATION authority and
 * its ACCOUNTING destination are unreconciled and "will be read as competing"
 * unless stated explicitly. Shipping a freight presentation election while
 * that is open would create the second source of truth the decision exists to
 * prevent. Refusing until it closes is the decision being honoured, not
 * deferred.
 *
 * `included` stays available for landed charges, because `included` IS what
 * the projection does today — so electing it is honoured exactly.
 */
const LANDED_SEPARATE_UNWIRED =
  "Not available yet. Freight and duty are currently recovered inside the " +
  "unit price, and no separate line is produced — electing this would " +
  "change nothing the customer sees. It stays closed until freight's " +
  "presentation authority is reconciled with its accounting destination " +
  "(open decision 2, BV-011 §4.5).";

/**
 * A refusal that exists because the projection cannot honour the mode.
 *
 * Kept separate from policy refusals so the two are never confused: one says
 * the firm does not permit it, this one says the system would not do it.
 */
export function unwiredRefusal(
  key: RecoveryChargeKey,
  mode: RecoveryMode,
): string | null {
  if (mode !== "separate") return null;
  return chargePolicy(key).grain === "landed" ? LANDED_SEPARATE_UNWIRED : null;
}

export { LANDED_SEPARATE_UNWIRED };

/**
 * ── CONTEXTUAL REFUSAL ────────────────────────────────────────────────────
 *
 * ── THE LIFT WAS WITHDRAWN. included <-> separate IS NOT REVENUE-NEUTRAL. ──
 *
 * `included` and `separate` were lifted once the construction placed a charge
 * and every consumer read the placement. Certification against a real quote
 * disproved the premise, and the numbers are worth keeping:
 *
 *     52bd0077, global_price_adj_pct = 0.2000, electing `included` on
 *     project_setup:
 *
 *       tier 1   otc 4340 -> 4200   (-140)
 *                unit 10566 -> 10734 (+168)
 *                TOTAL 14906 -> 14934  (+28)
 *
 *     140 x 1.2 = 168.
 *
 * A charge inside the UNIT PRICE is multiplied by the quote's price
 * adjustment. Billed as its OWN LINE it is priced at the governed production
 * rate and the adjustment never touches it. So the two placements are not two
 * positions for one amount — they are two different amounts whenever an
 * adjustment is non-zero, and this quote carries 20%.
 *
 * The tripwire that was supposed to catch this used a fixture with
 * `globalPriceAdjPct: 0`, where the two placements coincide. A fixture that
 * cannot express the failure reports none — Pattern 60, in the test written to
 * guard exactly this property.
 *
 * ── WHY THE REFUSAL IS UNCONDITIONAL RATHER THAN "WHEN AN ADJUSTMENT APPLIES" ──
 *
 * Refusing only at a non-zero adjustment would be correct at election time and
 * wrong afterwards: an operator elects at 0%, someone later sets 20%, and the
 * customer's total shifts with nothing reporting it. That is a property holding
 * CONTINGENTLY, which is the shape this estate has been caught by before
 * (Pattern 56). It refuses until neutrality is structural.
 *
 * What opens it is a business decision, not an implementation: either the
 * constructor places a recovery so the adjustment treats both positions
 * identically, or the contract states that `included` is adjustment-bearing
 * and `separate` is not — in which case the two are NOT revenue-neutral by
 * design and the model's second mode means something different from what
 * #366 approved.
 *
 * ── AND `absorbed`, FOR ITS OWN REASON ───────────────────────────────────
 *
 * `absorbedCost` is read by nothing. The recovery correctly disappears; the
 * COST disappears with it, so the charge would vanish from cost truth while
 * DPS still pays it.
 */
const PLACEMENT_NOT_NEUTRAL =
  "Not available yet. A charge inside the unit price is multiplied by this " +
  "quote's price adjustment; billed as its own line it is not — so moving it " +
  "would change what the customer pays. Certified on a live quote at a 20% " +
  "adjustment: $140 out of the separate line became $168 in the unit price. " +
  "It opens once the two placements recover the same amount.";

const ABSORB_COST_UNCONSUMED =
  // Leads with what absorbing IS, because the card renders this mode beside
  // the two placements and an operator reading only the refusal would
  // otherwise take it for a third way of arranging the same money. It is not:
  // it gives the money up.
  "Not available yet. Absorbing is not a placement — DPS carries the charge " +
  "and takes no revenue for it, so margin falls. Today it would also drop " +
  "the charge's cost as well as its revenue, so the quote would stop " +
  "reflecting money DPS is still paying. It opens once an absorbed charge's " +
  "cost is retained.";

export { ABSORB_COST_UNCONSUMED, PLACEMENT_NOT_NEUTRAL };

/**
 * The state a refusal may depend on beyond the charge itself.
 *
 * Static policy lives in the registry; anything that varies per assembly
 * cannot, which is why it is a separate argument rather than a registry field.
 */
export type ChargeContext = {
  /** The assembly's own `allocate_service_fees_to_cost`. */
  perAssemblyAllocate?: boolean | null;
};

/**
 * A refusal that depends on state beyond the charge itself.
 *
 * `null` means nothing contextual objects — NOT that the mode is electable;
 * the static registry refusal is checked separately. Use `refusalFor`.
 */
export function contextualRefusal(
  key: RecoveryChargeKey,
  mode: RecoveryMode,
  ctx: ChargeContext,
): string | null {
  // Landed charges have no assembly dimension. Their `absorbed` refusal is the
  // static policy one — freight must be recovered, customs is statutory — and
  // must not be replaced by these.
  if (chargePolicy(key).grain !== "one_time") return null;

  if (mode === "absorbed") return ABSORB_COST_UNCONSUMED;

  // An election AGREEING with the legacy boolean changes no placement, so it
  // cannot move a total. Only a disagreeing one relocates the charge, and
  // relocation is what is not neutral.
  const allocate = ctx.perAssemblyAllocate ?? true;
  const wouldMove =
    (mode === "included" && !allocate) || (mode === "separate" && allocate);
  return wouldMove ? PLACEMENT_NOT_NEUTRAL : null;
}

/**
 * The one refusal question: may this charge carry this mode, here?
 *
 * Three sources, in order: what the firm does not permit, what the system
 * cannot yet honour, and what this assembly's state makes incoherent. `null`
 * means electable. Every caller —
 * resolution, the action layer, the workspace — asks THIS, so a mode cannot be
 * refused at one boundary and quietly allowed at another.
 */
export function refusalFor(
  key: RecoveryChargeKey,
  mode: RecoveryMode,
  ctx: ChargeContext = {},
): string | null {
  return (
    refusalReason(key, mode) ??
    unwiredRefusal(key, mode) ??
    contextualRefusal(key, mode, ctx)
  );
}

export type ModeAvailability = {
  mode: RecoveryMode;
  available: boolean;
  /** Governed reason, present exactly when `available` is false. */
  reason: string | null;
};

/**
 * Every mode with its verdict, for rendering.
 *
 * All three are always returned. The surface shows denied modes VISIBLY
 * DENIED WITH THE REASON rather than hiding them — a hidden option reads as
 * an option that does not exist, and a visibly-refused one teaches the policy.
 */
export function modeAvailability(
  key: RecoveryChargeKey,
  ctx: ChargeContext = {},
): ModeAvailability[] {
  return RECOVERY_MODES.map((mode) => {
    const reason = refusalFor(key, mode, ctx);
    return { mode, available: reason === null, reason };
  });
}

/**
 * Thrown when a mode is elected that policy denies.
 *
 * Carries the governed reason so the action layer can surface it verbatim.
 * The surface refuses too, but the surface is not the boundary — an election
 * arriving by any other path is refused here.
 */
export class RecoveryPolicyError extends Error {
  readonly chargeKey: RecoveryChargeKey;
  readonly mode: RecoveryMode;
  readonly reason: string;

  constructor(
    chargeKey: RecoveryChargeKey,
    mode: RecoveryMode,
    explicitReason?: string,
  ) {
    const reason =
      explicitReason ??
      refusalReason(chargeKey, mode) ??
      `'${mode}' is not available for ${chargeKey}.`;
    super(reason);
    this.name = "RecoveryPolicyError";
    this.chargeKey = chargeKey;
    this.mode = mode;
    this.reason = reason;
  }
}

/**
 * The freight amount to LIFT OUT of a unit line's rate, per unit.
 *
 * Zero under `included` — and, critically, zero is also the SHORT-CIRCUIT for
 * `separate`, because `rate - 0` is not guaranteed to reproduce `rate` once a
 * caller composes arithmetic around it. Subtracting a component and re-adding
 * it elsewhere need not return the original bits; that is the OD-025 lesson,
 * where exactly that shape moved `blendedMarginPct` on three real quotes from
 * a repair whose entire premise was that it moved no money.
 *
 * So the identity case returns 0 and callers leave the rate untouched rather
 * than computing a subtraction whose result they then trust.
 */
export function amountToDecompose(
  resolved: ResolvedCharge,
  amountWithMarkupPerUnit: number | null | undefined,
): number {
  if (resolved.mode !== "separate") return 0;
  const v = amountWithMarkupPerUnit ?? 0;
  return Number.isFinite(v) && v !== 0 ? v : 0;
}

/**
 * The amount to REMOVE from customer revenue without re-presenting it.
 *
 * This is the only mode that moves the total. `included` and `separate` are
 * revenue-neutral with respect to each other; `absorbed` is what pushes margin
 * toward the floor, and therefore what can require an authorization.
 */
export function amountAbsorbed(
  resolved: ResolvedCharge,
  amountWithMarkupPerUnit: number | null | undefined,
): number {
  if (resolved.mode !== "absorbed") return 0;
  const v = amountWithMarkupPerUnit ?? 0;
  return Number.isFinite(v) && v !== 0 ? v : 0;
}
