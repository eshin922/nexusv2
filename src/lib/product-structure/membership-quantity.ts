/**
 * The governed rule for Item Group membership quantity — `qty / parent`.
 *
 * ── ONE RULE, TWO WRITE PATHS ───────────────────────────────────────────
 *
 * `assembly_leaves.quantity` answers a composition question: how many of this
 * component go into one sellable unit of the parent. Two paths write it —
 * `updateAssemblyLeafQuantity` sets it, and `moveProductMembership` carries it
 * across a move. Both call this, so a move cannot become a way around the rule
 * that setting it directly enforces.
 *
 * ── WHY THE CONSTRAINT IS THIS STRICT ───────────────────────────────────
 *
 * The value is a multiplier on real money. It scales component-unit costs in
 * the parent fold (`costing.ts:4042`) and divides one-time recovery in the
 * amortisation basis (`costing.ts:3244`, `tierQty × qtyPerParent`).
 *
 * Zero would make the divisor zero. Negative would invert a cost into a credit.
 * Fractional would be a different modelling claim than "this parent contains N
 * of this component" — and the column is `numeric`, so the database would
 * accept it silently. The refusal is here because the storage does not object.
 *
 * NOT a schema change: the column keeps its type and default. This governs what
 * the application will write into it.
 */
import { ActionGuardError, ERR } from "@/lib/action-result";

/** Refusal text, shared so both write paths refuse identically. */
export const MEMBERSHIP_QUANTITY_REFUSAL =
  "Qty / parent must be a whole number of 1 or more — it is how many of this component go into one unit of the parent.";

/**
 * Validates and normalises a membership quantity.
 *
 * Accepts what an operator can type; returns the canonical string the column
 * stores. Throws `ActionGuardError(VALIDATION)` on anything else, so callers
 * inside `runAction` surface a structured refusal rather than a stack trace.
 */
export function assertMembershipQuantity(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (text === "") throw new ActionGuardError(ERR.VALIDATION, MEMBERSHIP_QUANTITY_REFUSAL);

  // Parsed strictly rather than with Number(): `Number("2abc")` is NaN but
  // `parseInt("2abc")` is 2, and neither should be accepted. The pattern is the
  // whole test — digits only, no sign, no separator, no decimal point.
  if (!/^\d+$/.test(text)) {
    throw new ActionGuardError(ERR.VALIDATION, MEMBERSHIP_QUANTITY_REFUSAL);
  }

  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ActionGuardError(ERR.VALIDATION, MEMBERSHIP_QUANTITY_REFUSAL);
  }

  // Canonical form, so "007" and "7" cannot become two different stored values
  // for one composition fact.
  return String(value);
}

/**
 * The same rule, as a predicate, for callers that must decide rather than throw.
 *
 * Kept beside the assertion rather than reimplemented at the call site — a
 * second copy is how two paths start disagreeing about what is valid.
 */
export function isValidMembershipQuantity(raw: unknown): boolean {
  try {
    assertMembershipQuantity(raw);
    return true;
  } catch {
    return false;
  }
}
