/**
 * Whether a library product may be NEWLY attached to a quote.
 *
 * WHY THIS EXISTS. A product with no SKU can never resolve in NetSuite: the
 * resolver matches on SKU, so the absence of one is not a lookup that might
 * fail — it is a lookup that cannot be attempted. Nexus can therefore know at
 * ATTACH time, from local data alone, that such a product will not project.
 *
 * Before this gate an operator could build a quote around one, price it, send
 * it to a customer, obtain acceptance, and only discover at Complete — the one
 * step in the lifecycle designed to be an irreversible commit — that a line was
 * never projectable. Moving the refusal to the earliest point at which the
 * answer is knowable is the whole of the fix.
 *
 * SCOPE — deliberately narrow, and this boundary is load-bearing:
 *
 *   GATED     : creating a NEW attachment.
 *   NOT GATED : reading, rendering, costing, pricing or sending a quote that
 *               ALREADY contains such a product. Historical quotes stay fully
 *               readable. A gate that hid them would destroy the record of what
 *               was quoted in order to prevent a future mistake.
 *
 * WHAT THIS IS NOT. Downstream NetSuite ambiguity — several active items
 * sharing one SKU — is a DIFFERENT state and is deliberately not handled here.
 * It is a property of the other system, unknowable from Nexus's data, and is
 * correctly refused fail-closed at Complete. Only local certainty belongs in
 * this gate; anything inferred about NetSuite would be a guess wearing the
 * clothes of a check.
 */

export type AttachmentEligibility =
  | { attachable: true }
  | {
      attachable: false;
      reason: "archived" | "missing_sku";
      /** Operator-facing. States the actual cause; never a generic refusal. */
      message: string;
    };

/** True when the SKU is absent, empty, or whitespace — all equally unmatchable. */
export function hasUsableSku(sku: string | null | undefined): boolean {
  return typeof sku === "string" && sku.trim() !== "";
}

export function evaluateAttachmentEligibility(leaf: {
  sku: string | null;
  archived: boolean;
}): AttachmentEligibility {
  if (leaf.archived) {
    return {
      attachable: false,
      reason: "archived",
      message: "Archived products can't be attached.",
    };
  }
  if (!hasUsableSku(leaf.sku)) {
    return {
      attachable: false,
      reason: "missing_sku",
      message:
        "This product has no SKU, so its downstream item identity is unavailable " +
        "and it cannot be sent to NetSuite. Add a SKU to the product in the " +
        "Library, then attach it.",
    };
  }
  return { attachable: true };
}
