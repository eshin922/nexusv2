# Soak run 03 — W9 sent; not clean

**Release under test: `06ce7c3`** — frozen for the run.
**2026-08-26.**

Fixture built by the walk: `ZZ-SOAK-run-3` / `df092884` → **DPS-1063**, on
ZZ-VALIDATION — UAT Case 5, HubSpot deal `64203121535`. Chosen in run 2
because that deal carried no Sales Order. **It does now.**

## Measurement

```
steps exercised            10  (W1-W9, W11)
  PASS                      9
  FINDING                   1  (W11)
not available               1  (W10 — by canon, see below)
findings                    2
  catastrophic              0
  correctness               2
repeat-territory steps     10
findings in repeat          2
```

**Not a clean run.** W1–W9 were clean; W11 was not, and W10 turned out not to
exist after a completed W9.

## Steps

| Step | Result | Territory |
|---|---|---|
| W1 · project + deal context | PASS | repeat |
| W2 · create scenario | PASS | repeat |
| W3 · Setup — group, products, tier | PASS | repeat |
| W4 · Costs — packaging + production | PASS | repeat |
| W5 · Pricing — clear the floor | PASS | repeat |
| W6 · Commercial Recovery | PASS | repeat |
| W7 · Preview + Finalize | PASS | repeat |
| W8 · Client Review + Acceptance | PASS | repeat |
| W9 · Sales Order — **real sandbox send** | PASS | **first exercise** |
| W10 · Revise | **not available** | — |
| W11 · Copy scenario | **FINDING** | repeat |

## The four steps that carried the repair

**W5 — the repaired solver landed the floor exactly.** Lifts of `0.0190` and
`0.0257`, against run 2's `0.0167` on the same fixture shape. The difference is
the repair: the recovery is no longer liftable, so clearing the floor needs a
larger lift on a smaller basis. Every cell landed at `25.001%` / `25.004%`,
blended `25.001%` against a `25.0%` floor. That is `liftToClear`'s fourth
argument working on production data.

**W6 — placement invariance, re-proven on the real surface.**

```
legacy (no election)   unitSubtotal 16,733.64   otc     0.00   total 16,733.64
elected included       unitSubtotal 16,733.64   otc     0.00   total 16,733.64
elected separate       unitSubtotal 15,053.64   otc 1,680.00   total 16,733.64
```

The recovery moves out of the unit subtotal and onto its own line; the total
does not move. Run 2 measured `-$28.05` on this step. The election persisted on
the first click.

**W7 — the corrected economics froze exactly.**

```
unit_subtotal 15,053.64  +  otc_subtotal 1,680.00  =  16,733.64
lines   Primary - Bottle   2.45069600   12,253.48
        Genexa Box         0.56003200    2,800.16
        Project setup   otc  1,680.00    1,680.00
```

Frozen == previewed to the cent, rates at full precision under a `$2.45`
display.

**W8 — acceptance moved nothing.** Frozen totals byte-identical.
`stage_written false`, `amount_written false`, `suppressed true`; the amount
that would have been written, `16,733.64`, matches the turnkey.

## W9 · the first successful send

`markComplete` created **Sales Order 363141 / SO2725** in the NetSuite sandbox.
Quote `complete`, push `succeeded`, `amount_pushed 16,733.64`.

Read back from the provider:

```
SO2725 · deal 64203121535 · customer 388800 · foreigntotal 16,733.64
  66476  InvtPart      5,000 x 2.450696  =  12,253.48
  1024   InvtPart      5,000 x 0.560032  =   2,800.16
  26348  NonInvtPart       1 x 1,680.00  =   1,680.00
```

The repaired commercial model reached the provider intact: product lines at
full-precision rates, the one-time charge as its **own** line rather than
folded into a unit price or counted twice, and a total matching the frozen
figure exactly.

`netsuite_so_tranid` is populated (`SO2725`) — the human-readable reference the
Pattern 54 finding was about.

**`deal_already_ordered` correctly stayed silent** on the Acceptance and Sales
Order surfaces, because the deal was unconsumed. Repair A's negative case.

## W10 · not available, and correctly so

A completed quote cannot be revised. The surface says so consistently — *"steps
1-4 are reversible … step 5 pushes a NetSuite Sales Order — the only
irreversible act"*, *"Everything left of this line is reversible"*, the quote
marked `frozen`. That is the governed commit point, not a defect.

**The finding is about the WALK, not the product.** The canonical sequence puts
W10 Revise after W9, and no earlier run exposed the contradiction because no
earlier run completed W9. Runs 4+ must either exercise W10/W11 before W9, or on
a scenario that is not the one being completed.

## Findings

### 1 · correctness · wrong state · W11

**A copy of a floor-compliant quote lands below the floor.**

```
source   total 16,733.64   blended 25.001%   BELOW_TARGET   (sendable)
copy     total 16,435.00   blended 23.639%   BELOW_FLOOR    (not sendable)
```

`$298.64` cheaper, and across the compliance boundary. The cause is that
`quote_leaf_lifts` does not clone: the source's two applied lifts (`0.0190`,
`0.0257`) are absent from the copy.

**This is the same defect the just-merged repair C fixed for elections, in the
same place.** `quoteLeafLifts` appears nowhere in `quotes.ts` — not imported,
not cloned, and in none of Cloneable / Reset / Inherited. Against the contract
that governs it:

> a copy is an editable ALTERNATIVE whose initial working commercial state is
> EQUIVALENT to the source … cost / sell / revenue / margin must match at every
> tier. Anything that does not carry must be justified as workflow or history,
> never as an oversight.

Not catastrophic: the copy is a draft, nothing customer-facing was produced. It
is wrong state — an operator copying a compliant quote silently receives a
non-compliant one.

**What DID carry, and is repair C working live:** the election
`project_setup = separate`, matching the source. Run 1's copy carried none.
Structure, tier quantity and cost inputs all carried; lifecycle correctly reset
(draft, no number, no Sales Order, not sent, not accepted).

### 2 · correctness · misleading actionability · W6 · pre-existing

**The Pricing Price Build's turnkey total double-counts the embedded
recovery**, and its own label claims otherwise.

```
Pricing  ORDER RECONCILIATION "reconciles to the customer document"
         Unit-price sell  $3.6827      Turnkey total  $18,413.64
document                  $3.3467                     $16,733.64
```

The gap is exactly the `$1,680` recovery: `Base sell $3.2870` already contains
`Production sell $0.3360` — which IS the recovery — and the ladder then adds
`One-time charges recovered in the unit price +$0.3360` on top.

**Pre-existing, not introduced by the repair.** Run 2's log records the same
disagreement at the same step on the pre-repair release: Pricing `$18,115.00`
against a document total of `$16,734.03`. It was missed then because run 2
compared document-to-document.

The customer document, the frozen snapshot and the NetSuite order all agree at
`16,733.64`. Only the operator-facing Pricing surface disagrees — which is why
it is `misleading actionability` rather than wrong money, and why it did not
stop the run.

## Observations — logged, not classified

1. **Run 1 observation 2 persists** — `$0.00 cost` on one Setup product and
   `— cost` on the other. Third run running.
2. **`customer_contact_snapshot` is NULL** on DPS-1063. This deal has no
   contact association, and blank is the governed answer under the
   explicit-primary rule — recorded so a future run does not read it as a
   regression against run 1's `Jennifer Sevilla`.
3. **The Send-order confirmation modal** is still wider than its content
   (run 1 finding 2, still queued).

## Instrument notes

Three misidentified controls, all mine, none a product defect: a `find` query
matched page-level buttons while the library modal was open; the Revise
affordance I clicked was a *disabled edit* control whose label explains what to
use instead; and `?tab=so` did not switch the sub-tab, which needed the tab
element itself.

The run-2 method correction held: every "nothing happened" was checked against
the accessibility tree or the database before being written down, and none of
the three became a finding.

## State left behind

- **DPS-1063 is `complete`** and carries SO2725. Deal `64203121535` is now
  **consumed** — it can never produce a second Nexus Sales Order.
- `ZZ-SOAK-run-3-copy` (`801be416`) is a below-floor draft, left in place as
  the evidence for finding 1.
- `ZZ-SOAK-run-2` (`b59cb2e3`) remains a draft from the stopped run 2.
- **One clean ZZ-VALIDATION deal remains**: UAT Case 6 (`255652dd`). Run 4 has
  exactly one unconsumed deal left if it is to exercise W9 again.
