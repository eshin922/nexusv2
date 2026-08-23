/**
 * Commercial recovery — resolution.
 *
 * THE MIDDLE LAYER. Internal cost truth is the engine's; customer presentation
 * is the PDF's; this is the operator's answer to "how is each governed charge
 * recovered, and what does the customer see of it".
 *
 * ── THE INVARIANT THIS LAYER EXISTS TO PROTECT ───────────────────────────
 *
 * Layer 1 is INVARIANT under recovery. For one bundle and any two election
 * sets, every internal cost scalar is byte-identical; only revenue composition
 * and presentation move. Nothing here is readable by the costing engine.
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
 * ── CONTEXTUAL REFUSAL: AN ELECTION THE ENGINE CANNOT HONOUR ─────────────
 *
 * THE FINDING THIS ENCODES, established by falsification rather than by
 * reading the code: `tests/unit/commercial-recovery-election-effect.test.ts`.
 *
 * An election overrides PROJECTION only — deliberately, because writing
 * `allocate_service_fees_to_cost` would destroy the legacy behaviour that
 * clearing an election is supposed to restore. But the costing engine is what
 * decides whether a one-time fee sits inside the unit price, and it never sees
 * the election. So the projection can only suppress or emit the customer's
 * separate line; it cannot move the charge between the two places.
 *
 * The measured consequences, per tier, on a $1,000 fee at a 1.4 rate:
 *
 *     included, assembly NOT allocating  ->  line suppressed, unit price
 *                                            unchanged. The customer is
 *                                            billed $1,400 LESS. The charge
 *                                            is not moved; it is DELETED.
 *
 *     separate, assembly IS allocating   ->  line emitted, and the fee is
 *                                            still inside the unit price.
 *                                            $1,400 billed TWICE.
 *
 *     absorbed                           ->  see below.
 *
 * Both are silent: a plausible total, wrong by exactly one charge. So the only
 * elections that are currently correct are the ones that AGREE with the legacy
 * boolean — which is to say, the ones that change nothing.
 *
 * That is what this refuses down to. It is fail-closed and it is honest about
 * being a floor: `included <-> separate` becomes genuinely revenue-neutral,
 * and this refusal lifts, when the costing layer consumes the election. Until
 * then an inert model is strictly better than a mis-pricing one.
 *
 * ── AND WHY `absorbed` IS REFUSED IN BOTH ALLOCATION STATES ──────────────
 *
 * Allocating: the unit rate already recovers the charge, so suppressing the
 * line drops the line and leaves the revenue.
 *
 * NOT allocating: the charge WAS billed separately — and the engine records
 * separately-billed fees as "billed as fixed charges; not part of the per-unit
 * sell", so they were never in the tier revenue that
 * `fingerprintCommercialState`, the floor gate and the below-floor
 * authorization are all computed from. Absorbing therefore reduces what the
 * customer pays while the measured margin does not move at all. The decrease
 * is real and INVISIBLE to the control that exists to catch it, which is worse
 * than either of the two above.
 *
 * Neither is a re-amortisation problem this layer could solve by trying
 * harder. Both need the engine to consume the election.
 */
const ELECTION_DELETES_CHARGE =
  "Not available yet. This charge is billed separately today and is not in " +
  "the unit price, so presenting it as included would remove it from the " +
  "customer's total rather than move it — the quote would be short by the " +
  "full charge. It opens when the costing engine consumes the election.";

const ELECTION_DOUBLE_BILLS =
  "Not available yet. This charge is already inside the unit price, so " +
  "adding a separate line would bill it twice. It opens when the costing " +
  "engine consumes the election.";

const ABSORB_INVISIBLE_TO_FLOOR =
  "Not available yet. Absorbing this charge would reduce what the customer " +
  "pays without moving the margin the floor and the below-floor " +
  "authorization are measured from, so the reduction would pass every " +
  "control unseen. It opens when the costing engine consumes the election.";

export { ELECTION_DELETES_CHARGE, ELECTION_DOUBLE_BILLS, ABSORB_INVISIBLE_TO_FLOOR };

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
 * A refusal that depends on the assembly's state rather than on the charge.
 *
 * `null` means nothing contextual objects — NOT that the mode is electable;
 * the static registry refusal is checked separately. Use `refusalFor`.
 */
export function contextualRefusal(
  key: RecoveryChargeKey,
  mode: RecoveryMode,
  ctx: ChargeContext,
): string | null {
  // Landed charges have no assembly dimension and no allocation boolean.
  if (chargePolicy(key).grain !== "one_time") return null;

  // `?? true` is the same pre-recovery default the projection carried.
  const allocate = ctx.perAssemblyAllocate ?? true;

  if (mode === "absorbed") return ABSORB_INVISIBLE_TO_FLOOR;
  // Anything that DISAGREES with the legacy boolean asks the projection to do
  // something only the engine can do.
  if (mode === "included" && !allocate) return ELECTION_DELETES_CHARGE;
  if (mode === "separate" && allocate) return ELECTION_DOUBLE_BILLS;
  return null;
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
