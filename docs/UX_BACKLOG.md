# UX Backlog

Tracked UX issues to address at Slice 13.5 (mid-build UX pass) or Slice 17 (polish).
Items here are intentionally deferred - capture, don't fix in the moment.

## Open

- [Slice 2] Home page paradigm is wrong. "Import Deal" is front-and-center 
  but PMs will spend 80% of their time looking at their existing projects, 
  not importing new ones. Home should be a project list with import as a 
  button on it, not a separate destination. Defer to Slice 13.5 once the 
  Deal Organizer ships in Slice 13.

- [Slice 3] No way to unarchive a project from the UI. Archive flow exists,
  the inverse doesn't. Currently requires a direct DB update. Add an
  "Unarchive" button (visible only when status=archived) parallel to the
  archive flow, with audit entry. Cheap addition; pull into Slice 13.5 with
  the Deal Organizer's archive filters.

- [Slice 4] Open question: should Nexus support creating new HubSpot Products
  from within the tool, or is reference-only the right model?

  Discovery needed before deciding:
  1. Who currently owns HubSpot product catalog creation at DPS?
  2. Is HubSpot the master for products, or is NetSuite the master?
  3. What HubSpot Product fields are required for the NetSuite sync to succeed?
  4. Are there existing catalog hygiene problems that distributed creation would worsen?

  Three architectural options:
  A) Reference only — PM context-switches to HubSpot for new products (current plan)
  B) Create-through — Nexus form POSTs to HubSpot Products API, PM never leaves
  C) Request-to-create — PM submits request, designated reviewer approves, creation happens

  Slice 4 ships with Option A. Revisit at Slice 13.5 once discovery is complete.

- [Slice 12 prerequisite] Verify the HubSpot → NetSuite sync handles
  line-item-level `hs_cost_of_goods_sold` gracefully. If COGS has been
  unpopulated historically, the sync may not have been tested with non-null
  values. Confirm with sync owner that populated COGS on line items either
  (a) flows to NetSuite cleanly, or (b) is safely ignored. Either is fine;
  silent failure is not.

- [Slice 9 prerequisite — high priority] The markup category schedule
  defined in v3 spec Section 5 is being redefined based on "line of work."
  Edward to provide new vocabulary and percentages before Slice 9 starts.
  Slice 9 cannot ship without this. Schema model (`markup_defaults` table)
  is flexible; only seed values and lookup logic depend on the decision.

## Resolved

- [Slice 12, resolved] `hs_cost_of_goods_sold` on HubSpot Products is unused
  at DPS because COGS is composite per-quote, not per-product. Slice 12
  writeback populating line-item-level `hs_cost_of_goods_sold` from Nexus
  unlocks native HubSpot margin reporting (`hs_margin`) for the first time.
  Confirmed line-item-level COGS is the right and only target for writeback.
  No conflict with product-level (which stays unset).

- [Slice 4, resolved] `packaging_category` and `product_type` both dropped
  from Nexus `quote_skus`. Nexus references HubSpot products via
  `hubspot_product_id` only and snapshots minimal fields (`sku_label`,
  `product_name`). Markup logic will be redefined in Slice 9 with new
  categorization. `field_source_json` also dropped — overkill with only
  two HubSpot-sourced fields and no override semantics.
