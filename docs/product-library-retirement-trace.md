# Product Library retirement — trace and proposal

**Banked 2026-08-21. Traced, nothing changed.** Returns a proposed retirement
list and mechanism for disposition, as instructed.

## The headline finding

**`archived` is a display flag, not a write boundary.** Measured across all
three paths that attach a library leaf:

```
src/lib/product-structure/direct-attachment.ts               archived refs: 0
src/lib/product-structure/grouped-membership-compatibility.ts archived refs: 0
src/lib/product-structure/structural-move.ts                  archived refs: 0
```

So archiving an item hides it from browse and **still permits attaching it** —
by direct attach, by grouped composition, or by a structural move. Retiring
`OTC - Freight` by archiving alone would look done and would not be. This is
precisely the gap the instruction anticipated.

## "OTC - Freight" does not exist under that name

Worth settling before anything is retired. Every freight-named library item:

| SKU | name | kind | quote_leaves | specs |
|---|---|---|---|---|
| FR-0001 | Domestic Freight | product | 0 | 0 |
| FR-0002 | Air Freight | product | 0 | 0 |
| FR-0003 | Fedex | product | 0 | 0 |
| **FR-0004** | **Ocean Freight** | product | **1** | **1** |
| FR-0005 | UPS | product | 0 | 0 |
| FR-0006 | Trucking | product | 0 | 0 |
| FR-0007 | DDP | product | 0 | 0 |
| OTC-0012 | OTC - Freight, Duties, Tariff | product | 0 | 0 |

The closest match to the reported item is **`OTC-0012 · OTC - Freight, Duties,
Tariff`**, but the `FR-*` family is the larger and more likely target — seven
items that name carriers and freight modes, all of which the Nexus freight
module now governs.

**Which of these you mean is a decision, not an inference**, so no list is acted
on here. My reading is that all eight belong on it, `FR-0004` included.

## Library shape

```
1,087 library items · 36 referenced by any quote · 5 already archived
commercial_kind: product | service   (5 service, 1,082 product)
```

**Every freight item is `commercial_kind = 'product'`**, not `service` — so they
are composable as products today, which is exactly how one could flow
independently through Quote → Pricing → NetSuite.

Only **36 of 1,087** items are referenced at all. Retirement is therefore cheap
for almost everything: 7 of the 8 freight items have zero references and could
be retired with no historical impact whatsoever.

**`FR-0004 Ocean Freight` is the exception** — 1 `quote_leaves` reference and 1
`leaf_specs` row. It must not be hard-deleted, and its existing reference must
keep resolving.

## Other retirement candidates — NOT proposed, flagged for review

The `OTC-*` family is 32 items (`OTC-0001` … `OTC-0032`), **all with zero quote
references**, covering tooling, dies, plates, testing, samples, setup charges,
warehousing, palletization and misc.

Whether these have been superseded is a business question I cannot answer from
the data: several map onto `bv011_destination` values (`otc_tooling`,
`otc_setup`, `otc_testing`, `otc_dies`, `otc_print_plates`, `otc_samples`,
`otc_processing_fee`), which suggests the capability now lives in the governed
destination map rather than in composable library products. **Suggests, not
establishes.** They are listed so the decision is made deliberately rather than
by their absence from a retirement list.

## Proposed mechanism

**A retirement flag distinct from `archived`.** `archived` already means
something — a leaf withdrawn from the library, restorable, and synced against
HubSpot product archival. Overloading it would conflate "withdrawn" with
"governed elsewhere", and the two have different rules: an archived item may
legitimately be restored by a PM; a retired one may not, because the capability
has moved.

```
leaves.retired_at        timestamptz  NULL = composable
leaves.retired_reason    text         why the capability moved
```

**Three enforcement points, and the write boundary is the load-bearing one:**

1. **Write boundary — refuse the attach.** All three attach paths gain the same
   guard, failing closed with a legible message naming the governed module that
   now owns the capability. This is what makes retirement real; the other two
   are convenience.
2. **Browse and search — exclude retired items** from composition surfaces, so
   an operator is not offered something the write boundary will refuse.
3. **Historical resolution — untouched.** Existing `quote_leaves`,
   `assembly_leaves`, `leaf_specs`, frozen snapshots and posted Sales Orders all
   resolve exactly as before. Retirement governs NEW composition only; a
   retirement that altered history would be a data loss dressed as governance.

**No hard delete.** `quote_leaves.leaf_id` is `ON DELETE RESTRICT`, so the
database already refuses to delete a referenced leaf — but the rule is stated
rather than left to the constraint, since 1,051 of 1,087 items are unreferenced
and would delete cleanly.

## NetSuite projection implications

Retirement changes **nothing** downstream, and that is the point:

- Frozen snapshot lines carry `display_sku`, `netsuite_item_id` and their own
  spec rows. They do not resolve through the library at push time.
- A posted Sales Order referencing `FR-0004` keeps its item identity.
- The Order Packet reads frozen state only, so a retired item still renders
  exactly as ordered.

The one thing to confirm before acting: whether any **item-resolution path**
looks a retired SKU up in the library at push time. `frozen-sales-order.ts`
resolves by SKU through `opts.resolveSku` against NetSuite — not against the
Nexus library — so I believe not, but that is worth one explicit check during
implementation rather than an assumption here.

## What I need before implementing

1. **Confirm the retirement list.** All eight freight items, or a subset? My
   proposal is all eight, `FR-0004` included, retired-not-deleted.
2. **Disposition the 32 `OTC-*` items** — retire, keep, or defer as a separate
   review.
3. **Confirm the mechanism** — a dedicated `retired_at` rather than reusing
   `archived`.

## Files

- `src/lib/product-structure/direct-attachment.ts`
- `src/lib/product-structure/grouped-membership-compatibility.ts`
- `src/lib/product-structure/structural-move.ts`
- `src/app/actions/leaves.ts` — archive/restore, and the browse query
