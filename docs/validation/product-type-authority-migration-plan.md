# Product Type authority — migration plan

**Status:** plan only. **No code, no schema change.** Awaiting disposition.
**Date:** 2026-08-14

Target: **Product Type** = HubSpot `hs_product_type` (canonical, operator-facing).
**Spec Schema** = Nexus behaviour, derived. **Item Group Category** = Nexus-only,
for quote-local containers.

---

## 1 · What exists today

| artefact | today | after |
|---|---|---|
| `leaves.product_type_id` | text FK → `product_types`; **null on ~1,051 of 1,077**; operator-authored via TypePicker | **retired** — not read, not written, dropped last |
| `leaves.hubspot_product_type` | raw HubSpot value; **1,039 of 1,066 linked leaves** | **the Product Type**, everywhere |
| `leaf_specs.product_type_id` | quote-owned type (B-3, migration 0071) | **becomes the pinned Spec Schema** |
| `product_types` (18 rows) | 3 leaf rows carry `field_schema`; 6 leaf + 9 assembly carry none | splits: **3 → Spec Schema registry**, **9 assembly → Item Group Category**, **6 empty leaf rows retired** |
| `quote_leaves.leaf_spec_version_id` | B-3 pointer | **unchanged** |

**Readers of `leaves.product_type_id`:** `assembly-tree.ts` (display + readiness),
`leaf-spec-loader.ts` (spec surface), `library-browse-loader.ts` (Nexus type
filter), `addendum-loader.ts` (customer PDF).
**Writers:** `assignLeafProductType`, `changeLeafProductType`, `createLeaf`.
**Assembly-scope writer:** `createAssembly` — different concept, unaffected.

## 2 · Where the mapping lives

**A governed code constant with a test — not a table.**

A table would be a second authority nobody administers: there is no admin
surface for it, so it would drift silently, which is the exact failure this
whole finding is about. Fifteen values, reviewed in a pull request and pinned by
a test, is the honest form. It also fails loudly on an unmapped value rather
than resolving to null.

```
Primary                       → primary
Secondary | Labels | Cards, Booklets → secondary
(Tertiary — see §7)           → tertiary
everything else               → NO SCHEMA  (explicit, not absent)
```

`NO SCHEMA` is a **value**, not a null: "specifications do not apply to this
category" and "we have not decided" must not look identical.

## 3 · Attach-time derivation and pinning

`ensureQuoteSpecAuthority` already runs on every attach and already writes a
quote-owned row. It gains one step: resolve the schema from the leaf's
`hubspot_product_type` through the mapping, and pin the result.

**Pinning is what makes B-3 hold.** A later HubSpot reclassification changes the
Product Type for *future* attachments; an existing quote keeps the schema its
specs were authored under. Without pinning, a HubSpot edit would silently
reinterpret values already entered — the same defect B-3 removed one level up.

**No per-product override.** The only candidate counterexample was bad data
(§6). Building an override for a case never observed would create the second
operator-maintained authority this work exists to remove.

## 4 · Backfill

Recompute every quote-owned row's schema from its leaf's HubSpot type. **141
rows.** Two carry a hand-authored Nexus type that the derivation replaces; both
are corrections, and both are named in §6.

Not a rename-in-place: the column's *meaning* changes from "Nexus Product Type"
to "pinned Spec Schema", so the migration should carry the new name
(`spec_schema` or equivalent) and the plan should say so rather than leave a
column whose name outlives its meaning.

## 5 · Operator-visible semantics

| state | today | after |
|---|---|---|
| HubSpot type present, schema applies | `NO TYPE SET` if Nexus type unset | Product Type shown; spec fields render |
| HubSpot type present, no schema applies | `NO TYPE SET` | **Product Type shown**; spec surface says specifications do not apply |
| **HubSpot type NULL** | `NO TYPE SET` | **`NO TYPE SET`** — the only case it fires |

`NO TYPE SET` stops meaning "nobody ran the TypePicker" and starts meaning
"authoritative classification is missing", which is the invariant. On current
data that is **27 of 1,066** linked leaves, not ~1,051.

## 6 · Data corrections, as part of the migration

- **`75ml Aluminum Wax Stick`** — HubSpot `Primary`, Nexus `tertiary`, zero
  specs authored, schema commercially inapplicable. Corrected by derivation; the
  erroneous assignment is **not** preserved as historical authority.
- **`50ml Plastic Stick (70%PCR)`** — HubSpot **NULL**, hand-typed `secondary`.
  The hand-authored value is **not** carried forward as competing authority; the
  row is flagged for authoritative HubSpot classification and reads `NO TYPE SET`
  until it has one.

## 7 · Tertiary — preserved, source classification OPEN

The schema stays exactly as it is: outer/inner dims, flute, ECT/board, units per
case, pallet config, closure, print. It encodes a real distinction between
corrugated outer-case and ordinary secondary packaging, and collapsing it into
Secondary is the data-quality limitation the firm already has.

**What is missing is the SOURCE classification, not the schema.** HubSpot has no
Tertiary option, so nothing can currently derive to it.

| option | assessment |
|---|---|
| **A · Add `Tertiary Packaging` to HubSpot's `hs_product_type`** | **Preferred.** One option added at source; the vocabulary is already fetched dynamically, so Nexus follows with no code change beyond one mapping line. Products reclassified in HubSpot, where product classification belongs. Cost: a HubSpot property edit and reclassifying the affected corrugated products |
| B · Interim allowlist of leaf ids → tertiary | Rejected unless A is blocked. It is a second operator-maintained authority wearing a different hat |
| C · Ship without Tertiary derivation | Schema preserved but unreachable — Tertiary products would take Secondary, which is the limitation being fixed |

**Recommendation: A, and treat it as a prerequisite rather than a follow-up.**
Migrating first would land every corrugated product on Secondary and then need
re-migrating.

## 8 · Item Group Category

The nine assembly-scope rows classify quote-local containers with no HubSpot
product. Minimum separation is **naming and storage, not behaviour**: move them
out of `product_types` into their own registry (or scope them explicitly) and
rename operator-facing copy to **Item Group Category**. `createAssembly`'s
scope validation is preserved. No assembly behaviour changes.

## 9 · Sequence

1. **HubSpot gains `Tertiary Packaging`** and corrugated products are
   reclassified at source (§7 A).
2. Add the governed mapping + `NO SCHEMA` value, with tests. No behaviour change.
3. Readers switch to HubSpot type for display and to the pinned schema for spec
   fields. `NO TYPE SET` semantics change here.
4. `ensureQuoteSpecAuthority` derives and pins; backfill the 141 rows.
5. Retire the TypePicker and `assignLeafProductType` / `changeLeafProductType`
   for leaves; separate Item Group Category.
6. **Last, and only once nothing reads it:** drop `leaves.product_type_id`.

Steps 2–4 are additive and reversible. Step 6 is the only destructive one and is
deliberately last — per the deployment-order rule, a tightening or destructive
migration needs every deployed reader already gone.

## 10 · What is NOT in this plan

No catalogue hand-typing. No HubSpot → `product_type_id` mapping. No renaming of
the two taxonomies to explain the contradiction. No change to B-3 quote-owned
authority beyond what the schema pin requires. No schema definitions removed.
