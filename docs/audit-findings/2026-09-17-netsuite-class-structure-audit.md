# NetSuite Class structure — read-only audit

**2026-09-17 · read-only. No class created, merged, renamed or reclassified. No
field added. No production write. No historical classification altered.**

Requested before any change to classification or to the Nexus design.

---

## 0 · What this audit could and could not reach — read this first

**It reads the SANDBOX.** `describeNetsuiteTarget()` reports
`environment: sandbox`, `accountIsSandbox: true`, against account `…_SB2`. **No
production NetSuite credential is configured**, so a production Class list, its
item defaults and its transaction history are **outside what this audit can
see**. Everything below is a statement about the sandbox.

**The sandbox holds Sales Orders and nothing else.** Every transaction line in
the account, by type:

```
SalesOrd     5042 lines   2990 carry a Class   59%
(no other transaction type exists)
```

No invoices, no vendor bills, no item receipts, no journals.

> **Therefore the question "do revenue and its associated costs land in matching
> classes" CANNOT BE ANSWERED HERE.** There are no cost-side transactions to
> compare against. §7 states what that leaves open rather than inferring it.

All queries were SuiteQL `SELECT` and record `GET`. The client refuses any
SuiteQL statement not beginning with `SELECT`.

---

## 1 · How Class reaches a transaction line

Measured, not assumed — every sales line compared against its item's default:

| Route | Lines | |
|---|---:|---|
| **Item default, inherited unchanged** | **2,587** | the dominant route |
| **Line differs from the item's default** | **208** | overridden after inheriting |
| **Line has a class, item has none** | **195** | set at the line; nothing to inherit |
| **Item has a default, line has none** | **33** | the default was cleared or never applied |
| **Neither** | **2,019** | the bulk of the 2,052 unclassified lines |

**Four routes exist; two are in real use.**

1. **Item default** — 2,587 lines. The designed path.
2. **Line-level entry** — 403 lines (208 + 195) carry a class the item did not
   supply. §4 shows this is *systematic*, not scattered.
3. **Header** — **not a route.** `transaction.class` is not a queryable field on
   this account; Class is line-level here.
4. **Explicit integration write — NONE.** Nexus **never writes Class.**
   `readSalesOrderLines` reads `classId`; no write payload in
   `src/lib/netsuite/` contains a class field. `so-structure.ts` goes further and
   **asserts Class was preserved from the item** — "Item-derived Class
   preserved" — failing the push when a member line's class differs from the
   item's default.

**Consequence worth stating:** because Nexus asserts item-derived Class, any
line whose class differs from its item default did **not** arrive through a
Nexus-pushed order. The 403 came from the NetSuite UI or from something
server-side in NetSuite that this audit cannot see from the outside. **Whether a
workflow or a SuiteScript sets Class is INDETERMINATE** — the workflow and
script-deployment tables were not reachable under this role.

---

## 2 · Class is not the business segment

They are **different fields, both line-level, both populated, on different line
sets.**

| | Class | `cseg_dps_bus_seg` |
|---|---|---|
| Kind | native NetSuite classification | DPS custom segment |
| Level | line | line (also exposed on the SO header record) |
| Lines carrying it | **2,990** | **2,022** |

The segment appears on the Sales Order record alongside 28 `custbody_*` fields
and is queryable on `transactionline`.

**INDETERMINATE: its values could not be enumerated.** Both
`SELECT … FROM customsegment` and a join to
`customrecord_cseg_dps_bus_seg` were refused as invalid search queries under
this role, and `GROUP BY tl.cseg_dps_bus_seg` returns a 500. The field's
existence and population are established; **its value list and its correlation
with Class are not**, and no cross-tab is offered in their place.

**Nothing in this audit proposes changing, reading or writing the segment.** It
is named only to keep the two apart, as instructed.

---

## 3 · The 22 classes

20 active, 2 inactive, **flat — no parent/child hierarchy**. Item count is items
whose *default* class is that class; line count is Sales Order lines posting to
it.

| # | Class | Items | Lines | Representative items | Reading |
|---:|---|---:|---:|---|---|
| 1 | Primary | 172 | 297 | — | Primary packaging. Coherent |
| 10 | Secondary | 358 | 504 | `10000-GNX-Box`, `10033-GNX-Box` | Secondary packaging. Coherent |
| 42 | Filling and Packout Services | 211 | 144 | `10014.V2`, `10015` | The live contract-service class |
| 57 | **Creative** | **0** | **2** | — | 2 lines with **no item at all** |
| 58 | Soft Goods and Accessories | 112 | 254 | — | Coherent |
| 59 | **Co-Packing** | **3** | 13 | `Outsourced Art/Prep/Proof`, `Outsourced Set Up Fee`, `Outsourced Warehouse Fees` | **Its items are outsourced fees, not co-packing** |
| 60 | Freight | 13 | 559 | — | Coherent, heavily used |
| 61 | One Time Charges | 84 | 832 | — | **The most-used class in the account** |
| 62 | Formulation | 1 | 8 | — | One item, eight lines |
| 63 | **Development** | **1** | **0** | `Development - Projects Not Yet Won` | An internal WIP placeholder. **Never posts** |
| 64 | Secondary - Labels | 108 | 142 | `10033-GNX-Label` | Behaves as an item-default class |
| 65 | **Secondary - Corrugated** | **0** | 11 | — | Line-only; items default to `Secondary` |
| 66 | **Secondary - Cards, Booklets** | **0** | 89 | — | Line-only; items default to `Cards, Booklets` |
| 168 | Logistics | 8 | 11 | — | Small |
| 173 | Raw ingredients | 156 | 31 | — | Many items, few lines |
| 275 | **Passthrough** | **0** | 12 | — | Line-only, across unrelated item classes |
| 276 | Cards, Booklets | 51 | 68 | `10PK-01-DC02` | Item-default class for the same goods as 66 |
| 277 | Labels | 1 | 0 | `Label_Capsule_Burn_v02` | **INACTIVE** |
| 376 | Third Party Logistics | 0 | 0 | — | **INACTIVE**, unused |
| 1790 | **Turnkey** | **2** | **3** | `WFG842`, `WFL844` | §5 |
| 6 | Design | 10 | 4 | `DS-0001`…`DS-0004` | The live creative class |
| 10291 | R&D / Testing | 6 | 6 | `Ro-TEST-01`…`Ro-TEST-04` | The live development class |

**85 items carry no default class at all** (of 1,382), which is where most of
the 2,019 doubly-unclassified lines come from.

---

## 4 · The line-only classes are systematic, not stray

Three classes have **zero item defaults** yet post real lines — and the items
posting to them share a consistent origin:

| Class | Lines | Every posting item's own default |
|---|---:|---|
| `Secondary - Cards, Booklets` | 89 | **`Cards, Booklets` (276)**, occasionally `Secondary` (10) |
| `Secondary - Corrugated` | 11 | **`Secondary` (10)**, every one |
| `Passthrough` | 12 | `Raw ingredients` (173), `One Time Charges` (61), `Freight` (60) — **mixed** |

The first two are a **consistent re-classing away from the item default toward a
finer `Secondary - ` variant** — 100 lines of it. Somebody, or something, is
routinely correcting the item's answer at the line.

**`Passthrough` is a different axis entirely.** Its lines span three unrelated
item classes, so it does not describe what the product *is* — it describes how
the charge is *treated commercially*. Recording that on the same field that
records product kind is the structural overlap in this account, and it is the
one thing in §8 that most needs a decision rather than a fill.

`Creative`'s 2 lines carry **no item**, so they are description or comment lines
with a class attached.

---

## 5 · Turnkey — what actually posts there

**The item defaults and the actual postings do not intersect.**

**Two items default to Turnkey**, neither of which has ever posted a Turnkey
line:

| Item | Type | Status |
|---|---|---|
| `WFG842` — W LABS COLOGNE SPRAY | InvtPart | active |
| `WFL844` — W LABS COLOGNE SPRAY | InvtPart | active |

**Three lines post to Turnkey**, all on manually-entered orders, all **Assembly**
items whose own default class is **NULL**:

| Order | Date | Item | Qty | Rate | Amount |
|---|---|---|---:|---:|---:|
| SO2476 | 2025-09-01 | BrainMD 355 Hydration 20ct Pouch (Assembly) | 100,000 | 0.497 | 49,700 |
| SO2417 | 2025-06-11 | BrainMD 355 Hydration 20ct Pouch (Assembly) | 100,000 | 0.497 | 49,700 |
| SO2389 | 2025-05-13 | BrainMD-351 Brain Boost-Assembly | 75,000 | 0.65917 | 49,437.75 |

*(SuiteQL returns sales revenue lines with a negative sign; the mainline on
SO2389 is +55,520.25. These are ordinary revenue lines, not credits.)*

**SO2389 in full**, which is the clearest picture of what Turnkey means in
practice:

| Seq | Type | Item | Amount | Class |
|---:|---|---|---:|---|
| 0 | mainline | — | 55,520.25 | *(none)* |
| 1 | Assembly | BrainMD-351 Brain Boost-Assembly | 49,437.75 | **Turnkey** |
| 2 | OthCharge | Outsourced Micro Testing | 5,895 | One Time Charges |
| 3 | OthCharge | Outsourced Pallet Shrink Wrap | 80 | One Time Charges |
| 4 | OthCharge | Outsourced Master Shippers | 107.50 | One Time Charges |
| 5 | NonInvtPart | OTC-0012 | 0 | Freight |
| 6 | TaxGroup | — | 0 | *(none)* |

### What this says

**Turnkey's working meaning is: the finished, made-and-packed good sold as a
single deliverable** — an Assembly line carrying the whole unit price, with its
one-time charges billed alongside under other classes.

That is a coherent and useful meaning, and it is **barely used** (3 lines) and
**wrongly defaulted** (2 inventory parts that never post there, while the
Assemblies that do post carry no default at all).

### Destinations proposed from what DPS sells

Based on the observed shape, **not on a taxonomy**:

| What posts to Turnkey today | Proposed destination | Mark |
|---|---|---|
| The finished-good **Assembly** line — the made-and-packed unit | **Keep Turnkey**, and give the Assembly items a Turnkey **item default** so the line stops depending on manual entry | **gap to fill** |
| `WFG842` / `WFL844` cologne sprays, defaulting to Turnkey but never posting | Almost certainly finished goods bought or made complete — but whether DPS sells them as turnkey or as a supplied product **is a business fact this audit cannot read** | **requires business decision** |
| The one-time charges billed beside the Assembly | Already land in `One Time Charges` / `Freight`, which is consistent with how the rest of the account bills them | **keep** |

---

## 6 · The four overlaps

### 6.1 · Creative vs Design

| | Items | Lines | Evidence |
|---|---:|---:|---|
| `Design` (6) | 10 | 4 | `DS-0001`…`DS-0004`, NonInvtPart — real sellable design services |
| `Creative` (57) | **0** | **2** | both lines carry **no item** |

**Design is the live class. Creative holds nothing that identifies a product or
service.** Not a true overlap so much as one live class and one near-empty one.
**Requires business decision** — whether Creative names something Design does
not, or is a remnant.

### 6.2 · Development vs R&D / Testing

| | Items | Lines | Evidence |
|---|---:|---:|---|
| `R&D / Testing` (10291) | 6 | 6 | `Ro-TEST-01`…`Ro-TEST-04` — sellable testing services |
| `Development` (63) | 1 | **0** | `Development - Projects Not Yet Won`, InvtPart |

**These are not two names for one thing.** `Development`'s single item is an
**internal work-in-progress placeholder for unwon work** — it is not a service
sold to a customer and it has never appeared on a sales line. `R&D / Testing`
carries the sellable work.

**Keep both, for different purposes** — but the overlap in *name* is real and
invites misfiling. **Requires business decision** on whether `Development`
should be renamed to say what it is.

### 6.3 · Co-Packing vs Filling and Packout Services

| | Items | Lines | Evidence |
|---|---:|---:|---|
| `Filling and Packout Services` (42) | 211 | 144 | `10014.V2`, `10015` — the real service catalogue |
| `Co-Packing` (59) | **3** | 13 | `Outsourced Art/Prep/Proof`, `Outsourced Set Up Fee`, `Outsourced Warehouse Fees` |

**`Co-Packing`'s three items are not co-packing.** They are outsourced
*ancillary fees* — artwork/prepress, set-up, warehousing — which elsewhere in
this account post to `One Time Charges`. The class name and its contents
disagree.

**Gap to fill**, with a decision attached: either those three items belong in
`One Time Charges` with the rest of their kind, or `Co-Packing` means something
this audit has not identified. **Historical lines stay as they are either way.**

### 6.4 · Cards, Booklets vs the Secondary variants

The most systematic pattern in the account:

| | Items | Lines | Behaviour |
|---|---:|---:|---|
| `Cards, Booklets` (276) | **51** | 68 | the **item-default** class |
| `Secondary - Cards, Booklets` (66) | **0** | **89** | **line-only** — items arrive defaulted to 276 and are re-classed |
| `Secondary` (10) | 358 | 504 | the parent concept, item-default |
| `Secondary - Corrugated` (65) | **0** | 11 | **line-only** — items arrive defaulted to 10 |
| `Secondary - Labels` (64) | **108** | 142 | **item-default** — behaves unlike its two siblings |

**The three `Secondary - ` variants are not treated the same way.** Labels is a
real item-default class; Corrugated and Cards/Booklets exist only as line-level
corrections of a coarser default. And `Cards, Booklets` and
`Secondary - Cards, Booklets` are two classes for **the same physical goods**,
distinguished only by which layer set them.

This is the account's largest single inconsistency by line count (100 re-classed
lines), and it is **not** a data-entry accident: it is consistent across 40+
distinct items.

---

## 7 · Revenue versus cost — not answerable here

**INDETERMINATE, and deliberately not inferred.**

Assessing whether a class's revenue and its associated costs match requires
cost-side transactions — vendor bills, item receipts, inventory adjustments,
journals. **The sandbox contains none.** Only Sales Orders exist.

What *can* be said, and no more:

- On the revenue side, **41% of sales lines carry no Class at all** (2,052 of
  5,042). Whatever the cost side does, two fifths of revenue is unclassified
  before any matching question arises.
- **One-time charges** are classified consistently on the revenue side —
  `One Time Charges` is the single most-used class (832 lines, 412 orders), and
  SO2389 shows three outsourced fees landing there together.
- **Passthroughs** are classified by *treatment* rather than by product (§4),
  so a passthrough's revenue line and the cost behind it would by construction
  carry different classes — the revenue line says `Passthrough`, the item says
  `Raw ingredients` or `Freight`. **Whether that is intended is a business
  question**, and it is the one place where a revenue/cost mismatch is
  structurally predictable from what this audit can see.

**Closing this needs access to a production account, or cost transactions in the
sandbox.** Neither is in scope here.

---

## 8 · Proposed crosswalk

**Nothing below is applied.** Historical classifications are preserved in every
row.

| Class | Today | Proposal | Mark |
|---|---|---|---|
| Primary | 172 items / 297 lines | unchanged | **keep** |
| Secondary | 358 / 504 | unchanged as the parent concept | **keep** |
| Secondary - Labels | 108 / 142 | unchanged — the one `Secondary -` variant that works as an item default | **keep** |
| Soft Goods and Accessories | 112 / 254 | unchanged | **keep** |
| Freight | 13 / 559 | unchanged | **keep** |
| One Time Charges | 84 / 832 | unchanged | **keep** |
| Raw ingredients | 156 / 31 | unchanged | **keep** |
| Filling and Packout Services | 211 / 144 | unchanged — the live service class | **keep** |
| Design | 10 / 4 | unchanged | **keep** |
| R&D / Testing | 6 / 6 | unchanged | **keep** |
| Logistics | 8 / 11 | unchanged | **keep** |
| Formulation | 1 / 8 | unchanged | **keep** |
| **Turnkey** | 2 items that never post / 3 Assembly lines that do | Give the finished-good **Assembly** items a Turnkey item default, so the class stops depending on line-level entry | **gap to fill** |
| **Turnkey — `WFG842`/`WFL844`** | default to Turnkey, never post | Confirm whether these are sold turnkey | **requires business decision** |
| **Secondary - Cards, Booklets** | 0 items / 89 lines | Either give the ~40 items this default, or stop using the variant and let `Cards, Booklets` stand | **requires business decision** |
| **Secondary - Corrugated** | 0 items / 11 lines | Same question, smaller | **requires business decision** |
| **Cards, Booklets** | 51 / 68 | Its relationship to variant 66 is the decision above; nothing to change on its own | **requires business decision** |
| **Co-Packing** | 3 outsourced-fee items / 13 lines | Name and contents disagree — reassign the three items, or state what the class means | **requires business decision** |
| **Creative** | 0 items / 2 item-less lines | Establish whether it names anything `Design` does not | **requires business decision** |
| **Development** | 1 internal WIP item / 0 lines | Keep the function; the name invites confusion with `R&D / Testing` | **requires business decision** |
| **85 unclassified items** | no default | Each needs a default, or a statement that it should not have one | **gap to fill** |
| **2,052 unclassified sales lines** | no class | Consequence of the above plus line-level omissions | **gap to fill** |
| Labels (inactive) | 1 item / 0 lines | leave inactive | **keep** |
| Third Party Logistics (inactive) | 0 / 0 | leave inactive | **keep** |
| **Passthrough** | 0 items / 12 mixed-origin lines | It records a commercial **treatment**, not a product kind — a different axis on the same field | **requires business decision** |

---

## 9 · For the Nexus design, stated narrowly

Only what this audit establishes:

- **Nexus does not set Class and should not start** without a decision. It reads
  `classId` and asserts the item-derived value was preserved. That assertion is
  a useful guard and depends on item defaults being right.
- **Item defaults are the designed route** and carry 2,587 of 2,990 classed
  lines. Fixing a class means fixing an item default, not teaching the
  integration to write one.
- **The `Secondary -` variants and `Passthrough` are set at the line**, so any
  Nexus-pushed order will not reproduce them — it will post the item's default.
  That is a difference worth knowing before the Costs design assumes parity with
  manually entered orders.
- **Class is not the business segment.** They are separate fields and this audit
  proposes nothing about the segment.

---

## 10 · Limitations, restated

1. **Sandbox only.** No production credential exists. The production Class list
   may differ, as the HubSpot portals already do.
2. **No cost-side transactions exist**, so §7's question is unanswered rather
   than answered negatively.
3. **The business segment's values could not be enumerated** under this role, so
   no Class × segment correlation is offered.
4. **Whether a NetSuite workflow or SuiteScript sets Class is unknown** — those
   tables were not reachable. The 403 line-level classes are attributed to "the
   UI or something server-side", which is as far as the evidence goes.
