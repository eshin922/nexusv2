/**
 * The one empty-cost register for the Setup tree.
 *
 * Soak run 1 observed the same table showing `$0.00 cost` on one product and
 * `— cost` on the other. Both meant "nobody has costed this"; they came from
 * `unitCost` being the string `"0.0000"` in one row and `null` in the other,
 * and `"0.0000"` is truthy — so a truthiness check sent two spellings of one
 * state down two different branches.
 *
 * ZERO IS NOT A COST HERE. A `$0.00` reads as a positive claim that the
 * component is free, and the project already has a standing rule about exactly
 * that value from exactly that source (CLAUDE.md, standing business
 * constraints):
 *
 *   > A `$0.00` upstream catalog price can satisfy NetSuite validation but
 *   > must never become the commercial transaction price.
 *
 * So the catalog's zero is treated as absence of a price, not as a price of
 * zero — the same distinction `packaging-drilldown.tsx` already draws one layer
 * down ("an unpriced cell has no landed value, not a landed value of zero"),
 * and the one Pattern 57 names.
 *
 * SHARED because the expression was duplicated verbatim in `asy-row.tsx` and
 * `direct-product-row.tsx`, which is how the two spellings were free to drift
 * apart in the first place. This is a genuine duplication of one decision, not
 * an abstraction for its own sake: there is exactly one question here — is
 * this component costed — and it now has exactly one answer.
 */

/** Rendered beneath a Setup row. Includes the trailing word. */
export function leafCostDisplay(unitCost: string | number | null | undefined): string {
  const n = unitCost === null || unitCost === undefined ? null : Number(unitCost);
  if (n === null || !Number.isFinite(n) || n === 0) return "— cost";
  return `$${n.toFixed(2)} cost`;
}

/**
 * The hover text, which is where the raw fact goes.
 *
 * An operator who wants to know WHY a row says "—" can find out that the
 * library carries a zero, without the table asserting that zero as a price.
 * Absence and a recorded zero are different facts; they are just not different
 * *prices*.
 */
export function leafCostTitle(unitCost: string | number | null | undefined): string {
  const n = unitCost === null || unitCost === undefined ? null : Number(unitCost);
  if (n === null || !Number.isFinite(n)) return "No unit cost on file.";
  if (n === 0) {
    return (
      "The product library carries 0.00 for this component, which is treated " +
      "as no price rather than a price of zero. Cost it on Costs."
    );
  }
  return `Unit cost from the product library: $${n.toFixed(4)}.`;
}
