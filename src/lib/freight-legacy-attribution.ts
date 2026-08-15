/**
 * Legacy freight attribution — a compatibility read for frozen records that
 * predate shipment membership.
 *
 * WHAT THIS IS NOT. It is not freight policy. Current freight distribution is
 * an equal split across a shipment's recorded members, and a shipment with no
 * members FAILS CLOSED: the operator records what is in it before Send. That
 * rule is not softened here and this module is unreachable from the draft path.
 *
 * WHAT IT IS. DPS-1050 was sent, accepted, PDF'd and pushed to NetSuite under
 * the previous model, where a shipment's freight was attributed to one leaf
 * resolved from its assembly. Membership was never recorded because nothing
 * required it. Reading that quote under the new rule finds no recipient and
 * drops $650 of real cost from a completed, customer-facing quote.
 *
 * The fix is not to invent the membership — writing `freight_subcategory_items`
 * now would manufacture historical operational data after the fact, and the
 * fact that the candidate Item Group happens to be closed does not make the
 * record true. It is to READ WHAT WAS ALREADY FROZEN. The snapshot captured
 * `costingContext.ownerSkuByAssembly` at send: not a reconstruction of the
 * attribution, but the attribution itself, stored at the moment it was used.
 *
 * So this reproduces a sent quote's own economics from its own snapshot. It
 * creates nothing, persists nothing, and cannot run on a live quote.
 */

/**
 * The instant shipment membership became a required cost input — the same
 * change that made distribution an equal split and added the Send gate.
 *
 * A frozen record captured BEFORE this was made under a contract that did not
 * ask for membership, so its absence is a property of that contract. A record
 * frozen after it can only have empty membership by defect, and gets no
 * compatibility: it fails closed like any current quote.
 *
 * This closes the door rather than holding it open. The population it admits
 * is finite and, at the time of writing, has exactly one member.
 */
export const MEMBERSHIP_REQUIRED_FROM = new Date("2026-08-15T00:00:00.000Z");

/** The shape this needs from a frozen workbook. Structural, so tests need no db. */
export type FrozenAttributionContext = {
  ownerSkuBySubcategory?: Record<string, string> | null;
  ownerSkuByAssembly?: Record<string, string> | null;
};

export type LegacyAttributionQuery = {
  /** When the snapshot was captured — the discriminator, not the quote's age. */
  frozenAt: Date;
  subcategoryId: string;
  assemblyId: string | null;
  /** Members recorded in the FROZEN workbook for this shipment. */
  frozenMemberCount: number;
  costingContext: FrozenAttributionContext | null | undefined;
};

export type LegacyAttribution =
  | { eligible: true; memberSkuId: string }
  | { eligible: false; reason: LegacyIneligibility };

export type LegacyIneligibility =
  | "membership_recorded"
  | "frozen_after_enforcement"
  | "no_recorded_anchor";

/**
 * Resolve the attribution a frozen legacy shipment was sent with, or refuse.
 *
 * Every refusal means the same thing to the caller — contribute nothing — but
 * they are named separately because they are different situations and the one
 * that matters is `no_recorded_anchor`: a frozen record with neither membership
 * nor a stored anchor has no historical attribution to preserve, and guessing
 * one would be the manufacturing this module exists to avoid.
 */
export function resolveLegacyFreightAttribution(
  query: LegacyAttributionQuery,
): LegacyAttribution {
  // Ordered so the most specific condition answers first: a shipment WITH
  // membership is not a legacy case at all, whatever its date.
  if (query.frozenMemberCount > 0) return { eligible: false, reason: "membership_recorded" };

  // `>=` so the boundary instant itself is already the new contract. A frozen
  // record is dated by its capture, not by when the quote was created — a
  // quote begun under the old model and sent under the new one was sent
  // against the gate, so its membership is present or its send was refused.
  if (query.frozenAt.getTime() >= MEMBERSHIP_REQUIRED_FROM.getTime())
    return { eligible: false, reason: "frozen_after_enforcement" };

  const context = query.costingContext ?? {};
  const anchor =
    context.ownerSkuBySubcategory?.[query.subcategoryId] ??
    (query.assemblyId ? context.ownerSkuByAssembly?.[query.assemblyId] : undefined);

  // Read, never derive. There is no fallback to a lowest-position leaf, an id,
  // a timestamp, a cost share or a quantity — the policy excludes all of them,
  // and an absent anchor means the record does not say, so neither do we.
  if (typeof anchor !== "string" || anchor.length === 0)
    return { eligible: false, reason: "no_recorded_anchor" };

  return { eligible: true, memberSkuId: anchor };
}
