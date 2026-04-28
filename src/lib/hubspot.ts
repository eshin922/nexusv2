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

export type DealSummary = {
  id: string;
  name: string;
  clientName: string | null;
  ownerName: string | null;
  stageId: string;
  stageLabel: string;
  lastModified: string | null; // ISO
};

export type DealSearchResult = {
  results: DealSummary[];
  nextCursor: string | null;
  total: number;
};

export class HubspotError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "HubspotError";
    this.cause = cause;
  }
}

// Two-token model (see docs/claude.md):
//   - Read operations  → HUBSPOT_ACCESS_TOKEN        (production, read-only scopes)
//   - Write operations → HUBSPOT_WRITE_ACCESS_TOKEN  (added in Slice 12 only)
// Splitting the clients makes accidental writes during development structurally
// impossible — read paths must NEVER call getWriteClient.
let _readClient: Client | null = null;
let _writeClient: Client | null = null;

function getReadClient(): Client {
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

export async function searchDeals(args: {
  query?: string;
  after?: string;
  pageSize?: number;
}): Promise<DealSearchResult> {
  const c = getReadClient();
  const pageSize = args.pageSize ?? 50;

  let searchResp;
  try {
    searchResp = await c.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "dealstage",
              // SDK enum is finicky across versions — IN is the wire string
              operator: "IN" as never,
              values: [...ACTIVE_STAGE_IDS],
            },
          ],
        },
      ],
      query: args.query?.trim() || undefined,
      sorts: ["-hs_lastmodifieddate"],
      properties: [
        "dealname",
        "dealstage",
        "hubspot_owner_id",
        "hs_lastmodifieddate",
      ],
      limit: pageSize,
      after: args.after ?? "0",
    });
  } catch (err) {
    throw new HubspotError("Failed to search HubSpot deals", err);
  }

  const deals = searchResp.results ?? [];
  if (deals.length === 0) {
    return { results: [], nextCursor: null, total: searchResp.total ?? 0 };
  }

  const dealIds = deals.map((d) => d.id);
  const ownerIds = Array.from(
    new Set(
      deals
        .map((d) => d.properties?.hubspot_owner_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );

  // Run association lookup and owner list in parallel.
  const [companyIdByDealId, ownerNameById] = await Promise.all([
    fetchCompanyIdsForDeals(c, dealIds),
    fetchOwnerNames(c, ownerIds),
  ]);

  const companyIds = Array.from(new Set(companyIdByDealId.values()));
  const companyNameById = await fetchCompanyNames(c, companyIds);

  const results: DealSummary[] = deals.map((d) => {
    const props = d.properties ?? {};
    const stageId = props.dealstage ?? "";
    const ownerId = props.hubspot_owner_id;
    const companyId = companyIdByDealId.get(d.id);
    return {
      id: d.id,
      name: props.dealname || "(unnamed)",
      clientName: companyId ? companyNameById.get(companyId) ?? null : null,
      ownerName: ownerId ? ownerNameById.get(ownerId) ?? null : null,
      stageId,
      stageLabel: STAGE_LABEL_BY_ID[stageId] ?? stageId,
      lastModified: props.hs_lastmodifieddate ?? null,
    };
  });

  const nextCursor = searchResp.paging?.next?.after ?? null;
  return { results, nextCursor, total: searchResp.total ?? results.length };
}

async function fetchCompanyIdsForDeals(
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
      // Wire shape uses "_from"; SDK preserves it. Cast to access.
      const fromId = (r as unknown as { _from?: { id?: string } })._from?.id;
      const toId = r.to?.[0]?.toObjectId;
      if (fromId && toId !== undefined) map.set(fromId, String(toId));
    }
  } catch {
    // Non-fatal: deals without associations just show no client name
  }
  return map;
}

async function fetchCompanyNames(
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

async function fetchOwnerNames(
  c: Client,
  ownerIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ownerIds.length === 0) return map;
  try {
    // Owners API has no batch-by-id endpoint. List the org's owners (small set
    // for DPS — single page) and look up by id.
    const resp = await c.crm.owners.ownersApi.getPage(undefined, undefined, 100);
    for (const o of resp.results ?? []) {
      const id = String(o.id);
      const name =
        [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || id;
      map.set(id, name);
    }
  } catch {
    // Non-fatal
  }
  return map;
}
