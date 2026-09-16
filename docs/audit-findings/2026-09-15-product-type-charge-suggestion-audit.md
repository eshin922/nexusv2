# Product classification audit — can Product Type suggest one-time charges?

**2026-09-15 · read-only · no production data, classification, mapping or schema was changed.**

Counts are live as at 2026-09-15: production HubSpot via the read-only token,
production Nexus via `DIRECT_URL`. Nothing in this audit writes, and no
classification was inferred from a name or SKU — names and SKUs appear only as
review flags, marked as such.

---

## 1 · The fields, and which way they flow

There is **one** leaf classification, and it is HubSpot's.

| | |
|---|---|
| **Field** | `leaves.hubspot_product_type` |
| **Source** | HubSpot `hs_product_type`, stored as the **raw internal option value**, never the display label |
| **Direction** | HubSpot → Nexus, on pull. Nexus does not author it. |
| **Derived behaviour** | Spec Schema, via `product-structure/spec-schema-mapping.ts`, pinned per quote at attachment |

Three options have a label that differs from the value, and they are three of
the four largest categories — `Primary Packaging` → `Primary`,
`Secondary Packaging` → `Secondary`, `Logistics` → `Third Party Logistics`. Any
rule written against labels would miss roughly half the catalogue.

**A second Nexus taxonomy used to sit beside this one and was removed** (Step 9).
`leaves.product_type_id` was operator-maintained and unset on ~1,051 of 1,077
products. That is the single most important precedent for this audit: *the last
attempt to carry classification in a Nexus-authored field decayed to 3%
coverage.* `product_type_id` survives only on `leaf_specs`, where it records
which schema a frozen spec was validated against — not what a product is.

`NULL` means two different things and they stay distinguishable: the product is
Nexus-local (no `hubspot_product_id`), or HubSpot itself has no classification.

---

## 2 · The review table

Every option in the live production vocabulary (16), plus the two states that
are not options. "Suggestible" answers Edward's question: *is this type specific
enough, on its own, to propose a charge?*

| Product Type (value) | HubSpot label | HS | Nexus | Spec schema | Suggestible | Proposed suggestion | Exceptions / unresolved |
|---|---|---:|---:|---|---|---|---|
| `Secondary` | Secondary Packaging | 350 | 348 | secondary | **Yes** | Cutting die · Print plates · Artwork & prepress · Samples & PPS | Unprinted corrugated needs neither plate nor artwork. **Printed vs unprinted is not carried.** |
| `Primary` | Primary Packaging | 189 | 178 | primary | **Yes** | Tooling (**mould/collar**) · Samples & PPS | **Stock vs custom is not carried** — a stock bottle has no tooling. Decorated primary also takes artwork/plates. |
| `Labels` | Labels | 117 | 118 | secondary | **Yes** | Print plates · Artwork & prepress · Cutting die · Samples & PPS | Digital printing needs no plates. **Print process is not carried.** |
| `Filling and Packout Services` | same | 111 | 110 | NO_SCHEMA | No | *(none — not a component)* | A service. Charges here are quote/assembly-level, not component-owned. |
| `Soft Goods and Accessories` | same | 95 | 95 | NO_SCHEMA | **Weak** | Samples & PPS only | Sewn bags and injection-moulded accessories both land here. Tooling applies to one and not the other; the type cannot say which. |
| `One Time Charges` | same | 62 | 61 | NO_SCHEMA | **No — inverted** | *(none)* | **These rows ARE charges modelled as catalogue products.** 25 are named “… Tooling”. Suggesting a charge on a charge is the wrong direction. |
| `Raw ingredients` | same | 52 | 52 | **SCHEMA_PENDING** | No | *(none)* | Bulk material. R&D/formulation and testing exist but are assembly-level, not component-owned. |
| `Cards, Booklets` | same | 51 | 51 | secondary | **Yes** | Print plates · Artwork & prepress · Cutting die · Samples & PPS | Shaped cards take a die; rectangular ones may not. |
| `Freight` | Freight | 11 | 11 | NO_SCHEMA | No | *(none)* | Quote-level landed charge, already governed separately. |
| `Design` | Design | 9 | 9 | NO_SCHEMA | No | *(none)* | A service. Overlaps “Artwork & prepress” as a charge — see §7. |
| `Turnkey` | Turnkey | 9 | 8 | NO_SCHEMA | **No — wrong axis** | *(none)* | **A sourcing arrangement, not an identity.** See §4. |
| `R&D / Testing` | same | 6 | 6 | NO_SCHEMA | No | *(none)* | Maps to the assembly-level `testing_micros`, which is **per-line** — see §6. |
| `Finished Goods` | same | 4 | 4 | NO_SCHEMA | No | *(none)* | A complete sellable good, not a component. |
| `Third Party Logistics` | Logistics | 4 | 4 | NO_SCHEMA | No | *(none)* | Label/value divergence — see §1. |
| `Tertiary Packaging` | same | 3 | 3 | tertiary | **Weak** | Cutting die (shippers) | Usually unprinted; low value either way at n=3. |
| `Formulation` | Formulation | 1 | 1 | NO_SCHEMA | No | *(none)* | Assembly-level; one of only two destinations with a **verified** NetSuite mapping. |
| *(no type set)* | — | **6** | **48** | — | No | *(none)* | 27 linked + 21 Nexus-local. See §3. |
| `Preliminary` | **not in production vocabulary** | **0** | **6** | **unmapped** | No | *(none)* | Sandbox-only option. See §3. |

Totals reconcile: HubSpot 16 options + no-type = **1,080**; Nexus = **1,113**
leaves (1,090 linked, 23 local).

---

## 3 · Missing classifications and disagreements

**Every linked record that resolves, agrees. Zero disagreements.**

I compared all 1,090 linked leaves against live HubSpot by product id:

| | |
|---|---:|
| Linked leaves compared | 1,090 |
| Resolved in production HubSpot | 1,061 |
| **Both set and different** | **0** |
| **Nexus null where HubSpot has a value** (stale pull) | **0** |
| **Nexus set where HubSpot is null** | **0** |
| Linked id **not resolvable** in production HubSpot | **29** |

The sync is faithful. The entire discrepancy is those 29 ids, and they are not
a classification problem — they are **sandbox and test residue sitting in the
production database**:

| Nexus type | n | What they are |
|---|---:|---|
| *(NULL)* | 22 | `Coca Cola – 12oz …` ×5, `Essential` ×5, `Liquidease` ×2, `Treat & Target` ×2, `ED TEST 1234`, `HBS-1 smoke leaf`, `LFC-2 test leaf …`, `Nexus OAuth Scope Smoke 2026-05-20`, `Nexus PROD OAuth Scope Smoke 2026-05-22`, `Nexus Smoke Test 1`, `Emi Jay – Aura Hair Mist …`, `(unnamed product)` |
| `Preliminary` | 6 | `Component: Custom Bottle`, `Component: Film`, `PP - Corrugated Box`, `SP- Rigid Box`, `Service: Filling`, `Service: Kitting & Packout` |
| `Labels` | 1 | `Test Product` |

`Preliminary` is a **sandbox-portal option that does not exist in production
HubSpot**. The governed mapping does not dispose it, so those 6 resolve
`unmapped` — correctly, and loudly. They reached the production database because
dev and production share one database while the Products client is
portal-aware.

The remaining gap: **21 Nexus-local leaves** (no `hubspot_product_id`) carry no
type and never will until someone classifies them, and **6 products in HubSpot**
have no type set at source.

---

## 4 · Identity versus arrangement — the central finding

**MISTR's five gummies are all classified `Turnkey`.**

| SKU | Name | Product Type |
|---|---|---|
| DPS-MISTR-1007 | MISTR - Multi Gummy | `Turnkey` |
| DPS-MISTR-1008 | MISTR - Perform Gummy | `Turnkey` |
| DPS-MISTR-1009 | MISTR - Prepare Gummy | `Turnkey` |
| DPS-MISTR-1010 | MISTR - Probiotic Gummy | `Turnkey` |
| DPS-MISTR-1011 | MISTR - Recover Gummy | `Turnkey` |

Turnkey describes **how DPS sources the item**, not what it is. From `Turnkey`
alone you cannot tell a gummy from a serum from a shipper, so no charge rule can
fire on it — and `Turnkey: NO_SCHEMA` additionally asserts that no specification
applies, which is false about a gummy.

This is the same conflation that made `product_type_id` fail, in the other
direction: one field is being asked to carry two orthogonal facts. **Nine
products firm-wide are affected** — small enough to fix, and important enough
that any rule built on Product Type must treat `Turnkey` as *unclassified*
rather than as a category.

**MISTR's lubricants** are all `Raw ingredients`:

| SKU | Name | Product Type |
|---|---|---|
| DPS-MISTR-1002 | MISTR - 2oz lube | `Raw ingredients` |
| DPS-MISTR-1003 | MISTR - 2oz Lube Silicone | `Raw ingredients` |
| DPS-MISTR-1004 | MISTR - 2oz Lube Water | `Raw ingredients` |
| DPS-MISTR-1005 | MISTR - 4oz Lube Silicone | `Raw ingredients` |
| DPS-MISTR-1006 | MISTR - 4oz Lube Silicone | `Raw ingredients` |

That is **five rows, not four**. 1005 and 1006 carry the **same name**; 1002 is
an unqualified “2oz lube” beside a silicone/water split. Flagged for review on
the names alone — I have not concluded which is redundant. `Raw ingredients` is
`SCHEMA_PENDING`: bulk material demonstrably has specifications and Nexus has
not implemented them, which is a recorded gap rather than an absence.

**Sol de Janeiro bags are consistent and correct.** Every Jet Set bag, the Gen Z
backpack and the Stadium Bag are `Soft Goods and Accessories`; every insert card
is `Cards, Booklets`; the Rio Radiance body sprays are `Primary`. Two review
flags: `Discovery Cream Trio '24` is `Primary` while `'25` is `Secondary`, and
`Mothers Day Pink Mist Set` / `Seasons of SOL Set` are `Soft Goods` though they
read as sets.

**Bags generally are split across four types, correctly**: 28 Soft Goods (sewn
carriers), 6 Secondary (paper shopping bags, velvet drawstring, gift bags), 4
Raw ingredients (*a raw material supplied in a 16 kg bag* — a name-match, not a
misclassification), 1 Labels. This is the clearest evidence that the existing
type does separate carrier-bag from carton **when it is set**.

**Packaging exemplars**: bottles/jars/tubes/caps/pumps sit in `Primary`;
printed cartons in `Secondary`. Both behave as the suggestion table assumes.

---

## 5 · Charges: what exists today

Component-owned (authored **per component**, `COMPONENT_CHARGE_KEYS`):

| Key | Label | Destination | Notes |
|---|---|---|---|
| `print_plates` | Print plates | `otc_print_plates` | |
| `tooling` | Tooling & dies | **depends on instance** | `mould_collar` → `otc_mould`; `cutting_die` → `otc_dies` |
| `artwork_plate` | Artwork & prepress | `otc_artwork` | |
| `samples` | Samples & PPS | `otc_samples` | |
| `other_service` | Other | `otc_other_service` | **per-line item selection required** |

Assembly/quote-level, not component-owned: `project_setup`, `rd_formulation`,
`testing_micros` (**per-line**), `container_freight`, `duty_tariffs`.

**The cutting-die versus mould distinction is preserved and is load-bearing.**
`tooling` is deliberately absent from the type→destination map: it is the one
charge whose destination depends on a fact the charge type does not carry. An
unclassified tooling charge **refuses** (`needs_classification`) rather than
defaulting. It never falls back to `otc_tooling`, which carries an unresolved
BV-011 §1.b conflict (recorded Inventory; its sandbox item OTC-0005 is
`NonInvtPart`).

This is exactly where Product Type earns its keep: **`Primary` ⇒ mould/collar,
`Secondary`/`Labels`/`Cards, Booklets` ⇒ cutting die.** It is the single most
useful inference the existing field supports, and it is a *suggestion* — the
operator still states it, because the destination is an accounting fact.

---

## 6 · Supported destination ≠ configured and verified mapping

These are different claims and the gap is wide.

**Supported** — a `Bv011Destination` key exists with a governed item type, and
`componentChargeDestination` resolves to it: all six component destinations
(`otc_print_plates`, `otc_artwork`, `otc_samples`, `otc_other_service`,
`otc_mould`, `otc_dies`).

**Configured and verified in production** — a row in
`netsuite_service_item_map` naming a real internal id, with a confirmation
timestamp. There are **exactly two, and neither is a component charge**:

| Identity | Item code | Internal id | Confirmed |
|---|---|---|---|
| `formulation` | OTC-0050 | 59157 | 2026-08-19 |
| `filling_blending` | BLD-FILL | 14525 | 2026-08-18 |

**No component charge destination has a verified production item mapping.**
Suggesting these charges is therefore safe for quoting and *not yet* sufficient
for a NetSuite push.

**Two destinations must never acquire a firm-wide mapping.** `other_service` and
`otc_testing` choose their item **per line**, frozen at send; the table has a
CHECK forbidding an `other_service` row. A firm-wide row would be a second
answer to “which item does this line post to”, sitting in Settings looking
authoritative while the frozen per-line selection is what actually posts.

---

## 7 · Recommendation

**Product Type, after cleanup, is sufficient to *suggest* — and cannot be made
sufficient to *decide*.** Do not add a subtype.

Seed the suggestion from Product Type; let the operator confirm; require, per
instance, only the facts that change an accounting destination.

- **A subtype is the failed experiment repeated.** A second operator-maintained
  taxonomy is precisely what `product_type_id` was, and it reached 3% coverage.
  Nothing about a new one would be different.
- **A separate charge profile is a subtype wearing a different name** unless it
  is derived. Derived from Product Type, it is this recommendation; authored by
  hand, it decays the same way.
- **Product Type already carries the one distinction that changes a destination**
  — mould versus cutting die — and `tooling_classification` already exists as
  the per-instance override, with a refusal rather than a default when absent.
  That pattern generalises and needs no new field.

**What no option can determine, and where each fact has to come from:**

| Fact | Why the type cannot carry it | Where it must come from |
|---|---|---|
| **Stock vs custom tooling** | `Primary` covers both a stock bottle (no tooling) and a bespoke mould | Operator, per component. No existing field. |
| **Printed vs unprinted** | `Secondary` covers a printed carton and a plain shipper | Operator, per component. No existing field. |
| **Print process (plate vs digital)** | `Labels` covers both; digital needs no plate | Operator, per component. No existing field. |
| **Sewn vs moulded soft goods** | `Soft Goods` covers a sewn bag and a moulded compact | Operator, per component. No existing field. |
| **Anything about a `Turnkey` row** | It is an arrangement, not an identity | Reclassify the 9 rows. |

Each of these makes the suggestion **over-inclusive, never under-inclusive** —
it proposes a charge the operator declines. That is the right failure direction,
and it is why suggestion is safe while automatic application would not be.

---

## 8 · Proposed cleanup list

Nothing here has been done. No cleanup was performed.

| # | Item | n | Kind |
|---|---|---:|---|
| 1 | Sandbox/test leaves linked to ids absent from production HubSpot | 29 | Data hygiene |
| 2 | └ of which carry `Preliminary`, a sandbox-only value | 6 | Resolve `unmapped` |
| 3 | Nexus-local leaves with no classification | 21 | Needs a decision |
| 4 | Products in HubSpot with no type set | 6 | Fix at source |
| 5 | `Turnkey` rows — arrangement in the identity field | 9 | **Business decision** |
| 6 | `One Time Charges` rows named “… Tooling” — charges as catalogue products | 25 | **Business decision** |
| 7 | `DPS-MISTR-1005` / `1006` share a name | 2 | Review flag (name only) |
| 8 | SDJ `Discovery Cream Trio` ’24 `Primary` vs ’25 `Secondary` | 2 | Review flag (name only) |
| 9 | SDJ `Mothers Day Pink Mist Set`, `Seasons of SOL Set` typed Soft Goods | 2 | Review flag (name only) |

Items 7–9 are flagged **from names and SKUs only** and are not findings of
misclassification.

---

## 9 · Decisions requiring business review

1. **Is `Turnkey` a Product Type at all?** If it is an arrangement, those 9
   products need a real identity and Turnkey needs a different home. Until then
   any rule must treat it as unclassified.
2. **Do the 62 `One Time Charges` products retire** now that charges are
   component-owned with governed destinations? They are the predecessor pattern.
3. **Who states stock-vs-custom and printed-vs-unprinted, and when?** Both are
   per-component facts with no field today. Nothing else in this report can
   proceed to automatic application without them.
4. **`otc_tooling`'s BV-011 §1.b conflict** — recorded Inventory, sandbox item
   is `NonInvtPart`. Unblocking it would remove the reason `otc_mould` exists
   as a separate key.
5. **Which NetSuite items back the six component destinations**, and who
   confirms them. Until then these charges quote but do not post.
6. **`Raw ingredients` SCHEMA_PENDING** — 52 products whose specifications are
   acknowledged to exist and are unimplemented.

---

## 10 · Method

Read-only throughout. Production Nexus read via `DIRECT_URL`; production HubSpot
read via `HUBSPOT_ACCESS_TOKEN` — chosen deliberately over the Products client,
which uses the write-enabled token. Comparison covered **all 1,090 linked
leaves**, not a sample. Counts per type came from HubSpot search totals, one
query per option value. Temporary query scripts were deleted after running.

No classification was inferred from a name or SKU. Where a name suggested
something the record does not carry, it is listed as a review flag and labelled.

---
---

# Appendix A — Proposed vocabulary expansion

**2026-09-15 · proposal for business review · nothing added, reclassified or retired.**

Candidates only. No HubSpot option was created, no record reclassified, no field
added, no schema changed.

## A1 · The gap cleanup does not close

Cleanup fixes wrong and missing values. It cannot create a category that does
not exist — and **the formulated product DPS actually makes has no Product
Type.** Every such row today is classified by something other than its identity:

| Where formulated goods currently sit | n | Classified by |
|---|---:|---|
| `Turnkey` | 8 | how it is **supplied** |
| `Finished Goods` | 4 | its **lifecycle stage** |
| `Raw ingredients`, bulk-formulation rows | ~14 | its **inputs** |
| `Filling and Packout Services` | 110 | the **service** performed on it |

**Read this number honestly: the additions would reclassify roughly 26 rows,
not hundreds.** The catalogue is overwhelmingly packaging — 1,113 leaves, of
which 348 Secondary, 178 Primary, 118 Labels. The gap is small, real, and
concentrated in exactly the products the firm is best known for.

A name search for topical or colour-cosmetic words returns mostly **packaging
for** those products: `Hurr - Lip Gloss` and `Primary - Mascara` are `Primary`
because they are the container. A name hit is not a formulation, and none of the
counts below treat it as one.

## A2 · Proposed types

Three, not four. Each definition is an **identity** test — what the thing *is* —
never how it is supplied, sold, regulated or booked.

### 1 · `Ingestibles`

> A formulated product intended to be taken internally — gummies, capsules,
> tablets, softgels, powders, drink mixes.

**Boundary:** the formulation, not its container and not the act of filling it.
A gummy bottle is `Primary`; filling it is `Filling and Packout Services`; the
ascorbic acid that goes into it is `Raw ingredients`.

### 2 · `Topicals`

> A formulated product applied to skin or hair — creams, lotions, serums, balms,
> oils, mists, cleansers, fragrance.

**Boundary:** as above. Also excludes colour-decorated packaging.

### 3 · `Lubricants & Intimate Care`

> A formulated product for intimate use — water- or silicone-based lubricants
> and adjacent personal-care formulations.

**Its boundary against `Topicals` is the weakest of the three, and is stated
plainly: on specification fields alone these are indistinguishable from
Topicals.** The case for a separate type is commercial and service-profile, not
formulary. If the business cannot name a service or charge that differs, the
five rows should be `Topicals` and this type should not exist.

### Not proposed: `Color Cosmetics`

**No colour-cosmetic formulation exists in the library today.** Every hit —
Tower 28 foundation, Pretty Evil palette, Iris & Romeo lip shade,
`Primary - Lipstick` — is packaging (`Primary`, `Secondary`, `Labels`) or a
packout service. Adding it now creates an empty type, which is how a vocabulary
starts decaying.

**Trigger to revisit:** the first formulated colour product entering the
library. Shade and pigment are real specification fields no proposed schema
carries, so it should arrive *with* its schema rather than before it.

## A3 · Representative assignments

Rows marked **flag** are uncertain and are not proposals.

| SKU | Name | Today | Proposed | Note |
|---|---|---|---|---|
| DPS-MISTR-1007 | MISTR - Multi Gummy | `Turnkey` | **Ingestibles** | |
| DPS-MISTR-1008 | MISTR - Perform Gummy | `Turnkey` | **Ingestibles** | |
| DPS-MISTR-1009 | MISTR - Prepare Gummy | `Turnkey` | **Ingestibles** | |
| DPS-MISTR-1010 | MISTR - Probiotic Gummy | `Turnkey` | **Ingestibles** | |
| DPS-MISTR-1011 | MISTR - Recover Gummy | `Turnkey` | **Ingestibles** | |
| DPS-MISTR-1003 | MISTR - 2oz Lube Silicone | `Raw ingredients` | **Lubricants & Intimate Care** | |
| DPS-MISTR-1004 | MISTR - 2oz Lube Water | `Raw ingredients` | **Lubricants & Intimate Care** | |
| DPS-MISTR-1005 | MISTR - 4oz Lube Silicone | `Raw ingredients` | **Lubricants & Intimate Care** | **flag** — duplicate name with 1006 |
| DPS-MISTR-1006 | MISTR - 4oz Lube Silicone | `Raw ingredients` | **Lubricants & Intimate Care** | **flag** — duplicate name with 1005 |
| DPS-MISTR-1002 | MISTR - 2oz lube | `Raw ingredients` | **flag** | unqualified, beside a silicone/water split |
| WFG842, WFL844 | W LABS COLOGNE SPRAY | `Turnkey` | **Topicals** | |
| Cirqadian-AM, -BS, -GA | Cirqadian … 100ml (FG) | `Finished Goods` | **Topicals** | |
| Cirqadian-RS | Cirqadian - The Ritual Set (FG) | `Finished Goods` | **flag** | a set, not one formulation |
| *(none)* | Cirqadian 3 Sku Discovery Kit, Filling and … | `Turnkey` | **flag** | reads as a kit/packout description, not a product |
| — | `Cirqadian - Raw Materials, Away Message 100ml` and similar | `Raw ingredients` | **flag** | bulk formulation — see A4 |
| — | `BrainMD - L-Theanine`, `- Citric Acid`, … | `Raw ingredients` | **unchanged** | individual inputs stay `Raw ingredients` |
| BA0209xx… | Sol de Janeiro Jet Set bags | `Soft Goods` | **unchanged** | correct today |
| — | `Hurr - Lip Gloss`, `Primary - Mascara` | `Primary` | **unchanged** | packaging, despite the name |

## A4 · The one boundary that must be decided first

**Does a bulk formulation carry the identity type, or stay `Raw ingredients`?**

`Raw ingredients` holds two different things — 38 rows reading as individual
inputs, 14 as bulk formulations. Nothing in this proposal resolves that, and the
answer changes roughly half the coverage claim:

- **Bulk takes the identity type.** `Cirqadian - Raw Materials, Away Message
  100ml` becomes `Topicals`. Consistent — the product is the product whether it
  is in a drum or a bottle. Loses the ability to filter "bulk" without another
  field.
- **Bulk stays `Raw ingredients`.** Preserves that filter. Costs consistency:
  one formulation carries two types depending on its packaging state.

This audit does not recommend one. It is a decision about what the field is
*for*, and everything downstream follows from it.

## A5 · Turnkey, without a parallel taxonomy

**Recommendation: reclassify the 9 rows to their real identity and retire
`Turnkey` as a Product Type option. Do not add a sourcing-arrangement field.**

Nexus can already observe the arrangement from quote structure — an Item Group
with DPS-supplied components is a different shape from a single purchased
finished good — and that observation derives from data operators maintain for
other reasons, so it cannot quietly decay.

A second HubSpot property would not strictly be a *parallel taxonomy*: a
parallel taxonomy is two answers to one question, and identity and arrangement
are two questions. It would, though, be a **second manually-maintained
classification with no workflow behind it**, which is the mechanism that took
`product_type_id` to 3% coverage. That precedent is the argument — not the
naming.

**If the business needs arrangement recorded on the product** rather than
derived per quote, that is a real requirement this audit cannot overrule. It
should then be a deliberate property with an owner and a maintenance workflow,
decided on its own merits — not acquired by leaving `Turnkey` in the identity
field.

## A6 · Coverage

| Gap | Rows | Resolved by |
|---|---:|---|
| `Turnkey` — arrangement in the identity field | 8 | Ingestibles 5, Topicals 2, 1 flagged |
| `Finished Goods` — lifecycle as identity | 4 | Topicals 3, 1 flagged |
| Bulk formulations inside `Raw ingredients` | ~14 | **only if A4 decides bulk takes the identity type** |
| **Total reclassified** | **~26** | of 1,113 leaves — 2.3% |
| Rows still with no identity type | 21 Nexus-local, 6 HubSpot-untyped | unchanged — these need values, not categories |

`Finished Goods` becomes near-empty and overlaps the new types entirely. Either
retire it, or redefine it as *purchased complete, not manufactured by DPS* —
which is again an arrangement, not an identity.

## A7 · Impact

| Surface | Impact |
|---|---|
| **Spec-schema selection** | Each new value needs a `MAPPING` entry in `spec-schema-mapping.ts`. Without one it resolves `unmapped` — surfaced, never folded into `no_schema`. |
| **Ordering hazard** | **The exhaustiveness fail-loud is a fixture, not a live check.** `specSchemaMappingIsExhaustive` is called only from a unit test, against a `VOCABULARY` constant "as fetched 2026-08-14". **Adding an option in HubSpot does not fail CI** — it silently yields `unmapped` products while the build stays green. **The mapping and that constant must ship before the option is created.** Making the check live is a small follow-up worth doing regardless of this proposal. |
| **Existing pinned quote specs** | **Untouched.** `leaf_specs.spec_schema` is frozen at attachment with `schema_derived_from_type` as provenance, precisely so a later reclassification cannot reinterpret values an operator already authored. Reclassifying a library product alters no quote. New attachments pin the new value. |
| **Library filters** | `sourceTypeFilter` matches the raw value exactly, and the option list is a live vocabulary read — new options appear once they exist in HubSpot. Reclassified products move between filters, which is expected and visible. |
| **HubSpot sync** | Pull-only for this field, but Nexus *writes* `hs_product_type` on HubSpot-first create, so a new value must exist in the **receiving portal**. Sandbox and production option sets already differ (`Preliminary` is sandbox-only, §3), so both need the addition or a create validates against options one portal lacks. |
| **NetSuite / accounting** | **No change, and this must hold.** Product Type must not select cutting die versus mould/collar — `tooling_classification` stays per-instance and refuses when absent — and must not supply an item for `other_service` or `otc_testing`, whose items are chosen per line and frozen at send. A type may *suggest a charge exists*; it may never *state where it books*. |
| **`product_types` table** | A new spec schema needs a real row with a real field set. Existing: primary 10 fields, secondary 11, tertiary 10, soft goods placeholder 0, service hidden 0. |

## A8 · New spec schema required

**These types must not route to `no_schema`.** A gummy and a cream plainly have
specifications; saying otherwise is the false-finished answer `SCHEMA_PENDING`
exists to prevent.

**Proposed: one new schema, `formulated`,** shared by all three types, with
**form as a field inside it** rather than three near-identical schemas.
Candidate fields for business review — not a decided set:

form/format · net content and fill volume · appearance and colour · pH ·
viscosity · density · flavour or fragrance · actives and reference formulation ·
allergens · shelf life · storage conditions · batch size

Form-dependent fields — viscosity for a cream, flavour for a gummy — stay in one
schema and sit empty where they do not apply, exactly as the packaging schemas
already do.

**This also offers a resolution for `Raw ingredients`' `SCHEMA_PENDING`** — 52
products whose specifications are acknowledged and unimplemented. Whether bulk
formulation shares `formulated` or needs a sibling depends on A4.

## A9 · Suggested services and charges

**Every row is a suggestion. None is a fact, and none determines a
destination.**

| Type | Suggested | Requires operator confirmation |
|---|---|---|
| `Ingestibles` | R&D / formulation · stability and potency testing · flavour development · filling and packout · samples & PPS | whether any applies; which lab; **the per-line NetSuite item for testing** |
| `Topicals` | R&D / formulation · stability and preservative-efficacy testing · pack compatibility · filling and packout · samples & PPS | as above |
| `Lubricants & Intimate Care` | as Topicals, plus compatibility testing against primary-pack material | as above — **and whether this differs from Topicals at all**, which is the test of whether the type should exist |

Constraints, restated because they are the ones most easily lost:

- **No regulatory classification is implied.** "Ingestibles" is a manufacturing
  identity. It asserts no regulatory category, and nothing downstream should
  read one from it.
- **No accounting destination is implied.** `testing_micros` and `other_service`
  remain per-line and frozen at send.
- **Tooling stays per-instance.** No type sets mould versus cutting die.

## A10 · Smallest useful expansion — recommendation

**Two types now, one conditional, one held.**

1. **Add `Ingestibles` and `Topicals`.** Both are evidenced, both have
   unambiguous boundaries, and together they resolve 10 of the 12 misclassified
   arrangement- and lifecycle-typed rows.
2. **Add `Lubricants & Intimate Care` only if** the business can name a service
   or charge that differs from Topicals. Otherwise those five rows are Topicals.
3. **Do not add `Color Cosmetics`** until a colour formulation exists — and add
   it then with shade and pigment fields.
4. **Retire `Turnkey`** from the identity field, and decide `Finished Goods`
   alongside it.
5. **Decide A4 first.** It determines half the coverage and the shape of the
   schema.
6. **Ship the mapping before the options exist**, and consider making the
   exhaustiveness check live.

## A11 · Decisions for business review

1. Do `Ingestibles` and `Topicals` match how the firm actually talks about these
   products, or is a different cut more natural?
2. Does `Lubricants & Intimate Care` differ from `Topicals` in any service or
   charge? If not, it should not exist.
3. **A4:** does bulk formulation take the identity type, or stay `Raw
   ingredients`?
4. Retire `Turnkey` as an option — and is arrangement needed on the product at
   all, given the quote already shows it?
5. What becomes of `Finished Goods`?
6. Confirm the `formulated` field set, and whether bulk needs a sibling schema.
7. Both portals must gain any new option. Who makes that change, and when
   relative to the code?

---
---

# Appendix B — Implementation proposal: Ingestibles and Topicals

**2026-09-15 · reviewable PR · no option created, no product reclassified, no
migration applied, no default rule seeded.**

## B0 · Two corrections to Appendix A

**B0.1 — Quote structure does not reveal how a product is supplied.** A5
recommended retiring `Turnkey` partly because "Nexus can already observe the
arrangement from quote structure". That is withdrawn. An Item Group with
DPS-supplied components and a contract-manufactured finished good can present
the same shape, and a bought-complete good can be quoted as a single line for
reasons that have nothing to do with sourcing. Structure is evidence of how a
quote was *built*, not of how the product is *supplied*.

The rest of A5 stands on its own: `Turnkey` is an arrangement sitting in the
identity field, and a second manually-maintained classification carries the
`product_type_id` decay risk. But **if the firm needs sourcing arrangement
recorded, there is currently nowhere it can be derived from, and it needs a
deliberate home.** That is now an open decision rather than a solved one.

**B0.2 — The spec schemas are free text.** A8 proposed a field set without
noting what a "schema" is here. Every existing schema is a list of
`{key, label, wide?}` captions over free-text boxes — `pp_material`,
`sp_coating`, `tp_flute`. Nothing is typed, ranged, parsed or rejected. This
materially changes the one-schema-or-three question; see B2.

## B1 · What is in the PR

| Change | Why |
|---|---|
| `Ingestibles` and `Topicals` → `SCHEMA_PENDING` in `spec-schema-mapping.ts` | The mapping ships **before** the options exist. An entry with no option is inert; an option with no entry resolves `unmapped` in production while CI stays green. |
| `scripts/verify/product-type-vocabulary-live.ts` + `npm run verify:product-type-vocabulary` | The live comparison. Reads both portals, reports each separately, exits non-zero on any value with no disposition. |
| `spec-schema-mapping.test.ts` reframed | The dated fixture no longer reads as live coverage, and no longer forbids mapping ahead of the vocabulary. |
| `drizzle/0129_draft_formulated_spec_schema.sql` | **DRAFT, unjournaled, NOT APPLIED.** The `formulated` field set, as a reviewable artifact. |
| `drizzle/0130_draft_product_type_charge_defaults.sql` | **DRAFT, unjournaled, NOT APPLIED, NOT SEEDED.** The Settings table. |
| Both added to `DRAFT_EXEMPT` | The repo's existing mechanism for a migration that must not run. Each declares the contract in its own body. |

Not in scope, not touched: the CD wizard, the Costs redesign, any
reclassification, `Turnkey`, and every NetSuite posting path.

## B2 · Is one `formulated` schema sufficient?

**Yes — and the reason is narrower than it first appears, so it is worth being
exact about what has been established.**

The existing schemas are labelled free-text fields. Nothing validates a value,
so no product family can be *mis-typed* by sharing a schema. "Is one schema
enough" is therefore **not** a data-integrity question. It is: does one label
set read correctly to an operator filling it in for a gummy, a lubricant and a
cream?

Comparing the three against the proposed field set:

| Field | Gummy | Lubricant | Cream / topical | Notes |
|---|---|---|---|---|
| Description | ✓ | ✓ | ✓ | |
| **Form** | gummy | liquid / gel | cream, lotion, serum | the discriminator |
| Net content / fill | count or weight | volume | volume or weight | one caption covers all three |
| Appearance / colour | ✓ | ✓ | ✓ | |
| Actives / reference formula | ✓ | ✓ | ✓ | |
| Flavour / fragrance | **flavour** | rarely | **fragrance** | one caption, two readings |
| pH | rarely | ✓ | ✓ | |
| Viscosity / density | — | ✓ | ✓ | empty for a gummy |
| Allergens | ✓ | ✓ | ✓ | |
| Shelf life | ✓ | ✓ | ✓ | |
| Storage conditions | ✓ | ✓ | ✓ | |
| Factory 1 / 2, Packout details | ✓ | ✓ | ✓ | same as packaging schemas |

Eleven of thirteen apply to all three. Two are form-dependent and sit empty
where they do not apply — **which the packaging schemas already do**: a rigid
box leaves `sp_coating` empty and nobody has ever needed a rigid-box schema.

**Splitting into three would add no guarantee**, because there is no validation
to differentiate, and would triple the maintenance of a label list. The honest
summary: *one schema is sufficient because the schema layer is presentational;
if it ever becomes typed or validated, this conclusion should be revisited and
may not survive.*

**What the comparison does NOT establish:** whether "Flavour / fragrance" as a
single caption reads correctly to an operator, and whether a gummy needs
count-per-unit distinctly from net weight. Those are operator questions and are
in B7.

## B3 · Proposed HubSpot option values

The internal value is what Nexus stores and what every rule keys on; the label
is what the HubSpot UI shows. **Three existing options already diverge**
(`Primary Packaging` → `Primary`, `Secondary Packaging` → `Secondary`,
`Logistics` → `Third Party Logistics`), which is exactly how a label-keyed rule
would miss half the catalogue.

| Proposed label | Proposed internal value | Rationale |
|---|---|---|
| `Ingestibles` | `Ingestibles` | Label and value identical, deliberately — divergence has caused real defects and buys nothing here. |
| `Topicals` | `Topicals` | As above. |

Both must be created in **production and sandbox**, because the Products client
is portal-aware and a create validates against the receiving portal's options.
`Preliminary` and `Corrugated` already demonstrate the drift when they diverge.

**Recommended order, and it matters:**

1. Merge this PR (mapping + live check ship first).
2. Approve and apply `0129` — the `formulated` schema row.
3. Follow-up PR: `SCHEMA_PENDING` → `formulated` for both values.
4. **Then** create the options in both portals.
5. Run `npm run verify:product-type-vocabulary` — expect `UNMAPPED: none` and
   the two values to disappear from `AHEAD`.
6. Reclassify records — separately, and only once the above is green.

## B4 · Existing pinned quote specs remain intact

**Nothing in this PR, and nothing in the steps above, alters a pinned spec.**
The mechanism already exists and is the reason this is safe:

- `leaf_specs.spec_schema` holds the resolution **frozen at attachment** —
  `primary | secondary | tertiary | no_schema | unmapped | no_type`.
- `leaf_specs.schema_derived_from_type` records the authoritative value the pin
  was derived from, as provenance, so a pin stays explicable after HubSpot
  changes and an `unmapped` pin is recoverable.
- `leaf_specs.spec_values` is frozen alongside it.
- Library rows leave `spec_schema` NULL and defer; quote-owned rows carry the
  pin.

So a product reclassified from `Turnkey` to `Ingestibles` next month leaves
every quote that already attached it exactly as its operator left it — same
schema, same values, same provenance. Only attachments made *after* the change
pin the new resolution. This is the property the pinning design was built for,
and this proposal relies on it rather than adding to it.

**Migration `0129` inserts a `product_types` row. It updates nothing**, so it
cannot disturb a pin even at the moment it is applied.

## B5 · Bulk formulation — decision pending

**Recommendation: identity-based. A bulk formulation carries its identity type;
`Raw ingredients` is reserved for individual inputs — actives, excipients,
flavours, acids.**

Rationale: the product is the product whether it is in a drum or a bottle, and
`Raw ingredients` currently holds two different kinds of thing (38 rows reading
as individual inputs, 14 as bulk formulations), which is why its spec schema
has been `SCHEMA_PENDING` and unresolvable.

**This rule is NOT approved and nothing in this PR assumes it.** It changes
roughly half the coverage claim and determines whether `formulated` needs a
sibling schema for bulk. Until it is decided:

- no row moves out of `Raw ingredients`;
- `Raw ingredients` stays `SCHEMA_PENDING`;
- `0129` is not applied.

## B6 · Settings — Product Type → charge defaults

Design and storage, per the agreed shape. **Table drafted, not applied, not
seeded.**

### Storage

`product_type_charge_defaults` — see `drizzle/0130_draft_*.sql`.

| Column | Purpose |
|---|---|
| `product_type_value` | HubSpot's **raw internal value**. Not an enum, not an FK — a reference to someone else's vocabulary, never a definition of one. |
| `charge_key` | CHECKed against the five existing component charge identities. A row cannot invent a charge. |
| `preselected` | Whether the suggestion arrives ticked. Either way the operator confirms. |
| `note` | Why the rule exists, for the admin who inherits it. |
| `created_/updated_by_user_id`, timestamps | Who set this, and when. |

Unique on `(product_type_value, charge_key)` — a second row for one pair would
be two answers to one question.

**Deliberately absent, and each absence is load-bearing:** no display name,
description, parent or ordering (that would make this a second product
taxonomy); no NetSuite item column (posting stays separate); no
`tooling_classification` (a default there would silently choose an accounting
destination).

### The six agreed properties, and where each is enforced

| Property | Where it lives |
|---|---|
| Admin-maintained relationships between **existing** types and **existing** charge identities | The CHECK constraint, and the absence of any vocabulary column |
| Suggestions may be preselected; **the operator confirms applicability** | `preselected` is a starting position; the charge instance is still authored by the operator |
| **Explicit tooling classification remains required** | Unchanged. `componentChargeDestination` returns `needs_classification` and never defaults. No column here can satisfy it. |
| **Quote-specific choices survive changes to defaults** | The reader consults this table only when composing suggestions for a component **being added** — never when rendering one already present. A quote's charges are the operator's, permanently. |
| **Missing rule means "needs review", not "no charges"** | Cannot be enforced by the table — absence has no row to carry a flag. It belongs in the reader's contract and its tests, and is stated in the migration header. |
| **NetSuite mappings separate; Other Service and Testing keep per-line selection** | No item column, now or ever. `other_service` and `otc_testing` resolve per line and freeze at send. |

### Migration requirements

| | |
|---|---|
| Table | 1 new, additive. No existing object altered. |
| Indexes | 1 unique, 1 read index. |
| Backfill | **None.** Empty is the correct initial state — an unapproved default rule is a business decision made by a migration. |
| Ordering | Additive; safe ahead of code by the classification rule. Still **not applied** pending design approval. |
| Reversibility | `DROP TABLE` while empty. No data loss, no dependent object. |

### Implementation plan, after approval

1. Apply `0130`; add the Drizzle schema entry.
2. Read path: `suggestionsForProductType(value)` returning
   `{ rules, verdict: "has_rules" | "needs_review" }` — **never** an empty list
   read as "no charges".
3. Admin surface under Settings, admin-gated, audited, transactional with its
   audit entry — the `updateUserGrants` shape.
4. Wire suggestions into the component-charge authoring surface as
   preselection only.
5. Tests: absence resolves to `needs_review`; a quote's existing charges are
   unaffected by a default change; tooling still refuses without a
   classification.

Steps 4 and 5 touch the Costs surface and are **out of this PR's scope** by
instruction.

## B7 · Outstanding business decisions

Carried forward from A11, plus what this PR surfaced:

1. **Approve `Ingestibles` and `Topicals`** as labels and internal values (B3).
2. **Approve the `formulated` field set** (B2), specifically: is
   "Flavour / fragrance" one caption or two, and does a gummy need
   count-per-unit separately from net content?
3. **Approve or reject the bulk-formulation rule** (B5). Blocks `0129`.
4. **`Lubricants & Intimate Care`** — still conditional on naming a service or
   charge that differs from Topicals.
5. **`Turnkey` and `Finished Goods`** — and, per B0.1, **where sourcing
   arrangement should live**, now that quote structure has been withdrawn as a
   source.
6. **Sandbox `Corrugated` and `Preliminary`** — the live check reports both as
   unmapped **today**. Either dispose them in the mapping or stop sandbox
   products reaching the shared database. Six production rows already carry
   `Preliminary`.
7. **Who creates the options in both portals, and when** relative to steps 1–6
   of B3.
8. **Approve the Settings table design** (B6) before `0130` is applied.
