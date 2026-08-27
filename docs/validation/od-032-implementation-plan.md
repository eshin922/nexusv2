# OD-032 · Owner-attributed one-time charges — implementation plan

**Planning only. No implementation.** Written against the Design Authority in
[`docs/design-prototypes/od-032/`](../design-prototypes/od-032/), mapped onto the
certified architecture on baseline `3558e09`.

**AMENDED 2026-08-27** with Edward's five Phase 0 dispositions. Each is recorded
at the point it governs, and the amended sequence is §13. What changed from the
first draft:

| # | Disposition | Effect on this plan |
|---|---|---|
| 1 | Legacy `owner_ref` is never presented as causal | §2.2 hardens from recommendation to **rule** |
| 2 | Never rename `artwork_plate` in place | §3 hardens; add alongside only if a distinct meaning is required |
| 3 | Run setup is **not** a blocker | **removed from V1**; §3, §12, §13 revised |
| 4 | Generated charge-instance id is the identity | §2.1 **corrected** — the first draft was wrong |
| 5 | Bundle committed under `docs/design-prototypes/od-032/` | all references updated |
| **0(b)** | **One identity regime — elections key to `charge_instance_id`** | §2.1 **decided**; §13 phase 1 revised |
| **0(a)** | **`costs-page-layout` §1/§9 amended before UI work** | approved; phase 0 |

The invariant this plan preserves throughout:

> **Ownership answers what caused the charge; recovery answers how the customer
> pays it.**

---

# 0 · The headline, before the detail

Two findings decide the shape of this work, and both are good news for scope.

**The owner grain the design asks for already exists downstream.** Every placed
charge is already attributed to `(ownerRef, tierId)` by
`ownedPlacedCharges()`, and the frozen instruction table is already `UNIQUE
(quote_snapshot_id, charge_key, owner_ref, tier_id)`. **The only layer at
`(quote_id, charge_key)` grain is the live election table.** So the design's
requirement 2 — instance grain — is reachable by *widening the existing key*,
which is exactly the route the round trip said it would prefer.

**But today's `owner_ref` is not a causal owner, and OD-032 would make it one.**
That is the finding that needs surfacing before code, and it is in §2.

---

# 1 · Current → target data model

## 1.1 What exists today

```
recovery_charge (enum, 9)      container_freight · duty_tariffs · tooling ·
                               project_setup · artwork_plate · rd_formulation ·
                               testing_micros · other_service ·
                               tooling_artwork_legacy

registry.ts ChargePolicy       key · label · grain(landed|one_time) ·
                               source[] · available[] · refusals{}

SOURCE of every one-time charge assembly_production_inputs.{tooling_total,
                               setup_fee_total, artwork_total, rd_total,
                               testing_micros_total, other_service_total,
                               tooling_artwork_total}

quote_charge_recovery          PK (quote_id, charge_key)        ← no owner
quote_snapshot_recovery_       UNIQUE (snapshot, charge_key,
  instructions                          owner_ref, tier_id)     ← owner present

construct.ts                   ChargeEconomicsInput{ chargeKey, cost,
                               recoverableSell, ownerKind? }
                               → PlacedCharge{ ..., ownerKind, source }
                               → ownedPlacedCharges() ⇒ {ownerRef, tierId, charge}

bv011-destinations.ts          16 destinations; OTC_COLUMN_DESTINATION maps 5
                               otc_print_plates / otc_dies / otc_samples /
                               otc_cartons / otc_processing_fee have NO source
```

## 1.2 The three additive requirements, mapped

The round trip names three requirements and says engineering picks the route.

| # | Design requirement | Route recommended here |
|---|---|---|
| 1 | An owner reference on the charge | **Already present downstream.** New: make it causal and carry it on the live election. |
| 2 | Instance grain instead of key grain | **Widen the existing key**, do not replace the model. |
| 3 | A charge-type registry with a template map | **New tables**, but smaller than the design's — the registry largely exists as `registry.ts`. |

## 1.3 Proposed migrations

**M1 · widen the live election to the grain the snapshot already has.**

```sql
-- quote_charge_recovery: (quote_id, charge_key) → (quote_id, charge_key, owner_ref)
ALTER TABLE quote_charge_recovery ADD COLUMN owner_ref text;
UPDATE quote_charge_recovery SET owner_ref = '@quote';         -- what they already mean
ALTER TABLE quote_charge_recovery ALTER COLUMN owner_ref SET NOT NULL;
-- drop + recreate PK on (quote_id, charge_key, owner_ref)
```

`'@quote'` is a sentinel, not a uuid, and that is deliberate: it distinguishes
"quote-owned" from "owned by an entity that happens to have this id" without a
nullable column. Nullable owner is the state the design explicitly rejects.

Per the amended migration-order rule: this is a **tightening** migration
(`SET NOT NULL` + PK change), so it needs a deployed-writer compatibility proof
and should ship expand → backfill → validate → contract rather than in one step.

**M2 · component-owned charge storage — a new table.**

Component-owned charges cannot live on `assembly_production_inputs`. That table's
owner is an XOR (`assembly_id` | `quote_leaf_id`) whose `owner_commercial_kind`
is a **generated** column forcing `'service'` whenever the leaf arm is used — so
the leaf arm is reserved for Direct Services and cannot express "packaging
component". Reusing it would require dropping a generated column that currently
makes a wrong value unrepresentable.

```
quote_leaf_charges                       -- component-owned, quote-scoped
  id
  quote_id            NOT NULL
  quote_leaf_id       NOT NULL           -- THE causal owner
  charge_type         recovery_charge    -- widened enum, §3
  label               text               -- required when charge_type = 'other'
  sort_order          integer
  created_by, created_at

quote_leaf_charge_tiers                  -- per (charge, tier) economics
  quote_leaf_charge_id, tier_id
  cost_amount         numeric(12,2)
  recovery_ask        numeric(12,2)
```

Basis is **not a column.** The design's rule is absolute — *"every
component-owned charge has basis `one_time`. No exceptions, and the sheet never
asks"* — so a column would be a field that can only hold one value and can
therefore one day hold another.

**M3 · the suggestion template.** One table, no economics:

```
library_charge_template
  scope_kind { product_type | leaf }, scope_ref, charge_type
```

The two forbidden fields (`amount`, `default_recovery_mode`) are absent by
construction and should carry a CHECK-level or comment-level statement of *why*,
because their absence is load-bearing rather than incidental.

---

# 2 · Charge-instance identity and owner grain — and the conflict to surface

## 2.1 The identity — CORRECTED per disposition 4

**The durable identity is a generated `charge_instance_id`.** The first draft of
this plan proposed making `(quote, type, owner, label)` the key. That was wrong,
and the disposition names exactly why:

> *Two same-type charges on one component must remain independently editable
> even if labels change.*

A natural key containing `label` makes the row's identity depend on a value the
operator edits. Renaming "foil die" to "foil stamping die" would then be an
identity change — which means the recovery election keyed to it, the frozen
instruction referencing it and the NetSuite memo describing it all point at a
row that no longer exists under that name. The failure is silent and it lands in
an already-sent artifact.

```
charge instance   =  charge_instance_id            generated, opaque, durable
business uniqueness  (quote, owner, type, label)   a CONSTRAINT, not the identity
recovery grain    =  charge_instance_id
freeze grain      =  (snapshot, charge_key, owner_ref, tier_id)   -- unchanged
```

**Uniqueness stays**, because the design wants duplicate *detection*: selecting a
type the component already owns *"warns and offers a second instance with a
distinct label required — a warning, not a block"*. That is a `UNIQUE (quote_id,
owner_ref, charge_type, label)` constraint serving the warning, with the row's
identity independent of it.

**Consequence for the election table.** §1.3 M1 widens the live election to
`(quote_id, charge_key, owner_ref)`, which is right for the legacy population
whose charges have no instance row. Component-owned charges elect against
`charge_instance_id` instead. Two options, and the choice is a real one:

- **(a) one election table, nullable `charge_instance_id`** — legacy rows carry
  `NULL`, component rows carry the id. Simple, but reintroduces a nullable
  discriminator of exactly the kind the design rejected for owner.
- **(b) elections keyed on `charge_instance_id` for every population**, with
  legacy charges given synthesised instance rows at migration time.

**DECIDED — option (b), Edward 2026-08-27.** One identity regime:

> Recovery elections key to `charge_instance_id` for both existing and new
> charges. **Do not introduce a permanent nullable discriminator that preserves
> two identity models.**

### The legacy synthesis, and the one thing it must not touch

```
for each existing (quote_id, charge_key) commercial fact
    → one stable synthesised charge instance
        charge_instance_id   generated
        owner_ref            '@quote'          ALWAYS, never today's owner_ref
        charge_type          the existing charge_key
    → the existing election migrates onto that instance
```

**The synthesised identity is derived from `(quote_id, charge_key)` and nothing
else.** It does *not* read today's coerced `owner_ref`, and its causal ownership
is fixed at `'@quote'`. That is the disposition's load-bearing clause and the
reason it is worth stating twice:

> **OD-028 anchor movement must therefore have no ability to change election
> identity.**

Because synthesis never consults the anchor, an anchor that moves between a
quote and its copy moves nothing that an election is keyed to. OD-028 stays
exactly where it is — a display and coaching concern — and OD-032 cannot pull it
forward by accident. This is asserted in §12, not merely intended.

### The one nullable that is unavoidable, and why it is not the prohibited one

`quote_snapshot_recovery_instructions` rows written **before** this migration
have no instance to reference, and they are frozen — they may not be backfilled,
because they are the record of what Accounting was told. So a
`charge_instance_id` on the snapshot table is necessarily nullable **for
historical rows only**.

That is not the thing the disposition prohibits. The prohibition is on a
nullable discriminator that *preserves two identity models going forward* — a
column the live system keeps consulting to decide which regime a row belongs to.
This one is the opposite: it is nullable only where history cannot be rewritten,
every row written after phase 1 carries an instance, and nothing reads the null
to choose behaviour. Recommend a comment on the column saying exactly that, so a
future reader does not "tidy" it into a discriminator.

**Freeze keying is unchanged.** Snapshot rows keep
`(snapshot, charge_key, owner_ref, tier_id)` as their uniqueness, with the
instance id carried alongside as the durable link. Changing the freeze key is
not required by anything here and would rewrite the shape of an already-certified
artifact.

## 2.2 ⚠ The conflict — OD-032 makes OD-028 commercially load-bearing

**This is the one thing in this plan that must be decided before code, and it is
surfaced rather than resolved, per the standing instruction.**

Today `owner_ref` on the frozen instruction is populated from
`ownedPlacedCharges()` as `rollup.skuId` — the math-leaf the charge was
**coerced** onto by the anchor-leaf rule (per-assembly production is attached to
the lowest-position child). The schema comment states its own status plainly:

> *"Assembly or quote-leaf id as text — the two are different tables and a single
> FK cannot address both. **Traceability, not a join key.**"*

So today's `owner_ref` is *not* a causal owner. It is an artifact of a coercion
whose anchor is chosen by physical row order when `position` ties — **OD-028**.

OD-032 proposes to make owner attribution load-bearing: it drives grouping in
Costs, per-instance recovery, the customer-document disambiguation rule, and the
NetSuite memo. Under OD-028, that identity can **move between a quote and its
copy**.

**This does not block OD-032**, and here is why the distinction matters:

- **New component-owned charges carry their true owner** (`quote_leaf_id`,
  authored by the operator against a specific carton). They are unaffected by
  the anchor coercion entirely.
- **Existing production-sourced charges keep a coerced `owner_ref`.** For those,
  the plan must *not* present the anchor as a cause.

**RULE — disposition 1, accepted 2026-08-27. AMENDED 2026-08-27 (Phase 3 stop):
the destination is the Item Group, not Project.**

> A charge whose `owner_ref` comes from anchor coercion **must not be presented
> as causally owned by that component**, and the coerced anchor is never exposed
> as the cause in Costs, Commercial Recovery, customer copy or the NetSuite memo.
>
> New packaging-owned charges use their actual `quote_leaf_id` and therefore
> have genuine causal ownership.
>
> **OD-028 remains post-gate unless we ever decide to expose coerced owner
> attribution.**

**What changed, and why the original clause was wrong.** The rule originally sent
anchor-coerced charges to **Project**. That was correct about what they are NOT —
they are not caused by the anchor component — and wrong about what they ARE.

Every such charge is Production economics stored on
`assembly_production_inputs`, and **BV-012 §1.a** is an approved governing rule
confirmed with Accounting:

> Production costs belong to the Item Group itself. They do not belong to an
> arbitrary packaging component underneath it.

The Item Group is therefore the causal owner. Sending these to Project would
detach Production economics from the object that incurs them — asserting a
different and false cause rather than declining to assert one.

**The anchor is not needed to reach the Item Group.** `assembly_production_inputs`
is keyed by `assembly_id`, so the owning Item Group is read **directly from
storage**. There is no coercion in that path and no tie to break, which is why
this amendment does not weaken the OD-028 protection: `owner_ref` remains
non-causal and unread for display, and the anchor stays unexposed.

The `'@quote'` value backfilled onto legacy instances in Phase 1 is therefore
**a legacy marker, not an owner claim.** Nothing reads it to decide a display
owner. See §2.2a.

This is testable rather than merely intended, and §12 asserts it: no OD-032
surface may render an **anchor-derived** owner label. The rule fails loudly if a
future surface reaches for the anchor.

## 2.2a · The three owner types — amended 2026-08-27

Disposition B at the Phase 3 stop admits the evidence the earlier two-type model
did not have:

| `owner.type` | Means | Read from | Population today |
|---|---|---|---|
| `quote` | Genuinely engagement-caused | n/a — nothing qualifies yet | **empty** |
| `component_attachment` | Packaging-origin, authored against a component | `quote_charge_instances.owner_quote_leaf_id` (real FK) | empty until phase 4 |
| `item_group` | Production economics, per BV-012 | `assembly_production_inputs.assembly_id` (real key) | **the entire existing population** |

**Item Group ownership is no longer deferred** for the existing population. The
round trip deferred it on the grounds of "no demand until a charge is genuinely
caused by an assembly rather than a component in it." That demand was already
present and unrecognised: BV-012 says the assembly IS the cause, and 104
populated one-time fee columns are already stored against it.

**Both live owner reads are real references.** Neither is anchor-derived, so the
OD-028 exposure the original rule guarded against does not arise on either path.

**Project is not a fallback.** If the Item Group caused the charge, Project is not
its causal owner — a Project heading over Item Group economics would be the same
class of false attribution the rule exists to prevent, pointing at a different
wrong owner.

---

# 3 · V1 vocabulary and BV-011 destinations

The design's six types against today's enum and BV-011:

**V1 ships five component types plus quote-owned Project setup.** Run setup is
**out of V1** per disposition 3.

| V1 type | Owner | Enum today | BV-011 destination | Status |
|---|---|---|---|---|
| Print plates | component | — | `otc_print_plates` | **enum add**; destination exists, unmapped |
| Tooling & dies | component | `tooling` | `otc_tooling` + `otc_dies` | reuse; **dies destination unmapped** |
| Artwork & prepress | component | `artwork_plate` | `otc_artwork` | **no rename** — see below |
| Samples & proofs | component | — | `otc_samples` | **enum add**; destination exists, unmapped |
| Other · labelled | either | `other_service` | `otc_other_service` | reuse; already per-line selection |
| Project setup | **quote only** | `project_setup` | `otc_setup` | reuse unchanged |

| Deferred | Why |
|---|---|
| **Run setup** | No governed NetSuite destination. **Not a blocker** — raised with Accounting separately and added once the destination is authoritative. |

**Disposition 3 · Run setup is not a blocker.** The first draft called it
blocking. It is not: it is one type among six, every other type's destination
already exists, and the two-phase sheet, owner grouping, instance-grained
recovery and the whole migration are indifferent to whether the vocabulary has
five component types or six.

What matters is that adding it later is **cheap and non-breaking**, and it is:
a new enum value, a `CHARGE_TYPE_DESTINATION` entry and a `library_charge_template`
row. No migration of existing charges, because none will exist under a type
that was never offered. So the design's *"the vocabulary earns growth"*
principle applies to Run setup exactly as it does to a graduating `Other` label
— which is the more honest place for it than a V1 blocker.

**Interim behaviour:** press/line setup attributable to a component arrives
through **Other · labelled** in V1, which is what Other is for. Its labels are
the measuring instrument, so a run of "run setup" labels is itself the evidence
Accounting needs.

**Disposition 2 · `artwork_plate` is never renamed in place.**

> Preserve existing/frozen semantics. Add a new governed value alongside only if
> the V1 vocabulary requires a distinct `artwork_prepress` meaning.

The value appears in live elections and in **frozen instructions**, which are
the record of what Accounting was told. Renaming rewrites the meaning of an
artifact nobody may amend — the same reasoning that made
`tooling_artwork_legacy` a separate value rather than a redefinition.

**Whether a new value is needed at all is a real question, and the answer is
probably no for V1.** The round trip splits Print plates (plate and cylinder
*making*) from Artwork & prepress (design and adaptation *labour*). Today's
`artwork_plate` spans both — its name says so. Once `print_plates` exists as its
own value, `artwork_plate` on a **new component-owned charge** means only the
labour half, because the making half has somewhere else to go.

So: **reuse `artwork_plate` with the label "Artwork & prepress" on the OD-032
surfaces, add no enum value, and change no existing row's meaning.** If a future
reading finds the two-meaning span genuinely ambiguous in reporting, an
`artwork_prepress` value is added alongside then, with `artwork_plate` deprecated
exactly as `tooling_artwork_legacy` is.

**§02a re-graining is unaffected by this.** The `per_sku → one_time` rule is
about the *basis* of new component-owned charges, not about the enum value, and
legacy quote-owned rows keep their basis untouched.

**Three destinations already exist with no source column** —
`otc_print_plates`, `otc_dies`, `otc_samples` — which is the gap I traced when
this finding opened. OD-032 fills exactly those. `otc_cartons` stays unfilled,
correctly: the round trip rejects Cartons as a charge.

**`otc_processing_fee` stays unfilled**, matching the deferral to Other.

**Allowed modes** are already expressed in `registry.ts` as
`available[] + refusals{}` with the class rule *"all one-time fees permit all
three"*. The design narrows three types (Print plates: unit/fee; Artwork:
unit/absorbed). That is a **change to a governed class rule** banked in
CLAUDE.md, and should be dispositioned explicitly rather than absorbed as a
registry edit.

---

# 4 · Coexistence — production and quote-level charges

Nothing is migrated away. Three populations coexist:

| population | owner | source | grain |
|---|---|---|---|
| landed (freight, duty) | `@quote` | freight tables | quote |
| legacy one-time | `@quote` | `assembly_production_inputs` | quote |
| **component-owned** | `quote_leaf_id` | **`quote_leaf_charges`** | instance |

`ChargeEconomicsInput` gains an `ownerRef` alongside the existing `ownerKind`,
and `ownerKind` widens to `"assembly" | "direct_service" | "component"`. The
constructor stays untouched — it consumes `recoverableSell` verbatim and reads
no ownership, which is the property that lets a third population arrive without
re-deriving anything.

**`per_sku` deprecation.** §02a says every case `per_sku` expresses is a
component-owned charge that had no owner. Recommend: stop offering it, keep
reading it, and let existing rows age out. A conversion tool would be
re-attributing historical charges to causes nobody recorded.

---

# 5 · Costing and margin

**Formula unchanged.** Component-owned charges enter as additional
`ChargeEconomicsInput` entries keyed to the owning leaf. Because they are
already leaf-owned they need **no anchor coercion** — they are the first charge
population in the system that is causally attributed by construction.

One graph consequence to verify early: a component-owned charge produces a node
under its leaf, so the leaf's cost rises. That is correct and is the point. What
must be checked is that `ownedPlacedCharges()`'s leaf filter still counts each
charge exactly once — the double-count that shipped once already and was found
only by cross-reading two consumers.

**Margin footer attribution line.** The design asks for
*"$2,280 absorbed across 4 component charges"* so a floor breach names its cause.
This is additive to the existing margin surface and does not touch the
predicate.

---

# 6 · Commercial Recovery

| | today | target |
|---|---|---|
| grain | `(quote, charge_key)` | `(quote, charge_key, owner_ref)` |
| rows | one per type | one per instance, grouped by owner |
| unplaced | absent — absence of a row = legacy | **explicit `unplaced`, blocks send** |
| group action | none | "Set all Print plates → One-time fee" |

**The `unplaced` state is the sharpest change.** Today absence of an election row
is load-bearing: it means *legacy resolution*, and `PlacedCharge.source`
distinguishes `election` from `legacy` because the two are **priced
differently** — legacy sits in the unit rate and the quote adjustment reaches
it; elected is revenue-neutral. A new component-owned charge has no legacy
resolution to fall back to, so `unplaced` must be a third state, not an absence.

Recommend: `unplaced` is represented by **the charge existing with no election
row**, and the send gate reads *component-owned charges without an election*
rather than a new column. That keeps "absence of a row is load-bearing" true and
adds a second meaning only where the first cannot apply.

---

# 7 · Freeze, copy, revise

**Freeze.** `quote_snapshot_recovery_instructions` needs **no schema change** —
it is already owner- and tier-grained. Component-owned charges freeze through
the existing path. `frozen-instruction.ts` maps `ownedPlacedCharges()` output
directly, so the only change is that `ownerRef` starts carrying a causal value
for one population.

Pattern 52 applies: `quote_leaf_charges` and its tiers are **freeze-list
columns** and every future writer must call `assertNotFrozen`. Add them to
`docs/pattern-52-freeze-list.md` in the same commit that creates them — the
freeze-list doc and the helper co-locate so the answer is grep-able.

**Copy.** The round trip **retracts** the reconfirmation gate. So
`cloneQuoteGraph` gains `quote_leaf_charges` + tiers to its Cloneable bucket,
mapped through `quoteLeafIdMap` and `tierIdMap` exactly as `quote_leaf_lifts`
now is — the pattern is already there from `#452`, including the
unmapped-identity throw. Elections carry as they already do, re-keyed by the
widened owner.

**Revise.** V2 carries charges silently. The one new rule: swapping the owning
component **drops** its charges with notice rather than migrating them. That is a
new lifecycle behaviour and needs its own test — *a plate for the old carton is
not a plate for the new one*.

**Component deletion.** `attachment-dependents.ts` (from `#447`) already counts
what a `quote_leaves` delete cascades across 9 tables. It gains
`quote_leaf_charges`, and the confirm copy gains the design's requirement:
charges listed **by name and total** before they are taken.

---

# 8 · Customer document

**No new customer-facing concept.** The line prints as its type name. Owner
appears **only on collision** between two same-type printing charges.

Pattern 45 governs: every block in the customer tree must trace to real bundle
data. The collision-disambiguation string is derived at the composition seam
(`customer-view-resolver.ts`), not in the render tree — the render tree must not
learn what an owner is.

The fee-fold behaviour is untouched: turning itemization off folds charges into
the fee sentence and never erases them.

---

# 9 · NetSuite projection

**Destination maps on charge type, never on owner.** Owner travels as **memo
text**. That is exactly how `bv011-destinations.ts` is already keyed, and the
module's header already argues for it — destination-keying rather than
source-keying so two sources meaning one destination cannot drift.

`OTC_COLUMN_DESTINATION` is keyed by *column name*, which stops being the right
shape once charges come from rows rather than columns. Recommend a sibling
`CHARGE_TYPE_DESTINATION` keyed on `recovery_charge`, with the column map
retained for the legacy population.

`Other` has no governed destination and already resolves per line, raising the
existing unmatched pre-send flag. No second mechanism.

---

# 10 · Design-fidelity mapping

Screens and states from `docs/design-prototypes/od-032/design/Nexus OD-032 Round Trip`, §03
Preview (three switchable states) and §04.

| Design element | Exact copy / behaviour | Nexus target | Risk |
|---|---|---|---|
| **Entry point** | packaging row `···` → **Add one-time charges** | extend the existing packaging row context menu | low — menu exists |
| **Owned affordance** | `3 charges · $3,180` on the component row | new inline affordance on the packaging row | low |
| **Sheet header** | `Owned by 10064-GNX-Box · Genexa — Box — Kids' Cough`; step chip `step 1 of 2 · types` / `step 2 of 2 · economics` | new two-phase sheet | **new component** |
| **Phase 1 chips** | `Common on secondary packaging` + up to 3 type chips + `suggested · never pre-checked` | suggestion strip from `library_charge_template` | **fidelity-critical** |
| **Phase 1 rows** | checkbox · name · hint (`4 colours · plate set`) · basis `one-time` fixed text | multi-select checklist | medium |
| **Phase 1 footer** | `3 selected · amounts entered next` · `Cancel` · `Enter economics →` | | low |
| **Phase 2 table** | columns `Charge · Cost · T1 · Recovery ask · Basis`; rows carry name + hint | staging table, all rows priced together | **new component** |
| **Phase 2 note** | rows arrive `unplaced`; send checklist holds; *"Asking for it in this sheet would fuse the two decisions the model keeps apart"* | copy verbatim | low |
| **Phase 2 footer** | `← Back to types` · `Add 3 charges` | | low |
| **Result rows** | nested under component; meta `print plates · one-time · unplaced`; `cost · tier 1`; `recovery set in pricing`; per-row `···` | Costs one-time section, grouped by owner | **medium — §1/§9 amendment** |
| **Recovery rows** | `Print plates` · `owner · 10064-GNX-Box (Kids' Cough carton)` · `$1,750` · three segmented modes | extend `card-commercial-recovery.tsx` | **medium** |
| **Recovery group action** | `Set all Print plates → One-time fee` | new control above the group | medium |
| **Recovery two-instance case** | same type, two owners, **different decisions** — `same type, different decision` | the case the grain exists for; must be in the fixture | — |

**Reused faithfully:** the packaging row `···` menu, the Costs one-time section
and its tier grid (x-positions unchanged per the amendment), the Commercial
Recovery card and its three-mode segmented control, the modal primitive.

**Genuinely new:** the two-phase sheet, the suggestion chip strip, the
owner-grouped nesting in Costs, the group recovery action.

**Cannot be reproduced as designed / needs disposition:**

1. **`costs-page-layout` §1/§9 amendment is a prerequisite**, not a
   consequence. It is a Design Authority document whose load-bearing claim
   ("one-time costs have no SKU dimension") stops being half true. It must be
   amended before Costs work starts, or implementation contradicts a governing
   document.
2. **The round trip's own Preview is a review aid.** Its three switchable
   phases are the R7b state-strip pattern — production has one state at a time.
   Do not port the switcher.
3. **Allowed-mode narrowing** conflicts with the banked class rule that all
   one-time fees permit all three modes. Surfaced, not resolved.
4. ~~Run setup has no NetSuite destination.~~ **Resolved by disposition 3** —
   Run setup leaves V1 and is raised with Accounting separately. Not a blocker,
   and its absence changes nothing about the sheet, the grouping or the grain.

**Visual acceptance is part of completion**, not a polish pass. Each phase ships
with its design-fidelity manifest per Pattern 27 (structural + polish), and the
`···`-menu-to-sheet sequence is walked against the bundle before the step is
called done.

---

# 11 · Compatibility for existing quotes

- **Existing elections** migrate to `owner_ref = '@quote'` — what they already
  mean. No behaviour change.
- **Existing frozen snapshots** are untouched; they already carry `owner_ref`.
- **No backfill of attribution.** Legacy charges are not retro-assigned to
  components. Doing so would invent causes nobody recorded — the same reasoning
  that refused a spec backfill in Training Finding #2.
- **Sent and accepted quotes** are unaffected: their instructions are frozen.

---

# 12 · Falsification and certification

Ordered so the cheapest disproof comes first.

**Unit / pure**
0. **Disposition 1, asserted rather than intended.** No OD-032 surface renders an
   owner label for a charge whose owner is `'@quote'` or whose instance row is
   synthesised. A future surface that reaches for the coerced anchor fails here
   rather than shipping — which is what keeps OD-028 post-gate.
1. Owner is never nullable; `'@quote'` and a leaf id are both valid and distinct.
2. Two instances of one type on two owners hold **different** recovery modes —
   the case the grain exists for.
3. Two instances of one type on one owner require distinct labels — **and remain
   independently editable when a label changes.** Identity is the generated id;
   renaming one must not repoint its election, its frozen instruction or its
   NetSuite memo (disposition 4).
3b. `artwork_plate` is not renamed, and an existing row's meaning is unchanged
   by the arrival of `print_plates` (disposition 2).
4. A component-owned charge is always `one_time`; no path sets another basis.
5. `library_charge_template` has no amount and no default mode — asserted
   structurally so a future column fails the suite.
6. `ownedPlacedCharges()` counts each charge exactly once with the new
   population present (the double-count that shipped once already).
7. Placement invariance still holds with component-owned charges present:
   included vs separate leaves turnkey identical — the Run-2 falsification,
   re-run with the new population.
8. Absorbing a component charge reduces margin by exactly its cost and adds no
   revenue.

**Graph / freeze**
9. Freeze writes one instruction row per `(charge, owner, tier)`; no collapse.
10. `assertNotFrozen` refuses every new writer on an accepted quote.

**Lifecycle**
11. Copy carries charges and elections; copy is commercially identical.
12. Revise carries charges; **swapping the owning component drops them with
    notice** and does not migrate them.
13. Deleting a draft component lists charges by name and total, then takes them.

**Downstream**
14. Customer document prints type name; owner appears **only** on collision.
15. Itemization off folds charges into the fee sentence and erases nothing.
16. NetSuite line maps on type; owner appears in memo only; `Other` raises the
    existing unmatched flag.

**Phase 1 behaviour-neutrality — a population-wide before/after harness**

The disposition sets the bar: *"Before and after migration, prove every existing
quote resolves the same recovery placement, economics and frozen behaviour."*
That is a population proof, not a sample, and the project already has the shape
for it — `scripts/gate-1b/verify-costing-preserved.ts` (the S-7 preserved
harness) captures a resolved projection across every live quote and compares two
captures byte-for-byte.

A sibling harness for phase 1 captures, per quote and per tier:

```
resolved recovery placement per charge      mode + source (election|legacy)
constructed economics                       cost, recoverableSell, placement
tier commercial totals                      unit subtotal, otc subtotal, total
blended margin                              per governed tier
frozen behaviour                            instruction rows for sent quotes
```

**Both sides must be captured with the same harness**, per the standing rule —
a stale baseline mixes pre-existing drift with the change under test and makes
neither legible. And per Pattern 60, the capture must distinguish *resolved*,
*authoritatively absent* and *could not resolve*: a quote that fails to resolve
on both sides is not evidence of neutrality, it is evidence of nothing.

Two specific assertions the generic diff would miss:

- **`source` must not flip.** A legacy charge resolving as `election` after
  migration would be re-priced — legacy sits in the unit rate and the quote
  adjustment reaches it; elected is revenue-neutral. Identical placement with a
  changed `source` is a silent repricing that a placement-only comparison
  reports as unchanged.
- **Election identity must be anchor-independent.** Synthesise instances for a
  quote, permute the physical row order that decides its OD-028 anchor,
  re-synthesise, and assert the instance ids and their elections are unchanged.
  That is the falsification of the disposition's load-bearing clause, and it
  fails loudly if synthesis ever starts reading `owner_ref`.

**Certification walk** — one quote, two cartons, same type on both, different
recovery decisions, through freeze and a real sandbox Sales Order, with
before/after database capture at each boundary. That is the shape that has
caught every real defect in this project, and it is the only test that would
catch an owner identity that moves.

---

# 13 · Recommended sequencing

**Phase 0 is now two items, not four.** Dispositions 1–5 are settled, and Run
setup left the critical path with them.

| phase | contents | gate |
|---|---|---|
| **0(a)** | amend `costs-page-layout` §1/§9 — owned rows group beneath their owner; the section stays **one tier-aligned Costs region** | **before the UI phases**, not before phase 1 |
| **0(b)** | ~~decide the election key~~ — **decided**, §2.1 | done |
| **1** | Election → one instance regime. Synthesise a stable instance per existing `(quote_id, charge_key)`, migrate elections onto it, expand→backfill→validate→contract. **Behaviour-neutral.** | population before/after harness green **and** the anchor-permutation falsification |
| **2** | M2/M3 storage + registry + costing input. No UI. | falsifications 0–8 |
| **3** | Costs owner-grouped rendering, Project heading | fidelity manifest vs bundle |
| **4** | The two-phase sheet | fidelity manifest; the new-component risk sits here |
| **5** | Recovery instance rows + group action | falsifications 9–13 |
| **6** | Customer document + NetSuite | falsifications 14–16 + certification walk |
| **later** | Run setup, once Accounting supplies a destination | one enum value + one map entry |

**Phase 0(a) gates the UI phases, not phase 1.** The amendment is about how
Costs renders owned rows; phase 1 renders nothing. Sequencing it before phase 3
rather than before phase 1 lets the invisible migration proceed while the
document is amended, and keeps the two independently reviewable — which is the
standing instruction for these phases.

**Phase 1 does not advance to the visual phases until it is falsified cleanly.**
Its success criterion is that nothing moved, which is the rare case where a
phase can be verified against Production directly: same placements, same
economics, same frozen behaviour, across the whole live population.

**Mode-narrowing is deferred to phase 5**, where Recovery is actually touched.
It is a change to a banked class rule (*all one-time fees permit all three
modes*) and it can be dispositioned with the surface in front of you rather than
in the abstract now. Nothing before phase 5 depends on the answer.

Phase 1 is deliberately invisible: it moves the live election to the grain the
snapshot has always had, and if it is correct nothing changes at all. That is
also what makes it safe to ship on its own — a phase whose success criterion is
"nothing moved" can be verified against Production directly.

---

# Carried, not actioned

- **`Refresh from HubSpot` remains permission-gated.** Not changed as part of
  OD-032; awaiting a business disposition of its own.
- **OD-028** untouched — but see §2.2 for the one way OD-032 could pull it
  forward, which is a decision rather than an implementation detail.
- **Tier 2–4 governed-action migration** untouched. New OD-032 client
  components must call `runGoverned` from the start; the enforced region should
  extend to cover them as they land.
- **The Design Authority is committed** at
  [`docs/design-prototypes/od-032/`](../design-prototypes/od-032/), moved intact
  from the repository root per disposition 5. Visual acceptance runs against
  that bundle throughout implementation — the fidelity is not to be recreated
  from this document's prose, which is a map of it and not a substitute for it.
