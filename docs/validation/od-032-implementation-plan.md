# OD-032 · Owner-attributed one-time charges — implementation plan

**Planning only. No implementation.** Written against the Design Authority in
`od-032-bundle/`, mapped onto the certified architecture on baseline `3558e09`.

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

## 2.1 The identity

```
charge instance  =  (quote_id, charge_type, owner_ref)
recovery grain   =  the same triple
freeze grain     =  (snapshot, charge_key, owner_ref, tier_id)   -- unchanged
```

Two instances of one type on one owner — *"two dies on one carton is a real
thing"* — are distinguished by the required distinct label, so identity is
strictly `(quote, type, owner, label)`. Recommend making `label` part of the key
from the start rather than adding it when the second die arrives.

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

**Recommendation:** quote-owned legacy charges group under the design's
**Project** heading — which the round trip already specifies — and their
`owner_ref` is never surfaced as a causal owner in Costs, Recovery, the customer
document or the NetSuite memo. That keeps OD-028 exactly where it is: a display
and coaching concern, not a commercial-attribution one.

**What would break that:** if V1 ever surfaces the coerced anchor as an owner
name, OD-028 stops being post-gate. That is a decision for Edward, not for code.

---

# 3 · V1 vocabulary and BV-011 destinations

The design's six types against today's enum and BV-011:

| Design type | Owner | Enum today | BV-011 destination | Status |
|---|---|---|---|---|
| Print plates | component | — | `otc_print_plates` | **enum add**; destination exists, unmapped |
| Tooling & dies | component | `tooling` | `otc_tooling` + `otc_dies` | reuse; **dies destination unmapped** |
| Artwork & prepress | component | `artwork_plate` | `otc_artwork` | reuse, **rename**, re-grain (§02a) |
| Run setup | component | — | *(none)* | **enum add + destination add** |
| Project setup | **quote only** | `project_setup` | `otc_setup` | reuse unchanged |
| Samples & proofs | component | — | `otc_samples` | **enum add**; destination exists, unmapped |
| Other · labelled | either | `other_service` | `otc_other_service` | reuse; already per-line item selection |

**Three destinations already exist with no source column** —
`otc_print_plates`, `otc_dies`, `otc_samples` — which is the gap I traced when
this finding opened. OD-032 fills exactly those. `otc_cartons` stays unfilled,
correctly: the round trip rejects Cartons as a charge.

**`otc_processing_fee` stays unfilled**, matching the deferral to Other.

**Run setup needs a new BV-011 destination** and the README flags it as an
accounting task. It is a **blocking dependency** for V1 — a charge type with no
destination cannot post — and should be raised with Accounting now rather than
at implementation.

**Renaming `artwork_plate` → `artwork_prepress`** is an enum value rename on a
column with live rows and frozen snapshots. Recommend **adding** the new value
and leaving the old as deprecated-but-readable, exactly as
`tooling_artwork_legacy` already models. Renaming in place would rewrite the
meaning of frozen instructions.

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

Screens and states from `od-032-bundle/design/Nexus OD-032 Round Trip`, §03
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
4. **Run setup has no NetSuite destination.** Blocking; Accounting task.

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
1. Owner is never nullable; `'@quote'` and a leaf id are both valid and distinct.
2. Two instances of one type on two owners hold **different** recovery modes —
   the case the grain exists for.
3. Two instances of one type on **one** owner require distinct labels.
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

**Certification walk** — one quote, two cartons, same type on both, different
recovery decisions, through freeze and a real sandbox Sales Order, with
before/after database capture at each boundary. That is the shape that has
caught every real defect in this project, and it is the only test that would
catch an owner identity that moves.

---

# 13 · Recommended sequencing

| phase | contents | gate |
|---|---|---|
| **0** | `costs-page-layout` §1/§9 amendment · Accounting: Run setup destination · disposition on mode-narrowing and on §2.2 | **all three before code** |
| **1** | M1 election widening, expand→backfill→validate→contract; `'@quote'` everywhere; zero behaviour change | full suite green, no visible change |
| **2** | M2/M3 storage + registry; costing input; no UI | falsifications 1–8 |
| **3** | Costs owner-grouped rendering | fidelity manifest vs bundle |
| **4** | The two-phase sheet | fidelity manifest; the new-component risk sits here |
| **5** | Recovery instance rows + group action | falsifications 9–13 |
| **6** | Customer document + NetSuite | falsifications 14–16 + certification walk |

Phase 1 is deliberately invisible: it moves the live election to the grain the
snapshot has always had, and if it is correct nothing changes at all.

---

# Carried, not actioned

- **`Refresh from HubSpot` remains permission-gated.** Not changed as part of
  OD-032; awaiting a business disposition of its own.
- **OD-028** untouched — but see §2.2 for the one way OD-032 could pull it
  forward, which is a decision rather than an implementation detail.
- **Tier 2–4 governed-action migration** untouched. New OD-032 client
  components must call `runGoverned` from the start; the enforced region should
  extend to cover them as they land.
