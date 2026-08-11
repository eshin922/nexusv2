# Costs → customer-quote translation parity

**Scope: Production and Freight governed inputs, traced to the customer-facing
quote.** Separate from `so-field-parity-matrix.md` (Nexus → NetSuite Sales
Order). Both carry into final V1 certification.

**Status: OPEN. T-1 confirmed as a HIGH V1 blocker and REPAIRED (2026-08-11).
Production/Freight trace incomplete.**

---

## §0 · Why final-total equality is not evidence

The governing instruction (Edward, 2026-08-11):

> Do not accept final-total equality as sufficient evidence.

T-1 below is the proof of that instruction. The turnkey total on the
customer PDF is **correct** ($12,000). The per-unit price printed directly
beneath it is **wrong** ($4.00 where $12.00 is owed) — understated by exactly
the number of priced SKU rows. Any reconciliation that stopped at the total
would have passed this quote.

The failure modes this matrix tests for, per instruction:

| | |
|---|---|
| silent omission | a governed input reaches no customer-facing surface and nothing says so |
| double counting | one input lands in two customer-facing figures |
| wrong markup basis | markup applied to the wrong cost base, or twice |
| wrong tier propagation | a per-tier input renders under the wrong tier, or a single value fans across all |
| wrong label | the figure is right; the words describing it are not |
| **wrong commercial basis** | the figure is arithmetically produced but answers a different question than its label claims — **T-1** |

The last is the hardest to see and the easiest to ship. It requires comparing
the rendered number against **the stated definition of that number**, not
against another number in the same document.

---

## §1 · Record shape (per governed input)

1. operator-facing source field
2. persisted / governed authority (table.column)
3. engine node / calculation consuming it
4. tier behavior
5. customer-facing representation — explicit line / rolled into another line /
   bundled into turnkey / intentionally omitted
6. actual value on the generated Customer View / PDF
7. classification — parity · intentional aggregation · business disposition
   required · **V1 defect**

**Where a value is intentionally bundled rather than separately displayed,
cite the governing quote/presentation contract.** Bundling is not
self-justifying: the absence of a line is only evidence of a decision if a
decision is on record. An uncited bundle is classified *business disposition
required*, not *intentional aggregation*.

---

## §2 · Findings

### T-1 · Customer-facing per-unit price divides by SKU count · **V1 DEFECT**

**Severity: HIGH.** Customer-facing, both presentations, silent, and it
contradicts the document's own printed definition of the field.

**Location.** `src/components/pdf/customer-pdf-helpers.ts:100`

```ts
const total = priced + (foldFees ? serviceFeesTotal(serviceFees) : 0);
const units = pricedCount * tiers[ti].quantity;   // <-- pricedCount is a ROW COUNT
const perUnit = units > 0 ? total / units : null;
```

`pricedCount` is incremented once per priced SKU row (line 96). It is a
cardinality, not a quantity. Multiplying tier quantity by it produces a
denominator with no commercial meaning.

**The document states the intended basis verbatim.** From
`customer-pdf-grand-total-row.tsx:121-123`, printed on the customer PDF:

> **PER UNIT** — The blended all-in unit price across the basket at that
> tier — the turnkey total divided by units shipped.

Units shipped is `tiers[ti].quantity`. The code divides by
`pricedCount × quantity`. **The PDF contradicts its own printed definition.**

**Blast radius — all three customer-facing per-unit surfaces**, because all
three consume `tierGrand`:

| surface | file:line | presentation |
|---|---|---|
| itemized grand-total row | `customer-pdf-grand-total-row.tsx:53` | `itemized` |
| turnkey hero price | `customer-pdf-turnkey-summary.tsx:114` → rendered `:153` | `turnkey_only` |
| turnkey per-tier cards | `customer-pdf-turnkey-summary.tsx:175` → rendered `:227` | `turnkey_only` |

**Error magnitude is the priced-SKU-row count `N`.** The printed per-unit is
`1/N` of the true value. It is correct **only when `N = 1`** — which is why it
has survived: a single-product quote renders correctly and looks like
confirmation.

**Observed instance** — Nemah `OD-004 Case B Validation`, quote `f544128a`,
`turnkey_only`, tier 1 @ 1,000 units, 3 priced leaf rows:

| | |
|---|---|
| Total (correct) | **$12,000** |
| True per-unit | $12,000 ÷ 1,000 = **$12.00** |
| Printed per-unit | **$4.00** ← `$12,000 ÷ (3 × 1,000)` |
| Understatement | **3×**, equal to the priced-row count |

Independently corroborated: the three leaf sell prices are $4.00 / $6.00 /
$2.00; their **arithmetic mean is $4.00**. Dividing by `N × quantity` is
algebraically the mean of the per-row unit prices — it prints the *average
price of one component* under a label promising *the price of one finished
unit*.

**Not a rounding or display issue.** The number is produced by a defined
calculation; the calculation answers a different question than the label.

**Disposition: REPAIRED 2026-08-11**, independently of Case B fixture
preparation, per Edward.

**Authoritative quantity basis — established before the repair.** The chain is
single-valued per tier for every reachable V1 quote structure:

```
quote_tiers.qty
  → bundle.data.costing.tiers[].qty        (math layer — governed authority)
  → CustomerViewTier.quantity              (customer-view-resolver.ts:199)
  → CpdfTier.quantity                      (customer-view-to-cpdf.ts:109)
  → tiers[ti].quantity
```

Two properties make `tiers[ti].quantity` the only correct divisor:

1. **Every row is priced per finished unit of the order.** `lineTotal`
   (`helpers.ts:69`) and the `priced` accumulator multiply *every* row by the
   *same* `tiers[ti].quantity`. So `total` is already Σ(per-unit prices) ×
   quantity.
2. **Component multiplicity never reaches tier quantity.**
   `assembly_leaves.quantity` is folded into each row's per-unit price upstream
   in the math layer. `skuSet` is leaf-level and flattens leaves across
   assemblies, so assembly count cannot enter the denominator either.

**The repair** — `customer-pdf-helpers.ts:127`, one expression:

```ts
const shippedQty = tiers[ti].quantity;
const perUnit = pricedCount > 0 && shippedQty > 0 ? total / shippedQty : null;
```

`pricedCount > 0` is retained deliberately — it is the "no rows priced" signal
that `customer-pdf-grand-total-row.tsx:82` reads to render "total on request".
Dropping it would print `from $0.00 /unit` on a fully unpriced tier carrying
folded fees, violating OD-005.

**Unchanged, as required:** quoted total · row sell prices · costing · margin ·
tier calculations · itemized/turnkey applicability. The change is confined to
one divisor in one pure function.

**All consumers proven to receive the corrected basis.** `tierGrand` is the
single derivation point — no customer-facing surface computes per-unit
independently:

| consumer | file:line | presentation |
|---|---|---|
| itemized grand-total row | `customer-pdf-grand-total-row.tsx:53` | `itemized` |
| turnkey hero | `customer-pdf-turnkey-summary.tsx:114` | `turnkey_only` |
| turnkey tier cards | `customer-pdf-turnkey-summary.tsx:175` | `turnkey_only` |

(`customer-pdf-charges-block.tsx:82` also renders a `/unit` string, but it is a
per-unit **freight rate**, not a tier per-unit — out of T-1 scope, in scope for
the Freight trace below.)

**Regression coverage** — `tests/unit/customer-pdf-per-unit-basis.test.ts`,
11 cases, all asserting through the invariant `perUnit × quantity === total`
rather than golden numbers:

| # | case |
|---|---|
| 1 | `N = 1` — previously-correct case preserved |
| 2 | `N > 1` — the cardinality defect (the Nemah instance exactly) |
| 3 | unequal component prices — a mean-of-rows implementation fails here |
| 4 | multiple assemblies — leaves flatten, quantity stays shared |
| 5 | `itemized` — per-tier basis, multi-tier |
| 6 | `turnkey_only` — fees folded into the all-in unit |
| 7 | non-integer currency result — rounding is display-only, basis exact |
| 8 | **falsification** against the `pricedCount × quantity` denominator |
| 9 | no rows priced — stays `null`, never a governed $0.00 |
| 10 | partially priced — "from $X" as a lower bound |
| 11 | zero shipped quantity — no division |

**Falsification executed, not merely written.** With the pre-repair denominator
restored, **8 of 11 fail** (2,3,4,5,6,7,8,10). Cases 1, 9 and 11 still pass —
correct, as those are the behavior-preservation cases the repair must not
change. Governed suite `npm run test:unit`: **798/798**, up from 787.

**Live proof on Nemah `f544128a`** (1,000 units, 3 priced rows), both
presentations, before Send:

| presentation | rows | total | per-unit |
|---|---|---|---|
| `itemized` | $4.00 / $6.00 / $2.00 → $4,000 / $6,000 / $2,000 | **$12,000** | **$12.00** |
| `turnkey_only` | (folded) | **$12,000** | **$12.00** |

$12,000 ÷ 1,000 = $12.00. ✓

### T-2 · `hasUnpriced` basis is unresolved · **BUSINESS DISPOSITION REQUIRED**

When some SKU rows are unpriced, `total` sums priced rows only, while units
shipped covers the whole tier. Once T-1 is fixed to divide by `quantity`, the
"from $X /unit" figure becomes *the priced subset's cost spread over all
units* — which may or may not be the intended commercial claim. Raised now
because the T-1 fix forces the question; it is not answerable from the code.

### Production inputs — **NOT YET TRACED**

Owed: production cost · Manufacturing markup · **Bulk Raw cost and its markup
separately** · filling / assembly / co-pack · quantity/tier behavior ·
production fees and per-unit conversions · production-side adjustments
affecting quoted sell.

Bulk Raw carries a known adjacency: Pattern 57 removed the RAW row from the
cost stack on the grounds that no independently governed raw node exists and
`productionMarkupSum` already carries it. **That is an internal-surface
disposition and does not settle the customer-facing question.** The trace must
establish whether Bulk Raw and its markup reach the quoted sell once, twice,
or not at all — the double-counting and silent-omission tests both apply.

### Freight inputs — **NOT YET TRACED**

Owed: selected destination · freight type/mode · freight amount · freight
markup · duty · tariff · customs/brokerage · freight tier/break propagation ·
incoterm-dependent treatment.

Adjacencies already on record:
- Duty and tariff are **internal-only** (`CLAUDE.md` customs/landed-cost
  section) and the customer-facing rule is stated there: a single "Freight: $X"
  line when `pass_through`, invisible when `bundled`. That is a citable
  presentation contract — the trace must confirm the code honors it.
- The D+T cost-stack row was hardcoded 0 at one point (banked in `CLAUDE.md`).
  The customer-facing consequence was never separately traced.
- C.2 (ship-to) is open in the SO matrix and touches destination selection
  from the same `freight_destinations` model.

---

## §3 · Required coverage

Trace must run against **at least one `itemized` quote and one `turnkey_only`
quote**. T-1 is already confirmed on `turnkey_only` by observation and on
`itemized` by shared-code-path analysis; the `itemized` instance still needs
direct observation before it is recorded as observed rather than inferred.

## §4 · Relationship to certification

Per Edward, 2026-08-11:

> Nemah Case B may remain prepared, but do not declare the overall
> quote-to-order workflow certified until this Production/Freight translation
> review and the remaining C.2–C.4 parity dispositions are complete.

Certification blockers now standing: **this matrix** · **C.2** ship-to ·
**C.3** `otherRefNum` vs `custbody_dps_client_po` · **C.4** deposit-field
dependency.
