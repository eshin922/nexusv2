# Downstream regression certification — required gate

**Status: Part A PASS. Part B run 2026-08-25 — quantities 1-6, 8-9, 12 PASS;
7 BLOCKED on external NetSuite product-master provisioning; 10-11 not reached.
Blocks close of the Customer View / Pricing / Commercial
Recovery workstream.**

Recorded 2026-08-26 on Edward's disposition. Runs **immediately after Finalize /
send is certified**, and before this workstream closes.

## Why this exists

Between #400 and #427 this workstream changed the customer document's structure
and vocabulary, the Pricing surface's result semantics, the recovery election
lifecycle, and the costing node graph. Every change was argued to be
presentation or read-model only, and each was verified at its own boundary.

None of that is the same as proving the **downstream commercial path** still
behaves as previously certified. A projection can reconcile perfectly at the
surface and still hand a different number to NetSuite — "exact reconciliation is
necessary but not sufficient" is the standing rule, and this gate is where it is
applied to the governed path rather than to a display.

The specific claim under test, stated so it can fail:

> The operator-facing **Unit-price sell** is presentation / read-model semantics
> only. It has **not** replaced or modified `quoteRollup.totalRevenue`, nor any
> downstream NetSuite or HubSpot governed value.

## The validation quote

Must carry, at minimum:

- one Commercial Recovery charge elected **In unit price**
- one charge billed as a **One-time fee**
- normal product / component lines
- a valid sendable / finalizable state

A quote missing either recovery placement does not exercise the seam this gate
exists for. Do **not** manufacture sendability by editing real commercial data
on a customer quote; provision a quote that is legitimately in that state.

## The path

```
Finalize  ->  frozen snapshot / artifact  ->  Acceptance
          ->  Order Packet / Sales Order projection  ->  NetSuite sandbox
```

Prove at **each boundary** that the recent changes did not alter downstream
commercial semantics.

## What must reconcile

| # | Quantity |
|---|---|
| 1 | tier quantities |
| 2 | customer unit prices |
| 3 | separately billed one-time fees |
| 4 | total customer consideration |
| 5 | frozen recovery elections |
| 6 | accepted snapshot |
| 7 | SKU / component identity and grouping |
| 8 | BV-011 destinations |
| 9 | Order Packet amounts |
| 10 | NetSuite line quantities and rates |
| 11 | Unit Cost and native Est. Rate |
| 12 | HubSpot deal amount and the divergence check |

## Part A — architectural isolation (RUNS NOW, independent of the fixture)

> **Customer presentation is not an input to NetSuite projection.**

Asserted structurally rather than behaviourally, because a behavioural run can
only show that ONE quote's numbers still match. A presentation construct could
become an input and the numbers still agree on the quote under test — an
architectural regression that would surface later, as the next presentation
change silently moving a transmission.

`npm run verify:netsuite-isolation`, wired into `verify:ci`. It walks the
**value**-import graph from the four projection entry points and refuses any
module that imports a customer-presentation or operator-display construct, and
separately refuses any consumer that reads the `unit-price-sell`,
`separate-charges` or `unbillable-recovery` node keys.

Current state: **72 modules reachable, zero violations.**

Three measurement corrections were needed before it meant anything, each of
which had it reporting a regression that does not exist:

1. **Type-only imports are not dependencies.** `import type` is erased at
   compile time. `costing-store` imports `OtherServiceSelection` as a type from
   `commercial-projection`; that moves no value.
2. **The definer is not a consumer.** `costing.ts` emits every graph node, so
   scanning it for the node keys flags the producer.
3. **Comments are not reads.** The key scan runs over code with comments
   stripped, or the file explaining the rule would violate it.

### The authoritative source of each quantity

The code states the division of authority itself
(`mark-complete.ts` "THE DIVISION OF AUTHORITY"):

> FROZEN governs WHAT WAS SOLD — quantity, rate, amount, total.
> LIVE structure governs only HOW an already-frozen line is GROUPED.
> `unitCost` stays LIVE and stays non-commercial.

| Quantity | Authoritative source |
|---|---|
| SKU / component identity | `quote_snapshot_lines.display_sku` / `.display_name` (frozen) |
| quantity | `quote_snapshot_line_tiers.quantity` (frozen) |
| sell / rate | `derivePostedRate(frozen amount, quantity)` — derived from the frozen **amount**, never read from a stored rate |
| one-time fee lines | `quote_snapshot_lines` where `line_kind = 'otc'` (frozen) |
| grouping | LIVE assembly tree — Item Group membership, group SKU/name, `qty_per_parent` |
| BV-011 destination | `quote_snapshot_lines.bv011_destination` (frozen) |
| Unit Cost | `perTierRollup.contributionCostPerUnit` — LIVE, reporting basis only |
| native Est. Rate | same, via `custcol_dps_unit_cost` / `costEstimateRate` |
| total consideration | sum of frozen line amounts |

None is a `CustomerView`, a renderer, a label, a layout axis, a presentation
profile, a Pricing trace node, Card 1 state, or `unit-price-sell`.

**Stop condition.** If any presentation or read-model construct introduced in
#400–#427 becomes an input, stop. That is an architectural regression even if
the numbers happen to match on the validation quote.

## Part B — behavioural regression

**RUN 2026-08-25 on DPS-1061 v2 (`52bd0077`, ZZ-VALIDATION-tier-propagation),
Tier 4. PARKED at quantity 7 on an external dependency.**

Suppression was proven three ways before Acceptance touched anything: the
endpoint (`flagSuppressed` **and** `providerSuppressed` both true), the operator
UI banner, and the live deal itself — stage `195274339` (not the accept stage
`195607084`), amount `30000` (not `103786.64`), `hs_lastmodifieddate 2026-07-18`,
five weeks before the run. Nothing wrote to it; the production workflow cannot
have fired.

Tier 4 was chosen deliberately: its governed revenue carries IEEE-754 residue
(`103786.63999999998`), so it exercises the outbound `toFixed(2)` boundary that
Tiers 1 and 3 would have left untested.

| # | Quantity | Result |
|---|---|---|
| 1 | tier quantities | **PASS** — 20,000/SKU · 40,000 total |
| 2 | customer unit prices | **PASS** — $3.05 / $2.07, document = projection |
| 3 | separately billed one-time fees | **PASS** — $1,400, `project_setup` only |
| 4 | total customer consideration | **PASS** — $103,786.64 |
| 5 | frozen recovery elections | **PASS** — 1 separate / 3 included → exactly 1 OTC line |
| 6 | accepted snapshot | **PASS** — v2 intact, Tier 4 captured |
| 7 | SKU / identity and grouping | **BLOCKED** — see below |
| 8 | BV-011 destinations | **PASS** — OTC `otc_setup` |
| 9 | Order Packet amounts | **PASS** — 102,387 + 1,400 = 103,787 |
| 10 | NetSuite line quantities and rates | **NOT REACHED** (blocked by 7) |
| 11 | Unit Cost / native Est. Rate | **NOT REACHED** (blocked by 7) |
| 12 | HubSpot amount + divergence | **PASS** on source/comparison path; PATCH intentionally suppressed |

Quantity 12 landed on its pre-committed value exactly: the `quote_accepted`
audit records `amount: 103786.64`, the correctly rounded form of the residue
above, with `suppressed: true`, `stage_written: false`, `amount_written: false`
and `from_stage_id == to_stage_id`. The transmission itself is intentionally
unexercised, and the absence of a divergence flag is **not** offered as evidence
that HubSpot agrees with anything.

### Quantity 7 — external product-master dependency, not an engineering defect

The send refused twice, cleanly, posting nothing either time: first
`product_sku_missing` (products frozen without a SKU), then — once the fixture
carried SKUs — `product_item_unresolved`.

**Two NetSuite sandbox item records are required:**

```
ZZ-VAL-50ML-PCR
ZZ-VAL-75ML-ALU
```

They must be created by someone with NetSuite item-master / accounting
authority. **Engineering must not invent item type, class, account, tax,
costing, or HubSpot product-type values.**

There is no governed certification-item template to copy and no Nexus path for
creating product masters. Verified, with a control read first so the absences
are findings rather than query artifacts:

- **`ZZ-CERT-KIT` does not exist as an item.** What exists is `ZZ-CERT-KIT-G`,
  itemtype `Group` — auto-created by Nexus's own Item Group code, which appends
  the `-G` suffix. It is not a product-master precedent.
- **`SVC-FORMULATION` does not exist**, nor any `SVC-%` item. Service lines
  resolve through the destination item map, not SKU→item.
- **Nexus creates Item Groups and Sales Orders only.** There is no
  item-creation code path, so every product master in the sandbox was authored
  by a human in NetSuite.
- The three real precedents (`ABH99-00326`, `DPS-BOTTLE-0001`, `FBS-BOT-01`)
  agree on itemtype `InvtPart`, subsidiary 2, income 218, asset 211, expense
  212, tax schedule 2, FIFO/AVGCOST, cost category 1 — an observed pattern
  across three records, not a documented default — and **disagree** on `class`
  (58 vs 1) and `custitem_dps_hubspot_product_type`, which are the two fields
  carrying business meaning.

Once the items exist, quantity 7 is retried and 10–11 follow. Nothing already
proven needs rebuilding.

### Fixture provenance

The fixture's products were cloned to fixture-local leaves rather than given
SKUs in place: the shared library leaves are read by `4781e4bb`, `Primary` and
a Nemah scenario, and writing an invented identity onto a product master three
other quotes read is the failure this workstream exists to refuse. The clones
carry `hubspot_product_id = null` — it is UNIQUE per product, and a
certification identity is not a HubSpot link.

Five proofs were taken before Finalize v2, each a before/after comparison:
only fixture-local identities referenced; economics identical
(`tiers 99745af7`, `lines 00ab0166`); elections 1 separate / 3 included;
customer-document totals identical; shared library leaves byte-identical
(`c556585f…` before and after).

**A defect found in the process:** leaf identity is recorded twice —
`quote_leaves.leaf_id` (canonical) and `assembly_leaves.leaf_id` (legacy
membership). Moving only the canonical half took the quote page to a persistent
500 until the legacy half followed. `commercial-settings.ts:107` compares them
and refuses the quote, which is the guard working as designed.

### Readiness repair shipped alongside

The Sales Order step read `READY TO SEND` on both refusals above. PR #433
(`loadIdentityReadiness`) predicts both before the click. Visibility only —
`buildFrozenSalesOrder` remains the authority.

## How to compare

**Against the previously certified NetSuite projection behaviour** — not merely
against "an SO was created". A created Sales Order proves the call succeeded; it
proves nothing about the numbers on it. The comparison needs the prior certified
values as its baseline, captured or recovered before the run.

Note two known consumers of `quoteRollup.totalRevenue` that this gate must watch
specifically, because they leave Nexus:

- `quotes.ts` `tierTurnkeyAmount` -> HubSpot deal `amount`
- `mark-accepted/page.tsx` `totalRevenue / qty` -> the acceptance unit price

The second is a **known open finding** (it amortises separately-billed charges
the same way the old Final quoted sell did) and is expected to be visible here.
It is not a regression from this workstream; classify it as the pre-existing
item it is, and do not let it mask a new one.

## Disposition rule

**Any mismatch is a blocker** until classified as either intentional or
repaired. "Probably rounding" and "looks close enough" are not classifications.

## Related open items, deliberately not in scope

These stay separate and must not be folded into this gate:

- margin governance on unbillable revenue (billable-revenue margin vs reporting
  the margin as unresolved)
- Acceptance `totalRevenue / qty` amortisation
- governed `quoteRollup.totalRevenue` semantics
- the zero-quantity live-vs-PDF "total on request" predicate mismatch
- Commercial Recovery responsiveness (~2.7s evaluation) — correctness is
  closed, felt latency is not
