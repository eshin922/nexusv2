export type HubSpotStage = { id: string; label: string };
export type HubSpotOwnerByEmail = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};
export type HubSpotOwnerById = {
  name: string | null;
  email: string | null;
};
export type HubSpotVendor = {
  id: string;
  name: string;
};
export type HubSpotProductCreateInput = {
  name: string;
  hs_sku?: string;
  description?: string;
  hs_images?: string;
  hs_url?: string;
  hubspot_owner_id?: string;
  price?: string;
  hs_cost_of_goods_sold?: string;
  markup?: string;
  hs_product_type?: string;
  tax_schedule?: string;
  fsc_claim_type?: string;
  fsc_status?: string;
  fsc_supplier_verified?: string;
};
export type HubSpotProductCreateResult = {
  id: string;
  hs_sku: string | null;
  name: string;
  price: string | null;
  submittedProperties: Record<string, string>;
  responseBody: Record<string, unknown>;
};
export type HubSpotProductRaw = {
  id: string;
  archived: boolean;
  properties: Record<string, string | null>;
};
export type HubSpotProductPage = {
  results: HubSpotProductRaw[];
  nextAfter: string | null;
};

const HUBSPOT_PRODUCT_PRICE = /^\d+(?:\.\d+)?$/;

/**
 * HubSpot Product catalog price contract. Missing and blank prices become the
 * technical catalog prerequisite 0.00; an explicitly supplied nonnegative
 * decimal is preserved. This value is not a Nexus quote or transaction rate.
 */
export function canonicalizeHubSpotProductPrice(
  price: string | null | undefined,
): string {
  const value = String(price ?? "").trim();
  if (value === "") return "0.00";
  if (!HUBSPOT_PRODUCT_PRICE.test(value) || !Number.isFinite(Number(value))) {
    throw new Error("HubSpot Product price must be a nonnegative decimal number.");
  }
  return Number(value) === 0 ? "0.00" : value;
}

export function normalizeHubSpotProductCreateInput(
  input: HubSpotProductCreateInput,
): HubSpotProductCreateInput & { price: string } {
  return {
    ...input,
    price: canonicalizeHubSpotProductPrice(input.price),
  };
}

export interface HubSpotOperations {
  readonly name: string;
  readonly kind: "production" | "isolated";
  findOwnerByEmail(email: string): Promise<HubSpotOwnerByEmail | null>;
  findOwnerById(ownerId: string): Promise<HubSpotOwnerById | null>;
  searchVendors(query: string, limit?: number): Promise<HubSpotVendor[]>;
  resolveVendor(companyId: string): Promise<HubSpotVendor | null>;
  createProduct(
    input: HubSpotProductCreateInput,
  ): Promise<HubSpotProductCreateResult>;
  listProducts(opts?: {
    after?: string;
    limit?: number;
    includeArchived?: boolean;
  }): Promise<HubSpotProductPage>;
  listDealStages(): Promise<HubSpotStage[]>;
  getDealStage(dealId: string): Promise<HubSpotStage>;
  updateDealStage(
    dealId: string,
    targetStage: string,
    options?: { amount?: number },
  ): Promise<HubSpotStage>;
  updateDealAmount(dealId: string, amount: number): Promise<void>;
}
