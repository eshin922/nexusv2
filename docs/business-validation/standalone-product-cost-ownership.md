# A standalone quoted product carrying its own costs

**2026-09-16 · proposal for review. #596 stays held. Nothing here is
implemented: no migration, no seeding, no restructuring, no production change,
no CD work.**

**Requirement being answered:** a standalone quoted product must be able to
carry its applicable costs, services and charges **without being converted into
a group**. Item Groups stay optional, for products genuinely quoted together.

> **Followed by [`fee-charge-decisions.md`](fee-charge-decisions.md)**, which
> carries the decisions this proposal defers — the markup category for each key,
> the exposure question (these charges are **not** standalone-only), and two
> corrections to this document: §5's five cost lines are **financial rows, not
> Library components**, and testing needs a firm-wide mapping rather than a
> per-instance item selection.

**Retracted:** the earlier suggestion that MISTR's structure be decided by which
fields it unlocks. The contract and the supplier quote decide it. This document
therefore shows both structures working, and proposes the change that makes the
standalone one complete on its own terms.

---

## 1 · Two corrections first

### 1.1 · "Over-inclusiveness is free" — wrong

I argued that because every default is confirmed, an irrelevant suggestion costs
nothing. **It does cost something, and the cost compounds in the direction that
matters.**

- **It creates work.** Every irrelevant row is read, judged and dismissed, on
  every component, by every operator, forever.
- **It trains mechanical acceptance.** A list that is usually wrong gets skimmed;
  a list that is usually right gets trusted. Both end in the same place — the
  operator stops reading — and the second is worse because it is earned.
- **Confirmation reduces risk; it does not eliminate it.** A tick-box confirmed
  without attention is not a decision. The invariant in §6 of the decision table
  (a default never becomes a charge without a person affirming it) remains
  necessary and is **not sufficient on its own**.

**I also asserted a rate — "right 60% of the time" — with no evidence for it.
That number was invented and is withdrawn.** Twelve live component-charge
instances across three product types cannot support any applicability
percentage, and none should be quoted until someone counts.

**Replacement principle: suggest only what is USEFUL, and let usefulness be
demonstrated, not assumed.**

> A charge earns a place in a type's defaults when someone who authors these
> quotes says it belongs there. Until then the type is `needs_review`, which is
> the truthful state and costs nobody anything.

So the proposal for #596's first rules is: **start from what the firm can attest,
not from what the catalogue suggests.** No rule derived from the 12 observed
instances; no preselection anywhere until a reviewer states the charge belongs
by default and why. That leaves the table empty for longer, which is correct.

### 1.2 · NetSuite is a separate release concern

Lifted out of this design entirely. See §7 — documented, with safeguards
proposed separately, **no remapping and no credential change.**

---

## 2 · What a standalone product can already carry

Not a design sketch. This is what the live database does today.

| Capability | Mechanism | Live evidence |
|---|---|---|
| **Its own per-unit cost lines** | `assembly_leaf_inputs` keyed on `quote_leaf_id` — **no commercial-kind restriction** | **39 standalone products carry 73 cost rows** |
| **Several cost lines under one SKU** | `line_group_id`, one per costed element | `BA146400` carries **3**; `10042.V3` carries **2**, both category `Manufacturing` |
| **Per-line supplier, category and markup** | `supplier`, `category`, `markup_pct`, `markup_pct_source` | in use across those rows |
| **One-time charges of its own** | `quote_charge_instances.owner_quote_leaf_id` → any `quote_leaves` row | **7 live charges owned by standalone products** |
| **Those charges costed per tier** | `quote_charge_instance_tiers.cost_amount` | `TRN-SP-CARTON` cutting die **$4,200**; `TRN-SP-LABEL` artwork **$100** + plates **$100** |
| **Its own customer line and SO line** | `CommercialLineKind = "direct_product"` | a first-class kind, not a fallback |
| **Recovery elected per charge** | `quote_charge_recovery` — `included` or `separate` | the same machinery as any other owner |

**A standalone product is already a full commercial citizen.** It costs, marks
up, recovers, prints and posts under **its own SKU**, with no group anywhere.

### The one thing it cannot carry, stated exactly

`assembly_production_inputs` — the manufacturing-fee family (setup, R&D,
testing, filling, pack-out, bulk raw, the tooling/artwork columns) and its
policies (`customer_ships_raws`, `allocate_service_fees_to_cost`,
`actual_units_produced`).

Blocked by two named constraints in migration `0082`:

```
assembly_production_inputs_owner_xor          CHECK: exactly one of assembly_id / quote_leaf_id
assembly_production_inputs_service_owner_fk   FK (quote_leaf_id, owner_commercial_kind)
                                                 -> quote_leaves (id, commercial_kind)

owner_commercial_kind  GENERATED ALWAYS AS
   (CASE WHEN quote_leaf_id IS NULL THEN NULL ELSE 'service' END)
```

The literal `'service'` in that expression is the whole restriction. A
product-kind leaf makes the pair `(leaf, 'service')` unresolvable, so the insert
is refused by the planner.

**Zero rows carry `owner_commercial_kind = 'product'` and none can.**

---

## 3 · Proposed ownership model

One rule, from which the rest follows:

> **The owner of a cost is the thing on the quote whose line the customer is
> buying.** A group owns what is the group's. A standalone product owns what is
> the product's. Neither borrows the other's worksheet.

| Owner | May carry | Today |
|---|---|---|
| **Quote** | landed charges (container freight, duty & tariffs); recovery elections | ✓ |
| **Item Group** | the production worksheet + its policies; member components | ✓ |
| **Standalone product** | its own per-unit cost lines; **one-time charges of every applicable type** | cost lines ✓ · charges ✓ · **fee types ✗ (§5)** |
| **Standalone service** | exactly one governed production input | ✓ |
| **Component** (a group member, or a standalone product itself) | one-time charges it caused | ✓ |

### Why NOT extend `assembly_production_inputs` to products

It is the tempting move and it is the wrong one. That table is **the Item
Group's production worksheet**: it carries per-assembly policy — does the
customer ship raws, are service fees allocated to cost, what were the actual
units produced — which are statements about a manufacturing run. A bought-complete
product has no run and none of those questions has an answer for it.

Extending it would put a group's worksheet on a product. **That is the artificial
group again, wearing a different name** — the structure would be a product and
the economics would be a group's, and everything downstream would have to know
which it was really looking at.

### What to do instead

**Express a standalone product's one-time fees as charge instances** — the
mechanism the system already has for "a one-time fee owned by a thing on the
quote", already working on standalone products with real money in it (§2).

A charge instance is the right shape for this and the production columns are
not, for a reason that outlives this decision: **a column holds one value per
quote; an instance is a row.** Two development charges from two labs are two
facts. `assembly_production_inputs.rd_total` can hold one of them.

---

## 4 · Worked example 1 · The manufacturer's complete per-unit price

**MISTR gummies bought complete from a contract manufacturer**, with development
quoted separately by that manufacturer or by a lab.

### Identity — unchanged

| | |
|---|---|
| Quoted SKU | `DPS-MISTR-1007` (leaf `42a50423-…`, HubSpot 47890196399) |
| Product type | `Turnkey` |
| Structure | **Standalone product.** No group, no second row, no new SKU |
| Quote | `MISTR - Supplement Capsules` · `0cc928ae-…` · draft · tier 10,000 |

### Internal cost ownership

| Cost | Owner | Field | Status |
|---|---|---|---|
| CM's complete per-unit price | the product | `assembly_leaf_inputs.unit_cost`, one line group, `supplier` = the CM, `category` = `Manufacturing` | **works today** |
| Development / formulation, separately quoted | the product | a `rd_formulation` charge instance, cost in `quote_charge_instance_tiers.cost_amount` | **blocked — §5** |
| Micro / stability testing, separately quoted | the product | a `testing_micros` charge instance | **blocked — §5** |

### Customer-facing lines

| Line | Comes from | Appears when |
|---|---|---|
| `MISTR - Multi Gummy` — unit price × 10,000 | the cost line + its markup | always |
| `Development` — one-time | the `rd_formulation` charge | only when recovery = `separate` |
| `Testing` — one-time | the `testing_micros` charge | only when recovery = `separate` |

With recovery `included`, the development is recovered **inside the unit price**
and no separate line prints. One election, two presentations, one amount.

### Development already in the supplier price versus separately quoted

**The distinction that prevents double billing, and it is not subtle:**

| Situation | What Nexus should hold |
|---|---|
| The CM's per-unit price **already covers** development | **No charge instance at all.** The cost is inside `unit_cost`. Nothing else to record |
| Development is **separately quoted** — by the CM or a lab | **A charge instance**, and `unit_cost` must not also contain it |

`included` recovery does **not** mean "the supplier already covered it". It means
*DPS incurred this cost separately and is recovering it inside the unit price.*
Reading `included` as "the supplier absorbed it" and also entering it as a charge
is exactly how the same money travels twice — Pattern 59, in the place it is
easiest to make.

**Nexus cannot detect this**, and should not pretend to: both shapes are
internally consistent. The guard is procedural and belongs on the surface:

> When a charge instance is added to a standalone product, the operator states
> the supplier quote it comes from. A cost with no separate quote behind it is
> already in the unit price.

### Unsupported relationship in this example

`rd_formulation` and `testing_micros` **cannot be authored as component
charges** — §5. Today the work would have to be typed as `other_service`, which
has **no governed markup rate by decision**, so it recovers nothing and the quote
cannot be sent. That is a real dead end and it is the whole gap.

*(The firm's existing workaround is visible in the catalogue: `OTC-0016 OTC -
Micro Testing`, `OTC-0001 OTC - Art / Prep / Proof` and `OTC-0029 OTC - Product
Flush` are `One Time Charges` leaves attached as their own standalone products
with their own cost lines. It works, it posts, and it costs a catalogue SKU per
fee plus a customer line that cannot be folded into the unit price. It is a
sound fallback and a poor default.)*

---

## 5 · Worked example 2 · Separately costed components and manufacturing work, one deliverable

**Same SKU. Same customer line. No group.**

### Identity — unchanged

| | |
|---|---|
| Quoted SKU | `DPS-MISTR-1007` — **the same single row.** No group row, no member rows, no duplicate |
| Structure | **Standalone product with several cost lines** |

### Internal cost ownership — one line group per costed element

| Line group | `category` | `supplier` | `qty_per_sellable_unit` | Field |
|---|---|---|---|---|
| Gummy bulk | `Production` | the formulator | per-unit yield | `assembly_leaf_inputs.unit_cost` |
| Bottle | `Primary` | the bottle supplier | 1 | same |
| Label | `Secondary` | the printer | 1 | same |
| Carton | `Secondary` | the converter | 1 / units-per-carton | same |
| **Fill, cap and pack labour** | `Manufacturing` | the CM | 1 | same |

Each line carries its own markup category and rate. The product's unit cost is
their sum; its price is the marked-up sum. **One customer line, several costed
elements, no group** — and this is not hypothetical: `BA146400` runs three line
groups and `10042.V3` runs two under `Manufacturing` today.

### One-time charges on the same product

| Charge | Type | Owner | Status |
|---|---|---|---|
| Carton cutting die | `tooling` + `cutting_die` | the product | **works today** — `TRN-SP-CARTON` carries $4,200 |
| Label print plates | `print_plates` | the product | **works today** — `TRN-SP-LABEL` carries $100 |
| Artwork / prepress | `artwork_plate` | the product | **works today** |
| Line set-up / changeover | `project_setup` | the product | **blocked — §6** |
| Formulation development | `rd_formulation` | the product | **blocked — §6** |
| Micro / stability testing | `testing_micros` | the product | **blocked — §6** |

### Customer-facing lines

One priced line — `MISTR - Multi Gummy` at the blended unit price — plus one
line per charge elected `separate`. Charges elected `included` are recovered
inside the unit price and print nothing.

### Preventing double counting

**The rule, stated once:** an amount is **either** a per-unit rate **or** a
one-time charge. Never both.

| Risk | Guard |
|---|---|
| A set-up fee entered as a `Manufacturing` cost line **and** as a `project_setup` charge | The cost line is a per-unit rate multiplied by tier quantity; the charge is a fixed amount. Entering both bills a fixed fee twice at two different scales |
| A component's cost counted in its own line and again in a "complete" price | Example 2's lines are *elements*; Example 1's single line is *complete*. **Mixing the two shapes on one product is the error** — a product is costed one way or the other |
| A charge amortised into the unit rate and also raised as a line | Recovery election decides the *presentation* of one amount; it never creates a second |

**No structural guard exists for any of these.** They are commercial judgements
made while costing, and the surface can only make them legible — which is an
argument for the notes and supplier-quote reference in §4, not for a validator
that would guess.

### Unsupported relationships in this example

Only the three fee types in §6. Every other element — components, manufacturing
labour, tooling, plates, artwork, markup, recovery, the customer line, the SO
line — works today with no change.

---

## 6 · The smallest change

**Not a module. Not a cost engine. Not a migration.**

The database already permits it. `quote_charge_instances.charge_key` is the full
`recovery_charge` enum, which **already contains `project_setup`,
`rd_formulation` and `testing_micros`**, and no constraint ties a charge key to
an owner kind:

```
quote_charge_instances_owner_agrees  CHECK: owner_ref = '@quote' XOR owner_ref = owner_quote_leaf_id
quote_charge_instances_owner_quote_leaf_id_fkey  FK -> quote_leaves(id)   -- no kind restriction
```

**A `project_setup` charge owned by a standalone product is representable in the
production database today.** What refuses it is three application-level maps.

### Affected paths — the entire list

| # | Path | Change | Needs a business decision? |
|---:|---|---|:--:|
| 1 | `COMPONENT_CHARGE_KEYS` (`registry.ts`) | add the three keys | no |
| 2 | `COMPONENT_CHARGE_LABELS` | add three labels | no |
| 3 | `COMPONENT_CHARGE_MARKUP_AUTHORITY` | add three entries — **a markup category each** | **YES** |
| 4 | `COMPONENT_CHARGE_DESTINATION` (`component-charge-destination.ts`) | `project_setup → otc_setup`, `rd_formulation → otc_formulation`, `testing_micros → otc_testing` — all three destinations already exist in BV-011 | confirm only |
| 5 | The authoring surface | `add-component-charges-sheet` already takes a `quoteLeafId` and is kind-agnostic. It needs to be reachable from a standalone product's row | **Costs surface — paused** |
| 6 | `product_type_charge_defaults.charge_key` CHECK | **only if** these become suggestible in #596. Separate, optional, and the table is empty | separate |

**Path 3 is the real dependency.** `componentChargeMarkupAuthority` is total over
the key set; a key without an entry resolves `unclassified`, which recovers
nothing and cannot be sent. So each new key needs a governed markup category —
`Production` (0.40), `Manufacturing` (0.30) or another. **That is a pricing
disposition, not a code choice, and I am not making it.**

Everything else is additive, and nothing existing changes behaviour: the five
current keys keep their authorities, destinations and labels.

### What is explicitly NOT proposed

- **No change to `assembly_production_inputs` or its `0082` constraints.** §3
  argues those constraints are correct. This proposal does not route around
  them — it uses a different mechanism that was already built for this shape.
- **No new table, column, module or engine.**
- **No migration.** Path 6 is the only candidate and it is optional and separate.
- **No restructuring of any MISTR product.**
- **No seeded rule.**

### Where a constraint would genuinely need changing, if review disagrees

If review concludes a standalone product must carry the production *worksheet* —
policies, yield, allocation — rather than charges, then the honest change is to
`0082`: replace the constant `'service'` in the generated expression with a
written `owner_commercial_kind`, keep the composite FK (which is what actually
guarantees the declared kind matches the leaf), and add
`CHECK ((quote_leaf_id IS NULL) = (owner_commercial_kind IS NULL))` so a writer
that omits it cannot make the FK inert — the `0066` lesson, applied.

**That is a larger change with a weaker case, recorded so the option is visible
rather than quietly foreclosed.** It also imports per-assembly policy columns
onto products, which §3 argues against.

---

## 7 · NetSuite — separate release concern

**Not part of this design. Recorded here so it is tracked, and deliberately not
acted on. No remapping, no credential change.**

### The configured runtime account

| | |
|---|---|
| Accounts configured | **one** |
| Account id shape | `#######_SB1` — the `_SB` suffix is NetSuite's sandbox marker |
| `NETSUITE_ENV` | `sandbox` — an **advisory tag** over an id-shape inference, per `client.ts`; a guardrail against reaching production, not a record of provenance |
| Production credential | **none configured** |

No credential value appears here or anywhere in this repository's documentation.

### Resolution evidence

Ten rows in `netsuite_destination_item_map`, resolved 2026-08-18 → 2026-09-07.
The table records `destination`, `netsuite_item_code`, `netsuite_internal_id`,
`resolved_at`, `resolved_by_user_id`.

- **`resolved_by_user_id` is the Nexus operator, not the ERP account.** It says
  who clicked, not which account answered.
- **The table has no environment column.** Provenance is therefore *inferred*
  from there having only ever been one configured account — a strong inference,
  and not a recorded fact.

### Is production posting supported?

**No, for any destination — and this is a release concern, not a mapping
question.** Internal ids are account-scoped; posting writes
`netsuiteInternalId` rather than the portable item code; and nothing in the
schema could detect a cross-account reuse.

### Safeguards proposed — separately, not here

1. **An `environment` column on the mapping table, in its primary key**, so a
   row states which account it came from and two environments can coexist.
2. **A runtime assertion at the posting boundary** that the row's environment
   equals the connected account's, refusing rather than posting on mismatch.
3. **Re-resolve by item code at cutover**, never by copying internal ids.
4. **Record the ERP account id alongside `resolved_by_user_id`**, so provenance
   is a fact rather than an inference.

Each is additive and none is in #596.

---

## 8 · What review is asked to decide

1. **The ownership model (§3).** Is "the owner is the thing whose line the
   customer is buying" the right rule — and is expressing a standalone
   product's fees as **charge instances** rather than a production worksheet the
   right mechanism?
2. **The three markup authorities (§6, path 3).** Which governed category prices
   `project_setup`, `rd_formulation` and `testing_micros`? **This blocks the
   change and nothing else does.**
3. **Both structures (§4, §5).** Do they match how MISTR is actually contracted?
   The supplier quote decides which — Nexus should support both, and after this
   change it would.
4. **Suggestion usefulness (§1.1).** Confirm that #596's first rules come from
   what a reviewer can attest, not from the 12 observed instances, and that no
   applicability rate is quoted until someone counts.
5. **NetSuite safeguards (§7)** — as their own release item.

Until these are answered: **#596 stays held, unseeded and undeployed; this
extension is not implemented; no migration, restructuring or production change
is made; and CD's Costs redesign stays paused.**
