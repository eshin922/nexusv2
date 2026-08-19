# PR #300 — frozen commercial line set · lifecycle certification

Run 2026-08-19 against the certification customer lineage
([`certification-customer-lineage.md`](certification-customer-lineage.md),
OPEN_DECISIONS CERT-1). No client project was touched.

| | |
|---|---|
| project | `d9dc519a-9965-4dd2-8b4a-f48cf2bf5a7a` · ZZ-VALIDATION — Nexus Certification Lineage |
| quote | `97d25286-2c42-4a72-8979-89f1a5c2cf26` · CERT-300 frozen line set |
| quote number | **DPS-1054** · sent 2026-08-19 00:07:47Z |

## What the fixture deliberately contains

- a normally priced Item Group line — `DPS-BOTTLE-0001` inside `ZZ-CERT-KIT`,
  priced at all three tiers
- a Direct Service priced on early tiers — `SVC-FORMULATION`, Tiers 1–2
- the same service left **`quote_on_request`** at Tier 3
- separately billed OTC — allocation OFF on the group
- **tier-varying OTC amounts** — Setup entered as 100 / 500 / 1000

The varying Setup is the load-bearing part: three distinct values down one
column is something the retired MAX-across-tiers fold could not produce.

**One requirement was not met, and is stated rather than glossed.**
Allocation is uniformly OFF, not varying by tier. The `allocate_service_fees_to_cost`
flag is stored per (assembly, tier) but the operator surface writes it as a
**per-assembly policy fanned out to every tier**, so a per-tier split is not
reachable through the UI. Per-tier allocation is covered by unit proof 4b
(`tests/unit/frozen-commercial-line-set.test.ts`), which fails if the OR fold
is reintroduced. It is not covered by this live walk.

## Pre-SEND expectation, recorded before sending

```
Production markup 40.0%   (BV-013)

tier      qty     unit_subtotal   otc_subtotal   tier_commercial_total  from
Tier 1   1000           7100.00         140.00                7240.00
Tier 2   5000          16475.00         700.00               17175.00
Tier 3  10000          17400.00        1400.00               18800.00  yes

SVC-FORMULATION Formulation   direct_service      4200.00   5600.00  on request
DPS-BOTTLE-0001 Primary-Bottle item_group_member   2900.00  10875.00    17400.00
ZZ-CERT-KIT Setup             otc                   140.00    700.00     1400.00
```

Service: 3000 × 1.4 and 4000 × 1.4. OTC: 100/500/1000 × 1.4. The markup is the
governed `Production` rate, read through the same resolution the engine used.

## The customer artifact, as rendered

|  | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Formulation | $4,200.00 | $5,600.00 | **quote on request** |
| Primary · Bottle | $2,900.00 | $10,875.00 | $17,400.00 |
| **Turnkey total** | **$7,240.00** | **$17,175.00** | **from $18,800.00** |
| per unit | $7.24 | $3.44 | from $1.88 |

One-time fees · Setup **$140.00**, captioned *"Fees shown for Tier 1 (1k units).
Per-tier amounts available on request."*

Both new copy paths fired on real data: the caption appears **because** the fee
differs across tiers, and the INCLUDES note omits a single dollar figure for the
same reason — a fee that varies cannot be stated once for a row of columns.

## Check 4 · the persisted record

Frozen matrix, read back from `quote_snapshot_*`:

```
tier      qty    unit_subtotal   otc_subtotal   tier_commercial_total  provisional
Tier 1   1000         7100.00         140.00                7240.00  false
Tier 2   5000        16475.00         700.00               17175.00  false
Tier 3  10000        17400.00        1400.00               18800.00  true

SVC-FORMULATION   direct_service     Tier 1  priced              4.2000     4200.00   —
SVC-FORMULATION   direct_service     Tier 2  priced              1.1200     5600.00   —
SVC-FORMULATION   direct_service     Tier 3  quote_on_request         —           —   —
DPS-BOTTLE-0001   item_group_member  Tier 1  priced              2.9000     2900.00   —
DPS-BOTTLE-0001   item_group_member  Tier 2  priced              2.1750    10875.00   —
DPS-BOTTLE-0001   item_group_member  Tier 3  priced              1.7400    17400.00   —
ZZ-CERT-KIT Setup otc                Tier 1  priced            140.0000      140.00   separately_billed
ZZ-CERT-KIT Setup otc                Tier 2  priced            700.0000      700.00   separately_billed
ZZ-CERT-KIT Setup otc                Tier 3  priced           1400.0000     1400.00   separately_billed
```

```
PASS  exactly one current snapshot matrix for this send
PASS  Tier 1/2/3: total = Σ its own priced cells        7240 · 17175 · 18800
PASS  Tier 1/2/3: tier_commercial_total = unit + OTC
PASS  pricing_state agrees with amount nullity on every cell   violations=0
PASS  at least one cell is explicitly quote_on_request         qor=1 priced=8
```

Every displayed figure, name and SKU matches the artifact; `total_is_provisional`
is true on Tier 3 alone, matching the PDF's single `from`.

## Check 5 · immutability against live economics

Inside a rolled-back transaction: every packaging unit cost moved by +99.99,
every service-fee column by +5000, allocation inverted, global price adjustment
+0.25, target margin 0.99, and the governed `Production` markup default set to
0.9.

```
PASS  the mutation really landed inside the transaction   3 cost cells moved
PASS  frozen matrix byte-identical after live costs, markup and settings moved
      e6590acbfcb2bbec… vs e6590acbfcb2bbec…
PASS  and unchanged outside the transaction (rollback clean)
```

The digest covers **every persisted field** — position, kind, names, service
identity, tier label, quantity, pricing state, rate, amount, allocation. A spot
check on a total would pass while a rate underneath it moved.

The rollback mechanism was itself verified against this database before any
destructive statement ran (`rollback-selftest.ts`): a write visible
in-transaction, absent after. An unverified rollback executing destructive
statements against the shared database is an assumption with a blast radius,
not a safeguard.

## Check 6 · ACCEPT selects, it does not recompute

Simulated in a rolled-back transaction. The real path fires a **production
HubSpot deal-stage push**, and while this lineage's deal is a validation deal,
the transition was not exercised — the requirement was a selection proof, and a
selection proof does not need the transition.

```
PASS  accepting Tier 1 reads exactly its frozen total   7240 = 7240.00
PASS  accepting Tier 2 reads exactly its frozen total  17175 = 17175.00
PASS  accepting Tier 3 reads exactly its frozen total  18800 = 18800.00
PASS  …and each leaves every other frozen tier untouched
PASS  with no accepted tier the read is null, never a substituted recomputation
```

`readAcceptedCommercialTotal` imports no costing module and calls no bundle;
the number is read from the frozen column or it is null.

## Check 7 · nothing historical was rewritten

Restated as an ordering claim, because "the tables are empty" stopped being the
right assertion the moment the first certification send landed:

```
with frozen matrix        1 snapshot   2026-08-19 00:07:47Z
without frozen matrix    21 snapshots  2026-07-28 .. 2026-08-13
```

The boundary is clean in both directions: no snapshot predating the freeze
acquired rows, and the one sent after it has them. A backfill would have stamped
today's corrected OTC arithmetic onto documents customers already received.

## No Sales Order

```
quote_number DPS-1054   status sent
netsuite_so_id  —   tranid  —   push_status  —
audit: created=1  quote_sent=1
```

The #293 Direct Service projection gate is untouched by this slice — `git diff
origin/main...HEAD` reports no change under `src/lib/netsuite/`.

## Suite

1682/1682 · `tsc --noEmit` clean · `verify:gate-1b-types` clean.
