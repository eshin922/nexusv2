import { requireAdminPage } from "@/lib/admin-guard";
import { loadHubspotProductTypeOptions } from "@/lib/hubspot-product-type-vocabulary";
import { listChargeDefaults } from "@/app/actions/charge-defaults";
import { SUGGESTIBLE_CHARGE_KEYS } from "@/lib/commercial-recovery/charge-defaults";
import { ChargeDefaultsTable, type ChargeDefaultsRowView } from "./charge-defaults-table";

/**
 * Product Type → suggested one-time charges.
 *
 * ── THE VOCABULARY IS READ, NOT LISTED ───────────────────────────────────
 *
 * The rows come from HubSpot's live `hs_product_type` option set joined
 * against what has been reviewed. A hard-coded list here would be a second
 * product vocabulary, which is the one thing this feature is not allowed to
 * become.
 *
 * ── A FAILED VOCABULARY READ IS SAID, NOT SHOWN AS EMPTINESS ─────────────
 *
 * If HubSpot cannot be reached, an empty table would read as "the firm has no
 * product types" -- an authoritative-looking answer produced by a network
 * error. The reviewed profiles are still shown, and the page says the
 * vocabulary is unavailable, so an admin can tell a missing type from a
 * missing connection.
 */
export default async function ChargeDefaultsAdminPage() {
  await requireAdminPage();

  const [vocabulary, reviewed] = await Promise.all([
    loadHubspotProductTypeOptions().then(
      (options) => ({ ok: true as const, options }),
      (e: unknown) => ({
        ok: false as const,
        message: e instanceof Error ? e.message : String(e),
      }),
    ),
    listChargeDefaults(),
  ]);

  if (!reviewed.ok) {
    return (
      <div className="r5-page">
        <div className="r5-page-head">
          <p className="eyebrow">Admin · Charge defaults</p>
          <h1>
            One-time charges by <em>product type</em>
          </h1>
        </div>
        <p className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          Could not read the reviewed charge defaults: {reviewed.error.message}
        </p>
      </div>
    );
  }

  const byValue = new Map(reviewed.data.map((r) => [r.productTypeValue, r]));

  const rows: ChargeDefaultsRowView[] = [];

  if (vocabulary.ok) {
    for (const option of vocabulary.options) {
      const found = byValue.get(option.value);
      rows.push({
        productTypeValue: option.value,
        label: option.label,
        inVocabulary: true,
        resolution: found?.resolution ?? {
          kind: "needs_review",
          productTypeValue: option.value,
        },
      });
      byValue.delete(option.value);
    }
  }

  // Whatever is left has been reviewed but is no longer offered by HubSpot --
  // a retired option, or the vocabulary read failed and every reviewed type
  // lands here. Kept visible either way: a rule nobody can see is a rule
  // nobody can remove.
  for (const leftover of byValue.values()) {
    rows.push({
      productTypeValue: leftover.productTypeValue,
      label: leftover.productTypeValue,
      inVocabulary: false,
      resolution: leftover.resolution,
    });
  }

  return (
    <div className="r5-page">
      <div className="r5-page-head">
        <p className="eyebrow">Admin · Charge defaults</p>
        <h1>
          One-time charges by <em>product type</em>
        </h1>
        <p className="sub">
          Which one-time charges to <em>offer</em> when an operator adds a
          component of each type. Every suggestion is an offer the operator
          confirms or declines — nothing here decides that a charge applies, and
          nothing here changes a charge already on a quote.
        </p>
      </div>

      <div className="r5-md-rule">
        <div className="icon" aria-hidden>
          !
        </div>
        <div>
          <strong>Three answers, not two.</strong> A type with no review is{" "}
          <strong>not</strong> a type with no charges. “Needs review” means
          nobody has looked; “None expected” means somebody looked and decided,
          and carries their name and the date. Editing these changes what the{" "}
          <strong>next</strong> component is offered — charges already on a
          quote are rows an operator authored and are never re-derived.
        </div>
      </div>

      {!vocabulary.ok && (
        <p
          className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="vocabulary-unavailable"
        >
          <strong>The product type vocabulary could not be read.</strong> Only
          types that have already been reviewed are listed below; this is not
          the full set. ({vocabulary.message})
        </p>
      )}

      <ChargeDefaultsTable rows={rows} chargeKeys={[...SUGGESTIBLE_CHARGE_KEYS]} />
    </div>
  );
}
