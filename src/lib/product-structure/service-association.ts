import type { DirectServiceIdentity } from "./direct-service.ts";

/**
 * Product-associated Direct Services — migration 0136.
 *
 * A Direct Service quote leaf may name the Direct Product it is performed for,
 * so two products on one quote can each carry their own instance of the same
 * service. The service library leaves stay one per identity; the association is
 * what tells "Product A's filling" from "Product B's filling".
 *
 * ── WHAT THE ASSOCIATION IS, AND IS NOT ───────────────────────────────────
 *
 * Attribution. The service keeps its own `quote_leaves` row, its own quantity
 * and its own Production row, so NetSuite still receives a separate priced
 * service line and the product's NetSuite line carries none of the service
 * amount. A customer document may later group the two visually; that is
 * presentation over two lines, never a merge of them.
 *
 * NOT a one-time component charge. These services have production
 * economics priced per tier through `DIRECT_SERVICE_PRODUCTION_INPUT`, and they
 * do not route through `quote_charge_instances`.
 *
 * ── WHICH IDENTITIES ──────────────────────────────────────────────────────
 *
 * The three production services a product causes. Testing may have a one-time
 * cost basis; the association does not change that basis. Deliberately not:
 *
 *   formulation     one-time development work. A product that owns its R&D
 *                   already has a governed route — the component-owned
 *                   `rd_formulation` charge. A second route to the same fee
 *                   is the duplication that charge's guard exists to refuse.
 *   other_service   carries a per-line NetSuite item selection
 *                   (`quote_other_service_items`); associating it is a
 *                   separate decision, not a widening of this list.
 *
 * Widening this list is a business decision and should look like one.
 */
export const PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES = [
  "filling_blending",
  "packout_assembly",
  "testing_micros",
] as const satisfies readonly DirectServiceIdentity[];

export type ProductAssociableServiceIdentity =
  (typeof PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES)[number];

export function isProductAssociableServiceIdentity(
  value: string | null | undefined,
): value is ProductAssociableServiceIdentity {
  return (
    typeof value === "string" &&
    (PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES as readonly string[]).includes(value)
  );
}

export type ServiceAssociationVerdict =
  | { associable: true }
  | {
      associable: false;
      reason:
        | "not_a_service"
        | "identity_not_associable"
        | "product_not_found"
        | "product_on_other_quote"
        | "product_not_direct"
        | "product_not_a_product";
      /** Operator-facing. Names the actual cause. */
      message: string;
    };

/**
 * Whether `service` may be attached to `quoteId` as the service FOR `product`.
 *
 * The database enforces the same boundary independently (0136: composite FK +
 * CHECK). This exists for the sentence a constraint violation cannot produce,
 * and for the identity restriction, which the database does not see because
 * `service_identity` lives on `leaves`.
 *
 * Pure: the caller loads both rows. `product` is null when no quote leaf with
 * the named id exists at all.
 */
export function evaluateServiceAssociation(args: {
  quoteId: string;
  service: { commercialKind: string | null; serviceIdentity: string | null };
  product: {
    quoteId: string;
    assemblyId: string | null;
    commercialKind: string;
  } | null;
}): ServiceAssociationVerdict {
  const { service, product } = args;
  if (service.commercialKind !== "service") {
    return {
      associable: false,
      reason: "not_a_service",
      message:
        "Only a Direct Service can be attached for a product. A product is attached to the quote directly or as an Item Group member.",
    };
  }
  if (!isProductAssociableServiceIdentity(service.serviceIdentity)) {
    return {
      associable: false,
      reason: "identity_not_associable",
      message:
        "This service is not attached per product. Filling / Blending, Pack-out / Assembly and Testing / Micros can be; add this one to the quote as a standalone service instead.",
    };
  }
  if (!product) {
    return {
      associable: false,
      reason: "product_not_found",
      message: "The product this service is for was not found.",
    };
  }
  if (product.quoteId !== args.quoteId) {
    return {
      associable: false,
      reason: "product_on_other_quote",
      message: "The product this service is for belongs to a different quote.",
    };
  }
  if (product.commercialKind !== "product") {
    return {
      associable: false,
      reason: "product_not_a_product",
      message:
        "A service can only be attached for a product, not for another service.",
    };
  }
  if (product.assemblyId !== null) {
    return {
      associable: false,
      reason: "product_not_direct",
      message:
        "A service can only be attached for a Direct Product. An Item Group's production belongs on the Item Group.",
    };
  }
  return { associable: true };
}
