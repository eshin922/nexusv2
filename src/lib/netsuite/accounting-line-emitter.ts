import { derivePostedRate } from "@/lib/commercial-rate";
import type { ResolvedAccountingLine } from "@/lib/netsuite/projection-readiness";
import { decimalFromCents } from "@/lib/netsuite/frozen-cents";

/**
 * The accounting-line emitter — ONE resolution path, TWO line shapes.
 *
 * ── WHAT CHANGED, AND WHY ────────────────────────────────────────────────
 *
 * This emitter used to hardcode `quantity: 1` for everything it produced, on
 * the premise that a Direct Service and a separately billed Item Group OTC
 * charge are "the same kind of thing — a one-time charge whose amount IS its
 * own line."
 *
 * That premise was serviceable while every Direct Service was in fact a
 * one-time fee. It is not true of a Direct Service priced per unit across a
 * tier quantity, and SO2717 is what it cost: a line the accepted statement
 * describes as **2,000 units at $2.24** reached NetSuite as **1 at $4,480**.
 *
 * REG-4 did not catch it and could not — `1 × 4480` and `2000 × 2.24` are the
 * same total, so reconciliation was EXACT while the unit economics were
 * misstated. Exact reconciliation is necessary but not sufficient.
 *
 * ── THE SHAPING RULE (Edward's disposition, 2026-08-19) ──────────────────
 *
 * The FROZEN commercial line shape is authoritative.
 *
 *   Direct Service        quantity = frozen quantity
 *                         rate     = frozen unit rate
 *                         amount   = frozen line amount
 *
 *   Separately billed OTC quantity = 1
 *                         rate     = frozen line amount
 *                         amount   = frozen line amount
 *
 * Only the COMMERCIAL SHAPE splits. Destination resolution, item resolution,
 * provenance and tax enforcement stay shared — they were never what differed.
 *
 * ── WHAT THIS STILL DELIBERATELY CANNOT DO ───────────────────────────────
 *
 * It remains a PURE function of already-resolved frozen lines. It takes no
 * quote id, touches no database, and imports nothing from the costing tree. So
 * it cannot:
 *
 *   · consult live costing — every figure is the frozen one or nothing;
 *   · derive amount from `rate × quantity` — the amount is CARRIED, which is
 *     what keeps REG-4 an integer-cent comparison rather than a float
 *     tolerance. The frozen row already guarantees the identity by CHECK;
 *     recomputing it here would add a second authority for one number;
 *   · choose an item type — BV-011 governs what a destination should be and
 *     the resolved NetSuite record is what it is.
 *
 * Those are not conventions. There is no parameter through which a caller
 * could supply live costing, and nothing to import it from.
 *
 * ── WHAT IT IS NOT RESPONSIBLE FOR ───────────────────────────────────────
 *
 * Product lines. An `item_group_member` or `direct_product` resolves by SKU
 * through the existing item resolver and is emitted on the existing per-leaf
 * path at its own quantity. REG-4 reconciles the union of both to the frozen
 * accepted total; this emitter produces one half.
 */

export type EmittedAccountingLine = {
  /** The frozen line this came from. The audit trail back to the send. */
  sourceLineId: string;
  netsuiteItemId: string;
  netsuiteItemCode: string | null;
  /**
   * The frozen quantity for a Direct Service; exactly 1 for an OTC charge.
   *
   * No longer the literal type `1` — that type WAS the defect, in the sense
   * that it made the wrong shape unrepresentable-as-wrong.
   */
  quantity: number;
  /**
   * Decimal string, DERIVED from the amount at scale 8.
   *
   * Previously the frozen `unit_rate` was carried verbatim, on the reasoning
   * that a rate like `0.1234` does not survive a cent representation. True,
   * and the reason the rate needs its own scale — but carrying it verbatim
   * also carried whatever rounding error the freeze had put in it. NetSuite
   * computes `quantity × rate`, so the rate must be whatever reproduces the
   * accepted amount, and that is a derivation rather than a lookup.
   *
   * An OTC charge is quantity 1, where the derivation returns the amount
   * itself — so both shapes go through one path instead of two.
   */
  rate: string;
  /** Integer cents, carried from the frozen line amount. REG-4's basis. */
  amountCents: number;
  description: string;
  /**
   * OD-006 — an Item Group OTC line is emitted in association with its owning
   * group; a Direct Service is top-level and carries null.
   *
   * Association only. Neither participates in `composition_hash`: the hash
   * identifies a COMPOSITION — which physical items make up this kit — and a
   * fee that varies per tier and per quote would fork the group identity every
   * time it changed, collapsing the reuse the hash exists to provide.
   */
  owningAssemblyId: string | null;
};

/**
 * Emit one accounting line per resolved frozen line, shaped by kind.
 *
 * Order is preserved from the input, which is frozen `position` order, so the
 * emitted set reads in the same order as the document the customer received.
 */
export function emitAccountingLines(
  resolved: ReadonlyArray<ResolvedAccountingLine>,
): EmittedAccountingLine[] {
  return resolved.map((line) => {
    const common = {
      sourceLineId: line.sourceLineId,
      netsuiteItemId: line.netsuiteItemId,
      netsuiteItemCode: line.netsuiteItemCode,
      amountCents: line.amountCents,
      description: line.displayName,
      owningAssemblyId: line.owningAssemblyId,
    };

    if (line.kind === "direct_service") {
      // A unit-priced service posts at ITS OWN quantity and rate.
      //
      // Refused rather than defaulted when either is missing. Falling back to
      // the charge shape is precisely the silent mis-shaping this split
      // exists to end, and it would look like success. A priced frozen row
      // always carries both — a DB CHECK ties `unit_rate` and `line_amount`
      // to `pricing_state`, and readiness only resolves priced rows — so
      // reaching this throw means an invariant broke upstream and the right
      // response is to stop, not to guess.
      if (line.quantity === null || line.unitRate === null) {
        throw new Error(
          `[accounting-line-emitter] Direct Service line ${line.sourceLineId} ` +
            `("${line.displayName}") is missing its frozen quantity or unit rate ` +
            `(quantity=${String(line.quantity)}, unitRate=${String(line.unitRate)}). ` +
            `Refusing to emit it as a quantity-1 charge — that would post a ` +
            `different commercial statement than the one that was accepted.`,
        );
      }
      const posted = derivePostedRate(
        decimalFromCents(line.amountCents),
        line.quantity,
      );
      if (!posted.ok) {
        throw new Error(
          `[accounting-line-emitter] Direct Service line ${line.sourceLineId} ` +
            `("${line.displayName}") cannot be posted at a rate that reproduces ` +
            `its accepted amount: ${posted.reason} Refusing rather than posting ` +
            `a different commercial statement than the one that was accepted.`,
        );
      }
      return {
        ...common,
        quantity: line.quantity,
        rate: posted.rate,
      };
    }

    // A separately billed one-time charge IS its own line: quantity 1, and the
    // rate is the amount. Rendered from the same integer cents, so the two are
    // one number written twice rather than one derived from the other.
    const posted = derivePostedRate(decimalFromCents(line.amountCents), 1);
    if (!posted.ok) {
      throw new Error(
        `[accounting-line-emitter] One-time charge ${line.sourceLineId} ` +
          `("${line.displayName}"): ${posted.reason}`,
      );
    }
    return {
      ...common,
      quantity: 1,
      rate: posted.rate,
    };
  });
}

/** Σ emitted amounts, in integer cents. The left-hand side of REG-4 link B. */
export function emittedTotalCents(
  lines: ReadonlyArray<EmittedAccountingLine>,
): number {
  return lines.reduce((sum, l) => sum + l.amountCents, 0);
}
