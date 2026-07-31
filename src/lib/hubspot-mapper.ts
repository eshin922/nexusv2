import "server-only";
import type { HubspotProductRaw } from "./hubspot";
import type { HubSpotProductCreateInput } from "./integrations/hubspot-provider";

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
// | hs_product_type         | (skip)            | (skip)    | HubSpot enum ≠ nexus product_types taxonomy |
// | description             | (no column)       | (skip)    | Catch #12 — no nexus column; revisit v1.1+ |
// | price                   | (no column)       | (skip)    | sell-price lives on quote_skus, not leaves |
// | hubspot_owner_id        | owner_id          | pull cond | mapped via users.hubspot_owner_id lookup |
// | fsc_claim_type          | fsc_claim         | pull cond | text-to-bool coercion |
// | fsc_status              | fsc_status        | pull      | direct text |
// | fsc_supplier_verified   | supplier_verified | pull cond | text-to-bool coercion |
// | (raw.archived)          | archived          | pull      | from HubSpot top-level archive flag |
//
// Push direction (Nexus → HubSpot) is the strict subset:
//   name + hs_sku + hs_cost_of_goods_sold + hs_url
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
}): HubSpotProductCreateInput {
  const out: HubSpotProductCreateInput = { name: input.name };
  if (input.sku) out.hs_sku = input.sku;
  if (input.unitCost) out.hs_cost_of_goods_sold = input.unitCost;
  if (input.url) out.hs_url = input.url;
  return out;
}
