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
      reason: "archived" | "missing_sku" | "service_not_a_member";
      /** Operator-facing. States the actual cause; never a generic refusal. */
      message: string;
    };

/**
 * Where the attachment is going. The service prohibition is DESTINATION-
 * SPECIFIC — the same entry that is refused as an Item Group member is
 * perfectly attachable at top level — so the gate cannot answer without it.
 *
 * Passed explicitly rather than inferred from an optional `assemblyId`: a
 * caller that forgot to pass one would silently get the permissive branch,
 * which is the failure this prohibition exists to prevent.
 */
export type AttachmentDestination = "direct" | "group_member";

/** True when the SKU is absent, empty, or whitespace — all equally unmatchable. */
export function hasUsableSku(sku: string | null | undefined): boolean {
  return typeof sku === "string" && sku.trim() !== "";
}

export function evaluateAttachmentEligibility(
  leaf: {
    sku: string | null;
    archived: boolean;
    /** BV-012 §5. Absent is treated as `product` — see the note below. */
    commercialKind?: "product" | "service" | null;
  },
  destination: AttachmentDestination,
): AttachmentEligibility {
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
  // BV-012 §5.c — a service entry is a top-level Direct Service or nothing.
  //
  // Attaching one beneath an Item Group is the fabricated ownership location
  // §1.c forbids, arriving by a different route: a "Filling" product added
  // under a group purely to hold the filling cost. The Item Group owns its
  // Production economics directly.
  //
  // Enforced HERE rather than in the UI because this is the one gate both
  // attachment routes already share, so the two cannot diverge on what is
  // attachable — which is the property that made this the right place for it.
  //
  // `commercialKind` absent is treated as `product`. That matches the column
  // default and keeps every existing caller's meaning; a service entry always
  // carries the value explicitly, because the DB CHECK requires it alongside
  // an identity.
  if (destination === "group_member" && leaf.commercialKind === "service") {
    return {
      attachable: false,
      reason: "service_not_a_member",
      message:
        "This is a service, so it can be sold on its own but not added inside " +
        "an item group. An item group already owns its production costs " +
        "directly — add the cost there instead.",
    };
  }

  return { attachable: true };
}
