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
 * ── CONTEXTUAL REFUSAL: `absorbed` ON AN ALREADY-ALLOCATED CHARGE ────────
 *
 * `absorbed` means DPS carries the cost and takes NO customer revenue for the
 * charge, so it emits no customer line. That is exact ONLY when the charge is
 * not already inside the unit rate.
 *
 * When the assembly allocates service fees into cost, the unit price is
 * ALREADY recovering the charge. Suppressing the line there would drop the
 * line and leave the revenue in the rate — a silently wrong total rather than
 * a visible failure, which is the worse of the two by a wide margin.
 *
 * Removing it properly means RE-AMORTISING the unit rate. That is engine
 * arithmetic this layer does not own, and reaching for it here is exactly the
 * OD-025 shape: subtract a component, re-add it, and the bits do not come
 * back. So this refuses, and it refuses in the POLICY LAYER rather than at the
 * projection seam, because it is a commercial rule about what an operator may
 * elect — not an implementation detail of one producer.
 *
 * Two things this deliberately does NOT do, per the standing disposition:
 * it does not re-amortise unit pricing, and it does not auto-flip
 * `allocate_service_fees_to_cost`. The operator turns allocation off first;
 * the election is theirs to make, not ours to infer.
 */
export const ALLOCATED_ABSORPTION_REFUSAL =
  "Already recovered in the unit price. Absorbing it would remove the " +
  "customer line while leaving its revenue inside the unit rate, so the " +
  "total would be silently wrong. Turn off “allocate service fees to " +
  "cost” for this assembly first — re-amortising the unit rate is not " +
  "owned by this layer.";

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
  if (mode !== "absorbed") return null;
  // Landed charges have no assembly dimension and no allocation boolean.
  if (chargePolicy(key).grain !== "one_time") return null;
  // `?? true` is the same pre-recovery default the projection carried.
  return (ctx.perAssemblyAllocate ?? true) ? ALLOCATED_ABSORPTION_REFUSAL : null;
}

/**
 * The one refusal question: may this charge carry this mode, here?
 *
 * Static policy first, then context. `null` means electable. Every caller —
 * resolution, the action layer, the workspace — asks THIS, so a mode cannot be
 * refused at one boundary and quietly allowed at another.
 */
export function refusalFor(
  key: RecoveryChargeKey,
  mode: RecoveryMode,
  ctx: ChargeContext = {},
): string | null {
  return refusalReason(key, mode) ?? contextualRefusal(key, mode, ctx);
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
