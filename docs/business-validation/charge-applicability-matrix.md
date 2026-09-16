# Product / service type → charge applicability matrix

**2026-09-16 · for business review. Nothing here is implemented, seeded, or
approved. No production migration, deployment or classification change.**

This is the deliverable that blocks business review of the charge-defaults
Settings feature and CD's Costs redesign. It proposes, for **every** current
product type and supported service, which one-time charges Nexus should offer,
on what condition, who owns the decision, where the cost already lives, and what
NetSuite needs before the charge can post.

Every proposal is **marked** — grounded in live data, inferred, or undecided.
The inferred ones are the ones review exists to correct.

**Sources, all read read-only on 2026-09-16:** HubSpot production
`hs_product_type` (18 options); the Nexus catalogue (1,113 leaves); the 45
existing `quote_charge_instances`; `netsuite_destination_item_map`;
`src/lib/commercial-recovery/registry.ts`;
`src/lib/netsuite/component-charge-destination.ts`; BV-011.

---

## 1 · The boundary that shapes everything below

Settings can only suggest **component-owned** charges — charges an operator adds
against a *packaging component*. That is five identities, and no more:

`print_plates` · `tooling` · `artwork_plate` · `samples` · `other_service`

A second family of one-time fees exists and is **quote- or assembly-owned**:
project setup, R&D / formulation, testing / micros, and the legacy combined
tooling-and-artwork column. Those are authored on the Item Group's Production
inputs, not against a component, and **this feature cannot suggest any of
them.** That is a structural limit, not an omission — and §6 shows it is the
single most consequential fact in this document, because the charges the
formulated types actually attract all live on the wrong side of it.

| | Component-owned (Settings can suggest) | Quote / assembly-owned (it cannot) |
|---|---|---|
| Authored on | a packaging component | the Item Group's Production inputs |
| Cost stored in | `quote_charge_instance_tiers.cost_amount` | `assembly_production_inputs.*_total` |
| Can two exist per quote? | Yes — two cartons each cause plates | No — one column, one value |
| In scope here | **Yes** | **No — marked UNSUPPORTED throughout** |

---

## 2 · The five suggestible charges

| Charge | Label | BV-011 destination | NetSuite item | Mapped? | Notes |
|---|---|---|---|---|---|
| `print_plates` | Print plates | `otc_print_plates` | OTC-0004 (4078) | **Yes** | Prices as tooling (a plate is commercially a tool), posts as its own item. The two axes are independent. |
| `tooling` + `mould_collar` | Tooling & dies | `otc_mould` | OTC-0006 (4076) | **Yes** | |
| `tooling` + `cutting_die` | Tooling & dies | `otc_dies` | OTC-0002 (4081) | **Yes** | |
| `tooling` *unclassified* | — | **refuses** | — | n/a | Not a defect. Mould vs die are different accounts; the operator records which, per instance. **One live instance is unclassified today** (§5). |
| `artwork_plate` | Artwork & prepress | `otc_artwork` | OTC-0001 (11012) | **Yes** | On a NEW component charge this means the adaptation-labour half only; plate-making has its own type. |
| `samples` | Samples & PPS | `otc_samples` | — | **NO** | **Suggestible, acceptable, and not postable.** A quote carrying a separately-billed sample charge cannot complete until this is mapped. |
| `other_service` | Other | `otc_other_service` | — | **NO** | Same. Also has **no governed markup rate** by decision — an unclassified charge recovers nothing and cannot be sent (BV-013). |

**Every internal id above is a SANDBOX record** (`NETSUITE_ENV=sandbox`).
Resolving the same destinations against production NetSuite is separate work and
is not done. Read "Mapped" as "mapped in the environment Nexus currently talks
to", never as production readiness.

**Applicability is not posting readiness.** A charge can be correctly suggested,
correctly accepted, and still not post. `samples` and `other_service` are in
that state right now.

---

## 3 · The matrix — all 18 product types

Production `hs_product_type`, in the portal's display order. **Value** is what a
rule is keyed by; three diverge from their label and a label-keyed rule would
miss roughly half the catalogue.

Legend — **●** preselected (ticked by default) · **○** offered, unticked ·
**—** not suggested · **?** undecided, needs review to settle.

| # | Label (value) | Leaves | Spec schema | plates | tooling | artwork | samples | other | Disposition |
|---:|---|---:|---|:--:|:--:|:--:|:--:|:--:|---|
| 0 | Cards, Booklets | 51 | secondary | ● | ○ | ● | ○ | — | **Propose** |
| 1 | Design | 9 | no_schema | — | — | — | — | — | **None expected** |
| 2 | Filling and Packout Services | 110 | no_schema | — | — | — | — | — | **Not a component type** |
| 3 | Formulation | 1 | no_schema | — | — | — | — | — | **Not a component type** |
| 4 | Freight | 11 | no_schema | — | — | — | — | — | **None expected** |
| 5 | Labels | 118 | secondary | ● | ○ | ● | ○ | — | **Propose — best evidenced** |
| 6 | Logistics (`Third Party Logistics`) | 4 | no_schema | — | — | — | — | — | **None expected** |
| 7 | One Time Charges | 61 | no_schema | — | — | — | — | — | **Needs review — see §7** |
| 8 | Primary Packaging (`Primary`) | 178 | primary | ○ | ○ | ○ | ○ | — | **Propose, all unticked** |
| 9 | R&D / Testing | 6 | no_schema | — | — | — | — | — | **Not a component type** |
| 10 | Raw ingredients | 52 | schema_pending | — | — | — | ? | — | **Needs review** |
| 11 | Secondary Packaging (`Secondary`) | 348 | secondary | ○ | ○ | ○ | ○ | — | **Propose, all unticked** |
| 12 | Soft Goods and Accessories | 95 | no_schema | ○ | ○ | ○ | ○ | — | **Propose, all unticked** |
| 13 | Finished Goods | 4 | no_schema | — | — | — | — | — | **Not a component type** |
| 14 | Turnkey | 8 | no_schema | — | — | — | — | — | **Not a component type** |
| 15 | Tertiary Packaging | 3 | tertiary | ○ | ○ | — | — | — | **Propose, all unticked** |
| 16 | **Ingestibles** | **0** | formulated | — | — | — | ? | — | **Needs review — §6** |
| 17 | **Topicals** | **0** | formulated | — | — | — | ? | — | **Needs review — §6** |

`other_service` is **not suggested for any type**, deliberately: it has no
governed markup rate, so a suggested `other_service` is an offer that cannot be
priced or sent. Offering it would be inviting an operator into a dead end.

### Why each disposition

**Propose (6 types).** Real packaging components, with a spec schema, that
plausibly cause component-owned charges. Preselection is proposed **unticked**
everywhere except Labels and Cards/Booklets — see §4.

**None expected (3 types).** Design, Freight, Logistics. These name a service or
a landed cost, not a component that can carry tooling or plates. Freight and
duty are recovered as *landed* charges at quote level and are not one-time fees
at all. A reviewer records the verdict; the surface then says "reviewed, none
expected" rather than "nobody looked".

**Not a component type (5 types).** Filling and Packout Services, Formulation,
R&D / Testing, Finished Goods, Turnkey. Products carrying these are the
*finished good* or the *service*, not a component of one. Settings would attach
a rule that never fires, because the authoring surface offers defaults when a
**component** is added.

> **This is the most important finding in the table, and it is not obvious from
> it.** These five cover **129 catalogued leaves**, including every MISTR gummy
> and every MISTR lubricant (§5). The charges those products genuinely attract —
> R&D, testing, setup — are **quote/assembly-owned and unsuggestible**. A
> per-type default against `Turnkey` would be inert.

**Needs review (4 types).** One Time Charges, Raw ingredients, Ingestibles,
Topicals. Each has a specific unresolved question, in §6 and §7.

---

## 4 · Preselection — the proposal, and what makes it safe

Preselection is a **starting position for a checkbox**, never an assertion that a
charge applies. The proposal is deliberately conservative:

| Preselect (●) only where | Proposed for |
|---|---|
| the charge applies to a **large majority** of that type's components, AND declining it is a one-click, no-consequence act | `Labels` → plates + artwork; `Cards, Booklets` → plates + artwork |
| everything else | offered unticked (○) |

**Why Labels and Cards/Booklets and nothing else.** A label or a booklet is a
printed component essentially by definition — an unprinted label is not a label.
Every observed component charge on `Labels` in live data is `print_plates` or
`artwork_plate` (§5), with no counter-example. Nothing else in the catalogue has
that property: a `Primary` component is a stock bottle as often as a custom one,
and a `Secondary` is as often a plain shipper as a printed carton.

**The asymmetry that makes ● the riskier default.** An unticked suggestion an
operator *should* have ticked costs a conversation and a revision. A ticked
suggestion an operator *doesn't* notice becomes a charge on a customer document.
Those are not equal errors, so preselection is the exception and not the rule.

**Undecided:** whether a preselected charge should be visually distinguished
from one the operator ticked themselves, on the authoring surface. Not settled
here; it belongs with CD's Costs work when that resumes.

---

## 5 · What the live data actually shows

**45 charge instances exist. 12 are component-owned**, and this is every one of
them, by the product type of the component that owns it:

| Type of the owning component | Charges observed |
|---|---|
| `Labels` | `artwork_plate` ×2, `print_plates` ×2 |
| `Primary` | `tooling` ×1 (**mould / collar**) |
| `Secondary` | `print_plates` ×2, `samples` ×2, `artwork_plate` ×1, `tooling` ×2 (**one cutting die, one unclassified**) |

The other 33 are quote/assembly-owned: `project_setup` ×16, `rd_formulation` ×5,
`tooling` ×4, `tooling_artwork_legacy` ×3, `other_service` ×3, `artwork_plate`
×2 — none of which this feature can suggest.

Three things follow.

1. **The evidence is thin and it is the whole evidence.** Twelve instances across
   three types. It supports the *shape* of the proposal; it cannot establish
   frequency, which is what preselection turns on. Review supplies that, or the
   ● column stays empty.
2. **`tooling` is observed BOTH ways in the same type.** A `Secondary` component
   caused a cutting die; a `Primary` component caused a mould. This is the
   concrete case for why `tooling` carries a per-instance classification and why
   a default must never supply one.
3. **One live `tooling` instance carries no classification at all.** That charge
   cannot resolve a NetSuite destination and would refuse at projection. It is a
   real, present, operator-fixable state — worth raising with whoever owns that
   quote, and **outside this PR**.

### Nothing is classified `Ingestibles` or `Topicals`

Zero leaves, by design — the release that created the options deliberately
reclassified nothing. So **no rule written against either type can fire today**,
and any preselection proposed for them would be untested against a single real
product. §6.

---

## 6 · Worked examples

### 6.1 · MISTR gummies — `DPS-MISTR-1007…1011`

Five real catalogue products: Multi, Perform, Prepare, Probiotic, Recover Gummy.

| | |
|---|---|
| **Classified today** | `Turnkey` — **not** `Ingestibles` |
| **Spec schema** | `no_schema` (Turnkey); would be `formulated` under Ingestibles |
| **What it is** | The finished good DPS sells, not a component of one |
| **Charges it genuinely attracts** | R&D / formulation, testing / micros, project setup — **all quote/assembly-owned** |
| **Suggested by this feature** | **NONE. Structurally cannot be.** |
| **Existing cost fields** | `assembly_production_inputs.rd_total`, `.testing_micros_total`, `.setup_fee_total`, `.bulk_raw_cost` |
| **NetSuite** | `otc_formulation` → OTC-0050 ✓ · `otc_setup` → OTC-0024 ✓ · `otc_testing` **unmapped** |
| **Ownership (proposed)** | R&D charge: **Product / R&D**. Setup: **PM**. Testing: **Quality** |
| **Verdict** | **UNSUPPORTED by charge defaults.** A `Turnkey` rule would be inert; an `Ingestibles` rule would fire only after reclassification, which is not proposed |

**What this example is for.** It is the clearest case that the Settings feature
and the firm's actual one-time-charge practice **do not yet meet**. Reviewing
charge defaults for gummies is reviewing a surface that cannot carry the answer.

### 6.2 · MISTR lubricants — `MISTRLBSTKS-SB-1/-2`, `-WB-1/-2`

Four real products: Lubricant-1 at 2oz and 4oz, Lubricant-2 at 2oz and 4oz.

| | |
|---|---|
| **Classified today** | `Filling and Packout Services` — **not** `Topicals` |
| **Spec schema** | `no_schema` |
| **What it is** | The classification names the **service**, not the material. A component of the finished good is the sachet or bottle it fills |
| **Suggested by this feature** | **NONE.** Not a component type |
| **Existing cost fields** | `assembly_production_inputs.filling_blending_cost`, `.cm_assembly_total` — **recurring** economics, not one-time fees |
| **NetSuite** | `otc_filling` → BLD-FILL ✓ · `otc_packout` → OTC-0049 ✓ |
| **Ownership (proposed)** | **Purchasing / Operations** — it is a contract-manufacturing rate |
| **Verdict** | **UNSUPPORTED, and correctly so.** These costs are per-unit, not one-time. Nothing about them belongs in charge defaults |

**And a question this raises that the matrix cannot answer.** Whether a product
whose type names a *service* should carry that type at all is a classification
question, not a charge question. It is **out of scope here** and should not be
resolved as a side effect of a charge-defaults review.

### 6.3 · A contracted bag

A bag made to the customer's design — the cutting die and artwork are DPS's to
procure.

| | |
|---|---|
| **Classified today** | `Soft Goods and Accessories` — 28 of 39 name-matched bags; the rest sit under `Secondary` (6), `Raw ingredients` (4) and `Labels` (1) |
| **Spec schema** | `no_schema` for Soft Goods; `secondary` if classified there |
| **Suggested** | `tooling` ○ · `artwork_plate` ○ · `print_plates` ○ · `samples` ○ — **all unticked** |
| **Applicability condition** | **Contracted / made-to-design, not stock.** A stock poly bag attracts none of these, and the type does not distinguish the two |
| **Tooling classification** | **`cutting_die`** — operator-recorded per instance, never defaulted |
| **Ownership (proposed)** | **Purchasing** — they hold the supplier quote the die charge comes from |
| **Existing cost fields** | Component unit cost: `assembly_leaf_inputs.unit_cost`. Charge cost: `quote_charge_instance_tiers.cost_amount` |
| **NetSuite** | `otc_dies` → OTC-0002 ✓ · `otc_artwork` → OTC-0001 ✓ · `otc_print_plates` → OTC-0004 ✓ · `otc_samples` **unmapped** |
| **Verdict** | **Supported. Propose all four, none preselected** |

**The split this example exposes.** Bags are catalogued across **two** types, so
one rule cannot reach all of them, and neither type means "contracted". This is
OQ4 in its most concrete form (§8).

### 6.4 · A stock bottle

An off-the-shelf bottle bought from a supplier's catalogue.

| | |
|---|---|
| **Classified today** | `Primary` — 59 of 85 name-matched bottles, custom and stock **indistinguishably** |
| **Spec schema** | `primary` |
| **Suggested** | `tooling` ○ · `samples` ○ — both unticked. **No plates, no artwork** |
| **Applicability condition** | **Tooling applies only to a CUSTOM bottle** (its own mould). A stock bottle has none, and this is the majority case |
| **Tooling classification** | **`mould_collar`** — per instance. The one live `Primary` tooling instance is exactly this |
| **Ownership (proposed)** | **Purchasing** |
| **Existing cost fields** | As above |
| **NetSuite** | `otc_mould` → OTC-0006 ✓ · `otc_samples` **unmapped** |
| **Verdict** | **Supported, and the strongest argument against preselection anywhere on `Primary`.** Ticking tooling by default would attach a mould charge to every stock bottle |

### 6.5 · A printed carton

A folding carton printed to the customer's artwork.

| | |
|---|---|
| **Classified today** | `Secondary` — 16 catalogued cartons among **348** `Secondary` leaves, which also holds plain shippers, rigid boxes, sleeves and PR boxes |
| **Spec schema** | `secondary` |
| **Suggested** | `print_plates` ○ · `artwork_plate` ○ · `tooling` ○ · `samples` ○ |
| **Applicability condition** | **Printed, not plain.** Plates and artwork apply to a printed carton and to nothing unprinted; a cutting die applies to any die-cut carton, printed or not |
| **Tooling classification** | **`cutting_die`** |
| **Ownership (proposed)** | Plates + die: **Purchasing**. Artwork: **Design** |
| **Existing cost fields** | As above |
| **NetSuite** | All three ✓ (sandbox) · `otc_samples` **unmapped** |
| **Verdict** | **Supported. All unticked** — `Secondary` is the most heterogeneous type in the catalogue and preselection there would be wrong more often than right |

---

## 7 · Types that need a decision before any rule

| Type | The question | Why the matrix cannot answer it |
|---|---|---|
| **One Time Charges** (61 leaves) | Is this a *product type* at all, or a catalogue convention for billing a fee as a line item? | If the latter, a component classified here **is** a charge, and suggesting charges against it is circular. 61 leaves is too many to treat as an edge case |
| **Raw ingredients** (52 leaves) | Does bulk raw attract component-owned charges, or only assembly-owned R&D and testing? | It is `schema_pending` — the firm has said specifications are owed here and not supplied them. Charges are the same shape of unfinished |
| **Ingestibles** (0 leaves) | What does a gummy's component charge look like, given no gummy is classified here? | Nothing to observe. §6.1 |
| **Topicals** (0 leaves) | Same | Same |

---

## 8 · What this settles — OQ3 and OQ4

### OQ4 · Does a rule belong to a product type, or to a type-and-something?

**Answer, from the examples: a product type alone is NOT sufficient, and the
evidence is in the catalogue rather than in principle.**

| Example | Same type, opposite charges |
|---|---|
| **Stock vs custom bottle** (§6.4) | Both `Primary`. One has a mould, one has nothing |
| **Printed vs plain carton** (§6.5) | Both `Secondary`. One has plates and artwork, one has neither |
| **Contracted vs stock bag** (§6.3) | Both `Soft Goods` — and contracted bags also appear under `Secondary` |

**Recommendation: keep the key as product type alone, and do not expand the
schema.** Not because type is sufficient — it is not — but because:

- The discriminator is **"custom / contracted vs stock"**, which Nexus does not
  record anywhere today. Adding a second key would require inventing the field
  it keys on, which is a product-data decision far larger than charge defaults.
- With **no charge preselected** on the ambiguous types, over-inclusiveness
  costs an operator one glance. That is the correct price for a suggestion.
- Preselection is proposed **only** where the type is genuinely homogeneous
  (Labels, Cards/Booklets), so the one place a wrong default would cost
  something is the one place the ambiguity does not exist.

**So OQ4 unblocks the first rule, on the condition that the ● column stays as
proposed.** If review wants preselection on `Primary` or `Secondary`, OQ4 is
re-opened and a second key becomes necessary — and that is a schema expansion
this document does not propose.

### OQ3 · Who maintains these?

**Answer: ownership is per charge family, not per product type** — which is why
asking "who owns charge defaults" produced no answer.

| Charge | Proposed owner | Because |
|---|---|---|
| `tooling` (die or mould) | **Purchasing** | They hold the supplier quote it comes from |
| `print_plates` | **Purchasing** | Procured with the print run |
| `artwork_plate` | **Design** | It is adaptation labour |
| `samples` / PPS | **Purchasing**, with Quality consulted | |
| Any **verdict** (`none expected`) | **PM lead** | It is a commercial statement about a category |

**Recommendation:** name a single **accountable reviewer** — proposed: the PM
lead — who records every verdict, consulting the owners above. The schema
already forces this: `reviewed_by_user_id` and `reviewed_at` are NOT NULL, so
every verdict carries a name and a date whether or not anyone has been appointed.

**This does not block the feature. It blocks the first seeded rule**, which is
the moment the surface starts making claims on the firm's behalf.

---

## 9 · Explicitly unsupported or undecided

Stated plainly so nothing here reads as approved.

**UNSUPPORTED — cannot be expressed by this feature at all:**

- Every quote/assembly-owned one-time fee: **project setup, R&D / formulation,
  testing / micros, tooling-and-artwork (legacy)**. Not suggestible. This is
  where the MISTR examples land.
- Any charge against **Filling and Packout Services, Formulation, R&D /
  Testing, Finished Goods, Turnkey** — not component types (129 leaves).
- **Tooling classification.** `tooling` may be suggested; whether it is a mould
  or a die is recorded per instance and must never be defaulted.
- **NetSuite item selection.** `other_service` and testing choose their item per
  line, frozen at send.
- **Absorbed recovery.** Policy permits it; `absorbedCost` is read by nothing,
  so it is refused downstream.

**NOT POSTABLE even if suggested and accepted:**

- `samples` → `otc_samples` — **unmapped**
- `other_service` → `otc_other_service` — **unmapped**, and no governed markup
  rate by decision
- **All ten mapped destinations are SANDBOX records.** Production NetSuite
  resolution is not done and is not in this PR.

**UNDECIDED — needs this review:**

- The four types in §7 (One Time Charges, Raw ingredients, Ingestibles,
  Topicals) — **113 leaves and two brand-new types**
- Whether preselection should be visually distinguished at authoring time
- Frequency data behind every ● and ○ — twelve live instances is a shape, not a
  rate
- Whether `Raw ingredients`' `schema_pending` status should also gate charges
- Whether a product classified by a **service** (`Filling and Packout Services`)
  should carry that type at all — a classification question, raised and
  **deliberately not answered here**

**OUT OF SCOPE, raised for someone else:**

- One live `tooling` charge instance carries **no classification** and would
  refuse at projection (§5)
- The sandbox HubSpot portal offers `Corrugated` and `Preliminary`, which have
  no mapping disposition; 6 leaves carry `Preliminary`. Separately tracked
- 48 catalogued leaves carry **no product type at all**, so no rule can reach
  them

---

## 10 · What review is being asked for

1. **Confirm or correct the disposition of each of the 18 types** in §3 —
   particularly the five marked "not a component type", which silently covers
   every MISTR product.
2. **Confirm the preselection proposal** in §4: ● on Labels and Cards/Booklets
   only, ○ everywhere else. Adding ● elsewhere re-opens OQ4.
3. **Settle the four undecided types** in §7.
4. **Name the accountable reviewer** (OQ3).
5. **Decide whether charge defaults should be seeded at all before the
   quote/assembly-owned family is reachable** — §6.1 is the argument that the
   answer may be no, and it is better said now than after rules exist.

Until 1–5 are answered: no rule is seeded, no schema is expanded, and CD's Costs
redesign stays paused.
