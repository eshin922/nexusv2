# Product Type integrity — investigation

**Status:** investigation only. **Nothing repaired, normalized, or changed** —
not in Nexus, not in HubSpot.
**Date:** 2026-08-13

---

## Verdict, before the evidence

**HubSpot is not the problem. Nexus does not ingest the field, by an explicit and
documented decision, and the Library filters on a different taxonomy that is 98%
empty.**

There is no data-integrity defect in HubSpot: 1,037 products, every populated
value a legal member of the property's option set, no casing, whitespace,
spelling, or deprecated-value anomalies.

Two Nexus-side facts produce everything observed:

1. **The HubSpot pull deliberately never writes a type.**
2. **The Library filter predicates on the Nexus taxonomy**, which 1,051 of 1,077
   leaves have no value for.

## 1 · The HubSpot property

| | |
|---|---|
| internal name | **`hs_product_type`** |
| display label | **"Product type"** |
| type / fieldType | `enumeration` / **`select`** — single-select |
| calculated | no · **hidden** no |
| options | **15** |

**Three options have an internal value that differs from its display label** —
and they are precisely the ones in question:

| display label | internal value |
|---|---|
| **Primary Packaging** | **`Primary`** |
| **Secondary Packaging** | **`Secondary`** |
| **Logistics** | **`Third Party Logistics`** |

The other twelve are identical in label and value: `Cards, Booklets`, `Design`,
`Filling and Packout Services`, `Formulation`, `Freight`, `Labels`,
`One Time Charges`, `R&D / Testing`, `Raw ingredients`,
`Soft Goods and Accessories`, `Finished Goods`, `Turnkey`.

**This divergence is a live trap for any future mapping**, even though it is not
the cause of the current symptom: a mapping written against the labels seen in
the HubSpot UI would silently miss the three highest-volume categories.

## 2 · Live inventory — raw, uncollapsed

1,037 products. Values are shown exactly as returned; guillemets make any
leading/trailing whitespace visible.

| count | raw value |
|---|---|
| 346 | `«Secondary»` |
| 171 | `«Primary»` |
| 116 | `«Labels»` |
| 110 | `«Filling and Packout Services»` |
| 95 | `«Soft Goods and Accessories»` |
| 60 | `«One Time Charges»` |
| 51 | `«Cards, Booklets»` |
| 46 | `«Raw ingredients»` |
| 11 | `«Freight»` |
| 9 | `«Design»` |
| 6 | `«R&D / Testing»` |
| **5** | **`<<NULL>>`** |
| 4 | `«Third Party Logistics»` |
| 4 | `«Finished Goods»` |
| 2 | `«Turnkey»` |
| 1 | `«Formulation»` |

**16 distinct values, 15 of them legal options plus NULL.** No casing variants,
no whitespace damage, no spelling drift, no deprecated or unexpected values, no
multi-select artefacts. **HubSpot's type data is clean and 99.5% populated.**

## 3 · The trace, boundary by boundary

| boundary | field | value | transformation |
|---|---|---|---|
| HubSpot Product | `hs_product_type` | e.g. `"Primary"` | — |
| fetch (`hubspot.ts:416,453`) | → `productType` | `props.hs_product_type \|\| null` | `""` → `null` |
| **pull → `leaves`** (`hubspot-pull.ts:247`) | — | **field is NOT in the insert** | **DROPPED** |
| **pull → existing leaf** (`hubspot-pull.ts:196`) | — | **explicitly preserved, never set** | **DROPPED, by comment** |
| storage | `leaves.product_type_id` | FK → `product_types` | Nexus taxonomy, unrelated ids |
| Library loader | `productType` | `typeMap.get(r.productTypeId)` | null → `null` |
| Library display | Type column | `row.productType?.name ?? "untyped"` | — |
| **Library filter** | — | `eq(leaves.productTypeId, typeFilter)` | **filters the Nexus taxonomy** |

The decisive line is a deliberate one, in `hubspot-pull.ts`:

> *"Preserve productTypeId — never auto-set from HubSpot (HubSpot's
> `hs_product_type` enum ≠ nexus `product_types` taxonomy; PM sets manually via
> TypePicker post-pull)."*

`productType` **is** fetched and mapped into the in-memory shape, and then never
reaches a write. The field is carried to the edge of the boundary and dropped.

### The two taxonomies do not correspond

| HubSpot `hs_product_type` (15) | Nexus `product_types` (17: 8 leaf, 9 assembly) |
|---|---|
| Primary · Secondary · Labels · Filling and Packout Services · Soft Goods and Accessories · One Time Charges · Cards, Booklets · Raw ingredients · Freight · Design · R&D / Testing · Third Party Logistics · Finished Goods · Turnkey · Formulation | **leaf:** Primary packaging (PP) · Secondary packaging (SP) · Tertiary packaging (TP) · Soft goods · Component / part · Service / labor · Assembly sub-component · Other<br>**assembly:** Skincare · Body care · Hair care · Color cosmetics · Supplement (oral) · Beverage · Household · Pet care · Other |

They overlap on roughly four leaf concepts and diverge everywhere else. Nexus's
assembly scope has no HubSpot counterpart at all; HubSpot's service and
commercial categories (Freight, Design, One Time Charges, R&D, Logistics,
Turnkey, Finished Goods, Formulation) have no Nexus leaf counterpart. **The
comment's claim is correct** — these are not the same vocabulary, and a naive
mapping would be wrong.

## 4 · Reconciliation

| | |
|---|---|
| HubSpot products | **1,037** |
| …with `hs_product_type` | **1,032** (5 null) |
| Nexus leaves | **1,077** |
| …with `hubspot_product_id` | **1,061** |
| **…with `product_type_id`** | **26** |

**Of the 26 typed leaves, 13 have no HubSpot id at all** — hand-authored smoke
and design fixtures. The remainder were typed manually. **Not one leaf's type
came from HubSpot**, which is what the code says should happen.

**Classification against the four hypotheses:**

- ❌ *HubSpot contains correct types but Nexus loses/mis-maps them* — nothing is
  mis-mapped; the field is never mapped.
- ❌ *HubSpot itself contains missing/inconsistent type data* — it does not.
- ✅ **Nexus has no type data and the Library filters the wrong (empty)
  vocabulary** — both halves are true and they are the same root cause.
- ⚠️ **More than one defect exists** — see §6.

## 5 · Controls, traced by HubSpot product id

| category | HubSpot id | `hs_product_type` | Nexus `product_type_id` | Library shows |
|---|---|---|---|---|
| Primary | `2008191375` PP-0001 | `"Primary"` | **null** | **untyped** |
| Secondary | `1833843360` 22LP-01-SC00 | `"Secondary"` | **null** | **untyped** |
| Soft Goods | `2023909451` BA020900 | `"Soft Goods and Accessories"` | **null** | **untyped** |
| Turnkey | `45055026846` WFG842 | `"Turnkey"` | **null** | **untyped** |
| Finished Goods | `44365128085` Cirqadian-RS | `"Finished Goods"` | **null** | **untyped** |
| Logistics | `2008191385` 3PL-0001 | `"Third Party Logistics"` | **null** | **untyped** |
| Formulation | `2556946721` OTC-0018 | `"Formulation"` | **null** | **untyped** |
| **no type** | `2280799763` (no sku) | **`null`** | **`leaf_secondary_packaging`** | **Secondary packaging (SP)** |

**The last row is the shape of the whole problem, inverted.** The one control
where HubSpot has *no* type is the one where Nexus *shows* a type — because a PM
set it by hand. The two systems' type data are independent, not merely
out of sync.

## 6 · The filter, and a second defect

`typeFilter` is a `product_types.id` and the predicate is
`eq(leaves.productTypeId, filters.typeFilter)`. The chips are built from the
Nexus leaf-scope taxonomy, so selecting **"Primary packaging (PP)"** matches
**14 leaves**, not the 171 products HubSpot classifies as `Primary`.

The filter is **not** comparing against the wrong field — it is internally
consistent. It is filtering a column that is 97.6% null.

**A second, independent defect:** filtering by any type **silently excludes every
untyped product** — 1,051 of 1,077. An operator filtering to "Primary packaging
(PP)" sees 14 results and no indication that a thousand unclassified products
were withheld. The filter's emptiness is invisible, which is why it reads as
*untrustworthy* rather than as *unpopulated*.

## 7 · What is NOT established

- **Whether the deliberate non-mapping is still the right decision.** The comment
  states a real obstacle — the vocabularies differ — but the consequence is a
  filter no operator can rely on. That is a Design Authority question, not an
  engineering one, and I have not pre-judged it.
- **Whether a partial mapping is acceptable.** Four leaf concepts correspond
  closely (Primary, Secondary, Soft Goods, and arguably Labels/Cards → Secondary);
  eleven HubSpot values have no leaf-scope home. Any mapping must decide what
  happens to those, and "Other" is a decision, not a default.
- **Which taxonomy should be authoritative** for the Library filter.

## 8 · Options, for disposition — not recommendations to act on

1. **Map at pull time** into the existing taxonomy, deciding the eleven
   unmapped values explicitly. Reverses the documented decision.
2. **Store HubSpot's value verbatim** in a new column alongside the Nexus
   taxonomy, and filter the Library on it. Keeps both vocabularies truthful and
   does not force a lossy mapping.
3. **Leave ingestion alone and fix only the filter's honesty** — show untyped
   counts, or make "untyped" a selectable filter value, so the emptiness is
   visible rather than silent. Smallest change; does not make the filter useful.
4. **Type the library manually** — 1,051 products through the TypePicker. Not
   plausible at that volume.

**Whatever is chosen, the label/value divergence in §1 must be handled
explicitly**: `Primary Packaging` → `Primary`, `Secondary Packaging` →
`Secondary`, `Logistics` → `Third Party Logistics`. A mapping written from the
HubSpot UI's labels would miss the three largest categories and fail silently.

## 9 · Access boundary

Everything above came from the live HubSpot read token — the properties API for
the vocabulary and the products API for the inventory. **No part of this rests on
Nexus's cached copy**, and the cache does not carry the field at all.

Not established from this runtime: whether any HubSpot workflow, report, or
integration outside Nexus depends on `hs_product_type`. Not required for this
investigation, since nothing is being changed in HubSpot.
