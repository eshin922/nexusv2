# OD-004 / Track B — SO2703 failed run (negative certification evidence)

> **This is the FAILED run. It is retained deliberately.** Track B was
> subsequently certified on SO2704 — see
> [`reg-4-track-b-certification.md`](reg-4-track-b-certification.md) for the
> closure record.
>
> SO2703 is the evidence that the verification gate **refused an incorrect
> quantity-expansion model before any unsafe rate PATCH occurred**. It
> demonstrates the safety properties a passing run cannot: whole-plan refusal on
> structural mismatch, `awaiting_rates` retention with the SO id, and no second
> CREATE. Its defective Item Groups `75156` / `75254` remain inactive, still
> holding `qtyPerParent = 1000`, as the before/after record against `75354` /
> `75454`.
>
> Do not delete, reactivate, or re-quantify any of it.


Target: **Deal `55307858178` — Ro - GLP-1 Epson Proofs** (Roman Health Ventures, Inc)
Nexus project `534bda3b-9516-456f-b272-22d392f51920`
Quote `663b4dc2-6b62-4145-af9d-377bec24c7a5` · scenario **OD004 Grouped Certification** · **DPS-1046**

## HubSpot restoration reference (live, re-captured pre-Accept)

| field | value |
|---|---|
| dealstage | `195274339` |
| amount | `1000` |
| closedate | `2026-02-02T20:39:28.119Z` |
| hs_lastmodifieddate | `2026-07-17T13:56:52.365Z` |
| dealname | Ro - GLP-1 Epson Proofs |

## Fixture (built through governed Nexus UI/actions)

Tier 1 · qty **1,000** · `turnkey_only` (frozen in send snapshot `c04aad30-5d6e-4ee8-99c3-0ef5fe39ece0`)

| ASY | leaf | NS item | cost | markup | rate | qty | amount |
|---|---|---|---|---|---|---|---|
| OD004-CERT-A | 10064-GNX-Box | 1024 | 3.00 | 100% | **6.00** | 1000 | 6,000 |
| OD004-CERT-A | DPS-BOTTLE-0001 | 66476 | 2.00 | 100% | **4.00** | 1000 | 4,000 |
| OD004-CERT-B | DPS-BOTTLE-0001 | 66476 | 1.00 | 100% | **2.00** | 1000 | 2,000 |

Bottle repeated across both groups at **different negotiated rates** ($4 vs $2) — the mandatory hard case.
Tier revenue **12,000**; blended margin **50%** (target 35 / floor 25).

## Deterministic identities (customer-scoped, customer 11377)

- Group A `OD004-CERT-A` → `nxs-grp-ab43fdecdfd9571973897c48c84ec7e722183fcb4833753b9c123002f387d3c6` — expected amount **10,000**, turnkey unit 10
- Group B `OD004-CERT-B` → `nxs-grp-84ee70d64ae51f6aaeb05ea5531f325ac5e78ef1e8161954a0fdbc6986272377` — expected amount **2,000**, turnkey unit 2

## Pre-Accept prerequisite chain — all PASS

- customer 11377 · active · subsidiary 2 · terms 2
- items 1024 / 66476 · active · InvtPart · **base price 0 at level 1** (Probe 6 prerequisite)
- plan derivable = true · groupingRequired = **true** · 2 groups
- reconcile: groupSum 12,000 = tier revenue 12,000
- collisions on planned identities: **0**
- existing Sales Orders on deal: **0**

## Post-CREATE — gate REFUSED. Defect found. Do not repair without disposition.

**Sales Order `361341` / `SO2703`** created against customer 11377, deal
55307858178, status B (Pending Fulfillment), **total 0**.

Push attempt `84c3992e` — status **`awaiting_rates`**, `netsuite_so_id=361341`,
**1 attempt, no duplicate CREATE**. Quote remains `accepted` (not `complete`).

### The recovery contract behaved exactly as designed

- CREATE succeeded → recovery boundary persisted the SO id **before** anything
  else could fail.
- Gate failed → attempt held at `awaiting_rates`, **not** `failed` (Step 1
  invariant).
- Structural mismatch → `planRateConvergence` refused the **whole** plan, so
  **zero** PATCHes were issued. Nothing was written into a structure that did
  not match the plan (Step 3 Test 11 behaviour, in production).
- Operator message named commercial incompleteness and stated the retry
  resumes against the same order.

### Root cause — Item Group member quantity is a PER-GROUP MULTIPLIER

Created group member definitions:

| group | itemid | member | member qty written |
|---|---|---|---|
| 75156 | OD004-CERT-A-G | 1024 | **1000** |
| 75156 | OD004-CERT-A-G | 66476 | **1000** |
| 75254 | OD004-CERT-B-G | 66476 | **1000** |

SO lines (SuiteQL, independent of the REST read-back; SO sign convention):

```
seq 1  item 75156 (group A)   qty -1000
seq 2    member 1024          qty -1000000   rate 0
seq 3    member 66476         qty -1000000   rate 0
seq 5  item 75254 (group B)   qty -1000
seq 6    member 66476         qty -1000000   rate 0
```

NetSuite multiplies **group-line quantity × member-definition quantity**.
We wrote the tier-multiplied quantity (1000) into the group *definition* AND
sent 1000 on the group line → `1000 × 1000 = 1,000,000` per member.

**Correct model:** the group definition carries the per-one-group quantity
(1 Box + 1 Bottle for A; 1 Bottle for B); the SO group line carries the tier
quantity (1000); members expand to 1000 each.

The defect is in the plan→group adaptation (`adaptPlannedGroup` /
`grouping-plan`), which passes `quantity = tierQty × qtyPerParent` into the
member definition where a per-parent quantity belongs.

### Consequence that must be dispositioned before any repair

**The composition hash includes member quantities.** Changing member quantity
`1000 → 1` changes **both external ids**. Groups `75156` and `75254` are
therefore not merely mis-populated — under the corrected hash they will never
be reused, and become orphan deterministic-identity records holding the
*current* `nxs-grp-ab43…` / `nxs-grp-84ee…` strings.

Open questions for Edward:

1. Is per-one-group quantity the correct member semantic (confirmed by this
   evidence), and does the hash therefore key on per-parent quantity?
2. Repair path: PATCH the two existing groups' member quantities to 1 and
   accept that their external ids no longer match their composition, or create
   correctly-hashed groups and retire 75156 / 75254?
3. SO 361341 / SO2703 carries mis-expanded lines at $0.00. Retry-in-place
   against the same SO (per the recovery contract) requires the group
   definitions to be corrected first, since the SO expands whatever the group
   currently says.

Also noted: the failed attempt recorded `error_class = 'unknown'`. A
gate-refusal is a distinct, well-understood class and probably deserves its own
value.

### Disposition executed (2026-08-12)

**Quantity contract confirmed:** Item Group master data carries per-one-group
member quantities; the SO group line carries the tier quantity; NetSuite
expands to their product. Repaired in `f410983` — `PlannedMember.qtyPerParent`
feeds the definition and the hash; `quantity` stays the transaction figure.

**Identity:** hash now keys on per-parent quantity. Old external ids
deliberately not preserved — they described a composition that was never real.

**Groups 75156 / 75254:** marked **inactive** (verified `isinactive = T`),
external ids and member quantities left exactly as created, **not deleted** —
they remain SO2703's evidence. Not PATCHed to quantity 1, which would have made
their identity lie about their contents.

**SO2703:** untouched. Preserved as the failed-certification artifact. Not
made complete by editing the master definitions underneath it — there is no
established contract that an Item Group edit re-expands an existing order.

**Error class:** post-CREATE gate refusal now records `verification`, not
`unknown`. The 0065 release predicate is unchanged; a non-null SO id already
prevents `failed`, so the class is excluded by the invariant, not by widening
the rule.

**HubSpot deal 55307858178:** restored and verified live — stage `195274339`,
amount `1000`, closedate `2026-02-02T20:39:28.119Z`. Stage came back via the
governed inverse (`unmarkAccepted`); amount and closedate needed the narrow
direct repair, since HubSpot had auto-advanced closedate to the close-won date.
The Nexus quote was rolled back to `sent` and will not be resumed.

**Regressions:** 10 new proofs in
`tests/unit/grouped-so-quantity-expansion.test.ts`. Governed suite 941/941.

### Certification verdict

**REG-4 / Track B: NOT closed.** The grouped path is proven to the point of
group creation and group-line emission; it is **not** proven commercially
complete. The quantity-expansion semantic was the one thing the disposable
provider probe was meant to settle and it was encoded wrong — found by the
certification, which is what the certification is for.

What IS proven by this run:
- deterministic identity derivation, creation, and external-id assignment
- bare Item Group CREATE on a Sales Order (no explicit member lines)
- group expansion by NetSuite
- the full durable-attempt recovery contract under a real failure
- the success gate reading provider state and refusing a non-conforming order
- no duplicate CREATE, no partial rate writes
