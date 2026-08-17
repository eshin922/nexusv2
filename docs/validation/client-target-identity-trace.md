# Client Target — identity trace and persistence model

**Status:** trace only. No UI, no schema, no code written.
**Date:** 2026-08-17.
**Asked for:** whether the surviving legacy persistence can represent
*default/common target + optional tier-specific targets* at the correct
commercial unit of account.

**Answer: no.** It has the wrong identity for two of the three cases, cannot
express "common across tiers" at all, and the read path collapses per-tier
variation before it reaches the grid. Details below, then the smallest model
that does work.

---

## 1 · Exact key of the surviving persistence

`assembly_leaf_targets` (`src/db/schema.ts:3135`), created by
`drizzle/0034_slice_11_5_assembly_cost_extension_tables.sql`:

```
PRIMARY KEY (quote_leaf_id, tier_id)
```

- `quote_leaf_id` → `quote_leaves.id`, `ON DELETE CASCADE`. **Canonical leaf
  identity** — OD-017 (migration 0066) re-keyed this table off the legacy
  junction.
- `assembly_leaf_id` → `assembly_leaves.id`, nullable. The schema comment is
  explicit: *"Legacy compatibility column. Read by nothing; NULL for a Direct
  Component."*
- `tier_id` → `quote_tiers.id`, **NOT NULL** and part of the primary key.
- `client_target_price_per_unit numeric(10,4) NOT NULL` — the sparse-table
  invariant is "row exists ⟹ value is set".

**Live row count: 0.** There is no Client Target data anywhere in the database.
Nothing has to be migrated, and no existing operator expectation is being
broken. The model can be chosen on merit.

---

## 2 · What that key addresses

`quote_leaves.assembly_id` is **nullable** (`schema.ts:2541`), and that nullity
is the whole distinction:

| `quote_leaves` row | what it is | is it the sellable unit? |
|---|---|---|
| `assembly_id IS NULL` | **Direct Product** | **yes** — the leaf *is* what the customer buys |
| `assembly_id` set | **member of an Item Group** | **no** — an internal component |

So the key addresses **a leaf**, which is the commercial unit of account only in
the Direct case.

The surface already has the right concept and it is not this one. Price Build
(Item 3) defines a sellable unit as a top-level rollup row —
`skuRollups.filter(r => r.parentSkuId === null)`
(`pricing-surface-shell.tsx:585`) — which resolves to:

- an **Item Group finished good** → `assemblies.id`
- a **Direct Product** → `quote_leaves.id` where `assembly_id IS NULL`

(`costing-adapter.ts:286` and `:299`; `mathSkuId` returns `row.quoteLeafId`.)

---

## 3 · Coverage against the three cases

| case | representable in `assembly_leaf_targets`? |
|---|---|
| **Direct Product** | **yes.** The leaf is the sellable unit, so the key is correct. This works today and would keep working. |
| **Item Group member** | representable, and *wrong*. The client did not give a target for the bottle inside the kit. |
| **Item Group finished good** | **no key exists.** There is no row shape that addresses an assembly. |

Storing an Item Group's target therefore requires picking one of its member
leaves — the arbitrary-member assignment the disposition prohibits — and the
engine then refuses to use it anyway:

```ts
// Slice 9.4b — assembly cells never carry a competitive verdict.
// Client targets are leaf-only … the math layer doesn't compute against
// assembly-level targets even if input.cellTargets contained one …
// Quote-level client targets land in Slice 9.4c.
competitiveStatus: null,           // costing.ts:2963
```

Slice 9.4c never landed (§5). So on an Item Group the target would be written
against a component and produce **no verdict at all**. It is not merely
mis-keyed; it is inert.

### Default/common vs tier-specific

- **Tier-specific:** structurally representable — `tier_id` is in the PK.
- **Common across tiers:** **not representable.** `tier_id` is `NOT NULL`, so
  "one target for the whole quote" can only be written as N identical rows.
  Nothing distinguishes *"the client said $5 across the board"* from *"the
  client happened to name $5 at each of four tiers"*, and editing the common
  case means rewriting N rows and hoping none is missed.

---

## 4 · How the read path resolves it today

Loader → adapter → engine → classifier → grid:

1. **Load** — `costing.ts:673`, joined to `quote_leaves` and returned as
   `assemblyLeafTargetRows`.
2. **Adapt** — into `QuoteCostingInput.cellTargets`, keyed
   `${quoteSkuId}::${tierId}` (`costing.ts:3139-3141`).
3. **Engine verdict** — per cell:
   `requiredSellPerUnit <= cellTarget ? "COMPETITIVE" : "OVER_CLIENT_TARGET"`
   (`computeCompetitiveStatus`, `costing.ts:1050-1054`). Equality counts as
   COMPETITIVE; no epsilon. Assemblies: hard `null`.
4. **Classifier** — and this is where per-tier variation is lost:

```ts
if (clientTargetUnit == null) {
  const tgt = cellTargetLookup(sr.skuId, pt.tierId);
  if (tgt != null) clientTargetUnit = tgt;      // classifier-context:585-588
}
```

`client_target_unit` is **one value per SKU row — the first non-null found
while iterating tiers.**

5. **Delta** — computed per cell but against that collapsed row-level value:

```ts
const clientTarget = sku.client_target_unit ?? null;
const clientTargetDelta = clientTarget != null && sellUnit != null
  ? sellUnit - clientTarget : null;            // pricing-classifier:565-568
```

### Two consequences worth naming before any UI is built

**(a) Per-tier targets are unrepresentable end-to-end even though the table
supports them.** Persistence is per-(leaf, tier); presentation is per row. The
grid's own test states the assumption out loud —
*"The benchmark does not vary by tier, so a column would assert something
untrue"* (`compliance-grid-projection.test.ts:161`). That assumption is exactly
what the business requirement contradicts.

**(b) The delta and the chip can disagree — Pattern 50.** The engine's verdict
uses the **true per-(leaf, tier)** target. The displayed headroom uses the
**collapsed row-level** target. On a quote with different targets by tier, Tier
3's headroom would be measured against Tier 1's target while Tier 3's chip was
decided against Tier 3's. Two bases for one question, agreeing only while every
tier shares a target — which is the case that exists today, which is why it has
never shown.

Neither is a bug anyone has hit: `assembly_leaf_targets` is empty. Both would
become live defects the moment the feature ships on this persistence.

---

## 5 · What `quote_level_client_target_updated` was

Slice **9.4c** — a quote-level target **per tier**, held as a direct column on
`quote_tiers`, with a reconciliation rule comparing the sum of per-cell targets
against it. It was **built and then pulled back** on a surface-placement audit.

Migration history:

| migration | effect |
|---|---|
| `0014` | added `quote_tiers.client_target_price_per_unit` (Slice 9.1, speculative, never UI-wired) |
| `0016` | dropped it; created the per-(SKU, tier) sister table (Slice 9.4b) |
| `0018_pullback_client_target` | dropped `client_target_price_total` **and** `client_target_price_per_unit` from `quote_tiers` (9.4c pullback) |
| `0034` | created `assembly_leaf_targets` (Slice 11.5) |

**No corresponding persistence survives.** `quote_tiers` has zero
`%target%` columns.

**But 7 `quote_level_client_target_updated` audit rows are live in the
database.** The pulled-back feature wrote in production before being reverted,
and those rows describe a column that no longer exists. They are orphans: not
harmful, not readable back to anything, and worth deciding about explicitly
rather than discovering during a future audit sweep. Recommend leaving them
(audit history is a record of what happened, and it did happen) with a note
here so the next reader is not misled into thinking quote-level persistence
exists.

The pullback's stated reasons are still relevant, and one of them is now
resolved:

- *"the affordance was being placed on the Pricing Control Summary, which §5
  commits to consolidating away"* — resolved. The surface it would have gone on
  no longer exists; the dispositioned home is Setup's former Price Adj area,
  with read-only context on Costs and Pricing.
- *"per-tier per-unit framing doesn't map to real customer negotiation
  patterns"* — this is the observation the current requirement refines rather
  than contradicts: the common case is **one target**, with per-tier variation
  as the exception. A model whose default IS one target, with tier-specific as
  an override, matches that.

---

## 6 · Smallest persistence model that supports the requirement

One sparse table, keyed on the **top-level sellable unit**, with a nullable tier
for the default.

```sql
create table quote_client_targets (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references quotes(id)      on delete cascade,

  -- exactly one of these two: the sellable unit the client named a price for.
  assembly_id   uuid references assemblies(id)           on delete cascade,
  quote_leaf_id uuid references quote_leaves(id)         on delete cascade,

  -- NULL = the common target, applying to every tier.
  -- Set  = this tier only, REPLACING the common one for that tier.
  tier_id       uuid references quote_tiers(id)          on delete cascade,

  client_target_price_per_unit numeric(10,4) not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quote_client_targets_one_unit check (
    (assembly_id is not null and quote_leaf_id is null) or
    (assembly_id is null and quote_leaf_id is not null)
  )
);
```

Four partial unique indexes, because a plain unique index treats NULL tiers as
distinct and would permit several "common" rows:

```sql
create unique index on quote_client_targets (assembly_id)
  where assembly_id is not null and tier_id is null;
create unique index on quote_client_targets (assembly_id, tier_id)
  where assembly_id is not null and tier_id is not null;
create unique index on quote_client_targets (quote_leaf_id)
  where quote_leaf_id is not null and tier_id is null;
create unique index on quote_client_targets (quote_leaf_id, tier_id)
  where quote_leaf_id is not null and tier_id is not null;
```

(PG15's `UNIQUE NULLS NOT DISTINCT` would collapse each pair into one index.
Partial indexes are proposed instead because they state the two cases
explicitly and do not depend on a server-version behaviour.)

### Why this shape

- **The key is the unit of account.** An Item Group's target attaches to the
  Item Group; a Direct Product's to the leaf, which *is* the sellable unit. No
  arbitrary member, ever.
- **`tier_id NULL` = common** is a first-class fact, not N coincidentally equal
  rows. One target edits as one row.
- **Resolution is a precedence the surface already governs.** Tier-specific
  replaces common for that tier; it does not stack. Identical in shape to
  `tier_price_adj_pct` replacing `global_price_adj_pct`, which operators have
  just been walked through — so the rule needs no new mental model.
- **Polymorphic but referentially intact.** Both FKs cascade, so deleting an
  Item Group or a Direct Product takes its targets with it. A single text
  `sellable_unit_id` with no FK would be smaller and would leak orphans.

### The one invariant the schema cannot hold

A CHECK cannot see another table, so *"`quote_leaf_id` must reference a DIRECT
leaf (`quote_leaves.assembly_id IS NULL`)"* is an action-layer guard — the same
posture as one-recommended-tier-per-quote, which is enforced in
`setTierRecommended` with no DB constraint. Writing a target against an Item
Group member must be **refused**, not silently accepted and then ignored by the
engine as it is today.

### Alternative considered and rejected

**Quote + tier only** (no per-unit dimension) is smaller and matches the
requirement's literal wording, which mentions tiers but not products. Rejected
because a quote can sell several sellable units and a client names a price for
a *product*; a quote-level target would have to be reconciled against the units
beneath it, which is precisely the reconciliation machinery 9.4c built and the
pullback set aside. If the firm's real brief is genuinely one number per quote,
this is the cheaper model — flagging it as a decision point rather than
assuming.

---

## 7 · What ships alongside, and what does not move

**Downstream work the model implies** (not part of this trace):

- **Adapter:** resolve common-or-tier-specific per sellable unit, then project
  onto the cells the engine keys — so the engine's per-cell verdict keeps
  working unchanged. For an Item Group the target belongs to the assembly; how
  its verdict is computed is a design question this trace deliberately leaves
  open, because `competitiveStatus: null` on assemblies is currently a
  deliberate refusal and reversing it is an engine decision, not a UI one.
- **Classifier:** the first-non-null collapse (§4) has to go. Once targets can
  legitimately vary by tier, one value per row is a wrong answer rather than a
  simplification, and the delta must be computed against the same target the
  chip was decided against.
- **Grid:** its stated assumption and its test both need revisiting.

**Explicitly unchanged:**

- **Engine arithmetic.** A target is a benchmark; it enters no price, no
  margin, no total. `costBaseFingerprint` already excludes `cellTargets` by
  disposition, and that stays.
- **Quote / PDF / NetSuite.** Client Target is internal. Verified absent from
  `customer-view-resolver.ts`, `src/components/pdf/**` and `src/lib/netsuite/**`
  today; it must stay absent, and the customer-view boundary guard should be
  extended to name it so the absence is enforced rather than merely current.

**Surfaces to be built** per the dispositioned workflow: Setup authors it (the
former Price Adj area); Costs shows it read-only against Base Sell; Pricing
shows it read-only against Base Sell, Margin Target/Required Sell and Final
Quoted Sell. Costs has no Client Target context today
(`src/components/costs/**` — no references).
