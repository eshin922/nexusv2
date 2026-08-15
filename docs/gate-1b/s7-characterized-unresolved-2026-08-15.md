# S-7 · characterized and UNRESOLVED — V1 freight distribution policy

**Date:** 2026-08-15 · **Baseline:** NOT refreshed · **Status:** open

The baseline still describes single-owner freight attribution. The code no
longer does. That difference is recorded here rather than absorbed, because a
refresh would make the check green without anyone having to agree the movement
was intended — and the whole value of the gate is that someone has to.

## Why this is not being refreshed

The refresh was authorized on 2026-08-15, conditional on the isolation holding.
It does hold. It is not being taken, because the same day S-7 was removed from
the Vercel Preview veto path: the refresh is no longer needed to unblock
anything, and the governing instruction is to keep identified differences
characterized and unresolved rather than refresh to make a check green.

The authorization stands. When it is taken it needs no new analysis — the
isolation below is the analysis.

## Isolation · 33 basket quotes

Instrument: `scripts/gate-1b/pre-refresh-isolation.ts`. Compares every quote's
current costing against the frozen baseline and separates movement that
distribution is ALLOWED to cause (attribution) from movement it is not (cost).

| quote | moved commercial paths | before → after | membership | N | equal-split? |
|---|---|---|---|---|---|
| `2f29af72` Primary | revenue Tier 2 | 113,105 → 110,165 (Δ −2,940) | `36ead983`, `56e75a0d` | 2, 2 | **yes** |
| 31 others | none | — | — | — | unchanged |

`2f29af72` is the authorized policy movement. Two shipments, two members each,
one carrying an operator lever; the delta is exactly half the 5,880 that the
single-owner rule concentrated on one product. No cost path moved on any quote.

Result: **ISOLATION CLEAN**. Zero unexplained movement.

## DPS-1050 — the legacy case, resolved without touching the record

`9af5fe52` (DPS-1050) is complete, sent, accepted, PDF-persisted and
NetSuite-pushed. Its one shipment — Ocean FCL · CN → US, $500 freight + $150
duty/tariff — has **no membership in the live tables and none in the frozen
snapshot**. The record never existed: under the previous model a leaf resolved
from the assembly absorbed the cost, so nothing required one.

Read under equal-split, that shipment had no recipient and $650 of real cost
left a completed customer-facing quote.

**Not repaired by writing membership.** Inserting `freight_subcategory_items`
now would manufacture historical operational data after the fact. That the
candidate Item Group happens to contain exactly two products, and that the
reconstructed economics are obvious, does not make the record true.

**Repaired by reading what was already frozen.** The snapshot captured
`costingContext.ownerSkuByAssembly` at send — the attribution itself, stored at
the moment it was used, not a reconstruction of it. `resolveLegacyFreightAttribution`
reads it.

Confirmed on DPS-1050: Tier 1 total cost **2,400.00**, revenue **4,150.00**,
persisted membership rows **0 → 0**, frozen snapshot **byte-identical**. Freight,
freightContainer and dutyAndTariff are confirmed by the quote's absence from the
isolation report, which compares all three against the baseline.

### Eligibility predicate

| dimension | condition |
|---|---|
| lifecycle | reached only via the snapshot projection — quote is non-draft AND has a live, non-superseded snapshot |
| legacy discriminator | `quote_snapshot_freight_workbooks.created_at < 2026-08-15T00:00:00Z` — capture time, not quote age |
| zero-membership | the FROZEN workbook records no member for that shipment |
| recorded anchor | `costingContext` resolves an anchor for the shipment or its assembly; absent ⇒ refuse |
| **qualifying quotes** | **1** (DPS-1050), of 11 non-draft quotes holding a frozen freight workbook |

Both refusal directions are asserted, not assumed:

- **Current malformed quotes fail closed structurally, not by predicate.** The
  draft loader never calls the resolver. A live quote with an empty shipment
  contributes nothing and is refused at Send by `loadUnresolvedQuoteCosts`. It
  cannot reach the compatibility path to be exempted by it.
- **`status != draft` is not the discriminator.** A quote frozen at or after
  the boundary is refused even though it is non-draft.
- **No fallback recipient exists.** A frozen record with neither membership nor
  a recorded anchor refuses. The assembly's lowest-position leaf, `createdAt`,
  id, cost share and quoted quantity are all excluded by policy, and none is
  reachable from the resolver.
- **The population cannot grow.** The boundary is a fixed instant, asserted to
  contain no `Date.now()`.

This is historical preservation. It is not current freight policy, and it does
not restore assembly-anchor substitution for anything still being edited.

## What must not happen

Do not refresh a completed historical quote to economics different from what
was sent, accepted and pushed. If a future change makes DPS-1050 read anything
other than 2,400.00 / 4,150.00 on Tier 1, that is a defect in the change, not a
baseline that needs updating.
