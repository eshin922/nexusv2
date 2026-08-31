# BLOCKER — a top-level Direct Product's packaging cost cannot be entered

Found 2026-08-20 building UAT Case 1. Reported, not worked around, and **not**
substituted with a direct DB write.

---

## What happens

On a quote whose only line is a **top-level Direct Product** (no Item Group),
the packaging unit-cost cell accepts no keyboard input. It focuses, it is not
disabled and not `readOnly` — and typed characters never reach `input.value`.

```
click the cost cell   document.activeElement === the input   ✓
                      disabled                               false
                      readOnly                               false
type "1.25"           input.value                            ""      ✗
```

---

## Why this is the product and not the harness

I first diagnosed this as a browser-harness failure and reported it as such.
**That was wrong**, and four controls establish it. Every one of these was run
in the same tab, in the same session, minutes apart:

| control | result |
|---|---|
| vendor search box (`type=search`), same row | accepts `"test"` ✓ |
| tier quantity (`type=number`), Setup surface | accepts `"5000"`, **persists** ✓ |
| **markup cell (`type=number`), SAME ROW as the cost cell** | accepts `"35"` ✓ |
| the cost cell itself | accepts nothing ✗ |

The markup control is the decisive one: same row, same input type, same page,
same click-then-type sequence. One writes and one does not.

A full Chrome restart did not change the behaviour, which is what finally
separated "the instrument is broken" from "this one control is inert".

## And it is specific to the top-level Direct Product shape

The same cell on an Item-Group quote works:

```
quote f84334bd (TEST-LFC5-ASY, has an Item Group)
  packaging cost cell → accepts "9"   ✓
quote cfa7b84d (UAT Case 1, top-level Direct Product, no Item Group)
  packaging cost cell → accepts ""    ✗
```

Probe value reverted; that quote's pre-existing costs (0.5000 / 0.4500) are
untouched and no stray value was left behind.

---

## This is the third instance of one shape

Two were already fixed in this slice, both surfaced by CERT-303 for the same
reason — a governed structure with **no Item Group**:

- `38db86c` — a Direct Service with no Item Group could not author production
- `8ad9b7f` — the Production drilldown crashed on zero Item Groups

This is the packaging half of the same assumption. Every one of them is a
surface that quietly requires an Item Group to exist, on a product model where
a top-level Direct Product is a governed V1 shape.

The SEND gate had the same defect and was fixed in `fab165a` — it counted Item
Groups while claiming to count SKUs. Four instances now.

---

## What it blocks

**UAT Case 1 · Direct Product.** The fixture cannot be priced, so it cannot be
sent, accepted or pushed. Case 6 (mixed structure) carries a Direct Product
beside an Item Group and is likely to hit the same cell.

Case 5 (Tooling / Artwork split) is Item-Group-based and should be unaffected.

## Fixture state, preserved

| | |
|---|---|
| project | `f9d028b7` · deal 64205904726 |
| quote | `cfa7b84d` · draft |
| line | `DPS-BOTTLE-0001` Primary - Bottle, top-level Direct Product |
| tier | Tier 1 · **5,000 units** (entered and persisted) |
| packaging cost | **blocked** |

Nothing needs recreating once the cell is fixed.
