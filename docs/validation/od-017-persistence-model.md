# OD-017 · Direct Component costing — persistence model

**Returned for review before migration `0066` is authored or applied**, per the
stop gate. No migration written. No database write. Facts below are read-only
observations of the live governed database.

---

## 1 · Pre-migration fact base

| table | rows | keys on |
|---|---|---|
| `assembly_leaf_inputs` | **298** | `assembly_leaf_id` |
| `assembly_leaf_overrides` | **0** | `assembly_leaf_id` *(PK: `assembly_leaf_id, tier_id`)* |
| `assembly_leaf_targets` | **0** | `assembly_leaf_id` *(PK: `assembly_leaf_id, tier_id`)* |
| `assembly_production_inputs` | **85** | **`assembly_id`** — not a leaf key |
| `assembly_leaves` | 150 | 150 with `quote_leaf_id`, **150 distinct** |
| `quote_leaves` | 150 | **0 direct** (`assembly_id IS NULL`) |

**Mapping evidence — the backfill is provably lossless:**

```
assembly_leaf_inputs   total=298  matched=298  with_quote_leaf=298  orphans=0
assembly_leaf_overrides  total=0                                    orphans=0
assembly_leaf_targets    total=0                                    orphans=0
quote_leaf_ids referenced by more than one assembly_leaves row: 0
```

`assembly_leaves` is **strictly 1:1** with `quote_leaves` (150 / 150 / 150
distinct, zero duplicates), and **no cost row is orphaned**. Every one of the 298
rows resolves to exactly one governed quote leaf. There is no ambiguous or
orphan row to disposition — the condition the gate asked to be established
before writing.

---

## 2 · The finding that must be decided before `0066` is written

**Production, Bulk Raw and service fees are keyed on `assembly_id`, not on any
leaf.** `assembly_production_inputs` carries `filling_blending_cost`,
`cm_assembly_total`, `setup_fee_total`, `tooling_artwork_total`, `rd_total`,
`other_service_total`, **`bulk_raw_cost`**, `actual_units_produced`, and the
`allocate_service_fees_to_cost` / `customer_ships_raws` policy — all per
`(assembly, tier)`.

**A Direct Component has no assembly. So re-keying the three leaf-level tables
does not give it production, bulk raw, or service fees — those surfaces have no
owner for it at all.** This is not solved by the migration OD-017 describes,
and the brief explicitly lists all three as required surfaces.

This also breaks the existing coercion documented in CLAUDE.md
("Per-assembly source → per-leaf adapter coercion"), which attaches per-assembly
production to the lowest-position child leaf. With no assembly, there is no
source to coerce from — the adapter has nothing to attach.

### The question for the business

> Can an independently sold component carry production services at all?

Two readings, and I am not the right author of the answer:

**(a) No — and that is commercially correct.** A Direct Component is bought and
resold. Filling, blending, CM assembly, tooling and R&D describe *manufacturing
a finished product*; bulk raw is the input to that manufacturing. On this
reading, Direct Components carry **packaging cost only**, plus per-cell
override/target, and OD-017 stays exactly the size OD-017 describes: re-key
three leaf-level tables.

**(b) Yes — some services attach to a standalone component.** Then
`assembly_production_inputs` must also be re-keyed to a governed product identity
spanning both shapes, its per-assembly policy columns need a per-Direct-Component
home, and OD-017 roughly doubles. This is a second migration, not a wider `0066`.

**Recommendation: (a) for V1**, scoped explicitly rather than by omission — with
the limitation recorded so OD-022 does not discover it when a PM asks why a
Direct Component has no Production section. If (b) is correct, it should be its
own slice after OD-017 closes, not folded in.

**`0066` is not written until this is answered**, because the answer changes
which tables it touches.

---

## 3 · Proposed persistence model (assuming disposition (a))

**One governed cost-input identity: `quote_leaf_id`.**

`quote_leaves.id` is already the canonical commercial SKU (OD-014), already the
identity the customer view and pricing aggregate on, and already exists for both
shapes — a Finished Product member and a Direct Component alike. It is the only
identifier that does not disappear when the assembly does.

```
assembly_leaf_inputs      + quote_leaf_id → quote_leaves.id
assembly_leaf_overrides   + quote_leaf_id → quote_leaves.id
assembly_leaf_targets     + quote_leaf_id → quote_leaves.id
```

### No two interchangeable authorities

The gate is explicit that `assemblyLeafId ?? quoteLeafId` must not become
ambiguous authority. It currently appears at `costing-adapter.ts:140`.

**Disposition: the fallback is removed, not generalised.** After `0066`,
`quote_leaf_id` is the *sole* cost-input identity. `assembly_leaf_id` is retained
for one release **as a nullable legacy column that nothing reads**, then dropped
in a later migration — never in the same migration as the code change, per the
banked migrations-before-code rule.

Two identifiers are permitted to coexist only while one of them is provably
dead. A `??` fallback that survives into steady state is precisely the
"two interchangeable identifiers" the gate prohibits.

### Collision is impossible by construction, not by coincidence

The gate asks for proof that an ASY-backed leaf and a Direct Component cannot
collide, and that it must not rest on UUID coincidence.

**They cannot, because after `0066` there is exactly one identity domain.** Every
cost row keys on `quote_leaf_id`, a single FK into a single table whose primary
key is unique by definition. There is no second domain to collide *with* — the
structure makes the question unaskable rather than answering it probabilistically.

This is why re-keying beats adding a discriminator column: a nullable
`assembly_leaf_id` alongside a nullable `quote_leaf_id` would create two domains
and require a `CHECK` to keep them exclusive. One column needs no such rule.

### Uniqueness re-keying

`assembly_leaf_overrides` and `assembly_leaf_targets` have composite primary keys
`(assembly_leaf_id, tier_id)` that must become `(quote_leaf_id, tier_id)`.

**Both tables are empty (0 rows).** Re-keying a primary key on an empty table is
free and carries no data risk — a genuinely fortunate position, and worth doing
now precisely because it will not stay free.

`assembly_leaf_inputs` has no such uniqueness constraint (298 rows across 147
leaves — deliberately many rows per leaf: per line-group, per tier).

---

## 4 · Proposed migration `0066` — shape only, not authored

Hand-authored per the OD-012 contract. **Index `0066` verified as next
occupied** — `[migration-index] OK · highest occupied index 0065 → next
governed migration is 0066`.

**Expand only. No destructive statement.**

1. `ADD COLUMN quote_leaf_id uuid` (nullable) to the three tables.
2. Backfill from `assembly_leaves.quote_leaf_id` via `assembly_leaf_id`.
   Provably total: 298/298 matched, 0 orphans.
3. Assert `count(*) FILTER (WHERE quote_leaf_id IS NULL) = 0`, abort otherwise.
4. `SET NOT NULL`; add FK → `quote_leaves(id)`; add index.
5. Re-key the two empty composite PKs to `(quote_leaf_id, tier_id)`.
6. Leave `assembly_leaf_id` **in place and nullable**. Its FK to
   `assembly_leaves` must be relaxed or dropped, since a Direct Component's row
   will have no junction to reference.

**Not in `0066`:** dropping `assembly_leaf_id`. That is a later migration, after
a release proves nothing reads it.

Row counts to re-assert post-migration: `assembly_leaf_inputs` **298**,
overrides **0**, targets **0**, `assembly_leaves` **150**, `quote_leaves` **150 /
0 direct**. No historical Product Structure is rewritten — the population is
uniformly ASY-backed and stays that way.

---

## 5 · Still to trace before implementation

Deliberately not claimed as verified:

- **Every writer and reader** of the three tables — the gate requires each be
  checked for an `assembly_leaf_id` assumption rather than inferred from the
  adapter's fallback.
- **Snapshot / freeze**: what cost identity is actually frozen at Send. If
  snapshots depend on live assembly relationships, the gate requires flagging it
  here rather than deferring to OD-022. Not yet established.
- **Customer View resolver**: whether a Direct Component's computed sell reaches
  it without an assembly. `[verify]` — unchanged from OD-022's package, and not
  to be promoted without observation.

---

## 6 · What I need before proceeding

1. **Disposition on §2** — do Direct Components carry production / bulk raw /
   service fees in V1? `0066`'s table list depends on it.
2. Confirmation of the **`quote_leaf_id` sole-authority model** in §3, including
   removing the `??` fallback rather than keeping it.

On both answers I will author `0066`, run the remaining traces in §5, and return
with migration evidence and the thirteen regressions.

**Nothing applied. `0049` / `0050` untouched. `freight_legs.freight_markup_pct`
left to OD-009.**

---

## 7 · Held traces — completed 2026-08-12. **TWO BLOCKING FINDINGS.**

Dispositions 1 and 2 are accepted and unchanged by these. But both findings
change what `0066` must contain, so no DDL was authored.

### T1 · Readers/writers — 13 modules

`actions/assembly-leaf-inputs.ts`, `actions/costing.ts`,
`actions/markup-defaults.ts`, `actions/pricing-lifts.ts`,
`actions/pricing-provenance.ts`, `actions/quotes.ts`, `costs/page.tsx`,
`db/schema.ts`, `lib/commercial-settings.ts`, `lib/costing-adapter.ts`,
`lib/packaging-materialization.ts`, `lib/quote-cost-completeness.ts`,
`lib/quote-guards.ts`. Each needs individual conversion; none may be assumed.

### T2 · Snapshot does NOT freeze Product Structure — **BLOCKING**

There is no per-leaf snapshot line table. `quote_snapshots` carries commercial
settings and PDF axes; **it does not carry the leaf set or its structure.**

Consequence: Complete re-derives structure from **live** assemblies. OD-017's
closure bar requires a Direct Component to *"remain historically stable if
Product Structure later changes"* — **that cannot be met today for any leaf**,
Direct or ASY-backed. Flagged here rather than deferred to OD-022, as instructed.

### T4 · Freight is SPLIT — **BLOCKING**

| table | keys on | Direct-ready? |
|---|---|---|
| `freight_leg_component_tier_costs` | **`quote_leaf_id`** | **yes** — already correct |
| `freight_subcategories` | `assembly_id` | no |
| `freight_subcategory_items` | `assembly_leaf_id` *(unique: `subcategory_id, assembly_leaf_id`)* | no |

The freight **output** already keys on the governed identity. The freight
**authoring structure** does not: `actions/freight-worksheet.ts:114-117` requires
`assemblyId` and raises a validation error without it, and
`lib/freight-workbook.ts` builds exclusively from `assemblyIds`.

This is precisely the dependency the brief prohibited: *"Freight must not retain
an assembly-only dependency that leaves Direct Components economically
incomplete."* Decision 1 explicitly includes Freight/customs in Direct Component
V1 economics, so unlike Production this cannot be scoped out — it must be
re-keyed.

### Consequence for `0066`

Re-keying only the three leaf-level tables would produce a Direct Component that
holds packaging cost and nothing else — no freight, no historical stability —
which does not satisfy OD-017's own closure requirements.

**Recommended scope revision:** `0066` re-keys the three leaf-level tables **plus
`freight_subcategory_items`** (`assembly_leaf_id` → `quote_leaf_id`, including
its unique index). `freight_subcategories` needs a disposition equivalent to
Decision 1's — is a freight *shipment grouping* an assembly concept, or must it
span Direct Components? Snapshot structure (T2) is a separate migration.

**Returned for disposition. Nothing authored, nothing applied.**
