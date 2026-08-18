import { requireAdminPage } from "@/lib/admin-guard";
import { listServiceItemMappings } from "@/app/actions/netsuite-service-map";
import { ServiceItemMapTable } from "./service-item-map-table";

/**
 * Settings → NetSuite. The integrations area the mapping disposition asked
 * for; it did not previously exist, so this creates it as a third admin
 * section beside Firm settings and Markup defaults.
 *
 * ── STORED STATE ONLY ON THIS RENDER ──────────────────────────────────────
 *
 * `listServiceItemMappings()` defaults to `live = false`, so this page is a DB
 * read and makes no NetSuite call. The live check is one round trip and is run
 * from the explicit Verify action, per the §B.2 measurement: the query is
 * cheap (p50 183ms batched), but putting a network dependency on a render path
 * means a NetSuite outage takes out the page as well as the push.
 *
 * The table therefore shows LAST KNOWN state, and says so rather than implying
 * it just checked.
 */
export default async function NetsuiteAdminPage() {
  await requireAdminPage();
  const result = await listServiceItemMappings();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">NetSuite</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Integration settings. Direct Service item mappings decide which
        NetSuite record each service becomes on a Sales Order.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-slate-900">
          Direct Service item mappings
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          The four fixed Direct Services need a NetSuite item each. Their
          Nexus SKUs (<code className="font-mono text-xs">SVC-…</code>) are
          internal identifiers and do not exist in NetSuite, so the item cannot
          be found by SKU — it is mapped here once and stored by its NetSuite
          internal ID.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          <strong className="font-medium text-slate-900">Other Service</strong>{" "}
          is deliberately absent. It is the catch-all and carries no single
          accounting meaning, so its NetSuite item is chosen per service line on
          the quote rather than once for the firm.
        </p>

        {result.ok ? (
          <ServiceItemMapTable rows={result.data.rows} />
        ) : (
          <p className="mt-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {result.error.message}
          </p>
        )}
      </section>
    </div>
  );
}
