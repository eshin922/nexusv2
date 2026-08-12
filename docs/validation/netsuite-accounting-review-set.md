# NetSuite Sandbox Accounting Review Set — target discovery

**Discovery only. Nothing created. No HubSpot write, no NetSuite write.**
Awaiting approval of the four targets before any mutation.

Label every scenario and order: **`NEXUS V1 ACCOUNTING REVIEW — SANDBOX`**

---

## 0 · How A differs from B–D, mechanically

Worth stating first because it determines whether the set is even producible.

`buildGroupingPlan` keys on **`quotes.detail_level`**:

- `turnkey_only` → grouping required → one deterministic Item Group per assembly
- anything else (`itemized`) → `groups: []` → **flat lines, one per leaf**

So A is not "a quote without products". It is the same authoring shape as B–D
with `detail_level = itemized`, which is exactly what makes it a *control*:
Accounting sees the same commercial content projected both ways.

> **Flag for the review, not a blocker.** The OD-022 decision package intends
> `detail_level` to become **presentation-only**. Today it is a *projection*
> control — it decides SO structure. If Accounting signs off on the A/B contrast
> as-is, that contrast is expressed through a field whose governing role is
> scheduled to change. Worth their knowing while they review.

---

## 1 · Recommended targets

All four confirmed **SO-free by explicit per-deal query with status deliberately
not filtered** — a Closed SO never frees a deal (686 consumed deal ids in the
sandbox; none of these four among them).

| | Deal | Company | NS customer | Terms | Sub | BusSeg | Nexus project | Existing content |
|---|---|---|---|---|---|---|---|---|
| **A** flat control | `54020672837` Hanks — Hydration Full Retail Rollout | HANKS | 329665 **ACTIVE** | 50% Deposit/balance at shipment | 2 | 1 | `7d9c22dd` | **0 quotes** |
| **B** single Group | `59153706532` Root — 2 Side Seal Sachets | buildwithroot.co | 360189 **ACTIVE** | 50% Deposit/balance at shipment | 2 | 3 | `3a556d2b` | 1 empty draft |
| **C** multi-Group | `59184980904` Kirby Beauty — Restoring Shampoo & Conditioner | Kirby Beauty LLC | 167468 **ACTIVE** | Net 30 | 2 | 1 | `b24756d0` | 2 empty drafts |
| **D** Group + freight | `59815074352` Nemah — 15ml Nipple and Lip Balm Jar | Nemah | 72173 **ACTIVE** | Net 30 | 2 | 3 | `e063cb17` | 2 empty drafts |

**Commercial disturbance is near zero.** Every existing quote on B/C/D is an
empty draft — `leaves = 0`, `assemblies = 0`. Nothing commercial is displaced;
each review scenario is created alongside them as a new, clearly-labelled one.

**Deliberate spread.** Two Terms values (deposit vs Net 30) and two Business
Segments (1 and 3). The control carrying the *deposit* terms rather than Net 30
is the point: it demonstrates Terms is read from the governed customer record
rather than defaulted.

**Excluded, with reasons:**

- `39286873728` Pattern Beauty — **consumed** by SO2704 (Track B). Not reused.
- `58222880425` Smart Pressed Juice — scored well but carries the S-7
  preservation population and a `ZZ-VALIDATION-*` scenario. Seeding there would
  disturb the baseline this programme depends on.
- 40 cached deals have **no mapped NetSuite customer**; 5 are already SO-blocked.

---

## 2 · Proposed commercial structure

Members drawn from library leaves with proven HubSpot lineage and prior
successful item resolution: **`DPS-BOTTLE-0001` Primary — Bottle** (`hs
34757163109`, used 16×), **`10064-GNX-Box` Genexa — Box** (`hs 2015042158`,
used 8×), **`CC-12oz-Filling-1.4` Coca Cola 12oz Filling** (`hs 2911930393`,
used 8×). Recognisable, non-round-number rates so Accounting can trace each
amount by hand.

### A · Flat / itemized control — `detail_level = itemized`

One Finished Product container, three leaves, **no groups emitted**.

| Line | Item | Qty | Rate | Amount |
|---|---|---|---|---|
| 1 | Bottle | 1,000 | 2.50 | 2,500.00 |
| 2 | Box | 1,000 | 1.25 | 1,250.00 |
| 3 | Filling | 1,000 | 0.75 | 750.00 |
| | | | **Subtotal** | **4,500.00** |

### B · Standard single Item Group — `detail_level = turnkey_only`

One multi-component Finished Product → one deterministic Group.

```
Group  NEXUS-ACCT-B  qty 1,000
  member  Box      qtyPerParent 1  → expands 1,000 @ 1.10 = 1,100.00
  member  Bottle   qtyPerParent 1  → expands 1,000 @ 2.40 = 2,400.00
EndGroup                                      Group total   3,500.00
```

Master quantities are **`qtyPerParent` = 1**, never the tier-expanded 1,000 —
the contract certified in Track B. **No `1,000,000` member quantity may appear.**

### C · Multi-Group, certified asymmetric shape — `detail_level = turnkey_only`

Two Finished Products on one SO, sharing the Bottle at **different negotiated
rates**.

```
Group  NEXUS-ACCT-C-A  qty 1,000
  member  Box      qtyPerParent 1  → 1,000 @ 1.10 = 1,100.00
  member  Bottle   qtyPerParent 1  → 1,000 @ 2.40 = 2,400.00
EndGroup                                    total   3,500.00

Group  NEXUS-ACCT-C-B  qty   500
  member  Bottle   qtyPerParent 1  →   500 @ 2.05 = 1,025.00
EndGroup                                    total   1,025.00
                                       SO subtotal  4,525.00
```

**Why asymmetric rather than two identical groups.** The composition hash keys
on `customer × baseSku × {netsuiteItemId, qtyPerParent}` — **not on rate**. Two
groups with identical member sets would therefore resolve to one shared master,
and the demonstration would collapse into "one group, two rates". Differing
member *sets* guarantee two distinct masters, so Accounting sees genuinely
multiple Groups on one SO **and** the shared Bottle priced independently.

These mint **new** deterministic groups scoped to Kirby's customer `167468`.
They will not reuse Pattern Beauty's `75354 / 75454` — the hash is
customer-scoped by design.

### D · Item Group + Freight / customs — `detail_level = turnkey_only`

```
Group  NEXUS-ACCT-D  qty 1,000
  member  Box      qtyPerParent 1  → 1,000 @ 1.10 = 1,100.00
  member  Bottle   qtyPerParent 1  → 1,000 @ 2.40 = 2,400.00
EndGroup                                    total   3,500.00

Freight shipment · one destination · one break at tier 1,000
  freight  500.00      duty  100.00      tariff  50.00
```

**Every leaf multiplicity is 1.** OD-025 closed at `23a1ef9`, so multiplicity ≠ 1
is now arithmetically safe — but D deliberately stays at 1 anyway, so the
Accounting review does not double as the first field exercise of a
just-repaired code path. One variable at a time.

---

## 3 · Accounting review matrix

Per SO, expected vs observed. Classification vocabulary:
**Nexus-owned · NetSuite-owned/defaulted · manual V1 responsibility · pending
OD-024 · discrepancy requiring disposition**

| Field | Expected classification |
|---|---|
| Customer | Nexus-owned (governed HubSpot company → mapped NS customer) |
| Customer PO | Nexus-owned where present |
| NetSuite Terms | Nexus-owned — read from governed customer record, fails closed |
| Business Segment | Nexus-owned |
| Sales Rep | NetSuite-derived |
| Project Manager | NetSuite-derived |
| Project Services | to classify at review |
| Project Source | Nexus-owned (resolver) |
| Item / Group structure | Nexus-owned |
| Member Items | Nexus-owned |
| Quantity | Nexus-owned — group line qty; members expand |
| Negotiated rate | Nexus-owned |
| Amount | Nexus-owned |
| Item-derived Class | NetSuite-owned/defaulted — derived from Item |
| Freight | Nexus-owned (D) |
| Duty / Tariff | Nexus-owned (D) |
| Subtotal / total | Nexus-owned; must reconcile to Group totals |
| **Ship-to** | **manual V1 responsibility** |
| **PP / SP / SGA / COP + specification fields** | **pending OD-024 — Nexus Specs mapping** |
| Other populated legacy fields | per the SO parity matrix disposition |

**Specifications are NOT to be populated ad hoc.** OD-024 defines the Nexus
specification authority first, then maps it deliberately into the sandbox
fields. Filling them by hand to make a review order look complete would
manufacture exactly the evidence OD-024 exists to produce properly.

---

## 4 · Required HubSpot restoration writes

Each review order drives the Quote lifecycle through Mark Accepted, which pushes
a **deal stage change to HubSpot** using `HUBSPOT_WRITE_ACCESS_TOKEN`. That is
the only HubSpot mutation in the set.

- **4 restoration writes** — one per deal (`54020672837`, `59153706532`,
  `59184980904`, `59815074352`).
- Each deal's `dealstage` is captured **immediately before** its run and
  restored verbatim after, per the Track B precedent.
- No other HubSpot field is written. No production NetSuite account is touched —
  sandbox `7924416-sb2` only.

---

## 5 · Explicitly held

- **Mixed (Finished Product Group + Direct Component flat line)** is **not**
  seeded. Direct Components are not operator-reachable and the chain is not
  closed. Mixed becomes review order **E** after `OD-023 → OD-022`
  (OD-025 is now closed; OD-026 also gates OD-022).
- No manual Item Group creation or wrapping — the certified Nexus path only.
- No fake customer commitments.

---

## 6 · Approval requested

Four targets, four structures. On approval I will build the scenarios, run the
four certifications, capture the expected-vs-observed matrices, and restore the
four HubSpot deal stages.
