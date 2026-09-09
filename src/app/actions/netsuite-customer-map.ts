"use server";

import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { hubspotDealsCache, netsuiteCustomerMap } from "@/db/schema";
import { requireAdminAction } from "@/lib/admin-guard";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { upsertCustomerMap } from "@/lib/netsuite/customer-map";
import type { NetsuiteCustomerCandidate } from "@/lib/integrations/netsuite-provider";

/**
 * Settings → NetSuite customers.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `netsuite_customer_map` is the lineage that decides which NetSuite customer
 * a Sales Order is raised against AND which governed Terms record a quote
 * prints. It had exactly one writer, `upsertCustomerMap`, and that writer had
 * exactly one caller: `scripts/gate-1b/cert-lineage-build.ts`, a certification
 * script run by a developer.
 *
 * So the only customers ever mapped were the ones a developer had scripted.
 * Every other established customer arrived at finalization unmapped, and no
 * operator or admin had any way to fix it — while three separate places in the
 * codebase told them to: the blocked-Send message, the Sales Order tab, and a
 * schema comment reading "Aisha seeds this once via /admin/netsuite-customer-map".
 * That route did not exist. `/admin/netsuite` maps ITEMS; the customer half was
 * never built.
 *
 * This is that route. The error copy already names it, so the copy is now true
 * rather than aspirational.
 */

export type CustomerMappingRow = {
  hubspotCompanyId: string;
  hubspotCompanyName: string | null;
  netsuiteCustomerId: string | null;
  netsuiteCustomerDisplayName: string | null;
  verifiedAt: Date | null;
  /** Most recent deal seen for this company — orients an admin in a long list. */
  latestDealName: string | null;
};

/**
 * Every company Nexus has seen, mapped or not.
 *
 * Deliberately NOT a list of existing mappings. A list of what IS mapped
 * cannot show the gap, and the gap is the thing an admin is here to close.
 * Unmapped companies sort first for the same reason.
 *
 * DB read only — no NetSuite call on render, per the precedent set by the item
 * mapping pages: a NetSuite outage should take out the push, not this page.
 */
export async function listCustomerMappings(): Promise<
  ActionResult<{ rows: CustomerMappingRow[] }>
> {
  return runAction(async () => {
    await requireAdminAction();

    const companies = await db
      .select({
        hubspotCompanyId: hubspotDealsCache.associatedCompanyId,
        hubspotCompanyName: sql<
          string | null
        >`max(${hubspotDealsCache.associatedCompanyName})`,
        latestDealName: sql<string | null>`max(${hubspotDealsCache.dealName})`,
      })
      .from(hubspotDealsCache)
      .where(isNotNull(hubspotDealsCache.associatedCompanyId))
      .groupBy(hubspotDealsCache.associatedCompanyId);

    const mappings = await db.select().from(netsuiteCustomerMap);
    const byCompany = new Map(mappings.map((m) => [m.hubspotCompanyId, m]));

    const rows: CustomerMappingRow[] = companies
      .filter((c) => (c.hubspotCompanyId ?? "").trim() !== "")
      .map((c) => {
        const id = c.hubspotCompanyId as string;
        const m = byCompany.get(id);
        return {
          hubspotCompanyId: id,
          hubspotCompanyName: c.hubspotCompanyName,
          netsuiteCustomerId: m?.netsuiteCustomerId ?? null,
          netsuiteCustomerDisplayName: m?.netsuiteCustomerDisplayName ?? null,
          verifiedAt: m?.verifiedAt ?? null,
          latestDealName: c.latestDealName,
        };
      });

    // Unmapped first, then by name: the work to be done sits at the top.
    rows.sort((a, b) => {
      const am = a.netsuiteCustomerId ? 1 : 0;
      const bm = b.netsuiteCustomerId ? 1 : 0;
      if (am !== bm) return am - bm;
      return (a.hubspotCompanyName ?? "").localeCompare(
        b.hubspotCompanyName ?? "",
      );
    });

    return { rows };
  });
}

export type CustomerSearchResult =
  | { state: "ok"; candidates: NetsuiteCustomerCandidate[] }
  | { state: "unavailable"; detail: string };

/**
 * Find candidates for an admin to choose between.
 *
 * The outcome preserves the distinction the provider draws: a search that ran
 * and matched nothing is not a search that could not run. An admin told "no
 * matches" during a NetSuite outage would reasonably conclude the customer
 * needs creating, and create a second one.
 *
 * Several matches come back as several matches. Nothing here picks.
 */
export async function searchNetsuiteCustomersForMapping(
  query: string,
): Promise<ActionResult<CustomerSearchResult>> {
  return runAction(async () => {
    await requireAdminAction();
    const { netsuite } = await getApplicationDependencies();
    const outcome = await netsuite.searchCustomers(query);
    return outcome;
  });
}

/**
 * Record a verified mapping.
 *
 * The customer is READ LIVE before the row is written, for two reasons that
 * are really one: it confirms the id an admin picked still resolves, and it
 * captures the identity and governed Terms actually attached to it — so the
 * saved mapping is a verified fact at the moment of verification rather than a
 * transcription of what a search result said a moment earlier.
 *
 * A failed read REFUSES the save. Writing a mapping we could not confirm would
 * stamp `verified_at` on something nobody verified, which is worse than the
 * gap it closes: the gap is visible and a false verification is not.
 */
export async function saveCustomerMapping(input: {
  hubspotCompanyId: string;
  netsuiteCustomerId: string;
}): Promise<
  ActionResult<{ created: boolean; displayName: string | null; terms: string | null }>
> {
  return runAction(async () => {
    const user = await requireAdminAction();

    const hubspotCompanyId = input.hubspotCompanyId.trim();
    const netsuiteCustomerId = input.netsuiteCustomerId.trim();
    if (!hubspotCompanyId) {
      throw new ActionGuardError(ERR.VALIDATION, "Pick a HubSpot company.");
    }
    if (!netsuiteCustomerId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Pick a NetSuite customer. Where a search returns more than one, the choice is yours to make — nothing here picks for you.",
      );
    }

    const { netsuite } = await getApplicationDependencies();

    let record: Awaited<ReturnType<typeof netsuite.readCustomerTerms>>;
    try {
      record = await netsuite.readCustomerTerms(netsuiteCustomerId);
    } catch (e) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `NetSuite could not be reached, so customer ${netsuiteCustomerId} was not confirmed and the mapping was not saved. This is a connection problem, not a missing customer — try again shortly. (${
          e instanceof Error ? e.message : String(e)
        })`,
      );
    }
    if (!record) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        `NetSuite has no customer with internal id ${netsuiteCustomerId}. Nothing was saved.`,
      );
    }

    const displayName =
      record.companyName?.trim() || record.entityId?.trim() || null;
    const terms = record.terms?.refName?.trim() || null;

    const { created } = await upsertCustomerMap({
      hubspotCompanyId,
      netsuiteCustomerId,
      netsuiteCustomerDisplayName: displayName,
      actorUserId: user.id,
    });

    revalidatePath("/admin/netsuite-customer-map");
    return { created, displayName, terms };
  });
}
