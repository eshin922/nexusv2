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
roughly half the coverage claim. Until it is decided:

- no row moves out of `Raw ingredients`;
- `Raw ingredients` stays `SCHEMA_PENDING`.

> **Superseded in part by C3.** This section also said `0129` is not applied
> until the bulk rule is decided. That coupling was wrong: `0129` inserts a
> schema row and touches no product, so which products use the schema is a
> separate question from whether it exists. The bulk decision is an input to
> reviewing the FIELD SET, not a gate on the migration.

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

---
---

# Appendix C — Review tables and two clarifications

**2026-09-15 · for review · nothing approved, applied or created.**

## C0 · Correction: the draft has 15 fields, not 13

`0129` carries **15** field keys. The "13" figure came from the B2 comparison
table, which showed `Factory 1` and `Factory 2` on one line and omitted
`Additional details`. The full set is below; nothing in the migration changed.

## C1 · The proposed field set

Applicability: **●** applies · **◐** sometimes · **○** does not apply.

| # | Key | Label | Gummy | Lube | Topical | Recommendation | Rationale |
|---:|---|---|:--:|:--:|:--:|---|---|
| 1 | `fm_description` | Description | ● | ● | ● | **Keep** | Every existing schema opens with one. |
| 2 | `fm_form` | Form | ● | ● | ● | **Keep** | The discriminator that makes one schema viable. |
| 3 | `fm_net_content` | Net content / fill | ● | ● | ● | **Keep** | Count, volume or weight — one caption carries all three. |
| 4 | `fm_appearance` | Appearance / colour | ● | ● | ● | **Keep** | |
| 5 | `fm_actives` | Actives / reference formula | ● | ● | ● | **Keep** | The formulation identity itself. |
| 6 | `fm_flavor_fragrance` | Flavour / fragrance | ● | ◐ | ● | **Review the caption** | Applies to all three but *reads* differently. See D2. |
| 7 | `fm_ph` | pH | ○ | ● | ● | **Keep — form-dependent** | A solid dosage form has no meaningful pH. |
| 8 | `fm_viscosity` | Viscosity / density | ○ | ● | ● | **Keep — form-dependent** | Not measurable on a gummy. |
| 9 | `fm_allergens` | Allergens | ● | ● | ● | **Keep** | |
| 10 | `fm_shelf_life` | Shelf life | ● | ● | ● | **Keep** | |
| 11 | `fm_storage` | Storage conditions | ● | ● | ● | **Keep** | |
| 12 | `fm_additional_details` | Additional details | ● | ● | ● | **Keep** | Matches all three packaging schemas. |
| 13 | `fm_factory_1` | Factory 1 | ● | ● | ● | **Keep** | Matches packaging schemas. |
| 14 | `fm_factory_2` | Factory 2 | ● | ● | ● | **Keep** | Matches packaging schemas. |
| 15 | `fm_packout_details` | Packout details | ● | ● | ● | **Keep** | Matches packaging schemas. |

> **WITHDRAWN — see D3.** Calling these form-dependent was an invented
> scientific default. Applicability depends on the formulation and the
> measurement method; every field is optional and there is no per-family
> applicability rule.

**The two form-dependent fields are `fm_ph` (7) and `fm_viscosity` (8).** Both
are empty for an ingestible solid and populated for a liquid or emulsion. That
is the same behaviour the packaging schemas already rely on — a rigid box
leaves `sp_coating` empty — and it is why form is a field rather than three
schemas.

`fm_flavor_fragrance` (6) is a **different problem and not form-dependence**:
it applies everywhere, but one caption is asked to read as "flavour" to an
ingestible operator and "fragrance" to a topical one. Splitting it is the only
substantive open question in the set.

**Not present, and possibly owed if bulk takes an identity type:** batch size,
yield, and container/drum format. See C3.

## C2 · The eight decisions

| # | Decision | Recommendation | Rationale | Blocks |
|---:|---|---|---|---|
| 1 | Option labels and values | **`Ingestibles`/`Ingestibles`, `Topicals`/`Topicals`** | Label = value deliberately. The three existing divergences have caused real defects and buy nothing. | Creating the options; step 4 of B3. |
| 2 | `fm_flavor_fragrance` caption | **Split into `fm_flavor` and `fm_fragrance`** | One caption asked to read two ways is the kind of ambiguity an operator resolves differently each time. Splitting costs one empty field; the packaging schemas already carry empties. | Approving the field set → `0129`. |
| 3 | Bulk formulation rule | **Identity-based; `Raw ingredients` reserved for individual inputs** | The product is the product in a drum or a bottle. `Raw ingredients` currently holds 38 individual inputs and 14 bulk formulations, which is why its schema has been unresolvable. | Reclassification only — **not `0129`**. See C3. |
| 4 | `Lubricants & Intimate Care` | **Do not add yet** | On specification fields it is indistinguishable from Topicals. It needs a service or charge that differs, or it is Topicals. | A third option; the 5 MISTR lube rows. |
| 5 | `Turnkey` and `Finished Goods` | ~~Retire both~~ **WITHDRAWN — D1. Leave unchanged.** | Both are arrangement/lifecycle, not identity. 12 rows. | Reclassification of 12 rows. |
| 6 | Where sourcing arrangement lives | **Needs a home; I have no recommendation** | B0.1 withdrew "derive it from quote structure" — the same shape can mean bought-complete or contract-manufactured. There is currently nowhere to derive it from. | #5 — retiring `Turnkey` without this loses information. |
| 7 | Sandbox `Corrugated` / `Preliminary` | ~~Stop sandbox products reaching the shared DB~~ **WITHDRAWN — D6. Separate investigation; no deletion.** | Disposing them would legitimise sandbox values in production classification. The 6 existing rows are residue, not catalogue. | The live check going green; 6 rows of cleanup. |
| 8 | Settings table design | **Approve as drafted** | Empty by design, no vocabulary of its own, no item column, no tooling classification. | Applying `0130`; the whole suggestion feature. |

**Only #2 blocks `0129`.** #1 blocks option creation. #3 blocks reclassification.
#8 blocks `0130`. They are independent.

## C3 · Clarification 1 — the bulk rule does NOT gate `0129`

**B5 was wrong to couple them, and this supersedes it.**

`0129` inserts one `product_types` row. It touches no product, no quote and no
classification. Which products eventually *use* a schema is a separate question
from whether the schema exists, and I conflated the two.

The real dependency is narrower: **if bulk formulations take an identity type,
the field set may owe three more fields** — batch size, yield, container/drum
format — because a drum of bulk and a filled bottle differ in what an operator
needs to record. So the bulk decision is an **input to reviewing the field set**
(C2 #2), not a gate on creating the schema.

Three ways to sequence, all legitimate:

| | Order | Consequence |
|---|---|---|
| **A** *(recommended)* | Approve field set → apply `0129` → decide bulk separately | Schema exists for filled goods immediately. If bulk later needs extra fields, they are added by a second migration — `product_types.field_schema` is a JSONB column and appending a field is additive. |
| B | Decide bulk → approve field set once → apply `0129` | One migration, but the schema waits on an unrelated decision. |
| C | Apply `0129`, add a bulk sibling schema later | Only if bulk turns out to need a genuinely different form, which the comparison does not currently suggest. |

**Recommendation: A.** The only cost is a possible second additive migration,
and the benefit is that `Ingestibles` and `Topicals` stop depending on a
question about `Raw ingredients`.

## C4 · Clarification 2 — the operational trigger

**A manual command is not a control. It is correct that nothing today would
catch a HubSpot option added next month.** Three layers, because they fail
differently:

### Layer 1 — at ingestion, where the data actually arrives

`pullFromHubSpot` already reads the vocabulary (`loadHubspotProductTypeOptions`)
and already writes a `hubspot_pull_batch` audit row per batch. **Compare there,
and record any value with no disposition in that audit row's `diff_json`.**

The trigger is the moment new classifications enter Nexus, which is exactly
when it matters, and it needs no scheduler and no extra credential. It does not
fail the pull — fidelity to the source outranks local validation, and refusing
to store an unmapped value would be the wrong correction.

### Layer 2 — standing state, no credentials required

**Count the leaves whose `hubspot_product_type` has no disposition and surface
it on the admin surface.** This detects the *consequence* rather than the
cause, so it catches a value however it arrived — including sandbox residue,
which is how all six current `unmapped` rows got here and which Layer 1 would
not see.

This is the cheapest of the three and the one I would build first.

### Layer 3 — scheduled backstop

A daily GitHub Actions run of `verify:product-type-vocabulary` with both read
tokens as repository secrets. Catches an option added in HubSpot that nobody
has pulled yet, which neither other layer sees.

### Who receives a failure

**This needs a named owner and I should not assume one.** A scheduled job whose
failures go to "whoever notices" is the same class of non-control as the manual
command.

Recommended: the **Nexus admin who owns firm settings** — the same person who
maintains the logistics recipient and the NetSuite item map — because
dispositioning a new Product Type is an admin act, not an engineering one.

Delivery: Layer 2 is a surface an admin already visits. Layer 3 needs a
destination — GitHub notifications reach repository watchers, which is not a
person; Slack is available (`chat:write`, and a channel is already configured)
but adding a second notification path is its own scope.

**Decision needed:** who owns unmapped Product Types, and where does Layer 3
report?

**Not in this PR.** All three layers are proposals; #593 ships the command that
makes any of them possible.

---
---

# Appendix D — Narrowed scope: gap-fill only

**2026-09-15 · supersedes parts of B and C · nothing approved, applied or created.**

Scope instruction: gap-fill first, cleanup later; we are not redesigning the
taxonomy. This appendix is what #593 actually proposes. Where it conflicts with
Appendix B or C, **this wins**.

## D1 · What is out, and stays out

| Deferred | Status |
|---|---|
| `Turnkey`, `Finished Goods`, `Raw ingredients` | **Unchanged.** No retirement, no option removal, no reclassification. C2 #5 recommended retiring two of them; **that recommendation is withdrawn** — retiring `Turnkey` destroys the only record that those nine products are turnkey-supplied, and there is nowhere yet to put it. |
| Bulk formulation reclassification | Deferred. The B5 recommendation stands as a recommendation and is acted on by nobody. |
| Sourcing-arrangement field | Deferred. Still no home, still no recommendation. |
| Batch size, yield, container format | **Withdrawn from the field set** — see D4. |
| Charge-defaults table | **Removed from this PR.** The draft DDL now sits at `docs/proposals/product-type-charge-defaults-table.sql`, out of the migration tree, for a separate PR. |
| Monitoring beyond the command | Deferred. The command built in #593 stays; the admin surface, the ingestion hook and the scheduled run are all held until a recipient is agreed. |
| Sandbox residue | **Not deleted, not touched** — see D6. |

## D2 · Essential versus optional

**Essential to safely support two new types.** Each of these, absent, produces a
wrong or silent outcome:

| # | Change | What its absence causes | In #593 |
|---:|---|---|:--:|
| 1 | `MAPPING` entries for both values | Products resolve `unmapped` the moment an option is created | ✓ |
| 2 | Mapping shipped **before** the options exist | The window in #1, invisible because CI is a dated fixture | ✓ |
| 3 | `SCHEMA_PENDING`, not `NO_SCHEMA` | A false finished answer: "no specifications apply" to a gummy | ✓ |
| 4 | Exhaustiveness test permitting declared ahead-of-vocabulary entries | #2 is impossible — the test forbids the safe order | ✓ |
| 5 | A `formulated` schema row before flipping off `SCHEMA_PENDING` | A schema id resolving to a `product_types` row that does not exist | `0129` — **pending, not inert; see E1** |

**Optional — real improvements, none required for correctness:**

| Change | Why it can wait |
|---|---|
| The nine held-back spec fields (D3) | JSONB append; adding later is additive and cheap |
| Admin-visible unresolved-disposition surface | Useful; needs a recipient decision first |
| Ingestion-time comparison | Layered on top of a surface that does not exist yet |
| Scheduled vocabulary run | Needs a named destination |
| Charge-defaults table | Separate concern entirely |

**Nothing is required in Library filtering or pinned specs.** Filters read the
live vocabulary, so new options appear on their own; pins are frozen at
attachment and cannot be disturbed by a new option or a new schema row.

## D3 · The revised field list

**As instructed, Flavour was split from Fragrance and Viscosity from Density.
That produced 17 fields.** Under the narrowing instruction the draft now carries
**8**, with the other **9 documented and held back** — not rejected.

### The 8 in `0129`

| # | Key | Label | Why it is minimum |
|---:|---|---|---|
| 1 | `fm_description` | Description | Every existing leaf schema opens with one |
| 2 | `fm_form` | Form | The discriminator that makes one schema viable |
| 3 | `fm_net_content` | Net content / fill | Count, volume or weight |
| 4 | `fm_actives` | Actives / reference formula | The formulation identity itself |
| 5 | `fm_additional_details` | Additional details | Pattern — all three packaging schemas |
| 6 | `fm_factory_1` | Factory 1 | Pattern |
| 7 | `fm_factory_2` | Factory 2 | Pattern |
| 8 | `fm_packout_details` | Packout details | Pattern |

Four are the existing pattern; four carry the product's identity.

### The 9 held back

`Appearance / colour` · `Flavour` · `Fragrance` · `pH` · `Viscosity` ·
`Density` · `Allergens` · `Shelf life` · `Storage conditions`

Each is plausibly useful and none is needed to make the types usable.
`field_schema` is JSONB, so adding any of them is an additive migration
appending to an array — cheap enough that shipping them speculatively buys
nothing, while an unused caption is a cost paid every time the form is opened.

### Applicability — a correction

**C1 claimed pH does not apply to gummies and always applies to lubricants and
topicals, and called pH and Viscosity "the two form-dependent fields". That is
withdrawn.** It was an invented scientific default. Whether pH, viscosity or
density applies depends on the formulation and on the measurement method, and
neither this schema nor the code around it is entitled to decide it.

**Every field is optional.** An empty field means "not recorded" — the same
thing it means on every packaging schema — and is not a claim that the property
does not exist. There is consequently **no per-family applicability table**, and
the earlier ●/◐/○ grid should not be relied on.

This strengthens rather than weakens the one-schema case: if applicability
varies by formulation rather than by family, a per-family split would encode a
distinction that is not there.

## D4 · Bulk coverage, checked against a real record

Take `Cirqadian - Raw Materials, Away Message 100ml` — a bulk formulation
sitting in `Raw ingredients` today.

C3 said the field set "may owe" batch size, yield and container format if bulk
took an identity type. **Checked against that record, all three are withdrawn**,
because none is a property of the product:

| Candidate | What it actually is | Where it belongs |
|---|---|---|
| Batch size | A **production measurement** — varies per run and per quote | Production inputs, per assembly and tier |
| Yield | A **production measurement** — an outcome of a run, not a property of the formulation | Production inputs |
| Container / drum format | Either **packaging** (which has its own schemas) or a packout fact | `Primary`/`Tertiary` schema, or `fm_packout_details` |

The eight fields cover this record without them: description, form
(bulk/liquid), net content, actives, factories, packout details.

**This also removes the last reason the bulk decision touched the field set.**
C3 decoupled `0129` from the bulk rule on sequencing grounds; D4 removes the
dependency itself. The bulk question is now purely about which products carry
which type — deferred, and touching nothing in this PR.

## D5 · Vocabulary monitoring — narrow first, deferred

Per instruction the command built in #593 is all that ships. The first
implementation **when it is built** should be an admin-visible count and list
of products with unresolved dispositions, and it must keep four states apart —
collapsing them is what makes such a surface useless:

| State | Meaning | Action |
|---|---|---|
| `unmapped` | Nobody has dispositioned this value | Add a `MAPPING` entry |
| `schema_pending` | Dispositioned; a schema is owed | Build the schema |
| `no_schema` | Deliberate finished answer | **None — not a problem** |
| `no_type` | No authoritative type at source | Classify in HubSpot, or it is Nexus-local |

Two of these need action, one is finished, one is a data gap. A surface
reporting a single "unresolved" number would present the finished answer as a
defect.

**Ingestion preserves source data without treating the record as ready.**
Storing the raw value is deliberate — fidelity to the source outranks local
validation — and is a separate question from whether a record is ready to be
used. The two must not be conflated in either direction.

Scheduled checks and notification remain deferred until a recipient is agreed.

## D6 · Sandbox residue — a separate investigation

C2 #7 recommended "stop sandbox products reaching the shared database". **That
was asserted, not established, and is withdrawn as a recommendation.** I inferred
the cause from two facts — dev and production share a database, and the Products
client is portal-aware — without tracing the actual write path.

It is now its own investigation, and its questions are:

1. What write path put sandbox-portal product ids into the production database?
   `pullFromHubSpot` from a dev session, a create, or something else?
2. What environment controls exist on that path today, and which apply?
3. Does anything in Nexus distinguish a row sourced from the sandbox from one
   sourced from production? (`hubspot_product_id` alone does not.)
4. Would the vocabulary change have any effect on it at all? **I do not believe
   it would**, and no claim in this proposal should rest on that.

**No residue is deleted.** The 29 rows stay exactly where they are until the
write path is understood; deleting evidence before the investigation would
remove the only record of how it happened.

## D7 · Decisions needed to release #593

Only three, and each is small:

| # | Decision | Blocks | Recommendation |
|---:|---|---|---|
| 1 | The two option values — label and internal value | Creating the options in both portals | `Ingestibles`/`Ingestibles`, `Topicals`/`Topicals`; label = value deliberately |
| 2 | The 8-field minimum, and that the 9 are held back | Applying `0129` | Approve the 8; add later by additive migration if wanted |
| 3 | Merging #593 itself | Nothing downstream — the PR creates no option and applies no migration | Merge when 1 and 2 are settled, or merge now and settle them before `0129` |

**#593 is releasable on its own.** It adds two inert mapping entries, one
command and one unapplied draft. Nothing it contains can change a product, a
quote or a classification.

Everything else in Appendices A–C is deferred and needs no decision now:
`Lubricants & Intimate Care`, `Turnkey`, `Finished Goods`, bulk, sourcing
arrangement, the residue investigation, monitoring, and the charge-defaults
table.

---
---

# Appendix E — Status of 0129, and the release sequence

**2026-09-15 · operational detail for release approval · nothing applied.**

## E1 · Is `0129` in the executable migration tree?

**The file is in the migration directory. It is not in the journal, and the
journal is what the migrator reads.** Both halves matter.

| | |
|---|---|
| Location | `drizzle/0129_draft_formulated_spec_schema.sql` — the directory `drizzle-kit migrate` is pointed at |
| Journal | **Absent from `drizzle/meta/_journal.json`** |
| How drizzle selects work | It reads the journal, takes `max(created_at)` from `drizzle.__drizzle_migrations`, and runs every JOURNAL ENTRY whose `when` exceeds it. It never lists the directory. |
| Does the deploy run it | **No.** `build` is `next build`; `prebuild` runs verifiers only. No build, deploy or CI step invokes `db:migrate`. Applying a migration is always a deliberate manual act. |

**Verified, not assumed:**

- `migration-history-trace` with `0129` present reports
  **`WOULD EXECUTE on a bare db:migrate: 0`**.
- Production holds **0 rows** for `product_types.id = 'leaf_formulated'`.
- `0049` and `0050` have sat unjournaled in the same directory for months and
  have never executed — the mechanism has a track record, not just a claim.

### "Pending", not "inert"

**Calling it an inert draft was wrong, and the correction matters.** Inert
suggests the file could not run. It can: it is excluded by the absence of one
JSON entry, and adding that entry — or running the SQL by hand — executes it.
The exclusion is a convention enforced by `verify:migration-index`, not a
property of the file.

**The accurate description is: `0129` is PENDING. It is written, reviewable,
excluded from automatic execution by journal absence, and one deliberate act
away from applying.**

## E2 · The release sequence

Each step is separately reversible, and no step is implied by the one before —
merging does not create an option, applying does not activate a schema.

| # | Step | Act | Reversible by |
|---:|---|---|---|
| 1 | **Merge #593** | `gh pr merge 593` | Revert commit |
| 2 | **Apply `0129`** | Add the journal entry, remove from `DRAFT_EXEMPT`, run `npm run db:migrate` | `DELETE` the one `product_types` row while unreferenced |
| 3 | **Activate the schema** | The three edits in E3 — a follow-up PR | Revert commit |
| 4 | **Create the HubSpot options** | In **both** portals | Hide the option; existing values persist |
| 5 | **Verify** | `npm run verify:product-type-vocabulary` → expect `UNMAPPED: none` and the two values gone from `AHEAD` | — |

**Between steps 1 and 3 nothing is broken and nothing is exposed.** No product
can carry either value until step 4, so the `SCHEMA_PENDING` window is
unreachable by any operator.

**Step 4 must be last.** Creating an option before step 3 puts products into
`SCHEMA_PENDING` — honest, but it offers no specification fields on a product
that has them.

## E3 · What moves the types to the real schema — three changes, not one

My earlier report said both types "still resolve to `SCHEMA_PENDING`" without
saying what would change that. It is **three edits, and one of them is a
migration that is easy to miss**:

| # | Change | File | Why |
|---:|---|---|---|
| 1 | `SpecSchemaId` gains `"formulated"` | `spec-schema-mapping.ts:23` | Today the union is `"primary" \| "secondary" \| "tertiary"`. `PinnedSpecSchema` is defined as `SpecSchemaId \| …`, so it widens automatically; `encodePinnedSchema` returns `resolution.schemaId` unchanged. |
| 2 | Two MAPPING entries: `"SCHEMA_PENDING"` → `"formulated"` | same file | The actual flip. |
| 3 | **A migration widening the `leaf_specs_spec_schema_values` CHECK** | new migration | **The one that is easy to miss.** |

> **E3 undercounted — see F1.** Building it found two more: the
> `SPEC_SCHEMA_PRODUCT_TYPE_ID` entry (caught by the compiler) and
> `decodePinnedSchema` recognising the new id (caught by nothing — it is a
> string comparison, so omitting it compiles and silently decodes a valid
> pin as `unmapped`). Five changes, not three.

### On change 3

`leaf_specs.spec_schema` carries a database CHECK:

```
CHECK (spec_schema IS NULL OR spec_schema = ANY (ARRAY[
  'primary','secondary','tertiary','no_schema','schema_pending','unmapped','no_type']))
```

`'formulated'` is not in it. **Without widening this constraint, the first
attachment of a formulated product is rejected by the database** — not by a
guard with a message, but by a constraint violation at write time.

It is a **widening** of an allowed set, so it is safe ahead of code by the
deployment-order rule: no deployed writer emits `'formulated'`, so nothing
existing is affected. It could be folded into step 2 or shipped with step 3;
either is fine, provided it precedes the first attachment.

### The snapshot table needs no change — checked

`quote_snapshot_leaf_specs.disposition` has its own CHECK
(`specified | no_schema | unmapped | no_type`), and `dispositionOf` returns
`"specified"` for any schema id it does not name specially. `'formulated'`
therefore snapshots as `specified`, which is already permitted. **No second
migration is required.**

> **Observation, out of scope and pre-existing:** the same fall-through sends
> `schema_pending` to `specified` as well, so a `Raw ingredients` product
> freezes into an order packet as "specified" when a schema is in fact owed.
> That affects the existing catalogue today, is unrelated to this proposal,
> and is not addressed here. Recorded so it is not lost.

## E4 · What is still on hold

Unchanged by this appendix: no merge, no migration applied, no HubSpot option
created, no reclassification, no default-rule seeding. Existing classifications
stay exactly as they are.

The charge-defaults table remains a separate proposal at
`docs/proposals/product-type-charge-defaults-table.sql`, carrying two
unresolved requirements to be addressed when its own PR opens:

1. **Quote selections must survive rule changes.** A quote's charge instances
   are the operator's; defaults are read only when composing suggestions for a
   component being added, never when rendering one already present.
2. **A missing rule must differ from a reviewed "no charges expected".** Three
   states, not two: no rule (nobody looked), reviewed-none (a finished answer),
   and rules present. Absence cannot carry a flag, so the second state needs
   its own representation.

No further work on that proposal now.

---
---

# Appendix F — Activation change, isolated results, production steps

**2026-09-15 · reviewed head on `feat/formulated-schema-activation` · production
unchanged.**

## F1 · The activation change — five edits, not three

E3 named three. Building it found **two more**, and one of them the type system
cannot catch.

| # | Change | Found by | Note |
|---:|---|---|---|
| 1 | `SpecSchemaId` gains `"formulated"` | named in E3 | `PinnedSpecSchema` widens with it; `encodePinnedSchema` unchanged |
| 2 | Two `MAPPING` entries → `"formulated"` | named in E3 | the flip itself |
| 3 | `0130` widens the `leaf_specs.spec_schema` CHECK | named in E3 | without it the first attachment is a constraint violation |
| 4 | `SPEC_SCHEMA_PRODUCT_TYPE_ID` gains `formulated: "leaf_formulated"` | **the compiler** | `Record<SpecSchemaId, string>` is total, so this failed to build |
| 5 | `decodePinnedSchema` must recognise the new id | **nothing** | see below |

### On #5 — the one nothing catches

`decodePinnedSchema` selected schema ids with a string comparison:

```ts
if (stored === "primary" || stored === "secondary" || stored === "tertiary")
```

Omitting `"formulated"` **compiles cleanly**. A stored `formulated` pin would
decode as `unmapped` — a persisted, valid schema silently becoming "nobody has
looked at this category", which is exactly the distinction the four resolution
kinds exist to preserve.

It is now derived from the id map (`stored in SPEC_SCHEMA_PRODUCT_TYPE_ID`), so
adding a schema cannot leave it behind. The walk asserts the round trip
explicitly rather than trusting the change.

A sixth, unprompted: `SPEC_SCHEMA_PRODUCT_TYPE_ID` was declared below its new
use site. Legal — the function body runs after module init — but a const
referenced above its declaration is the TDZ shape that has produced a
page-load failure in this repo before, so it was hoisted.

## F2 · Isolated verification

`npm run validation:formulated-schema-walk` — **28 checks, all passing, twice
in succession from a clean state.**

| Section | Established |
|---|---|
| 0 · migrations | `0129` inserts the 8-field row. **Before `0130`, the database REFUSES a `formulated` pin with `check_violation`** — the requirement is demonstrated, not asserted. `0130` then permits it. |
| 1 · existing pins | Signature of every pre-existing spec row captured before anything moves |
| 2 · resolution | Both values → `formulated`; encode → `"formulated"`; **decode → schema, not `unmapped`** (the #5 trap) |
| 3 · attach · pin · edit | Both pins accepted by the database; specs edited and read back; pin survives the edit; provenance records the originating type |
| 4 · freeze · read back | Both freeze; read back as `specified`, which the snapshot CHECK permits; carrying the `formulated` pin and the authored values |
| 5 · existing pins | **No pre-existing spec row changed**, and none was rewritten; cleanup restores the original signature exactly |

### Two things the walk itself had to be fixed for

**It was not repeatable.** It applied `0130` and never reverted, so on a second
run the CHECK was already widened and the most important assertion — that the
database refuses a `formulated` pin — passed trivially. It now restores the
pre-migration CHECK and removes the schema row at cleanup, and purges residue
at start, so a crashed run cannot poison the next.

**Frozen spec rows refused a direct delete.** `quote_snapshot_leaf_specs` is
immutable — it records what was ordered on a sent offer, and is removed only by
cascade from its snapshot. That is the guard working; the cleanup now cascades.

## F3 · Corrected release sequence

**Migrations first. Code second. Options last.** Explicitly:

| # | Step | Act |
|---:|---|---|
| **1** | **Apply both migrations** | `npm run db:migrate` — nothing else. Both are **journaled in the reviewed commit**, so there is no edit to the journal or to any verifier allowlist at release time. The pending set is exactly `0129` then `0130`, verified against production. **Nothing runs these automatically** — not build, not deploy, not CI. |
| **1a** | Verify the schema row and the CHECK | `product_types.id = 'leaf_formulated'` exists with 8 fields; the CHECK lists `formulated` |
| **2** | **Deploy and verify the activation code** | Merge this PR. Then confirm on production that `resolveSpecSchema('Ingestibles')` is reachable — no product can carry it yet, so this verifies deployment, not behaviour |
| **3** | **Only then create the HubSpot options** | Both portals: label `Ingestibles`/value `Ingestibles`, label `Topicals`/value `Topicals` |
| **4** | Verify by portal | See F4 |

**Why this order and not another.** Between 1 and 2 the database accepts a
value no code emits — harmless. Between 2 and 3 the code resolves a value no
product carries — also harmless. Reverse 1 and 2 and the first attachment after
an option is created hits a constraint violation instead of working.

**Reversal at each point:** step 1 — delete the row, restore the CHECK (both
safe while no product carries the values); step 2 — revert the commit; step 3 —
hide the option, existing values persist.

## F4 · Vocabulary-check expectation, by portal

**The expected end state is NOT "green".** Stated per portal so nobody reads a
red exit as a failure of this work, and so nobody makes it green by hiding
something.

| Portal | Before step 3 | After step 3 | Exit |
|---|---|---|---|
| **production** | `UNMAPPED: none` · `AHEAD: 2` — `Ingestibles`, `Topicals` | **`UNMAPPED: none` · `AHEAD: none`** | contributes 0 failures |
| **sandbox** | `UNMAPPED: 2` — `Corrugated`, `Preliminary` · `AHEAD: 5` | **`UNMAPPED: 2` — unchanged** · `AHEAD: 3` | **contributes 2 failures — the script exits 1** |

**The script will still exit non-zero after a fully successful release, and
that is correct.** `Corrugated` and `Preliminary` are pre-existing, unrelated,
and the subject of the separate residue investigation (D6). They are **not** to
be disposed in `MAPPING` to obtain a green run: that would legitimise
sandbox-only values as production classifications and hide the finding.

**Verify the two new values independently of that**, by reading the production
section alone:

- production `UNMAPPED` must be `none` — and it must have been `none` before as
  well, so this alone proves little;
- production `AHEAD` must go from listing both values to listing **neither**.
  That transition is the evidence the options were created and are mapped, and
  it is unaffected by anything in the sandbox section.

## F5 · Tracked separately

`docs/audit-findings/DEFECT-2026-09-15-schema-pending-freezes-as-specified.md`

`dispositionOf` falls through to `specified` for any pin it does not name, so a
`schema_pending` product freezes into an order packet as though it carried a
specification. **52 `Raw ingredients` products are affected today.** Same shape
as a bug already fixed once in `encodePinnedSchema`, whose fall-through was
replaced with an exhaustive switch; `dispositionOf` still has the original
form.

Not fixed here: the disposition vocabulary and its CHECK permit four values, so
fixing it means adding a fifth or choosing among the four for historical
records. Both need their own review, and neither belongs in a gap-fill.

The `formulated` path is unaffected — it falls through to `specified`, which is
correct for a product that does carry a specification.

## F6 · Still on hold

No merge, no production migration, no HubSpot option, no reclassification, no
default-rule seeding. Existing classifications unchanged. The charge-defaults
table remains separate with its two unresolved requirements.
