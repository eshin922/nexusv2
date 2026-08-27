/**
 * The frozen recovery instruction, projected from the construction.
 *
 * ── EVERY PLACED CHARGE, NOT EVERY ELECTED ONE ──────────────────────────
 *
 * A legacy-placed charge has no election row — absence of a row is the model's
 * load-bearing state — so an instruction built from elections would record
 * nothing for the great majority of charges. Every live quote today is in that
 * state, so it would freeze nothing at all.
 *
 * This walks the CONSTRUCTION, which places every charge whether an operator
 * elected it or not, and carries `source` so a reader can tell which happened.
 *
 * ── PROJECTED, NOT RECOMPUTED ───────────────────────────────────────────
 *
 * Every figure is copied from the `PlacedCharge` the engine built. Nothing is
 * re-derived and no rate is resolved, so the frozen instruction and the
 * customer document cannot disagree about a charge — which is the property the
 * whole seam exists to hold.
 */

import { ownedPlacedCharges, type ConstructedRollups } from "./construct";
import type { ChargePlacement } from "./construct";
import type { RecoveryChargeKey } from "./registry";

export type FrozenRecoveryInstruction = {
  chargeKey: RecoveryChargeKey;
  /** Assembly or quote-leaf id. Traceability, not a join key. */
  ownerRef: string;
  tierId: string;
  /**
   * The durable instance identity — OD-032 P-3, and the reason this field
   * exists at all.
   *
   * Without it, two Print plates charges caused by the SAME carton freeze as
   * two rows identical in every column but their amounts, and an accountant
   * cannot tell which instruction belongs to which charge. That is the exact
   * case OD-032 exists to make representable, so the record Accounting bills
   * from has to be able to represent it too.
   *
   * NULL ONLY for a legacy-placed charge, which has no election and therefore
   * no instance. NOT NULL for every component-owned charge, which cannot exist
   * without one — asserted, because a null there would mean identity was lost
   * between authoring and freeze.
   */
  chargeInstanceId: string | null;
  treatment: ChargePlacement;
  treatmentSource: "election" | "legacy";
  /** What DPS pays. */
  cost: number;
  /**
   * What DPS intends to recover, or null when no governed rate resolved.
   *
   * The GOVERNED figure, which for a legacy unit-price placement is not the
   * realized one — see `amortizedPerUnit`.
   */
  governedRecovery: number | null;
  /** What Accounting bills separately. 0 for an amortized charge. */
  separateInvoiceAmount: number | null;
  /**
   * The amortization basis, present only where the recovery is FIXED: an
   * elected unit-price placement, whose governed recovery is added after the
   * pricing ladder.
   *
   * Null for a legacy allocated fee, whose recovered amount moves with the
   * quote-level adjustment and so has no per-unit figure to state. Null is the
   * honest answer there; the governed $0.14 would be a number an accountant
   * would act on beside a charge the customer paid $0.168 for.
   */
  amortizedPerUnit: number | null;
  tierQuantity: number | null;
};

/**
 * One instruction per placed charge per (owner, tier).
 *
 * The owner is the rollup the construction hangs on. An assembly's rollup
 * carries the MERGED charges of its children, so taking instructions from every
 * rollup would record each charge twice — once at the leaf that owns it and
 * once at the parent it bubbled to. `leafOnly` keeps the row at the level the
 * charge was authored against.
 */
export function projectFrozenInstructions(
  costing: ConstructedRollups,
  isLeaf: (skuId: string) => boolean,
): FrozenRecoveryInstruction[] {
  // `ownedPlacedCharges` skips parent rollups, whose construction is a merge of
  // children already recorded. Recording both would double every amortized
  // charge in the instruction an accountant reads.
  return ownedPlacedCharges(costing, isLeaf).map(({ ownerRef, tierId, charge: c }) => ({
    chargeKey: c.chargeKey,
    ownerRef,
    tierId,
    // Read from the field, never parsed from `sourceColumn`.
    chargeInstanceId: c.chargeInstanceId ?? null,
    treatment: c.placement,
    treatmentSource: c.source,
    cost: c.cost,
    governedRecovery: c.recoverableSell,
    separateInvoiceAmount: c.separateInvoiceAmount,
    amortizedPerUnit: c.amortization?.perUnit ?? null,
    tierQuantity: c.amortization?.tierQuantity ?? null,
  }));
}

/**
 * The operator-readable instruction for one frozen row.
 *
 * Written here rather than at a surface so the sentence an accountant reads and
 * the sentence the frozen record implies are the same sentence.
 */
export function instructionSentence(i: FrozenRecoveryInstruction): string {
  const usd = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (i.treatment === "absorbed") {
    return `${usd(i.cost)} cost absorbed by DPS — no customer recovery — DO NOT INVOICE.`;
  }
  if (i.treatment === "unit_price") {
    // A legacy allocated fee is amortized, and its recovered amount is not
    // independently governed — the quote-level adjustment reaches it. Say so,
    // rather than emitting the governed per-unit figure the customer did not
    // pay, or a bare null a reader would take for missing data.
    if (i.amortizedPerUnit === null || i.tierQuantity === null) {
      const gov =
        i.governedRecovery === null
          ? "at an unpriced recovery"
          : `at a governed recovery of ${usd(i.governedRecovery)}`;
      return `Amortized into unit price ${gov} — the recovered amount is not independently governed, because the quote-level price adjustment applies to it — separate invoice amount ${usd(0)} — DO NOT INVOICE SEPARATELY.`;
    }
    const rec = i.governedRecovery === null ? "an unpriced recovery" : usd(i.governedRecovery);
    return `${rec} recovery amortized at ${usd(i.amortizedPerUnit)}/unit across ${i.tierQuantity} quoted units — separate invoice amount ${usd(0)} — DO NOT INVOICE SEPARATELY.`;
  }
  const amt = i.separateInvoiceAmount === null ? "an unpriced amount" : usd(i.separateInvoiceAmount);
  return `${amt} — INVOICE SEPARATELY.`;
}
