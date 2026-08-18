import "server-only";
import type { NetSuiteOperations } from "@/lib/integrations/netsuite-provider";
import {
  resolveNetsuiteItem,
  validateItemInternalIds,
} from "@/lib/netsuite/item-resolver";
import { resolveBusinessSegmentLabel } from "@/lib/netsuite/business-segment-resolver";
import { resolveProjectSourceIdByLabel } from "@/lib/netsuite/project-source-resolver";
import {
  createSalesOrder,
  fetchSalesOrderTranid,
} from "@/lib/netsuite/sales-orders";
import { getRecord } from "@/lib/netsuite/client";

export const productionNetSuite: NetSuiteOperations = {
  name: "netsuite",
  kind: "production",
  resolveItem: resolveNetsuiteItem,
  validateItemInternalIds: (ids) => validateItemInternalIds(ids),
  resolveBusinessSegment: resolveBusinessSegmentLabel,
  resolveProjectSource: resolveProjectSourceIdByLabel,
  createSalesOrder,
  fetchSalesOrderTranid,
  readCustomerTerms: (id) =>
    getRecord<{ terms?: { id?: string; refName?: string } | null }>(
      "customer",
      id,
    ),
};
