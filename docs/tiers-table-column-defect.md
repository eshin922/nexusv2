# Tiers table — quantity renders under TIER, QTY shows an em-dash

**Banked 2026-08-21. Recorded, not repaired**, and deliberately kept out of the
enrollment-governance work (#336).

## Reported

On the Tiers table, **tier quantities render under the TIER heading while the
QTY column shows `—`**. Expected: tier identity under TIER, formatted quantity
under QTY.

## What the trace establishes

The surface is `src/app/projects/[id]/quotes/[quoteId]/page.tsx` — it is the
**only** file in the tree pairing a `Tier` and a `Qty` header, so the defect is
in the Setup tiers table rather than a sibling table elsewhere.

**There is a real column-count inconsistency there, already acknowledged in a
code comment:**

```css
/* r7b-setup.css:355,364 — BOTH the header and the row */
.r7b-tier-thead { grid-template-columns: 1fr 100px 90px 28px; }  /* 4 columns */
.r7b-tier-row   { grid-template-columns: 1fr 100px 90px 28px; }  /* 4 columns */
```

```tsx
// page.tsx:331 — the header emits THREE cells into a FOUR-column grid
<div className="r7b-tier-thead">
  <span>Tier</span>
  <span className="num">Qty</span>
  <span></span>
</div>
```

The in-repo comment above it says as much:

> *"The Price adj column went with its input … The header outlived the cell by
> one commit, which left the actions column rendering in the adjustment's slot."*

So the grid still reserves a 90px column for a per-tier price adjustment that
was moved to Pricing, and both header and row are one cell short of the track
count they declare.

## What the trace does NOT establish

**This inconsistency alone does not obviously produce the reported symptom.**
With three cells in a four-track grid, `Tier` still lands over the label cell and
`Qty` over the qty cell — the surplus track falls at the end. That misplaces the
delete affordance, not the quantity.

So there is at least one competing explanation, and it should be settled by
looking at the affected quote rather than by reasoning:

1. **Layout** — a further cell-count difference between header and row on the
   affected surface (for example a conditional cell that renders for some quotes
   and not others), shifting values one track left.
2. **Data** — the tier rows carry the quantity in `label` with `qty` NULL. The
   Setup table renders `label` and `qty` as separate inputs, and a NULL `qty`
   presents as empty. Tiers created with the number typed into the label field
   would look exactly like the report.

These have different repairs — the first is a JSX/CSS fix, the second is a data
correction plus possibly an input-affordance change — so guessing between them
would risk "fixing" the wrong one and leaving the defect.

## What settles it

The quote id showing the symptom, and either a screenshot of the rendered row or
its `quote_tiers` values:

```sql
select id, label, qty, sort_order from quote_tiers where quote_id = '<id>' order by sort_order;
```

`label` holding digits with `qty` NULL confirms explanation 2; populated `qty`
values confirms explanation 1.

## Regardless of cause

**The stale fourth grid track should go.** The price-adjustment column has no
input behind it since that authoring moved to Pricing, and a reserved 90px track
for a cell nobody renders is how the header and row drifted apart in the first
place. That cleanup is worth doing whether or not it turns out to be the cause.

## Cross-references

- `src/styles/r7b-setup.css:355,364` — the four-track grid.
- `src/app/projects/[id]/quotes/[quoteId]/page.tsx:325-334` — the three-cell
  header and the comment recording the drift.
- `src/app/projects/[id]/quotes/[quoteId]/tier-row.tsx` — the row cells.
