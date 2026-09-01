# Quote Presentation / Commercial Recovery — discovery trace

**Status:** trace only. Nothing implemented, no model built.
Returned for disposition before any Quote-model work (2026-08-22).

**Design target being tested against:** separate (1) internal accounting/cost
truth, (2) operator-selected commercial recovery, (3) customer presentation —
with recovery/presentation freezing at SEND.

**Headline:** two of the three layers already exist and are already governed.
The missing one is the middle: **operator-selected recovery has a vocabulary,
a persisted column and live operator usage — and no consequence anywhere.**

---

## 1 · Component / data-flow structure

```
  getCostingBundle(quoteId)            ← internal cost truth (the engine)
        │
        ▼
  projectCommercial(bundle)            ← THE SHARED PRODUCER
        │
        ├──────────────► customerViewResolver → CustomerView → customer-pdf/*
        │                                                       (react-pdf tree)
        └──────────────► freezeCommercialLineSet(projection)  ← at SEND
                              │
                              ▼
                     quote_snapshot_lines / _line_tiers / _tier_totals
                              │
                              ▼
                     NetSuite Sales Order + accounting lines
```

`projectCommercial` (`src/lib/commercial-projection.ts:191`) is the single
producer for both the customer document and the frozen matrix, and its own
header records why:

> "This resolver used to build both itself. That is how the PDF and the Sales
> Order came to disagree about allocation-OFF fees while each stayed internally
> consistent: two correct constructions of two different statements."

`freezeCommercialLineSet` takes **the projection the document rendered from**,
not a quote id to recompute from — deliberately, so "the frozen matrix matches
the PDF" is structural rather than a claim about two computations agreeing.

**This is the seam the new model needs, and it already exists.** Recovery
configuration should enter `projectCommercial`, not sit beside it.

## 2 · Customer-facing vs internal-only

**Customer-facing** is a closed set: the `CustomerView` type (`src/types/quote.ts`)
plus the react-pdf tree, guarded at build time by `verify:boundaries` — the
render tree may import nothing from costing, schema or actions (Pattern 45/51).

Customer sees: vendor, customer, quote header (number, dates, terms, lead time,
incoterms, TCS, notes), tiers, SKUs with `tierPrices`, service fees,
`freightLines`, `recommendedTierIdx`, and three presentation axes —
`pdfLayout`, `detailLevel`, `includeSpecAddendum`.

**Internal-only** (never crosses): markup pct and source, cost-input rows,
duty/tariff/CBM, cost-stack composition, supplier names, `version_number`,
`scenario_label`, audit fields.

The boundary is real and enforced. **It is a presentation boundary, not a
recovery boundary** — nothing in `CustomerView` says *how a cost is being
recovered*, only what the customer is charged.

## 3 · Service-fee allocation → presented unit economics

`allocate_service_fees_to_cost` (per assembly × tier) is the one recovery
decision that currently HAS consequence:

- **ON** → one-time fees amortise into `productionCostPerUnit`, so they reach
  the customer inside the unit price and produce no separate line.
- **OFF** → fees leave unit cost and become `otc` lines in the projection,
  presented as separately billed charges and emitted as their own NetSuite
  accounting lines.

Live: 17 rows OFF across **8 quotes** (4 draft, 3 sent, 1 complete).

**Its operator control was just removed** (Production cleanup, #363) with the
field, readers, writers and behaviour preserved — explicitly so this redesign
can own it. So today the value is live, consequential, and **unsettable**. That
is the clearest single argument for the slice.

## 4 · Freight recovery — the finding

`freight_treatment` is a persisted pgEnum (`bundled` | `pass_through`) on
`freight_subcategories` and freight legs, default `bundled`. Operators DO set
it: **1 live subcategory is `pass_through`**, 6 bundled.

**And nothing acts on it.** Traced exhaustively:

| reference | what it is |
|---|---|
| `freight.ts:204` | a string PARSER, not a branch |
| `freight-drilldown.tsx:291` | an internal DISPLAY LABEL ("pass-through" / "bundled · amortised across units") |
| `costing.ts:2207` | carried into the leg breakdown and **never branched on** |
| `pricing-cost-base.ts:98` | included in the fingerprint string |

There is **no** `=== "pass_through"` branch in any arithmetic or projection.

And the customer document is unconditional:

```ts
// customer-view-resolver.ts:304
// BV-009: freight remains in commercial costing. When bundled into unit
// price it has no separate customer-facing line, avoiding double signaling.
const freightLines: [] = [];
```

`freightLines` is hardcoded EMPTY — not derived from treatment. So an operator
can mark freight pass-through and **the customer document says nothing about
it**, while the cost stays amortised in the unit price.

That empty array is itself a repair: the PDF previously told customers freight
was "billed separately at cost (itemized below)" on a gate that a service fee
could satisfy — every clause false while the total reconciled.

**So freight recovery is: a governed vocabulary, live operator usage, zero
consequence.** The redesign's job is to give it one.

## 5 · Quote-level fields already persisted

Commercial: `global_price_adj_pct`, `target_margin_pct`, `freight_markup_pct`,
`customer_target_tier_label`, `underpriced_override_user_id`/`_reason`.

Presentation axes: `pdf_layout`, `detail_level`, `include_spec_addendum`.

Frozen-at-send snapshots: `payment_terms_snapshot`, `lead_time_snapshot`,
`incoterms_snapshot`, `tcs_snapshot`, `days_valid_snapshot`, `valid_until`,
`pdf_url`, `accepted_snapshot_json`, plus `pdf_layout` / `detail_level` /
`include_spec_addendum` mirrored onto `quote_snapshots`.

**Note the shape:** presentation axes ALREADY follow the pattern the target
describes — live column for drafts, snapshot column frozen at send. A recovery
profile would extend an existing convention rather than invent one.

## 6 · SEND / frozen boundary

Eight snapshot tables: `quote_snapshots`, `_lines`, `_line_tiers`,
`_tier_totals`, `_freight_inputs`, `_freight_workbooks`, `_leaf_specs`,
`_artifacts`. 29 snapshots exist.

**Frozen at SEND:** the commercial line set with per-tier rates/quantities/
amounts, tier totals, freight inputs and workbook, leaf specs, the rendered PDF
(`pdf_url` — a pointer to the actual bytes the customer received), commercial
terms, and the presentation axes.

**Recomputed live:** everything in the engine — costs, markups, margins,
progression verdicts, the classifier. Drafts read live; sent quotes read the
snapshot.

**Held by convention, not schema (Pattern 52):** immutability rests on
`assertDraft` / `assertNotFrozen` at every mutation entry point, not on
effective-dated rows. `docs/pattern-52-freeze-list.md` enumerates 30 columns.
**A recovery profile would join that freeze list and inherit that dependency** —
a new writer that forgets the guard silently breaks reproducibility.

## 7 · Below-floor authorization / fingerprint dependencies

Two distinct fingerprints, and conflating them would be a real defect:

- `fingerprintCommercialState({totalRevenue, totalCost, blendedMarginPct})` —
  keys below-floor authorizations. Not persisted as a format; stored per
  authorization row.
- `costBaseFingerprint(input)` — the pricing staleness guard. **Not persisted
  in any column**; both sides computed by one function per request.

**Recovery configuration changes revenue.** Moving a fee from unit price to a
separate charge, or freight from bundled to pass-through, changes
`totalRevenue` — therefore the commercial fingerprint — therefore **invalidates
any below-floor authorization on that quote**. That is correct behaviour (the
approval was for different economics) but it must be deliberate: a recovery
toggle that silently invalidates an approval an operator already chased is a
bad surprise, and the Organizer's `approval_*` task kinds surface the result.

## 8 · NetSuite / order payload dependencies

The Sales Order and accounting lines derive from the **frozen** snapshot, not a
recompute. `accounting-line-emitter.ts` resolves one path into two line shapes,
and its header records what a wrong quantity cost: SO2717, a line whose amount
was right and whose quantity described something else.

Allocation-OFF fees already flow through as their own accounting lines with
BV-011 destinations. **So NetSuite already consumes a recovery decision** — it
just consumes the only one that currently has consequence.

## 9 · Invoice / accounting consumers

`order-packet/reader.ts`, `netsuite/mark-complete.ts`, `netsuite/sales-orders.ts`,
`netsuite/cost-projection.ts`. All read frozen snapshot state.

`cost-projection.ts` is explicitly **not a gate** — a cost-projection failure
must not block a Sales Order.

**Accounting Invoice Guidance does not exist yet, and should not.** Per
direction it derives from the frozen recovery profile — which does not exist
either. Building it first would make it the de-facto definition of recovery.

---

## Hidden assumptions this trace surfaced

1. **"Freight treatment" reads as a recovery decision and is not one.** It is a
   label with a display string. An operator setting `pass_through` reasonably
   believes something changed. Nothing did.

2. **Allocation is the only live recovery lever, and it has no control.** After
   #363 the value is consequential and unsettable — a temporary state this
   slice is expected to resolve.

3. **`freightLines` being hardcoded empty encodes a policy as a constant.**
   BV-009 is a real decision, but it is expressed as `const freightLines: [] =
   []` rather than as a configuration with a default. Any recovery model has to
   turn that constant into a governed choice.

4. **Presentation axes are already frozen; recovery is not — because it does not
   exist.** The freeze machinery is proven; only the payload is missing.

5. **Recovery changes revenue, and revenue keys approvals.** Nothing today
   couples them because nothing today moves revenue at presentation time.

## Proposed model boundary

| layer | authority | where it lives today |
|---|---|---|
| **1 · accounting/cost truth** | the engine | `computeQuoteCosting` — untouched |
| **2 · commercial recovery** | operator | **does not exist.** Scattered: `allocate_service_fees_to_cost` (per assembly), `freight_treatment` (per subcategory, inert), `freightLines: []` (a constant) |
| **3 · customer presentation** | operator, already frozen | `pdf_layout`, `detail_level`, `include_spec_addendum` |

The proposal: a **quote-level recovery profile** — the operator's answers to
"how is each cost class recovered, and what does the customer see of it" —
which `projectCommercial` reads, and which freezes at SEND beside the
presentation axes.

Layer 1 must not read it. That is the invariant that keeps cost truth
independent of how the firm chooses to recover it, and it is testable the same
way the freight-attribution invariant was: **change the recovery profile, and
every internal cost scalar must stay identical while revenue and presentation
move.**

## Migration / backward-compatibility risks

1. **8 live quotes carry allocation OFF, three of them sent or complete.** A
   recovery profile must adopt their existing per-assembly values as its
   initial state, not default them. Reinterpreting a sent quote's economics is
   the top merge blocker.
2. **`freight_treatment` has one live `pass_through`.** Giving it consequence
   CHANGES that quote's presentation — and possibly its revenue. It is a draft;
   confirm before the semantics land.
3. **Fingerprint invalidation.** Any recovery change on a quote with a live
   below-floor authorization invalidates it. Correct, but needs to be surfaced
   rather than discovered.
4. **Pattern 52 convention.** New recovery columns join the freeze list and need
   `assertNotFrozen` at every writer, or reproducibility breaks silently.
5. **29 existing snapshots have no recovery profile.** Reading one must degrade
   to "the behaviour that produced this snapshot", not to a new default.

## Open questions for disposition

1. What is the **granularity** of recovery — quote-level, per cost class
   (packaging / production / freight / OTC), or per line?
2. Does `freight_treatment` stay per-subcategory and gain consequence, or does
   it move into a quote-level profile? (Two levers for one decision is how the
   `customer_ships_raws` / `raws_mode` conflation happened.)
3. Should changing recovery on a quote with a live approval **refuse**, or
   invalidate-and-warn?
4. Does allocation stay per-assembly, or become part of the quote-level
   profile? Its storage is per-assembly today and 17 rows depend on that.
