# B-3 · Product-spec authority — architecture trace

**Status:** investigation. **No code changed.** V1 correctness blocker pending
disposition.
**Date:** 2026-08-13

---

> **AMENDED 2026-08-13.** The business rule is now stronger: specifications are
> quote-specific from the moment of attachment, and no quote may share a mutable
> spec authority with the Library or another quote. **The shared-pin /
> reference-counted copy-on-write model in §5 below is WITHDRAWN.** The trace
> and the evidence stand; the proposed mechanism does not. See "B-3 amended"
> at the foot of this document.

## Verdict, before the evidence

**Every structure the invariant needs already exists and none of it is used.**
`leaf_specs` is a version table. `quote_leaves.leaf_spec_version_id` is the
per-quote pointer at it. No row has ever been versioned and no pointer has ever
been set. The proposal is therefore not new machinery — it is **moving the pin
from a send-time event that was never implemented to attach time, and making the
readers honour it.**

**The exposure is live.** 23 library products are attached to more than one
quote; **22 of those span more than one DRAFT quote**. For each, a spec edit made
in one draft silently rewrites what another draft was built against — exactly
the case the business decision names.

## 1 · `leaf_specs` and how versions are created

```
leaf_specs(id, leaf_id → leaves, spec_values jsonb, version_number,
           is_current, effective_from, effective_to, created_by, updated_by)
  uniqueIndex leaf_specs_current_idx ON (leaf_id) WHERE is_current = true
  index       leaf_specs_leaf_version_idx ON (leaf_id, version_number)
```

Designed semantics (schema comment): first entry → v1 `is_current`; **edits
between pin events UPDATE the current row in place, no version bump**; at a pin
event, close the current row and insert a bumped version.

Actual behaviour — `updateLeafSpec`:

- no current row → INSERT v1, `is_current = true`
- current row exists → **UPDATE in place** via `jsonb_set` / `-`. No version
  bump, ever.

The bump half is written down and not implemented. Live data confirms it:

| | |
|---|---|
| `leaf_specs` rows | **3** |
| leaves with any spec | **3** of 1,077 |
| `is_current = true` | 3 |
| **historical (`is_current = false`)** | **0** |
| **max `version_number`** | **1** |

**No version has ever been superseded.** The partial unique index has never had
anything to exclude.

## 2 · `quote_leaves.leaf_spec_version_id`

Declared as a nullable FK to `leaf_specs.id`, deliberately **without an FK
action** so a pinned version survives ceasing to be current. Its sibling
`pinned_at` records when. There is an index for *"where is this spec version
pinned?"* (`quote_leaves_leaf_version_idx`).

The intent is stated in the schema comment:

> *"references the specific leaf_specs row pinned at send time; NULL for draft
> quotes (drafts auto-update; sent quotes stay pinned)."*

That is a coherent model **for a catalogue of generic products**. It is the wrong
model for custom work, which is what the business decision now says.

## 3 · When it is populated today, and why it waits

**It is never populated. It does not wait — it never happens.**

- No writer anywhere sets `leafSpecVersionId`. Grep across
  `src/app/actions/**` and `src/lib/**` returns the schema file only.
- The `leaf_spec_version_pin` audit action exists **only in a schema comment**.
- **0 of 169** attachments carry a pin, across 34 quotes including sent,
  accepted and complete ones.

**No reader consults it either.** All four `leaf_specs` readers filter
`is_current = true`:

| reader | consequence |
|---|---|
| `assembly-tree.ts:232` | Setup tree spec completeness reads live library spec |
| `leaf-spec-loader.ts:101` | the spec entry surface edits the live library spec |
| **`addendum-loader.ts:136`** | **the customer PDF spec addendum renders the live library spec** |
| `leaf-specs.ts:118` | the writer's own read-before-write |

So the send-time protection the earlier B-3 disposition relied on does not
exist — for drafts *or* for sent quotes. The delivered PDF is stable only
because Slice 11 Step 6 persists `pdf_url`; any live re-render drifts.

**There is nothing to migrate away from.** The pinning boundary has no
implemented position to move it from.

## 4 · Can attachment pin without copying data or creating a second authority?

**Yes, and it is one assignment per attach writer.**

`leaf_spec_version_id` is a foreign key. Pinning at attach means storing the id
of the leaf's existing current `leaf_specs` row — **no `spec_values` are
copied**, no row is created, and `leaf_specs` remains the single authority. Two
quotes on the same version share one row and read identical values.

Attach writers to touch: `direct-attachment.ts` (Direct Product) and
`attachGroupedMembership` (Item Group member). Both already run inside a
transaction that inserts the `quote_leaves` row.

## 5 · Quote-local edit without disturbing other quotes — copy-on-write

The mechanism the version table was built for, and has never performed.

On a quote-side spec edit, target row = this quote's pinned version.

- **Pinned version is used by this quote only, and is not the library
  current** → UPDATE in place. Nothing else can observe it.
- **Pinned version is shared** — referenced by another `quote_leaves` row, or it
  is the `is_current` library row → **INSERT a new `leaf_specs` row**
  (`version_number = max + 1`, **`is_current = false`**, `spec_values` copied
  from the pinned row), apply the edit to it, and repoint **only this quote's**
  `leaf_spec_version_id`.

`is_current = false` on the new row is load-bearing twice: the partial unique
index permits only one current row per leaf, and one quote customising must not
change the library's default for everyone else.

The spec surface already has what it needs — its URL is
`/projects/:id/quotes/:quoteId/leaves/:leafId/specs`, so the quote is in scope.
`loadLeafForSpecEntry(leafId)` currently discards it.

## 6 · Deliberate library/master edit → new default for future uses

INSERT a new row with `is_current = true`, closing the prior
(`effective_to = now()`, `is_current = false`). Future attachments pin the new
current; existing quotes keep pointing at their own version and **never float**.

**No library-side spec surface exists today** — the only spec editor is the
quote-scoped route. So this is a reserved position in the model, not V1 work.
Worth stating plainly so it is not later mistaken for a gap.

## 7 · A product with no spec, attached and configured for the first time

`leaf_spec_version_id` stays NULL at attach (nothing to point at). The first
quote-side edit creates v1.

**One genuine product question:** does that first-ever spec become the library
default (`is_current = true`, and the quote pins it) or private to the quote?
Recommend **library default** — the product had no specification, and the first
one authored is the best available starting point for the next use. Divergence
then happens by copy-on-write per §5. This is the only decision in the proposal
that is not forced by the evidence.

## 8 · Generic and client-specific in one model

**Yes, with no product typing.** The distinction is emergent, not declared:

- a generic product's quotes stay on the shared current version — no copies, no
  divergence, one row read by many quotes;
- a client-specific product diverges at its first quote-side edit and each quote
  holds its own version.

Adding a generic/client-specific flag would require the operator to classify a
product **before** knowing whether it will be customised, and would be wrong the
moment a "generic" product needs one bespoke variant. Not required.

## Proposed minimal migration

**No new tables. No new columns. No data copy at attach.**

| # | change | files |
|---|---|---|
| 1 | Pin at attach: set `leaf_spec_version_id` to the leaf's current spec id when one exists | `direct-attachment.ts`, `attachGroupedMembership` |
| 2 | Copy-on-write on quote-side edit per §5 | `leaf-specs.ts` (`updateLeafSpec`) |
| 3 | **Resolve reads through the pin**, falling back to current when NULL | `leaf-spec-loader.ts`, `assembly-tree.ts`, **`addendum-loader.ts`** |
| 4 | Thread `quoteId` into `loadLeafForSpecEntry` | spec route already has it in the URL |
| 5 | Backfill existing attachments | one migration |

**Step 3 is the one that must not be skipped.** Pinning without changing the
readers writes a pointer nobody consults — which is precisely the defect that
exists today, reproduced one layer up.

**The backfill is lossless, and provably so.** 169 attachments, all NULL. Set
each to its leaf's current spec id where one exists. Because **no version has
ever been superseded** (0 historical rows, max version 1), the current row is
the only row that has ever existed for each of the 3 specced leaves — so pinning
to current is exact rather than an approximation of history.

Deployment order: the migration is additive (populating a nullable column), so
it may precede the code per the compatibility rule.

## Two adjacent exposures — named, not proposed

1. **`changeLeafProductType` discards spec values** and is library-scoped. Under
   this model it must obey the same copy-on-write rule, or changing a type from
   one quote wipes another quote's specification.
2. **`leaves.product_type_id` is library-level.** Changing the product type from
   inside a quote changes it for every quote. Same family; out of scope here.

## What this does not address

The invariant governs **specifications**. It does not govern `leaves.unit_cost`,
name, SKU, or archived state, which remain library-level and shared. If the
business needs those frozen per quote too, that is a separate and much larger
question — and the cost path already has its own per-quote authority in
`assembly_leaf_inputs`.

---

# B-3 amended · quote-owned spec authority — schema answer

**Amends the model above.** Shared-pin / reference-counted copy-on-write is
withdrawn. **No implementation.**

## The schema question, answered

> *Can `leaf_specs` cleanly represent both Library-current/default versions and
> quote-owned non-current spec instances without making `version_number`,
> `is_current`, effective dates, or lineage semantics ambiguous?*

**Not as it stands — no. Three of the four named columns become ambiguous, and
ownership is unrepresentable.** But the ambiguity has a single cause, and fixing
that cause resolves all of them at once. **The table can be reused; it needs
scope, not replacement.**

### Why it is ambiguous as-is

| column | today's meaning | under the new rule |
|---|---|---|
| `version_number` | position in a leaf's linear library lineage | quote-owned rows are **not a lineage** — they are siblings. Two quotes attaching the same leaf the same day would take v2 and v3, implying a succession that never happened |
| `is_current` | "this is the Library default" | quote-owned rows would all be `false`, conflating **dead history** (a superseded library version) with **the live authority for a quote**. Opposite meanings, one value |
| `effective_from` / `effective_to` | the interval a library default governed | a quote-owned row succeeds nothing and is succeeded by nothing. `effective_to` NULL forever on ~141 rows makes "open interval" meaningless |
| lineage / ownership | — | **no column expresses which quote owns a row, or which library version it was templated from.** Ownership would only be inferable by reverse-lookup from `quote_leaves`, which cannot distinguish an orphan from a library version |

The common cause: **every one of those columns is scoped to "this leaf's library
timeline", and the new model introduces a second scope the table cannot name.**

### The smallest explicit model

Give the table the scope it is missing. **One nullable discriminator plus one
lineage pointer — no new table, and the existing `quote_leaves` pointer is
unchanged.**

```sql
ALTER TABLE leaf_specs
  ADD COLUMN quote_id uuid REFERENCES quotes(id) ON DELETE CASCADE,
  ADD COLUMN templated_from_spec_id uuid REFERENCES leaf_specs(id);

-- One quote-owned spec per (quote, leaf). This IS rule 6, enforced by
-- construction rather than by convention: two attachments of the same SKU in
-- one quote cannot reach different authorities because only one can exist.
CREATE UNIQUE INDEX leaf_specs_quote_owned_idx
  ON leaf_specs (quote_id, leaf_id) WHERE quote_id IS NOT NULL;

-- Tighten the existing library-current index so a quote-owned row can never
-- claim to be the Library default.
DROP INDEX leaf_specs_current_idx;
CREATE UNIQUE INDEX leaf_specs_current_idx
  ON leaf_specs (leaf_id) WHERE quote_id IS NULL AND is_current = true;
```

`quote_id IS NULL` = Library master/template. `quote_id IS NOT NULL` =
quote-owned instance.

**With scope explicit, every previously-ambiguous column becomes well-defined —
it means the same thing *within its own scope*:**

| column | library row (`quote_id IS NULL`) | quote-owned row |
|---|---|---|
| `version_number` | position in the library lineage | revision counter within this (quote, leaf); starts at 1 |
| `is_current` | is the Library default | is this quote's live spec — **true**, since only one exists per (quote, leaf) |
| `effective_from/to` | interval this default governed | interval this quote revision governed, if quote-side revisions are ever versioned |
| `templated_from_spec_id` | NULL | the library version this instance was copied from — provenance without stuffing it into `spec_values` |

Nothing is overloaded, because nothing is asked to mean two things at once.

**Why not a separate `quote_leaf_specs` table.** It would duplicate
`spec_values`, `version_number`, the timestamps and the audit columns, force
every reader to branch on which table to query, and require `quote_leaves
.leaf_spec_version_id` to become a polymorphic pointer with no FK — losing the
referential integrity the column has today. A discriminator on one table keeps a
single FK, a single reader shape, and one place where spec values live.

## The amended lifecycle

| rule | mechanism |
|---|---|
| 1 · attach with a library default | INSERT quote-owned row, `spec_values` copied from the library-current row, `templated_from_spec_id` set; point `quote_leaves.leaf_spec_version_id` at it. **The quote never points at the mutable library row** |
| 2 · attach with no default | INSERT quote-owned row with `spec_values = '{}'`, `templated_from_spec_id = NULL`; point at it. **Never NULL, so never floating** |
| 3 · quote-side edit | UPDATE the quote's own row in place. **No reference counting** — exclusivity is guaranteed by `leaf_specs_quote_owned_idx`, so no other quote can observe it |
| 4 · library master | unchanged rows, still the template for future attachments. No new master surface in V1 |
| 5 · readers | resolve through `leaf_spec_version_id`. **The `is_current` fallback is deleted, not deprioritised** — with rules 1-2 an attached leaf always has a pointer, so a fallback could only ever mask a bug |
| 6 · same product twice in a quote | structural: one row per (quote, leaf) |

Rule 5 is the assertable one: **no quote-context reader may reference
`isCurrent` at all.** That is a grep, and unlike the current situation it can
fail.

## Backfill

| | |
|---|---|
| attachments to repoint | **169** |
| quote-owned rows to create | **141** distinct (quote_id, leaf_id) |
| of those, with a library template available | **27** attachments' leaves have a current spec |
| the rest | instantiate empty, per rule 2 |

Lossless, and provably: **0 historical rows exist and max `version_number` is
1**, so the current library row is the only row that has ever existed for a
specced leaf. Copying it is exact, not a reconstruction.

Sent, accepted and complete quotes are included — after migration **no
attachment depends on a mutable library row**, which is rule 7 and also closes
the customer-PDF addendum exposure recorded above.

**Migration-impact check done, per the referencing-table rule:** `quote_leaves`
is the only table referencing `leaf_specs`; there are **no triggers** on
`leaf_specs` or on `quote_leaves`. The DDL is additive (two nullable columns);
the index tightening is the only non-additive step and it strictly narrows a
partial predicate over rows that all satisfy `quote_id IS NULL` at that moment.

## Adjacent · `leaves.product_type_id`

**Recommendation: quote-specific, carried on the quote-owned spec row** — one
more nullable column in the same migration.

The reason is not symmetry. **The product type IS the schema that gives
`spec_values` meaning**: field keys are validated against
`product_types.field_schema`, and `changeLeafProductType` discards values on
change. Pinning the values while leaving the schema library-mutable reproduces
the same defect one level down — a library type change would silently
invalidate, or empty, every quote's pinned specification, and those quotes would
have no record of the schema their values were authored under.

```sql
ALTER TABLE leaf_specs ADD COLUMN product_type_id uuid REFERENCES product_types(id);
```

Library rows: NULL, deferring to `leaves.product_type_id`. Quote-owned rows: the
type in force when the instance was created. `leaves.product_type_id` remains
the default for future attachments, and a quote-side type change writes the
quote's own row.

**The alternative — restrict type changes to an explicit Library-master
action —** is smaller and leaves the hole open: any legitimate library type
change still invalidates existing quotes' pinned values, and nothing records
what they were authored against. It also needs a master surface that rule 4 says
V1 does not have, so in practice it would mean *no one can change a product
type*, which is not a V1 posture anyone chose.

## What is still not addressed

`leaves.unit_cost`, name, SKU and archived state remain library-level and
shared. The cost path already has its own per-quote authority in
`assembly_leaf_inputs`, so cost is not exposed the way specs were. Naming this
so the boundary of the fix is explicit rather than assumed.
