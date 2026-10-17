# OD-032 — copy / freeze integrity: phase plan

**Plan only. No code.** These are the prerequisites to exposing Phase 4 authoring, per the
Shape A sequencing disposition. Nothing here is reachable by an operator today, and all of it
becomes live the moment a component charge can be authored.

**Three gaps, not two.** The scope found copy and freeze. Investigating them for this plan
surfaced a third that sits in front of both, and it is the first thing Phase 4 would hit.

---

## P-1 · `ensureChargeInstance` cannot create a component-owned instance

**Severity: blocking. Proven by transaction, not by reading.**

Phase 2 added `owner_quote_leaf_id` and the `quote_charge_instances_owner_agrees` CHECK:

```sql
CHECK ( (owner_ref = '@quote' AND owner_quote_leaf_id IS NULL)
     OR (owner_quote_leaf_id IS NOT NULL AND owner_ref = owner_quote_leaf_id::text) )
```

`ensureChargeInstance` still writes `owner_ref` only. So passing a leaf id as `ownerRef`
satisfies neither branch. Tested against the live schema in a rolled-back transaction:

```
INSERT INTO quote_charge_instances (quote_id, charge_key, owner_ref)
VALUES (<quote>, 'print_plates', <leaf id>)

REFUSED — violates check constraint "quote_charge_instances_owner_agrees"
```

**This is the CHECK working.** Phase 2 made the inconsistent state unrepresentable, and the
helper is currently one of the writers that would produce it. It fails loudly at the first
attempt rather than silently storing an owner the cascade does not protect.

### The change

- `ChargeInstanceKey` gains nothing — `ownerRef` already carries the leaf id. The helper
  derives `ownerQuoteLeafId` from it: `null` when `ownerRef === '@quote'`, otherwise the
  same value written to both columns so the CHECK's second branch holds by construction.
- The existence lookup must match on the same pair, or a second call for one component
  charge mints a duplicate instead of resolving the first.

### Falsifications

1. A component-owned instance is created and **both** owner columns agree.
2. A second call with the same `(quote, key, owner, label)` returns the **same id** — the
   idempotence Phase 1 relies on, now exercised on the component path.
3. A quote-owned instance still writes `owner_quote_leaf_id = NULL`. *Non-vacuous: this is
   the branch that already worked, and the change must not move it.*
4. Deleting the owning leaf removes the instance — the cascade the typed column exists for,
   asserted by performing it.

**Size: well under one phase.** It is a helper and its tests.

---

## P-2 · Copy loses component charges four ways, not one

**Severity: blocking. Wider than the scope recorded.**

The scope found that `quote_charge_instance_tiers` is not cloned. Reading the copy path shows
that is the last of four losses. `cloneQuoteGraph` selects only `chargeKey` and `mode` from
the source, then calls `ensureChargeInstance(tx, { quoteId: newQuoteId, chargeKey })` — with
no owner and no label.

| # | Lost | Consequence on the copy |
|---|---|---|
| 1 | **Causal owner** | A component charge becomes `'@quote'`. Attribution to the carton that caused it is gone, and it silently rejoins the legacy population |
| 2 | **Label** | Two `other_service` charges distinguished only by label collapse |
| 3 | **Instance separation** | Two same-type charges on one quote resolve to **one** instance, because the helper dedupes on `(quote, key, owner, label)` and all three inputs are now identical |
| 4 | **Tier economics** | `quote_charge_instance_tiers` is not cloned. The copy carries the election and **loses the money** |

Losses 1–3 are consequences of the same omission: the copy never reads what it is copying.

### Why the remap is the real work, and why it is already solved

`owner_quote_leaf_id` cannot be copied verbatim — the clone mints **new** `quote_leaves` rows,
so the source's leaf id addresses a leaf on a different quote. It must be remapped.

**`quoteLeafIdMap` already exists in `cloneQuoteGraph`** (built at the attachment step,
complete before the later blocks that consume it, and already used by four of them). The
component-charge clone joins that list rather than introducing a mechanism.

### The change

- Select `ownerRef`, `ownerQuoteLeafId` and `label` alongside `chargeKey` and `mode`.
- Remap through `quoteLeafIdMap`, ordered after the map is complete — the same sequencing
  point the existing consumers respect, and a comment there already flags it as deliberate.
- Clone `quote_charge_instance_tiers` per new instance, carrying `cost_amount` and
  `recovery_ask` **verbatim**. Per the copy contract, a copy is commercially equivalent to its
  source: the amounts carry, and `recovery_ask` carries as the governed figure it already was.
- A source leaf absent from the map is a **refusal, not a skip.** Dropping a charge whose
  owner cannot be resolved is how a cost silently leaves a quote.

### Falsifications

1. A component charge copies with its owner remapped to the **cloned** leaf, and both owner
   columns agree on the copy.
2. **Two same-type charges on one component stay two on the copy**, with distinct ids and
   distinct amounts. *Non-vacuous: give them different costs so a collapse cannot pass.*
3. Tier economics match the source **per (instance, tier)**, not merely in total — a total can
   agree while two charges have swapped.
4. A quote-owned legacy charge copies **exactly as before**. *The control: this path works
   today and must not move.*
5. A label survives, and two charges differing only by label stay two.
6. An unresolvable owner **refuses the copy** rather than dropping the charge.
7. Full-population neutrality remains byte-identical — the copy path runs on legacy quotes.

**Size: ≈1 phase**, most of it the falsification set rather than the change.

---

## P-3 · Frozen instructions cannot distinguish two same-type charges

**Severity: blocking for Accounting correctness.**

`quote_snapshot_recovery_instructions` carries `chargeKey + ownerRef + tierId` and **no
instance identity**. Two Print plates charges on one quote — the exact case OD-032 exists to
make representable — produce two instruction rows an accountant cannot tell apart.

For component charges both rows would even share `ownerRef` when one carton owns two of a
type, so the rows are identical in every column except their amounts.

### The instance id is reachable, and must not be parsed out of a string

`componentChargeEconomics` sets `sourceColumn` to
`` `quote_charge_instance_tiers:${chargeInstanceId}` ``. The id is therefore present but
**encoded in a display string**, and recovering it by splitting on `:` would be exactly the
measurement error Pattern 58 records — reading a value through an instrument that was not
built to carry it.

**It travels as a first-class field or not at all.**

### The change

- `ChargeEconomics` gains `chargeInstanceId?: string`, set by `componentChargeEconomics`
  beside `sourceColumn` rather than derived from it.
- `PlacedCharge` and `FrozenRecoveryInstruction` carry it through untouched — the same
  pass-through discipline `ownerKind` and `ownerRef` already follow, where this layer decides
  *where* a charge sits and has no standing to decide *what it is*.
- One **additive** migration: nullable `charge_instance_id` on
  `quote_snapshot_recovery_instructions`, with an FK to `quote_charge_instances(id)`.

### Why the column is nullable, and what that nullability means

The instruction covers **every placed charge, not every elected one** — the writer's own
comment records that a legacy-placed charge has no election row, and that building
instructions from elections would freeze nothing for the great majority of live quotes.

A legacy-placed charge therefore has no instance. So:

> `charge_instance_id` is **NULL only for a legacy-placed charge with no election**, and
> **NOT NULL for every component-owned charge**, which cannot exist without an instance.

That is assertable rather than conventional, and it is worth asserting: a null on a component
charge would mean identity was lost between authoring and freeze.

**No backfill.** Historical snapshots keep NULL — they are the record of what Accounting was
told, and Pattern 52's historical-snapshot exception already governs this. Nothing may branch
on that null at runtime.

### Falsifications

1. Two same-type charges on one quote freeze as two rows with **distinct** `charge_instance_id`.
2. Two same-type charges on the **same component** — identical in every other column — remain
   distinguishable. *This is the case the column exists for.*
3. Every component-owned instruction has a non-null id.
4. A legacy-placed charge freezes exactly as before, with NULL. *Control.*
5. The id is never derived from `sourceColumn` — asserted structurally, so a later edit
   cannot reintroduce the parse.
6. Pre-migration snapshots are untouched and still read.

**Size: ≈1 phase**, including the migration.

---

## Sequencing

**P-1 → P-2, then P-3 independently.** P-2 cannot create a component-owned instance until P-1
lands, so the order is forced rather than chosen. P-3 touches freeze and shares nothing with
either.

Proposed as **two PRs**, matching the disposition's "copy/freeze integrity" as one sequenced
item while keeping each independently falsifiable:

| PR | Contains | Migration |
|---|---|---|
| **1 · copy integrity** | P-1 + P-2 | none |
| **2 · freeze integrity** | P-3 | one additive |

Both carry the standing gates: `verify:ci`, `test:unit`, full-population neutrality, and the
governed OD-028 permutation gate at the end of the second — the same discipline Phase 2 closed
under.

The additive migration follows the established order: **applied before the code that reads it
merges**, since it is additive and no deployed writer is affected by a nullable column
appearing.

---

## What this phase deliberately does not do

- **No authoring.** Nothing becomes reachable. These close the integrity gaps *in front of*
  Phase 4, and the sheet is a later, separate item.
- **No Costs presentation.** Shape A's Packaging block and Production attribution line are
  their own sequenced item.
- **No recovery grain change.** Per-instance recovery and the group action are the item after
  this one, and P-3 does not pre-empt them — it makes the frozen record able to represent
  what that change will produce.
- **No backfill of historical snapshots.**

## One note on why these come first

Each gap is currently unreachable, and each becomes a *silent* defect the moment authoring
ships: a copy that loses money, an owner that quietly reverts to the legacy population, and an
Accounting record that cannot tell two charges apart. None of the three announces itself.

Closing them before the feature that exposes them is cheaper than closing them after, and it
is the only order in which the falsifications can be written against a system where the wrong
answer is still impossible to reach.
