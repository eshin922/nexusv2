import "server-only";
import type { HubSpotOperations } from "@/lib/integrations/hubspot-provider";
import {
  findHubspotOwnerByEmail,
  findHubspotOwnerById,
  getDealStage,
  getWriteClient,
  loadPipelineStagesForLabel,
  resolveVendorCompany,
  searchVendorCompanies,
  updateDealStage,
} from "@/lib/hubspot";

export const productionHubSpot: HubSpotOperations = {
  name: "hubspot",
  kind: "production",
  findOwnerByEmail: findHubspotOwnerByEmail,
  findOwnerById: findHubspotOwnerById,
  searchVendors: searchVendorCompanies,
  resolveVendor: resolveVendorCompany,
  listDealStages: loadPipelineStagesForLabel,
  getDealStage,
  updateDealStage,
  async updateDealAmount(dealId, amount) {
    await getWriteClient().crm.deals.basicApi.update(dealId, {
      properties: { amount: amount.toFixed(2) },
    });
  },
};
