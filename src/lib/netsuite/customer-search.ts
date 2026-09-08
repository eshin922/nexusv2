import "server-only";
import { suiteQL } from "@/lib/netsuite/client";
import type {
  CustomerSearchOutcome,
  NetsuiteCustomerCandidate,
} from "@/lib/integrations/netsuite-provider";

/**
 * Search NetSuite customers by company name or entity id.
 *
 * ── WHY THE FAILURE PATH IS EXPLICIT ──────────────────────────────────────
 *
 * The obvious implementation wraps the query in a try/catch and returns an
 * empty array on error, which reads at the call site exactly like a search
 * that found nothing. An admin then sees "no matches", concludes the customer
 * is absent from NetSuite, and creates a duplicate. The outcome is therefore
 * a union: `unavailable` is a different answer from `ok` with no candidates,
 * and the surface says which.
 */
export async function searchNetsuiteCustomers(
  query: string,
): Promise<CustomerSearchOutcome> {
  const q = query.trim();
  if (!q) return { state: "ok", candidates: [] };

  // Escaped for the literal, and bounded: an admin refines a name, and an
  // unbounded scan of the customer table is not a search affordance.
  const safe = q.replace(/[%_\\]/g, "\\$&").replace(/'/g, "''").toUpperCase();
  const sql =
    "select id, entityid, companyname, isinactive from customer " +
    "where upper(companyname) like '%" + safe + "%' " +
    "or upper(entityid) like '%" + safe + "%' " +
    "order by companyname";

  try {
    const r = await suiteQL(sql);
    const candidates: NetsuiteCustomerCandidate[] = (r.items ?? []).map(
      (row: Record<string, unknown>) => ({
        netsuiteCustomerId: String(row.id ?? ""),
        entityId: row.entityid == null ? null : String(row.entityid),
        companyName: row.companyname == null ? null : String(row.companyname),
        inactive: String(row.isinactive ?? "F").toUpperCase() === "T",
      }),
    );
    return { state: "ok", candidates: candidates.slice(0, 25) };
  } catch (e) {
    return {
      state: "unavailable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
