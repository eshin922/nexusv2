import "server-only";
import type { NetSuiteOperations } from "@/lib/integrations/netsuite-provider";

export type FakeNetSuiteCall = {
  operation: string;
  input: Record<string, unknown>;
  at: string;
};

const calls: FakeNetSuiteCall[] = [];
const ordersByKey = new Map<string, { internalId: string; tranId: string }>();
let nextOrder = 1;

function scenario(): string {
  return process.env.NEXUS_FAKE_NETSUITE_SCENARIO ?? "success";
}
function record(operation: string, input: Record<string, unknown>) {
  calls.push({ operation, input, at: new Date().toISOString() });
}
function fail(operation: string) {
  if (scenario() === `${operation}-fails`) {
    throw new Error(`NetSuite fake ${operation} failure`);
  }
}

export function readFakeNetSuiteCalls(): readonly FakeNetSuiteCall[] {
  return calls;
}
export function resetFakeNetSuite() {
  calls.length = 0;
  ordersByKey.clear();
  nextOrder = 1;
}

export const fakeNetSuite: NetSuiteOperations = {
  name: "fake-netsuite",
  kind: "isolated",
  async resolveItem(sku) {
    record("item-lookup", { sku });
    fail("item-lookup");
    if (scenario() === "item-missing") return { status: "not_found", sku };
    if (scenario() === "item-ambiguous") {
      return {
        status: "ambiguous",
        sku,
        matches: [
          { netsuiteItemId: "validation_ns_item_a", itemid: sku, itemtype: "InvtPart" },
          { netsuiteItemId: "validation_ns_item_b", itemid: sku, itemtype: "InvtPart" },
        ],
      };
    }
    return {
      status: "found",
      sku,
      netsuiteItemId: `validation_ns_item_${sku.toLowerCase().replace(/\W+/g, "_")}`,
      itemid: sku,
      itemtype: "InvtPart",
    };
  },
  /**
   * Scenario-driven, and deliberately able to produce the case a real outage
   * produces: `item-validate-fails` throws, which the caller must turn into
   * `indeterminate` for every id — never `gone`. A fake that could only ever
   * answer "usable" or "gone" would make the distinction untestable in the
   * harness, which is where the distinction most needs exercising.
   */
  async validateItemInternalIds(internalIds) {
    record("item-validate", { internalIds: [...internalIds] });
    fail("item-validate");
    const out = new Map<
      string,
      | { state: "usable"; itemCode: string }
      | { state: "gone" }
      | { state: "inactive"; itemCode: string }
      | { state: "indeterminate"; reason: string }
    >();
    for (const id of internalIds) {
      if (scenario() === "item-validate-gone") {
        out.set(id, { state: "gone" });
      } else if (scenario() === "item-validate-inactive") {
        out.set(id, { state: "inactive", itemCode: `FAKE-${id}` });
      } else {
        out.set(id, { state: "usable", itemCode: `FAKE-${id}` });
      }
    }
    return out;
  },
  async resolveBusinessSegment(segmentId) {
    record("business-segment-resolution", { segmentId });
    fail("business-segment-resolution");
    return `Validation Segment ${segmentId}`;
  },
  async resolveProjectSource(label) {
    record("project-source-resolution", { label });
    fail("project-source-resolution");
    if (scenario() === "classification-missing") {
      throw new Error(`NetSuite fake project source missing: ${label}`);
    }
    return "validation_project_source";
  },
  async readCustomerTerms(netsuiteCustomerId) {
    record("customer-terms-read", { netsuiteCustomerId });
    fail("customer-terms-read");
    // Scenario hooks mirror the two unresolved outcomes Send must fail closed
    // on, so the harness can exercise the refusal as well as the happy path.
    if (scenario() === "customer-missing") return null;
    if (scenario() === "customer-no-terms") return { terms: null };
    return {
      terms: { id: "validation_ns_terms_net30", refName: "Net 30" },
    };
  },
  async createSalesOrder(payload, { idempotencyKey }) {
    record("sales-order-create", { idempotencyKey, payload });
    const existing = ordersByKey.get(idempotencyKey);
    if (existing) return { internalId: existing.internalId };
    if (scenario() === "so-rejection") {
      throw new Error("NetSuite fake Sales Order rejection");
    }
    const sequence = nextOrder++;
    const created = {
      internalId: `validation_ns_so_${sequence}`,
      tranId: `VSO${String(sequence).padStart(5, "0")}`,
    };
    ordersByKey.set(idempotencyKey, created);
    if (scenario() === "response-lost") {
      throw new Error("NetSuite fake response lost after creation");
    }
    if (scenario() === "timeout") {
      throw new Error("NetSuite fake timeout before confirmation");
    }
    return { internalId: created.internalId };
  },
  async fetchSalesOrderTranid(internalId) {
    record("sales-order-tranid", { internalId });
    fail("sales-order-tranid");
    if (scenario() === "tranid-missing") return null;
    return (
      Array.from(ordersByKey.values()).find(
        (order) => order.internalId === internalId,
      )?.tranId ?? null
    );
  },
};
