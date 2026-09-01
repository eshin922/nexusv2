/**
 * Landed logistics — the ONE reading of "is freight inside the unit price?".
 *
 * Two surfaces need it and they must not answer it separately:
 *
 *   · the operator's final-validation panel, which has to show how much of the
 *     accepted economics is logistics BEFORE Send/Accept;
 *   · the customer document, which has to say so in the pricing lede.
 *
 * If those derived the answer independently they could disagree, and the
 * disagreement would be invisible: the operator would be told freight is
 * bundled while the customer document stayed silent about it, or the reverse.
 * One function, both callers.
 *
 * ── IT RECOMPUTES NOTHING ────────────────────────────────────────────────
 *
 * Every figure is read from `quoteRollup.costBreakdown`, which is what Pricing
 * already renders. This module selects and names; it does not calculate. The
 * certified Freight arithmetic is not re-entered here and must not be.
 *
 *     freightContainer            container freight, at cost
 *     dutyAndTariff               duty + tariff, at cost
 *     freightContainerMarkupSum   container freight as BILLED
 *     dutyAndTariffMarkupSum      duty + tariff as BILLED
 *
 * The billed figures are the ones both surfaces want: they are the part of the
 * customer's accepted consideration that is logistics.
 *
 * ── WHAT "INCLUDED" MEANS, AND WHY IT IS NOT THE `treatment` COLUMN ──────
 *
 * `freight_subcategories.treatment` records bundled / pass_through, but it is
 * a per-SHIPMENT field that the costing path never reads (traced 2026-08-31),
 * and V1 gives the operator no way to set it — `freight-drilldown.tsx` echoes
 * the persisted value back through a hidden input under OD-001. Gating
 * customer-facing copy on a field nobody can set, and which no arithmetic
 * honours, would be gating it on nothing.
 *
 * The governed reading is the one the DOCUMENT can be held to: logistics is
 * "included in unit pricing" when it is present in the tier economics AND the
 * document carries no separate freight line for it. Both halves are checked —
 * presence alone would claim inclusion on a quote with no freight at all, and
 * absence-of-a-line alone would claim it on a quote whose freight is zero.
 *
 * When `freightLines` ever becomes non-empty (OD-001 / BV-009), this returns
 * `included: false` on its own, without an edit here — which is the behaviour
 * that boundary should have.
 */

/**
 * The governed customer-facing sentence, defined HERE rather than inside
 * either renderer.
 *
 * There are TWO renderers of the customer artifact over the same
 * `CustomerView`: `components/pdf/customer-pdf-document.tsx` and
 * `components/quote/customer-view-live.tsx`. The live one is explicitly
 * forbidden from importing anything under `components/pdf/`, so a constant
 * living in the PDF component could not be shared -- the live renderer would
 * have needed its own copy of the words, and two copies of a customer-facing
 * sentence drift. That is the #511 / #512 failure mode: the PDF saying one
 * thing while the operator's live preview says another.
 *
 * It sits beside the fact it states, so the claim and the evidence for it are
 * one module.
 *
 * Deliberately NOT "all-in". Separate one-time charges can still exist on an
 * itemized quote -- O2 carries tooling and R&D as their own lines -- and
 * "all-in" beside an itemized fee table would be a claim the document
 * contradicts three inches lower.
 */
export const FREIGHT_INCLUDED_SENTENCE =
  "The unit prices shown include applicable freight, duty, and tariffs.";

/** The costing-rollup fields this reads. Nothing else is needed or taken. */
export type LandedLogisticsSource = {
  costBreakdown: {
    freightContainer: number;
    dutyAndTariff: number;
    freightContainerMarkupSum: number;
    dutyAndTariffMarkupSum: number;
  };
};

export type LandedLogistics = {
  /** Container freight as billed to the customer. */
  freight: number;
  /** Duty + tariff as billed to the customer. */
  dutyAndTariff: number;
  /** The two together — what the operator panel headlines. */
  total: number;
  /**
   * True when these economics ride inside the unit prices rather than
   * appearing as their own line. Drives BOTH the operator wording and whether
   * the customer sentence renders at all.
   */
  included: boolean;
};

export function landedLogisticsForTier(args: {
  rollup: LandedLogisticsSource | null | undefined;
  /** The document's separate freight lines. Empty means nothing is broken out. */
  separateFreightLineCount: number;
}): LandedLogistics {
  const b = args.rollup?.costBreakdown;
  const freight = b?.freightContainerMarkupSum ?? 0;
  const dutyAndTariff = b?.dutyAndTariffMarkupSum ?? 0;
  const total = freight + dutyAndTariff;

  return {
    freight,
    dutyAndTariff,
    total,
    // Cents, not a float epsilon: a tenth of a cent of freight is still
    // freight, and `> 0` on a float would call a rounding artifact "included".
    included: Math.round(total * 100) > 0 && args.separateFreightLineCount === 0,
  };
}
