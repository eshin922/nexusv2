import type { CommercialLine } from "./commercial-projection.ts";
import type { CustomerViewSku } from "../types/quote.ts";
import { DIRECT_SERVICE_LABELS } from "./product-structure/direct-service.ts";

/** Customer display only. Accounting keeps the underlying lines unchanged. */
export function includeAssociatedServicesInProductRows(
  unitLines: readonly CommercialLine[],
  skus: readonly CustomerViewSku[],
): CustomerViewSku[] {
  if (unitLines.length !== skus.length) throw new Error("Customer lines are out of sync");
  const groupedServiceIds = new Set<string>();
  const combined = skus.map((productSku, productIndex) => {
    const productLine = unitLines[productIndex];
    if (productLine.kind !== "direct_product" || !productLine.quoteLeafId) return productSku;
    const services = unitLines.filter((line) =>
      line.kind === "direct_service" &&
      line.associatedProductQuoteLeafId === productLine.quoteLeafId &&
      line.cells.every((cell) => cell.state === "priced") &&
      productLine.cells.every((cell) => cell.state === "priced" && cell.quantity > 0),
    );
    if (services.length === 0) return productSku;
    for (const service of services) groupedServiceIds.add(service.key);
    const tierLineTotals = productSku.tierLineTotals.map((amount, tierIndex) =>
      amount === null ? null : amount + services.reduce((sum, service) => {
        const cell = service.cells[tierIndex];
        return sum + (cell.state === "priced" ? cell.lineAmount : 0);
      }, 0),
    );
    const tierPrices = tierLineTotals.map((amount, tierIndex) => {
      const productCell = productLine.cells[tierIndex];
      return amount !== null && productCell.state === "priced"
        ? amount / productCell.quantity
        : null;
    });
    const allEqual = tierPrices.every((price) => price !== null && price === tierPrices[0]);
    return {
      ...productSku,
      includedServices: services.map((service) => service.serviceIdentity
        ? DIRECT_SERVICE_LABELS[service.serviceIdentity]
        : service.displayName),
      tierLineTotals,
      tierPrices,
      shape: tierPrices.some((price) => price === null) ? "partial" : allEqual ? "flat" : "step↓",
    };
  });
  return combined.filter((_, index) => !groupedServiceIds.has(unitLines[index].key));
}
