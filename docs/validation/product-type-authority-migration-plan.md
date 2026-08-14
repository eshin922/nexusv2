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

---

## 11 · Checkpoint — HubSpot prerequisite (BLOCKING, 2026-08-14)

Nexus migration steps 3–10 are **blocked**. The `Tertiary Packaging` option is
added through the **HubSpot property UI**, by Edward, not by Nexus.

**No API PATCH.** Updating an enumeration property replaces the entire options
array, so a payload carrying only the new option would delete the other fifteen
and unclassify 1,032 products. The UI performs the read-modify-write; the API
would require Nexus to reconstruct all sixteen options in order, and getting
that wrong is silent and catalogue-wide.

### What is verified after the change, before any migration step

1. `Tertiary Packaging` present in the fetched vocabulary.
2. All **15** existing options still present.
3. Their internal **values** and labels unchanged — the values are what
   `leaves.hubspot_product_type` stores and what the Library filters on, so a
   changed value orphans every row holding it.
4. Classified product counts have not collapsed — compare against the recorded
   census: 1,037 products, 1,032 classified, `Secondary` 346 / `Primary` 171 /
   `Labels` 117 / `Filling and Packout Services` 110 / `Soft Goods` 95 /
   `One Time Charges` 60 / `Cards, Booklets` 51 / `Raw ingredients` 46 /
   `Freight` 11 / `Design` 9 / `R&D / Testing` 6 / `Finished Goods` 4 /
   `Third Party Logistics` 4 / `Turnkey` 2 / `Formulation` 1.
5. A small **human-confirmed** control set classified `Tertiary Packaging`,
   read back through the governed pull, resolving to Tertiary Spec Schema.

### Historical reclassification is NOT a blocker

The architecture needs a handful of unequivocal controls, not a clean
catalogue. Remaining candidates continue as governed data cleanup afterwards.

**The 66-hit name sweep is a discovery aid and must not drive classification.**
It caught shopping bags, tissue, stickers, hang tags and rigid bookstyle boxes
under Secondary; it caught `Art Direction` on the substring `RSC`; it caught
service charges (`OTC - Master Carton`, `OTC - Pallets`, `OTC - Palletization`)
which stay commercial and must never acquire a packaging schema; and it MISSED
the clearest genuine corrugated row in the data — `Master carton · ECT-32 ·
12-up` — because its HubSpot type is NULL. A heuristic that both
over-selects and under-selects is a search, not a classifier.

---

## 12 · Tertiary source-authority prerequisite — CLOSED (2026-08-14)

**Baseline correction recorded: HubSpot `Labels` = 116.** The 117 was a
Nexus-side distribution count carried into a HubSpot baseline by mistake.
HubSpot did not drift.

### Vocabulary gate — PASS

16 persisted options; all 15 originals present with **byte-for-byte unchanged
internal values**, including the three divergent pairs. `Tertiary Packaging`
added. HubSpot's "17 active · 1 with issues" and the blank row were an **unsaved
UI editing placeholder** — nothing blank persists in the property definition.

### Controls reclassified and verified

| | |
|---|---|
| `Corrugated Shipper` · `COR-0001` · `2008073042` | Secondary → **Tertiary Packaging** |
| `Lemme - Corrugated Mailer` · `21897636395` | Secondary → **Tertiary Packaging** |

Single-property PATCH per object — unlike the enumeration definition, an object
update replaces nothing else on the record.

Governed pull: 1,037 processed. Nexus persists the exact authoritative internal
value `Tertiary Packaging` for both. Census moved **only** as predicted:
`Secondary` 346 → **344**, `Tertiary Packaging` 0 → **2**. Every other value
unchanged. No side-effect reclassification.

`Corrugated Insert` and `Corrugated Display` deliberately untouched: corrugated
substrate, but Product Type reflects business role, not material.

### Recorded

**The corrugated-name sweep is candidate DISCOVERY only, never coverage
evidence.** It over-selects (shopping bags, tissue, stickers, hang tags, rigid
boxes; `Art Direction` on the substring `RSC`), it must not touch service
charges carrying carton/pallet terminology, and it MISSES the most textually
perfect Tertiary record in the data — `Master carton · ECT-32 · 12-up` — because
that row has no HubSpot product identity. It is supporting evidence for the
schema's business validity and is **not** an authority-path control.

Only four products across 1,037 carry explicit corrugated naming, so either
little corrugated is quoted through Nexus or corrugated products are named by
client and purpose rather than material. The historical population cannot be
established this way, and remains non-blocking cleanup.

---

## 13 · Step 3 — governed mapping — CLOSED (2026-08-14)

Commit `e98a618`. **A complete additive unit. No existing runtime behaviour
reads this mapping.**

`src/lib/product-structure/spec-schema-mapping.ts` ·
`tests/unit/spec-schema-mapping.test.ts`

### What is established

- Governed Product Type → Spec Schema mapping exists.
- **Primary / Secondary / Tertiary** mappings proven, both Tertiary controls
  resolving against live data.
- **Labels** and **Cards, Booklets** → Secondary proven.
- Service/commercial categories → **explicit `NO_SCHEMA`** proven (11 values).
- Missing Product Type remains **`null` / NO TYPE SET**.
- **Authoritative internal values drive the mapping, never display labels.**
- Divergent labels are explicitly **rejected** as mapping keys — `Primary
  Packaging`, `Secondary Packaging` and `Logistics` each resolve `unmapped`,
  which is the only form of that assertion capable of failing.
- **Exhaustiveness against the fetched authoritative vocabulary is CI-enforced**
  via `specSchemaMappingIsExhaustive`.
- Sandbox-only residue such as `Preliminary` remains **unmapped**, not
  special-cased.

### The three-state contract — DO NOT COLLAPSE

| state | meaning |
|---|---|
| **`schema`** | specifications apply |
| **`no_schema`** | specifications intentionally do not apply |
| **`null`** | authoritative Product Type is missing |

`no_schema` is a finished answer; `null` is missing authority. They must never
render, store, or compare alike.

### `unmapped` — accepted as a runtime result

An unrecognised authoritative value is **returned, not thrown**. Fail-loud
belongs in the CI exhaustiveness check, where a human sees a broken build —
**not** on an operator-facing page. An unmapped authoritative type must **never**
be silently coerced to `NO_SCHEMA`.

---

## 14 · Step 4 boundary — START IN A FRESH SESSION

**Do not combine the destructive cleanup with the additive cutover.**

### Order

1. Add explicit **Spec Schema representation** to the Library/quote-owned
   authority model.
2. At attachment, resolve authoritative HubSpot Product Type through the
   governed mapping and **pin** the resulting Spec Schema into quote-owned B-3
   authority.
3. **Backfill** existing quote-owned authority from authoritative HubSpot
   Product Type.
4. Update quote-context spec **readers/validators** to use the pinned
   quote-owned Spec Schema.
5. Update **Setup display/readiness** so Product Type is always HubSpot
   authority and schema applicability comes from the pinned Spec Schema.
6. Prove falsifications **7–10**.
7. Separate assembly-scope classification naming/semantics as **Item Group
   Category** and prove behaviour unchanged (falsification 11).
8. Retire the independent leaf **TypePicker** / Nexus Product Type write paths
   and prove falsification **12**.
9. **Only after all replacement readers/writers are proven**, return for
   authorization to drop or destructively repurpose `leaves.product_type_id`.

### Required remaining falsifications

| # | claim |
|---|---|
| 7 | Existing quote **retains** pinned Spec Schema after a later HubSpot Product Type change |
| 8 | A **new attachment** after that change receives the newly-resolved schema |
| 9 | Product Library and Setup show the **same** authoritative Product Type |
| 10 | Quote spec **validation** uses the pinned Spec Schema, not mutable HubSpot classification |
| 11 | **Item Group Category** behaviour remains unchanged |
| 12 | **No leaf operator path** can independently assign a second Nexus Product Type after cutover |

### Standing state

PR **#260 remains unmerged**. **Step 5 remains paused.**
**`leaves.product_type_id` remains untouched.**
