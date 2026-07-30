import type { ResolveResult } from "@/lib/netsuite/item-resolver-types";

export interface NetSuiteOperations {
  readonly name: string;
  readonly kind: "production" | "isolated";
  resolveItem(sku: string): Promise<ResolveResult>;
  resolveBusinessSegment(
    segmentId: string,
    options?: { dealIdForBackfill?: string },
  ): Promise<string>;
  resolveProjectSource(label: string): Promise<string>;
  createSalesOrder(
    payload: Record<string, unknown>,
    options: { idempotencyKey: string },
  ): Promise<{ internalId: string }>;
  fetchSalesOrderTranid(internalId: string): Promise<string | null>;
}
