/**
 * OD-026 · Direct Component quantity invariant.
 *
 *   A Direct Component IS the sellable unit. Its multiplicity is inherently 1.
 *   The quote TIER determines how many are sold.
 *
 * This is a SEMANTIC repair, not a costing-formula repair. No arithmetic
 * changes: the current math already behaves consistently with this meaning
 * (`qtyPerParent` is consumed only when folding a CHILD into a parent, and a
 * Direct Component has no parent). What was wrong is that the invalid state was
 * *representable* — a quantity could be authored, stored, and then silently
 * ignored, which reads as an authored value that means something.
 *
 * WHY NOT SCALE INSTEAD. Interpreting a Direct Component quantity of 2 as "2 per
 * tier unit" would create a second quantity axis with no governed downstream
 * representation: the flat NetSuite line takes TIER quantity, and the Customer
 * View shows TIER quantity. The customer document would state 1,000 while 2,000
 * were transacted. It would also re-multiply a value already normalised to the
 * sellable-unit basis — the exact dimensional error OD-025 repaired.
 *
 * FINISHED PRODUCT MEMBERS ARE UNAFFECTED. A component inside a Finished
 * Product HAS a parent, so `qtyPerParent` has a referent and legitimately scales
 * component-unit economics (Carton ×2, tier 1,000 → 2,000 cartons consumed
 * while the customer buys 1,000 Finished Products). That behaviour is preserved.
 *
 * If case packs / inner packs / sell-UOM conversion are ever needed, model them
 * explicitly. Do not overload Direct Component `qtyPerParent`.
 */

export const DIRECT_COMPONENT_MULTIPLICITY = 1;

export type LeafQuantityCandidate = {
  /** NULL ⟹ Direct Component: the leaf attaches straight to the quote. */
  assemblyId: string | null;
  /** `quote_leaves.quantity`. Numeric column — Drizzle returns string. */
  quantity: string | number;
  /** For error copy only. */
  label?: string | null;
};

export type QuantityVerdict =
  | { ok: true; kind: "direct" | "member" }
  | { ok: false; kind: "direct"; quantity: number; message: string };

/**
 * The single governed predicate. Pure — no DB, no IO — so every boundary
 * (authoring action, import, script, Complete) can enforce the SAME rule
 * rather than restating it and drifting.
 */
export function checkLeafQuantity(row: LeafQuantityCandidate): QuantityVerdict {
  const isDirect = row.assemblyId === null || row.assemblyId === undefined;
  if (!isDirect) return { ok: true, kind: "member" };

  const qty = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
  if (qty === DIRECT_COMPONENT_MULTIPLICITY) return { ok: true, kind: "direct" };

  const who = row.label ? `"${row.label}"` : "This component";
  return {
    ok: false,
    kind: "direct",
    quantity: qty,
    message:
      `${who} is sold on its own, so it IS the unit being sold — its quantity ` +
      `must be 1, not ${Number.isFinite(qty) ? qty : row.quantity}. ` +
      `Use the tier quantity to say how many are sold. ` +
      `(A per-unit multiplier only has meaning for a component inside a ` +
      `finished product.)`,
  };
}

export function isValidLeafQuantity(row: LeafQuantityCandidate): boolean {
  return checkLeafQuantity(row).ok;
}

/**
 * Fail-closed gate for the downstream projection boundary.
 *
 * Required even though authoring refuses the state, because authoring is not
 * the only writer: imports, scripts and historical rows all reach Complete.
 * Complete must REFUSE rather than silently project tier quantity and discard
 * the multiplicity — silently discarding it is precisely the failure that made
 * the state undefined in the first place.
 */
export function assertDirectComponentQuantities(
  rows: ReadonlyArray<LeafQuantityCandidate>,
): void {
  const bad = rows.map(checkLeafQuantity).filter((v): v is Extract<QuantityVerdict, { ok: false }> => !v.ok);
  if (bad.length === 0) return;
  throw new Error(
    `OD-026 · ${bad.length} directly-attached component(s) carry a quantity ` +
      `other than 1, which has no downstream representation. Refusing to ` +
      `project rather than discard it silently. ` +
      bad.map((b) => `[qty ${b.quantity}]`).join(" "),
  );
}
