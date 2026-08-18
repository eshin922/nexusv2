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
  /**
   * Confirm stored NetSuite internal ids are still usable — one round trip
   * for all of them.
   *
   * Routed through the provider boundary rather than imported directly, for
   * the reason OD-023 records one method above: a boundary one caller can go
   * around is a boundary for the others only. The isolated harness must be
   * able to answer this without reaching production NetSuite.
   *
   * Returns one verdict per id. A FAILED read must yield `indeterminate` for
   * every id in the batch — never `gone`, which is reserved for a read that
   * SUCCEEDED and found nothing.
   */
  validateItemInternalIds(
    internalIds: readonly string[],
  ): Promise<
    Map<
      string,
      | { state: "usable"; itemCode: string }
      | { state: "gone" }
      | { state: "inactive"; itemCode: string }
      | { state: "indeterminate"; reason: string }
    >
  >;
  readCustomerTerms(
    netsuiteCustomerId: string,
  ): Promise<{ terms?: { id?: string; refName?: string } | null } | null>;
}
