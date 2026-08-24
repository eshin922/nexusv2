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
 * What electing a recovery contract does to the customer's total.
 *
 * ── WHY THIS IS A COUNTERFACTUAL AND NOT A FORMULA ──────────────────────
 *
 * The delta looks calculable. A legacy allocated charge enters the sell ladder,
 * so the customer pays `recovery x (1 + gpa)`; an elected one is added after
 * the ladder and recovers exactly `recovery`. Subtract, print.
 *
 * That would be wrong, and wrong in the way that is hardest to notice: the
 * ladder is not `(1 + gpa)`. A surgical lift multiplies it, a tier adjustment
 * replaces the global one, and a terminal cell override discards the rung
 * beneath it entirely — in which case electing changes the total by nothing at
 * all. A closed form for the delta is a second authority for the pricing
 * ladder, which is precisely what the sell constructor exists to remove.
 *
 * So the impact is measured by running the real engine on the real input with
 * the candidate election substituted, and reading the same projection the
 * customer document reads. No arithmetic here, and no rate.
 *
 * ── ON DEMAND, NOT ON RENDER ────────────────────────────────────────────
 *
 * One engine run per candidate election, and a row offers up to three. Doing
 * that for every charge on every render would put speculative work in a page
 * path for a figure the operator may never look at — the Pattern 55 shape.
 * This is called when an operator asks for one contract's impact.
 */

import { computeQuoteCosting, type QuoteCostingInput } from "@/lib/costing";
import { projectCommercial } from "@/lib/commercial-projection";
import type { HydrateSnapshot } from "@/lib/costing-store";
import type { RecoveryChargeKey, RecoveryMode } from "./registry";
import type { ChargeElection } from "./resolve";
import { ownedPlacedCharges } from "./construct";

export type RecoveryImpact = {
  chargeKey: RecoveryChargeKey;
  /** The contract measured. NULL means clearing back to the inherited one. */
  mode: RecoveryMode | null;
  /**
   * The governed recovery this contract would recover, summed over every
   * (owner, tier) placing the charge. Read off the construction.
   */
  governedRecovery: number | null;
  /**
   * The amortization basis this contract would produce, when it produces one.
   *
   * From the constructor, never divided here. Null for a contract that
   * amortizes nothing — and null for a LEGACY amortization, whose recovered
   * amount moves with the ladder and therefore has no fixed per-unit figure.
   */
  perUnit: number | null;
  tierQuantity: number | null;
  /** The customer's total across every tier, now and under this contract. */
  customerTotalBefore: number;
  customerTotalAfter: number;
  /** Per tier, so a multi-tier quote does not hide where the change lands. */
  tiers: {
    tierId: string;
    label: string;
    before: number;
    after: number;
  }[];
};

/** The customer document's own totals, from the projection it renders from. */
function customerTiers(input: QuoteCostingInput) {
  const costing = computeQuoteCosting(input);
  const bundle = {
    markupDefaults: input.markupDefaults,
    skus: input.skus,
    production: input.production,
    costing,
  } as unknown as HydrateSnapshot;
  const projected = projectCommercial(bundle);
  return { costing, tiers: projected.tiers };
}

/**
 * Measure one candidate contract.
 *
 * `mode === null` measures CLEARING — restoring the inherited treatment — which
 * is a real economic change in its own right and the one an operator is most
 * likely to assume is free.
 */
export function measureRecoveryImpact(
  input: QuoteCostingInput,
  chargeKey: RecoveryChargeKey,
  mode: RecoveryMode | null,
): RecoveryImpact | null {
  const before = customerTiers(input);

  // Substitute, never mutate: the input the caller holds is the one the page
  // was built from, and moving it under them would make the "before" figure
  // describe a state that no longer exists.
  const others = (input.chargeElections ?? []).filter(
    (e) => e.chargeKey !== chargeKey,
  );
  const candidate: ChargeElection[] =
    mode === null ? others : [...others, { chargeKey, mode }];

  const after = customerTiers({ ...input, chargeElections: candidate });

  // The construction is the authority for the charge's own figures. Summed
  // over placements rather than picked from one, because a quote can place the
  // same charge at several owners.
  //
  // LEAF ROLLUPS ONLY. An assembly's rollup carries the merge of its children's
  // charges, so summing every rollup double-counts: this reported $2,800
  // recovered on a $1,400 charge until a test compared it against the engine.
  const leafIds = new Set(
    input.skus.filter((s) => s.skuRole === "leaf").map((s) => s.id),
  );
  const owned = ownedPlacedCharges(after.costing, (id) => leafIds.has(id));
  let governedRecovery: number | null = 0;
  let perUnit: number | null = null;
  let tierQuantity: number | null = null;
  let seen = false;
  // Tracked explicitly. Nulling `perUnit` on disagreement is not enough: the
  // next matching instance finds it null again and re-sets it, so
  // [0.14, 0.20, 0.14] would report 0.14 as agreed.
  let basisDisagreed = false;

  for (const { charge: c } of owned) {
    if (c.chargeKey !== chargeKey) continue;
    seen = true;
    if (governedRecovery !== null) {
      // An unknown recovery makes the total unknown, not smaller (BV-013).
      governedRecovery =
        c.recoverableSell === null ? null : governedRecovery + c.recoverableSell;
    }
    if (c.amortization) {
      // Reported only when every amortized instance agrees, so a single figure
      // is never printed for a quote that has two.
      if (perUnit === null && !basisDisagreed) {
        perUnit = c.amortization.perUnit;
        tierQuantity = c.amortization.tierQuantity;
      } else if (perUnit !== c.amortization.perUnit) {
        basisDisagreed = true;
        perUnit = null;
        tierQuantity = null;
      }
    }
  }

  if (!seen) return null;

  const byTier = new Map(before.tiers.map((t) => [t.tierId, t]));
  const total = (rows: { tierCommercialTotal: number }[]) =>
    rows.reduce((a, t) => a + t.tierCommercialTotal, 0);

  return {
    chargeKey,
    mode,
    governedRecovery,
    perUnit,
    tierQuantity,
    customerTotalBefore: total(before.tiers),
    customerTotalAfter: total(after.tiers),
    tiers: after.tiers.map((t) => ({
      tierId: t.tierId,
      label: t.tierLabel,
      before: byTier.get(t.tierId)?.tierCommercialTotal ?? 0,
      after: t.tierCommercialTotal,
    })),
  };
}
