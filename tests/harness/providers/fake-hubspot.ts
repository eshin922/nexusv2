import "server-only";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type {
  HubSpotOperations,
  HubSpotStage,
} from "@/lib/integrations/hubspot-provider";
import { normalizeHubSpotProductCreateInput } from "../../../src/lib/integrations/hubspot-provider.ts";

export type FakeHubSpotCall = {
  operation: string;
  input: Record<string, unknown>;
  at: string;
};

const calls: FakeHubSpotCall[] = [];
const dealStages = new Map<string, HubSpotStage>();
const dealAmounts = new Map<string, number>();
const vendors = [
  { id: "900000000000001", name: "Validation Packaging Vendor" },
  // RESTORED, not added. VAL-104 asserts this vendor's persisted snapshot as
  // `{ id: "900000000000002", name: "Validation Contract Manufacturer" }` — the
  // id and the name together. So `…002` WAS this vendor, and was renamed to
  // `Acme Contract Manufacturing` at some point without the scenario being
  // updated. The spec kept both halves of the old pair, which is why the id it
  // expects and the name it expects stopped belonging to the same row.
  //
  // Adding a third vendor under this name looked right and was not: the save
  // then persisted the new id while the scenario asserted `…002`. Restoring the
  // name to the id the scenario has always asserted is what makes both halves
  // true at once, and it keeps the intent — switching between two GOVERNED
  // vendors — rather than retargeting the scenario at whatever exists.
  { id: "900000000000002", name: "Validation Contract Manufacturer" },
] as const;
let productSequence = 0;

function catalogSize(kind: "active" | "archived"): number {
  const key = kind === "active"
    ? "NEXUS_FAKE_HUBSPOT_ACTIVE_PRODUCTS"
    : "NEXUS_FAKE_HUBSPOT_ARCHIVED_PRODUCTS";
  return Math.max(0, Number.parseInt(process.env[key] ?? (kind === "active" ? "1032" : "3"), 10));
}

function fakeCatalogProduct(index: number, archived: boolean) {
  const number = index + 1;
  return {
    id: `${archived ? "997" : "996"}${String(number).padStart(12, "0")}`,
    archived,
    properties: {
      name: `Validation Catalog Product ${String(number).padStart(4, "0")}`,
      hs_sku: `PVS020-${archived ? "A" : "P"}-${String(number).padStart(4, "0")}`,
      price: "0.00",
      hs_cost_of_goods_sold: String(100 + number),
      hs_url: `https://validation.invalid/products/${number}`,
    },
  };
}

function scenario(): string {
  return process.env.NEXUS_FAKE_HUBSPOT_SCENARIO ?? "success";
}

function record(operation: string, input: Record<string, unknown>) {
  const call = { operation, input, at: new Date().toISOString() };
  calls.push(call);

  const configured = process.env.NEXUS_FAKE_HUBSPOT_LEDGER;
  if (configured) {
    const target = resolve(configured);
    const validationRoot = `${resolve(
      process.cwd(),
      ".artifacts",
      "validation",
    )}${sep}`;
    if (!target.startsWith(validationRoot)) {
      throw new Error("[fake-hubspot] ledger must be under .artifacts/validation");
    }
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, `${JSON.stringify(call)}\n`, "utf8");
  }
}

function fail(operation: string) {
  const selected = scenario();
  if (selected === "unauthorized") throw new Error("HubSpot fake unauthorized");
  if (selected === "timeout") throw new Error("HubSpot fake timeout");
  if (selected === "rate-limit") throw new Error("HubSpot fake rate limit");
  if (selected === "malformed") throw new Error("HubSpot fake malformed response");
  if (selected === `${operation}-fails`) {
    throw new Error(`HubSpot fake ${operation} failure`);
  }
}

export function readFakeHubSpotCalls(): readonly FakeHubSpotCall[] {
  return calls;
}

export function resetFakeHubSpot() {
  calls.length = 0;
  dealStages.clear();
  dealAmounts.clear();
  productSequence = 0;
}

export const fakeHubSpot: HubSpotOperations = {
  name: "fake-hubspot",
  kind: "isolated",
  async findOwnerByEmail(email) {
    record("owner-by-email", { email });
    fail("owner-by-email");
    if (scenario() === "not-found") return null;
    return {
      id: "validation_hs_owner_pm",
      firstName: "Validation",
      lastName: "Owner",
    };
  },
  async findOwnerById(ownerId) {
    record("owner-by-id", { ownerId });
    fail("owner-by-id");
    if (scenario() === "not-found") return null;
    return { name: "Validation Owner", email: "owner@nexus-validation.invalid" };
  },
  async searchVendors(query, limit = 20) {
    record("vendor-search", { query, limit });
    fail("vendor-search");
    const normalized = query.trim().toLowerCase();
    return vendors
      .filter((vendor) => vendor.name.toLowerCase().includes(normalized))
      .slice(0, limit)
      .map((vendor) => ({ ...vendor }));
  },
  async resolveVendor(companyId) {
    record("vendor-resolve", { companyId });
    fail("vendor-resolve");
    if (scenario() === "vendor-ineligible" || scenario() === "not-found") {
      return null;
    }
    const found = vendors.find((vendor) => vendor.id === companyId);
    return found ? { ...found } : null;
  },
  async createProduct(input) {
    const normalizedInput = normalizeHubSpotProductCreateInput(input);
    record("product-create", { ...normalizedInput });
    fail("product-create");
    if (input.name === "Validation Product Provider Failure") {
      throw new Error("HubSpot fake product-create failure");
    }
    productSequence += 1;
    const id = `998${String(productSequence).padStart(12, "0")}`;
    return {
      id,
      hs_sku: normalizedInput.hs_sku ?? null,
      name: normalizedInput.name,
      price: normalizedInput.price,
      submittedProperties: { ...normalizedInput } as Record<string, string>,
      responseBody: {
        id,
        properties: { ...normalizedInput },
        archived: false,
      },
    };
  },
  async listProducts(opts = {}) {
    const archived = opts.includeArchived ?? false;
    const size = catalogSize(archived ? "archived" : "active");
    const offset = Math.max(0, Number.parseInt(opts.after ?? "0", 10));
    const limit = Math.min(opts.limit ?? 100, 100);
    record("product-list", { after: opts.after, limit, includeArchived: archived });
    fail("product-list");
    const end = Math.min(offset + limit, size);
    return {
      results: Array.from({ length: end - offset }, (_, i) => fakeCatalogProduct(offset + i, archived)),
      nextAfter: end < size ? String(end) : null,
    };
  },
  async listDealStages() {
    record("deal-stage-list", {});
    fail("deal-stage-list");
    return [
      { id: "validation_stage_sent", label: "Validation Sent" },
      { id: "validation_stage_accepted", label: "Validation Accepted" },
    ];
  },
  async getDealStage(dealId) {
    record("deal-stage-read", { dealId });
    fail("deal-stage-read");
    return (
      dealStages.get(dealId) ?? {
        id: "validation_stage_sent",
        label: "Validation Sent",
      }
    );
  },
  async updateDealStage(dealId, targetStage, options) {
    record("deal-stage-update", { dealId, targetStage, ...options });
    fail(options?.amount === undefined ? "stage-update" : "stage-and-amount-update");
    const stage = {
      id: targetStage.startsWith("validation_")
        ? targetStage
        : `validation_stage_${targetStage.toLowerCase().replace(/\W+/g, "_")}`,
      label: targetStage,
    };
    dealStages.set(dealId, stage);
    if (options?.amount !== undefined) dealAmounts.set(dealId, options.amount);
    return stage;
  },
  async updateDealAmount(dealId, amount) {
    record("amount-update", { dealId, amount });
    fail("amount-update");
    dealAmounts.set(dealId, amount);
  },
};
