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
  /**
   * Read a customer's governed Terms record.
   *
   * OD-023 · added because `customer-terms.ts` imported the NetSuite client
   * DIRECTLY, bypassing this boundary. The isolated harness declares
   * `netsuite: isolated` and got the production client anyway, so Send — which
   * fails closed on unresolved terms — was unreachable there. A provider
   * boundary that one caller can route around is a boundary for the others
   * only.
   */
  readCustomerTerms(
    netsuiteCustomerId: string,
  ): Promise<{ terms?: { id?: string; refName?: string } | null } | null>;
}
