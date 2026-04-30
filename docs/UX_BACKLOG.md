# UX Backlog

Tracked UX issues to address at Slice 13.5 (mid-build UX pass) or Slice 17 (polish).
Items here are intentionally deferred - capture, don't fix in the moment.

## Open

- [Slice 5.6] PM custom property TBD. `hubspot_deals_cache.pm_id` /
  `pm_name` / `pm_email` columns are nullable until the HubSpot deal
  property internal name is identified. Set `HUBSPOT_PM_PROPERTY=<name>`
  in env once known and the sync will populate the columns
  automatically. To discover candidates, run `dumpDealProperties()`
  (exported from `src/lib/hubspot-cache.ts`) — it lists deal properties
  whose name/label matches `pm|manager|lead|owner|coordinator|director`.

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

- [Slice 5 → Slice 9] Markup categories on `packaging_inputs.category` and
  the `markup_defaults` seed are temporary placeholders matching the
  existing Excel worksheet vocabulary (Primary 40 / Secondary 50 /
  Manufacturing 30 / Tooling 20 / Freight 20 / Soft Goods 35 / Other 30).
  Slice 9 will redefine these with the new "line of work" schedule. The
  migration will rewrite category strings on existing `packaging_inputs`
  rows; `markup_defaults` rows will be rebuilt entirely. No FK between
  the two columns by design — soft reference, joined at read time.

- [Slice 5] `packaging_inputs.purchase_qty` is in the schema but not
  surfaced in the Slice 5 UI (Slice 5 only renders `unit_cost` per tier).
  Surface a `purchase_qty` entry path when Slice 8's costing logic needs
  it — likely as a sibling input next to `unit_cost`, or in a costing
  sheet review row.

- [Slice 5 → Slice 13.5 polish] Per-tier unit cost row layout in packaging
  inputs grid is sparse and visually unclear at 2+ tier scale. Tier cells
  are spread across the row width instead of clustered in clear columns,
  and the copy-to-all-tiers '→' buttons aren't visually anchored to their
  cells. Reconsider grid layout: option (a) put tier columns in the main
  metadata row alongside Supplier/Qty/Category/Markup as additional
  columns; option (b) use a more compact dense-cluster layout for tier
  cells with explicit column headers. Address in Slice 13.5 polish.

- [Slice 5 → Slice 13.5 polish] Short ID badges added on quote builder
  and packaging pages (and per-quote in the project detail list) for
  dev/test ergonomics — first 8 chars of the UUID, click-to-copy the
  full ID. At polish time, decide whether to keep visible to all users
  (useful for support / referencing in Slack) or hide behind admin
  role / dev-mode flag.

- [Slice 5 → Slice 13.5 polish] `$0` `unit_cost` UX is currently
  ambiguous — PMs may enter 0 to mean "no cost" (legitimate, e.g.
  customer-supplied raws) or leave the field blank meaning "not yet
  priced." Both render visually similar in the per-tier cost cell.
  At polish time, decide whether to: (a) treat 0 as a sentinel and
  warn before save, (b) require an explicit "free" toggle, or
  (c) accept both and surface the ambiguity in the costing sheet.

- [v2] Replace HubSpot ↔ NetSuite product sync with Nexus → NetSuite
  direct integration. Removes the structural bottleneck that prevents
  BOM/assembly metadata from flowing to NetSuite. NetSuite becomes the
  single product master; Nexus becomes the assembly intelligence layer.

- [v2] Direct Nexus → NetSuite Sales Order writeback with assembly
  support. Eliminates manual NetSuite assembly configuration step that
  ops currently performs. Nested BOMs flow as native NetSuite assembly
  items.

- [v2] HubSpot Products integration becomes one-way (NetSuite → HubSpot,
  optional, for CRM visibility only). Nexus stops referencing HubSpot
  Products as the canonical SKU source; references NetSuite items
  directly.

- [Slice 5.5 → Slice 13.5] Validate "Add assembly" button placement with
  real PM workflow — current placement is bottom of search panel; may
  belong as a separate tab, a top-of-page action, or inline with the
  search results depending on actual PM mental model. Decision deferred
  until we observe how PMs actually compose assemblies in practice.

- [v1.5+ consideration] Evaluate dropping `sku_role` entirely and
  inferring assembly status from tree position (has children vs. has no
  children). Trade-off: simpler schema, requires handling the edge case
  of adding children to a SKU that already has packaging_inputs (does
  the leaf's existing packaging persist as the now-assembly's packaging,
  or does the role transition force a packaging wipe?). Defer until
  real PM usage proves whether explicit role declaration adds value
  beyond what the tree shape already implies.

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

- [Slice 5, resolved] Form state pattern for all auto-saving forms is
  **controlled inputs + useTransition + debounced direct action calls**,
  not uncontrolled forms with `onBlur` + `<form action={fn}>`. The
  uncontrolled pattern races React 19's implicit form-reset against RSC
  revalidation and produces "field blanks ~1 second after save" bugs.
  Server actions that mutate row state return the full updated row
  (canonical snapshots), not void. The save handler reads the new value
  from the change event and passes it through as an explicit override
  rather than relying on a ref that may not have committed yet (avoids
  the "one step behind" off-by-one bug on immediate saves). Pattern is
  codified in CLAUDE.md ("Form state pattern" + "Save handler pattern").
  Applies to: SKU rows, Tier rows, packaging input rows, production
  input rows (Slice 6), freight input rows (Slice 7), Costing Sheet
  sell-price overrides (Slice 8+), notes textareas, all settings forms.
  Do not introduce uncontrolled `<form action={fn}>` with onBlur
  auto-save in any future slice.
