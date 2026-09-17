# Setup → Costs charge coverage · decision table

**2026-09-16 · for business review. #596 stays held, unseeded, undeployed. No
production change, no CD work.**

Companion to, and in four places a **correction of**,
[`charge-applicability-matrix.md`](charge-applicability-matrix.md).

> **This document is itself corrected in three places** by
> [`standalone-product-cost-ownership.md`](standalone-product-cost-ownership.md),
> which is the later read: §2's "Direct Product or Item Group?" framing, §5's
> coverage recommendation, and §6's claim that over-inclusiveness is free. Each
> is flagged inline.

| | The matrix said | Established here |
|---|---|---|
| **MISTR lubricants** | four `MISTRLBSTKS-*` under `Filling and Packout Services` | **Wrong set.** Those four are unattached catalogue rows from August. The lubricants *in play* are four `DPS-MISTR-*` under `Raw ingredients` — §1 |
| **"Not a component type"** | a rule against `Turnkey` "would be inert" | **Overstated.** The data model lets a Direct Product own a component charge. What it cannot own is production economics — §2 |
| **NetSuite "Mapped ✓"** | flagged as sandbox | **Sharper:** the table records no environment at all, and no production credential exists — §3 |
| **OQ4 / second key** | argued from stock-vs-custom ambiguity | **Wrong basis.** The trigger is a *behaviour* — §6. (§6's own replacement claim, that over-inclusiveness is therefore "free", is in turn retracted — see `standalone-product-cost-ownership.md` §1.1) |

---

## 1 · MISTR, reconciled by exact identifier

Two distinct sets exist. **Neither is a duplicate of the other**, and the
earlier report and the matrix were each describing a different one.

### Set A — `Filling and Packout Services`, created 2026-08-14, **attached to nothing**

| SKU | Leaf id | HubSpot id | Name | Unit cost |
|---|---|---|---|---:|
| `MISTRLBSTKS-SB-1` | `978aefe6-ca5c-485c-af2d-2582711401aa` | 46792159376 | MISTR Lubricant-1/2oz | 2.85 |
| `MISTRLBSTKS-SB-2` | `634c442c-7f9a-4e45-bb1a-85afd80aed4d` | 46791601826 | MISTR Lubricant-1/ 4oz | 4.50 |
| `MISTRLBSTKS-WB-1` | `929b457a-d2e0-4828-b529-2d54bfdd2586` | 46792159380 | MISTR Lubricant-2/2oz | 1.68 |
| `MISTRLBSTKS-WB-2` | `ab1e81bd-328a-49d2-8d47-c554d9edd4a3` | 46791539973 | MISTR Lubricant-2/4oz | 2.07 |

Zero quotes, zero assemblies. **This is the set the matrix used, and it should
not have.** An unattached row cannot demonstrate how a charge behaves.

### Set B — `Raw ingredients`, created 2026-09-11 / 09-15, **four of six attached**

| SKU | Leaf id | HubSpot id | Name | On a quote? |
|---|---|---|---|---|
| `DPS-MISTR-1002` | `f0197a9b-e96e-4380-9ced-c1cdfcc04ab2` | 47895651974 | MISTR - 2oz lube | no |
| `DPS-MISTR-1003` | `0767c74b-7fad-4954-82a2-afb32083ef47` | 47881131415 | MISTR - 2oz Lube Silicone | **yes** |
| `DPS-MISTR-1004` | `0ae764d0-313e-4b35-ab50-ae53298b6791` | 47900606832 | MISTR - 2oz Lube Water | **yes** |
| `DPS-MISTR-1005` | `b1e5a588-dcd1-4e79-8fcf-706305150021` | 47900451999 | MISTR - 4oz Lube Silicone | **yes** |
| `DPS-MISTR-1006` | `d1c8f072-6913-4900-b4bf-f4f3d260de2e` | 47881131426 | MISTR - 4oz Lube Silicone | no |
| `DPS-MISTR-1012` | `65715dcc-3337-4438-893f-e23824a145ee` | 47955445127 | MISTR - 4oz Lube Water | **yes** |

**This is the set the earlier report meant, and it is the correct one.** The
four attached rows are exactly the four variants: 2oz silicone, 2oz water, 4oz
silicone, 4oz water.

**Two rows need a human decision, and I am not making it:**

- `DPS-MISTR-1005` and `DPS-MISTR-1006` carry the **same name**, different SKUs
  and different HubSpot ids. **Probable duplicate.** 1005 is on the quote; 1006
  is not. Whether 1006 should be archived is a catalogue decision for whoever
  created them.
- `DPS-MISTR-1002` "MISTR - 2oz lube" is unqualified — neither silicone nor
  water — while 1003 and 1004 are the qualified 2oz variants. Likely superseded.

### The gummies — `Turnkey`, created 2026-09-11, all five attached

| SKU | Leaf id | HubSpot id | Name |
|---|---|---|---|
| `DPS-MISTR-1007` | `42a50423-20cc-4528-a5ce-2a17b04acadb` | 47890196399 | MISTR - Multi Gummy |
| `DPS-MISTR-1008` | `e5a48954-adfb-41c2-8349-ef2419a7b836` | 47906064164 | MISTR - Perform Gummy |
| `DPS-MISTR-1009` | `33f83bff-d52f-47a5-a39d-12d32d065c9f` | 47883499301 | MISTR - Prepare Gummy |
| `DPS-MISTR-1010` | `df444b2f-aab4-4512-870a-832d0b115a95` | 47878808929 | MISTR - Probiotic Gummy |
| `DPS-MISTR-1011` | `60df597a-f860-4acb-bf82-6c7792a0352c` | 47894996385 | MISTR - Recover Gummy |

### The one quote they are on

`MISTR - Supplement Capsules` · quote `0cc928ae-3018-4016-9931-ff08491d2d4d` ·
**draft** · scenario "Primary" · HubSpot deal 58029824165.

**Nine leaves, every one `commercial_kind = 'product'`. Zero assemblies. Zero
production-input rows.** That is the whole fact the design example rests on, and
it is different from what the matrix described.

**Verdict on scope: different products, not duplicates — plus one probable
duplicate *within* Set B.** Set A is older, unattached, and names the service.
Set B is newer, attached as Direct Products, and names the material. The
worked example should use **Set B**, and the matrix's §6.2 should be read as
superseded.

---

## 2 · What a Direct Product can and cannot carry

The matrix said a rule against `Turnkey` "would be inert". That was overstated,
and the correction matters because it changes which gap is real.

| | Direct Product (the MISTR case) |
|---|---|
| **Own a component charge** (`tooling`, `print_plates`, …) | **Permitted by the model.** `quote_charge_instances.owner_quote_leaf_id` references `quote_leaves` with no restriction to assembly members, and `ensureChargeInstance` accepts any leaf id as `ownerRef` |
| **Be offered one by the authoring surface** | **Unknown — a Costs-surface question, and CD work is paused.** Not asserted either way here |
| **Carry setup / R&D / testing / filling** | **Structurally impossible.** `assembly_production_inputs.owner_commercial_kind` is a GENERATED column that evaluates to `'service'` whenever `quote_leaf_id` is set, and a composite FK binds it to service-classified leaves. A Direct Product's leaf carries `commercial_kind = 'product'` and therefore **has no referent** |

So the real gap is narrower and harder than the matrix claimed: not "charges
cannot attach", but **"the setup / R&D / testing family cannot attach to a
standalone product at all."** Zero rows in the live data have
`owner_commercial_kind = 'product'`, and none can.

**That is a design constraint, not an oversight** — a Direct Product is bought
complete, so its production *worksheet* is the supplier's.

> **⚠ SUPERSEDED.** This section went on to ask whether MISTR gummies "are
> Direct Products or Item Groups", framed as the answer that closes the gap.
> **That framing is retracted**: structure follows the contract and the supplier
> quote, never which fields a shape unlocks. A standalone product must be able
> to carry its own costs without becoming a group, and
> [`standalone-product-cost-ownership.md`](standalone-product-cost-ownership.md)
> shows both MISTR structures working and proposes the change that makes the
> standalone one complete — three map entries, no migration, no group.

---

## 3 · NetSuite mapping evidence

### What the stored mappings actually are

Ten rows in `netsuite_destination_item_map`. Its columns are `destination`,
`netsuite_item_code`, `netsuite_internal_id`, `resolved_at`,
`resolved_by_user_id`, `updated_at`.

**There is no environment column.** The table cannot say which NetSuite account
any row came from, and nothing prevents one set of ids being used against
another account.

| Destination | Item code | Internal id | Resolved | Resolved by (Nexus user) |
|---|---|---:|---|---|
| `otc_filling` | BLD-FILL | 14525 | 2026-08-18 | edward.shin@gmail.com |
| `otc_setup` | OTC-0024 | 26348 | 2026-08-19 | edward.shin@gmail.com |
| `otc_formulation` | OTC-0050 | 59157 | 2026-08-19 | edward.shin@gmail.com |
| `otc_artwork` | OTC-0001 | 11012 | 2026-08-19 | edward.shin@gmail.com |
| `otc_tooling` | OTC-0005 | 4077 | 2026-08-19 | edward.shin@gmail.com |
| `otc_packout` | OTC-0049 | 76154 | 2026-08-21 | edward.shin@gmail.com |
| `item_group_production` | IGP-0001 | 76160 | 2026-08-31 | edward@thedps.co |
| `otc_print_plates` | OTC-0004 | 4078 | 2026-09-07 | edward@thedps.co |
| `otc_mould` | OTC-0006 | 4076 | 2026-09-07 | edward@thedps.co |
| `otc_dies` | OTC-0002 | 4081 | 2026-09-07 | edward@thedps.co |

**`resolved_by_user_id` is the NEXUS operator, not the NetSuite account.** It
answers "who clicked", not "which ERP answered". Nothing in the row records the
second, which is the one that matters.

### Which environment supplied them

Not recorded — **inferred**, and the inference should be read as exactly that:

- The only NetSuite credential configured is one account whose id has the shape
  `#######_SB1`. **`_SB1` is NetSuite's sandbox suffix.**
- `NETSUITE_ENV=sandbox`, and `src/lib/netsuite/client.ts` treats it as an
  *advisory tag* over an id-shape inference — it is a guardrail against
  accidentally reaching production, not a record of provenance.
- No production consumer key, token or account id exists in the configuration.

So: **all ten were almost certainly resolved against the sandbox, because no
other account has ever been configured.** That is a strong inference from a
single-credential environment. It is not a recorded fact, and the table gives no
way to make it one.

### Is production posting supported?

**No. Not for any destination.**

1. **NetSuite internal ids are account-scoped.** A sandbox internal id does not
   identify the same record in production — it identifies whatever record holds
   that id there, or nothing.
2. **Posting uses the internal id**, not the item code (`item-groups.ts` writes
   `netsuiteInternalId` onto the Sales Order line). Pointing Nexus at production
   with this table unchanged would send sandbox ids to a production account.
3. **The table has no environment column**, so there is no mechanism by which
   the wrong-environment case could even be detected, let alone refused.
4. **No production credential exists**, so nothing has ever been resolved or
   verified there.

**Read every "mapped" in the matrix as "resolved in sandbox". None of it is
production evidence, and it must not be reused as any.**

**The portable half.** The *item code* (`OTC-0004`) is a business identifier and
plausibly the same in both accounts; the *internal id* is not. A production
cutover would re-resolve every destination **by code** against production
credentials and store the production internal id. That is the shape of the work,
and it is not done.

**Recommended, not built:** an `environment` column on the mapping table, in its
primary key, so a row states which account it came from and a production cutover
cannot silently inherit sandbox ids. Additive, and outside #596.

---

## 4 · The consolidated coverage table

The whole Setup → Costs workflow, by **cost owner**. `#596?` is whether the
charge-defaults feature can suggest it. Environment status per §3.

### 4.1 · Component-owned

The component is a member of an Item Group, or a Direct Product (§2).

| Product example | Charge / cost | Cost owner | Team | Existing Nexus field | #596? | NetSuite destination · status |
|---|---|---|---|---|:--:|---|
| Printed carton (`Secondary`) | Print plates | component | Purchasing | `quote_charge_instance_tiers.cost_amount` | **Yes** | `otc_print_plates` → OTC-0004 · **sandbox only** |
| Printed carton | Artwork & prepress | component | Design | same | **Yes** | `otc_artwork` → OTC-0001 · **sandbox only** |
| Printed carton / contracted bag | Tooling — **cutting die** | component | Purchasing | same + `quote_charge_instances.tooling_classification` | **Yes**, type only — **never the classification** | `otc_dies` → OTC-0002 · **sandbox only** |
| Custom bottle (`Primary`) | Tooling — **mould / collar** | component | Purchasing | same | **Yes**, type only | `otc_mould` → OTC-0006 · **sandbox only** |
| Any component | Samples & PPS | component | Purchasing (Quality consulted) | `quote_charge_instance_tiers.cost_amount` | **Yes** | `otc_samples` · **UNMAPPED — cannot post** |
| Any component | Other service | component | PM | same | **No — withheld**: no governed markup rate, so it cannot be priced or sent | `otc_other_service` · **UNMAPPED** |
| Stock bottle (`Primary`) | Purchase unit cost | component | Purchasing | `assembly_leaf_inputs.unit_cost` | n/a — recurring, not a charge | folded into the Item Group member rate |

### 4.2 · Standalone product / service — the MISTR case

| Product example | Charge / cost | Cost owner | Team | Existing Nexus field | #596? | NetSuite destination · status |
|---|---|---|---|---|:--:|---|
| MISTR gummy `DPS-MISTR-1007` (`Turnkey`, Direct Product) | Component charges | component, on a Direct Product | Purchasing | `quote_charge_instance_tiers.cost_amount` | **Model permits it.** Whether the surface offers it is a paused Costs question | per charge, as §4.1 |
| MISTR gummy | **Project setup** | would be item group | PM | **NONE — structurally impossible on a Direct Product** (§2) | **No** | `otc_setup` → OTC-0024 · sandbox only |
| MISTR gummy | **R&D / formulation** | would be item group | Product / R&D | **NONE** | **No** | `otc_formulation` → OTC-0050 · sandbox only |
| MISTR gummy | **Testing / micros** | would be item group | Quality | **NONE** | **No** | `otc_testing` · **UNMAPPED** |
| MISTR lubricant `DPS-MISTR-1003` (`Raw ingredients`, Direct Product) | Purchase unit cost | standalone product | Purchasing | `assembly_leaf_inputs.unit_cost` | n/a — recurring | line rate |
| A Direct **Service** — Formulation | R&D | standalone service | Product / R&D | `assembly_production_inputs.rd_total`, `owner_commercial_kind='service'` — **9 rows live** | **No** | `otc_formulation` → OTC-0050 · sandbox only |
| A Direct Service — Testing / Micros | Testing | standalone service | Quality | `.testing_micros_total` — **4 rows live** | **No** | `otc_testing` · **UNMAPPED** |
| A Direct Service — Filling / Blending | Filling | standalone service | Operations | `.filling_blending_cost` — **3 rows live** | n/a — recurring | `otc_filling` → BLD-FILL · sandbox only |
| A Direct Service — Pack-out / Assembly | Pack-out | standalone service | Operations | `.cm_assembly_total` — **4 rows live** | n/a — recurring | `otc_packout` → OTC-0049 · sandbox only |

### 4.3 · Item-group-owned — where the family already works

128 live rows, all assembly-owned.

| Product example | Charge / cost | Cost owner | Team | Existing Nexus field | #596? | NetSuite destination · status |
|---|---|---|---|---|:--:|---|
| A contract-manufactured kit | **Project setup** | item group | PM | `assembly_production_inputs.setup_fee_total` — **41 live** | **No** | `otc_setup` → OTC-0024 · sandbox only |
| Same | **R&D / formulation** | item group | Product / R&D | `.rd_total` — **22 live** | **No** | `otc_formulation` → OTC-0050 · sandbox only |
| Same | **Testing / micros** | item group | Quality | `.testing_micros_total` — 0 live on this owner | **No** | `otc_testing` · **UNMAPPED** |
| Same | Tooling | item group | Purchasing | `.tooling_total` — **16 live** | **No** | `otc_tooling` → OTC-0005 · sandbox, **and contested** (BV-011 records Inventory; the item is NonInvtPart) |
| Same | Artwork | item group | Design | `.artwork_total` — **15 live** | **No** | `otc_artwork` → OTC-0001 · sandbox only |
| Same | Other service | item group | PM | `.other_service_total` — **14 live** | **No** | `otc_other_service` · **UNMAPPED** |
| Same | Tooling & artwork **(legacy)** | item group | — | `.tooling_artwork_total` — **14 live** | **No** | **None.** One column spanning two destinations with different item types; non-elective |
| Same | Bulk raw | item group | Purchasing | `.bulk_raw_cost` — **23 live** | n/a — recurring | `otc_raws` · **UNMAPPED** |
| Same | Filling / pack-out | item group | Operations | `.filling_blending_cost` **54**, `.cm_assembly_total` **51** | n/a — recurring | `otc_filling`, `otc_packout` · sandbox only |
| Same | The group's own economics | item group | PM | derived | n/a | `item_group_production` → IGP-0001 · sandbox only |

### 4.4 · Quote-owned

| Product example | Charge / cost | Cost owner | Team | Existing Nexus field | #596? | NetSuite destination · status |
|---|---|---|---|---|:--:|---|
| Any quote with a shipment | Container freight | quote | Logistics | `freight_leg_tiers.total_freight` | **No** — landed, not a one-time fee | `otc_freight_duties_tariffs` · **UNMAPPED** |
| Same | Duty & tariffs | quote | Logistics | `freight_legs.customs` | **No** — statutory pass-through | `otc_customs` · **UNMAPPED** |
| Any quote | Recovery election per charge | quote | PM | `quote_charge_recovery` | **No** — a recovery decision, not applicability | n/a |

### 4.5 · What the table shows at a glance

- **#596 can suggest 5 of the ~20 distinct cost relationships above**, all
  component-owned. That is the feature working as designed, not a shortfall.
- **Two of those five cannot post** (`samples`, `other_service`).
- **Every "can post" is sandbox-only.** Nothing in this table is production
  evidence.
- **The setup / R&D / testing family is fully covered by existing fields for an
  Item Group** and **not covered at all for a standalone product**.

---

## 5 · Covering setup / R&D / testing — the smallest way

**Recommendation: two steps, in this order. Neither is built here, and neither
seeds a rule.**

> **⚠ SUPERSEDED by [`standalone-product-cost-ownership.md`](standalone-product-cost-ownership.md)
> §6.** Step 1 below waits on a structural question that should not have been
> asked. Step 2 widened the *defaults* CHECK, which suggests a fee without
> making one authorable on a standalone product. The smaller and correcter
> change is to widen the **component charge vocabulary** — three entries in each
> of three application maps, no migration at all, because
> `quote_charge_instances.charge_key` already accepts these keys and no
> constraint ties a key to an owner kind.

### Step 1 — nothing at all, until §2's question is answered

For an **Item Group**, the family already has governed fields and 63 live rows
using them. Nothing is missing. What is missing is a *prompt*, and a prompt is
worth less than an answer to "are MISTR gummies an Item Group or a Direct
Product?" — because if they are an Item Group, the coverage gap closes with no
code at all.

**The smallest way to cover the family is therefore to determine, for the
products that appear to need it, whether they are structured correctly.** That
is a business-review answer, not an engineering one, and it costs nothing.

### Step 2 — if a prompt is still wanted: widen the CHECK, do not build a module

The defaults table is already the right shape. Three changes, no new table, no
new module, no new vocabulary:

1. **Widen `product_type_charge_defaults.charge_key`** to admit
   `project_setup`, `rd_formulation`, `testing_micros`. All three already exist
   in the governed registry. The table is **empty**, so this is a pure additive
   CHECK replacement.
2. **Read the same resolver at the Item Group's Production panel**, keyed on the
   *group's* product type, instead of only at component-add.
3. **Force `preselected = false` for those three keys.** They are not rows an
   operator ticks — they are *columns* an operator fills. A suggestion here
   means "this type usually carries a setup fee", not "here is one". Preselecting
   a column has no meaning, and pretending it does would be the first place this
   design started lying.

**Explicitly NOT recommended now:**

- Any `owner_commercial_kind = 'product'` — letting a Direct Product carry
  production inputs. It contradicts a deliberate constraint, needs a BV
  disposition, and Step 1 may make it unnecessary.
- Seeding any rule for any key.
- Any change to the Costs surface.

---

## 6 · Suggestion versus decision — and what would actually require a second key

**The matrix argued the wrong thing.** It reasoned that because `Primary` holds
both stock and custom bottles, a per-type rule is over-inclusive, and treated
that as pressure toward a second key. **That reasoning does not hold, and the
correction is the important part of this document.**

| | A suggestion requiring confirmation | An automatic applicability decision |
|---|---|---|
| What the system does | offers a charge and waits | commits a charge |
| What a wrong entry costs | one glance, one click | a line on a customer document |
| Over-inclusiveness is | **free** | **a defect** |
| Needs a finer key? | **No** | **Yes** |

> **⚠ CORRECTED.** Two things in the paragraph that stood here were wrong, and
> both are retracted — see
> [`standalone-product-cost-ownership.md`](standalone-product-cost-ownership.md)
> §1.1.
>
> **"Over-inclusiveness is free" is false.** Confirmation reduces risk; it does
> not remove the cost. An irrelevant row is read and dismissed by every
> operator on every component, and a list that is usually wrong trains the
> skimming that makes confirmation hollow. The invariant below is necessary and
> **not sufficient on its own**.
>
> **"Right 60% of the time" was invented.** No applicability rate should be
> quoted until someone counts; twelve observed instances cannot support one.

The correct statement is narrower: a coarse key is **tolerable** where a person
must affirm each instance, and a **finer key is required** where one need not —
which is what the list below identifies. Tolerable is not free.

### The specific behaviours that would require a second key

A second key becomes necessary **exactly when a default can become a committed
fact without a human affirming it for that instance.** Concretely:

1. **A preselected charge that can be committed unseen.** If any path completes
   an add without the operator viewing the suggestion list — a bulk add, a
   keyboard fast-path, an "add all components" action — then ● *is* the
   decision. **This is the one to watch**, because it can arrive as a
   convenience feature long after the defaults are settled.
2. **Applying defaults on a non-interactive path.** Quote copy, scenario clone,
   template instantiation, import, API. Nobody confirms on those, so any default
   applied there is automatic by construction.
3. **A default carrying an amount.** The schema has none today. One would turn a
   suggestion into a price, and a wrong-by-type price is a commercial error, not
   a glance.
4. **Absence being enforced.** Warning or blocking because a component *lacks* a
   suggested charge inverts the relationship: the operator now argues with the
   default instead of choosing.
5. **Anything downstream reading the default rather than the authored charge.**
   Readiness, margin, or the NetSuite projection consulting the rule table would
   make the type-level guess load-bearing.

**Recommendation.** Keep the single key, and adopt the **confirmation
invariant** as necessary-but-not-sufficient — the complement is §1.1's rule that
a charge earns a place in a type's defaults only when a reviewer attests it
belongs there. Record the invariant in the authoring contract:

> A default may never become a charge without a person affirming it for that
> instance. Any path that would apply one otherwise must either be refused, or
> the key must first be made fine enough to be right without asking.

With that invariant in force, preselection is **not automatically unsafe** on
`Primary` or `Secondary` — but nor is it justified. It becomes a question of
whether the charge is useful there often enough to be worth every operator
reading it, which is the question §1.1 says must be answered by someone who
authors these quotes rather than inferred from the catalogue. **Not a
data-model constraint, and not a free choice either.**

---

## 7 · What review is asked to decide

1. **MISTR structure (§2).** Are the gummies and lubricants Direct Products, or
   should they be Item Groups? This single answer decides whether the
   setup/R&D/testing gap is real or imaginary.
2. **MISTR catalogue hygiene (§1).** Is `DPS-MISTR-1006` a duplicate of `1005`?
   Is `1002` superseded by `1003`/`1004`?
3. **The confirmation invariant (§6).** Adopt it as governing. If yes,
   preselection becomes a UX question and OQ4 closes without a schema change.
4. **Coverage of the setup family (§5).** Step 1 only for now, or authorise the
   CHECK widening in a later PR?
5. **NetSuite production (§3).** Confirm that no destination is production-ready
   and that a production cutover means re-resolving every mapping by item code
   against production credentials. Authorise the `environment` column separately.

Until 1–5 are answered: #596 stays held, unseeded and undeployed; no rule is
written; no schema is expanded; CD's Costs redesign stays paused.
