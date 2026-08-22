# Organizer read model — proposal

**Status:** proposed, not implemented. Returned for approval per the Deal
Organizer slice direction (2026-08-22).

**Scope:** a per-quote projection supplying three Organizer task kinds —
`pricing_blocked`, `costs_unresolved_quote`, `costs_unresolved_freight`. It is a
**read model only, never commercial authority.** Pricing, SEND and the approval
gates continue to call the existing governed functions and are untouched.

---

## 1 · Why a projection is needed, in one measurement

| | |
|---|---|
| draft quotes across the 21 real projects | 43 |
| `getCostingBundle` | 36.4s (847ms/quote) |
| `loadUnresolvedQuoteCosts` | 8.3s (194ms/quote) |
| **total, live, per home-page load** | **44.8s · ~344 queries · pool max 3** |

The other eight task kinds read columns that are already durable and cost
nothing. Only these three require computation.

---

## 2 · The precedent, and the gap in it

`quote_warnings` is already a persisted per-quote projection recomputed by
`reconcileWarnings({ quoteId })`. Two facts make it the right host:

1. **It already pays the exact cost.** `loadCostingForQuote` — its only input
   loader — *is* `getCostingBundle`. Computing progression and the unresolved
   counts inside the same call adds one `loadUnresolvedQuoteCosts` and no bundle
   read. The expensive work is already being done at these boundaries.

2. **Its coverage is incomplete, and that is measurable.** `reconcileWarnings`
   is called from **2 action files** (`assembly-leaf-inputs.ts`, `freight.ts` —
   4 call sites), while the tables feeding progression and unresolved costs are
   written from **~19 files across 26 tables**.

Riding the precedent unexamined would inherit that gap. Widening the boundary is
therefore the substance of this proposal — not the schema, which is trivial.

This is the failure this codebase has recorded three times: #70 (migration audit
covered queries, missed realtime and publication), #71 (brief categorised by
function name, missed fan-out in the bodies), #73 (audit covered `actions/`,
missed raw SQL in `lib/`). Each was a writer nobody enumerated. **An enumeration
I perform once by hand is the same artefact that failed those three times.** So
the enumeration is not the safety property here — the sweep test in §5 is.

---

## 3 · Schema

```sql
CREATE TABLE quote_organizer_projection (
  quote_id                  uuid PRIMARY KEY
                              REFERENCES quotes(id) ON DELETE CASCADE,

  -- the three projected facts
  pricing_blocked           boolean     NOT NULL,
  blocked_tier_labels       text[]      NOT NULL DEFAULT '{}',
  unresolved_freight_count  integer     NOT NULL,
  unresolved_other_count    integer     NOT NULL,

  -- freshness · see §4
  computed_at               timestamptz NOT NULL DEFAULT now(),
  projection_version        integer     NOT NULL,
  quote_version_number      integer     NOT NULL,
  floor_margin_pct          numeric(5,4) NOT NULL,
  target_margin_pct         numeric(5,4) NOT NULL,
  production_default_present boolean    NOT NULL
);
```

One row per quote, primary-keyed on it. The Organizer reads the whole set for a
page in **one** `WHERE quote_id = ANY($1)` — batch-readable by construction.

`blocked_tier_labels` is stored rather than recomputed because the Organizer
states it to the operator in words ("50k is below the firm's margin floor"), and
re-deriving the label list at read time would need the tier rows anyway.

**No duplicated pricing formula.** The projection stores the *output* of
`evaluateProgression` and `loadUnresolvedQuoteCosts`. Nothing in the table or its
writer computes a margin, a floor comparison, or a readiness rule.

---

## 4 · Freshness — two markers, deliberately different in kind

### 4a · Per-quote: explicit, stamped at write

`computed_at` plus `projection_version` (a constant bumped when the projecting
code changes shape, so a deploy invalidates rows computed by the old logic
rather than silently trusting them) plus `quote_version_number` (a revision
supersedes its predecessor's projection).

### 4b · Firm-policy: DERIVED at read, and therefore unforgettable

A change to `firm_settings.floor_margin_pct` changes the progression verdict of
**every quote at once**, and a missing `markup_defaults` Production row adds an
unresolved configuration row to every quote. Neither is a per-quote write, so
neither can be handled by a per-quote invalidation call — and a global epoch
counter would just be one more thing a future writer can forget to bump.

So the projection **stamps the policy values it was computed under**, and the
Organizer compares them at read time against current firm settings — one cheap
query for the entire page, not per quote:

```
stale_by_policy  ⟺  row.floor_margin_pct          ≠ current.floor_margin_pct
                 ∨  row.target_margin_pct         ≠ current.target_margin_pct
                 ∨  row.production_default_present ≠ current
```

This cannot be forgotten by any writer, because no writer participates in it.
It is a comparison, not a notification.

### 4c · Missing or stale ⇒ **no task**, never a fabricated one

The three projected kinds are emitted only from a row that is present and fresh.
`tasksForQuote` takes the projection as `ProjectedFacts | null`; on `null` it
emits none of the three. A quote whose projection is missing or stale is
**silent**, not "clear".

Silence is the correct degradation because the Organizer's whole claim is that a
task means a real governed unresolved state. Showing "nothing blocking" from a
stale row would be a *claim*; showing nothing is the absence of one. The
surfaces that own these questions — Pricing, and the SEND gate — are unaffected
and still refuse correctly.

The Organizer surfaces coverage honestly rather than hiding it: a project whose
quotes have no fresh projection reads *"cost and margin state not yet
computed"*, not *"no action needed"*.

---

## 5 · Write boundaries and invalidation coverage

### 5a · Where the refresh happens

`refreshOrganizerProjection(quoteId)` runs **inside `reconcileWarnings`**, which
already holds the bundle. Call sites that already call `reconcileWarnings` need
no change at all.

### 5b · The boundaries that must gain it

Derived from the 26 tables the two computations read (`quote-cost-completeness`,
`freight-workbook`, `costing`), then resolved to writers:

| boundary | writes | why it changes the projection |
|---|---|---|
| `assembly-leaf-inputs.ts` | packaging cells/lines | ✅ already reconciles |
| `freight.ts` | legs, groups, tiers, arranges-meta | ✅ already reconciles |
| `freight-worksheet.ts` | subcategories, destinations, breaks, customs, items | **unresolved freight** |
| `costing.ts` | overrides, tier adj, GPA | **progression** |
| `pricing-lifts.ts` | lifts, overrides, tiers, quotes | **progression** |
| `pricing-apply.ts` | tiers | **progression** |
| `assembly-production-inputs.ts` | production cells | **progression** |
| `direct-service-production.ts` | production cells | **progression** |
| `assemblies.ts` | assemblies | structure ⇒ both |
| `product-structure/direct-attachment.ts` | quote_leaves | structure ⇒ both |
| `product-structure/structural-move.ts` | quote_leaves, assembly_leaves, targets | structure ⇒ both |
| `product-structure/grouped-membership-compatibility.ts` | quote_leaves, assembly_leaves | structure ⇒ both |
| `packaging-materialization.ts` | packaging cells | **unresolved packaging** |
| `client-targets.ts` | client targets | progression inputs |
| `other-service-item.ts` | service items | progression inputs |
| `below-floor-authorization.ts` | authorizations | **approval granted ⇒ progression opens** |
| `quotes.ts` | clone/copy fan-out across ~20 of the tables | new quote ⇒ first projection |
| `firm-settings.ts` | floor/target | §4b — derived, no call needed |
| `markup-defaults.ts` | Production default | §4b — derived, no call needed |

`below-floor-authorization.ts` is the one most easily missed: it currently only
calls `revalidatePath`, and granting an approval is precisely the event that
unblocks progression.

### 5c · What actually guarantees coverage

**A registry sweep test**, in the shape that is already working in this
repository — `product-structure-slice1-cutover.test.ts` caught both a probe
script and a *comment* during this slice, which is the behaviour wanted:

> Every file under `src/app/actions/` and `src/lib/` that writes any of the 26
> source tables must either call `refreshOrganizerProjection` (directly or via
> `reconcileWarnings`), or appear in an explicit `classifiedNonInvalidating` set
> with a written reason.

A new writer added in six months fails the build until someone states which it
is. The hand enumeration in §5b is the *starting* contents of that registry, not
the guarantee — the test is the guarantee, and unlike the enumeration it can
express its own failure.

**Rejected alternative — database triggers.** Structurally unforgettable, and
attractive for that reason. Rejected because most of the 26 tables do not carry
`quote_id` (`assembly_leaf_inputs` has `quote_leaf_id`; `freight_destination_
breaks` has `freight_destination_id`), so each trigger needs a join to resolve
the quote — on the hot autosave path, per keystroke-debounced write. The sweep
test buys the same coverage guarantee at build time instead of write time.

---

## 6 · What this does not do

- It does not gate anything. SEND still calls
  `requireBelowFloorAuthorizedToSend`; Pricing still calls `evaluateProgression`
  live. A wrong projection can only mis-populate a queue, never let a quote
  through.
- It does not cache the bundle, the costing result, or any money.
- It adds no writer to any commercial table.

## 7 · Sequencing

1. Migration: the table above (additive; no writer of `quotes` mentions it).
2. `refreshOrganizerProjection` + call inside `reconcileWarnings`.
3. Widen the boundary per §5b.
4. The §5c registry test, landing **with** step 3 so the widening is verified
   rather than asserted.
5. `load.ts` swaps its per-quote pass for one batch read.
6. Backfill: a one-shot script projecting all live drafts, so the Organizer is
   populated on day one rather than filling in as quotes are touched.

Steps 1–5 are reversible; the Organizer degrades to silence on the three kinds
if reverted, per §4c.
