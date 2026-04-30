import "server-only";
import { Client } from "@hubspot/api-client";
import { count, desc, ilike, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import { hubspotDealsCache } from "@/db/schema";
import {
  ACTIVE_STAGE_IDS,
  fetchCompanyIdsForDeals,
  fetchCompanyNames,
  fetchOwnerDetails,
  getReadClient,
  HubspotError,
  type OwnerDetail,
} from "./hubspot";

// How long a sync result is considered fresh enough to render directly
// without triggering a refresh. Tuneable; affects /import and any other
// cache-fronted view.
export const CACHE_STALENESS_MINUTES = 15;

// PM custom-property name on HubSpot deals. TBD — set HUBSPOT_PM_PROPERTY
// once the property is identified (run dumpDealProperties to discover).
const PM_PROPERTY = process.env.HUBSPOT_PM_PROPERTY ?? null;

// Properties pulled from HubSpot for the cache row.
const DEAL_PROPERTIES_BASE = [
  "dealname",
  "dealstage",
  "amount",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "hubspot_owner_id",
] as const;

const DEAL_PROPERTIES: string[] = PM_PROPERTY
  ? [...DEAL_PROPERTIES_BASE, PM_PROPERTY]
  : [...DEAL_PROPERTIES_BASE];

const SYNC_PAGE_SIZE = 100;

export type DealCacheRow = typeof hubspotDealsCache.$inferSelect;
type NewDealCacheRow = typeof hubspotDealsCache.$inferInsert;

// ---------- read helpers ----------

export async function getCacheStatus(): Promise<{
  count: number;
  lastSyncedAt: Date | null;
}> {
  const [row] = await db
    .select({
      count: count(),
      lastSyncedAt: max(hubspotDealsCache.lastSyncedAt),
    })
    .from(hubspotDealsCache);
  return {
    count: row?.count ?? 0,
    lastSyncedAt: row?.lastSyncedAt ?? null,
  };
}

export function isStale(lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) return true;
  return Date.now() - lastSyncedAt.getTime() > CACHE_STALENESS_MINUTES * 60_000;
}

export async function readCacheForQuery(args: {
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<DealCacheRow[]> {
  const { query, limit = 50, offset = 0 } = args;
  const trimmed = query?.trim();
  const where = trimmed
    ? ilike(hubspotDealsCache.dealName, `%${trimmed}%`)
    : undefined;
  return db
    .select()
    .from(hubspotDealsCache)
    .where(where)
    .orderBy(desc(hubspotDealsCache.updatedAtHubspot))
    .limit(limit)
    .offset(offset);
}

export async function readCacheCount(args: { query?: string }): Promise<number> {
  const { query } = args;
  const trimmed = query?.trim();
  const where = trimmed
    ? ilike(hubspotDealsCache.dealName, `%${trimmed}%`)
    : undefined;
  const [row] = await db
    .select({ count: count() })
    .from(hubspotDealsCache)
    .where(where);
  return row?.count ?? 0;
}

// ---------- write/sync ----------

type DealLike = {
  id: string;
  properties?: Record<string, string | null | undefined>;
};

function toCacheRow(args: {
  deal: DealLike;
  companyIdByDealId: Map<string, string>;
  companyNameById: Map<string, string>;
  ownerDetailsById: Map<string, OwnerDetail>;
}): NewDealCacheRow {
  const { deal, companyIdByDealId, companyNameById, ownerDetailsById } = args;
  const props = deal.properties ?? {};

  const ownerId = props.hubspot_owner_id || null;
  const owner = ownerId ? ownerDetailsById.get(ownerId) ?? null : null;

  const pmId = PM_PROPERTY ? props[PM_PROPERTY] || null : null;
  const pm = pmId ? ownerDetailsById.get(pmId) ?? null : null;

  const companyId = companyIdByDealId.get(deal.id) ?? null;
  const companyName = companyId ? companyNameById.get(companyId) ?? null : null;

  return {
    dealId: deal.id,
    dealName: props.dealname || "(unnamed)",
    dealStage: props.dealstage || null,
    amount: props.amount || null,
    closeDate: props.closedate ? props.closedate.slice(0, 10) : null,
    salesRepId: ownerId,
    salesRepName: owner?.name ?? null,
    salesRepEmail: owner?.email ?? null,
    pmId,
    pmName: pm?.name ?? null,
    pmEmail: pm?.email ?? null,
    associatedCompanyId: companyId,
    associatedCompanyName: companyName,
    createdAtHubspot: props.createdate ? new Date(props.createdate) : null,
    updatedAtHubspot: props.hs_lastmodifieddate
      ? new Date(props.hs_lastmodifieddate)
      : null,
    lastSyncedAt: new Date(),
  };
}

async function fetchActivePage(args: {
  c: Client;
  after: string;
  ownerDetailsById: Map<string, OwnerDetail>;
}): Promise<{ rows: NewDealCacheRow[]; nextCursor: string | null }> {
  const { c, after, ownerDetailsById } = args;

  let resp;
  try {
    resp = await c.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "dealstage",
              operator: "IN" as never,
              values: [...ACTIVE_STAGE_IDS],
            },
          ],
        },
      ],
      sorts: ["-hs_lastmodifieddate"],
      properties: DEAL_PROPERTIES,
      limit: SYNC_PAGE_SIZE,
      after,
    });
  } catch (err) {
    throw new HubspotError("Failed to search HubSpot deals during sync", err);
  }

  const deals = resp.results ?? [];
  if (deals.length === 0) {
    return { rows: [], nextCursor: null };
  }

  const dealIds = deals.map((d) => d.id);
  const companyIdByDealId = await fetchCompanyIdsForDeals(c, dealIds);
  const companyIds = Array.from(new Set(companyIdByDealId.values()));
  const companyNameById = await fetchCompanyNames(c, companyIds);

  const rows = deals.map((d) =>
    toCacheRow({
      deal: d,
      companyIdByDealId,
      companyNameById,
      ownerDetailsById,
    }),
  );

  const nextCursor = resp.paging?.next?.after ?? null;
  return { rows, nextCursor };
}

// Full active-pipeline sync. Delete-then-insert in a short transaction;
// HubSpot fetch happens outside the tx so locks aren't held during the
// network walk. Closed deals (cached via syncDealById) are not touched
// because the DELETE filter is dealStage IN (active stages).
export async function syncDeals(): Promise<{
  synced: number;
  durationMs: number;
}> {
  const t0 = performance.now();
  const c = getReadClient();

  const ownerDetailsById = await fetchOwnerDetails(c);

  const allRows: NewDealCacheRow[] = [];
  let cursor: string | null = "0";
  while (cursor !== null) {
    const { rows, nextCursor }: { rows: NewDealCacheRow[]; nextCursor: string | null } =
      await fetchActivePage({ c, after: cursor, ownerDetailsById });
    allRows.push(...rows);
    cursor = nextCursor;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(hubspotDealsCache)
      .where(inArray(hubspotDealsCache.dealStage, [...ACTIVE_STAGE_IDS]));
    if (allRows.length > 0) {
      await tx.insert(hubspotDealsCache).values(allRows);
    }
  });

  const durationMs = Math.round(performance.now() - t0);
  console.log(
    `[hubspot-cache] syncDeals: ${allRows.length} active deals in ${durationMs}ms`,
  );
  return { synced: allRows.length, durationMs };
}

// Single-deal upsert. Used by importDeal (closed deals can come through
// here) and refreshFromHubspot (single project's deal). Doesn't touch
// other cache rows.
export async function syncDealById(dealId: string): Promise<DealCacheRow | null> {
  const c = getReadClient();

  let deal;
  try {
    deal = await c.crm.deals.basicApi.getById(dealId, DEAL_PROPERTIES);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 404) return null;
    throw new HubspotError(`Failed to fetch deal ${dealId}`, err);
  }

  const ownerDetailsById = await fetchOwnerDetails(c);
  const companyIdByDealId = await fetchCompanyIdsForDeals(c, [dealId]);
  const companyIds = Array.from(new Set(companyIdByDealId.values()));
  const companyNameById = await fetchCompanyNames(c, companyIds);

  const row = toCacheRow({
    deal,
    companyIdByDealId,
    companyNameById,
    ownerDetailsById,
  });

  const [returned] = await db
    .insert(hubspotDealsCache)
    .values(row)
    .onConflictDoUpdate({
      target: hubspotDealsCache.dealId,
      set: {
        dealName: row.dealName,
        dealStage: row.dealStage,
        amount: row.amount,
        closeDate: row.closeDate,
        salesRepId: row.salesRepId,
        salesRepName: row.salesRepName,
        salesRepEmail: row.salesRepEmail,
        pmId: row.pmId,
        pmName: row.pmName,
        pmEmail: row.pmEmail,
        associatedCompanyId: row.associatedCompanyId,
        associatedCompanyName: row.associatedCompanyName,
        createdAtHubspot: row.createdAtHubspot,
        updatedAtHubspot: row.updatedAtHubspot,
        lastSyncedAt: row.lastSyncedAt,
      },
    })
    .returning();

  return returned ?? null;
}

export type DumpedDealProperty = {
  name: string;
  label: string | null;
  type: string | null;
  fieldType: string | null;
  description: string | null;
};

// Dev helper: list HubSpot deal properties whose name or label hints at
// project-management roles, so we can identify the PM custom property
// and set HUBSPOT_PM_PROPERTY. Filters to pm/manager/lead/coordinator/
// director (intentionally excludes "owner" — every deal has owner-related
// properties and the noise crowds out the actual signal).
export async function dumpDealProperties(): Promise<{
  total: number;
  candidates: DumpedDealProperty[];
}> {
  const c = getReadClient();
  try {
    const resp = await c.crm.properties.coreApi.getAll("deals");
    const all = resp.results ?? [];
    const candidates: DumpedDealProperty[] = all
      .filter((p) => {
        const haystack = `${p.name} ${p.label ?? ""}`.toLowerCase();
        return /\b(pm|manager|lead|coordinator|director)\b/.test(haystack);
      })
      .map((p) => ({
        name: p.name,
        label: p.label ?? null,
        type: p.type ?? null,
        fieldType: p.fieldType ?? null,
        description: p.description ?? null,
      }));
    console.log(
      `[hubspot-cache] dumpDealProperties: ${candidates.length} candidates (of ${all.length} total deal properties)`,
    );
    for (const p of candidates) {
      console.log(
        `  • name="${p.name}" label="${p.label}" type=${p.type} fieldType=${p.fieldType}`,
      );
    }
    return { total: all.length, candidates };
  } catch (err) {
    console.error("[hubspot-cache] dumpDealProperties failed:", err);
    return { total: 0, candidates: [] };
  }
}
