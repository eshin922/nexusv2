import { requireAdminPage } from "@/lib/admin-guard";
import { listCustomerSkuCodes } from "@/app/actions/sku-registry";
import { SkuCodesTable } from "./sku-codes-table";

/**
 * Settings → SKU codes.
 *
 * Which mnemonic belongs to which customer. A quote reads this to know the
 * namespace a generated SKU is filed under, so it is the one place the answer
 * is maintained rather than inferred.
 *
 * DB read only. The live HubSpot call happens when an admin searches for a
 * customer and not before — a HubSpot outage should take out the search, not
 * the page you come to in order to read the codes.
 */
export default async function SkuCodesPage() {
  await requireAdminPage();
  const result = await listCustomerSkuCodes();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">SKU codes</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        The mnemonic each customer&apos;s SKUs are numbered under —{" "}
        <span className="font-mono">DPS-MISTR-1001</span> and its successors
        belong to one customer, for good. Inside a quote, the customer&apos;s
        code is used automatically; nothing is ever chosen for them.
      </p>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Saving a code does not make it usable. Where a code starts counting
        depends on which identifiers already exist in Nexus, HubSpot and
        NetSuite, so a new code is <strong>awaiting setup</strong> until that
        check has been run and its starting number established. Until then the
        customer&apos;s SKUs are entered by hand.
      </p>

      <section className="mt-8">
        {result.ok ? (
          <SkuCodesTable rows={result.data} />
        ) : (
          <p className="text-sm text-amber-900">{result.error.message}</p>
        )}
      </section>
    </div>
  );
}
