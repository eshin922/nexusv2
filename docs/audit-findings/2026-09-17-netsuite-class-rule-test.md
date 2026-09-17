# Testing the candidate Class rule against the data

**2026-09-17 · read-only, sandbox. No production write, no migration, no field,
no class created, renamed, merged or reclassified. Nothing changed.**

Continues `2026-09-17-netsuite-class-structure-audit.md`, which established the
account's shape. This tests the rule.

> **Followed by [`2026-09-17-netsuite-class-gap-evidence.md`](2026-09-17-netsuite-class-gap-evidence.md)**,
> which fills in the populations behind the gaps this document names — and finds
> that the manufactured-product definition **over-captures 211 `Filling and
> Packout Services` items**, that Tertiary Packaging is **not** a gap, and that
> `Finished Goods` already mixes a unit and a bundle.

> **Candidate rule.** NetSuite Class identifies the **nature of the
> customer-contracted deliverable** represented by a sales line. It does **not**
> identify the breadth of the customer relationship, sourcing arrangement,
> number of underlying components, pricing/markup treatment, or internal cost
> composition.

**Verdict: the rule is not falsified, and the data supports it strongly enough
to name the two places it is currently violated.** §7 states what would falsify
it and was looked for.

---

## The finding that reframes everything

**`Turnkey` and `Co-Packing` are Business Segment values *and* Class values.**

Harvested from transaction responses (the segment table itself is
permission-refused; these came back embedded in Sales Order records):

| `cseg_dps_bus_seg` | Name | Lines |
|---:|---|---:|
| 3 | **DPS Packaging** | 1,607 |
| 1 | **"TurnKey "** *(trailing space as stored)* | 392 |
| 7 | **"Co-Packing "** *(trailing space as stored)* | 23 |

Both names also exist as Classes — `Turnkey` (1790) and `Co-Packing` (59).

**DPS Packaging / TurnKey / Co-Packing is a description of how DPS engages a
customer.** It is the *relationship and sourcing arrangement*, which is exactly
what the candidate rule says Class must **not** carry. Two of those three words
are on the Class axis anyway.

That single observation explains both anomalies the first audit could only
describe:

- Why `Turnkey`-the-Class is used on three Assembly lines for **one customer,
  BrainMD, whose header segment is `1 · TurnKey`** — the relationship was
  recorded a second time, on the deliverable field.
- Why `Co-Packing`-the-Class contains three **outsourced ancillary fees** rather
  than any co-packing service — the class was never describing a deliverable.

**Neither is evidence against the rule. Both are the rule identifying a
conflation.**

---

## 1 · Turnkey population — all three lines

Every line in the account carrying Class `Turnkey` (1790). **All three are
BrainMD.**

| SO | Date | Customer | Item | Type | Qty | Rate | Amount | Item default Class | Line segment |
|---|---|---|---|---|---:|---:|---:|---|---|
| SO2417 | 2025-06-11 | BrainMD | `BrainMD 355 Hydration 20ct Pouch(Assembly))` | Assembly | 100,000 | 0.497 | 49,700 | **NULL** | 1 · TurnKey |
| SO2476 | 2025-09-01 | BrainMD | `BrainMD 355 Hydration 20ct Pouch(Assembly))` | Assembly | 100,000 | 0.497 | 49,700 | **NULL** | 1 · TurnKey |
| SO2389 | 2025-05-13 | BrainMD | `BrainMD-351 Brain Boost-Assembly` | Assembly | 75,000 | 0.65917 | 49,437.75 | **NULL** | *(blank; header = 1)* |

Line memo on the two Hydration lines: *"355 Hydration 20ct. Carton pouches."*
Display name on Brain Boost: *"Brain Boost on the Go."*

*(SuiteQL returns sales revenue lines signed negative. Mainlines are positive —
SO2389's is +55,520.25. These are ordinary revenue lines, not credits.)*

### Nearby separately billed lines — identical on all three orders

SO2389 in full:

| Seq | Type | Item | Amount | Class | Segment |
|---:|---|---|---:|---|---|
| 0 | mainline | — | 55,520.25 | *(none)* | 1 |
| 1 | Assembly | BrainMD-351 Brain Boost-Assembly | 49,437.75 | **Turnkey** | — |
| 2 | OthCharge | Outsourced Micro Testing | 5,895 | One Time Charges | 1 |
| 3 | OthCharge | Outsourced Pallet Shrink Wrap | 80 | One Time Charges | 1 |
| 4 | OthCharge | Outsourced Master Shippers | 107.50 | One Time Charges | 1 |
| 5 | NonInvtPart | OTC-0012 | 0 | Freight | — |
| 6 | TaxGroup | — | 0 | *(none)* | 1 |

SO2417 and SO2476 carry the same three outsourced charges under
`One Time Charges`. **The pattern is stable across all three orders.**

### What the Assembly represents — INDETERMINATE from BOM

`itemmember` returns **zero members** for both Assemblies. Composition is not
determinable from the evidence available here; whether the BOM is simply not
populated in the sandbox could not be established.

What *is* established, from the item records themselves: both are **finished
consumer ingestibles sold as complete units** — a 20-count carton of hydration
pouches, and a consumer supplement branded *"on the Go."*

### WFG842 and WFL844 — the two items that default to Turnkey

| | |
|---|---|
| `WFG842` | **W LABS COLOGNE SPRAY**, formula WA "Wild Adventure" 7% A1, fragrance R25-6605, fill 3.4oz/100ml, 100ml custom-colour PET bottle, ultra-fine mist sprayer, glossy, 1-colour silkscreen |
| `WFL844` | **W LABS COLOGNE SPRAY**, formula BB "Bad Boy" 7% A1, fragrance R25-6604, same fill and construction, PMS 285C |

Both `InvtPart`, active, subsidiary 2. **Neither has ever appeared on any
transaction line — zero, of any type.**

**Their Turnkey default FITS the observed posting meaning.** These are complete
manufactured consumer products: a formula, a fill size, a decorated primary
package, sold finished. That is precisely what the three posting lines are.

> **Correction to the first audit.** It called these "wrongly defaulted." That
> was too strong. The *meaning* of their default is consistent with how Turnkey
> is actually used. What is true is narrower: **they have never been ordered**,
> and the Assemblies that *do* post carry no default at all.

### The commercial identities hidden under Turnkey

Two, and they are different kinds of thing:

1. **A finished manufactured consumer product sold complete** — the deliverable.
   Ingestibles (hydration pouches, supplement) and, from §2, topicals. This is a
   real, recurring commercial identity with **no Class of its own**.
2. **The turnkey sourcing relationship** — already carried by
   `cseg_dps_bus_seg = 1 · TurnKey`, and duplicated onto the Class field.

**No Class name is proposed here.** Identity (1) is the gap; identity (2) is not
a Class question at all.

---

## 2 · Is there a missing commercial-product Class?

**Yes — and the evidence is that the identity is genuine while the practice is
inconsistent. Both, and they are separable.**

The account holds **nine Assembly items. Every one has `class = NULL`.**

| Item | Display | Kind |
|---|---|---|
| `BrainMD 355 Hydration 20ct Pouch(Assembly))` | — | ingestible |
| `BrainMD-351 Brain Boost-Assembly` | Brain Boost on the Go | ingestible |
| `Berry Hanks Hydration Assembly` | — | ingestible |
| `Lemon LIme Hanks Hydration Assembly` | — | ingestible |
| `Strawberry Lemon Hanks Hydration Assembly` | — | ingestible |
| `Tropical Punch Hanks Hydration Assembly` | — | ingestible |
| `Watermelon Hanks Hydration Assembly` | — | ingestible |
| **`Fanny Bum Butter Assembly`** | — | **topical** |
| **`Joop Skin Assembly`** | Joop Skin Assembly | **topical** |

Seven ingestibles, two topicals. **None carries a default Class.**

### The seven sales lines those items have produced

| SO | Date | Customer | Class | Item |
|---|---|---|---|---|
| SO2225 | 2024-09-06 | BrainMD | **NULL** | 355 Hydration 20ct Pouch |
| SO2417 | 2025-06-11 | BrainMD | **Turnkey** | 355 Hydration 20ct Pouch |
| SO2476 | 2025-09-01 | BrainMD | **Turnkey** | 355 Hydration 20ct Pouch |
| SO2389 | 2025-05-13 | BrainMD | **Turnkey** | Brain Boost |
| SO2511 | 2025-12-05 | BrainMD | **NULL** | Brain Boost |
| SO2375 | 2025-05-01 | Hello Fanny | **NULL** | Fanny Bum Butter (0.00) |
| SO2499 | 2025-10-22 | Hello Fanny | **NULL** | Fanny Bum Butter (0.00) |

**The same item is classed Turnkey on some orders and unclassified on others**,
and the practice does not persist: Brain Boost was Turnkey in May 2025 and
**unclassified again in December 2025**. Three of seven lines carry the class.

**Conclusion.** DPS sells finished manufactured consumer products — ingestibles
and topicals — as complete units, repeatedly, for at least two customers. That
identity has no Class. `Turnkey` has been used for it three times out of seven
opportunities, which is a practice too thin and too unstable to be the answer,
and is in any case a relationship word.

*(The two Hello Fanny topical lines post at 0.00. Not interpreted here — the
evidence does not say whether those are samples, placeholders or something
else.)*

---

## 3 · Business Segment — everything accessible

### What Nexus does with it

| | |
|---|---|
| **Source** | HubSpot **deal** property `business_segment` (an enum id), cached in `hubspot_deals_cache.business_segment_id` |
| **Derived from item, quote or line?** | **No.** Deal-scoped only |
| **Resolver** | `business-segment-resolver.ts` fetches HubSpot enum options at push time and resolves the id → **label**, caching for the process lifetime. If the fetch fails or the id has no label, **the push is blocked** rather than sending a raw id |
| **Written to NetSuite?** | **Yes** — `cseg_dps_bus_seg`, from the raw HubSpot enum id |
| **Does Nexus write Class?** | **No.** `sales-orders.ts`: *"`class` — NOT SENT… observed orders carry class = null"* |

**A prior belief that business_segment mapped to a NetSuite Class was found
false and corrected on 2026-08-12** (`sales-orders.ts` lines 88–95: *"The prior
comment here claimed 'NetSuite class id (resolved via BS resolver → NS class)';
that was false and is what the Case B walk halted on… Nothing maps it to a
class."*). The field is noted there as *"whose own authority is under review."*

### The values, and how they were obtained

SuiteQL refuses both `customsegment` and `customrecord_cseg_dps_bus_seg`, and a
record GET on `customrecord_cseg_dps_bus_seg/<id>` is **permission-refused**.
The names above were read from **Sales Order record responses**, which embed
`{"id":"3","refName":"DPS Packaging"}`. No name is guessed; each was observed on
a real transaction.

### How it sits against Class

| | Lines |
|---|---:|
| Carry Class | 2,990 |
| Carry Business Segment | 2,022 |
| **Carry both** | **227** |
| Carry segment but no Class | 1,795 |

**They are nearly disjoint in practice** — 227 of 5,042 lines carry both. Two
fields, two populations, doing different work.

**Business Segment is not redefined here and nothing is proposed about it.**

---

## 4 · The Secondary reclassification practice — it is HISTORICAL

The first audit called this a systematic live practice. **The dimension that
separates the two populations is time, not customer.**

### Cards, Booklets (276, item default) vs Secondary – Cards, Booklets (66, line override)

| | 2023 | 2024 | 2025 | 2026 | Total |
|---|---:|---:|---:|---:|---:|
| **Override → 66** | 36 | 35 | 16 | 2 | 89 |
| **Kept → 276** | 0 | 5 | 27 | 36 | 68 |

**The same three customers appear on both sides** — Sol De Janeiro, Haus Labs,
KaramMD Skin — in nearly the same proportions. Customer does not distinguish
them. Item type does not. Business Segment does not (essentially absent on both:
89/89 and 67/68 blank).

**The crossover is 2025.** The override dominates 2023–24 and has nearly stopped;
the item default takes over and now dominates.

### Corrugated (65) — the same shape, already finished

All **11** `Secondary - Corrugated` lines fall between **2023-08-09 and
2024-08-01**, across six unrelated customers (Tracy Anderson, Nécessaire,
Rejuvica, SNIF, SW-Sanghvi, Lemme). **Nothing after August 2024.** Meanwhile
`Secondary` (10) runs continuously: 2023=108, 2024=227, 2025=118, 2026=51.

### What this means

These are not two competing live practices. They are **an older line-level
convention that has been superseded by the item default**, on its own, without
anyone stopping it deliberately — `Secondary - Corrugated` ended over a year
ago; `Secondary - Cards, Booklets` is down to 2 lines in 2026.

**Treating them as a cleanup candidate would be wrong for a second reason:**
they are historical records of how those orders were classified, and the first
audit's instruction to preserve historical classification applies. The live
question is only whether the two variants should continue to exist.

---

## 5 · Passthrough — a consistent explanation exists

All **12** lines, on **3 orders**, **2 customers**:

| SO | Date | Customer | Item | Type | Item default Class | Amount |
|---|---|---|---|---|---|---:|
| SO2092 | 2024-04-05 | Smart Pressed Juice | `DPS-SPJ-1008` | NonInvtPart | Raw ingredients | 15,242.01 |
| SO2092 | | | `DPS-SPJ-1009` | NonInvtPart | Raw ingredients | 3,906.55 |
| SO2092 | | | `DPS-SPJ-1010` | NonInvtPart | Raw ingredients | 3,652.42 |
| SO2092 | | | `DPS-SPJ-1011` | NonInvtPart | Raw ingredients | 3,799.11 |
| SO2092 | | | `OTC-0010` | NonInvtPart | One Time Charges | 600 |
| SO2092 | | | `OTC-0012` | NonInvtPart | Freight | 546.67 |
| SO2123 | 2024-04-25 | Wraggemamma, LLC | `DPS-SWW-1013` | NonInvtPart | Raw ingredients | 51,150 |
| SO2334 | 2025-03-11 | Smart Pressed Juice | `DPS-SPJ-1008` | NonInvtPart | Raw ingredients | 9,974.25 |
| SO2334 | | | `DPS-SPJ-1009` | NonInvtPart | Raw ingredients | 2,686 |
| SO2334 | | | `DPS-SPJ-1010` | NonInvtPart | Raw ingredients | 3,341 |
| SO2334 | | | `DPS-SPJ-1011` | NonInvtPart | Raw ingredients | 2,041 |
| SO2334 | | | `OTC-0025` | NonInvtPart | One Time Charges | 500 |

### What consistently explains it

**Nine of twelve are customer-coded `DPS-<CUST>-####` NonInvtParts whose item
default is `Raw ingredients`.** The other three are the one-time charges and
freight **on the same orders**.

So the trigger is not the item — the same `OTC-0012` posts to `Freight` on
SO2389 and to `Passthrough` on SO2092. **It is order-scoped**: when an order is
a pass-through of customer materials, the raws *and their attached charges* are
re-classed together.

**This is a pricing/commercial treatment, not a deliverable kind** — which the
candidate rule explicitly excludes from Class. `Passthrough` is the second
violation, after `Turnkey`/`Co-Packing`, and it is the cleanest one: its 12
lines span three different item default classes, so it cannot be describing what
the product is.

**Nothing is reclassified.**

---

## 6 · Can Product Type supply or default Class?

1,031 Nexus leaves carry both a SKU and a Product Type. Matching those SKUs
against NetSuite `itemid` returns **1,076 item records** — more than the SKU
count, because some SKUs exist twice in NetSuite as an `InvtPart` and a
`NonInvtPart` (e.g. `10014.V2`).

| Product Type | → NetSuite Class | Count |
|---|---|---:|
| Secondary | Secondary | 328 |
| Filling and Packout Services | Filling and Packout Services | 199 |
| Primary | Primary | 153 |
| **Labels** | **Secondary - Labels** | **105** |
| Soft Goods and Accessories | Soft Goods and Accessories | 93 |
| One Time Charges | One Time Charges | 59 |
| Cards, Booklets | Cards, Booklets | 49 |
| Raw ingredients | Raw ingredients | 35 |
| Freight | Freight | 11 |
| Design | Design | 9 |
| R&D / Testing | R&D / Testing | 6 |
| **Third Party Logistics** | **Logistics** | **4** |
| Turnkey | Turnkey | 2 |
| Formulation | Formulation | 1 |
| *various* | **(NO CLASS)** | **17** |
| *mismatches* | — | **5** |

### Reading

**Product Type predicts Class for 1,061 of 1,076 matched items — 98.6%** — with
**two systematic renames** that would have to be encoded rather than inferred:

- `Labels` → **`Secondary - Labels`** (105 items)
- `Third Party Logistics` → **`Logistics`** (4 items)

**The 5 genuine mismatches** are: 2 × `Tertiary Packaging` → `Secondary`,
1 × `Cards, Booklets` → `Primary`, 1 × `Secondary` → `Filling and Packout
Services`, 1 × `Labels` → the **inactive** `Labels` class.

**Three Product Types have no Class counterpart at all:**

| Product Type | Class |
|---|---|
| `Finished Goods` | **none** — both matched items have no Class |
| `Tertiary Packaging` | **none exists**; falls to `Secondary` or nothing |
| `Ingestibles`, `Topicals` | **none exists**; 0 items classified, so untested |

**And one caution that matters more than the percentage.** `Turnkey` → `Turnkey`
is a 1:1 match that would **propagate the conflation** identified above rather
than resolve it: a Product Type of `Turnkey` is itself a sourcing word, and
defaulting Class from it would keep writing the relationship onto the
deliverable field.

**So Product Type is a strong *candidate source* for Class and not an
equivalent taxonomy.** It cannot supply a Class for finished manufactured
products, tertiary packaging, ingestibles or topicals, because those Classes do
not exist.

---

## 7 · What would falsify the rule, and what was found

| Falsifier looked for | Found? |
|---|---|
| A Class distinguishing lines by **customer relationship breadth** | **Yes — `Turnkey`, `Co-Packing`.** But both are duplicates of Business Segment values, so they support the rule's *distinction* while showing it is not being observed |
| A Class distinguishing lines by **sourcing arrangement** | **Yes — `Passthrough`**, order-scoped across three item classes |
| A Class distinguishing lines by **number of components** | **No.** `Secondary` and its `- ` variants split by material, not by count; the Assemblies are not classed by member count |
| A Class distinguishing lines by **pricing/markup treatment** | **No**, other than `Passthrough` above |
| A Class distinguishing lines by **internal cost composition** | **No evidence either way** — there are no cost transactions in this account |
| A **deliverable kind with no Class**, which the rule would predict is a gap | **Yes — finished manufactured consumer product.** 9 Assembly items, 0 defaults |

**Nothing falsifies the rule.** Three classes are inconsistent with it, and in
each case the inconsistency is *explained* by the rule rather than contradicting
it.

---

## 8 · Verified observations

1. The account has **22 classes**, flat, 20 active; **only Sales Orders exist**.
2. **Nexus never writes Class**, at header or line, and `so-structure.ts`
   *asserts* the item-derived Class was preserved.
3. **Nexus does write `cseg_dps_bus_seg`**, from the HubSpot **deal** enum id.
4. Segment values are exactly three: **DPS Packaging (1,607)**, **TurnKey
   (392)**, **Co-Packing (23)**.
5. Class and Segment are **nearly disjoint** — 227 lines of 5,042 carry both.
6. **Turnkey Class = 3 lines, one customer, all Assemblies with no item
   default**; its 2 defaulted items have never been ordered.
7. **Nine Assembly items — seven ingestibles, two topicals — all with no Class.**
8. The same Assembly is classed Turnkey on some orders and not on others,
   including a **later** order reverting to unclassified.
9. `Secondary - Corrugated` **ended August 2024**; `Secondary - Cards, Booklets`
   crossed over to the item default during 2025.
10. `Passthrough` is **order-scoped**, spanning three different item defaults.
11. **Product Type predicts Class for 98.6%** of matched items, with two
    systematic renames.

## 9 · Patterns supported by evidence

- **Class is populated almost entirely by item default** (2,587 of 2,990); the
  403 exceptions are line-level and concentrated in the three classes that
  violate the rule.
- **Relationship and treatment words have leaked onto the Class axis** —
  `Turnkey`, `Co-Packing`, `Passthrough` — while the segment axis already
  carries two of the same words.
- **The `Secondary -` variants are legacy**, not a competing live convention.
- **A finished-consumer-product deliverable exists and is unclassified.**

## 10 · Unresolved questions

1. **Assembly composition** — `itemmember` returns nothing; whether the BOM is
   unpopulated in the sandbox or not exposed is unknown.
2. **Segment value list** — obtained by harvesting three transaction responses;
   whether more values exist unused is unknown (the table is permission-refused).
3. **Whether a workflow or SuiteScript sets Class** — those tables were not
   reachable; the 403 line-level classes are attributed no further than "the UI
   or something server-side".
4. **Revenue-to-cost matching** — unanswerable here; no cost transactions exist.
5. **Why the two Hello Fanny topical lines post at 0.00.**
6. **Production** — everything above is the sandbox. No production credential
   exists.

## 11 · Candidate genuine classification gaps

| Gap | Evidence | Mark |
|---|---|---|
| **A Class for the finished manufactured consumer product** | 9 Assembly items, ingestibles and topicals, 0 defaults, 7 lines of which 3 borrowed `Turnkey` | **genuine gap** |
| **`Turnkey` as a Class** | duplicates segment value 1 · TurnKey | **requires business decision** |
| **`Co-Packing` as a Class** | duplicates segment value 7 · Co-Packing; contents are outsourced fees | **requires business decision** |
| **`Passthrough` as a Class** | order-scoped commercial treatment, not a deliverable | **requires business decision** |
| **No Class for `Tertiary Packaging`, `Ingestibles`, `Topicals`, `Finished Goods`** | Product Type exists; Class does not | **genuine gap** |
| **The two systematic renames** (`Labels`→`Secondary - Labels`, `Third Party Logistics`→`Logistics`) | 109 items | **encode, do not infer** |
| **85 items with no default Class; 2,052 unclassified lines** | §1 of the prior audit | **gap to fill** |
| **`Secondary - Corrugated` / `Secondary - Cards, Booklets`** | superseded by item default | **requires business decision — whether to retain** |

**Nothing above has been applied. Historical classifications are untouched.**
