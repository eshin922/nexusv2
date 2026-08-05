// ============================================================================
// Tier-quantity gate — Setup → Costs waterfall
// ============================================================================
//
// Business rule: a tier may exist with its quantity unset while the PM is
// constructing Setup, but the quote may not proceed into **editable** Costs
// until every active tier carries a valid positive quantity.
//
// Why the gate is here and not at tier creation: `quote_tiers.qty` is
// deliberately nullable — the schema records the intent as "not yet specified
// rather than sentinel 0", and `addTier` creates every tier with `qty: null`.
// A PM legitimately lays out tier structure before quantities are negotiated.
// Requiring a quantity at creation would break that authoring flow and
// retroactively invalidate quotes that were already sent this way.
//
// What an unset quantity actually breaks is downstream: tier quantity is the
// denominator for per-unit allocation, sell price, and margin. Production
// amortisation is explicitly gated on `tierQty > 0` in the math layer, so with
// no quantity the Cost Stack has nothing to divide by and renders empty.
//
// The operator-visible harm was **misattribution**, not permissiveness. The
// Cost Stack reported a generic "awaiting inputs" while pointing at no input,
// so a blank stack read as a Packaging fault when Packaging was correct and
// complete. This module makes the real blocker nameable.
//
// Deliberately absent: any fallback or sentinel quantity. A missing quantity
// is a question for the operator, never a value the system invents — a
// defaulted quantity would silently produce a wrong per-unit cost and a wrong
// margin, which is worse than rendering nothing.

export type TierQuantityInput = {
  id: string;
  label: string;
  qty: number | null;
};

export type InvalidTierQuantity = {
  tierId: string;
  tierLabel: string;
  /** Why this tier fails, in operator language. */
  reason: "missing" | "not_positive" | "invalid";
};

/**
 * Returns every tier whose quantity cannot serve as a per-unit basis.
 *
 * Treats three states as blocking, matching the disposition: unset (null),
 * non-positive (zero or negative), and non-finite (NaN / Infinity, reachable
 * if a non-integer ever lands in the column).
 */
export function findInvalidTierQuantities(
  tiers: ReadonlyArray<TierQuantityInput>,
): InvalidTierQuantity[] {
  const invalid: InvalidTierQuantity[] = [];
  for (const tier of tiers) {
    if (tier.qty === null || tier.qty === undefined) {
      invalid.push({ tierId: tier.id, tierLabel: tier.label, reason: "missing" });
      continue;
    }
    if (!Number.isFinite(tier.qty)) {
      invalid.push({ tierId: tier.id, tierLabel: tier.label, reason: "invalid" });
      continue;
    }
    if (tier.qty <= 0) {
      invalid.push({
        tierId: tier.id,
        tierLabel: tier.label,
        reason: "not_positive",
      });
    }
  }
  return invalid;
}

/** True when every active tier can serve as a per-unit basis. */
export function tierQuantitiesResolved(
  tiers: ReadonlyArray<TierQuantityInput>,
): boolean {
  return findInvalidTierQuantities(tiers).length === 0;
}

/**
 * Operator-facing summary naming the affected tiers.
 *
 * Names each tier explicitly rather than reporting a count, because the whole
 * point of this control is that the operator can act without guessing which
 * surface is at fault.
 */
export function describeInvalidTierQuantities(
  invalid: ReadonlyArray<InvalidTierQuantity>,
): string {
  if (invalid.length === 0) return "";
  const named = invalid
    .map((t) => {
      if (t.reason === "not_positive") return `${t.tierLabel} (must be above zero)`;
      if (t.reason === "invalid") return `${t.tierLabel} (not a valid number)`;
      return t.tierLabel;
    })
    .join(", ");
  return invalid.length === 1
    ? `Missing tier quantity: ${named}.`
    : `Missing tier quantity on ${invalid.length} tiers: ${named}.`;
}

/** Deep link back to the tier editor that owns the fix. */
export function setupTierEditorHref(
  projectId: string,
  quoteId: string,
  tierId?: string,
): string {
  const base = `/projects/${projectId}/quotes/${quoteId}/setup`;
  return tierId ? `${base}?tier=${tierId}` : base;
}
