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
/**
 * Override the governed term this fake reports as CURRENT.
 *
 * Needed to establish that a sent quote renders its frozen snapshot rather
 * than re-deriving: with the customer record unchanged, "frozen" and "live"
 * produce the same string and the assertion proves nothing.
 */
function termsOverride(): string | null {
  const v = process.env.NEXUS_FAKE_NETSUITE_TERMS;
  return v && v.trim() ? v.trim() : null;
}
/** Artificial latency, so a mid-flight switch is reliably observable. */
async function delay(): Promise<void> {
  const ms = Number(process.env.NEXUS_FAKE_NETSUITE_DELAY_MS ?? "0");
  if (Number.isFinite(ms) && ms > 0) {
    await new Promise((r) => setTimeout(r, ms));
  }
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
    await delay();
    if (netsuiteCustomerId.includes("_broken")) return null;
    if (scenario() === "customer-missing") return null;
    if (scenario() === "customer-no-terms") return { terms: null };
    const override = termsOverride();
    if (override) {
      return {
        terms: { id: "validation_ns_terms_override", refName: override },
        companyName: "Validation Customer",
        entityId: "V-1000",
      };
    }
    // A SECOND governed term, so "each customer keeps its own" is
    // distinguishable from "one value is printed everywhere" -- which is the
    // claim the customer-terms work is actually about.
    if (netsuiteCustomerId.includes("_alt_")) {
      return {
        terms: { id: "validation_ns_terms_net60", refName: "Net 60" },
        companyName: "Validation Alt-Terms Customer",
        entityId: "V-ALT",
      };
    }
    return {
      terms: { id: "validation_ns_terms_net30", refName: "Net 30" },
      companyName: "Validation Customer",
      entityId: "V-1000",
    };
  },
  async searchCustomers(query: string) {
    record("customer-search", { query });
    fail("customer-search");
    // `search-unavailable` exists so the harness can exercise the branch that
    // must NOT read as "no such customer". That distinction is the point of
    // the outcome union, and a fake that could only succeed would leave the
    // more dangerous half of it untested.
    if (scenario() === "search-unavailable") {
      return { state: "unavailable" as const, detail: "NetSuite unreachable" };
    }
    const q = query.trim().toUpperCase();
    if (!q) return { state: "ok" as const, candidates: [] };
    const all = [
      {
        netsuiteCustomerId: "validation_ns_customer",
        entityId: "V-1000",
        companyName: "Validation Customer",
        inactive: false,
      },
      {
        // A candidate the fake CANNOT read back. Save must refuse it, which is
        // what makes "a visible failure, then a successful retry" reachable in
        // one session -- a scenario flag fails every save and can never show
        // the recovery half.
        netsuiteCustomerId: "validation_ns_customer_broken",
        entityId: "V-BROKEN",
        companyName: "Validation Customer (unreadable)",
        inactive: false,
      },
      {
        netsuiteCustomerId: "validation_ns_customer_alt",
        entityId: "V-1001",
        companyName: "Validation Customer Holdings",
        inactive: false,
      },
    ];
    return {
      state: "ok" as const,
      candidates: all.filter(
        (c) =>
          (c.companyName ?? "").toUpperCase().includes(q) ||
          (c.entityId ?? "").toUpperCase().includes(q),
      ),
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
