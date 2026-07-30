import "server-only";
import type { NetSuiteOperations } from "@/lib/integrations/netsuite-provider";
import { resolveNetsuiteItem } from "@/lib/netsuite/item-resolver";
import { resolveBusinessSegmentLabel } from "@/lib/netsuite/business-segment-resolver";
import { resolveProjectSourceIdByLabel } from "@/lib/netsuite/project-source-resolver";
import {
  createSalesOrder,
  fetchSalesOrderTranid,
} from "@/lib/netsuite/sales-orders";

export const productionNetSuite: NetSuiteOperations = {
  name: "netsuite",
  kind: "production",
  resolveItem: resolveNetsuiteItem,
  resolveBusinessSegment: resolveBusinessSegmentLabel,
  resolveProjectSource: resolveProjectSourceIdByLabel,
  createSalesOrder,
  fetchSalesOrderTranid,
};
