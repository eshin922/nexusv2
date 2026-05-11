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

const PRODUCT_PROPERTIES = [
  "name",
  "hs_sku",
  "hs_product_type",
  "hs_product_classification",
  "description",
  "price",
  "hs_cost_of_goods_sold",
] as const;

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
  const c = getReadClient();
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
  const c = getReadClient();
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
