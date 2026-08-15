# OD-023 · Snapshot completeness — field inventory

**Status:** INVENTORY ONLY. No migration, no reader change, no backfill.
**Traced:** 2026-08-15, from the artifact backwards.
**Method:** `PDF components → customer-pdf-types → customer-view-to-cpdf →
CustomerView → resolver/loaders`. Per disposition 1, the payload is inventoried
from what the artifact actually consumes, not derived from the resolver's
convenience shape and not from the current `quote_snapshots` columns.

---

## 0 · What the sent artifact is made of

Two independent render inputs, and only the first has ever been examined:

1. **`CpdfData`** — `vendor`, `customer`, `quote`, `tiers`, `recommendedTierIdx`,
   `skus`, `serviceFees`, `freightLines`. Built by `customer-view-to-cpdf.ts`
   from `CustomerView`.
2. **`QuoteAddendumData`** — the specification addendum pages. Built by a
   SEPARATE loader (`src/lib/addendum-loader.ts`) that never passes through
   `CustomerView` at all, and reads live `assemblies` / `assembly_leaves` /
   `leaves` / `leaf_specs` / `product_types`.

The second is easy to miss because it does not appear in `CustomerView`. It is
half the artifact when `include_spec_addendum` is on.

## 1 · What is snapshotted today

| Store | Written at | Carries |
|---|---|---|
| `quote_snapshots` | `sendQuote` (`quotes.ts:1808`) | version, effective/superseded, sent_at, valid_until, quote_number, tcs, payment_terms, lead_time, incoterms, days_valid, prepared_by ×3, pdf_layout, detail_level, include_spec_addendum, pdf_url, accepted_snapshot_json |
| `quotes.*_snapshot` | `sendQuote` | mirror of the commercial/prepared-by/axes set, retained during transition |
| `quote_commercial_settings_pins` | `sendQuote` | pinned commercial settings |
| `quote_snapshot_freight_inputs` | `sendQuote` | legacy per-component freight cost + effective units |
| `quote_snapshot_freight_workbooks` | `sendQuote` | the worksheet freight workbook, JSONB |

**It carries no product content whatsoever.** No leaf set, no structure, no
membership, no tiers, no quantities, no spec values, no computed price.

## 2 · The matrix

`currently snapshotted?` is about the SENT VERSION being reconstructible — not
about whether a column happens to be stable today.

### 2.1 Identifiers and labels needed to reconstruct the artifact

| Customer-visible field | Source table / loader | Transformed where | Snapshotted? | Required? | Proposed location |
|---|---|---|---|---|---|
| `quote.quote_number` | `quote_snapshots.quote_number` | resolver → adapter | **yes** | yes | — |
| `quote.issued_date` | `quote_snapshots.sent_at` | adapter `issued_date` | **yes** | yes | — |
| `quote.valid_until` | `quote_snapshots.valid_until` | resolver | **yes** | yes | — |
| `quote.project_title` | `projects.deal_name` | resolver → `projectTitle` | **NO — live** | yes | `quote_snapshots.project_title` |
| `vendor.name` / `sub` / `address` | `firm_settings` (current row, `effective_until IS NULL`) | resolver, `VENDOR_FIXTURE` fallback | **NO — live** | yes | `quote_snapshots.vendor_name` / `_tagline` / `_address` |
| `vendor.contact_*` | `quote_snapshots.prepared_by_*` | adapter | **yes** | yes | — |
| `customer.name` | `projects.client_name` | resolver | **NO — live** | yes | `quote_snapshots.customer_*` (5 cols) |
| `customer.contact` / `role` / `email` / `address` | `projects` | resolver | **NO — live** | yes | as above |
| `quote.payment_terms` / `lead_time` / `incoterms` / tcs | `quote_snapshots` | resolver | **yes** | yes | — |
| `pdf_layout` / `detail_level` / `include_spec_addendum` | `quote_snapshots` | resolver | **yes** | yes | — |
| `pdf_url` | `quote_snapshots.pdf_url` | — | **yes** | yes | — |

### 2.2 Customer-facing notes

| Field | Source | Snapshotted? | Required? | Proposed |
|---|---|---|---|---|
| `quote.customer_facing_notes` | `quotes.customer_facing_notes` — **live column, read directly** | **NO** | yes — free text printed on the artifact | `quote_snapshots.customer_facing_notes` |

`internal_notes` is excluded, correctly: it is not in the render tree.

### 2.3 Tiers

| Field | Source | Snapshotted? | Required? | Proposed |
|---|---|---|---|---|
| `tier.id` | `quote_tiers.id` via bundle | **NO — live** | yes — the column key every price aligns to | snapshot tier rows |
| `tier.label` (`"Tier 1"`) | `quote_tiers.label` | **NO — live** | yes | ↑ |
| `tier.full` | derived `Tier ${idx+1}` from ORDER | **NO** | yes — depends on sort order | ↑ (capture order) |
| `tier.quantity` | `quote_tiers.qty` | **NO — live** | yes — printed | ↑ |
| `recommendedTierIdx` | `quote_tiers.recommended` (separate live read) | **NO — live** | yes — drives the ★ and, under `single_tier`, WHICH tier prints | ↑ |

### 2.4 Product structure — Item Groups, Direct products, membership, order

| Field | Source | Snapshotted? | Required? | Proposed |
|---|---|---|---|---|
| leaf set (which products) | `quote_leaves` via bundle → `skuRollups` filtered `skuRole === "leaf"` | **NO — live** | yes | snapshot leaf rows |
| `sku.code` (`skuLabel`) | `leaves.sku` via bundle | **NO — live** | yes — printed | ↑ |
| `sku.name` (`productName`) | `leaves.name` via bundle | **NO — live** | yes — printed | ↑ |
| Direct vs Item-Group member | `quote_leaves.assembly_id IS NULL` | **NO — live** | yes | ↑ (`is_direct` / group ref) |
| Item Group identity (`sku`, `name`) | `assemblies` | **NO — live** | yes — printed on addendum pages | snapshot assembly rows |
| membership | `quote_leaves.assembly_id`, and `assembly_leaves` for the addendum | **NO — live** | yes | ↑ |
| display order | `assemblies.position`, `quote_leaves.position`, `assembly_leaves.position` | **NO — live** | yes — row order on the printed artifact | ↑ (explicit ordinal) |
| `sku.pack` | hardcoded `null` in resolver | n/a | no — never rendered | — |
| `units_per_pack` | hardcoded `1` | n/a | no | — |

### 2.5 Quote-owned spec values actually rendered

Addendum only, and only when `include_spec_addendum` is true.

| Field | Source | Snapshotted? | Required? | Proposed |
|---|---|---|---|---|
| assembly `sku` / `name` per addendum page | `assemblies` (live) | **NO** | yes | snapshot addendum payload |
| leaf `name` | `leaves.name` (live) | **NO** | yes | ↑ |
| spec field `key` / `label` / `wide` | `product_types.field_schema` (live master data) | **NO** | yes — the LABELS are printed | ↑ (resolved fields, not a type ref) |
| spec `value` | `leaf_specs.spec_values`, quote-scoped | **NO** | yes — printed | ↑ |
| variant (`typed` / `placeholder` / `untyped`) | derived from pinned schema | **NO** | yes — changes what the page renders | ↑ |
| `hasMeaningfulContent` | derived | **NO** | derivable from the above | — |
| `leaf_specs.version_number` | — | — | **no** — boundary-excluded, not rendered | — |

Spec VALUES became immutable-after-send in Step 1 (`updateLeafSpec` now requires
draft). That closes the edit-while-sent path; it does **not** make the sent
version reconstructible after a Revise, which is what §3 is about.

### 2.6 Computed commercial output rendered to the customer

| Field | Source | Snapshotted? | Required? | Proposed |
|---|---|---|---|---|
| `sku.tier_prices[]` | `computeQuoteCosting` over the entire live cost graph | **NO — recomputed live** | yes — the printed price | snapshot the RENDERED figures |
| `sku.shape` (`step`/`flat`/`partial`) | derived from `tier_prices` | **NO** | derivable | — |
| turnkey / grand totals | `quoteRollup` (live) | **NO** | yes — printed | ↑ |
| freight inputs feeding price | `quote_snapshot_freight_inputs`, `quote_snapshot_freight_workbooks` | **yes** | yes | — (already) |
| packaging / production / raw inputs | `assembly_leaf_inputs`, `assembly_production_inputs` (live) | **NO** | yes, if reconstructing by recompute | see §4 |
| overrides / targets / lifts | `assembly_leaf_overrides`, `assembly_leaf_targets`, `quote_leaf_lifts` (live) | **NO** | yes, if recomputing | see §4 |
| `markup_defaults`, adjustments | live | **NO** | yes, if recomputing | see §4 |

### 2.7 Customer-visible freight / service / adjustment content

| Field | Source | Snapshotted? | Required? | Proposed |
|---|---|---|---|---|
| `serviceFees[]` — label, sub, amount, qty_label, scope | `assembly_production_inputs` (live), aggregated MAX-per-fee across tier rows | **NO — live** | yes — printed line items | snapshot the rendered fee lines |
| `freightLines[]` | **always `[]`** — `resolver:393`, BV-009 bundles freight into unit price | n/a | no content today | — |
| price adjustments (GPA / tier adj / lift / override) | live | **NO** | not printed AS lines; reach the customer only through `tier_prices` | covered by §2.6 |

Freight is worth stating explicitly because the freeze already half-exists: the
freight COST is snapshotted, but the price it feeds is not.

---

## 3 · The actual failure mode, restated after Step 1

Step 1 established that every customer-visible/commercial writer requires
`draft`. So a sent quote's live rows **cannot** be edited in place — the
original OD-023 framing ("a Setup edit between Send and Complete") is now
blocked at the action layer.

The gap that remains is the one Revise opens:

```
send      → snapshot(v1) written; live rows frozen by draft guards
revise    → snapshot(v1).superseded_at = now; quote → draft, version = 2
edit      → live rows legally diverge — they are now v2's working copy
read v1   → structure, tiers, specs and prices re-derived from v2's live rows
```

Two consequences, both measured from the code rather than inferred:

1. **There is no version-scoped read path at all.** Both bundle snapshot
   branches (`costing.ts:170`, `:360`) key on
   `isNull(quoteSnapshots.superseded_at)` — the CURRENT snapshot only. A
   superseded version cannot be read even for the freight that *is* snapshotted.
2. **`pdf_url` survives and is authoritative for what the customer received.**
   It is retained across Revise (`quotes.ts:2123` — mirror columns and `pdf_url`
   stay). So the artifact is not lost; the QUERYABLE reconstruction is.

## 4 · The schema delta

**Recommended shape: snapshot the RENDERED ARTIFACT INPUT, not the cost graph.**

Two candidate designs, and the choice is a real one:

- **(a) Snapshot the inputs** — leaves, assemblies, membership, order, tiers,
  cost rows, overrides, lifts, markup defaults — and recompute at read time.
  Faithful to "one source of truth", but it freezes an input set the ENGINE must
  keep interpreting identically forever. Any future math change silently
  re-prices historical quotes. That is the Pattern 56 shape: correctness held by
  the engine not changing, rather than by construction.
- **(b) Snapshot the projected `CpdfData` + `QuoteAddendumData`** — the exact
  values the artifact printed. Reconstruction is a read, not a recompute, so a
  later math change cannot move a sent price. Costs a JSONB payload per send and
  duplicates figures that also exist as inputs.

**Proposed: (b), with the freight input tables retained as they are.** They
already exist, they are evidence of HOW the printed figure was reached, and
they do not conflict — (b) records what was printed, they record what produced
it. Disposition 2 already asks for exactly this shape: *"derive the historical
customer-render input from the snapshot, and compare its canonical structured
representation."* That comparison is only meaningful if the snapshot IS the
render input.

### Delta if (b) is taken

**New table** — `quote_snapshot_artifacts`, one row per `quote_snapshots.id`:

| Column | Type | Carries |
|---|---|---|
| `quote_snapshot_id` | uuid PK/FK → `quote_snapshots` ON DELETE CASCADE | binds to the version, superseded or not |
| `cpdf_data` | jsonb NOT NULL | the full `CpdfData`: vendor, customer, quote, tiers, recommendedTierIdx, skus (with `tier_prices`), serviceFees, freightLines |
| `addendum_data` | jsonb | `QuoteAddendumData` — null when `include_spec_addendum` was false at send |
| `structure` | jsonb NOT NULL | leaf set with canonical `quote_leaves.id`, `is_direct`, group ref, group identity, explicit ordinals — the governed identity OD-023 names, kept separate from the render payload so it is queryable rather than only printable |
| `schema_version` | integer NOT NULL | payload shape version; a reader must refuse an unknown one rather than guess |
| `created_at` | timestamptz NOT NULL | |

**Additive columns on `quote_snapshots`** (small, queryable, avoids reaching into
JSONB for the common case):

| Column | Why |
|---|---|
| `customer_facing_notes` text | printed free text, currently live |
| `project_title` text | printed under the quote number, currently live |
| `customer_name` / `customer_contact` / `customer_role` / `customer_email` / `customer_address` text | printed party block, currently live |
| `vendor_name` / `vendor_tagline` / `vendor_address` text | printed masthead; `firm_settings` is versioned but the resolver reads the CURRENT row, not the one effective at send |

**Reader change (later step, not now):** the bundle's two snapshot branches must
become version-scoped rather than `superseded_at IS NULL`, or historical reads
will keep reading the current version's freight.

**Migration class:** additive throughout — new table, new nullable columns. No
tightening, so it may precede the code that reads it (per the deployment-order
rule). Nothing is dropped.

## 5 · Explicitly excluded, with reason

| Excluded | Why |
|---|---|
| `quotes.internal_notes` | absent from the render tree |
| audit metadata, `caused_by_audit_id` | forensic, never printed |
| provider/cache state, realtime, `hubspot_deals_cache` | runtime, not a version |
| `leaf_specs` LIBRARY rows (`quote_id IS NULL`) | mutable master data; the quote-scoped row is the authority and is what renders |
| `product_types` as a REFERENCE | the resolved field labels are captured instead — a type ref would re-read mutable master data at render |
| `freight_destination_tracking` | operational; entered after send by design (Step 1 classification) |
| `leaf_specs.version_number` | customer-view boundary excludes it |
| warnings, pricing events, provenance | derived/advisory, absent from the artifact |
| `sku.pack`, `units_per_pack` | hardcoded `null` / `1`; nothing renders them |

## 6 · Legacy sent quotes

**No backfill.** Reconstructing structure from today's live rows would record
current state as historical sent state — false evidence of exactly the kind this
work exists to prevent. Pre-migration sent versions are **legacy · structural
snapshot unavailable**; where `pdf_url` exists, that PDF remains the historical
customer artifact.

## 7 · Findings surfaced by the trace, not blocking this step

1. **Direct Components are invisible to the addendum.** `addendum-loader.ts`
   reaches leaves through `assembly_leaves` (the legacy junction), which a
   Direct Component has no row in. It therefore appears in the pricing table
   (`skuRollups` includes it as a leaf) and NOT in the specification addendum.
   Pre-existing, unreachable today because Directs are UI-unreachable until
   OD-022 — but the addendum is the one remaining customer-facing consumer still
   keyed on the junction OD-017 retired everywhere else.
2. **`vendor.*` and the customer party block are read live from versioned
   `firm_settings` and mutable `projects`.** Both print on every artifact. The
   commercial-settings pin does not cover vendor identity.
3. **`tier.full` is derived from array position**, so tier ORDER is load-bearing
   for a printed label and is not captured anywhere.
