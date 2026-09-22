import { requireAdminPage } from "@/lib/admin-guard";
import { loadHubspotProductTypeOptions } from "@/lib/hubspot-product-type-vocabulary";
import type { HubspotProductTypeOption } from "@/lib/hubspot-product-type-vocabulary";
import { listProductTypeChargeDefaults } from "@/lib/product-type-charge-defaults";
import { ProductTypeChargeDefaultsEditor } from "./product-type-charge-defaults-editor";

export default async function ProductTypeChargeDefaultsPage() {
  await requireAdminPage();
  const rules = await listProductTypeChargeDefaults();
  let options: HubspotProductTypeOption[] = [];
  let vocabularyUnavailable = false;
  try {
    options = await loadHubspotProductTypeOptions({ refresh: true });
  } catch {
    vocabularyUnavailable = true;
  }

  return (
    <main className="ptcd-page">
      <header className="ptcd-header">
        <p className="eyebrow">Admin · Setup defaults</p>
        <h1>Associated cost suggestions by Product Type</h1>
        <p>
          Product Types and their internal values come directly from HubSpot.
          Choose which component and production-associated costs Setup should
          suggest for each HubSpot Product Type.
        </p>
      </header>

      <aside className="ptcd-rule">
        <strong>Suggestions only.</strong> Setup shows these as unchecked
        suggestions. A person chooses which charges apply to a component. Saving
        a rule never adds, removes or changes charges on existing quotes. A type
        without configured suggestions remains marked <em>Needs review</em>.
      </aside>

      {vocabularyUnavailable && (
        <p className="ptcd-empty" role="alert">
          HubSpot&apos;s Product Type list could not be loaded. The saved rules
          are safe; refresh this page when HubSpot is available to edit them.
        </p>
      )}

      <ProductTypeChargeDefaultsEditor options={options} rules={rules} />
    </main>
  );
}
