# V1 · Customer View content sanity check

**Run:** 2026-08-10, on `r12Visual` — the permanent acceptance fixture, which
carries a persisted lift, a persisted direct price, a quote-wide adjustment and
client targets simultaneously.
**Instrument:** the rendered customer PDF at
`/api/quotes/{id}/customer-pdf`, read as a customer would read it. No new
infrastructure.
**Verdict:** **PASS.** Closed as release evidence.

---

## Consistency with the Pricing state that produced it

The point of the check. Every figure below was read off the PDF and compared
against the Pricing page for the same quote.

| | Pricing | Customer PDF | |
|---|---|---|---|
| Recommended tier | T2 ★ | `Quantity · 10,000 units · recommended` | ✓ |
| Tier quantities | 1,000 · 10,000 · 25,000 · 50,000 | same four | ✓ |
| **Order value · T2** | **$186,797** | **Turnkey total $186,797** | ✓ |
| Quoted sell · unit, per tier | $4.79 · $3.11 · $0.86 · $0.77 | $4.79 · $3.11 · $0.86 · $0.77 `/unit` | ✓ |
| MOQ per-SKU prices | $24.98 · $0.28 · $0.58 · $0.78 · $0.97 · $1.16 | identical | ✓ |
| **The persisted direct price** | Sprayer · T2 `PM-SET` **$12.50** | **$12.50** | ✓ |

The last row is the one worth stating plainly: a price a PM set by hand,
persisted, survives the whole chain and reaches the customer as the quoted
number. So does the applied lift, folded into Cap's prices without announcing
itself.

The turnkey totals reconcile against the per-unit figures at every tier, and the
T2 total matches the Pricing page's `ORDER VALUE · T2` tile exactly — two
surfaces, one number, no separate wiring.

## Customer-visible content

Present and correct: vendor identity and strapline · `PREPARED FOR Acme Beauty`
· `PREPARED BY` with owner, email and address · `TIERED PRICING — Per-unit
pricing across volume tiers` · the recommendation sentence · per-SKU rows with
code sub-labels · extended totals beneath each unit price · `Turnkey total ·
all-in for this tier's order` · the PER UNIT and ALL-IN explanatory lines ·
`PAYMENT TERMS Validation Net 30` · `LEAD TIME Validation 4 weeks` ·
`INCOTERMS Validation FOB` · `How to accept` · page footer and continuation
header.

`Valid until — ` is empty, and correctly: the fixture quote is a **draft** and
`valid_until` is set at send. Not a defect.

Flat-priced SKUs collapse to `—` on the non-MOQ tiers with *"Flat unit across
all volume tiers"* stated once. Intentional treatment, not a missing value.

## Nothing internal crossed the boundary

Read for, and absent from, the customer artifact:

margin · floor · target · cost · markup · client target · `PM-SET` · `LIFTED` ·
supplier · duty · tariff · CBM · provenance · staging state · scenario label ·
version number.

The `PM-SET` badge and the client-target chips are on the Pricing page for the
same quote and appear nowhere in the PDF — the boundary holds on a quote that
carries every one of them at once, which is the case worth testing.

## Limits of this check

- One quote, one fixture. Representative of the state combinations V1 ships,
  not of every commercial shape.
- Read visually rather than parsed. The figures were compared digit by digit
  against the Pricing surface; the prose was read, not spell-checked.
- The two-page layout was verified as rendering; pagination was not stressed
  with a SKU count large enough to force a break mid-table.
