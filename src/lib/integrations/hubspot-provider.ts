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

export interface HubSpotOperations {
  readonly name: string;
  readonly kind: "production" | "isolated";
  findOwnerByEmail(email: string): Promise<HubSpotOwnerByEmail | null>;
  findOwnerById(ownerId: string): Promise<HubSpotOwnerById | null>;
  searchVendors(query: string, limit?: number): Promise<HubSpotVendor[]>;
  resolveVendor(companyId: string): Promise<HubSpotVendor | null>;
  listDealStages(): Promise<HubSpotStage[]>;
  getDealStage(dealId: string): Promise<HubSpotStage>;
  updateDealStage(
    dealId: string,
    targetStage: string,
    options?: { amount?: number },
  ): Promise<HubSpotStage>;
  updateDealAmount(dealId: string, amount: number): Promise<void>;
}
