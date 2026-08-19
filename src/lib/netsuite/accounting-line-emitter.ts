import type { ResolvedAccountingLine } from "@/lib/netsuite/projection-readiness";

/**
 * The shared quantity-1 accounting-line emitter.
 *
 * ONE emitter for both a Direct Service and a separately billed Item Group
 * OTC charge. They are the same kind of thing — a one-time charge whose amount
 * IS its own line — and they differ only in where the association points, which
 * is data on the line rather than a branch in here.
 *
 * ── WHAT THIS DELIBERATELY CANNOT DO ─────────────────────────────────────
 *
 * It is a PURE function of already-resolved frozen lines. It takes no quote id,
 * touches no database, and imports nothing from the costing tree. So it cannot:
 *
 *   · consult live costing — the amount is the frozen one or nothing;
 *   · recompute `rate × qty` — quantity is 1 and the amount is carried, not
 *     derived, which is what makes REG-4 an integer-cent comparison rather
 *     than a float tolerance;
 *   · choose an item type — BV-011 governs what a destination should be and
 *     the resolved NetSuite record is what it is. A third opinion here could
 *     disagree with both.
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
  /** Always exactly 1. A one-time charge is its own line. */
  quantity: 1;
  /** Integer cents. Equal to `amountCents` — quantity is 1. */
  rateCents: number;
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
 * Emit one accounting line per resolved frozen line.
 *
 * Order is preserved from the input, which is frozen `position` order, so the
 * emitted set reads in the same order as the document the customer received.
 */
export function emitAccountingLines(
  resolved: ReadonlyArray<ResolvedAccountingLine>,
): EmittedAccountingLine[] {
  return resolved.map((line) => ({
    sourceLineId: line.sourceLineId,
    netsuiteItemId: line.netsuiteItemId,
    netsuiteItemCode: line.netsuiteItemCode,
    quantity: 1 as const,
    // Carried, never recomputed. `rate` and `amount` are the same number
    // because the quantity is 1; deriving one from the other through a
    // multiplication would reintroduce exactly the rounding REG-4 excludes.
    rateCents: line.amountCents,
    amountCents: line.amountCents,
    description: line.displayName,
    owningAssemblyId: line.owningAssemblyId,
  }));
}

/** Σ emitted amounts, in integer cents. The left-hand side of REG-4 link B. */
export function emittedTotalCents(
  lines: ReadonlyArray<EmittedAccountingLine>,
): number {
  return lines.reduce((sum, l) => sum + l.amountCents, 0);
}
