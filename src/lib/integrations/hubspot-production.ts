import "server-only";
import type { HubSpotOperations } from "@/lib/integrations/hubspot-provider";
import {
  findHubspotOwnerByEmail,
  findHubspotOwnerById,
  getDealStage,
  getWriteClient,
  loadPipelineStagesForLabel,
  createProduct,
  updateProduct,
  listProducts,
  getProductSnapshot,
  resolveVendorCompany,
  searchCustomerCompanies,
  searchVendorCompanies,
  updateDealStage,
} from "@/lib/hubspot";

export const productionHubSpot: HubSpotOperations = {
  name: "hubspot",
  kind: "production",
  findOwnerByEmail: findHubspotOwnerByEmail,
  findOwnerById: findHubspotOwnerById,
  searchVendors: searchVendorCompanies,
  searchCustomers: searchCustomerCompanies,
  resolveVendor: resolveVendorCompany,
  createProduct,
  updateProduct,
  listProducts,
  getProduct: getProductSnapshot,
  listProductTypeOptions: async () => {
    const { fetchHubspotProductTypeOptionsDirect } = await import(
      "@/lib/hubspot-product-type-vocabulary"
    );
    return fetchHubspotProductTypeOptionsDirect();
  },
  listDealStages: loadPipelineStagesForLabel,
  getDealStage,
  updateDealStage,
  async updateDealAmount(dealId, amount) {
    await getWriteClient().crm.deals.basicApi.update(dealId, {
      properties: { amount: amount.toFixed(2) },
    });
  },
};
