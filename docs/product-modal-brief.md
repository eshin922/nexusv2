# Brief: Product Modal — HubSpot-First Rewrite

## Context

The current "Add product" modal is built on a **local-first** model: it creates a SKU on the local scenario, and HubSpot writeback is an opt-in toggle. We're inverting that.

New model: **HubSpot is the source of truth for the product catalog.** Every product originates in HubSpot, whether added through this modal or pulled from the existing 990-record catalog. The local app reads from and writes to HubSpot — it doesn't hold a parallel truth.

This is a structural change, not a copy tweak. The toggle disappears, the field set expands, the submit flow inverts.

## Current state → Target state

| Current | Target |
|---|---|
| Local-first; HubSpot optional via toggle | HubSpot-first; toggle removed |
| 3 fields: Name, Type, Units per pack | 13 fields mirroring HubSpot's product schema |
| Type = "Leaf · single-line" (assembly concept) | Type = `hs_product_type` enum (15 values) |
| No SKU validation | Live SKU duplicate check on blur against HubSpot |
| Submit creates locally, syncs after | Submit creates in HubSpot first, renders on success |

## Field requirements

Mirror HubSpot's product schema exactly. Send values, display labels — they diverge for some product types.

**Required (block submit if blank):**
- **Name** → `name`
- **Product type** → `hs_product_type` (enum; stricter than HubSpot, which allows blank)

**Catalog-price boundary (PVS-018 follow-up):**
- **Unit price** → `price` (`number`/currency in HubSpot).
- Price is not a required PM field for reusable-component creation.
- Missing or blank price is sent as the technical catalog default `0.00`.
- An explicit valid nonnegative decimal is preserved; invalid input fails closed.
- This property is not a Nexus quote sell price or NetSuite Sales Order rate.

**Optional (mirror HubSpot):**
- **SKU** → `hs_sku` (with live duplicate check, see below)
- **Description** → `description`
- **Image** → `hs_images`
- **URL** → `hs_url`
- **Owner** → `hubspot_owner_id` (default to current HubSpot user)
- **Unit cost** → `hs_cost_of_goods_sold`
- **Markup** → `markup`
- **Tax Schedule** → `tax_schedule` (Taxable / Non Taxable)
- **FSC Claim Type** → `fsc_claim_type` (FSC Mix / FSC 100% / FSC Recycled)
- **FSC Status** → `fsc_status` (Yes / No)
- **FSC Supplier Verified** → `fsc_supplier_verified` (boolean)

**Calculated / read-only:**
- **Margin** = `price − hs_cost_of_goods_sold`, display only

**Create date** is auto-set by HubSpot — do not expose as user input.

### Product type — label/value mapping

Stored values diverge from display labels on three options. Display the label, send the value.

```
"Logistics"            → "Third Party Logistics"
"Primary Packaging"    → "Primary"
"Secondary Packaging"  → "Secondary"
```

All 15 product type values: Cards/Booklets, Design, Filling and Packout Services, Formulation, Freight, Labels, Logistics, One Time Charges, Primary Packaging, R&D / Testing, Raw ingredients, Secondary Packaging, Soft Goods and Accessories, Finished Goods, Turnkey.

## Behavior requirements

### On SKU blur (before submit)
- Query HubSpot for `hs_sku = {entered value}`.
- If match found: block submit. Show inline warning: *"This SKU already exists in HubSpot. Pull the existing product, or enter a different SKU."*
- Provide two CTAs in the warning:
  - **Pull existing** — loads the matching record's data into the form, switches mode to "attach existing".
  - **Use different SKU** — clears the field, re-focuses.

### On submit
1. Validate required fields client-side.
2. Call HubSpot Products API to create the record.
3. On success: render the new SKU in the local list with the returned HubSpot product ID attached. Close modal.
4. On failure: keep modal open, surface the error, no local record created.

**No local-only state ever exists.** If HubSpot creation fails, nothing local was created.

### On edit (future scope, not this PR)
- Edits to a product anywhere in the app write back to HubSpot.
- HubSpot remains authoritative — if HubSpot changes externally, the local view eventually reflects that.

### Product picker ("Pull from HubSpot" search)
- Filter out `hs_status = "inactive"` by default.
- Show a checkbox to include inactive if needed.

## Open questions (need answers before final wiring)

1. **What is a "scenario"?** The current modal copy says "creates a new SKU on this scenario." Is a scenario a quote-construction workspace? Are products scenario-scoped, or are they catalog-wide and scenarios just *reference* them? Assumption: catalog-wide, scenarios reference. Confirm. **(STILL OPEN.)**

2. **What does the current "Type" field (Leaf · single-line) represent?** It does not map to `hs_product_type`. Looks like an assembly-tree concept (leaf vs. parent node). The header shows "0 SKUs · 0 assemblies" — so SKUs and assemblies are distinct. Does this concept stay alongside `hs_product_type`, or get absorbed into `hs_product_classification` (Standalone / Variant / Bundle, which HubSpot already supports)?

   **RESOLVED — Edward, Phase 1 prep:** Leaf / Assembly is a position in a graph (where does this sit relative to other products); `hs_product_type` is a taxonomy (what kind of thing is this). Orthogonal axes. The current modal conflated them. **Phase 1 disposition:** drop Leaf / Assembly from the modal entirely; modal Type field becomes the 15-value `hs_product_type` enum. Assembly tree-role authoring stays in the row drawer (Reassign, Add child SKU). Create-leaf is the common case (single-action ship); creating an assembly is multi-step anyway (children must exist first), so decoupling tree-role from creation doesn't add real friction. **Banked for Phase 4 audit:** when a leaf is promoted to an assembly via the row drawer, does that write `hs_product_classification: bundle` back to HubSpot? Probably yes for consistency — explicit audit dimension rather than a guess.

3. **What is "Units per pack" for?** Not a HubSpot product field. Is it a line-item attribute (how the product is sold *in this quote*) or a product-catalog attribute? Mental model affects where it lives in the schema.

   **RESOLVED — Edward, Phase 1 prep:** Line-item attribute. **Phase 1 disposition:** drop `units_per_pack` from the modal entirely; default to 1 on insert (existing `quote_skus.units_per_pack` schema is already in place; no migration needed); expose as inline edit on the SKU row using the R6 read↔edit pattern (Pattern 29 — same shape as retail bench / label / qty cells). The "Pull from HubSpot" flow inherits the same default-to-1 behavior on attach (no UX change to that path).

4. **Additional SKU fields:** HubSpot has `dps_sku` and `mf_sku` (Manufacturer SKU) alongside `hs_sku`. Should the modal expose all three? Probably yes for `mf_sku`. Yoolim should confirm what `dps_sku` is. **(STILL OPEN.)**

5. **Tier breakpoints:** Out of scope for this modal in v1. Schema decision locked — we'll model tiers locally using HubSpot's vocabulary (`flat` / `volume` / `stairstep` / `graduated`) so there's a clean migration path if tiered pricing is unlocked in HubSpot. **(STILL OPEN — out-of-scope marker; decision held.)**

## Phased plan

### Phase 1 — Inversion (this PR)
- Remove HubSpot toggle entirely.
- Replace modal field set with the full HubSpot schema (required: Name, Unit price, Product type).
- Wire submit to HubSpot Products create API.
- Live SKU duplicate check on blur.
- Product type dropdown with correct label/value mapping.
- Update modal copy: *"Creates a new product in HubSpot and adds it to this scenario."*

### Phase 2 — Catalog parity
- Editing a product writes back to HubSpot.
- Inactive-status filtering on picker.
- Owner defaulting to current user.
- Image upload support.

### Phase 3 — Tier pricing (separate spec)
- Tier breakpoints UI on product (optional section).
- Quote-level tier comparison rendering.
- Tier-acceptance flow that writes the selected tier's price as the HubSpot line item price.

### Phase 4 — Reconcile scenario/assembly model
- Pending answers to open questions 1–3 above.

## Reference: HubSpot property names

For implementation, the canonical HubSpot product properties used here:

| Field | HubSpot property | Type |
|---|---|---|
| Name | `name` | string |
| SKU | `hs_sku` | string |
| Manufacturer SKU | `mf_sku` | string |
| DPS SKU | `dps_sku` | string |
| Description | `description` | string |
| Image | `hs_images` | string (URL) |
| URL | `hs_url` | string |
| Product type | `hs_product_type` | enumeration |
| Status | `hs_status` | enumeration (active/inactive) |
| Pricing model | `hs_pricing_model` | enumeration (flat/volume/stairstep/graduated) |
| Unit price | `price` | number |
| Unit cost | `hs_cost_of_goods_sold` | number |
| Markup | `markup` | number |
| Tax Schedule | `tax_schedule` | enumeration |
| Owner | `hubspot_owner_id` | number |
| FSC Claim Type | `fsc_claim_type` | enumeration |
| FSC Status | `fsc_status` | enumeration |
| FSC Supplier Verified | `fsc_supplier_verified` | boolean |
| Classification | `hs_product_classification` | enumeration (standalone/variant/bundle) |
| Create date | `createdate` | datetime (auto-set) |
