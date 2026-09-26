"use client";
import type { OverviewOwner } from "@/lib/costs/costs-overview-model";

/** Read the canonical resolved demand; never multiply recipe usage in a renderer. */
export function OrderQuantity({ owner, tierId }: { owner: OverviewOwner; tierId: string }) {
  const quantity = owner.orderQuantities?.[tierId];
  return <span className="cm2-cell"><span className="cm2-figure">{quantity == null ? "—" : quantity.toLocaleString()}</span><span className="cm2-basis">ordered units</span></span>;
}
