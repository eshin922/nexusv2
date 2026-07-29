import "server-only";
import { eq, isNull } from "drizzle-orm";
import { getReadClient } from "@/lib/hubspot";
import { db } from "@/db";
import { hubspotDealsCache } from "@/db/schema";

// Slice 12 Step 8c-3 — HubSpot business_segment enum-label resolver.
//
// Per CA Q6 (2026-07-28) + one addition: fetch enum options at push
// time, cache in-process, write label back to businessSegmentLabel
// column as side effect. Deterministic and self-healing.
//
// CA addition: if the fetch fails OR the enum id has no label,
// BLOCK the push. Don't send the raw id and hope NetSuite matches
// it (that's option C and a wrong class on a real SO is an accounting
// error nobody sees until close).
//
// 8c-2 shipped business_segment_id populated but business_segment_label
// null. This resolver populates the label lazily at markComplete time.

interface EnumOption {
  label: string;
  value: string;
  hidden?: boolean;
}

// Process-lifetime cache. Enum options are stable (admin-changed
// occasionally); refreshing per push would be network wasteful.
// Nexus's overall process lifetime aligns with what a Vercel function
// instance holds — sync-triggered invalidation not needed.
let cachedOptions: Map<string, string> | null = null;

async function fetchOptionMap(): Promise<Map<string, string>> {
  if (cachedOptions) return cachedOptions;
  const c = getReadClient();
  const schema = await c.crm.properties.coreApi.getAll("deals");
  const businessSegment = (schema.results ?? []).find(
    (p) => p.name === "business_segment",
  );
  if (!businessSegment) {
    throw new Error(
      "[business-segment-resolver] HubSpot property 'business_segment' not found in deals schema",
    );
  }
  const options = (businessSegment.options ?? []) as EnumOption[];
  const map = new Map<string, string>();
  for (const o of options) {
    if (!o.hidden) map.set(o.value, o.label);
  }
  cachedOptions = map;
  return map;
}

/** Reset cache — testing hook. */
export function _resetBusinessSegmentCache(): void {
  cachedOptions = null;
}

/**
 * Resolve a business_segment enum id to its label. Throws if the
 * enum options fetch fails OR if the id has no matching option —
 * per CA, block push rather than sending a raw id NetSuite can't
 * resolve.
 *
 * Side effect: if `hubspotCompanyIdForBackfill` is provided AND the
 * label was resolved successfully, updates hubspot_deals_cache.
 * business_segment_label for every deal row associated with the
 * company (self-healing backfill). Ignore-errors on the backfill —
 * the primary contract is returning the label; persistence is best-
 * effort.
 */
export async function resolveBusinessSegmentLabel(
  segmentId: string,
  opts?: { dealIdForBackfill?: string },
): Promise<string> {
  const trimmed = segmentId.trim();
  if (!trimmed) {
    throw new Error("[business-segment-resolver] segmentId is required");
  }
  const map = await fetchOptionMap();
  const label = map.get(trimmed);
  if (!label) {
    throw new Error(
      `[business-segment-resolver] business_segment enum id '${trimmed}' has no matching label option (fetched ${map.size} options)`,
    );
  }

  // Best-effort backfill onto the cache row so future renders
  // (admin surfaces + potential 8c-4 receipt) see the label without
  // re-invoking this resolver.
  if (opts?.dealIdForBackfill) {
    try {
      await db
        .update(hubspotDealsCache)
        .set({ businessSegmentLabel: label })
        .where(eq(hubspotDealsCache.dealId, opts.dealIdForBackfill));
    } catch (e) {
      // Non-fatal: log + continue with the label return.
      console.warn(
        `[business-segment-resolver] backfill failed for deal ${opts.dealIdForBackfill}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  return label;
}

/**
 * Batch backfill: resolve labels for every cache row where
 * business_segment_id IS NOT NULL AND business_segment_label IS NULL.
 * Optional operational helper — post-Q6 admin can trigger via a
 * script if wanted. Not called from markComplete.
 */
export async function backfillAllBusinessSegmentLabels(): Promise<{
  processed: number;
  updated: number;
  errors: number;
}> {
  const rows = await db
    .select({
      dealId: hubspotDealsCache.dealId,
      businessSegmentId: hubspotDealsCache.businessSegmentId,
    })
    .from(hubspotDealsCache)
    .where(isNull(hubspotDealsCache.businessSegmentLabel));

  const eligible = rows.filter((r) => r.businessSegmentId !== null);
  let updated = 0;
  let errors = 0;
  for (const r of eligible) {
    try {
      const label = await resolveBusinessSegmentLabel(r.businessSegmentId!);
      await db
        .update(hubspotDealsCache)
        .set({ businessSegmentLabel: label })
        .where(eq(hubspotDealsCache.dealId, r.dealId));
      updated++;
    } catch {
      errors++;
    }
  }
  return { processed: eligible.length, updated, errors };
}
