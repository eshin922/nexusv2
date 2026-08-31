# Training-order reconciliation design

**Design artifact. Nothing has been created. No deal, no quote, no code.**

Five orders serving two purposes: durable operator-training records, and the
final Nexus commercial reconciliation population. This document is the harness
design, to be confirmed **before** the five HubSpot deals are created.

---

## 1 · The governing principle, and what it disqualifies

> Nexus must not certify Nexus merely by comparing two outputs derived from the
> same construction.

**This disqualifies most of what currently looks like certification evidence**,
and the disqualification is structural rather than a quality judgement.

`commercial-projection.ts:44` states it in its own words: *"Not a second costing
engine. Unit economics come from `skuRollups`, computed …"*. The customer
document does not independently compute; it **projects** engine output. The
freeze projects the same lineage. The NetSuite payload projects the freeze.

So a document-versus-engine comparison — including the OD-028 population capture
merged earlier this month — **cannot falsify the arithmetic**. It falsifies
*attribution and plumbing*, which is real and worth keeping, and it is silent on
whether the numbers are right.

### Evidence classes, assigned per row in §4

| Class | Meaning | Can falsify |
|---|---|---|
| **A — Independent** | Expected value computed **outside Nexus** from source facts fixed in advance, or computed by NetSuite itself | **arithmetic**, attribution, projection |
| **B — Second implementation** | Recomputed from persisted DB rows by a harness that does **not** import `costing.ts` | implementation drift; **shares the specification** |
| **C — Circular** | Both sides derive from `computeQuoteCosting` | attribution, projection, plumbing — **never arithmetic** |

**No row may be certified on class C alone.** Class C rows are retained where
they are the only way to test attribution, and are labelled so nobody later
reads them as arithmetic proof.

### The device that makes class A cheap

**We choose the inputs, so we can compute the expected outputs before Nexus
runs.** Every value in §3 is fixed in this document, in advance. The expectation
therefore exists independently of any Nexus code path, which is what makes it
capable of falsifying one. This is the single most important property of the
design and the reason the value schedule is specified here rather than at
staging time.

**Where NetSuite is genuinely independent:** the sandbox SO's own subtotal and
total are computed by NetSuite from rate × quantity. Comparing the Nexus frozen
commercial total against NetSuite's own arithmetic is class A.

---

## 2 · Value-design rules

Errors must be **distinguishable**, so the schedule deliberately avoids values
where a swap, duplication, collapse or double-count stays invisible.

1. **No repeated values within a comparable set.** Same-type sibling charges,
   members of one Item Group, and per-tier costs all differ. A collapse of two
   into one, or a swap, changes a total.
2. **No round numbers where a factor could hide.** Costs carry cents that do not
   divide evenly, so an off-by-a-factor error cannot land on a plausible value.
3. **Distinct markup categories.** Tooling 0.20, Manufacturing 0.30, Primary
   0.45, Secondary 0.50 — a category mix-up moves the number.
4. **At least one Item Group member with `quantity ≠ 1`.** This is the
   `qty_per_parent` round-trip trap: an amount amortised at a leaf, bubbled up
   × quantity and multiplied back out does **not** return the amount. Pattern 59
   names it; nothing in the current population exercises it.
5. **Tier quantities that separate per-unit from fixed-total mistakes.** A fixed
   charge divided by tier quantity and multiplied back must return itself at
   every tier; quantities are chosen so a per-unit/total confusion diverges by
   orders of magnitude at the extremes.
6. **Freight, duty and tariff values that cannot cancel.** Distinct percentages
   on distinct bases, so no accidental identity holds.
7. **Non-zero adjustments.** Global and per-tier adjustments are non-zero and
   unequal, so an adjustment applied twice, at the wrong level, or not at all is
   visible.

---

## 3 · The five orders — fixed value schedule

All names carry the `TRAINING ·` prefix and are unmistakably not customer data.

### Order 1 · TRAINING · Serum Launch — production economics, **completes**

Item Group `TRN-SERUM-30` (Skincare). Tiers **1,000 / 2,500 / 6,000 / 15,000**,
recommended **6,000**.

| Member | qty/parent | category | tier costs (1k / 2.5k / 6k / 15k) |
|---|---|---|---|
| TRN Bottle 30ml | 1 | Primary 0.45 | 1.37 / 1.19 / 1.04 / 0.92 |
| TRN Pump closure | 1 | Primary 0.45 | 0.63 / 0.58 / 0.51 / 0.46 |
| TRN Label set | **2** | Secondary 0.50 | 0.21 / 0.18 / 0.16 / 0.14 |
| TRN Unit carton | 1 | Secondary 0.50 | 0.44 / 0.39 / 0.34 / 0.31 |

Four members, one at qty 2 → exposes attribution order **and** rule 4.

Production (allocate to cost = **true**), authored on the **Item Group
production columns** — `assembly_production_inputs`:

| column | value | class |
|---|---|---|
| `filling_blending_cost` | 3,180.00 | per-unit COGS |
| `cm_assembly_total` | 1,455.00 | per-unit COGS |
| `bulk_raw_cost` | 7,240.00 | per-unit COGS, RAW authority |
| `setup_fee_total` | 2,600.00 | **assembly production one-time charge** |
| `tooling_total` | **11,450.00** | **assembly production one-time charge** |
| `artwork_total` | 1,875.00 | **assembly production one-time charge** |
| `rd_total` | 4,320.00 | **assembly production one-time charge** |

All distinct; none a multiple of another.

> #### ⚠️ Terminology — two different things are called "tooling"
>
> Order 1's 11,450.00 is **assembly production tooling**: the legacy governed
> column `assembly_production_inputs.tooling_total`, which resolves its
> destination through `OTC_COLUMN_DESTINATION` → **`otc_tooling`**, and prices
> through the `Production` markup category (0.40).
>
> It is **NOT** a **component-owned tooling charge** — a
> `quote_charge_instances` row of type `tooling`, owned by a `quote_leaves`
> component, priced through the `Tooling` category (0.20), whose destination is
> **ungoverned and blocked by BV-014**.
>
> **These two never mix in this design.** Order 1 carries only the assembly
> production path, which is why it can complete. Component-owned charges appear
> only in **Order 2**, which stops at Accepted.
>
> **Consequently: a successful Order 1 NetSuite tooling result certifies the
> ASSEMBLY PRODUCTION tooling path and nothing else.** It must never be read as
> certifying component-owned tooling, whose destination does not exist yet. The
> two are written distinctly everywhere below for exactly this reason.

Pricing: global adjustment **+6%**, per-tier adjustment **+2.5%** on the 2,500
tier only, quote target margin **38%**.

Recovery on the four **assembly production one-time charges**: setup
**included**, assembly-production tooling **separate**, R&D **separate**,
artwork **included**. Both placements exercised, on charges of different
magnitude. All four price through `Production` 0.40.

Pre-computed governed recoveries: setup **3,640.00**, tooling **16,030.00**,
artwork **2,625.00**, R&D **6,048.00**. Only the two **separate** ones become
their own SO lines; the two **included** ones land inside the unit price.

→ **Accepted, then Complete against NetSuite sandbox.**

### Order 2 · TRAINING · Retail Gift Set — component charges, **Accepted only**

Item Group with **5** members. Tiers 500 / 1,500 / 4,000.

| Component charge | owner | cost |
|---|---|---|
| Print plates **#1** | Outer sleeve | **1,850.00** |
| Print plates **#2** | Outer sleeve *(same component, same type)* | **2,240.00** |
| Print plates **#3** | Insert tray *(different component)* | **1,615.00** |
| Tooling & dies | Insert tray | **3,720.00** |
| Samples & PPS | Outer sleeve | **940.00** |

This is the sharpest sub-design in the set. Three `print_plates` at three
different costs prove, in one order: **sibling independence** (#1 vs #2 on one
component), **owner independence** (#2 vs #3 across components — the rate must
be identical while the cost differs, since owner must not determine markup), and
that a **collapse or swap is visible** because no two costs are equal.

Recovery: #1 **included**, #2 **separate**, #3 **separate**, tooling
**separate**, samples **included**.

→ **Accepted only.** Also the deliberate proof that **BV-014 destination
readiness blocks Complete, not Acceptance.** If Acceptance is also blocked, we
stop and report rather than bypass.

### Order 3 · TRAINING · Contract Fill — Direct Service, approval, override

Direct Service leaves, per-tier amounts. Tiers 2,000 / 5,000 / 12,000.

- Direct Service costs **4,860.00 / 9,240.00 / 18,110.00** — deliberately not
  proportional to quantity, so a per-unit assumption fails.
- **One manual all-in sell override** on a single (leaf, tier) cell → exercises
  manual-all-in exception semantics, and the Option-B rule that a manual
  override is the **final all-in customer unit price**.
- **Client target** set on a different cell + reverse-solve.
- **Below-floor approval** request and decision.

→ **Accepted only.**

### Order 4 · TRAINING · Import Programme — freight, duty, tariff

Direct Products (no Item Group). Tiers 3,000 / 8,000.

- Two leg groups: international **ocean** (Ningbo → Long Beach, FOB, vessel
  ETD/ETA, cargo-ready) and domestic **LTL** (Long Beach → Reno).
- Freight **7,430.00** ocean / **1,265.00** LTL — not multiples.
- Duty **4.2%**, tariff **7.5%**, freight markup **18%** — three distinct rates
  on distinct bases, so no pair cancels.
- Treatment: ocean **pass-through**, LTL **bundled** — both presentations.

→ **Accepted only.**

### Order 5 · TRAINING · Full Spec Reference — specs and customer document

Item Group carrying PP + SP + TP members. Tiers 1,000 / 5,000.

- **All 31 spec fields populated**: Primary 10, Secondary 11, Tertiary 10.
- Presentation axes: layout, detail level, spec addendum included, one tier
  hidden.
- Attachment with notes; accounting instruction; internal and customer-facing
  notes both populated.

→ **Accepted only.** Lowest economic risk, highest document/field coverage.

---

## 4 · Reconciliation matrix

Tolerance is governed by stored precision: **money `numeric(14,2)` → ±0.005**;
**rates `numeric(5,4)` → ±1e-4**; **frozen unit rate `numeric(18,8)` → ±1e-8**;
**identities, quantities, counts, enum values → exact**. A residual inside
tolerance is PASS only if it is *also* explained; **no unexplained residual is
PASS**.

### Costs

| Calculation | Primary | Control | Independent source facts | Expected | Nexus output | Class |
|---|---|---|---|---|---|---|
| Packaging component cost | 1 | 5 | `assembly_leaf_inputs.unit_cost` per (line,tier) | schedule §3 | leaf rollup cost | **A** |
| Quantity multiplication | 1 (label ×2) | 2 | `assembly_leaves.quantity` | cost × qty/parent | assembly rollup | **A** |
| Production economics | 1 | 3 | 7 `assembly_production_inputs` columns | Σ, allocated | production cost/unit | **A** |
| Direct Service cost | 3 | — | `assembly_production_inputs` per leaf/tier | schedule §3 | Direct Service rollup | **A** |
| Bulk raw | 1 | — | `bulk_raw_cost`, `raws_mode` | 7,240.00 at RAW authority | RAW section | **A** |
| Freight | 4 | 1 | `freight_legs`, `freight_leg_tiers` | per-CBM share | freight/unit | **A** |
| Duty / tariff | 4 | — | `duty_pct`, `tariff_pct` + base | base × rate | landed freight | **A** |
| Component one-time charges | 2 | — | `quote_charge_instance_tiers.cost_amount` | 5 costs, §3 | charge economics | **A** |
| Total contribution cost | 1 | 4 | all of the above | Σ | `contributionCostPerUnit` | **A** |

### Commercial pricing

| Calculation | Primary | Control | Independent source facts | Expected | Class |
|---|---|---|---|---|---|
| Markup authority / category | 2 | 1 | registry map + `markup_defaults` | Tooling 0.20 / Mfg 0.30 / Primary 0.45 / Secondary 0.50 | **A** |
| Markup calculation | 1 | 2 | cost + rate | cost × (1+rate) | **A** |
| Global adjustment | 1 | 4 | `global_price_adj_pct` +6% | applied once, to the priceable base only | **A** |
| Per-tier adjustment | 1 | — | `tier_price_adj_pct` +2.5%, one tier | **replaces**, does not stack | **A** |
| Target-margin behaviour | 1 | 3 | quote 38% vs firm default | verdict + required sell | **A** |
| Manual sell override | 3 | — | `assembly_leaf_overrides` | final all-in unit price; not "absorbing" | **A** |
| Client target | 3 | — | `assembly_leaf_targets` | competitive verdict + solve | **A** |
| Final unit sell | 1 | 3 | all pricing inputs | hand-computed per tier | **A** |
| Margin $ / % | 1 | 4 | revenue − cost | hand-computed | **A** |

### Commercial recovery

| Calculation | Primary | Control | Expected | Class |
|---|---|---|---|---|
| Charge type → markup authority | 2 | 1 | plates→Tooling, tooling→Tooling, samples→Mfg | **A** |
| Cost → governed recovery | 2 | 1 | cost × (1+rate), all five distinct | **A** |
| Included | 1, 2 | — | lands in unit price; tier total unchanged | **A** |
| Separate | 1, 2 | — | lands as OTC line; tier total unchanged | **A** |
| Absorbed | — | — | **not exercised** — refused by `ABSORB_COST_UNCONSUMED` | n/a |
| Instance independence | 2 | — | #1 ≠ #2 by 390.00 at cost, 468.00 at recovery | **A** |
| Same-type sibling independence | 2 | — | #2 vs #3 same rate, different cost | **A** |
| Tier independence | 1 | 2 | per-tier costs differ → per-tier recovery differs | **A** |

### Customer document

| Calculation | Primary | Control | Expected | Class |
|---|---|---|---|---|
| Unit lines | 5 | 1 | per-member display + rate | **C** for arithmetic, **A** for presence/label |
| Service lines | 3 | — | Direct Service line | **C / A** |
| One-time lines | 2 | 1 | 5 OTC lines at governed recovery | **A** (values pre-computed) |
| Freight presentation | 4 | — | pass-through itemised; bundled invisible | **A** |
| Tier totals | 1 | 4 | unit subtotal + OTC subtotal | **A** |
| Recommended tier | 1 | 5 | 6,000 marked | **A** exact |
| Placement invariance | 1 | 2 | moving included↔separate leaves tier total unchanged | **A** |
| Manual-all-in semantics | 3 | — | override is final all-in | **A** |

*Document reconciliation is deliberately split: totals are class A because the
expectation is pre-computed, while per-line unit economics are class C because
the projection reads `skuRollups`.*

### Acceptance / freeze

| Calculation | Primary | Expected | Class |
|---|---|---|---|
| Accepted tier | 1 | 6,000 | **A** exact |
| Accepted quantities | 1 | tier qty | **A** exact |
| Commercial identities | 1, 2 | instance ids, owner refs | **A** exact |
| Frozen cost | 1 | equals pre-computed cost | **A** |
| Frozen recovery | 1, 2 | equals pre-computed recovery | **A** |
| Treatment | 1, 2 | matches election | **A** exact |
| Provenance / `owner_kind` | 1, 2 | assembly / component / direct_service | **A** exact |
| Destination where governed | 1 | `otc_setup`, `otc_tooling`, `otc_formulation`, `otc_artwork` | **A** exact |
| No draft fact substituted | 1 | post-accept edit attempt refused; frozen values unmoved | **A** |

### Predeclared NetSuite line schedule — Order 1, accepted tier **6,000**

**Fixed before Nexus runs.** Destination semantics are declared here; only the
NetSuite *internal id* is resolved at execution, from the governed mapping
table, and recorded separately in §4.1.

Line shapes follow `accounting-line-emitter.ts`: a separately-billed one-time
charge posts at **quantity 1** with the rate carrying the whole amount; an Item
Group member resolves **by SKU at its own quantity**; a Direct Service posts at
its **frozen quantity and rate**.

| # | governing Nexus source | expected BV-011 destination | expected NetSuite semantic item | expected qty | rate / amount derivation | grouping |
|---|---|---|---|---|---|---|
| 1 | Item Group `TRN-SERUM-30` | — *(resolves by SKU, no destination)* | Item Group record | — | group header | **group parent** |
| 1a | member · TRN Bottle 30ml | — | product item by SKU | **6,000** | frozen `unit_rate` × qty | member of #1 |
| 1b | member · TRN Pump closure | — | product item by SKU | **6,000** | frozen `unit_rate` × qty | member of #1 |
| 1c | member · TRN Label set | — | product item by SKU | **12,000** *(6,000 × qty/parent 2)* | frozen `unit_rate` × qty | member of #1 |
| 1d | member · TRN Unit carton | — | product item by SKU | **6,000** | frozen `unit_rate` × qty | member of #1 |
| 2 | `assembly_production_inputs.tooling_total`, elected **separate** | **`otc_tooling`** | mapped OTC item | **1** | rate = **16,030.00** = 11,450.00 × 1.40 | top-level |
| 3 | `assembly_production_inputs.rd_total`, elected **separate** | **`otc_formulation`** | mapped OTC item | **1** | rate = **6,048.00** = 4,320.00 × 1.40 | top-level |

**Not expected as lines**, and their absence is itself an assertion: setup
(3,640.00) and artwork (2,625.00) are elected **included**, so they belong
inside the unit price and must produce **no** SO line. Filling/blending, CM
assembly and bulk raw are per-unit COGS and never produce a line.

**No component-owned OTC line is expected on Order 1.** If one appears, that is
a failure.

#### 4.1 · Mapping resolved at execution, recorded separately

| destination | governed item type | mapping source | recorded at execution |
|---|---|---|---|
| `otc_tooling` | Inventory *(BV-011)* | `netsuite_destination_item_map` | internal id + item code |
| `otc_formulation` | Non-inventory | `netsuite_destination_item_map` | internal id + item code |

The reconciliation must **prove the actual SO line used the mapped item**, by
reading the mapping row and the posted line and comparing internal ids — not by
observing that a plausible item appeared.

> **§5.6c caveat, carried explicitly.** `otc_tooling` is declared **Inventory**
> by BV-011 while its mapped item `OTC-0005` is **NonInvtPart**, an Accounting
> question open since 2026-08-19 and untouched. Order 1 will post to that item.
> **Order 1 can certify that the line reached the mapped destination; it cannot
> certify that the item type is correct.** That remains Accounting's to settle
> and is explicitly outside what this population proves.

### The three proofs a NetSuite line must pass

**Nexus projection == NetSuite SO is not certification.** A faithfully
transmitted Nexus mistake would pass it. Each line must clear all three:

| Proof | Question | Compared against | Class |
|---|---|---|---|
| **1 · Arithmetic** | is the commercial amount right? | independently pre-computed source facts (§3) | **A** |
| **2 · Projection** | did the right amount reach the right place? | the predeclared schedule above — destination, item, quantity, rate, grouping | **A** |
| **3 · ERP fidelity** | did NetSuite receive and compute it faithfully? | actual sandbox line + **NetSuite's own** amount / subtotal / total | **A** |

A line passing 3 but failing 1 is a correctly transmitted wrong number. A line
passing 1 and 3 but failing 2 is a right number in the wrong account. Both are
FAIL.

### Order / NetSuite sandbox — Order 1 only

| Check | Expected | Class |
|---|---|---|
| Customer | resolved NetSuite customer id | **A** exact |
| Item identities | mapped item internal ids | **A** exact |
| Item Group composition | 4 members, correct SKUs | **A** exact |
| Quantities | member qty × tier qty, label at ×2 | **A** exact |
| Rates | frozen `unit_rate` (8dp) | **A** ±1e-8 |
| OTC / service lines | tooling + R&D as separate lines | **A** exact |
| Grouping | Item Group renders as a group | **A** exact |
| SO subtotal / total | **NetSuite's own arithmetic** | **A** ±0.005 |
| Nexus frozen total vs SO total | equal | **A** ±0.005 |

---

## 5 · Coverage gaps, stated rather than papered over

| Capability | Status |
|---|---|
| **Absorbed** recovery | **Not certifiable.** Policy permits it; `ABSORB_COST_UNCONSUMED` refuses it because `absorbedCost` is read by nothing. |
| Component-charge **destination** | **Not certifiable.** BV-014 blocked; every component OTC line carries `bv011Destination: null`. Order 2 proves the block sits at Complete, not Acceptance. |
| **HubSpot deal-stage** write | **Not exercised.** Suppressed at source; this is environment isolation, not a parallel path. |
| HubSpot **product creation** | **Excluded by instruction.** Any field reachable only by creating a production HubSpot product is marked unavailable under the training constraint. |
| `otc_dies` / Tooling-vs-Dies | **Not certifiable.** No authoring surface exists. |

### 5.1 · What the NetSuite result does and does not certify

**Order 1 certifies only the line types it actually contains.** Stated as a
list so the boundary cannot be widened by implication:

**Certified by Order 1 (if it passes all three proofs):**

- Item Group grouping and member lines resolving by SKU at member quantity,
  including a member at quantity ≠ 1;
- `otc_tooling` and `otc_formulation` as destinations for **assembly production
  one-time charges** elected *separate*;
- quantity-1 OTC line shape with the rate carrying the amount;
- included-charge absence — no line for an included charge;
- Nexus frozen commercial total against NetSuite's own total.

**NOT certified by Order 1, and not to be implied:**

- **Component-owned OTC destinations** — ungoverned, BV-014 blocked, and
  deliberately absent from Order 1;
- **`otc_tooling` item type** — §5.6c open; the line reaches the mapped item,
  and whether that item is the right *type* is unproven;
- `otc_artwork`, `otc_setup` as SO lines — those charges are *included* here, so
  their destinations are not exercised as lines;
- `otc_print_plates`, `otc_samples`, `otc_dies` — no mapped item exists;
- Direct Service line shape — Order 3 carries Direct Service and stops at
  Accepted, so **no Direct Service line is certified against NetSuite at all**.

---

## 6 · Rules of engagement

- All business state through **operator surfaces only**. No SQL population, seed
  scripts, fixture writers, direct action invocation or backend repair.
- Read-only SQL is authorised to **observe and recompute**, never to populate,
  repair or alter these five orders.
- An applicable field unreachable through the UI is a **reachability finding**,
  recorded — never filled behind the interface.
- **If reconciliation fails, the defect is reported.** Database state is not
  changed to make certification pass.
- Re-verify `/api/certification-status` **immediately before each Accept**;
  `providerSuppressed: false` at any point is a full stop.
