/**
 * The rule that decides whether an elected charge owes a resolved recovery, and
 * the sentence that reports a gap. Pure, and deliberately in its own module.
 *
 * `recovery-pricing.ts` reads the database, so importing it pulls `@/db` and it
 * cannot be loaded by a unit test. A rule whose correctness can only be
 * exercised through a mock of something else is a rule nobody checks — the same
 * reason `tier-label.ts` sits apart from the action that calls it.
 *
 * The reader re-exports both, so callers need not know they live here.
 *
 * ── WHAT THIS USED TO ASK, AND WHY IT NO LONGER DOES ────────────────────
 *
 * #496 (2026-08-28) made this gate require `quote_charge_instance_tiers.
 * recovery_ask` to be non-null. #501 (2026-08-29) removed the input that wrote
 * that column and made the charge TYPE the pricing authority — one day apart,
 * and the gate was not moved with it.
 *
 * The result was a governance regression rather than a stale name: the gate
 * demanded a value no surface could supply and no engine consumed, so any quote
 * carrying a costed, elected component charge could not be sent at all. It
 * survived because it needed a charge both costed AND elected to fire, and
 * until O3 no quote in the database had ever had one — the cost gate refused
 * first, every time. A gate that holds only because nothing reaches it.
 *
 * #496's invariant is unchanged and still enforced here: a component-owned
 * charge must not be sent while the recovery its elected treatment requires is
 * unresolved. Only the authority moved. The chain is now
 *
 *     tier cost -> charge-type markup authority -> derived governed recovery
 *
 * so "unresolved" means the derivation does not produce an amount, not that
 * nobody typed one.
 */

/**
 * Whether a treatment obliges a resolved recovery.
 *
 * `absorbed` does not, and that is not an omission: absorbing a charge IS the
 * decision to recover nothing, stated. The other two both put a governed amount
 * in front of the customer — `separate` as its own line, `included` inside the
 * unit price — and neither can be built from an amount that does not resolve.
 *
 * An UNPLACED charge is not this gate's business. The placement gate already
 * refuses it, and reporting the same charge twice for two reasons would send an
 * operator to fix a price on something they have not yet decided to bill.
 */
export function treatmentRequiresRecovery(mode: string | null): boolean {
  return mode === "separate" || mode === "included";
}

/**
 * WHY a charge is not ready — and therefore WHO can fix it.
 *
 * Carried as data rather than baked into a sentence because the four cases have
 * genuinely different owners, and the previous single message named the wrong
 * one for every case it reported. An operator sent to Costs to "enter what the
 * customer is charged" was being sent to a field that had been deleted.
 *
 *   `missing_cost`      the operator, on Costs
 *   `undecided`         the operator, in Commercial Recovery
 *   `no_authority`      nobody, through the quote — the charge type has no
 *                       governed markup category, or the category it maps to
 *                       has no row in `markup_defaults`. That is a pricing
 *                       CONFIGURATION fact, and telling an operator to type
 *                       something would be telling them to invent a rate
 *                       (BV-013).
 *   `unrepresentable`   the placement cannot be billed by the customer
 *                       projection, so the recovery would be revenue the
 *                       document never charges for.
 */
export type ChargeRecoveryGapReason =
  | "missing_cost"
  | "undecided"
  | "no_authority"
  | "unrepresentable";

export type ChargeRecoveryPricingGap = {
  chargeInstanceId: string;
  chargeKey: string;
  /** The charge's type label, and the operator's own label where there is one. */
  label: string;
  ownLabel: string | null;
  /** The causal component. */
  quoteLeafId: string;
  /** The elected treatment, where one was made. */
  mode: string | null;
  reason: ChargeRecoveryGapReason;
  /** Quoted tiers the gap applies at — named, so the operator can go and fix them. */
  missingTierIds: string[];
  missingTierLabels: string[];
};

/**
 * One operator-facing sentence per gap, naming the fact that is actually
 * resolvable and the surface that resolves it.
 *
 * The remediation is part of the sentence rather than appended once by the
 * caller, because it now differs per reason — and a single trailing "before
 * sending" clause is exactly how the dead "enter it on Costs" instruction
 * outlived the field it referred to.
 */
export function describeRecoveryGap(gap: ChargeRecoveryPricingGap): string {
  const name = gap.ownLabel ? `${gap.label} · ${gap.ownLabel}` : gap.label;
  const at = gap.missingTierLabels.join(", ");
  switch (gap.reason) {
    case "missing_cost":
      return `${name} — no cost entered at ${at}; enter what DPS pays on Costs`;
    case "undecided":
      return `${name} — recovery undecided; choose how it is recovered in Commercial Recovery`;
    case "no_authority":
      return (
        `${name} — no governed recovery rate resolves for this charge type, ` +
        `so it cannot be priced at ${at}. This is a pricing-configuration ` +
        `blocker, not something to enter on the quote`
      );
    case "unrepresentable":
      return `${name} — its recovery cannot be billed where it is placed; change the treatment in Commercial Recovery`;
  }
}

// ══════════════════════════════════════════════════════════════════════
// THE DECISION, PURE
// ══════════════════════════════════════════════════════════════════════
//
// It lives here rather than beside the query for the reason this module exists
// at all: a rule whose correctness can only be observed through a mock of the
// database is a rule nobody checks. `recovery-pricing.ts` now loads the rows
// and the governed markup rates and hands them over; every branch below is
// reachable from a fixture.
//
// `componentChargeEconomics` is imported, not reimplemented. There is no
// `cost * (1 + rate)` in this file and there must never be one — a second copy
// of that expression would be a second authority on what a charge recovers,
// free to disagree with the engine about whether a quote may go out. Both it
// and `isUnbillablePlacement` come from modules that import no database, which
// is what keeps this one safe for a client component to touch.

import { componentChargeEconomics } from "@/lib/costing";
import { isUnbillablePlacement } from "@/lib/commercial-recovery/unbillable-placements";
import type { RecoveryChargeKey } from "@/lib/commercial-recovery/registry";

/** One component-owned charge instance, as the tables hold it. */
export type ChargeRecoveryInstanceInput = {
  chargeInstanceId: string;
  chargeKey: string;
  ownLabel: string | null;
  /** Display name for the type, resolved by the caller from the registry. */
  label: string;
  quoteLeafId: string;
  /** The election, or null where none was made. */
  mode: string | null;
  /**
   * Tier id -> stated cost. A tier ABSENT here has no cost stated: a
   * `quote_charge_instance_tiers` row exists iff a positive cost was entered
   * (`readiness.ts`, Option A), so absence is unambiguous and zero never
   * appears.
   */
  costByTier: ReadonlyMap<string, number>;
};

/** The election's placement, in the vocabulary the projection predicate uses. */
function placementOf(mode: string | null): string {
  return mode === "separate"
    ? "separate_line"
    : mode === "included"
      ? "unit_price"
      : "unplaced";
}

/**
 * Every elected component charge whose recovery is unresolved.
 *
 * Keyed by `chargeInstanceId` throughout, never by `charge_key`. Two plate sets
 * on two components are two independent decisions: one being resolved must not
 * satisfy the other, and one failing must not implicate the other.
 *
 * Validated per (instance x quoted tier), in the order the facts depend on each
 * other — cost, then election, then representability, then authority. A charge
 * with no cost has nothing to price, and reporting it as unpriced would send an
 * operator to the wrong surface.
 */
export function computeChargeRecoveryGaps(input: {
  /** The QUOTED tiers. A charge resolved only at the tiers it happens to have
   *  rows for is complete only if those are all the tiers the quote sells. */
  tiers: readonly { id: string; label: string }[];
  instances: readonly ChargeRecoveryInstanceInput[];
  /** The governed markup rates for THIS quote — pinned once it is sent. */
  markupDefaults: Record<string, number>;
}): ChargeRecoveryPricingGap[] {
  const { tiers, instances, markupDefaults } = input;
  if (tiers.length === 0 || instances.length === 0) return [];

  // Per tier, because `ChargeEconomics` carries no tier. Each entry that comes
  // back is matched by charge instance, and the tier is the one this call was
  // made for. A `recoverableSell` of null is the engine saying the chain broke.
  const resolvedAt = new Map<string, Set<string>>();
  for (const t of tiers) {
    const rows = instances
      .filter((e) => e.costByTier.has(t.id))
      .map((e) => ({
        chargeInstanceId: e.chargeInstanceId,
        tierId: t.id,
        chargeKey: e.chargeKey as RecoveryChargeKey,
        ownerRef: e.quoteLeafId,
        cost: e.costByTier.get(t.id) as number,
      }));
    resolvedAt.set(
      t.id,
      new Set(
        componentChargeEconomics(rows, markupDefaults)
          .filter((c) => c.recoverableSell !== null)
          .map((c) => c.chargeInstanceId)
          .filter((id): id is string => typeof id === "string"),
      ),
    );
  }

  const gaps: ChargeRecoveryPricingGap[] = [];
  for (const e of instances) {
    const base = {
      chargeInstanceId: e.chargeInstanceId,
      chargeKey: e.chargeKey,
      label: e.label,
      ownLabel: e.ownLabel,
      quoteLeafId: e.quoteLeafId,
      mode: e.mode,
    };
    const all = () => ({
      missingTierIds: tiers.map((t) => t.id),
      missingTierLabels: tiers.map((t) => t.label),
    });

    // Cost first — the prior fact. Reported even though the send chain's cost
    // gate runs ahead of this one, so the diagnostic is complete on its own
    // terms rather than depending on call order to be correct.
    const uncosted = tiers.filter((t) => !e.costByTier.has(t.id));
    if (uncosted.length > 0) {
      gaps.push({
        ...base,
        reason: "missing_cost",
        missingTierIds: uncosted.map((t) => t.id),
        missingTierLabels: uncosted.map((t) => t.label),
      });
      continue;
    }

    // Then the election. `absorbed` is a stated decision to recover nothing and
    // is not a gap; no election at all is.
    if (!treatmentRequiresRecovery(e.mode)) {
      if (e.mode === null) gaps.push({ ...base, reason: "undecided", ...all() });
      continue;
    }

    // Representability, from the one exported predicate rather than a second
    // copy of the condition. A component charge has a parent assembly and so is
    // billable at either placement — but the rule is ASKED, not assumed, so a
    // future owner kind cannot slip through unexamined.
    if (isUnbillablePlacement({ ownerKind: "component", placement: placementOf(e.mode) })) {
      gaps.push({ ...base, reason: "unrepresentable", ...all() });
      continue;
    }

    // Finally the authority. Costed at every tier and elected, so an unresolved
    // recovery means the charge TYPE prices at nothing — `unclassified`, or a
    // governed category with no `markup_defaults` row. Neither is something an
    // operator can enter on the quote, which is why the copy says so.
    const unpriced = tiers.filter((t) => !resolvedAt.get(t.id)?.has(e.chargeInstanceId));
    if (unpriced.length > 0) {
      gaps.push({
        ...base,
        reason: "no_authority",
        missingTierIds: unpriced.map((t) => t.id),
        missingTierLabels: unpriced.map((t) => t.label),
      });
    }
  }
  return gaps;
}
