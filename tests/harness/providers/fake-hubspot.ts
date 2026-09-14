import "server-only";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type {
  HubSpotOperations,
  HubSpotStage,
} from "@/lib/integrations/hubspot-provider";
import { normalizeHubSpotProductCreateInput, toHubSpotProductUpdateProperties } from "../../../src/lib/integrations/hubspot-provider.ts";

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

/**
 * Products the fake actually holds.
 *
 * The fake used to be stateless: `updateProduct` echoed its own input back,
 * so a read-back could only ever agree with the write, and reconciling an
 * uncertain outcome was untestable by construction. A control that cannot
 * disagree cannot establish anything.
 */
const productStore = new Map<string, Record<string, string>>();

/**
 * A write that has not finished yet.
 *
 * A request that times out is not a request that stopped. The read-back can
 * legitimately show the product unchanged and the write can land afterwards,
 * which is the case that makes "the read-back says nothing changed" a
 * statement about a MOMENT rather than an outcome. Armed by the `late`
 * scenario and applied by the first read that follows it -- so that read sees
 * the old state, and every later one sees the new.
 */
const deferredWrites = new Map<string, Record<string, string>>();

export function __fakeHubspotProduct(id: string): Record<string, string> | null {
  const p = productStore.get(id);
  return p ? { ...p } : null;
}

/**
 * HubSpot's own update semantics, so the fake can be wrong the same way the
 * real thing would be: an omitted property is untouched, and "" clears one.
 */
function applyMerge(
  id: string,
  current: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const merged = { ...current };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === "") delete merged[k];
    else merged[k] = v;
  }
  productStore.set(id, merged);
  return merged;
}


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
  productStore.clear();
  deferredWrites.clear();
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
  async listProductTypeOptions() {
    record("product-type-options", {});
    fail("product-type-options");
    // MIRRORS THE PRODUCTION OPTION SET -- portal 21497798 (STANDARD),
    // 16 non-hidden options, captured read-only 2026-09-12.
    //
    // TWO corrections are recorded here because both were mine.
    //
    // First, the original list was written from the spec-schema MAPPING. That
    // is a sibling module, not the system, and a fixture invented from one is
    // not a fixture of the other.
    //
    // Second, the replacement was captured from the DEV portal (46710404,
    // SANDBOX) and labelled production. `getProductsClient()` selects its
    // token on `NODE_ENV !== "production"`, so a script run from a shell
    // reaches the sandbox -- and the adapter being named "production" proves
    // nothing about where it points. The two portals genuinely differ: the
    // sandbox carries `Corrugated` and `Preliminary`, production carries
    // `Finished Goods`, `Turnkey` and `Tertiary Packaging`. Reading the wrong
    // one produced a confident report of a mapping divergence that does not
    // exist in production.
    //
    // The destination is now established by portal id, not by a name.
    //
    // THREE label/value pairs diverge in production -- one more than the
    // sandbox has. `Logistics` is the label for `Third Party Logistics`, and a
    // label-keyed fixture would silently resolve nothing for it.
    return [
      ["Cards, Booklets", "Cards, Booklets"],
      ["Design", "Design"],
      ["Filling and Packout Services", "Filling and Packout Services"],
      ["Formulation", "Formulation"],
      ["Freight", "Freight"],
      ["Labels", "Labels"],
      ["Third Party Logistics", "Logistics"],
      ["One Time Charges", "One Time Charges"],
      ["Primary", "Primary Packaging"],
      ["R&D / Testing", "R&D / Testing"],
      ["Raw ingredients", "Raw ingredients"],
      ["Secondary", "Secondary Packaging"],
      ["Soft Goods and Accessories", "Soft Goods and Accessories"],
      ["Finished Goods", "Finished Goods"],
      ["Turnkey", "Turnkey"],
      ["Tertiary Packaging", "Tertiary Packaging"],
    ].map(([value, label], i) => ({ label, value, displayOrder: i }));
  },
  async updateProduct(hubspotProductId, input) {
    const properties = toHubSpotProductUpdateProperties(input);
    record("product-update", { hubspotProductId, ...properties });
    fail("product-update");

    const current = productStore.get(hubspotProductId) ?? {};

    // A flat refusal: HubSpot answered and said no. Nothing applied, and a
    // caller may say so.
    //
    // NOT named `product-update-fails`. The shared `fail()` helper throws for
    // `${operation}-fails` before this branch is ever reached, so a scenario
    // under that name can only ever produce a status-less error -- which is
    // the UNCERTAIN case, not this one. Naming it that way left this branch
    // unreachable and the rejected path with no coverage at all, while the
    // walk line that appeared to test it passed on the other path's message.
    if (scenario() === "product-update-rejected") {
      throw Object.assign(new Error("Property values were not valid"), {
        code: 400,
      });
    }

    // UNCERTAIN, and the write DID apply. This is the case that makes
    // "nothing was changed" a false statement: the caller sees only a
    // timeout, while HubSpot holds the new values. Reconciliation is the
    // only thing that can tell the two uncertain cases apart.
    if (scenario() === "product-update-uncertain-applied") {
      applyMerge(hubspotProductId, current, properties);
      throw Object.assign(new Error("socket hang up"), { code: undefined });
    }

    // UNCERTAIN, and the write did NOT apply.
    if (scenario() === "product-update-uncertain-lost") {
      throw Object.assign(new Error("socket hang up"), { code: undefined });
    }

    // UNCERTAIN, and the write applied IN PART. The read-back will not match
    // the requested state, and it will not show the product unchanged either
    // -- so neither "it landed" nor "nothing happened" is true of it.
    if (scenario() === "product-update-partial") {
      const partial: Record<string, string> = {};
      if (properties.name !== undefined) partial.name = properties.name;
      applyMerge(hubspotProductId, current, partial);
      throw Object.assign(new Error("socket hang up"), { code: undefined });
    }

    // UNCERTAIN now, APPLIED shortly afterwards. Armed here and released by
    // the next read, so the read-back that adjudicates this failure sees the
    // product unchanged and every read after it sees the write.
    if (scenario() === "product-update-late") {
      deferredWrites.set(hubspotProductId, { ...properties });
      throw Object.assign(new Error("socket hang up"), { code: undefined });
    }

    // A write that takes a long time. Used to hold the edit's lock open while
    // something else queues behind it.
    if (scenario() === "product-update-slow") {
      await new Promise((r) => setTimeout(r, 1500));
    }

    // UNCERTAIN, and the read-back ALSO fails -- genuinely indeterminate.
    if (scenario() === "product-update-indeterminate") {
      throw Object.assign(new Error("socket hang up"), { code: undefined });
    }

    const merged = applyMerge(hubspotProductId, current, properties);
    return {
      id: hubspotProductId,
      hs_sku: merged.hs_sku ?? null,
      name: merged.name ?? "",
      price: merged.price ?? null,
      submittedProperties: { ...properties },
      responseBody: { id: hubspotProductId, properties: { ...merged } },
    };
  },

  async getProduct(hubspotProductId) {
    record("product-get", { hubspotProductId });
    if (scenario() === "product-update-indeterminate") {
      // The read could not be performed. NOT an authoritative absence.
      throw new Error("HubSpot fake read failure");
    }
    const p = productStore.get(hubspotProductId);
    // Answer from the state as it stands, THEN release any deferred write.
    // The adjudicating read sees the product unchanged; the next one sees the
    // write that was still in flight when it was asked.
    const answer = p ? { ...p } : null;
    const late = deferredWrites.get(hubspotProductId);
    if (late) {
      deferredWrites.delete(hubspotProductId);
      applyMerge(hubspotProductId, p ?? {}, late);
    }
    if (!answer) return null;
    return {
      id: hubspotProductId,
      archived: false,
      properties: Object.fromEntries(
        Object.entries(answer).map(([k, v]) => [k, v === "" ? null : v]),
      ),
    };
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
    productStore.set(
      id,
      Object.fromEntries(
        Object.entries(normalizedInput)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      ),
    );
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
