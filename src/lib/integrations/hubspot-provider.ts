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
};

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
  listDealStages(): Promise<HubSpotStage[]>;
  getDealStage(dealId: string): Promise<HubSpotStage>;
  updateDealStage(
    dealId: string,
    targetStage: string,
    options?: { amount?: number },
  ): Promise<HubSpotStage>;
  updateDealAmount(dealId: string, amount: number): Promise<void>;
}
