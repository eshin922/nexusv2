/** Keep product-owned services beside their product in Setup without changing their line records. */
export function placeSetupServices<
  P extends { quoteLeafId: string },
  S extends { associatedProductQuoteLeafId?: string | null },
>(products: readonly P[], services: readonly S[]) {
  const productIds = new Set(products.map((product) => product.quoteLeafId));
  const associatedByProduct = new Map<string, S[]>();
  const standalone: S[] = [];

  for (const service of services) {
    const ownerId = service.associatedProductQuoteLeafId;
    if (!ownerId || !productIds.has(ownerId)) {
      standalone.push(service);
      continue;
    }
    const associated = associatedByProduct.get(ownerId) ?? [];
    associated.push(service);
    associatedByProduct.set(ownerId, associated);
  }

  return { associatedByProduct, standalone };
}
