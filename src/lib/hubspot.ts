import "server-only";
import { Client } from "@hubspot/api-client";

// DPS "Sales" pipeline (id=108896657). Slice 2 surfaces only deals up to and
// including the Project Setup ("Purchase Order") phase — anything in
// production or closed is excluded from the import list.
export const ACTIVE_STAGE_IDS = [
  "195274338", // New (Acquiring Info)
  "195274339", // Development & Quoting
  "195274340", // Formal Quoting          (≈ "Quote Request" in spec)
  "195274342", // Project Setup           (≈ "Purchase Order" in spec)
] as const;

export const STAGE_LABEL_BY_ID: Record<string, string> = {
  "195274338": "New (Acquiring Info)",
  "195274339": "Development & Quoting",
  "195274340": "Formal Quoting",
  "195274342": "Project Setup",
};

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
function getProductsClient(): Client {
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used by Slice 12+
function getWriteClient(): Client {
  if (_writeClient) return _writeClient;
  const token = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
  if (!token)
    throw new HubspotError(
      "HUBSPOT_WRITE_ACCESS_TOKEN is not set (write-enabled token required for Mark-Accepted writeback)",
    );
  _writeClient = new Client({ accessToken: token });
  return _writeClient;
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
      const toId = r.to?.[0]?.toObjectId;
      if (fromId && toId !== undefined) map.set(fromId, String(toId));
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

export type OwnerDetail = {
  name: string;
  email: string | null;
};

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
export type ProductCreateInput = {
  name: string;
  hs_sku?: string;
  description?: string;
  hs_images?: string;
  hs_url?: string;
  hubspot_owner_id?: string;
  price?: string;
  hs_cost_of_goods_sold?: string;
  markup?: string;
  hs_product_type?: string;
  tax_schedule?: string;
  fsc_claim_type?: string;
  fsc_status?: string;
  fsc_supplier_verified?: string;
};

export type ProductCreateResult = {
  id: string;
  hs_sku: string | null;
  name: string;
};

export async function createProduct(
  input: ProductCreateInput,
): Promise<ProductCreateResult> {
  const c = getProductsClient();
  const properties: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
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
    };
  } catch (err) {
    throw new HubspotError("Failed to create HubSpot product", err);
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
