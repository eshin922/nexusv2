# Live Customer View preview — feasibility, map, and parity strategy

**Disposition, Edward 2026-08-24.** Replace the interactive PDF-plugin preview
with a live renderer over the existing `CustomerView` projection. PDF remains
the artifact of record for Download, Freeze & send, and the frozen downstream
record. One projection, two renderers.

**This is the requested pre-work, not an implementation.** Nothing is built.

---

## 0 · The finding that decides the shape — READ FIRST

**The current renderer performs commercial arithmetic.** The hard boundary as
written ("the HTML preview may not calculate pricing … derive fee treatment
independently") cannot be satisfied by adding a second renderer, because the
first one does not satisfy it either.

`src/components/pdf/customer-pdf-helpers.ts`:

```ts
lineTotal(price, tiers, ti)        // price × tiers[ti].quantity
serviceFeesTotal(serviceFees, ti)  // Σ tier_amounts[ti]
tierGrand(skuSet, tiers, ti, foldFees, serviceFees)
  //   total   = Σ(price × qty) + (foldFees ? feesTotal : 0)
  //   perUnit = total ÷ tiers[ti].quantity
  //   hasUnpriced = any null price at this tier
```

Those are the tier totals and the printed per-unit price. They are computed in
the render layer, from projection inputs, at render time.

**This has already produced a customer-facing defect.** The T-1 repair
(2026-08-11) found `perUnit` divided by `pricedCount × quantity` — a row
cardinality — printing `$4.00` where `$12.00` was owed. It read correctly only
at one priced row, which is why it survived. That is what arithmetic in a
renderer costs.

### The consequence for this slice

Three options, and only one is clean:

| | outcome |
|---|---|
| HTML re-implements the math | **Two authorities.** Forbidden by the disposition, and the exact failure this estate keeps removing. |
| HTML imports the same helpers | One implementation, but the boundary is still false for both, and "parity" would mean two renderers agreeing because they share a subroutine — not because they render one projection. |
| **Lift the arithmetic into the projection** | `CustomerView` carries the derived figures; both renderers only format. Parity becomes structural rather than tested-for. |

**Recommended precondition:** move `lineTotal` / `serviceFeesTotal` /
`tierGrand` out of the renderer and into the projection, so `CustomerView`
carries per-tier line totals, tier totals, per-unit, and the unpriced flag as
resolved values.

This is a small, self-contained change with a real safety argument — it removes
the layer where T-1 happened — and it makes the rest of the slice
straightforward. Doing the HTML renderer *first* and lifting the math later
means shipping the second renderer across the boundary the slice exists to
protect.

---

## 1 · Component / data-source map

Today: `CustomerView` → `customerViewToCpdf()` → `CpdfDoc` → react-pdf tree.

**Proposed: the HTML renderer consumes the same `CpdfDoc`,** through the same
adapter. Not `CustomerView` directly — using one shape for both renderers means
parity is about formatting only, and any adapter change reaches both at once.

| block | PDF component | reads from `CpdfDoc` |
|---|---|---|
| masthead | `customer-pdf-masthead` | `vendor`, `quote.number`, `quote.issuedDate`, `quote.validUntil` |
| parties | `customer-pdf-parties` | `customer`, `preparedBy` |
| pricing table | `customer-pdf-pricing-table` | `skus[].{label,name,pack,tier_prices}`, `tiers[].{label,quantity,recommended}` |
| pricing foot | `customer-pdf-pricing-foot` | tier totals, per-unit *(§0 — currently computed)* |
| turnkey summary | `customer-pdf-turnkey-summary` | same, folded shape |
| grand total | `customer-pdf-grand-total-row` | tier total, per-unit, freight disclosure |
| charges | `customer-pdf-charges-block` | `serviceFees[].{label,sub,qty_label,tier_amounts}` |
| terms | `customer-pdf-terms-block` | `terms.*`, notes, How-to-accept |
| addendum | `customer-pdf-addendum` | `addendum` + `includeSpecAddendum` |
| chrome | `customer-pdf-chrome` | `vendor`, `quote` (runhead, footer) |

Axes that select between shapes — `pdfLayout`, `detailLevel`,
`includeSpecAddendum`, `recommendedTierIdx` — are already fields on the
projection. The HTML renderer reads them; it decides none of them.

---

## 2 · Parity strategy

**Compare at the projection boundary, never at two reconstructed inputs.**

One `CpdfDoc` fixture set → render both ways → compare extracted content.

- **PDF side:** the existing decode path — inflate streams, decode the drawn
  runs through their ToUnicode CMaps. Already written and proven this session
  against production artifacts.
- **HTML side:** render to string, strip tags, normalise whitespace.
- **Compare:** the ordered list of `(label, qty label, amount)` triples, plus
  tier headers, totals, per-unit values, terms, notes, and addendum presence.

Covering the disposition's list: tier quantities · unit prices · tier totals ·
recommended tier · one-time fee lines · in-unit/separate/absorbed treatment ·
terms · notes · addendum state · customer-facing labels · folded vs itemized.

**Fixture matrix**, because a single fixture proves the least: `{itemized,
turnkey} × {tier_table, single_tier} × {addendum on, off}` × a recovery set
exercising all three treatments including a charge placed more than one way,
plus one unpriced cell (`quote_on_request`) and one absorbed charge.

**One caution learned this session:** a filter that cannot express a failure
reports none. The comparison must fail loudly when either side yields zero
lines — a parity test that finds nothing on both sides passes vacuously, which
is precisely how the glyph certifier first reported green.

---

## 3 · Proving no commercial arithmetic in the renderer

A prebuild verifier, in the family of `verify:boundaries` and
`verify:autosave-focus-stability`:

- **Scope:** the HTML renderer subtree.
- **Forbid:** imports of `@/lib/costing*`, `@/lib/commercial-*`, the recovery
  registry, `getCostingBundle`, db, and schema — the existing forward-sweep
  list, which already exists and is already enforced for the PDF tree.
- **Forbid additionally:** arithmetic operators on projection values, and
  `reduce(` over any `tier_*` or `*_amounts` array.

The operator ban is deliberately blunt and will need an allowlist for
presentation-only arithmetic (column widths, page counts). That is acceptable:
a blunt rule with named exceptions is auditable, and the alternative — trusting
review — is what let `tierGrand` sit in the render layer for three slices.

Pattern 51 applies: the *composition seam* (the adapter) legitimately reads
privileged sources and is excluded by design. The ban is on the render tree.

---

## 4 · Production measurement, before

Measured on `4781e4bb`, deployed build, this session:

| stage | median | worst |
|---|---|---|
| server action (write + revalidate + re-render) | 452ms | 691ms |
| client apply → authoritative rows | 1062ms | 1532ms |
| **Card 1 authoritative settle** | **1614ms** | **2223ms** |
| PDF route render | 1904ms | 2627ms |
| visible blank/black during swap | **seconds** | — |

**After** should show the PDF row leaving the interaction entirely and the
blank row going to zero, with the Card 1 settle unchanged — it is a separate
path and a separate blocker, and this slice must not be credited with fixing
it.

---

## 5 · Recommendation

Feasible and worth doing, in this order:

1. **Lift the arithmetic into the projection** (§0). Precondition, not
   optional — without it the boundary the slice exists to enforce is false on
   arrival.
2. Parity harness over the fixture matrix, against the *current* PDF renderer,
   so it is green before anything changes.
3. HTML renderer over `CpdfDoc`; parity harness must stay green.
4. Swap the preview; PDF stays on Download / Freeze & send.
5. Re-measure and compare against §4.

**Not in this slice**, per the scope discipline: G4, Card 3, Freeze & send
wiring, lifecycle changes.

**One open item to settle before step 1:** the two unmerged preview commits
(`07eb406` bytes-first, `9ee1a62` the generation guard). They improve the
current surface materially and are independent of this slice, but they are work
on a preview this slice retires. Worth deploying only if step 1–4 is more than
a few days out.
