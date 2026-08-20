# Accounting UAT matrix — what is executable now

Recomputed 2026-08-19 against live mapping state, after #305 (`6fb6f3b`) and
SO2721. Derived by `scripts/gate-1b/uat-destination-reachability.ts` rather than
read off the earlier plan, because the mappings moved since it was written.

---

## The finding that reorders the matrix

**A destination only matters if a quote can produce it.** Computing that from
the code rather than from the destination list changes what "blocked on
mappings" means:

```
producible destinations : 8 of 16
real mapping gaps       : otc_packout   (producible, unmapped, would refuse)
```

`otc` lines have exactly ONE source — `OTC_FEES` over assembly-owned production
rows — plus the five Direct Service identities. Nothing else emits a commercial
line. The other **eight** destinations have no producing input at all:

`otc_raws` · `otc_freight_duties_tariffs` · `otc_customs` · `otc_dies` ·
`otc_print_plates` · `otc_samples` · `otc_processing_fee` · `otc_cartons`

They are not waiting on a NetSuite item. They are waiting on a **decision that
the charge should become a quote line**, which is business design, not mapping.

---

## Matrix status

| # | case | status now | what it needs |
|---|---|---|---|
| 1 | Direct Product | **EXECUTABLE** | fixture only — no mappings |
| 2 | Turnkey Item Group | **COVERED** — SO2716 | — |
| 3 | Direct Service | **COVERED** — SO2716, SO2718, SO2721 | — |
| 4 | Item Group + separately billed OTC | **COVERED** — SO2716 | — |
| 5 | Tooling / Artwork split | **NOW EXECUTABLE** | fixture only |
| 6 | Mixed commercial structure | **EXECUTABLE** | fixture only |
| 7 | Freight / logistics | **BUSINESS DESIGN** | not a mapping gap |
| 8 | Pack-out / Assembly Direct Service | **BLOCKED ON ONE MAPPING** | `otc_packout` |

### Case 5 is unblocked

It was blocked on an ambiguous Accounting choice. Both halves are now mapped:

```
otc_tooling  → OTC-0005  / 4077
otc_artwork  → OTC-0001  / 11012   "OTC - Art / Prep / Proof"
```

Nothing further is needed but a fixture carrying separate tooling and artwork
amounts. A quote still holding the LEGACY COMBINED `toolingArtworkTotal` will
keep refusing with `legacy_combined_otc` — correct behaviour, and the case is
partly there to prove it.

### Case 7 is not what the plan said

The earlier plan listed Freight as "blocked on mappings — `otc_freight_duties_
tariffs` ❌ `otc_customs` ❌". That understates it. **Freight never becomes a
commercial line.** It is landed into unit cost, which is the Item Group doing
its job — `mark-complete.ts:823` describes exactly that: *"a single turnkey line
($X per unit) … with freight/customs invisible"*.

So mapping those two destinations would change nothing: no quote input produces
a line that could carry them. Case 7 needs a business decision first — whether
freight, duty and customs are ever separately billable, and if so what quote
input creates the line. Only then is a mapping meaningful.

### Case 8 is new, and is the one true mapping gap

A **Pack-out / Assembly** Direct Service is fully authorable today — it is one
of the five governed identities, and the Costs surface accepts it. Its
destination `otc_packout` is neither per-line nor firm-mapped, so a quote
carrying one would refuse at push with `unmapped_destination`, pointing an admin
at Settings.

That is correct behaviour and a genuine gap: unlike the eight unreachable
destinations, this one an operator can reach today. It needs one Accounting
choice — which NetSuite item Pack-out / Assembly posts to — and then it is
executable with no code change.

---

## Summary

| | count | cases |
|---|---|---|
| already covered by a durable witness | 3 | 2, 3, 4 |
| executable now, fixture only | 3 | 1, 5, 6 |
| blocked on one Accounting mapping | 1 | 8 (`otc_packout`) |
| requires business design | 1 | 7 (freight) |

**Six of eight are executable or done.** One needs a single mapping choice; one
needs a design decision that no mapping can substitute for.

---

# FINAL DISPOSITIONS — 2026-08-19

## Case 7 · Freight / duties / customs — RECLASSIFIED as covered

**V1 disposition:** freight, duties and customs stay inside turnkey / unit-cost
economics. No separately billed commercial lines during Accounting UAT.

Case 7 is therefore **covered by current unit-cost / turnkey behaviour**, not
blocked. Separately billed freight/logistics is **out of V1 scope** and requires
a future commercial-design decision.

This also settles the four unmapped freight-adjacent destinations
(`otc_freight_duties_tariffs`, `otc_customs`, and by the same reasoning
`otc_raws`) — they stay unmapped because nothing should produce them in V1.
Mapping them would assert a capability the commercial model does not have.

## Case 8 · Pack-out / Assembly — the one open Accounting ask

**`otc_packout` needs a NetSuite item.** It is the only destination that is
producible today and has nowhere to post: a Pack-out / Assembly Direct Service
is one of the five governed identities, authorable on Costs right now, and a
quote carrying one refuses at push with `unmapped_destination`.

Nothing else is required — no code change, no schema change. Once Accounting
names the item, the mapping is an admin write and the fixture walk follows.

Candidate discovery: `node … scripts/gate-1b/ns-destination-candidates.ts`.

## Remaining executable work

| # | case | state |
|---|---|---|
| 1 | Direct Product | build + walk |
| 5 | Tooling / Artwork split | build + walk |
| 6 | Mixed commercial structure | build + walk |
| 8 | Pack-out / Assembly | build + walk **after** the mapping lands |

## Durable witnesses — preserved, not rebuilt

| SO | role |
|---|---|
| SO2716 | F1/F4 grouped + Direct Service / OTC baseline |
| SO2717 | **negative** — REG-4 exact, line shape wrong |
| SO2718 | pure Direct Service positive witness |
| SO2721 | terminal integrated: frozen shape + CUSTOM cost + non-taxable + per-line selection + Custom price level |

## Release sequence after the matrix is green

1. MS OAuth / Entra SSO closure
2. below-margin authorization re-certification under final authenticated identities
3. full V1 regression sweep + harness rejuvenation
4. release readiness

**The V1 sweep does not start before 1 and 2 are closed.**
