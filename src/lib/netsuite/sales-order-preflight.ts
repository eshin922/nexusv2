import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  hubspotDealsCache,
  netsuiteSoPushes,
  projects,
} from "@/db/schema";
import { resolveNetsuiteCustomer } from "./customer-map";

// Slice 12 Step 8c-4 — Sales Order preflight loader.
//
// Cheap DB-only reads that the /quote page runs at render time so
// TabSalesOrder can render real values for:
//   - netsuiteCustomer (from netsuite_customer_map — drives the
//     "unmatched" flag with actionable copy)
//   - shipTo line (from HubSpot deal cache — associated_company_name)
//   - latest netsuite_so_pushes row (drives the failed-state variant
//     across page reloads, plus surfaces the persisted error detail)
//
// What's INTENTIONALLY NOT here: SKU resolution. That's ~N SuiteQL
// calls per quote and would add ~N × 200ms to every render of the
// Sales Order tab. Deferred to markComplete's own guard chain (Step 3);
// resolution failures surface via the ActionResult error message +
// failed-tab. If PMs need a pre-flight verify surface, that's a follow-
// up (see UX_BACKLOG).

export type PreflightResult = {
  /** Whether the quote's project has a HubSpot company associated at
   * all. When false, mapping resolution can't run — the tab renders
   * a plain error variant (rare; only if the deal cache row is stale
   * or the deal has no company association). */
  hasHubspotCompany: boolean;
  hubspotCompanyId: string | null;
  hubspotCompanyName: string | null;
  /** Latest customer-map resolution. `null` when hasHubspotCompany is
   * false. `matched=false` = the company has no NetSuite mapping row
   * yet (admin needs to add one). */
  netsuiteCustomer:
    | {
        id: string;
        name: string;
        matched: true;
        matchedOn: "customer_map";
      }
    | {
        id: string; // fallback pseudo-id for display
        name: string;
        matched: false;
        matchedOn: null;
      }
    | null;
  /** Ship-to line. Currently a stub that references the customer
   * name; NetSuite resolves the actual ship-to from the customer
   * record's default shipping address at SO create time. See
   * commentary below for why we don't fetch the NetSuite address
   * directly at page-load time. */
  shipToLine: string;
  /** Latest netsuite_so_pushes row for this quote — drives the
   * failed-state re-render across page reloads. Fields carry back
   * the actionable error copy Vu/admin need to fix the underlying
   * cause. */
  latestPush:
    | {
        status: "pending" | "succeeded" | "failed";
        errorClass: string | null;
        errorDetail: string | null;
        completedAt: Date | null;
      }
    | null;
};

/**
 * Load pre-flight state for the Sales Order tab.
 * Cheap: 2 indexed DB reads. Safe to call on every accepted/complete
 * page render.
 */
export async function loadSalesOrderPreflight(
  quoteId: string,
  projectId: string,
): Promise<PreflightResult> {
  // ── 1. project → hubspot deal → deal cache row ──
  const [proj] = await db
    .select({ hubspotDealId: projects.hubspotDealId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const hubspotDealId = proj?.hubspotDealId ?? null;

  const [dealCache] = hubspotDealId
    ? await db
        .select({
          associatedCompanyId: hubspotDealsCache.associatedCompanyId,
          associatedCompanyName: hubspotDealsCache.associatedCompanyName,
        })
        .from(hubspotDealsCache)
        .where(eq(hubspotDealsCache.dealId, hubspotDealId))
        .limit(1)
    : [];

  const hubspotCompanyId = dealCache?.associatedCompanyId ?? null;
  const hubspotCompanyName = dealCache?.associatedCompanyName ?? null;

  // ── 2. resolve customer (netsuite_customer_map lookup) ──
  let netsuiteCustomer: PreflightResult["netsuiteCustomer"] = null;
  if (hubspotCompanyId) {
    const resolution = await resolveNetsuiteCustomer(hubspotCompanyId);
    if (resolution.status === "found") {
      netsuiteCustomer = {
        id: resolution.netsuiteCustomerId,
        name:
          resolution.netsuiteCustomerDisplayName ??
          resolution.hubspotCompanyName ??
          hubspotCompanyName ??
          "—",
        matched: true,
        matchedOn: "customer_map",
      };
    } else {
      // not_mapped — display id renders as em-dash (the actual id
      // doesn't exist yet). The "NetSuite customer not mapped" flag
      // carries the actionable copy alongside; PMs already read
      // that as the source of truth for the block. HubSpot name
      // preserved for the flag detail (per formatCustomerMissingError).
      netsuiteCustomer = {
        id: "—",
        name: resolution.hubspotCompanyName ?? hubspotCompanyName ?? "—",
        matched: false,
        matchedOn: null,
      };
    }
  }

  // ── 3. ship-to line ──
  // Design (a): NetSuite resolves the customer's default ship-to
  // address from the customer record at SO create time (no ship-to
  // fields on our create payload). We surface a compact reference
  // rather than duplicating NetSuite's address book — matches how
  // Aisha reads live SOs today: "shipped to the address on file for
  // this customer." If a per-quote override lands (v1.1+), the
  // ship-to source flips at that point.
  const shipToLine = netsuiteCustomer?.matched
    ? `${netsuiteCustomer.name} · default address on file in NetSuite`
    : hubspotCompanyName
      ? `${hubspotCompanyName} · address resolves at send`
      : "Ship-to resolves when the customer is mapped";

  // ── 4. latest netsuite_so_pushes row ──
  const [pushRow] = await db
    .select({
      status: netsuiteSoPushes.status,
      errorClass: netsuiteSoPushes.errorClass,
      errorDetail: netsuiteSoPushes.errorDetail,
      completedAt: netsuiteSoPushes.completedAt,
    })
    .from(netsuiteSoPushes)
    .where(eq(netsuiteSoPushes.quoteId, quoteId))
    .orderBy(desc(netsuiteSoPushes.createdAt))
    .limit(1);

  const latestPush = pushRow
    ? {
        status: pushRow.status as "pending" | "succeeded" | "failed",
        errorClass: pushRow.errorClass ?? null,
        errorDetail: pushRow.errorDetail ?? null,
        completedAt: pushRow.completedAt ?? null,
      }
    : null;

  return {
    hasHubspotCompany: hubspotCompanyId !== null,
    hubspotCompanyId,
    hubspotCompanyName,
    netsuiteCustomer,
    shipToLine,
    latestPush,
  };
}

// Silence the `and` import — kept in case future extensions need
// composite filters on netsuite_so_pushes (e.g., filter by tier).
void and;
