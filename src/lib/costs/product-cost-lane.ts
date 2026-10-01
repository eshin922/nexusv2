/** Where a product's entered unit cost appears in the quote Price build. */
export type ProductCostLane = "pkg" | "prod" | "raw";

/** HubSpot stores some packaging labels under shorter option values. */
export function productCostLane(productType: string | null | undefined): ProductCostLane {
  switch (productType?.trim().toLowerCase()) {
    case "raw ingredients":
      return "raw";
    case "ingestibles":
    case "topicals":
    case "finished goods":
    case "turnkey":
    case "filling and packout services":
    case "formulation":
    case "r&d / testing":
      return "prod";
    default:
      return "pkg";
  }
}
