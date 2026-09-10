# OD-032 · Owner-attributed one-time charges

**Design round trip — closed Aug 26, 2026. No implementation until beta clean-pair closure.**

Packaging components can own the one-time charges they cause. Recovery placement stays a
separate decision, made in Commercial Recovery, per charge instance.

Principle under test: *the charge belongs to the commercial object that caused it; recovery
placement is a separate decision.* The principle holds and is already the model's grain.

---

## Read this first

`design/Nexus OD-032 Round Trip.standalone.html` — open in a browser. It is the round trip
itself: the argument, the recommended V1 UX drawn in three states (select types → enter
economics → owned rows), the recovery-grain design, the data model, deferrals and open
ambiguity. Everything below is a summary of it.

---

## Outcome

| | |
|---|---|
| **Verdict** | Direction holds. |
| **Blocker check** | No blocker. One amendment required to `costs-page-layout` §1/§9. |
| **Sequencing** | Additive to Costs and Recovery. Beta closure unaffected. |

### V1 disposition (CA)

**Take** — component ownership · two-phase selector→economics sheet · suggested, never
pre-checked · instance-grained recovery · group recovery actions · quote-specific amounts
(library holds types only) · Project setup vs Run setup as distinct types · type→NetSuite
destination mapping.

**Hold** — historical suggestion ranking · item-group ownership · per-charge attachments ·
automatic Other graduation · mandatory copy reconfirmation (retracted, not deferred).

**Resolved during the round trip** — Artwork & prepress economic grain (§02a) · schema
extension rather than replacement (§06).

---

## Ownership model

Owner is a polymorphic reference, **never nullable**. **Three v1 types as of
2026-08-27** — `item_group` was promoted out of Deferred at the Phase 3 stop:

- `owner.type = quote` — genuinely engagement-caused. No population qualifies today.
- `owner.type = component_attachment` — **new.** The packaging leaf on *this quote*.
- `owner.type = item_group` — **v1, not deferred.** Existing Production one-time
  charges, governed by BV-012 §1.a: *"Production costs belong to the Item Group
  itself. They do not belong to an arbitrary packaging component underneath it."*

> **Amended 2026-08-27 (Edward, Phase 3 disposition B).** This section previously
> deferred `item_group` and sent existing Production charges to `quote`. Both were
> wrong: BV-012 is an approved governing rule confirmed with Accounting, and every
> existing one-time charge is Production economics stored against an assembly.
> Grouping them under Project would detach them from the object that incurs them.
>
> The deferral reasoning — *"no demand until a charge is genuinely caused by an
> assembly rather than a component in it"* — described a demand that was already
> present and unrecognised.
>
> **If the Item Group caused the charge, Project is not its causal owner.** A
> Project → Item Group nesting used merely to keep both prior documents true is
> explicitly rejected.

Rejected: **item group** as the packaging owner (too coarse — cannot say which of two cartons
caused a plate, and swapping a component silently reassigns the charge). **Library definition**
(wrong layer — the library catalogues what exists; a charge records what a project incurred).

Component-only ownership was also rejected: if it were the only type, operators would hang
freight off an arbitrary carton to make the form accept it, and that lie would survive to
NetSuite.

### Amendment required — `context/costs-page-layout.md` §1 and §9

That document's load-bearing claim is *"per-unit costs have a SKU dimension; one-time costs
don't — that is why the one-time section appears once at the foot."* Half of it stops being
true: an owned charge has an owner dimension. The economy survives — the section's rows were
always lines rather than SKUs and it already carries the tier grid. Narrow correction:

> Rows group under their owner. The section still appears once. Tier column x-positions are
> unchanged. Quote-owned charges group under a **Project** heading — the honest name for what
> that section has always held.

---

## V1 charge vocabulary

Six governed types. A type earns its place by having a distinct cause, a distinct NetSuite
destination and a distinct recovery policy.

| Type | Cause it records | Owner | Allowed recovery |
|---|---|---|---|
| Print plates | Plate or cylinder making for this component's artwork | component | unit / fee |
| Tooling & dies | Cutting dies, moulds, collars specific to this component's geometry | component | all three |
| Artwork & prepress | Design, adaptation and proofing labour — bought once per component | component | unit / absorbed |
| Run setup | Press or line setup attributable to this component's run | component | all three |
| Project setup | Engagement-level setup — a different commercial fact | **quote only** | unit / fee |
| Samples & proofs | Pre-production samples of this component | component | all three |
| Other · labelled | Anything else — operator label required, type-ahead against prior labels | either | all three |

### Changes from the proposed eight

- **Cartons — rejected.** A carton is a component with a per-unit cost. Listed as a charge it
  gets counted twice, and the second copy is invisible in the cost stack. If the real gap is
  "master carton isn't modelled as a component," fix it in components.
- **Processing fee — deferred to Other.** A type that means anything absorbs everything and has
  no destination mapping worth having. Let it arrive through Other; if it earns volume it
  graduates with a definition someone had to write.
- **Print plates ∥ Artwork / plates — collision resolved.** Two types containing "plates" is a
  coin flip at entry and unreconcilable in reporting. Split by what is bought: Print plates is
  plate and cylinder making; Artwork & prepress is design and adaptation labour.
- **Setup — split.** Run setup (component) and Project setup (quote). Owner type restricts
  which appears where, so they cannot recollapse at entry.
- **Other — kept as the measuring instrument.** Label frequency reviewed quarterly; a label
  clearing a threshold graduates into a governed type. The vocabulary earns growth instead of
  being guessed at now.

### §02a — Artwork & prepress is `one_time`

The per-SKU reading was an inherited inconsistency, not a proposed one. Today's
`Artwork & plate · per SKU · 3 SKUs` exists *because* the charge had no owner: adaptation
labour is bought once per component, so with no component to own it, a per-SKU multiplier on
one quote-level row was the only way to express "three cartons' worth."

```
today                          under owner attribution
1 charge · quote-owned    →    3 charges · component-owned
basis per_sku × 3              basis one_time each
$380 → $1,140                  $380 · $380 · $380
```

**Rule: every component-owned charge has basis `one_time`. No exceptions, and the sheet never
asks** — the screen is called Add one-time charges and it means it. `per_sku` survives only on
quote-owned legacy rows and should be treated as deprecated; every case it currently expresses
is a component-owned charge that had no owner. A genuinely recurring per-SKU artwork cost would
be a per-unit cost belonging in the packaging cost stack, not a charge — separate finding.

---

## Recommended V1 UX

Neither pure checkbox-menu nor pure add-row. The operator's real motion is *"this carton causes
plates, dies and samples"* — one thought, three charges. Add-row makes that three trips through
a modal; a checkbox menu alone leaves three rows with no economics and no prompt to finish them.

**Entry point.** The packaging row's `···` menu → **Add one-time charges**. Once the component
owns any, the row carries a `3 charges · $3,180` affordance.

**Phase 1 · select types.** Multi-select checklist, no economics asked. Up to three suggestion
chips from product type ("Common on secondary packaging: Print plates, Tooling & dies, Samples
& proofs") — **never pre-checked.** A pre-checked box is how a phantom charge reaches a customer
document with nobody having decided it. Suggestion is a prompt; selection is an act.

**Phase 2 · enter economics.** One staging table, all selected rows priced together: cost per
tier, recovery ask, fixed `one-time` basis. Recovery placement is **not** asked here — rows
arrive in Commercial Recovery as `unplaced` and the send checklist holds until each has a
placement. Asking here would fuse the two decisions the model keeps apart.

> ### ⚠️ SUPERSEDED IN PART — `recovery ask` is removed from Costs (Edward, 2026-08-29)
>
> **`cost per tier` and the fixed `one-time` basis stand. The operator-authored
> `recovery ask` does not.** Costs captures **cost only**; recovery is derived in
> Pricing from the charge type's governed markup category.
>
> **The governing rule.** Pricing authority follows **charge type**. The owner does
> not determine markup. A charge type with no governed category remains **unpriced
> and unsendable** rather than silently defaulting — BV-013, unchanged.
>
> **Why the ask could not stay.** It was a manually typed number that the model
> nonetheless carried in a field named `governedRecovery`
> (`commercial-recovery/frozen-instruction.ts`). The name asserted a governance the
> value did not have. `componentChargeEconomics` recorded this honestly —
> `rateCategory: null, ratePct: null`, with the comment *"the rate is the operator's
> ask, not a category default"* — which states the gap rather than closing it.
>
> **Nothing installed is being taken away.** Verified against the live database
> 2026-08-29: **zero** `quote_charge_instance_tiers` rows carry a non-null
> `recovery_ask`; the two component-owned charge instances that exist are both on one
> **draft** quote; **zero** frozen recovery instructions are component-owned. An
> interim that preserved the field would have preserved a behaviour no quote uses.
>
> **This note exists so the change is not silent.** The Phase 2 language above is the
> Design Authority (tier 3) and a tier-1 business disposition outranks it — the same
> relationship, and the same way of recording it, as the BV-011 supersession in
> `commercial-recovery/registry.ts`. The prototype's own screens are unchanged and
> still show the ask; read this note, not the pixels, for the Phase 2 economics
> contract.
>
> **The commercial half SHIPPED** (PR #501, `58a83ef`). Charge type is the markup
> authority, and the full mapping is governed:
>
> | charge type | markup authority |
> |---|---|
> | `tooling` | Tooling 0.20 |
> | `print_plates` | Tooling 0.20 |
> | `artwork_plate` *(prepress labour, and proofs)* | Manufacturing 0.30 |
> | `samples` *(was `samples_proofs`)* | Manufacturing 0.30 |
> | `other_service` | **deliberately unmapped** — unpriced and unsendable |
>
> `samples_proofs` was split rather than mapped: one key cannot carry two markup
> authorities, since samples are physical pre-production goods and proofs are prepress
> labour. Proofs fold into `artwork_plate`, which already carries that authority and the
> same accounting destination. Migration `0115`.
>
> **What still blocks implementation is the OTHER axis.** Component charges carry **no
> BV-011 accounting destination** — the projection records `null` for every one of them,
> so they are unsendable to NetSuite regardless of being priced. That axis is governed by
> [`BV-014`](../../business-validation/BV-014-component-charge-accounting-destination.md)
> and is **externally blocked on Accounting**: two NetSuite items to create and map, the
> Tooling-versus-Dies question, and the `otc_tooling` item-type question. Markup authority
> and accounting destination are separate axes and neither may be inferred from the other.

**After.** Ordinary rows nested under the component, edited in place, no return to the sheet.

**Guards.** Selecting a type the component already owns warns and offers a second instance with
a distinct label required — a warning, not a block; two dies on one carton is a real thing.
Deleting the owning component asks about its charges by name and total before taking them.

**Home.** Charges are enterable from Setup but they are cost facts, so Costs remains their home:
nested under the owning component, contributing to the same tier grid. Setup gets the entry
point because that is where the operator is looking at the carton.

---

## Recovery grain

**Per charge instance, always.** Print plates on Carton A must be able to differ from Print
plates on Carton B — two charges, two causes, and one may be absorbed as a concession. Rolling
recovery up by type would make that concession unrepresentable.

**Plus a group action** — "Set all Print plates → One-time fee". Grain per instance, ergonomics
per group. Without it, uniform quotes cost one click per charge, and the operator's shortcut
becomes absorbing things to make the rail quiet: a margin event chosen for interface reasons.

Allowed modes come from the charge type (permission), evaluated per instance. Existing statutory
and policy refusals persist unchanged.

---

## Downstream semantics

**Customer document.** Attribution is internal. The line prints as its type name — "Print plates
· $1,750". Disambiguate with the owner name only on collision: two same-type charges both
printing become "Print plates · Kids' Cough carton". The existing rule survives untouched —
turning the itemization off folds charges into the fee sentence and never erases them
(`context/cp-customer-presentation-designer-notes` §5 reasoning).

**Margin.** Formula unchanged; owned charges enter cost and recovery exactly as today. What
changes is the likeliest source of drift — component-level absorption is now easy to do five
times in one quote, each adding cost with no revenue. The margin footer should gain one
attribution line ("$2,280 absorbed across 4 component charges") so a floor breach names its
cause instead of merely announcing itself.

**Freeze.** Charges freeze with the version, including owner reference and placement. On a
frozen quote the owning component cannot be removed. On a draft it can, and the confirm lists
the charges by name and total first. A charge is never orphaned and never silently retained
against a component that no longer exists.

**Copy — retracted position.** The earlier recommendation (carry the amount, block freeze until
re-confirmed) is **withdrawn.** It invents a lifecycle gate this change has not earned. Copy is
commercially equivalent to its source, so packaging charges carry exactly like every other
copied cost and the operator edits them as normal. Component costs, freight and tooling already
carry without ceremony; singling this family out is special pleading. Evidence that these go
stale differently would be evidence for a gate across copied economics generally.

**Revise.** V2 carries charges silently — same lineage, same agreement being amended. If the
operator swaps the owning component, its charges do **not** migrate to the replacement: they are
dropped with notice. That is what "the charge belongs to the object that caused it" costs, and
paying it is correct — a plate for the old carton is not a plate for the new one.

**NetSuite.** Destination maps on **charge type**, never on owner. Owner travels as memo text on
the line. Key on owner and the mapping table multiplies with every component the catalogue
gains, maintained by nobody. `Other` has no governed destination, so it maps to a default and
raises the existing unmatched pre-send flag rather than inventing a second mechanism.

---

## Data model — target shape, not a subsystem to build

**Read as the shape the existing model needs to reach; engineering chooses the route.** Nexus
already carries governed recovery, approval voiding, freeze and NetSuite mapping against the
existing `(quote, charge_key)` grain — infrastructure that took rounds to get right and that
nothing here disputes. The design's actual requirements are three, all additive:

1. **An owner reference on the charge** — the one genuinely new field. Existing rows migrate to
   `owner = quote`, which is what they already mean.
2. **Instance grain instead of key grain** — `charge_key` becomes a type reference and stops
   being the identity. The one change with real reach: recovery, freeze and the send checklist
   all address charges by key today.
3. **A charge-type registry with a template map** — the only wholly new table, holding no
   economics, therefore no migration risk.

If instance grain is reachable by widening the existing key rather than replacing it, that is a
better answer than the table below and the design does not care which is chosen.

```
charge                                        -- quote-scoped fact, never library-scoped
  id, quote_id, quote_version
  owner            { type: "quote" | "component_attachment", id }   NOT NULL
  charge_type_id   -> charge_type                                  NOT NULL
  label            required when type = other, else optional override
  basis            one_time always when owner.type = component_attachment
                   per_shipment | per_sku | per_unit only on quote-owned legacy rows
                   -- per_sku is deprecated: see §02a
  cost_amounts     { [tier_id]: money }        operator-entered per tier, no derivation
  recovery_ask     { [tier_id]: money }        pricing-governed approved recovery
  recovery_mode    included | separate | absorbed | null   -- null = unplaced, blocks send
  source           { origin: "operator" | "carried_from", ref }
  created_by, created_at, frozen_with_version

charge_type                                   -- governed, admin-maintained
  id, name, default_basis
  allowed_modes[]                             permission, not a decision
  allowed_owner_types[]                       e.g. project setup: ["quote"]
  netsuite_destination                        nullable only for "other"
  active

library_charge_template                       -- memory of shape, never of money
  scope { product_type | library_item_id }
  charge_type_id[]                            suggestion source for the sheet
  -- no amount. no recovery_mode. ever.
```

### Two fields that must never exist

- `library_charge_template.amount` — the library remembers types. The moment it remembers a
  dollar, that dollar gets treated as canonical and quotes stop being the record of what was
  agreed.
- `charge_type.default_recovery_mode` — a default placement is a placement nobody made. Types
  carry *permission*; instances carry the decision. The principle expressed as a constraint.

---

## Deferred

| Item | Why it can wait |
|---|---|
| ~~Item-group ownership~~ | **PROMOTED TO V1, 2026-08-27.** The demand was already present: BV-012 governs it and the entire existing one-time population is stored against an assembly. See the Ownership model above. |
| History-based suggestion ranking | V1 suggests from a static product-type map. Ranking needs volume to beat it, and a wrong suggestion costs more than none. |
| Per-charge attachments | Plate proofs and die specs will want to hang off the charge. Quote-level attachments cover it badly but adequately. |
| Other → type graduation tooling | Manual quarterly review is enough at V1 volume. Automating promotion before anyone has read the labels would govern an unseen vocabulary. |
| Split ownership of one charge | One charge, one owner. Two cartons sharing a plate set is two charges or one quote-level charge. A split field would let attribution be approximated. |
| Customer-facing owner grouping | Opt-in "group charges by component on the PDF" is plausible for many-component customers. Grouping by nature is right far more often. |
| Copy reconfirmation gate | **Retracted**, not deferred. See Copy above. |

---

## Open governance & training ambiguity

**Is absorbing a charge an act that needs approving, or only a result?** Today only the result
is governed: margin falls below floor, approval is required. Absorption of a $1,180 die at a
healthy margin passes with nobody informed — and owner-attributed charges make that a
five-times-a-quote possibility rather than an occasional one. Result-governance is still the
recommendation (governing the act would put pricing in every packaging decision), but the
exposure is genuinely larger than the current policy was written against, and someone should say
so out loud before V1 ships. See `context/approval-states-design-position.md`.

**Template memory will be read as price memory.** The sharpest risk in the whole change. An
operator who sees the library suggest "Print plates" will expect it to know what plates cost and
will trust whatever number appears next. Mitigation is copy carrying the constraint in the sheet
itself — *the library remembers types; amounts are entered per quote, every time* — and never
showing a prior amount as a prefill, **not even greyed. A greyed prefill is a prefill.**

**Other labels will fragment.** "Foil die", "foil stamping die", "Foil Die - carton" are one
type spelled three ways and they arrive within a month. Type-ahead against prior labels at entry
is most of the fix; the rest is accepting that Other's job is to be messy and legible, so its
labels can be read and promoted rather than trusted as data.

**Chart of accounts.** Run setup and Project setup each need a destination. Accounting task, not
an open design question.

---

## Files

**`design/`**
- `Nexus OD-032 Round Trip.standalone.html` — **start here.** Self-contained; open in a browser.
  The three UX phases are switchable in the Preview row of §03.
- `Nexus OD-032 Round Trip.dc.html` — source of the above.
- `support.js` — the prototype's rendering runtime. Present so the standalone can be traced;
  not for porting.

**`context/`** — what the round trip was argued against.
- `current-prod-setup-screen.png` — production Setup screen the entry point attaches to.
- `costs-page-layout.md` — **the amendment target.** §1 and §9 carry the claim that needs
  correcting.
- `costs-multi-sku-design-review.md` — why the one-time family is section-major and why the
  majority quote is one SKU plus a pile of one-time costs.
- `cp-customer-presentation-rev1-authority-model.md` — the authority split this change must not
  violate: recovery moves economics, presentation never does.
- `cp-customer-presentation-data-source-map.md` — field-level ownership for the customer
  document, including the fee-fold behaviour.
- `approval-states-design-position.md` — the position on approval states; relevant to the open
  absorption-governance question.
- `Nexus Customer View.dc.html` — the Commercial Recovery surface these charges arrive in.

---

## Status

**Phases 1, 1b and 2 shipped** — instance identity, component-owned storage, registry and
costing input. Legacy population proved byte-identical throughout.

**Phase 3 (Costs owner grouping) is STOPPED pending a Costs-specific design round trip**,
per `docs/validation/od-032-phase-3-costs-grouping-mapping.md`. Two conflicts:

1. **There is no one-time Costs section to group.** This bundle never draws the Costs
   region — all three §03 states are drawn on **Setup**. The shipped Costs page composes
   Packaging, Production and Freight; one-time charges live inside Production and
   duty/customs inside Freight.
2. **BV-012 against the two-type owner model** — resolved by disposition B above.

**Phase 4 (the authoring sheet) is blocked** until the Costs destination is visually and
semantically settled.

### V1 scope constraint — recorded 2026-08-27 (Edward)

The Phase 3 solution is **not** the permanent Costs-page architecture. For V1 it optimises
for correct ownership, understandable placement, and **minimum disruption to the certified
Costs workflow**.

A dedicated post-V1 Costs redesign is expected, and it reconsiders the page as one system —
Packaging, Production, Freight, landed costs, Project charges, Item Group charges and
component-owned charges together. OD-032 must not redesign those regions incrementally now.

So the Costs design answers *"where can these new charges live clearly and correctly in the
existing V1 Costs page?"* — **not** *"what should the ideal future Costs page look like?"*
Every V1 compromise is recorded explicitly so it becomes an input to that later redesign
rather than accidental permanent architecture.
