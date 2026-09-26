/**
 * Order quantities are distinct from composition quantities. A product's
 * 5,000 ordered units must never be stored as 0.2 units per parent.
 *
 * Missing overrides preserve tier inheritance. Associated services inherit
 * their named product's order quantity; component usage still scales the
 * owner's quantity. Callers supply quote-occurrence identities, never library
 * SKU identities.
 */
export type QuantitySku = {
  id: string;
  parentSkuId: string | null;
  qtyPerParent: number | null;
  associatedProductQuoteLeafId?: string | null;
  orderQuantities?: Readonly<Record<string, number>>;
};

export type ResolvedOrderQuantity = {
  /** Units ordered/consumed for this particular line. */
  quantity: number | null;
  /** Finished-product units used before applying this member's multiplier. */
  ownerQuantity: number | null;
  source: "tier" | "product";
  ownerId: string;
};

export function parseOrderQuantity(raw: unknown): number {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error("Enter a whole quantity of 1 or more.");
  const quantity = Number(text);
  // PostgreSQL integer and NetSuite count-unit quantities must agree exactly.
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
    throw new Error("Enter a whole quantity between 1 and 2,147,483,647.");
  }
  return quantity;
}

export function resolveOrderQuantity(
  skuId: string,
  tier: { id: string; qty: number | null },
  skus: ReadonlyMap<string, QuantitySku>,
): ResolvedOrderQuantity {
  const visiting = new Set<string>();
  function resolve(id: string): ResolvedOrderQuantity {
    if (visiting.has(id)) throw new Error(`Circular quantity ownership at ${id}.`);
    const sku = skus.get(id);
    if (!sku) throw new Error(`Quantity owner ${id} is missing from this quote.`);
    visiting.add(id);
    try {
      const entered = sku.orderQuantities?.[tier.id];
      if (entered !== undefined) {
        if (sku.associatedProductQuoteLeafId) {
          throw new Error("Enter order quantity on the owning product, not its associated service.");
        }
        const quantity = parseOrderQuantity(entered);
        const usage = sku.parentSkuId ? (sku.qtyPerParent ?? 1) : 1;
        if (!Number.isFinite(usage) || usage <= 0) throw new Error(`Invalid component usage for ${id}.`);
        return { quantity, ownerQuantity: quantity / usage, source: "product", ownerId: id };
      }
      const ownerId = sku.parentSkuId ?? sku.associatedProductQuoteLeafId;
      if (!ownerId) {
        // A standalone product has no parent recipe: its composition field
        // cannot multiply the order or the freight attributed to it.
        const quantity = tier.qty;
        return { quantity, ownerQuantity: tier.qty, source: "tier", ownerId: id };
      }
      const owner = resolve(ownerId);
      const multiplier = sku.parentSkuId ? (sku.qtyPerParent ?? 1) : 1;
      if (!Number.isFinite(multiplier) || multiplier <= 0) {
        throw new Error(`Invalid component usage for ${id}.`);
      }
      const quantity = owner.quantity === null ? null : owner.quantity * multiplier;
      if (quantity !== null && (!Number.isFinite(quantity) || quantity > Number.MAX_SAFE_INTEGER)) {
        throw new Error(`Component quantity for ${id} exceeds the supported range.`);
      }
      return { quantity, ownerQuantity: owner.quantity, source: owner.source, ownerId: owner.ownerId };
    } finally {
      visiting.delete(id);
    }
  }
  return resolve(skuId);
}
