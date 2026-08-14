import "server-only";
import type { HubspotProductRaw } from "./hubspot";
import {
  normalizeHubSpotProductCreateInput,
  type HubSpotProductCreateInput,
} from "./integrations/hubspot-provider";

// slice-hubspot-bidirectional — field-mapping translator between
// HubSpot Product shape and Nexus `leaves` shape. Pure functions:
// no DB access, no side effects, deterministic in/out.
//
// Source-of-truth mapping table (locked in
// `docs/cc-comm-hubspot-bidirectional-review.md` §3):
//
// | HubSpot field           | Nexus column      | Direction | Notes |
// |-------------------------|-------------------|-----------|-------|
// | name                    | name              | both      | direct |
// | hs_sku                  | sku               | both      | direct |
// | hs_cost_of_goods_sold   | unit_cost         | both      | numeric stored as text |
// | hs_url                  | url               | both      | direct |
// | hs_images               | image_url         | pull only | first URL only |
// | hs_product_type         | hubspot_product_type | pull   | RAW INTERNAL VALUE. Distinct from product_type_id — see below |
// | description             | (no column)       | (skip)    | Catch #12 — no nexus column; revisit v1.1+ |
// | price                   | (no column)       | push only | explicit value or technical 0.00 default; never quote price |
// | hubspot_owner_id        | owner_id          | pull cond | mapped via users.hubspot_owner_id lookup |
// | fsc_claim_type          | fsc_claim         | pull cond | text-to-bool coercion |
// | fsc_status              | fsc_status        | pull      | direct text |
// | fsc_supplier_verified   | supplier_verified | pull cond | text-to-bool coercion |
// | (raw.archived)          | archived          | pull      | from HubSpot top-level archive flag |
//
// Push direction (Nexus → HubSpot) is the strict subset:
//   name + hs_sku + hs_cost_of_goods_sold + hs_url + catalog price
// matching what AddProductModal LEAF mode collects from the PM.

export type MappedLeafFromHubspot = {
  hubspotProductId: string;
  name: string;
  sku: string | null;
  unitCost: string | null;
  url: string | null;
  imageUrl: string | null;
  fscClaim: boolean | null;
  fscStatus: string | null;
  supplierVerified: boolean | null;
  ownerId: string | null;
  archived: boolean;
  /**
   * HubSpot's `hs_product_type`, as the RAW INTERNAL OPTION VALUE.
   *
   * Lands in `leaves.hubspot_product_type`, NOT `product_type_id`. Those are
   * different vocabularies — Nexus's taxonomy has an assembly scope HubSpot
   * lacks, HubSpot has commercial categories no Nexus leaf type covers — and
   * conflating them would lose information in whichever direction the mapping
   * ran. The Nexus taxonomy stays operator-authored via the TypePicker.
   *
   * NEVER derived from a display label. Three options diverge, and they are the
   * three largest categories: `Primary` is labelled "Primary Packaging",
   * `Secondary` is "Secondary Packaging", `Third Party Logistics` is
   * "Logistics". Matching labels would miss roughly half the catalogue and fail
   * silently.
   */
  hubspotProductType: string | null;
};

// Pull-direction translator. `userIdByHubspotOwnerId` is a
// pre-fetched lookup map from `users.hubspot_owner_id → users.id`;
// pass null/undefined to skip owner mapping (always sets
// ownerId = null in that case).
export function mapHubspotToLeaf(
  raw: HubspotProductRaw,
  opts?: { userIdByHubspotOwnerId?: Map<string, string> },
): MappedLeafFromHubspot {
  const p = raw.properties;

  // Image: hs_images is a comma-separated URL string in HubSpot;
  // pull persists the first URL as the leaf's image preview.
  const firstImage =
    (p.hs_images ?? "").split(",")[0]?.trim() || null;

  // Owner: HubSpot owner_id is a numeric string; nexus tracks the
  // mapping via users.hubspot_owner_id. No match = null owner on
  // the leaf (PM can assign later via the leaf editor).
  const ownerHubspotId = p.hubspot_owner_id ?? null;
  const ownerId =
    ownerHubspotId && opts?.userIdByHubspotOwnerId
      ? opts.userIdByHubspotOwnerId.get(ownerHubspotId) ?? null
      : null;

  // fsc_claim_type: HubSpot enum ("FSC Mix", "FSC 100%", "FSC
  // Recycled", or empty). Coercion: any non-empty value → true;
  // empty/null → null (don't infer false unless explicit).
  const fscClaimRaw = p.fsc_claim_type?.trim();
  const fscClaim = fscClaimRaw ? true : fscClaimRaw === "" ? false : null;

  // fsc_supplier_verified: HubSpot text "true"/"false". Strict
  // mapping; anything else → null.
  const sv = p.fsc_supplier_verified;
  const supplierVerified =
    sv === "true" ? true : sv === "false" ? false : null;

  return {
    hubspotProductId: raw.id,
    name: p.name || "(unnamed product)",
    sku: p.hs_sku || null,
    unitCost: p.hs_cost_of_goods_sold || null,
    url: p.hs_url || null,
    imageUrl: firstImage,
    fscClaim,
    fscStatus: p.fsc_status || null,
    supplierVerified,
    ownerId,
    archived: raw.archived,
    // Raw internal value, verbatim. `|| null` only collapses the empty string,
    // which HubSpot returns for a cleared select — it never rewrites a value.
    hubspotProductType: p.hs_product_type || null,
  };
}

// Push-direction translator (Nexus → HubSpot). Strict subset of
// the pull mapping: only the fields AddProductModal LEAF mode
// collects from the PM at create time. Other HubSpot product
// attributes (description, owner, FSC fields, image URL) stay
// HubSpot-side until edited in HubSpot UI or re-pulled.
//
// `name` is required by HubSpot (validated upstream in
// createProduct); empty-string values for the optional fields
// drop in createProduct's normalization step so we don't have to
// pre-strip them here.
export function mapLeafToHubspotCreate(input: {
  name: string;
  sku?: string | null;
  unitCost?: string | null;
  url?: string | null;
  price?: string | null;
  /**
   * HubSpot's `hs_product_type` INTERNAL OPTION VALUE — e.g. `Primary`, not
   * the "Primary Packaging" label the operator selected. The caller validates
   * membership against the governed option set before reaching here; sending a
   * label would be accepted by HubSpot as a free string and then match nothing.
   */
  hubspotProductType?: string | null;
}): HubSpotProductCreateInput {
  const out: HubSpotProductCreateInput = { name: input.name };
  if (input.sku) out.hs_sku = input.sku;
  if (input.unitCost) out.hs_cost_of_goods_sold = input.unitCost;
  if (input.url) out.hs_url = input.url;
  if (input.hubspotProductType) out.hs_product_type = input.hubspotProductType;
  if (input.price !== undefined && input.price !== null) out.price = input.price;
  return normalizeHubSpotProductCreateInput(out);
}
