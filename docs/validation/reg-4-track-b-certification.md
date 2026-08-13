# REG-4 / Track B — **CLOSED**

**Certified 2026-08-12 on real NetSuite sandbox provider evidence.**

> REG-4 / Track B is certified on real NetSuite sandbox provider evidence. Nexus
> deterministically creates/verifies Item Group master definitions, creates the
> grouped Sales Order, converges expanded members to the frozen negotiated
> commercial rates, verifies the resulting provider state, and reaches success
> only when composition, quantities, rates and totals match the accepted Nexus
> commercial structure.

**Do not reopen Item Group architecture absent new contradictory provider
evidence.**

---

## 1 · Certification artifacts

| artifact | identity |
|---|---|
| Sales Order | **SO2704** · internal id **`361441`** |
| Item Group A | **`75354`** · `OD004-CERT-A-G2` |
| Item Group B | **`75454`** · `OD004-CERT-B-G2` |

Quote `7bba3cdd-b791-4a48-bda6-1262ae26457a` · **DPS-1047** · scenario
"OD004 Final Grouped Certification" · project `10549d52` · deal `39286873728`
(Pattern Beauty · All Over Body Balm).

---

## 2 · Master-data boundary — verified BEFORE Sales Order CREATE

Nexus read each Item Group definition back from the provider and verified it
against the frozen plan **before any Sales Order referenced it**.

**Group A** — `nxs-grp-61d1321f5dc9360e5e04d38ca2ae30a536bbe36ebc0b2a7d569cd7258f3bc08b`

- `1024` (10064-GNX-Box) × **1**
- `66476` (DPS-BOTTLE-0001) × **1**

**Group B** — `nxs-grp-fa6c4b39ba1d875f981936d66b9edafc828df03f7029c5535a57c9bc3bfcfa87`

- `66476` (DPS-BOTTLE-0001) × **1**

Both `outcome: "created"`. Both identities matched the pre-approved strings
exactly — computed from the frozen plan before the transaction was authorised,
not derived from what NetSuite happened to return.

The audit row for `quote_completed` carries these explicitly under
`diff_json.netsuite.item_group_definitions`, recorded as **`qtyPerParent: 1`**,
**written before the Sales Order existed**:

```json
[{ "assemblySku": "OD004-CERT-A", "itemidDisplay": "OD004-CERT-A-G2",
   "netsuiteInternalId": "75354", "outcome": "created",
   "netsuiteExternalId": "nxs-grp-61d1321f…",
   "members": [ { "netsuiteItemId": "1024",  "qtyPerParent": 1 },
                { "netsuiteItemId": "66476", "qtyPerParent": 1 } ] },
 { "assemblySku": "OD004-CERT-B", "itemidDisplay": "OD004-CERT-B-G2",
   "netsuiteInternalId": "75454", "outcome": "created",
   "netsuiteExternalId": "nxs-grp-fa6c4b39…",
   "members": [ { "netsuiteItemId": "66476", "qtyPerParent": 1 } ] }]
```

This evidence exists because of the boundary shipped in `76dbe09`, which made
the definition read-back **unconditional** — created groups as well as reused
ones. SO2703's groups were freshly created and therefore trusted; that is the
gap this record closes.

---

## 3 · Transaction expansion — definition is not the transaction

Provider read-back of SO2704:

```
seq 1   group 75354                qty 1,000
seq 2     member 1024   qty 1,000  @ $6  =  $6,000   class 10
seq 3     member 66476  qty 1,000  @ $4  =  $4,000   class 1
seq 4     EndGroup                        = $10,000
seq 5   group 75454                qty 1,000
seq 6     member 66476  qty 1,000  @ $2  =  $2,000   class 1
seq 7     EndGroup                        =  $2,000
```

**Proves the contract:**

```
master qtyPerParent 1  →  SO Group qty 1,000  →  expanded member qty 1,000
```

**Falsifies the prior defective model:**

```
master qty 1,000  ×  SO Group qty 1,000  →  1,000,000
```

**No transaction member quantity ≥ 1,000,000 exists** on this order — asserted
explicitly against every line, not inferred from the totals.

---

## 4 · Commercial correctness

| | |
|---|---|
| Customer | **`122859`** (Pattern Beauty) |
| HubSpot deal | **`39286873728`** |
| Business Segment | **`3`** |
| NetSuite Terms | **`2`** |
| Item-derived Class — Box `1024` | **`10`** |
| Item-derived Class — Bottle `66476` | **`1`** |
| Group A | **$10,000** |
| Group B | **$2,000** |
| SO total | **$12,000** |

The repeated Bottle carries **$4 in Group A and $2 in Group B** — the same
NetSuite item at two different negotiated rates, on two distinct provider
addresses. This was the mandatory hard case: it is what makes wrong-member
grouping detectable rather than merely reconcilable.

**No governed commercial member remains $0.00.** The `$0.00` base price is a
legal placeholder for group expansion; every member was converged off it.

**SuiteQL independently corroborated the final provider state** — a second read
path, not a re-read of the same REST response:

```
total 12000 · tranid SO2704 · entity 122859 · terms 2 · bus_seg 3 · deal 39286873728
1024  qty 1,000 rate 6 amount 6,000 class 10
66476 qty 1,000 rate 4 amount 4,000 class 1
66476 qty 1,000 rate 2 amount 2,000 class 1
```

---

## 5 · Lifecycle and recovery

- **One** durable attempt (`6cc40390-3eb2-45e3-aa38-92aa4c61cf82`)
- SO identity persisted at the recovery boundary — `361441` / `SO2704`
- Negotiated-rate convergence completed **against the same Sales Order**
- **No duplicate CREATE**
- Provider-state verification gate **PASSED**
- Final push status **`succeeded`** · `error_class` **`null`**
- Quote transitioned `accepted → complete`

---

## 6 · SO2703 — negative certification evidence

**Carried forward deliberately.** SO2703 (`361341`) is the failed run in which
the same gate **refused the incorrect quantity-expansion model before any
unsafe rate PATCH occurred**.

It proves the safety properties that a passing run cannot demonstrate:

- the gate reads **provider state**, not what was sent
- a structural mismatch refuses the **whole** plan — zero PATCHes were issued,
  including against the sound sibling group
- the attempt held at **`awaiting_rates`**, never `failed`, with the SO id
  retained
- **no second CREATE** was possible

Its defective groups `75156` / `75254` remain **inactive**, still holding their
`qtyPerParent = 1000` definitions. Read beside `75354` / `75454` they are the
before/after record of the defect and its repair, in the provider's own data.

Full record: [`od-004-so2703-certification-record.md`](od-004-so2703-certification-record.md).

---

## 7 · HubSpot restoration — verified live

Pattern Beauty deal `39286873728` restored exactly:

| field | value | |
|---|---|---|
| stage | `195274340` | PASS |
| amount | `25000` | PASS |
| closedate | `2027-01-01T18:39:50.436Z` | PASS |

Acceptance had moved it to `195607084` / `$12,000` / same-day close. The quote
is `complete`, so the governed inverse (`unmarkAccepted`, which requires
`accepted`) was unavailable and all three fields took the narrow direct repair.

---

## 8 · Preserved evidence — do not delete or normalize

- **SO2704** (`361441`) — the successful grouped Sales Order
- Item Groups **`75354`** / **`75454`** — the deterministic identities
- **SO2703** (`361341`) — failed certification evidence
- Item Groups **`75156`** / **`75254`** — inactive defective definitions

None of these may be deleted, reactivated, re-quantified, or tidied for
cleanliness. They are the evidence chain.

---

## 9 · Evidence notes (recorded; not blockers)

1. The **ad-hoc REST evidence script** printed `addr` / `kind` as `undefined`
   because it did not route through the executor's `normalizeStructure` path.
   The production executor demonstrably targeted the three correct provider
   addresses — proven by the resulting `$6 / $4 / $2` rates landing on the
   right members. A defect in a throwaway reporting script, not in the path
   under certification.
2. The initial **`derivable=false`** pre-Accept result came from a stale copy of
   the verification script that predated the quantity repair and built plan
   lines without `qtyPerParent`. The hash correctly refused an absent quantity.
   Re-run with the field supplied, the plan derived both approved identities.
   A defect in the verification harness, not the product path.

Both are recorded because a future reader finding them in the transcript should
not have to re-derive that they were harness faults.

---

## 10 · Carried forward — NOT a Track B closure condition

> **Operators must understand when a Finished Product / ASY structure is
> required, and that this structure governs downstream NetSuite Item Group
> composition.**

This is the next **Product Library / V1 operator-workflow** item. Track B
certifies that the machinery is correct given a correct structure; it does not
certify that operators can tell when one is needed. Tracked separately.
