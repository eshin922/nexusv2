# `project_setup`, `rd_formulation`, `testing_micros` as owned charges

**2026-09-16 · decisions needed before implementation. #596 held. No code
extension, migration, seeding, restructuring or production change. NetSuite
account provenance stays a separate release item.**

Direction confirmed: reuse standalone product cost lines and charge instances,
no Item Group dependency, no migration unless a verified gap requires one.

**This document corrects two claims I made earlier.** Both are flagged where
they appear (§3, §5).

---

## 1 · The decision table

| | `project_setup` | `rd_formulation` | `testing_micros` |
|---|---|---|---|
| **Existing supported path** | `assembly_production_inputs.setup_fee_total` | `.rd_total` | `.testing_micros_total` |
| **Live rows using it** | **41** (Item Group) | **22** Item Group + **9** Direct Service | **4**, Direct Service only |
| **Existing markup treatment** | `PRODUCTION_MARKUP_CATEGORY` → **`Production` 0.40** | same | same |
| **How that rate is reached** | `chargeEconomicsFor` applies one category to **all seven** fee columns — the column does not choose a rate | same | same |
| **Recommended for an owned charge** | **`Production` 0.40** | **`Production` 0.40** | **`Production` 0.40** |
| **Recovery modes** | `included` · `separate` · (`absorbed` permitted by policy, refused downstream) | same | same |
| **Customer presentation** | `included` → recovered inside the unit price, no line · `separate` → its own line, keyed `otc:instance:<id>` | same | same |
| **BV-011 destination** | `otc_setup` | `otc_formulation` | `otc_testing` |
| **Governed item type** | non-inventory | non-inventory | non-inventory |
| **Destination resolved?** | **Yes** — OTC-0024 | **Yes** — OTC-0050 | **NO — unmapped** |
| **Per-instance item selection?** | **No** | **No** | **No** — see §3 |
| **Blocks sending?** | no | no | **yes, until mapped** |

*(Every "resolved" is in the one configured account; see §8.)*

### The markup rationale

**Preserve the amount when the owner moves.** A setup fee costs what it costs;
which row on the quote owns it is an attribution fact, and attribution must not
move arithmetic — Pattern 58, and the OD-028 defect class. If `setup_fee_total`
on an Item Group recovers at 0.40, a `project_setup` charge on a standalone
product must recover at 0.40, or the same fee prices differently depending on a
structural choice the customer never sees.

That is the whole argument, and it is why the recommendation is the *existing*
rate rather than a better one.

### The complication, which is pre-existing and which I am not fixing here

**Two component charge types already price differently depending on who owns
them:**

| Charge | As a component charge | As a production column |
|---|---|---|
| `tooling` | `Tooling` **0.20** | `Production` **0.40** |
| `artwork_plate` | `Manufacturing` **0.30** | `Production` **0.40** |

Same commercial fact, a 20-point and a 10-point divergence, decided by owner.
That is live today and predates this proposal.

**It bears on the decision in one specific way.** "Match the component
siblings" would put the three new keys at `Manufacturing` or `Tooling`;
"preserve the existing path" puts them at `Production`. They disagree because
the two families already disagree.

**Recommendation: `Production` for all three, and do not widen the divergence.**
The three new keys have **no component-path sibling** — unlike `tooling` and
`artwork_plate`, nothing already prices them on the component side — so
choosing the existing rate introduces no new inconsistency and moves no money.

**Raised separately, not for this change:** whether `tooling` and
`artwork_plate` should price identically regardless of owner. That is a real
question, it has live rows on both sides, and answering it inside a scope change
would move amounts on existing quotes.

---

## 2 · Recovery and customer presentation

Governed by the **one-time class rule** (Edward, 2026-08-24): every charge whose
grain is `one_time` permits all three treatments. These three inherit it; no
per-charge narrowing exists or is proposed.

| Election | What the customer sees | Where the money is |
|---|---|---|
| `included` | nothing — no separate line | recovered inside the owning product's unit price |
| `separate` | its own one-time line, named by the charge policy, sub-captioned as caused by this component | its own accounting line |
| `absorbed` | nothing | **refused downstream** — `ConstructedCommercial.absorbedCost` is read by nothing, so absorbing would drop the cost as well as the revenue |

**Billable for every owner, and this is verified rather than assumed.** A
component charge line is keyed `otc:instance:<chargeInstanceId>` with
`owningAssemblyId: null` — it does **not** key per assembly. That is why the
seven live standalone-product charges bill correctly.

The contrast matters: the *production column* path keys its lines
`otc:<assemblyId>:<field>`, which a leaf with no parent assembly cannot satisfy.
That is the defect `isUnbillablePlacement` refuses for Direct Services — revenue
the engine counted and the document never billed, $1,727.60 on a real quote.

**So the charge-instance mechanism is billable where the production-column
mechanism is not.** This is a stronger reason to prefer it than the one I gave
before (that the production table carries group-only policy columns). Both hold;
this one is structural.

---

## 3 · Per-instance item selection — correcting an earlier claim

**I wrote in two documents that "`other_service` and `otc_testing` choose their
item per line, frozen at send." That is wrong about testing.**

Migration `0090` states the rule and its reason:

> Every other BV-011 destination means one thing, so one firm-wide mapping is
> correct for all of them. `OTC - Other Service` is the catch-all…

**`other_service` is the only destination taking a per-line selection.** It is
refused a firm-level row by CHECK precisely because it has no single accounting
meaning.

| Charge | Item selection |
|---|---|
| `project_setup` | firm-wide mapping · **resolved** |
| `rd_formulation` | firm-wide mapping · **resolved** |
| **`testing_micros`** | **firm-wide mapping · NOT resolved.** No per-instance selection needed or wanted — testing means one thing |
| `other_service` | per-line, frozen at send, in `quote_other_service_items` |

**So the testing requirement is a single admin action — map `otc_testing` — not
a per-instance mechanism.** Until it happens, a `testing_micros` charge is
authorable, costable and elective, and cannot be sent.

*(A related pre-existing gap, noted not fixed: `quote_other_service_items` is
keyed assembly-XOR-Direct-Service-leaf, so a **standalone product** owning an
`other_service` charge would have nowhere to record its item. It never bites
today because `other_service` also has no governed markup rate — it is
`unclassified`, recovers nothing, and cannot be sent. Two refusals that agree.)*

---

## 4 · Who these charges are actually exposed to

**Not standalone-only. Nothing enforces that, and it should not be described as
if something did.**

`quote_charge_instances.owner_ref` is `'@quote'` or **any** `quote_leaves.id`.
No constraint, and no application check, narrows a charge key by owner kind.

### The four affected owners

| Owner | Live leaves | Gets these keys after the change? |
|---|---|---|
| **Quote** (`@quote`) | — | **Already has them.** 16 `project_setup` instances exist, created from the Item Group's column via the recovery path |
| **Item Group member** | 221 | **Yes — new** |
| **Standalone product** | 39 | **Yes — new.** The target |
| **Standalone service** | 12 | **Yes — new** |

### The paths that consult the vocabulary — the complete list

| Path | Reads | Owner-aware? |
|---|---|---|
| `add-component-charges-sheet.tsx` | `COMPONENT_CHARGE_KEYS` | **no** — takes a bare `quoteLeafId` |
| `component-charges/create.ts` | `isComponentChargeKey` | **no** |
| `costing.ts` charge economics | `componentChargeMarkupAuthority` | **no** |
| `commercial-projection.ts` | `componentChargeDestination` | **no** |
| `charge-defaults.ts` + `/admin/charge-defaults` | `COMPONENT_CHARGE_KEYS` | **no** |

### The two collision surfaces this creates

The business-unique constraint is `(quote_id, charge_key, owner_ref, label)`, so
a charge owned by a leaf and one owned by `@quote` are **different rows and both
permitted** — correctly, since they are different facts. But:

1. **Item Group member + the group's own column.** A member owning
   `project_setup` while the group's `setup_fee_total` also carries one. These
   may be genuinely different fees (a component-specific set-up and the run's).
   **Recommend: allow, and surface both on the Costs review, rather than refuse
   a legitimate combination.**
2. **Direct Service + its own governed input.** A Direct Service whose identity
   is Testing owning a `testing_micros` charge while `.testing_micros_total`
   carries one. **These are duplicates by construction** — the column *is* that
   service's one governed input.
   **Recommend: refuse this one.** Narrow, checkable, and the only case where
   the same key on the same leaf means the same fee twice.

**If review wants standalone-only instead**, enforcement belongs in
`component-charges/create.ts` — reject a fee key whose owning leaf is a group
member or a service — and the authoring sheet must offer the three keys only
where they are permitted, or operators will meet a refusal after doing the work.
**I do not recommend this**: an Item Group member causing a set-up fee is a real
commercial fact, and refusing it would push operators back to the group's single
column, which is the shape this work exists to stop depending on.

---

## 5 · The five cost lines — correcting what they are

**I implied component identity that a cost line does not carry.** Correcting it
changes what the example demonstrates.

### What a cost line actually is

`assembly_leaf_inputs` columns: `line_group_id`, `sort_order`, `supplier`,
`category`, `markup_pct` (+ source), `qty_per_sellable_unit`, `unit_cost`,
`purchase_qty`, `inventory_eligible`, `notes`, `pricing_vendor_*`,
`pricing_date`.

**There is no name column, no Library leaf reference, and no unit of measure.**

So the five lines in the earlier example are **five financial rows under one
product**, distinguished only by `supplier`, `category`, `sort_order` and
`notes`. "The bottle" is not a thing Nexus knows about — it is a row whose notes
say bottle.

### What that means, stated plainly

| | Cost line | Library component |
|---|---|---|
| Identity | none — supplier + category + notes | a Library leaf: SKU, name, HubSpot id |
| Specification | none | `leaf_specs`, schema-pinned |
| Can own charges | no | yes — it is a `quote_leaf` |
| Appears on the customer document | no — folded into the product's unit price | yes, when it is a group member |

**So Example 2 demonstrates costing, not structure.** A standalone product can be
costed from several priced elements, each with its own supplier and markup, and
present as one line. It does **not** give those elements identity.

**If the firm needs each element to have identity** — its own SKU, spec, charges
and customer line — that is Library membership, and today membership means an
Item Group. **That is the honest boundary**, and it is exactly where a verified
gap might later justify a migration. Nothing here routes around it, and nothing
here pretends a cost line is a component.

### No BOM, and no unit conversion

The math is one multiplication:

```
lineCost = unitCost × (qtyPerSellableUnit ?? 1)
```

`purchase_qty` does not enter the costing input at all. There is no
bill-of-materials, no explosion, no yield, and no unit-of-measure anywhere on
the row.

**Two bottles per unit.** `unit_cost` = the price of one bottle,
`qty_per_sellable_unit` = `2`. Exact, and already how the field is used.

**Bulk measured by weight.** There is no UOM, so **the operator chooses the
basis and Nexus never checks it.** Two idioms produce the same number:

| | `unit_cost` | `qty_per_sellable_unit` | line cost |
|---|---:|---:|---:|
| basis = kg | `18.0000` | `0.0125` | `0.2250` |
| basis = unit | `0.2250` | `1` | `0.2250` |

**Prefer the first.** `unit_cost` is `numeric(10,4)` — four decimal places — so
a genuinely small per-unit cost loses precision or rounds to zero, while
`qty_per_sellable_unit` is unconstrained numeric and carries the fraction
exactly. Keeping `unit_cost` at the purchase scale is the safer idiom.

**What Nexus does not do, and is not proposed to do:** convert grams to
kilograms, validate that two lines use the same basis, or derive a per-unit
quantity from a formulation. An operator who enters grams on one line and
kilograms on another gets two correct multiplications and one wrong quote.

---

## 6 · Supplier-included versus separately incurred — unchanged

Preserved exactly as stated, because the distinction is the double-billing
guard:

| Situation | What Nexus holds |
|---|---|
| The supplier's per-unit price **already covers** the work | **No charge instance.** The cost is inside `unit_cost`, and there is nothing else to record |
| DPS **separately incurs** the cost and recovers it in the sell price | **A charge instance, elected `included`.** `unit_cost` must not also contain it |
| DPS separately incurs it and bills it as its own line | **A charge instance, elected `separate`** |

`included` means *DPS incurred this separately and is recovering it inside the
unit price.* It does **not** mean the supplier absorbed it. Reading it the second
way, and entering the charge as well, is how one amount travels twice.

**No structural guard exists**, and none is proposed — both shapes are
internally consistent and only the supplier quote distinguishes them. The
surface should require the operator to state which quote a charge comes from; a
cost with no separate quote behind it is already in the unit price.

**Existing amounts and behaviour are unchanged by everything in this document.**
No existing charge, column, rate or election moves.

---

## 7 · Decisions needed

| # | Decision | Blocks |
|---:|---|---|
| **1** | **Markup category for the three keys.** Recommended: `Production` 0.40 for all three, preserving the existing path's amount (§1) | **The whole change.** A key with no authority resolves `unclassified`, recovers nothing and cannot be sent |
| **2** | **Map `otc_testing`** to a NetSuite item | `testing_micros` only — the other two are resolved |
| **3** | **Exposure policy (§4).** Recommended: allow all component owners; refuse only a Direct Service owning the key its own governed input already carries | authoring behaviour |
| **4** | **Confirm the cost-line/component boundary (§5)** — that costing several elements under one product, without giving them identity, meets the need | whether a later structural gap is real |
| **5** | **Owner-dependent rates for `tooling` and `artwork_plate` (§1)** — raised separately; answering it inside this change would move existing amounts | nothing here |

---

## 8 · Smallest implementation scope

**Four map entries and one guard. No migration. No new table, column, module or
engine.**

| # | File | Change |
|---:|---|---|
| 1 | `commercial-recovery/registry.ts` | add three keys to `COMPONENT_CHARGE_KEYS` |
| 2 | same | add three `COMPONENT_CHARGE_LABELS` |
| 3 | same | add three `COMPONENT_CHARGE_MARKUP_AUTHORITY` entries — **decision 1** |
| 4 | `netsuite/component-charge-destination.ts` | `project_setup → otc_setup`, `rd_formulation → otc_formulation`, `testing_micros → otc_testing` |
| 5 | `component-charges/create.ts` | refuse a Direct Service owning the key its own production input carries — **decision 3** |
| 6 | Costs surface | reach the existing `add-component-charges-sheet` from a standalone product row. **CD work is paused; not in scope** |

**Why no migration.** `quote_charge_instances.charge_key` is the full
`recovery_charge` enum and already contains all three keys; the only owner
constraint is `owner_ref = '@quote'` XOR `owner_ref = owner_quote_leaf_id`.
Such a charge is already representable in the production database.

**Tests that would accompany it** (not written): the three keys resolve a
governed rate and a destination; a `separate` election on a standalone product
produces an `otc:instance:` line; the Direct Service duplicate is refused; and
no existing charge's rate, destination or election changes.

**Explicitly out of scope:** `assembly_production_inputs` and its `0082`
constraints; `product_type_charge_defaults` (whether these become *suggestible*
is a separate question for #596, and the table stays empty either way); NetSuite
account provenance (§7 of the coverage decision table, its own release item);
any MISTR restructuring; any seeded rule.

**#596 remains held. Nothing above is implemented.**
