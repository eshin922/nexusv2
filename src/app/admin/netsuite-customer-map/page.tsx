import { requireAdminPage } from "@/lib/admin-guard";
import { listCustomerMappings } from "@/app/actions/netsuite-customer-map";
import { CustomerMapTable } from "./customer-map-table";

/**
 * Settings → NetSuite customers.
 *
 * The route three separate places in the codebase already told operators to
 * visit — the blocked-Send message, the Sales Order tab, and a schema comment
 * — and which did not exist. `/admin/netsuite` maps ITEMS; this is the
 * customer half.
 *
 * DB read only. The live NetSuite calls happen when an admin searches and
 * again when they save, per the precedent on the item pages: a NetSuite outage
 * should take out the push, not the page you go to in order to fix things.
 */
export default async function NetsuiteCustomerMapPage() {
  await requireAdminPage();
  const result = await listCustomerMappings();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">
        NetSuite customers
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Which NetSuite customer each HubSpot company is. This lineage decides
        who a Sales Order is raised against, and which governed payment terms a
        quote prints — so a quote for an unmapped customer cannot be sent.
      </p>

      <section className="mt-8">
        {result.ok ? (
          <CustomerMapTable rows={result.data.rows} />
        ) : (
          <p className="text-sm text-amber-900">{result.error.message}</p>
        )}
      </section>
    </div>
  );
}
