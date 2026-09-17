# Filling the Class gaps — final evidence pass

**2026-09-17 · read-only, sandbox. No creation, rename, merge, migration,
mapping change, reclassification or production write. Historical classifications
untouched.**

Third in the series, working from the provisional model:

| Axis | Carries |
|---|---|
| Business Segment | how DPS is **engaged** to deliver the work |
| **NetSuite Class** | **nature of the customer-contracted deliverable on the sales line** |
| HubSpot/Nexus Product Type | upstream commercial product identity |
| Nexus markup category | pricing behaviour, not accounting identity |
| Passthrough | transaction/commercial treatment, not product identity |

No taxonomy redesign. Gaps only.

---

## 1 · The manufactured consumer-product population

### 1.1 · The complete population, as far as it can be assembled

**In NetSuite — 9 Assembly items, every one with `class = NULL`:**

| Item | Display | Kind | Lines |
|---|---|---|---:|
| `BrainMD 355 Hydration 20ct Pouch(Assembly))` | — | ingestible | 3 |
| `BrainMD-351 Brain Boost-Assembly` | Brain Boost on the Go | ingestible | 2 |
| `Fanny Bum Butter Assembly` | — | **topical** | 2 |
| `Joop Skin Assembly` | Joop Skin Assembly | **topical** | 0 |
| `Berry Hanks Hydration Assembly` | — | ingestible | 0 |
| `Lemon LIme Hanks Hydration Assembly` | — | ingestible | 0 |
| `Strawberry Lemon Hanks Hydration Assembly` | — | ingestible | 0 |
| `Tropical Punch Hanks Hydration Assembly` | — | ingestible | 0 |
| `Watermelon Hanks Hydration Assembly` | — | ingestible | 0 |

**In NetSuite — finished units that are NOT Assemblies:**

| Item | Type | Class | Lines | What it is |
|---|---|---|---:|---|
| `WFG842` | InvtPart | **Turnkey** | **0** | W LABS cologne spray, formula WA "Wild Adventure" 7% A1, fragrance R25-6605, 3.4oz/100ml, custom-colour PET bottle + ultra-fine mist sprayer, 1C silkscreen |
| `WFL844` | InvtPart | **Turnkey** | **0** | Same construction, formula BB "Bad Boy", PMS 285C |
| `Cirqadian-BS` | InvtPart | **(none)** | 0 | Cirqadian – Brain Stems 100ml **(FG)** |
| `Cirqadian-RS` | InvtPart | **(none)** | 0 | Cirqadian – **The Ritual Set** (FG) |
| `355 BrainMD Hydration 20ct (FS)` | InvtPart | **(none)** | — | a third representation of the BrainMD unit |

**Item Groups for the same units, all unclassified** — `WFG842-Wild Adventure-G`,
`WFL844-Bad Boy-G`, `WFL844-G`, `10025 Fill & Assy Silk Rinse (G)`,
`Cecred Silk Rinse Pouch Assembly(Group)`.

**In Nexus/HubSpot only, no NetSuite item yet:** `DPS-MISTR-1007…1011` (five
gummies, Product Type `Turnkey`), `Cirqadian-AM`, `Cirqadian-GA`, and one
un-SKU'd leaf — *"Cirqadian 3 Sku Discovery Kit, Filling and Black Easy Spray
Pump Glass Vials, 1 Silkscreen Color"*.

**Sales-line history — every line the nine Assemblies have ever produced:**

| SO | Date | Customer | Class | Segment | Item |
|---|---|---|---|---|---|
| SO2225 | 2024-09-06 | BrainMD | **NULL** | 1 · TurnKey | 355 Hydration 20ct Pouch |
| SO2417 | 2025-06-11 | BrainMD | **Turnkey** | 1 · TurnKey | 355 Hydration 20ct Pouch |
| SO2476 | 2025-09-01 | BrainMD | **Turnkey** | 1 · TurnKey | 355 Hydration 20ct Pouch |
| SO2389 | 2025-05-13 | BrainMD | **Turnkey** | *(blank; header 1)* | Brain Boost |
| SO2511 | **2025-12-05** | BrainMD | **NULL** | — | Brain Boost |
| SO2375 | 2025-05-01 | Hello Fanny | **NULL** | 1 · TurnKey | Fanny Bum Butter (0.00) |
| SO2499 | 2025-10-22 | Hello Fanny | **NULL** | — | Fanny Bum Butter (0.00) |

Seven lines. Three carry `Turnkey`. **The most recent — December 2025 — does
not.**

### 1.2 · Testing the candidate definition

> *"A consumer product supplied by DPS as the contracted commercial unit,
> incorporating formulation/bulk and manufacturing/filling, whether or not
> secondary packaging is also included."*

**It captures the nine Assemblies and the two cologne sprays correctly.** It also
**over-captures**, and the counterexamples are not edge cases — they are the
largest class in the account by item count.

#### Counterexample A · the fill-and-assemble items already classed as a service

Every one of these **satisfies the definition's second clause** — a consumer unit
incorporating bulk and filling — and every one is currently, and defensibly,
`Filling and Packout Services`:

| Item | Display | Current Class |
|---|---|---|
| `355-ASSEMBLY` | BrainMD – Hydration Assembly | **Filling and Packout Services** |
| `ASSEMBLY-30 Caffeinated` / `Decaf` | Iconic Beauty – 30 Count | **Filling and Packout Services** |
| `ASSEMBLY-7 Caffeinated` / `Decaf` | Iconic Beauty – 7 Count | **Filling and Packout Services** |
| `BLD-FILL Caffeinated` / `Decaf` | Iconic Beauty – Blend and Fill | **Filling and Packout Services** |
| `CRQ-100MLCOPACK` | Cirqadian – 100ml Blend/Co-pack | **Filling and Packout Services** |
| `10025 - Fill`, `10025-Fill` | 1 fl oz Pouch Fill & Bulk; Kirby Beauty Silk Rinse | **Filling and Packout Services** |
| `Blending & Filling` | Blending & Filling | **Filling and Packout Services** |

**211 items sit in that class.** The phrase *"incorporating formulation/bulk and
manufacturing/filling"* does **no discriminating work** — a fill service
incorporates exactly those things. The only clause that separates the two is
*"supplied by DPS as the contracted commercial unit"*, and that turns entirely on
**who owns the inputs and what the customer is buying** — a commercial fact the
item record does not state.

**`355-ASSEMBLY` (Filling and Packout Services) and
`BrainMD 355 Hydration 20ct Pouch(Assembly)` (posts Turnkey) are the same
physical unit for the same customer, classed two different ways.** That is the
counterexample in its sharpest form.

#### Counterexample B · Cirqadian is sold decomposed *and* as a finished unit

The same product exists in NetSuite as both, each part correctly classed:

| Item | Class |
|---|---|
| `CIRQADIAN-Bottle100ml-AM/BS/GA`, `CIRQADIAN-Cap100ml`, `CIRQADIAN-Sprayer100ml` | **Primary** |
| `CQRW.AWYMSG100ML`, `CQRW.BRNSTMS100ML`, `CQRW.GDANJ100ML` | **Raw ingredients** |
| `CRQ-100MLCOPACK` | **Filling and Packout Services** |
| `CRQ-100MLUC-AM` (unit carton) | **Secondary** |
| `CRQ-DTC-Shipper`, `CRQ-Shipper-Card` | **Secondary** |
| **`Cirqadian-BS`, `Cirqadian-RS` (FG)** | **(none)** |

**A new Class would not replace any of the first five rows** — those are real,
separately contracted deliverables. It would only serve the last row. So the
definition must not be read as "anything that ends up as a Cirqadian bottle."

#### Counterexample C · `Cirqadian – The Ritual Set`

A **set**, not a unit. It incorporates formulation and filling, is supplied by
DPS, and is a consumer product — so the definition captures it — but it is a
*bundle of finished units*, which is a different commercial identity again. §3.

### 1.3 · What the definition needs

The evidence says the discriminator is **not** composition. It is:

> **Is DPS selling the unit, or selling the work performed on someone else's
> unit?**

Nothing in the item record answers that. It is visible in the **contract**, and —
usefully — it is close to what Business Segment already records
(`DPS Packaging` / `TurnKey` / `Co-Packing`). **Which is why a Class built on
composition would keep colliding with the segment axis**, exactly as `Turnkey`
does now.

**No Class name is proposed.**

---

## 2 · Tertiary Packaging — NOT a missing Class

**Nexus/HubSpot `Tertiary Packaging` holds three leaves:**

| SKU | Name | Cost | NetSuite | Class |
|---|---|---:|---|---|
| `COR-0001` | Corrugated Shipper | 0 | InvtPart id 1009 | **Secondary** |
| *(none)* | Lemme – Corrugated Mailer | 12.448 | `Lemme Wang - Corrugated Mailer` | **Secondary** |
| `TRN-TP-SHIPPER` | TRAINING · Master Shipper | — | InvtPart | (none) — training fixture |

`COR-0001`'s single sales line — SO47, 2023-08-09, Tracy Anderson — was
overridden at the line to `Secondary - Corrugated` (65). `TRN-TP-SHIPPER`'s only
line is on a `ZZ-VALIDATION` order.

**A sweep of all 32 tertiary-shaped items in the account settles it.** They split
cleanly, and the split is *by deliverable nature*:

| The deliverable | Class | Examples |
|---|---|---|
| **A physical outer pack** | **`Secondary`** (19 items) | `COR-0001` Corrugated Shipper, `COR-0002` Display, `COR-0003` Insert, `SHIPPER`, `SP-0003` Secondary – Mailer, `DPS-PV-1001/2/3` Pura Vida mailers, `CRQ-DTC-Shipper`, `Lemme Wang - Corrugated Mailer` + Foam, `SHP-773-01`/`SHP-1184-01` Wyn RETF shippers, `DPS-REJ-1001` |
| **A service or fee about outer packing** | **`One Time Charges`** (6) | `OTC-0014` Master Shipper, `OTC-0015` Pallet Shrink Wrap, `OTC-0027` Palletization, `OTC-0043` Pallets, `Outsourced Master Shippers`, `Outsourced Pallet Shrink Wrap` |
| Same, as a logistics service | **`Logistics`** / **`Freight`** | `Palletization Cost and Materials`; `3PL-0004` Palletizing |

**Verdict: no gap.** Tertiary packaging is already coherently represented —
the *thing* as `Secondary`, the *service* as `One Time Charges`/`Logistics`. The
split follows the candidate rule exactly, which is supporting evidence for it.

Two oddities worth noting and not acting on: `PP-0008` is literally named
*"Primary - Pallette"* and is classed `Primary`; `DPS-NES-1002` (Necessaire
holiday) is `Primary` while its siblings `DPS-NEC-1001/1003` are `Secondary`.

---

## 3 · Finished Goods — too broad for one Class

**Four leaves, all Cirqadian:**

| SKU | Name | NetSuite | Class | Lines |
|---|---|---|---|---:|
| `Cirqadian-AM` | Away Message 100ml (FG) | **absent** | — | — |
| `Cirqadian-BS` | Brain Stems 100ml (FG) | InvtPart 72139 | **(none)** | **0** |
| `Cirqadian-GA` | Good Anjou 100ml (FG) | **absent** | — | — |
| `Cirqadian-RS` | **The Ritual Set** (FG) | InvtPart 72140 | **(none)** | **0** |

**It already contains two different commercial identities:**

1. **A single finished consumer unit** — `Cirqadian-BS`, a 100ml product.
2. **A bundle of finished units** — `Cirqadian-RS`, *The Ritual Set*.

A set and a unit are not the same deliverable. A Class built to hold the first
would hold the second only by ignoring the difference.

**And the Product Type is unreliable as a Class source here**: two of the four
have no NetSuite item at all, and the two that exist have **no Class and no sales
history** — so `Finished Goods` has produced **zero classified revenue** to
generalise from.

**Do not assume `Finished Goods` → the proposed manufactured-product Class.**
The evidence supports the opposite caution: the Product Type is a mixed bag of at
least unit-and-bundle, and it has never been exercised.

*(A parallel: the Nexus `Turnkey` Product Type carries the five MISTR gummies,
the two cologne sprays **and** "Cirqadian 3 Sku Discovery Kit, Filling and Black
Easy Spray Pump Glass Vials" — a kit. Same unit-versus-bundle mixture.)*

---

## 4 · The unclassified population, segmented

### 4.1 · The 85 items with no default Class

| Population | n | Should it have a Class? |
|---|---:|---|
| **Item GROUP containers** — `ASY-*`, `WFG842-Wild Adventure-G`, `WFL844-G`, `TCS-BAR-01-G4`, `Cecred Silk Rinse Pouch Assembly(Group)`, `10025 Fill & Assy Silk Rinse (G)` | 27 | **No.** A Group header carries a quantity and no sell value; its members carry the economics and the Class. Legitimately outside |
| **Test / certification / training fixtures** — `CERT-MIXED-DELETE-ME-*` ×3, `OD004-CERT-*` ×4, `SMOKE-PROBE-*`, `ZZ-CERT-KIT-G`, `TRN-*` ×9 | ~18 | **No.** Not commercial records |
| **Non-revenue / system** — `Allowance for Bad Debt`, `Customer Credit`, `Discount`, `Opening Balance Item AP`/`AR`, `Vendor Prepayment`, `Quality Control`, `FinChrg`, `Sales Tax Charge`, `Customer Deposit`, `Credit Card Processing Fees` | ~11 | **No.** Not deliverables |
| **Legacy, explicitly retired** — `3PL-0004 Old (To be removed)`, `FR-0001 Old (To be removed)`, `FR-0007 Old (To be removed)` | 3 | **No.** Their live successors are classed |
| **Manufactured consumer products** — the 9 Assemblies, `355 BrainMD Hydration 20ct (FS)`, `Cirqadian-BS`, `Cirqadian-RS` | **12** | **YES — the genuine gap (§1)** |
| **Raw materials** — `GW-Raw001…005` (fragrances, TEC, Hexanediol, Pentavitin), `FH Organic Coconut Oil` | 6 | **Probably** — `Raw ingredients` exists |
| **Packaging and labels** — `DPS-KIALA-1010`, `DPS-WYN-1001`, `L039`, `L040`, `CS-WSLIP-01/02/03`, `PK0000377 Box` | 8 | **Probably** — `Secondary`/`Secondary - Labels` exist |
| **Outsource charges** — `Evitasource`, `Identipak`, `PRC`, `Outsourced Manufacturing Cost (Lacore)` | 4 | **Probably** — `One Time Charges` is where their siblings sit |
| Other / indeterminate — `IGP-0001`, `OTC-0051`, `Monthly Storage Fee`, `Patrick's Shipping Cost`, `Sol Rework`, `Fragrance, Sample Unit Carton` | ~8 | **Investigate individually** |

**So of 85: roughly 59 are legitimately outside Class, 12 are the real gap, and
~18 are ordinary fill-ins.**

### 4.2 · The 2,052 unclassified sales lines

| Segment | Lines |
|---|---:|
| **MAINLINE** (order header row — no item, no deliverable) | **593** |
| **TAX rows** | **1,046** |
| Item is an Item **Group** container | 43 |
| Item is an **Assembly** — the gap | **4** |
| Item **has** a default Class that was not applied | **33** |
| Item exists with no default either | 79 |

**1,639 of 2,052 — 80% — are mainline or tax rows that are structurally outside
Class.** The "41% of revenue is unclassified" figure in the first audit was
measuring those in.

*(The buckets below the first two overlap and do not sum to the remainder;
reported as measured rather than forced to close.)*

**The 33 lines whose item had a default that was not applied are the only
population here that looks like an error rather than a category.**

---

## 5 · Revenue / COGS by Class — what would be required to prove it

**Not inferable from Sales Orders, and no attempt is made.** A Sales Order is an
intent to sell; it carries no cost postings.

### The evidence required, from production NetSuite

| # | Evidence | Why it is necessary |
|---|---|---|
| 1 | **GL impact by account and Class**, for revenue and COGS accounts, over the same period | The only direct measure. `transactionaccountingline` joined to `transactionline` gives posting-level amounts; Class on the revenue line must be compared with Class on the COGS line **of the same transaction** |
| 2 | **Item Fulfilment and Invoice lines**, not just Sales Orders | COGS posts at fulfilment/invoice, not at order. Without them there is nothing to match |
| 3 | **Vendor Bills and Item Receipts**, with Class | For purchased components and outsourced services, the cost enters here. Whether those lines carry a Class at all is unknown — **in the sandbox they do not exist** |
| 4 | **Assembly Builds** (`WorkOrd` / `AssemblyBuild`) | Decides the question for manufactured products: if the build consumes components classed `Primary`/`Raw ingredients` and produces an assembly classed something else, revenue and COGS are **structurally** in different classes, and no amount of care at the sales line fixes it |
| 5 | **Inventory adjustments and revaluations** | Cost that lands outside the build/fulfilment path |
| 6 | **The Class on the item's COGS account posting**, per item type | InvtPart, Assembly and NonInvtPart post COGS by different mechanisms; a single answer for "does it match" is unlikely |

### The four cases and what each specifically needs

| Case | The question | Evidence |
|---|---|---|
| **Assembly / manufactured** | Does the build's component consumption carry the same Class as the finished-unit revenue line? | #4 + #1. **This is the one most likely to fail**, because the nine Assemblies have no Class while their components have `Primary`/`Raw ingredients`/`Filling and Packout` |
| **Bundled (Item Group)** | The Group header carries no amount; members carry both. Does each member's COGS match its own revenue Class? | #1 + #2, at member granularity |
| **Separately billed OTCs** | An OTC revenue line is `One Time Charges`; its cost is usually a vendor bill for an outsourced service | #3. Whether vendor bills carry Class is the first thing to establish |
| **Passthroughs** | Revenue line is `Passthrough`; the item default is `Raw ingredients`/`Freight`/`One Time Charges` | #1 + #3. **A mismatch here is predictable from the sandbox evidence alone** — the revenue Class is a treatment and the cost will follow the item |

### The prerequisite

**No production NetSuite credential is configured.** Every item above requires
production access, and none of it can be obtained from the current account.

---

## 6 · Verified findings

1. **Nine Assembly items — seven ingestibles, two topicals — all `class = NULL`.**
   Seven sales lines; three carry `Turnkey`; the most recent (Dec 2025) does not.
2. **`WFG842`/`WFL844` default to `Turnkey` and have never been ordered.** Their
   descriptions confirm complete manufactured consumer products.
3. **The same physical unit is classed two ways**: `355-ASSEMBLY` as
   `Filling and Packout Services`, `BrainMD 355 … Pouch(Assembly)` as `Turnkey`.
4. **Cirqadian is sold both decomposed and finished**, with every decomposed part
   correctly classed and both `(FG)` items unclassified and never sold.
5. **Tertiary packaging is fully represented** — physical → `Secondary` (19
   items), service/fee → `One Time Charges`/`Logistics` (8).
6. **`Finished Goods` already mixes a unit and a bundle**, has two of four items
   missing from NetSuite, and has produced **zero** classified revenue.
7. **80% of unclassified sales lines (1,639 of 2,052) are mainline or tax rows.**
8. **Of the 85 unclassified items, ~59 are legitimately outside Class**; 12 are
   the manufactured-product gap.
9. **`OTC-0018` Formulation Fee** shows a second temporal changeover: 7 lines
   classed `One Time Charges` (2024) then 5 classed `Formulation` (Dec 2024 –
   Feb 2025) — this one moving *toward* the item default.

## 7 · Counterexamples to the proposed rules

| Rule | Counterexample |
|---|---|
| The manufactured-product **definition** | **211 `Filling and Packout Services` items satisfy "incorporating formulation/bulk and manufacturing/filling."** The composition clause does no work; only "supplied by DPS as the contracted commercial unit" discriminates, and that is a contract fact absent from the item record |
| Same | **`Cirqadian-RS` The Ritual Set** — a bundle of finished units satisfies the definition, but is a different identity from a unit |
| **Class = deliverable** | Not falsified. `Turnkey`, `Co-Packing`, `Passthrough` remain inconsistent with it, and in each case the rule *explains* the inconsistency |
| **Product Type → Class** | `Finished Goods` maps to **nothing** and internally mixes unit and bundle; `Turnkey` as a Product Type is itself a sourcing word |

## 8 · Candidate genuine Class gaps

| Gap | Evidence | Confidence |
|---|---|---|
| **A Class for the finished manufactured consumer unit** | 12 unclassified items (9 Assemblies + 2 FG + 1 FS); 7 lines, 3 borrowing `Turnkey`, none stable | **High that the gap is real; low that a composition-based definition can draw its boundary** |
| **A Class for a finished-goods bundle / set** | `Cirqadian-RS`, `Cirqadian 3 Sku Discovery Kit` | **Medium — raised, not recommended** |
| Tertiary Packaging | — | **NOT a gap** (§2) |
| `Ingestibles` / `Topicals` as Classes | 0 items classified; the deliverable distinction is unit-vs-service, not ingestible-vs-topical | **Not supported by evidence** |

## 9 · Remaining business decisions

1. **What separates a product DPS sells from a service DPS performs on the
   customer's goods?** §1.3. Everything else waits on this.
2. **Is a set/kit a distinct deliverable from a unit?** §3.
3. **`Turnkey`, `Co-Packing` as Classes** — they duplicate Business Segment values.
4. **`Passthrough` as a Class** — a treatment on the deliverable axis.
5. **Do the `Secondary -` variants stay?** Corrugated ended Aug 2024.
6. **The 33 lines whose item default was not applied** — error or intent?
7. **Production NetSuite access**, without which §5 cannot begin.

## 10 · Revised crosswalk

| Subject | Disposition |
|---|---|
| `Primary`, `Secondary`, `Secondary - Labels`, `Soft Goods and Accessories`, `Freight`, `One Time Charges`, `Raw ingredients`, `Filling and Packout Services`, `Design`, `R&D / Testing`, `Logistics`, `Formulation` | **KEEP** |
| `Labels` (inactive), `Third Party Logistics` (inactive) | **KEEP** inactive |
| **Manufactured consumer unit — no Class exists** | **ADD** — after decision 1 draws the boundary |
| Finished-goods **bundle / set** | **INVESTIGATE** — identity confirmed present, not sized |
| `Turnkey` | **CLARIFY** — duplicates segment `1 · TurnKey`; decide whether it is a deliverable at all |
| `Co-Packing` | **CLARIFY** — duplicates segment `7 · Co-Packing`; its 3 items are outsourced fees |
| `Passthrough` | **CLARIFY** — order-scoped treatment, spans 3 item defaults |
| `Creative` | **CONSOLIDATE LATER** — 0 items, 2 item-less lines, alongside a live `Design` |
| `Development` | **CLARIFY** — 1 internal WIP item, 0 lines; the name collides with `R&D / Testing` |
| `Secondary - Corrugated` | **CONSOLIDATE LATER** — last line Aug 2024 |
| `Secondary - Cards, Booklets` | **CONSOLIDATE LATER** — crossed to the item default during 2025 |
| **Tertiary Packaging** | **KEEP** as is — physical → `Secondary`, service → `One Time Charges`/`Logistics` |
| `Finished Goods` Product Type | **INVESTIGATE** — mixes unit and bundle; 2 of 4 absent from NetSuite; no revenue |
| Product Type → Class renames (`Labels`→`Secondary - Labels`, `Third Party Logistics`→`Logistics`) | **KEEP**, encoded explicitly |
| 27 Item **Groups** unclassified | **KEEP** — correct as is |
| ~18 test/training fixtures; ~11 non-revenue/system; 3 retired legacy | **KEEP** unclassified |
| 12 manufactured products unclassified | **ADD** — same decision as above |
| ~18 ordinary fill-ins (raws, packaging, outsource charges) | **INVESTIGATE**, item by item |
| 33 lines whose item default was not applied | **INVESTIGATE** |
| 1,639 mainline/tax lines | **KEEP** unclassified — structurally outside Class |
| Revenue/COGS comparability | **INVESTIGATE** — requires production access; §5 lists the six evidence types |

**Nothing above has been applied. No class created, renamed, merged or
reclassified; no mapping changed; no production write.**
