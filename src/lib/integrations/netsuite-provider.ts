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
  ): Promise<{
    terms?: { id?: string; refName?: string } | null;
    /**
     * Present on the real record and now declared, so the mapping workflow can
     * confirm WHICH customer an admin just picked without a second round trip.
     * The production implementation already returned the whole record; only
     * the type was narrower than the value.
     */
    entityId?: string | null;
    companyName?: string | null;
  } | null>;
  /**
   * Find candidate NetSuite customers by name or entity id.
   *
   * The outcome distinguishes a search that RAN and matched nothing from one
   * that could not run, for the reason `validateItemInternalIds` above
   * distinguishes `gone` from `indeterminate`: collapsing them tells an admin
   * a customer does not exist in NetSuite when the truth is that NetSuite did
   * not answer. Acting on that produces a duplicate customer record.
   *
   * Ambiguity is returned, never resolved: several candidates come back as
   * several candidates. Choosing among them is a judgement about identity,
   * which belongs to the person who can check it and not to a `LIMIT 1`.
   */
  searchCustomers(query: string): Promise<CustomerSearchOutcome>;
}

export type NetsuiteCustomerCandidate = {
  netsuiteCustomerId: string;
  entityId: string | null;
  companyName: string | null;
  inactive: boolean;
};

export type CustomerSearchOutcome =
  | { state: "ok"; candidates: NetsuiteCustomerCandidate[] }
  | { state: "unavailable"; detail: string };
