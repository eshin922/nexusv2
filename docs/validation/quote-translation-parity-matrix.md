# Costs → customer-quote translation parity

**Scope: Production and Freight governed inputs, traced to the customer-facing
quote.** Separate from `so-field-parity-matrix.md` (Nexus → NetSuite Sales
Order). Both carry into final V1 certification.

**Status: OPEN. T-1 (HIGH) and T-4 (Design Authority) both REPAIRED 2026-08-11.
Presentation matrix complete (2b), one coverage limitation stated. Two business
dispositions outstanding: Bulk Raw bundling, and freight (OD-001).**

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

### T-3 · Sell-side composition — each component enters exactly once · **PARITY (sell side only)**

Establishes the "exactly once" half of the question. Customer *presentation*
is still outstanding below.

`computeLeafPerTier` builds `cellSections` and sums it into `sellBefore`
(`costing.ts:2250-2256`, `op: "packaging + production + bulk raw + freight"`):

| section | pushed at | markup applied |
|---|---|---|
| packaging | `costing.ts:1589` (seed) | per-line `markup_pct` |
| production | `:1803` | `PRODUCTION_MARKUP_CATEGORY` |
| bulk raw | `:1835` **or** `:1868` (if/else — exactly one fires) | `RAW_MARKUP_CATEGORY` |
| freight | `:2215` | per-leg; duty + tariff nested inside |

Each pushed exactly once; `sellBefore` is then `× (1 + effectiveAdj)`, then
lifts, then a terminal per-cell override. **Duty and tariff are operands inside
`freightSectionNode`** (`:2090-2130`), each with its own markup — not
separately re-added to `cellSections`. No component enters quoted sell twice.

One-time service fees with allocation OFF are explicitly **not** in unit sell —
`separateServiceFees = 0` and the comment at `costing.ts:1653-1655` states they
are "projected exactly once by the customer-view resolver, outside unit cost and
unit sell." That is the citable contract for their separate-line presentation.

### T-4 · Bulk Raw absent from the Cost Stack · **V1 DESIGN AUTHORITY / OPERATOR-TRUTHFULNESS BLOCKER — REPAIRED 2026-08-11**

Not a defect in the math — the math is correct. A defect in the **premise a
governance decision was taken on**, which matters because Pattern 57 is now a
standing design rule applied to future row-membership questions.

`CLAUDE.md` Pattern 57 records the RAW cost-stack row as removed because
"`productionMarkupSum` already carries it, and no raw node exists." Both claims
are contradicted by the code:

| claim | reality |
|---|---|
| "no raw node exists" | `rawSectionNode` is a canonical node, `nodeKey(sku.id, tier.id, "raw")`, built at `costing.ts:1806-1868` |
| "`productionMarkupSum` already carries it" | `productionMarkupSum` reads `productionSectionNode.value` (`:1878`), built from `productionCostSum` — which is `internalProductionCogsPerUnit + allocatedServiceFeesPerUnit` (`:1656`) and **excludes** bulk raw entirely |
| — | bulk raw carries its **own** markup category (`RAW_MARKUP_CATEGORY`, `:1673`), distinct from `PRODUCTION_MARKUP_CATEGORY` |

Pattern 57's own test is *"does this have an independently governed value — a
canonical node of its own?"* For bulk raw the answer is **yes**: own node, own
markup category, own `cellSections` entry. By the rule's own criterion the row
qualified.

**Disposition (Edward, 2026-08-11): Pattern 57 reopened narrowly.** The prior
disposition rested on a false factual premise, so the rationale that Bulk Raw is
already represented by Production does not hold. Classified as a V1 Design
Authority / operator-truthfulness blocker and repaired.

**Repair -- representation only.**

- RAW restored as its own governed Cost Stack section, sourced from
  `rawSectionNode` via a new `per-unit/raw` component.
- Its own resolved markup basis preserved -- `RAW_MARKUP_CATEGORY`, never
  Manufacturing's.
- Not folded into Production. PROD reads **net** of raw, so the two sections sum
  to what PROD alone previously showed.
- `breakdown.production` / `breakdown.productionMarkupSum` keep their folded
  values for every existing consumer; `breakdown.rawCost` is **added**, the
  cost-side counterpart to the `rawMarkupSum` that already existed.
- Costing arithmetic, quoted sell, margins and markup policy unchanged.

**Evidence** -- `tests/unit/cost-stack-bulk-raw-section.test.ts`, 8 tests:

| # | requirement | result |
|---|---|---|
| 1 | Production > 0 **and** Bulk Raw > 0 | pass |
| 2 | Manufacturing markup != Raw markup (0.32 vs 0.50) | pass |
| 3 | both sections render | pass |
| 4 | each matches its governed node independently | pass |
| 5 | changing Raw markup moves only Raw | pass (see note) |
| 6 | changing Manufacturing markup does not move Raw | pass |
| 7 | visible reconciliation exact (sum of sections = subtotal) | pass |
| 7b | quoted sell / raw's sell contribution untouched | pass |
| 8 | falsification vs prior Pattern 57 behavior | pass |

Note on item 5: PROD is asserted unmoved at a tolerance of 1e-9, not on bit
equality. PROD is derived by subtraction, so changing the raw markup
re-associates the float and PROD can differ in the last representable bit
(6.6 vs 6.600000000000001). That is representation, not a commercial move --
recorded because "unmoved within tolerance" is a weaker claim than "unmoved".

**Falsification (item 8) establishes both halves of why the prior state was
indefensible:**

- with PROD net of raw and no RAW row, the visible stack **under-reports by
  exactly the raw contribution** -- an unexplained gap;
- with PROD folded, the stack reconciles but reports a blended markup rate
  matching **neither** governing authority (0.32 nor 0.50) -- the money is
  attributed to an authority that did not price it.

**Governance record corrected, not rewritten.** `CLAUDE.md` Pattern 57 keeps its
three passes verbatim under a notice that the worked example was invalidated by
implementation evidence. The rule is unchanged and unweakened -- a financial
stack contains only independently governed quantities, and bulk raw is one. The
banked lesson is now sharper: answering "is this independently governed?" from a
display-layer aggregate rather than from the node graph fails in exactly this
direction, because **aggregation looks like absence**.

**No inference drawn about customer-facing Bulk Raw presentation.** This repair
is internal-surface only; customer presentation remains open below.

## §2b · Customer-facing presentation matrix

Built from **customer-facing artifacts and their governing resolver/contracts**
— `customer-view-resolver.ts`, the `CustomerView` it emits, and the react-pdf
tree that renders it. Not inferred from the costing graph.

**The internal Cost Stack rule does not apply here.** Customer presentation may
bundle contributions where an accepted contract says so. What it may not do is
bundle on implementation behaviour alone.

### The single projection fact everything below turns on

`resolveCustomerView` emits exactly three commercial channels:

| channel | populated from | reaches |
|---|---|---|
| `skus[].tierPrices[]` | `rollup.perTier[].requiredSellPerUnit` | the per-unit price, both modes |
| `serviceFees[]` | production one-time fees, **only** where `allocateServiceFeesToCost === false` (`resolver:348-366`) | the Charges block |
| `freightLines[]` | **hardcoded `[]`** (`resolver:368-370`) | nothing — the PDF block is gated on `length > 0` |

There is **no** production channel, **no** raw channel, **no** duty channel and
**no** tariff channel. Everything except allocation-off one-time fees reaches
the customer through the unit price and only through it. That is the finding;
the rows below record its consequences per input.

### Matrix

| input | governed sell contribution | resolver path | Customer View | PDF `itemized` | PDF `turnkey_only` | representation | governing authority | explainable? | class |
|---|---|---|---|---|---|---|---|---|---|
| **Production** (filling/blending, CM assembly, allocated fees) | `cellSections[prod]`, `PRODUCTION_MARKUP_CATEGORY` | none — inside `requiredSellPerUnit` | per-unit price only | in each row's unit price → extended → total | in the turnkey unit price | **bundled into the commercial unit** | `costing.ts:1653-1655` — filling/blending and CM assembly "always remain internal COGS" | yes — unit price is all-in | **intentional governed bundling** |
| **Production one-time fees**, allocation **ON** | amortised into `productionCostSum` (`:1656`) | none | per-unit price only | bundled | bundled | bundled into the commercial unit | same | yes | **parity** |
| **Production one-time fees**, allocation **OFF** | excluded from unit sell — `separateServiceFees = 0` | `serviceFees[]`, once per (assembly, fee) | Charges block | separate charge lines | separate lines; `foldFees` adds them to the turnkey total | **separately charged** | `costing.ts:1653-1655` — "projected exactly once by the customer-view resolver, outside unit cost and unit sell" | yes | **parity** |
| **Bulk Raw** | own `cellSections` entry, own `RAW_MARKUP_CATEGORY` | none — inside `requiredSellPerUnit` | per-unit price only | bundled | bundled | **bundled into the commercial unit** | **CP-001** (below) | yes | **intentional governed bundling** |
| **Freight** | `cellSections[freight]`, per-leg markup | `freightLines` **hardcoded `[]`** | absent | absent | absent | **suppressed** | **BV-009 — does not exist** | yes, but the operator's choice is inert | **business disposition required (OD-001)** |
| **Duty** | operand inside `freightSectionNode`, own markup | none | absent | absent | absent | bundled into unit price | `CLAUDE.md` customs section — never customer-facing | yes | **intentional governed bundling** |
| **Tariff** | operand inside `freightSectionNode`, own markup | none | absent | absent | absent | bundled into unit price | same | yes | **intentional governed bundling** |

### Per-input findings

**Production — bundled, and the two modes do not differ in substance.** Both
carry production inside the per-unit price; the modes differ only in whether
that price is shown per SKU row or as one turnkey figure. Neither exposes
production separately, and neither claims to.

**Bulk Raw reaches the customer exactly once** — inside `requiredSellPerUnit`,
via its own `cellSections` entry, at its own markup. It is not double-fed:
there is no raw channel in the resolver, so the T-4 restoration cannot leak
into the customer view.

**No customer-facing surface repeats the Pattern 57 error.** The customer tree
never consumes `breakdown.production` or `breakdown.productionMarkupSum` — the
folded aggregates that caused T-4. It consumes `requiredSellPerUnit`, where
production and raw were always distinct `cellSections` entries. The prior error
was confined to the internal stack.

**Bulk Raw's bundling now has a contract — CP-001.** It previously had none,
which is why it was classified *business disposition required* rather than
*intentional aggregation*: §1 holds that an uncited bundle is not justified by
the fact that it is what the code does. That gap is now closed by authority
rather than by observation.

> ### CP-001 · Bulk Raw customer presentation
>
> **Authority:** Edward, 2026-08-11. Business disposition, recorded as the
> missing customer-presentation contract.
>
> **Bulk Raw is bundled into the customer-facing commercial product price.**
>
> For V1 customer presentation, Bulk Raw contributes **exactly once** to the
> applicable commercial product / turnkey price. It does **not** appear as a
> separate `Bulk Raw` charge.
>
> **Internal independence does not imply customer-facing separation.** Bulk Raw
> remains independently governed internally — its own canonical costing node,
> its own markup authority (`RAW_MARKUP_CATEGORY`), and its own Cost Stack
> section per T-4. None of that entitles it to a customer-facing line. The two
> questions are decided by different authorities: the Cost Stack answers to
> Pattern 57 (does a governed node back this row?), customer presentation
> answers to the accepted quote/presentation contract.
>
> **This is the authority. The implementation is not.** Current resolver
> behaviour happens to conform, but conformance is the thing to be verified
> against CP-001 — not the thing that established it.
>
> **Verification obligation:** confirm the contribution is present exactly once.
> Change arithmetic only if the trace shows it **omitted** or **duplicated**.
> Bundling itself is not a defect to be repaired.

**Freight — the governed operator choice is inert.** `treatment` is a
**required** operator control offered as `Bundled · amortised across units` vs
`Pass-through`, on both Create Shipment (`freight-drilldown.tsx:451`) and
shipment edit (`:592`), persisted to `freight_subcategories.treatment` /
`freight_legs.treatment`. The resolver never reads it: `freightLines` is
hardcoded `[]` and the PDF Charges block is gated on `freightLines.length > 0`
(`customer-pdf-charges-block.tsx:68`). **Selecting Pass-through changes nothing
the customer sees.**

The banked contract (`CLAUDE.md` customs/landed-cost section) states the intent
explicitly — *"show only 'Freight: $X' per tier ... when
`freight_treatment = pass_through`; invisible when `bundled`"* — so the
suppression is correct for `bundled` and unimplemented for `pass_through`.

The authority cited in code for the suppression is **BV-009**, which **has
never existed in any branch at any point in history** (`OD-001`, `GLOSSARY.md`).
OD-001 already names `customer-view-resolver.ts:368` as blocked on it. This
matrix does not reopen OD-001; it adds one fact to it: *the unratified
suppression does not merely lack documentation, it silently discards a required
operator input.* Whether that is a defect or intended scope depends on the
answer OD-001 is waiting for — which is why this is a disposition, not a defect
classification.

**Duty and Tariff reach the customer exactly once, combined, inside the unit
price.** Each carries its own markup inside `freightSectionNode`; neither is
separately projected. The governing rule predates this work and is unambiguous:
duty and tariff percentages are internal and never customer-facing. The
customer sees one landed number; the combination is the intent, not an accident.
Riding inside freight, they inherit the freight presentation question — but not
its uncertainty: suppression is what their own contract requires regardless of
how OD-001 resolves.

### Direct T-1 observation — both modes, post-repair

Completes T-1's customer-facing evidence. Nemah `DPS-1045` (`f544128a`),
1,000 units, 3 priced rows, observed live in the PDF preview:

| mode | rendered | per-unit | check |
|---|---|---|---|
| `itemized` | rows $4.00 / $6.00 / $2.00 → extended $4,000 / $6,000 / $2,000; **Turnkey total $12,000** | **$12.00 /unit** | 4+6+2 = 12 · 12,000/1,000 = 12.00 |
| `turnkey_only` | **Tier 1 · 1k units · $12,000** | **$12.00 /unit** | 12,000/1,000 = 12.00 |

Both directly observed, not inferred. Row prices and totals identical across
modes — the repair moved only the per-unit basis.

### Coverage limitation — stated, not glossed

The Nemah fixture is **packaging-only**: no production, no bulk raw, no freight,
no duty, no tariff. The matrix rows for those five are established from the
**resolver and PDF code paths** — the governing artifacts — but *rendered*
evidence for them is not yet captured. The three projection channels are
unconditional, so no fixture can change which channel a contribution uses; a
fixture would confirm rendering, not routing.

**Owed before certification:** one quote carrying production, bulk raw, freight
and customs, rendered in both modes, to confirm the Charges block behaves as
this matrix says and that nothing else appears.

## §2c · Rendered-coverage fixture — design and execution plan

**Scenario created 2026-08-11:** `f5f5ac14-4d6b-4a48-98da-e6285a2cd9be`,
"Rendered coverage fixture (do not quote)", on Nemah project `628dfce0`. From
**Scratch**, not recommended, Primary not dropped.
**Currently empty — no inputs entered. It is not evidence of anything yet.**

Distinct from `DPS-1045` (`f544128a`), which stays sent and unaccepted. Creating
a scenario consumes no HubSpot deal and no NetSuite transaction.

### Value design — every contribution independently recognizable

Distinct primes at distinct magnitudes, so no two contributions can be confused
for one another in the rendered arithmetic and no equality is coincidental.
**Tier: 1,000 units** — single tier, since tier propagation is not what this
fixture tests.

| contribution | assembly | input | per-unit at 1,000 |
|---|---|---|---|
| Packaging | A | leaf unit cost **$3.00** | 3.00 |
| Packaging | B | leaf unit cost **$5.00** | 5.00 |
| Production (filling / blending) | A | **$7,000** | 7.00 |
| Bulk Raw | A | `bulkRawCost` **$13,000** | 13.00 |
| One-time fee, allocation **ON** | A | setup **$11,000**, `allocateServiceFeesToCost = true` | 11.00, amortised into unit sell |
| One-time fee, allocation **OFF** | B | tooling **$17,000**, `allocateServiceFeesToCost = false` | **excluded** from unit sell; separate charge |
| Freight | shipment over A | leg total **$19,000** | 19.00 |
| Duty | customs on that shipment | **$23,000** | 23.00 |
| Tariff | customs on that shipment | **$29,000** | 29.00 |

`allocateServiceFeesToCost` is a **per-assembly policy**, which is why two
assemblies are required: A carries allocation ON, B carries allocation OFF.
That is a structural requirement of the fixture, not a preference.

**Markup limitation, stated.** `markup_defaults` is empty in this environment,
so Production and Raw resolve through the same fallback rate. Their *rates*
cannot be told apart here — but their *contributions* can, because 7.00 and
13.00 differ at every markup. Recognizability is carried by cost magnitude, not
by rate. Item 8 is unaffected: it asserts an absence, not a value.

### Proof obligations — both `itemized` and `turnkey_only`

1. quoted total reconciles to the governed commercial contributions;
2. Production bundled per its accepted contract;
3. **Bulk Raw contributes exactly once and is bundled, not exposed** — **CP-001**;
4. Duty and Tariff follow their accepted bundling contracts;
5. Freight per the **current OD-001 authority only** — if OD-001 prevents a
   final classification, **record that rather than inventing one**;
6. allocation-ON fee reaches the customer through unit pricing and is **not**
   separately duplicated;
7. allocation-OFF fee excluded from unit sell and appears **exactly once**
   through the separate-charge projection;
8. no internal markup percentage and no internal Cost Stack category leaks into
   customer presentation unless explicitly governed.

**Customer View vs PDF differences are defects** unless an accepted contract
explicitly permits them.

### Standing rule for executing this

> This is rendered **confirmation** evidence. If rendering contradicts the
> already-established resolver/contract trace, **stop and classify the first
> failing boundary** rather than changing the governing classification to fit
> the output.

The §2b classifications are settled by authority (Edward, 2026-08-11):
Production, Duty, Tariff — intentional governed bundling; one-time fees ON/OFF —
parity; Bulk Raw — CP-001. **They are not reopened by rendered evidence
remaining outstanding.** The fixture confirms the governed projection; it does
not redefine it.

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
