import "server-only";
import { getProductsClient } from "@/lib/hubspot";

/**
 * The governed `hs_product_type` option set, read from HubSpot's property
 * definition.
 *
 * WHY THIS IS FETCHED RATHER THAN LISTED. A hard-coded copy would be a second
 * vocabulary that drifts the moment someone adds an option in HubSpot, and the
 * drift is silent: a product classified under the new option would simply stop
 * matching anything. The property definition is the authority, so it is read.
 *
 * WHY LABEL AND VALUE ARE BOTH CARRIED, AND NEVER CONFLATED. Three options
 * diverge, and they are the three largest categories:
 *
 *     label "Primary Packaging"   → value `Primary`
 *     label "Secondary Packaging" → value `Secondary`
 *     label "Logistics"           → value `Third Party Logistics`
 *
 * The operator reads the LABEL; HubSpot stores and matches the VALUE. Anything
 * that sends a label, or filters on one, misses roughly half the catalogue and
 * fails silently — there is no error, just an empty result that looks like an
 * empty catalogue.
 *
 * WHY THE PRODUCTS CLIENT AND NOT THE READ CLIENT. The Products domain is
 * dev/prod-aware: in dev it talks to the sandbox portal, in production to the
 * live one. Those portals' option sets are NOT the same — `Finished Goods` and
 * `Turnkey` exist only in production, `Corrugated` and `Preliminary` only in
 * the sandbox, and `Logistics` -> `Third Party Logistics` diverges in
 * production but not in the sandbox. The vocabulary must therefore come from
 * the same client that reads and writes the products, or a create would be
 * validated against options the receiving portal does not have and the Library
 * would offer chips matching nothing.
 */

export const HS_PRODUCT_TYPE_PROPERTY = "hs_product_type";

export type HubspotProductTypeOption = {
  /** Shown to the operator. */
  label: string;
  /** Sent to HubSpot, stored in `leaves.hubspot_product_type`, filtered on. */
  value: string;
  displayOrder: number;
};

/**
 * Cached for the process lifetime. The option set is HubSpot-side configuration
 * that changes rarely, and re-fetching it per modal open would add a network
 * round trip to an interaction that is otherwise local. A deploy clears it.
 */
let cached: HubspotProductTypeOption[] | null = null;

export async function loadHubspotProductTypeOptions(): Promise<
  HubspotProductTypeOption[]
> {
  if (cached) return cached;
  const client = getProductsClient();
  const prop = await client.crm.properties.coreApi.getByName(
    "products",
    HS_PRODUCT_TYPE_PROPERTY,
  );
  const options = (prop.options ?? [])
    // `hidden` options exist in the definition but are withdrawn from use;
    // offering one would let an operator classify a product under a value the
    // firm has retired.
    .filter((o) => !o.hidden)
    .map((o) => ({
      label: o.label,
      value: o.value,
      displayOrder: o.displayOrder ?? 0,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  cached = options;
  return options;
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function _resetHubspotProductTypeCache(): void {
  cached = null;
}

/**
 * Is this string a legal internal option value?
 *
 * Guards the create path so a label can never reach HubSpot in the value's
 * place: "Primary Packaging" is not a member of the value set, so it is
 * rejected rather than written and later found to match nothing.
 */
export function isKnownHubspotProductTypeValue(
  value: string,
  options: readonly HubspotProductTypeOption[],
): boolean {
  return options.some((o) => o.value === value);
}
