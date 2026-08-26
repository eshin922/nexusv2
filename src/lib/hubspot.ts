import "server-only";
import { Client } from "@hubspot/api-client";
import type {
  HubSpotProductCreateInput,
  HubSpotProductCreateResult,
} from "@/lib/integrations/hubspot-provider";
import { normalizeHubSpotProductCreateInput } from "@/lib/integrations/hubspot-provider";
import {
  composeContactName,
  selectContact,
  selectPrimaryCompany,
} from "@/lib/hubspot-customer-identity";
import type {
  ContactSelection,
  SelectedContact,
} from "@/lib/hubspot-customer-identity";

// DPS "Sales" pipeline (id=108896657). Slice 2 surfaces only deals up to and
// including the Project Setup ("Purchase Order") phase — anything in
// production or closed is excluded from the import list.
export const ACTIVE_STAGE_IDS = [
  "195274338", // New (Acquiring Info)
  "195274339", // Development & Quoting
  "195274340", // Formal Quoting          (≈ "Quote Request" in spec)
  "195274342", // Project Setup           (≈ "Purchase Order" in spec)
] as const;

export type ProductSummary = {
  id: string;
  name: string;
  sku: string | null;
  productType: string | null;
  description: string | null;
  price: string | null;
};

export type ProductDetail = ProductSummary & {
  cogs: string | null;
  classification: string | null;
};

export class HubspotError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "HubspotError";
    this.cause = cause;
  }
}

let _readClient: Client | null = null;
let _writeClient: Client | null = null;
let _productsClient: Client | null = null;

/**
 * Products-domain dev/prod-aware client. Phase 1 (May 2026) pulled
 * the products-write path forward from the originally-planned Slice
 * 12 work. In dev, all Products-domain ops (search, get, create)
 * hit the DEV sandbox via HUBSPOT_DEV_ACCESS_TOKEN. In prod, they
 * hit the PROD hub via HUBSPOT_WRITE_ACCESS_TOKEN (which carries
 * both read + write scopes for Products since the dev token does).
 *
 * Wider HubSpot domain dev/prod split (deals, companies, owners,
 * contacts) is deferred to a follow-up — those continue to use
 * HUBSPOT_ACCESS_TOKEN (PROD read) in both dev and prod for now.
 * Rationale: existing dev workflows (deal search, project import)
 * depend on PROD deal data being visible; switching them to dev
 * sandbox in dev would empty out those workflows. Phase 1 keeps
 * the surgical scope: Products domain only.
 *
 * Pattern 32 applies — pre-existing dev `quote_skus` rows reference
 * PROD `hubspot_product_id` values that won't resolve against the
 * dev sandbox. No "refresh from HubSpot" path exists today so the
 * orphan refs are invisible. Phase 2 (catalog parity) owns the
 * orphan-handling story when refresh ships.
 */
/**
 * The Products-domain client. Dev/prod-aware: in dev it talks to the SANDBOX
 * portal, in production to the live one.
 *
 * Exported because the `hs_product_type` vocabulary must be read from the same
 * portal that supplies and receives product values. The two portals' option
 * sets genuinely differ — `Finished Goods` and `Turnkey` exist only in
 * production; `Corrugated` and `Preliminary` only in the sandbox — so a
 * vocabulary read from the other client would validate a create against options
 * the receiving portal does not have.
 */
export function getProductsClient(): Client {
  if (_productsClient) return _productsClient;
  const isDev = process.env.NODE_ENV !== "production";
  const token = isDev
    ? process.env.HUBSPOT_DEV_ACCESS_TOKEN ?? process.env.HUBSPOT_ACCESS_TOKEN
    : process.env.HUBSPOT_WRITE_ACCESS_TOKEN ?? process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token)
    throw new HubspotError(
      isDev
        ? "Neither HUBSPOT_DEV_ACCESS_TOKEN nor HUBSPOT_ACCESS_TOKEN is set (dev Products-domain client requires at least one)"
        : "Neither HUBSPOT_WRITE_ACCESS_TOKEN nor HUBSPOT_ACCESS_TOKEN is set (prod Products-domain client requires at least one)",
    );
  _productsClient = new Client({ accessToken: token });
  return _productsClient;
}

export function getReadClient(): Client {
  if (_readClient) return _readClient;
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token)
    throw new HubspotError(
      "HUBSPOT_ACCESS_TOKEN is not set (production read-only token required)",
    );
  _readClient = new Client({ accessToken: token });
  return _readClient;
}

export function getWriteClient(): Client {
  if (_writeClient) return _writeClient;
  const token = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
  if (!token)
    throw new HubspotError(
      "HUBSPOT_WRITE_ACCESS_TOKEN is not set (write-enabled token required for Mark-Accepted writeback)",
    );
  _writeClient = new Client({ accessToken: token });
  return _writeClient;
}

// ---------- Slice 12 Step 7b — Deal-stage push/rollback helpers ----------
//
// Powers Mark Accepted (sent → accepted, deal stage → firm-configured
// target label) and Q7 rollback (accepted → sent, deal stage → prior
// snapshotted stage id).
//
// External-first ordering per v3 §5.1: markAccepted / unmarkAccepted
// fire these BEFORE the DB tx. On HubSpot failure, DB tx never runs
// — quote status stays put; PM retries.
//
// The DPS Sales pipeline id (108896657) is currently hardcoded. If
// the firm ever runs multiple pipelines, extend to firm_settings.

const DPS_SALES_PIPELINE_ID = "108896657";

type PipelineStage = { id: string; label: string; displayOrder: number };

let _pipelineStagesCache: PipelineStage[] | null = null;

// Slice 12 Step 8a — public re-export for display-only label
// resolution (sub-tab 4 systems card). Same underlying cache as
// the internal callers; alias name distinguishes read-intent.
export async function loadPipelineStagesForLabel(): Promise<PipelineStage[]> {
  return loadPipelineStages();
}

async function loadPipelineStages(): Promise<PipelineStage[]> {
  if (_pipelineStagesCache) return _pipelineStagesCache;
  const c = getReadClient();
  try {
    const pipeline = await c.crm.pipelines.pipelinesApi.getById(
      "deals",
      DPS_SALES_PIPELINE_ID,
    );
    _pipelineStagesCache = pipeline.stages.map((s) => ({
      id: s.id,
      label: s.label,
      displayOrder: s.displayOrder,
    }));
    return _pipelineStagesCache;
  } catch (e) {
    throw new HubspotError(
      `Failed to load pipeline ${DPS_SALES_PIPELINE_ID} stages`,
      e,
    );
  }
}

export type DealStageInfo = { id: string; label: string };

// Returns the deal's current stage as { id, label }. Label lookup
// via the cached pipeline; id is what HubSpot stores. Used by
// markAccepted to snapshot from_stage for future rollback.
export async function getDealStage(dealId: string): Promise<DealStageInfo> {
  const c = getReadClient();
  let d;
  try {
    d = await c.crm.deals.basicApi.getById(dealId, ["dealstage", "pipeline"]);
  } catch (e) {
    throw new HubspotError(`Failed to read deal ${dealId} stage`, e);
  }
  const stageId = d.properties.dealstage;
  if (!stageId) {
    throw new HubspotError(
      `Deal ${dealId} has no dealstage property (unexpected shape)`,
    );
  }
  const stages = await loadPipelineStages();
  const found = stages.find((s) => s.id === stageId);
  return {
    id: stageId,
    // Fallback to the raw id if we can't resolve the label — audit
    // trail should still be forensically useful even if the deal is
    // on a stage outside the DPS pipeline (edge case).
    label: found?.label ?? stageId,
  };
}

// Update a deal's stage. Accepts either an internal stage id (e.g.
// "195607084") or a display label (e.g. "Won - In production").
// Label-based inputs get resolved via the cached pipeline stages;
// unrecognized labels throw with a clear message + list of valid
// options.
//
// Returns the resolved { id, label } so callers can snapshot the
// to_stage in audit_log symmetrically with getDealStage's shape.
export async function updateDealStage(
  dealId: string,
  targetStage: string,
  opts?: {
    /** Slice 12 Step 8a — optional amount patch fired in the SAME
     * HubSpot API call as the stage transition. R9 designer notes
     * §2 + data-source map row for "HubSpot push (pushing / ok /
     * error)": "one push, at acceptance: deal stage → Closed Won,
     * amount = selected tier's turnkey total". Consolidated to one
     * basicApi.update call so the two properties either both land
     * or both fail — no half-written state. Number, USD, unrounded.
     * Reporting nit if it drifts from downstream reality
     * (never a state problem per CA disposition — deal amount is
     * a salesperson estimate for reporting, not binding). */
    amount?: number;
  },
): Promise<DealStageInfo> {
  const stages = await loadPipelineStages();
  // Detect internal-id-shape input (numeric strings match; labels don't)
  const isInternalId = /^\d+$/.test(targetStage);
  let resolved: PipelineStage | undefined;
  if (isInternalId) {
    resolved = stages.find((s) => s.id === targetStage);
  } else {
    resolved = stages.find(
      (s) => s.label.toLowerCase() === targetStage.toLowerCase(),
    );
  }
  if (!resolved) {
    const validLabels = stages.map((s) => `'${s.label}'`).join(", ");
    throw new HubspotError(
      `Deal stage '${targetStage}' not found in pipeline ${DPS_SALES_PIPELINE_ID}. Valid: ${validLabels}`,
    );
  }

  const properties: Record<string, string> = {
    dealstage: resolved.id,
  };
  if (opts?.amount !== undefined) {
    // Slice 12 Step 9 CB round-1 finding — round at the push
    // boundary. Internal math retains full precision per #148 P5
    // policy; outbound payloads round to 2dp so HubSpot deals
    // don't receive float residue like `300.00000000000006` from
    // JS IEEE 754 arithmetic. Fix pairs with the mark-complete
    // §7.2 patch site (see mark-complete.ts:runAmountPatchIfNeeded).
    properties.amount = opts.amount.toFixed(2);
  }

  const c = getWriteClient();
  try {
    await c.crm.deals.basicApi.update(dealId, { properties });
  } catch (e) {
    const amountSuffix =
      opts?.amount !== undefined ? ` (amount ${opts.amount})` : "";
    throw new HubspotError(
      `Failed to update deal ${dealId} stage to '${resolved.label}' (${resolved.id})${amountSuffix}`,
      e,
    );
  }

  return { id: resolved.id, label: resolved.label };
}

export async function fetchCompanyIdsForDeals(
  c: Client,
  dealIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (dealIds.length === 0) return map;
  try {
    const resp = await c.crm.associations.v4.batchApi.getPage("deals", "companies", {
      inputs: dealIds.map((id) => ({ id })),
    });
    for (const r of resp.results ?? []) {
      const fromId = (r as unknown as { _from?: { id?: string } })._from?.id;
      if (!fromId) continue;
      // The EXPLICITLY primary company, never `to[0]`.
      //
      // This read took the first association until #431 Step 2. Verified
      // against the live schema: deal->companies defines `typeId 5, label
      // "Primary"`, so a governed primary exists and the first row was only
      // ever coincidentally the right one. Position is not intent, and this is
      // the identity the customer's own quotation is addressed from.
      const companyId = selectPrimaryCompany(
        (r.to ?? []).map((t) => ({
          companyId: String(t.toObjectId),
          typeIds: (t.associationTypes ?? []).map((a) => Number(a.typeId)),
        })),
      );
      if (companyId) map.set(fromId, companyId);
    }
  } catch {
    // Non-fatal: deals without associations just show no client name
  }
  return map;
}

export async function fetchCompanyNames(
  c: Client,
  companyIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (companyIds.length === 0) return map;
  try {
    const resp = await c.crm.companies.batchApi.read({
      inputs: companyIds.map((id) => ({ id })),
      properties: ["name"],
      propertiesWithHistory: [],
    });
    for (const co of resp.results ?? []) {
      const name = co.properties?.name;
      if (name) map.set(co.id, name);
    }
  } catch {
    // Non-fatal
  }
  return map;
}

export type CompanyAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

/**
 * The company's governed business address. HubSpot is authoritative and the
 * values pass through verbatim — including ones that look wrong, because
 * correcting a customer's address on the way to their own quotation would put a
 * value in front of them that exists nowhere in the CRM.
 */
export async function fetchCompanyAddresses(
  c: Client,
  companyIds: string[],
): Promise<Map<string, CompanyAddress>> {
  const map = new Map<string, CompanyAddress>();
  if (companyIds.length === 0) return map;
  try {
    const resp = await c.crm.companies.batchApi.read({
      inputs: companyIds.map((id) => ({ id })),
      properties: ["address", "address2", "city", "state", "zip", "country"],
      propertiesWithHistory: [],
    });
    for (const co of resp.results ?? []) {
      const p = co.properties ?? {};
      map.set(co.id, {
        line1: p.address ?? null,
        line2: p.address2 ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        postalCode: p.zip ?? null,
        country: p.country ?? null,
      });
    }
  } catch {
    // Non-fatal: a deal without a resolvable address renders without one.
  }
  return map;
}

export type CustomerContact = {
  contactId: string | null;
  selection: ContactSelection;
  name: string | null;
  email: string | null;
  title: string | null;
};

const UNRESOLVED_CONTACT: CustomerContact = {
  contactId: null,
  selection: "unresolved",
  name: null,
  email: null,
  title: null,
};

/**
 * The customer contact for each deal, under the governed V1 selection rule
 * (see `hubspot-customer-identity.ts`). Returns `unresolved` — never a blank
 * that reads like "nobody is associated" — when the lookup itself fails.
 */
export async function fetchCustomerContactsForDeals(
  c: Client,
  dealIds: string[],
): Promise<Map<string, CustomerContact>> {
  const map = new Map<string, CustomerContact>();
  if (dealIds.length === 0) return map;

  let selectedByDeal: Map<string, SelectedContact>;
  try {
    const resp = await c.crm.associations.v4.batchApi.getPage("deals", "contacts", {
      inputs: dealIds.map((id) => ({ id })),
    });
    selectedByDeal = new Map();
    for (const r of resp.results ?? []) {
      const fromId = (r as unknown as { _from?: { id?: string } })._from?.id;
      if (!fromId) continue;
      selectedByDeal.set(
        fromId,
        selectContact(
          (r.to ?? []).map((t) => ({
            contactId: String(t.toObjectId),
            // HubSpot publishes no primary-contact association type for deals
            // in this portal (deal->contacts defines only `typeId 3, label
            // null`). The check stays anyway: it costs nothing, and if a
            // primary label is ever defined, the rule's first branch starts
            // working without another change here.
            isPrimary: (t.associationTypes ?? []).some(
              (a) => (a.label ?? "").toLowerCase() === "primary",
            ),
          })),
        ),
      );
    }
  } catch {
    for (const id of dealIds) map.set(id, UNRESOLVED_CONTACT);
    return map;
  }

  // Only the deals that actually selected someone need a contact read.
  const wanted = [...selectedByDeal.values()]
    .map((s) => s.contactId)
    .filter((id): id is string => id !== null);

  const detail = new Map<string, { name: string | null; email: string | null; title: string | null }>();
  if (wanted.length > 0) {
    try {
      const resp = await c.crm.contacts.batchApi.read({
        inputs: [...new Set(wanted)].map((id) => ({ id })),
        properties: ["firstname", "lastname", "email", "jobtitle"],
        propertiesWithHistory: [],
      });
      for (const ct of resp.results ?? []) {
        const p = ct.properties ?? {};
        detail.set(ct.id, {
          name: composeContactName(p.firstname ?? null, p.lastname ?? null),
          email: p.email ?? null,
          title: p.jobtitle ?? null,
        });
      }
    } catch {
      for (const id of dealIds) map.set(id, UNRESOLVED_CONTACT);
      return map;
    }
  }

  for (const id of dealIds) {
    const sel = selectedByDeal.get(id);
    if (!sel) {
      // The batch answered and simply did not mention this deal, which is
      // HubSpot's way of saying it has no contact associations.
      map.set(id, { contactId: null, selection: "none_zero", name: null, email: null, title: null });
      continue;
    }
    const d = sel.contactId ? detail.get(sel.contactId) ?? null : null;
    map.set(id, {
      contactId: sel.contactId,
      selection: sel.selection,
      name: d?.name ?? null,
      email: d?.email ?? null,
      title: d?.title ?? null,
    });
  }
  return map;
}

export type OwnerDetail = {
  name: string;
  email: string | null;
};

export type HubSpotVendor = {
  id: string;
  name: string;
};

const HUBSPOT_VENDOR_TYPE = "VENDOR";

function toVendor(company: {
  id: string;
  archived?: boolean;
  properties?: Record<string, string | null | undefined>;
}): HubSpotVendor | null {
  if (company.archived) return null;
  const properties = company.properties ?? {};
  if (properties.type !== HUBSPOT_VENDOR_TYPE) return null;
  const name = properties.name?.trim();
  if (!name) return null;
  return { id: company.id, name };
}

/** Read-only governed Vendor lookup for BV-001. */
export async function searchVendorCompanies(
  query: string,
  limit = 20,
): Promise<HubSpotVendor[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const c = getReadClient();
  try {
    const response = await c.crm.companies.searchApi.doSearch({
      query: trimmed,
      filterGroups: [
        {
          filters: [
            {
              propertyName: "type",
              operator: "EQ" as never,
              value: HUBSPOT_VENDOR_TYPE,
            },
          ],
        },
      ],
      sorts: ["name"],
      properties: ["name", "type"],
      limit: Math.min(Math.max(limit, 1), 100),
      after: "0",
    });
    return (response.results ?? [])
      .map((company) => toVendor(company))
      .filter((vendor): vendor is HubSpotVendor => vendor !== null);
  } catch (error) {
    throw new HubspotError("Failed to search HubSpot Vendor companies", error);
  }
}

/**
 * Resolve selection identity at the write boundary. Archived, unnamed, missing,
 * and no-longer-Vendor companies all resolve to null so callers fail closed.
 */
export async function resolveVendorCompany(
  companyId: string,
): Promise<HubSpotVendor | null> {
  const id = companyId.trim();
  if (!id) return null;
  const c = getReadClient();
  try {
    const company = await c.crm.companies.basicApi.getById(
      id,
      ["name", "type"],
      [],
      [],
      false,
    );
    return toVendor(company);
  } catch (error: unknown) {
    const failure = error as { code?: unknown; statusCode?: unknown };
    if (Number(failure.code ?? failure.statusCode) === 404) return null;
    throw new HubspotError(`Failed to resolve HubSpot Vendor ${id}`, error);
  }
}

// Lists all org owners (HubSpot has no batch-by-id endpoint). At DPS scale
// this is a single page (~16 owners). Returns details keyed by owner id —
// callers index into this for whichever IDs they actually need.
export async function fetchOwnerDetails(
  c: Client,
): Promise<Map<string, OwnerDetail>> {
  const map = new Map<string, OwnerDetail>();
  try {
    const resp = await c.crm.owners.ownersApi.getPage(undefined, undefined, 100);
    for (const o of resp.results ?? []) {
      const id = String(o.id);
      const name =
        [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || id;
      map.set(id, { name, email: o.email ?? null });
    }
  } catch {
    // Non-fatal
  }
  return map;
}

// ---------- products ----------

// Phase 1 (May 2026) — full HubSpot product property set per
// product-modal-brief.md §"Reference: HubSpot property names" + the
// existing Slice 5 minimal set. Read paths return ProductSummary
// (legacy callers); ProductDetail (extended) and ProductFull (Phase 1)
// expose the larger set as needed.
const PRODUCT_PROPERTIES = [
  "name",
  "hs_sku",
  "mf_sku",
  "hs_product_type",
  "hs_product_classification",
  "hs_status",
  "description",
  "hs_url",
  "hs_images",
  "price",
  "hs_cost_of_goods_sold",
  "markup",
  "tax_schedule",
  "hubspot_owner_id",
  "fsc_claim_type",
  "fsc_status",
  "fsc_supplier_verified",
] as const;

// HubSpot Product enum constants live in src/lib/hubspot-product-
// options.ts (no `server-only`) so the Add-product modal client
// component can import them without violating the boundary.
// Re-exported here so existing server-side imports from
// src/lib/hubspot.ts continue to work.
export {
  HS_PRODUCT_TYPE_OPTIONS,
  TAX_SCHEDULE_OPTIONS,
  FSC_CLAIM_TYPE_OPTIONS,
  FSC_STATUS_OPTIONS,
} from "./hubspot-product-options";

function toSummary(p: {
  id: string;
  properties?: Record<string, string | null | undefined>;
}): ProductSummary {
  const props = p.properties ?? {};
  return {
    id: p.id,
    name: props.name || "(unnamed product)",
    sku: props.hs_sku || null,
    productType: props.hs_product_type || null,
    description: props.description || null,
    price: props.price || null,
  };
}

export async function searchProducts(
  query: string,
  limit = 20,
): Promise<ProductSummary[]> {
  const c = getProductsClient();
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const resp = await c.crm.products.searchApi.doSearch({
      query: trimmed,
      properties: [...PRODUCT_PROPERTIES],
      limit,
      after: "0",
      sorts: ["name"],
    });
    return (resp.results ?? []).map(toSummary);
  } catch (err) {
    throw new HubspotError("Failed to search HubSpot products", err);
  }
}

export async function getProduct(productId: string): Promise<ProductDetail | null> {
  const c = getProductsClient();
  let p;
  try {
    p = await c.crm.products.basicApi.getById(productId, [...PRODUCT_PROPERTIES]);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 404) return null;
    throw new HubspotError(`Failed to fetch product ${productId}`, err);
  }
  const props = p.properties ?? {};
  return {
    ...toSummary(p),
    cogs: props.hs_cost_of_goods_sold || null,
    classification: props.hs_product_classification || null,
  };
}

// Phase 1 — exact-match SKU lookup for the modal's blur duplicate
// check. Returns the first product whose hs_sku === sku. The
// search-by-keyword path doesn't enforce exact matching (it does
// substring/token matching), so this uses the proper EQ filter.
export async function findProductBySku(
  sku: string,
): Promise<ProductSummary | null> {
  const trimmed = sku.trim();
  if (!trimmed) return null;
  const c = getProductsClient();
  try {
    const resp = await c.crm.products.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hs_sku",
              operator: "EQ" as never,
              value: trimmed,
            },
          ],
        },
      ],
      properties: [...PRODUCT_PROPERTIES],
      limit: 1,
      after: "0",
      sorts: [],
    });
    const first = resp.results?.[0];
    return first ? toSummary(first) : null;
  } catch (err) {
    throw new HubspotError(
      `Failed to look up product by SKU ${trimmed}`,
      err,
    );
  }
}

// Phase 1 — HubSpot Product create payload. All optional except
// `name` which HubSpot itself requires (the modal's required-field
// validation also gates Unit price + Product type at the form
// boundary). Empty-string values are dropped before send; HubSpot
// treats missing properties as unchanged.
// slice-hubspot-bidirectional — raw HubSpot product shape used by
// the pull flow. Preserves the archive flag + the full property
// bag so the mapper (src/lib/hubspot-mapper.ts) has everything it
// needs to translate one product into a nexus `leaves` row.
export type HubspotProductRaw = {
  id: string;
  archived: boolean;
  properties: Record<string, string | null>;
};

// slice-hubspot-bidirectional — paginated bulk list helper for the
// pull flow. HubSpot's basicApi.getPage returns one page of
// products (default 100, max 100) with a `paging.next.after`
// cursor for the next call. By default the endpoint excludes
// archived products; the `includeArchived: true` flag flips to
// archived-only (HubSpot doesn't return both in one call — pull
// runs the helper twice, once per archive state).
//
// Returns the raw HubSpot shape with full PRODUCT_PROPERTIES;
// mapper consumes this and produces the nexus-side shape.
export async function listProducts(opts: {
  after?: string;
  limit?: number;
  includeArchived?: boolean;
} = {}): Promise<{
  results: HubspotProductRaw[];
  nextAfter: string | null;
}> {
  const c = getProductsClient();
  const limit = Math.min(opts.limit ?? 100, 100);
  try {
    const resp = await c.crm.products.basicApi.getPage(
      limit,
      opts.after,
      [...PRODUCT_PROPERTIES],
      [],
      [],
      opts.includeArchived ?? false,
    );
    return {
      results: (resp.results ?? []).map((p) => ({
        id: p.id,
        archived: (p as { archived?: boolean }).archived ?? false,
        properties: (p.properties ?? {}) as Record<string, string | null>,
      })),
      nextAfter: resp.paging?.next?.after ?? null,
    };
  } catch (err) {
    throw new HubspotError("Failed to list HubSpot products", err);
  }
}

export async function createProduct(
  input: HubSpotProductCreateInput,
): Promise<HubSpotProductCreateResult> {
  const c = getProductsClient();
  const normalizedInput = normalizeHubSpotProductCreateInput(input);
  const properties: Record<string, string> = {};
  for (const [k, v] of Object.entries(normalizedInput)) {
    if (v === undefined || v === null) continue;
    const trimmed = typeof v === "string" ? v.trim() : String(v);
    if (trimmed === "") continue;
    properties[k] = trimmed;
  }
  if (!properties.name)
    throw new HubspotError("createProduct requires `name`");
  try {
    const resp = await c.crm.products.basicApi.create({ properties });
    return {
      id: resp.id,
      hs_sku: resp.properties?.hs_sku ?? null,
      name: resp.properties?.name ?? properties.name,
      price: resp.properties?.price ?? properties.price ?? null,
      submittedProperties: { ...properties },
      responseBody: JSON.parse(JSON.stringify(resp)) as Record<string, unknown>,
    };
  } catch (err) {
    // Surface the SDK's status + HubSpot-side reason so the
    // action-layer error message tells PM *why* (HBS-2 CB smoke
    // observation, 2026-06-15). Defensive against multiple SDK
    // error shapes: @hubspot/api-client may carry `.code` (HTTP
    // status) + `.body.message` (HubSpot reason); fetch errors
    // carry just `.message`. Cap raw text at 200 chars to avoid
    // dumping verbose response bodies inline.
    const status =
      typeof (err as { code?: unknown })?.code === "number"
        ? (err as { code: number }).code
        : null;
    const hubBody = (err as { body?: { message?: unknown } })?.body;
    const hubMessage =
      hubBody && typeof hubBody.message === "string" ? hubBody.message : null;
    const fallbackMessage =
      err instanceof Error ? err.message : String(err);
    const composed = [
      status ? `HTTP ${status}` : null,
      hubMessage ?? fallbackMessage,
    ]
      .filter(Boolean)
      .join(" · ");
    const detail =
      composed.length > 200 ? composed.slice(0, 197) + "…" : composed;
    throw new HubspotError(detail || "Failed to create HubSpot product", err);
  }
}

export async function findHubspotOwnerByEmail(
  email: string,
): Promise<{ id: string; firstName: string | null; lastName: string | null } | null> {
  if (!email) return null;
  try {
    const c = getReadClient();
    const resp = await c.crm.owners.ownersApi.getPage(email);
    const owner = resp.results?.[0];
    if (!owner?.id) return null;
    return {
      id: String(owner.id),
      firstName: owner.firstName ?? null,
      lastName: owner.lastName ?? null,
    };
  } catch {
    return null;
  }
}

// Slice RI.7 — one-shot fetch by HubSpot owner ID for the un-signed-in-rep
// PreparedBy resolution path (CR-SM DEC-8). Used at sendQuote when
// `projects.sales_rep_user_id IS NULL` but `projects.hubspot_owner_id`
// is set. Returns name + email; HubSpot Owners API does NOT carry phone
// (verified against @hubspot/api-client PublicOwner schema), so phone
// is always null from this path. Manual admin entry is the sole phone
// source for users without it on `users.phone`.
export async function findHubspotOwnerById(
  ownerId: string,
): Promise<{ name: string | null; email: string | null } | null> {
  if (!ownerId) return null;
  const n = Number(ownerId);
  if (!Number.isFinite(n)) return null;
  try {
    const c = getReadClient();
    const owner = await c.crm.owners.ownersApi.getById(n);
    const name =
      [owner.firstName, owner.lastName].filter(Boolean).join(" ") ||
      owner.email ||
      null;
    return { name, email: owner.email ?? null };
  } catch {
    return null;
  }
}
