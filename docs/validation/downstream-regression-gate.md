# Downstream regression certification — required gate

**Status: NOT RUN. Blocks close of the Customer View / Pricing / Commercial
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
