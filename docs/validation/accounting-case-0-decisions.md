# Accounting Case 0 — SO2716 review and five policy decisions

For Accounting. Opened 2026-08-19.

Nexus now builds NetSuite Sales Orders from the quote the customer actually
accepted. **SO2716** in sandbox `7924416-SB2` is the first order built that way,
and it is in front of you for review.

Engineering has already proved the order is *faithful to the accepted quote* —
it reconciles to the accepted total exactly, to the cent. That is not what we
are asking you to check. We are asking whether the order is **right**: whether
these are the items you would have chosen, costed the way you need, taxed the
way you expect, and usable by Ops and by month-end.

**Five decisions below are yours, not engineering's.** Each one changes how the
remaining test orders get built, which is why we are asking before building them
rather than after.

---

## SO2716 — what to look at

| | |
|---|---|
| order | **SO2716** · internal `362441` · Pending Fulfillment |
| customer | `388800` ZZ-VALIDATION Nexus Certification Customer |
| quote | DPS-1054 v2 · Tier 2 · 5,000 units |
| commercial total | **$17,175.00** |
| tax (NetSuite-derived) | $1,030.50 |
| **transaction total** | **$18,205.50** |

| # | item | type | qty | rate | amount |
|---|---|---|---|---|---|
| 1 | `76054` ZZ-CERT-KIT-G | Group | 5,000 | — | — |
| 2 | `66476` DPS-BOTTLE-0001 | Inventory | 5,000 | 2.175 | 10,875.00 |
| 3 | — | EndGroup | — | — | 10,875.00 |
| 4 | `59157` OTC-0050 Formulation Services | Non-inventory | **1** | 5,600.00 | 5,600.00 |
| 5 | `26348` OTC-0024 Setup Charge | Non-inventory | **1** | 700.00 | 700.00 |

The two fee lines post at **quantity 1** carrying their whole amount as the
rate. That is deliberate: a one-time charge is one charge, not 5,000 of
anything. It is also new — before this change, **neither fee line appeared on
the order at all**, so an order like this one used to post $10,875.00 and
under-bill by $6,300.00.

---

## Decision 1 · Cost basis on fee and service lines

**What happens today.** Nexus sends a governed cost for *product* lines. On the
member line above, NetSuite shows `rate 2.175` (what we charge) against
`costestimaterate 1.5` (what it costs us) — separate fields, working correctly.

For **fee lines** Nexus sends no cost at all, deliberately: sending zero would
assert to NetSuite that the fee is free, which is a worse claim than silence. So
NetSuite falls back to the item master, and on SO2716 that produced:

| line | cost type | cost rate | sell |
|---|---|---|---|
| Formulation | `LASTPURCHPRICE` | 2,500.00 | 5,600.00 |
| Setup | `ITEMDEFINED` | 0.00 | 700.00 |

**What your own history shows.** Across every OTC-coded line in the account:

| cost type | lines |
|---|---|
| **`CUSTOM`** | **1,276** |
| `ITEMDEFINED` | 14 |
| `LASTPURCHPRICE` | 13 |

So **98% of your existing fee lines carry an explicitly set cost** (`CUSTOM`).
Nexus's fee lines currently land in the 2% minority.

**The decision.** Which do you want?

- **(a)** Nexus sends an explicit cost on fee lines, matching your dominant
  practice. We would need to know *what* cost — fee lines have no unit cost in
  the quote today, so this may mean a new input.
- **(b)** The item master carries the right default and NetSuite's fallback is
  fine — accept `LASTPURCHPRICE 2500` on a $5,600 service.
- **(c)** Fee lines should carry no cost basis at all, and the item masters
  should be changed so the fallback resolves to nothing.

---

## Decision 2 · Tax without an explicit tax code

**What happens today.** Nexus deliberately does **not** send a `taxCode`.
NetSuite derives tax per line from the customer and ship-to. On SO2716 that
produced one tax line at 6% — **$1,030.50** — bringing the transaction to
$18,205.50 against a commercial total of $17,175.00.

**What your own history shows.** Every recent Sales Order carries a tax line —
we checked back to March 2026 and found no exceptions. Most carry one; a few
(SO2638, SO2625, SO2619, SO2586, SO2581, SO2582) carry five, presumably
multi-jurisdiction. SO2716 matches the common shape.

**The decision.** Is deriving tax the production behaviour you want, or should
Nexus send an explicit tax code in some or all cases? Note that hardcoding one
would override NetSuite's own derivation on exactly the lines most likely to
need it — out-of-state OTC and tooling.

---

## Decision 3 · Which item governs Tooling

Two candidates. They are **not** distinguishable by name:

| item | id | name | lines | first used | last used |
|---|---|---|---|---|---|
| `OTC-0005` | 4077 | OTC - Tooling | 23 | 9 Nov 2023 | 27 Mar 2026 |
| `OTC-0046` | 54062 | OTC - Tooling | 15 | 11 Oct 2024 | 18 Mar 2026 |

Both Non-inventory, both active, both used within nine days of each other in
March 2026.

We settled the Formulation mapping this way — `OTC-0050` replaced `OTC-0018`
because usage moved cleanly from one to the other in mid-2025. **That does not
work here.** Both tooling items are live.

**The decision.** Either they mean different things — in which case tell us what
distinguishes them, and Tooling may need per-line selection (see Decision 5) —
or one is a duplicate that should be consolidated.

---

## Decision 4 · Which item governs Artwork

⚠️ **We told you earlier that no artwork item existed and that you would have to
create one. That was wrong, and we are correcting it before you act on it.** The
search used the single term "ARTWORK"; the item is named "Art / Prep / Proof".

| item | id | name | lines | first used | last used |
|---|---|---|---|---|---|
| `OTC-0001` | 11012 | OTC - Art / Prep / Proof | 29 | 22 Dec 2023 | 17 Jul 2026 |
| `OTC-0030` | 35159 | OTC - Hard Proof | 2 | 25 Apr 2024 | 3 Oct 2025 |
| — | 66073 | Outsourced Art/Prep/Proof | 1 | 9 Jul 2025 | 9 Jul 2025 |

**The decision.** `OTC-0001` is the obvious governing item on usage. But it
covers art, prep **and** proof as one charge, while BV-011 treats Artwork as its
own destination. Does that single item satisfy the Artwork destination, or do
art / prep / proof need to separate — and is "Outsourced" a different accounting
treatment or just a description?

---

## Decision 5 · Firm-wide mapping vs per-line selection

This is the decision with the widest blast radius.

BV-011 maps each destination to **one** NetSuite item firm-wide. That works when
a destination means one thing. For four destinations it clearly does not — and
in each case the alternatives are **all concurrently in use**, not legacy:

**Testing**

| item | name | lines | last used |
|---|---|---|---|
| `OTC-0016` | Micro Testing | 76 | 28 Jul 2026 |
| `OTC-0010` | Testing | 27 | 11 Feb 2026 |
| `OTC-0055` | HRIPT Testing | 1 | 10 Jul 2026 |
| `OTC-0031` | Re-Test | 1 | 19 Dec 2023 |

**Dies**

| item | name | lines | last used |
|---|---|---|---|
| `OTC-0002` | Cutting Die | 20 | 9 Jun 2026 |
| `OTC-0009` | Emboss Dies | 5 | 27 Mar 2026 |
| `OTC-0007` | Foil Dies | 5 | 14 May 2026 |
| `OTC-0019` | Cutting Die 2 | 2 | 9 Jun 2026 |

**Samples** — note two items *both* named "OTC - Samples"

| item | name | lines | last used |
|---|---|---|---|
| `OTC-0013` | Samples | 20 | 27 Mar 2026 |
| `OTC-0017` | Pre-Production Sample | 14 | 15 Dec 2025 |
| `OTC-0039` | Samples | 6 | 17 Jul 2026 |

**Cartons** and **Print plates**

| item | name | lines | last used |
|---|---|---|---|
| `OTC-0053` | Master Carton | 4 | 11 Jun 2026 |
| `OTC-0054` | Inner Carton | 4 | 11 Jun 2026 |
| `OTC-0004` | Printing Plates | 73 | 9 Jun 2026 |
| `OTC-0032` | Plates/Cylinder | 10 | 17 Jul 2026 |

Forcing one firm-wide item per destination would collapse a Foil Die and a
Cutting Die onto the same line, or a Master and an Inner Carton — losing
information you currently keep.

**The decision.** For each of Testing, Dies, Samples, Cartons and Print Plates:
firm-wide mapping, or **per-line selection**?

Per-line selection already exists and is proven — it is how `OTC - Other
Service` works: the operator picks the NetSuite item on the quote line, and the
choice is frozen at send. Extending it to these destinations is configuration,
not new architecture.

---

## What happens after you decide

1. We map only destinations whose meaning is settled.
2. We build the Direct Product and Mixed-structure test orders (neither needs a
   mapping decision).
3. Tooling/Artwork gets built only once decisions 3 and 4 land.
4. Freight/Logistics gets built once you confirm `OTC-0012` (Freight, Duties,
   Tariffs) and `OTC-0036` (Customs) — both single clean candidates.
5. We walk the remaining orders in sandbox and bring them to you the same way.

Nothing is built against a guess.

---

## Notes on how these numbers were produced

Every figure above is read from NetSuite or from the frozen quote record; none
is recomputed. The queries live in
`scripts/gate-1b/accounting-decision-evidence.ts` and are read-only — they map
nothing, create nothing and post nothing. Re-runnable at any time.

The Decision 4 correction is the reason that script now runs six independent
search terms behind a control query. A search that returns nothing tells you
about the search, not about the catalog.
