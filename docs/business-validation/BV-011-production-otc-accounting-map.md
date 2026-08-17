# BV-011 — Production / OTC Accounting Map

## Status

**Approved governing business map. Recorded 2026-08-17 (Edward).**

This document **authorizes no implementation.** It changes no costing, PDF,
Quote, or NetSuite behavior, and no code, schema, or migration may cite it as
authority to do so. It is the business authority the bounded **Production / OTC
accounting workstream** will be reconciled against when that workstream opens.

Until then it governs only one thing: what the categories *are*.

---

> **BV-011 answers *what item type*. It does not answer *whose economics*.**
> Ownership is governed by
> [BV-012 — Production Cost Ownership](BV-012-production-cost-ownership.md):
> the Item Group is the finished-good economic envelope, and no Item Group
> means no Production economics. A cost can be correctly classified here and
> still be attached to the wrong business object. Do not conflate the two.

## 1. The map

Every production / service input resolves to one of two classes.

### 1.a Finished-good component / item

These belong to the **finished-good / component economics**. They do not become
separate OTC or service lines.

| Input | Destination | Item type |
|---|---|---|
| Filling / Blending | `OTC - Filling` | Inventory Item |
| CM Assembly / Pack-out | `OTC - Packout` | Inventory Item |
| Bulk Raw | `OTC - Raws` | Inventory Item |

### 1.b OTC / service lines

| Input | Destination | Item type |
|---|---|---|
| Freight, Duties, Tariffs | `OTC - Freight, Duties, Tariffs` | Inventory Item |
| Customs | `OTC - Customs` | Inventory Item |
| Setup | `OTC - Setup` | Non-inventory Item |
| Artwork | `OTC - Artwork` | Non-inventory Item |
| Tooling | `OTC - Tooling` | Inventory Item |
| R&D / Formulation | `OTC - Formulation` | Non-inventory Item |
| Testing / Micros | `OTC - Testing` | Non-inventory Item |
| Other Service | `OTC - Other Service` | Non-inventory Item |
| Emboss / Deboss / Foil / Cutting Die | `OTC - Dies` | Non-inventory Item |
| Printing Plates | `OTC - Print Plates` | Non-inventory Item |
| Samples / PPS | `OTC - Samples` | Non-inventory Item |
| Processing Fee | `OTC - Processing Fee` | Non-inventory Item |
| Cartons (Master / Inner) | `OTC - Cartons` | Non-inventory Item |

**16 destinations.** 6 Inventory Item, 10 Non-inventory Item.

---

## 2. What this supersedes

> The loose historical assumption that Production / service-fee inputs can all
> be treated as **one accounting class**.

That assumption is visible in the current implementation and is the reason this
map is needed rather than merely useful — see §4.

---

## 3. Scope boundary

This document does **not** authorize, and must not be cited to justify:

- any change to costing arithmetic, markup resolution, or allocation behavior;
- any change to customer-facing presentation (Quote surface, customer PDF);
- any change to NetSuite projection, item resolution, or grouping;
- any schema migration, backfill, or new input surface;
- any change to `Allocate service fees to unit cost`, whose V1 authority is
  settled separately (quote-wide operator authority, 2026-08-17).

The workstream will reconcile **costing authority, allocation behavior,
one-time charges, markup, customer presentation, and NetSuite projection**
against this map. Each of those is decided there, not here.

---

## 4. Reconciliation surface

**These are questions for the workstream, not findings and not decisions.**
Recorded now, while the map is fresh, so the workstream starts from verified
current-state rather than from recollection. Each item states what is true in
the code or the database today, with its citation.

**1 · The current input vocabulary is narrower than the map.**
`VIRTUAL_LINES` in `src/components/costs/production-drilldown.tsx` defines six
production inputs — Filling / blending, CM assembly, Setup fee,
Tooling / artwork, R&D, Other service — plus Bulk raw cost when
`raws_mode = cm_sources`. The map names 16 destinations. Seven have no input
surface today: Testing / Micros, Dies, Print Plates, Samples / PPS, Processing
Fee, Cartons, and Customs as a line distinct from duties and tariffs.

**2 · `Tooling / artwork` is one input; the map is two destinations with
different item types.** Today a single field carries both. The map separates
`OTC - Tooling` (Inventory Item) from `OTC - Artwork` (Non-inventory Item).
Splitting a persisted field is a migration question, not a UI one.

**3 · Setup and Tooling currently share a markup category.** Both are
`category: "Tooling"` in `VIRTUAL_LINES`; `markup_defaults` resolves that to a
single rate. The map gives them different destinations and different item
types.

**4 · Duties and tariffs are currently folded into landed freight, and Customs
is not a separate quantity.** `quote_skus.duty_pct` / `tariff_pct` contribute
to the landed-freight rollup (see CLAUDE.md, "Customs / landed-cost data"). The
map has both `OTC - Freight, Duties, Tariffs` and a distinct `OTC - Customs`;
the boundary between them is undefined in the current model.

**5 · Freight treatment has its own unratified authority.** BV-009 is a
reconstruction, not ratified — [OD-001](../OPEN_DECISIONS.md). The map assigns
freight an accounting destination. Which document governs freight's
*presentation* (bundled vs pass-through) versus its *accounting destination*
needs stating explicitly, or the two will be read as competing.

**6 · Bulk Raw has its own markup authority, and it does not resolve.**
`RAW_MARKUP_CATEGORY = "Raw ingredients"` (`src/lib/costing.ts:904`) is distinct
from `PRODUCTION_MARKUP_CATEGORY = "Manufacturing"`. **Verified against the
live database 2026-08-17: `markup_defaults` contains exactly seven rows —
Freight, Manufacturing, Other, Primary, Secondary, Soft Goods, Tooling.** There
is no `Raw ingredients` row, so bulk raw falls back to `Other` at 30% today.
The map places Bulk Raw in the finished-good class, which is consistent with
the T-4 disposition that restored RAW as its own governed section — but the
markup category it is supposed to resolve through does not exist.

**7 · The documented markup vocabulary and the live vocabulary disagree.**
CLAUDE.md records a 7 + 12 category list (Co-Packing, Cartons / Booklets,
Logistics, Passthrough, R&D / Testing, Raw Ingredients, Turnkey, and others) as
"the actual production vocabulary… not placeholders." The database has only the
original seven. Whichever is correct, the map's destinations do not map 1:1 to
either, and markup resolution is explicitly in the workstream's scope.

**8 · Cartons may already be authored as packaging.** The map routes
Cartons (Master / Inner) to a Non-inventory OTC line. Corrugated / carton
inputs are plausibly entered today as packaging lines under the `Secondary`
markup category. Where cartons are authored — and whether that changes —
determines whether this is a re-mapping or a new surface.

**9 · Allocation currently applies uniformly to all one-time fees.**
`allocate_service_fees_to_cost` is a single boolean governing Setup, Tooling /
artwork, R&D and Other service together. The map splits those destinations
across both item types. Whether allocation remains uniform, becomes per-item-
type, or becomes per-destination is a workstream decision — and it interacts
with the V1 quote-wide authority disposition, which was taken on the current
uniform model.

---

## 5. Related authority

| Document | Relationship |
|---|---|
| [BV-006](BV-006-product-structure-contract.md) | Product Structure Contract. Governs what a Component and a Product are; this map governs how their production / service inputs classify |
| [BV-009](BV-009-freight-treatment.md) | Freight treatment. ⚠️ unratified — [OD-001](../OPEN_DECISIONS.md). See §4.5 |
| [OD-006](../OPEN_DECISIONS.md) | NetSuite assembly structure. Open; the workstream's NetSuite projection question depends on it |
| `docs/validation/quote-translation-parity-matrix.md` §T-4 | Bulk raw as an independently governed quantity. See §4.6 |
