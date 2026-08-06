import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { netsuiteCustomerMap, hubspotDealsCache, auditLog } from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";

// Slice 12 Step 8c-3 — HubSpot company → NetSuite customer resolver
// (CA disposition 2026-07-28, option B'). Deterministic key from a
// Nexus-owned mapping table, seeded once by Aisha.
//
// Contract:
//   resolveNetsuiteCustomer(hubspotCompanyId) → { status: "found", ... }
//                                              | { status: "not_mapped", ... }
//   Cache miss BLOCKS markComplete with a specific message naming the
//   HubSpot company + admin URL (CA discipline: "The PM should be able
//   to forward that message and have someone act on it without a
//   follow-up question.").
//
// The netsuite_customer_display_name column is ADVISORY ONLY (human-
// legibility). Never used as a match key. Same rule as Item Group
// description (Pattern 30 immutability).
//
// No delete — mappings are historically anchored. Edits go through
// `updateCustomerMap` which emits netsuite_customer_map_changed audit.

export type CustomerResolution =
  | {
      status: "found";
      hubspotCompanyId: string;
      hubspotCompanyName: string | null;
      netsuiteCustomerId: string;
      netsuiteCustomerDisplayName: string | null;
    }
  | {
      status: "not_mapped";
      hubspotCompanyId: string;
      hubspotCompanyName: string | null;
    };

/**
 * Resolve a HubSpot company id to its NetSuite customer internal id.
 * Cache-only; no NetSuite API calls. Blocks on miss (caller translates
 * to blocking-tab error).
 *
 * The `hubspotCompanyName` returned is the CURRENT name from
 * hubspot_deals_cache (denormed at deal-sync time), not the frozen
 * display name on the map row. Used for the block-on-miss error copy.
 */
export async function resolveNetsuiteCustomer(
  hubspotCompanyId: string,
): Promise<CustomerResolution> {
  const trimmed = hubspotCompanyId.trim();
  if (!trimmed) {
    throw new Error("[customer-map] hubspotCompanyId is required");
  }

  // Grab the current HubSpot company name (denormed) alongside the
  // map lookup for the caller's error message.
  const [companyName] = await db
    .select({ name: hubspotDealsCache.associatedCompanyName })
    .from(hubspotDealsCache)
    .where(eq(hubspotDealsCache.associatedCompanyId, trimmed))
    .limit(1);

  const [mapping] = await db
    .select()
    .from(netsuiteCustomerMap)
    .where(eq(netsuiteCustomerMap.hubspotCompanyId, trimmed))
    .limit(1);

  if (!mapping) {
    return {
      status: "not_mapped",
      hubspotCompanyId: trimmed,
      hubspotCompanyName: companyName?.name ?? null,
    };
  }

  return {
    status: "found",
    hubspotCompanyId: trimmed,
    hubspotCompanyName: companyName?.name ?? null,
    netsuiteCustomerId: mapping.netsuiteCustomerId,
    netsuiteCustomerDisplayName: mapping.netsuiteCustomerDisplayName,
  };
}

/**
 * Format the block-on-miss error message. Per CA: "The PM should be
 * able to forward that message and have someone act on it without a
 * follow-up question." Names the HubSpot company + admin URL.
 */
export function formatCustomerMissingError(
  resolution: Extract<CustomerResolution, { status: "not_mapped" }>,
): string {
  const displayName = resolution.hubspotCompanyName
    ? `${resolution.hubspotCompanyName} (HubSpot company ${resolution.hubspotCompanyId})`
    : `HubSpot company ${resolution.hubspotCompanyId}`;
  return `${displayName} has no NetSuite customer mapping. An admin can add one at /admin/netsuite-customer-map.`;
}

// ---------- admin write path ----------

/**
 * Create or update a mapping. Add is PUT-style (specified
 * hubspot_company_id may already exist; if it does, this is treated
 * as an edit and audited before/after).
 *
 * No delete — historically anchored.
 */
export async function upsertCustomerMap(input: {
  hubspotCompanyId: string;
  netsuiteCustomerId: string;
  netsuiteCustomerDisplayName: string | null;
  actorUserId: string;
}): Promise<{ created: boolean }> {
  const hubspotCompanyId = input.hubspotCompanyId.trim();
  const netsuiteCustomerId = input.netsuiteCustomerId.trim();
  const displayName = input.netsuiteCustomerDisplayName?.trim() || null;

  if (!hubspotCompanyId)
    throw new Error("[customer-map] hubspotCompanyId is required");
  if (!netsuiteCustomerId)
    throw new Error("[customer-map] netsuiteCustomerId is required");

  const now = new Date();
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(netsuiteCustomerMap)
      .where(eq(netsuiteCustomerMap.hubspotCompanyId, hubspotCompanyId))
      .limit(1);

    if (!existing) {
      await tx.insert(netsuiteCustomerMap).values({
        hubspotCompanyId,
        netsuiteCustomerId,
        netsuiteCustomerDisplayName: displayName,
        verifiedAt: now,
        verifiedByUserId: input.actorUserId,
      });
      await writeAuditEntry({
        userId: input.actorUserId,
        entityType: "netsuite_customer_map",
        entityId: hubspotCompanyId,
        action: "netsuite_customer_map_created",
        diffJson: {
          hubspot_company_id: hubspotCompanyId,
          netsuite_customer_id: netsuiteCustomerId,
          netsuite_customer_display_name: displayName,
        },
      }, tx);
      return { created: true };
    }

    // Edit. Per CA: significant act; audit before/after. No-op if
    // nothing changed (still writes an audit row so the intent is
    // traceable).
    await tx
      .update(netsuiteCustomerMap)
      .set({
        netsuiteCustomerId,
        netsuiteCustomerDisplayName: displayName,
        verifiedAt: now,
        verifiedByUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(eq(netsuiteCustomerMap.hubspotCompanyId, hubspotCompanyId));

    await writeAuditEntry({
      userId: input.actorUserId,
      entityType: "netsuite_customer_map",
      entityId: hubspotCompanyId,
      action: "netsuite_customer_map_changed",
      diffJson: {
        hubspot_company_id: hubspotCompanyId,
        netsuite_customer_id: {
          from: existing.netsuiteCustomerId,
          to: netsuiteCustomerId,
        },
        netsuite_customer_display_name: {
          from: existing.netsuiteCustomerDisplayName,
          to: displayName,
        },
      },
    }, tx);
    return { created: false };
  });
}
