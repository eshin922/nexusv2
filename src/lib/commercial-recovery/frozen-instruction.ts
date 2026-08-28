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
import type { ChargePlacement, PlacedCharge } from "./construct";
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
  /**
   * The treatment Accounting acts on.
   *
   * DELIBERATELY NARROWER than `ChargePlacement`: `unplaced` is excluded,
   * because an undecided charge has no instruction to give. Send is blocked
   * while any charge is unplaced, so one cannot reach here — and the
   * `recovery_treatment` database enum has no such member, so TypeScript
   * refuses the write rather than the constraint discovering it at runtime.
   */
  treatment: Exclude<ChargePlacement, "unplaced">;
  /**
   * NARROWER than `PlacedCharge.source`, for the same reason `treatment` is:
   * an unplaced charge never freezes, so `unplaced` cannot appear here.
   */
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
  /**
   * Whether this cell's unit sell is the operator's own all-in number.
   *
   * Recorded so an accountant reading a NULL recovery can tell "nobody has
   * governed what this recovers" (BV-013) from "the operator priced the unit
   * themselves, charge included, and how much of it is recovery is not a fact
   * Nexus holds". Both are null; they are not the same absence.
   */
  manualAllInSell: boolean;
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
 * WHICH QUESTION THE CALLER IS ASKING — OD-032, 2026-08-27.
 *
 * ── THE DEFECT THIS EXISTS TO FIX ────────────────────────────────────────
 *
 * There was one projection and it was written for one caller: the send
 * transaction, where an unplaced charge must be refused because freezing it
 * would record a margin decision nobody made.
 *
 * `resolveCustomerView` also calls it, on EVERY page load. A component charge
 * is authored `unplaced` by design, so from #480 onward any quote carrying one
 * returned 500 on the Quote surface — the page that HOSTS Commercial Recovery,
 * which is where the charge would have been placed. The operator could not
 * reach the control that resolves the state, because the unresolved state
 * killed the page holding the control.
 *
 * Measured on production 2026-08-27: two quotes carrying component charges
 * returned 500, a quote carrying none returned 200, and removing the charges
 * flipped both of the first two to 200.
 *
 * ── WHY A SPLIT CONTRACT AND NOT A `try/catch` ───────────────────────────
 *
 * Catching it in the resolver would suppress an exception that also fires for
 * reasons nobody has anticipated yet, and would leave the read path claiming
 * to have projected instructions it had actually dropped. The two callers are
 * asking DIFFERENT QUESTIONS, and the contract should say which:
 *
 *   commit  is this quote's recovery ready to be frozen and billed?
 *           An unplaced charge is a hard refusal. UNCHANGED.
 *
 *   read    what recovery instructions does this draft have SO FAR?
 *           An unplaced charge is a legitimate intermediate state. It produces
 *           no instruction — there is nothing to instruct — and it is REPORTED
 *           rather than silently dropped.
 *
 * The guard is not weakened. `sendQuote` keeps its operator-facing readiness
 * refusal, and the freeze keeps the throw below as defence in depth.
 */

/**
 * Instructions for a DRAFT, where unplaced is expected.
 *
 * Returns what is placed so far and NAMES what is not, so a caller that needs
 * to know cannot fail to be told. Nothing here decides anything about the
 * unplaced charges: deciding is Commercial Recovery's job and refusing is
 * send's.
 */
export function projectRecoveryInstructionsForRead(
  costing: ConstructedRollups,
  isLeaf: (skuId: string) => boolean,
): {
  instructions: FrozenRecoveryInstruction[];
  unplaced: { chargeKey: string; chargeInstanceId: string | null; tierId: string }[];
} {
  const instructions: FrozenRecoveryInstruction[] = [];
  const unplaced: {
    chargeKey: string;
    chargeInstanceId: string | null;
    tierId: string;
  }[] = [];
  for (const { ownerRef, tierId, charge, manualAllInSell } of ownedPlacedCharges(
    costing,
    isLeaf,
  )) {
    if (charge.placement === "unplaced") {
      unplaced.push({
        chargeKey: charge.chargeKey,
        chargeInstanceId: charge.chargeInstanceId ?? null,
        tierId,
      });
      continue;
    }
    instructions.push(instructionFor(ownerRef, tierId, charge, manualAllInSell));
  }
  return { instructions, unplaced };
}

/**
 * One instruction per placed charge per (owner, tier) — the COMMIT projection.
 *
 * UNCHANGED: an unplaced charge throws. This is what the send transaction
 * calls, and the refusal is the whole point of it.
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
  return ownedPlacedCharges(costing, isLeaf).map(
    ({ ownerRef, tierId, charge: c, manualAllInSell }) => {
    if (c.placement === "unplaced") {
      // REFUSED, LOUDLY. Reaching here means send-readiness let an undecided
      // charge through, and the alternatives are both worse than a throw:
      // freezing it as `absorbed` would record a margin decision nobody made,
      // and dropping it would remove a real cost from the record Accounting
      // bills from. Neither is recoverable after the fact.
      //
      // The READ projection above does not reach this, and that is not a
      // loophole: it produces no instruction for an unplaced charge and names
      // it instead. Nothing it returns can be frozen, because freezing goes
      // through this function.
      throw new Error(
        `Cannot freeze an unplaced charge (${c.chargeKey}` +
          `${c.chargeInstanceId ? ` / ${c.chargeInstanceId}` : ""}). ` +
          "Send readiness must refuse a quote carrying one.",
      );
      }
      return instructionFor(ownerRef, tierId, c, manualAllInSell);
    },
  );
}

/**
 * One instruction row, built ONCE for both projections.
 *
 * Extracted rather than duplicated: two copies of this mapping would let the
 * draft's rendering and the record Accounting bills from drift apart field by
 * field, and nothing would report it — the two are supposed to be the same
 * projection asked at two moments, differing only in what they do about a
 * charge nobody has placed yet.
 *
 * `placement` is narrowed by both callers before they arrive here: `commit`
 * has thrown, `read` has skipped. So the treatment and its source can only be
 * ones an accountant could act on.
 */
function instructionFor(
  ownerRef: string,
  tierId: string,
  c: PlacedCharge,
  manualAllInSell: boolean,
): FrozenRecoveryInstruction {
  // ── WHAT A MANUAL ALL-IN PRICE MAKES UNKNOWABLE ────────────────────────
  //
  // Disposition, Edward 2026-08-28: a manual sell-price override IS the final
  // all-in customer unit price. If the operator enters $4.06, Nexus quotes
  // $4.06 and adds no governed recovery on top.
  //
  // An `included` charge on such a cell is a real statement — the operator
  // asserts the charge is inside the price they typed. What Nexus cannot say
  // is HOW MUCH of that price is recovery, and the pricing engine already says
  // so by returning `embeddedRecoveryTotal: null` for the cell.
  //
  // This record was asserting a figure anyway. Measured on production
  // 2026-08-28, quote 2f29af72 Tier 3: the freeze told Accounting
  // `governedRecovery = 1400, amortizedPerUnit = 0.07` while pricing returned
  // `embeddedRecoveryTotal = null` on the same cell. The billing record was
  // making a claim the layer beneath it refuses to make.
  //
  // NOT INFERRED FROM THE ASK. An ask exists on the charge and is what the
  // operator WANTED to recover; it is not evidence that the overridden price
  // recovered it. Nulling on the presence of a number would be the same error
  // in the other direction.
  //
  // Only the amortized-into-unit-price case is affected. A `separate_line`
  // charge is billed as its own amount and is unaffected by what the unit
  // price does; an `absorbed` charge recovers nothing by decision, which is a
  // fact rather than an unknown.
  const unmeasurable = manualAllInSell && c.placement === "unit_price";
  return {
    chargeKey: c.chargeKey,
    ownerRef,
    tierId,
    // Read from the field, never parsed from `sourceColumn`.
    chargeInstanceId: c.chargeInstanceId ?? null,
    // PRESERVED: the treatment is still what the operator elected. Silently
    // converting it to `absorbed` would record a margin decision nobody made —
    // and `absorbed` is a governed treatment of its own, not a description of
    // an override.
    treatment: c.placement as Exclude<ChargePlacement, "unplaced">,
    treatmentSource: c.source as "election" | "legacy",
    // PRESERVED: what DPS pays is known regardless of how the sell was set,
    // and it still reaches contribution and margin.
    cost: c.cost,
    governedRecovery: unmeasurable ? null : c.recoverableSell,
    separateInvoiceAmount: c.separateInvoiceAmount,
    amortizedPerUnit: unmeasurable ? null : (c.amortization?.perUnit ?? null),
    // The tier's own quantity is a fact about the tier, not about the price,
    // so it survives — an accountant still needs the basis the charge would
    // have been spread over.
    tierQuantity: c.amortization?.tierQuantity ?? null,
    manualAllInSell,
  };
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
