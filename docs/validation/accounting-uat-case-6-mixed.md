# Accounting UAT — Case 6 · Mixed commercial structure

**PASS**, 2026-08-20, against `390b119` (#309 merged).

Fixture: `4781e4bb-0597-4044-a1ea-3ffc8c3be35a` — `ZZ-VALIDATION-pricing-authority`,
project `71ced625`, draft, 4 tiers.

## The fixture is retained, and `10064-GNX-Box` was added ON PURPOSE

**`Genexa - Box - Kids' Cough` (`10064-GNX-Box`) is intentional Case 6 certification
state, not contamination.** It was attached on 2026-08-20 through the governed
operator path — Setup → **+ Add Product** → *"ADDING TO: This quote — as a
standalone product"* — because no draft quote in the estate carried a Direct
PRODUCT beside an Item Group. Every other mixed draft's "direct" is a Direct
SERVICE (`SVC-FORMULATION` here, `SVC-FILLING-BLENDING` on `ff90d502`), and the
three `CERT-MIXED` witnesses are `complete`/`accepted` and therefore draft-locked.

No DB writes were substituted for the operator path at any point.

**Do not detach it to restore the former fixture shape.** The quote is now the
durable Case 6 Mixed certification fixture and carries, deliberately, all three
structures at once: an Item Group, a top-level Direct Service, and a top-level
Direct Product.

## What was proven

| requirement | evidence |
|---|---|
| exactly one new Direct Product | `10064-GNX-Box` |
| top-level canonical ownership, no Item Group relationship | 0 `assembly_leaves` junctions; 4 cost rows; `assembly_leaf_id IS NULL` on all |
| authorable beside the Item Group | cost `3.2500`; category `Secondary`; markup cascaded `0.5000` across 4 tiers |
| debounce holds (no silent rollback) | `0ms 60 300 600 900 1200 1800 2400 3000ms` all `"3.25"` |
| Pricing consumes it | own compliance row — Tier 1 **33.3% / $4.88** (3.25 x 1.50 = 4.875); Tiers 2-4 `NOT PRICED` |
| Item Group members byte-identical | `ZZ-VAL-ASY` `6.45\|3.1018\|4.1000000000000005\|1.85`; members `4.075\|1.6018\|2.7500000000000004\|1.1500000000000001` and `2.375\|1.5\|1.35\|0.7` |
| Direct Service byte-identical | `SVC-FORMULATION` `1.234\|0.469\|0\|0` |
| no ownership crossing | zero packaging rows referencing a structure they do not belong to |

Quote-level movement is **exactly** the new product's own contribution, which is
the strongest form of the "Item Group unchanged" claim — nothing was absorbed:

```
Tier 1 cost     7684    -> 10934    = +3250  = 3.25 x 1000
Tier 1 revenue  10532.6 -> 15407.6  = +4875  = 3.25 x 1.50 x 1000
Tiers 2-4                unchanged  (no cost authored on those tiers)
```

## Harness correction — the first snapshot is NOT valid evidence

`scripts/gate-1b/case6-mixed.ts` originally keyed per-SKU economics on a display
value:

```ts
`${s.skuRole}:${s.skuLabel ?? s.productName ?? ...}`
```

Both grouped leaves carry an **empty-string** `skuLabel`, and `??` falls through
only on `null` — so both collapsed onto the key `leaf:` and one silently
overwrote the other. The harness then printed `leaf: economics byte-identical`
**once** and appeared to cover two leaves while checking one.

- **Canonical `quote_leaves.id` is the required key.** The instrument now keys on
  it; the five entries are unique per leaf.
- **The original snapshot was NOT rewritten to look valid.** It is retained as
  `docs/gate-1b/case6-before.INVALID-collided-keys.json`, and it genuinely lacks
  one grouped leaf's baseline — that data is unrecoverable.
- A corrected baseline is captured at `docs/gate-1b/case6-before.json` for any
  future preservation check on this fixture.
- The byte-identical results above do **not** rest on the invalid snapshot. They
  come from an independent comparison against per-tier contributions captured
  before the attach.

The general lesson is the recurring one: a key that can collide cannot certify
per-item equality, and the failure presents as a PASS.

## Finding — attachment badge does not recognize a Direct Product (5th "Item Group assumed to exist")

In the Library modal, after attaching `10064-GNX-Box` and **on a fresh reopen**,
the row still shows the blue `+` rather than `✓ ATTACHED`. `50ml Plastic Stick
(50% PCR)` on the same quote shows `✓ ATTACHED`.

```
grouped member          -> assembly_leaves junction exists -> UI shows ATTACHED
top-level Direct Product-> no junction BY DESIGN           -> UI still shows +
```

The usage counters DO recognize it (`15 groups · 15 scenarios` -> `16 · 16`), so
one projection sees the attachment and the badge does not. **This is a
display/ownership-projection defect, not an attach failure** — the attach is
proven correct above.

Fifth instance of one assumption, after `38db86c` (Direct Service could not
author production), `8ad9b7f` (Production drilldown crashed on zero Item
Groups), `fab165a` (SEND gate counted Item Groups while claiming SKUs) and
`c7e2760` (#309, packaging writers reached the quote through `assembly_leaves`).

**Not repaired inside Accounting UAT.** It belongs to the systematic
Item-Group-assumption sweep, proposed as its own slice after Case 5.
