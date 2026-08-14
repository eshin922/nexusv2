# B-3 · Product-spec authority — architecture trace

**Status:** investigation. **No code changed.** V1 correctness blocker pending
disposition.
**Date:** 2026-08-13

---

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
