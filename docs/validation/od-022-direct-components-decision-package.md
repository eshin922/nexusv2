# OD-022 · Direct Components — implementation decision package

**Not implemented. For review.** 2026-08-12.

Business dispositions received: Direct Components ship in V1; Mixed structure is
valid; `detail_level` becomes presentation-only and **Product Structure becomes
the grouping authority**.

Track B / REG-4 stays closed. This slice changes **what is supplied to** the
certified Item Group machinery, not how that machinery works.

---

## 0 · The dependency that governs the whole slice

**[OD-017](../OPEN_DECISIONS.md) is this slice's critical path, and disposition 1
settles its open question.**

> Every cost-input table — `assembly_leaf_inputs`, `assembly_leaf_overrides`,
> `assembly_leaf_targets` — keys on `assembly_leaf_id`. A direct canonical
> attachment (`quote_leaves.assembly_id IS NULL`) has no such row, so **no cost
> can be authored against it.** … Under ASY-optional authoring it becomes the
> main path, at which point the tables must key on `quote_leaf_id`.

So a Direct Component is not merely invisible to the Sales Order — **it cannot
be costed at all**. Removing the attach guard without re-keying the cost tables
would produce components that are structurally present, permanently unpriced,
and silently dropped downstream. That is the failure this package exists to
prevent.

**OD-017 is itself blocked by [OD-012](../OPEN_DECISIONS.md): `npm run
db:generate` must not be used** — Drizzle's snapshots stop at `0048` while
migrations run past `0062`, so the generator would emit destructive DDL. Every
migration below must therefore be **hand-authored**, in the established style of
`0064` / `0065`.

**Dependency order is fixed and not negotiable:**

```
OD-012 (hand-authored migrations only)
   └─ OD-017 (re-key cost inputs to quote_leaf_id)
        └─ OD-022 (Direct Components reachable)
```

---

## 1 · Current assumptions that break for Direct Components

Classified by inspection. Marked **[verified]** where read directly, **[verify]**
where the layer needs confirmation during implementation rather than assumption.

| layer | classification | detail |
|---|---|---|
| **Product Library** | already correct | Library leaves are quote-agnostic; nothing binds a library entry to an assembly. **[verified]** |
| **Setup / Add Component** | **requires new branch** | Attach is hard-blocked without an assembly (*"Create an ASY first to enable attach"*), and the target selector has no "no assembly" option. **[verified]** |
| **Quote tree construction** | **assumes every leaf has an assembly** | `loadAssemblyTree` selects `assembly_leaves WHERE assembly_id IN (quote's assemblies)`. A Direct Component is **structurally unreachable** — not dropped, never loaded. **[verified]** |
| **Costing — input tables** | **requires new branch (OD-017)** | All three cost tables key on `assembly_leaf_id`. No row can exist for a Direct Component → uncostable. **[verified]** |
| **Costing — adapter** | **partially ready** | `costing-adapter.ts:140` already reads `row.assemblyLeafId ?? row.quoteLeafId`. The identity fallback exists; the *rows* do not. **[verified]** |
| **Pricing** | likely already correct | OD-014 settled the commercial SKU as `quote_leaves.id`, and a direct attachment already surfaces with unpriced cells via missing-cell semantics. **[verify]** |
| **Customer View** | **[verify]** | Builds `assemblyByLeafId` and branches on `skuRole === "assembly"`; behaviour for a leaf with no assembly entry needs confirmation, not assumption. |
| **PDF** | **[verify]** | Downstream of Customer View; inherits whatever that resolves. |
| **Send / freeze** | **requires new branch** | Snapshot must carry structure (§4). Today grouping is re-derived at Complete from **live** assemblies. |
| **grouping-plan** | **requires new branch** | `PlanLineInput` requires `assemblyId` / `assemblySku` / `assemblyName` as non-optional; `buildGroupingPlan` buckets every line `byAssembly`. No representation for "no assembly". **[verified]** |
| **markComplete / SO lines** | **silently drops** | Each leaf is looked up via `tree.assemblies → children`; no match → `continue`. No error, no warning, totals still reconcile. **[verified]** |
| **Reconciliation** | **insufficient as evidence** | A dropped leaf removes its revenue from *both* sides. The order still balances against itself. This is why §9 exists. |
| **Audit / snapshot** | extend | `item_group_definitions` already lands pre-CREATE; flat lines need equivalent projection evidence. |

---

## 2 · Proposed governed Product Structure representation

**Use the existing nullable. Do not add a mode enum.**

`quote_leaves` is already the canonical governed SKU (OD-014). `assembly_leaves`
is the ASY-membership junction referencing it. Today they are 1:1 (150 / 150).

```
Finished Product member : quote_leaves.assembly_id IS NOT NULL
Direct Component        : quote_leaves.assembly_id IS NULL
```

**Why not an explicit `structure_kind` column:** it would be a second authority
for a fact `assembly_id` already states, and the two could disagree. One nullable
column cannot contradict itself. Classification stays derivable, and the
"a leaf cannot be both" invariant (§9) becomes true *by construction* rather than
by validation.

**Operator vocabulary** (implementation identifiers retained only in technical
detail):

- **Finished Product** — *Components sold together as one finished commercial
  product. Nexus preserves this composition downstream as a NetSuite Item Group.*
- **Direct Component** — *An independently sold component. Nexus sends it
  downstream as an individual NetSuite Item line.*

---

## 3 · Exact schema changes

All hand-authored (OD-012).

**M1 — re-key cost inputs to `quote_leaf_id` (OD-017).** The substantial one.
`assembly_leaf_inputs`, `assembly_leaf_overrides`, `assembly_leaf_targets` gain
`quote_leaf_id`, backfilled from `assembly_leaves.quote_leaf_id`. Since
`assembly_leaves` is 1:1 with `quote_leaves` today, the backfill is total and
lossless. Old column retained through one release, then dropped — never in the
same migration as the code that stops reading it (per the banked
migrations-before-code rule).

**M2 — snapshot structure (§4).**

**No change** to `quote_leaves` itself. The capability already exists there.

---

## 4 · Snapshot / freeze changes

**The problem:** grouping is currently derived at Complete from **live**
assemblies. A Setup edit between Send and Complete silently changes the
structure of an already-sent quote. Today that is masked because structure is
uniform; with Mixed quotes it becomes a real divergence — a component could move
in or out of a Finished Product after the customer committed.

**Required:** the accepted snapshot must carry, per governed leaf:

- `quote_leaf_id` (the commercial SKU identity, OD-014)
- its structural classification at freeze time
- for Finished Product members: the owning assembly's **id, SKU and name**
  (SKU is identity-bearing — §11)
- `qtyPerParent`

`markComplete` then builds the plan **from the snapshot**, not from
`loadAssemblyTree`. This also removes the current live-read dependency that
Pattern 52's draft-lock only conventionally protects.

---

## 5 · Authoring / Product Library changes

Per the brief: removing the guard is **not** an implementation. There must be an
explicit operator decision.

**Attach flow.** The "ATTACHING TO" selector gains a first-class, always-present
option — not a null state:

```
ATTACHING TO
  ◉  Sold on its own            (Direct Component)
  ○  OD004 Cert Group A          (Finished Product)
  ○  + New Finished Product
```

This makes the decision unavoidable and answerable, and makes Mixed quotes
natural: the operator chooses per component, and both kinds sit in the same tree.

**Creation modal.** Rename the mode toggle to **Finished Product / Component**
with the §2 descriptions, replacing `ASY` / `LEAF` and *"Quotable product ·
commercial fields"* (which describes form fields, not commerce). Carried from the
§5A recommendation of the prior review.

**Setup tree.** Direct Components render as top-level rows, visually peer to
Finished Products, not nested and not orphaned.

**Product Library.** No restructuring. One addition only: a Finished Product's
row should show its component composition, since that composition is now
identity-bearing.

---

## 6 · Customer View / PDF implications

**`detail_level` stays presentation-only, exactly as dispositioned.** The change
is a *removal*: `buildGroupingPlan` must stop reading it as
`groupingRequired`. Grouping becomes a function of structure alone.

Four combinations, three obviously defined:

| | `itemized` | `turnkey_only` |
|---|---|---|
| **Finished Product** | line per component under the product | one all-in number |
| **Direct Component** | its own line | folded into the tier total |
| **Mixed** | products + standalone lines | one all-in number |

**The one that needs a business answer, not an invention:** *Mixed* under
`turnkey_only`. A single all-in number is well-defined arithmetically, but it
presents independently-sold components as part of a turnkey product — the exact
claim the Direct Component distinction exists to avoid. Flagged rather than
resolved; the customer-facing wording is a commercial decision.

Note this is now **presentation only** — whichever way it is answered, the Sales
Order structure is unaffected. That separation is the point of disposition 3.

---

## 7 · grouping-plan changes

Extend the existing frozen plan. **Do not add a second authority.**

- `PlanLineInput.assemblyId / assemblySku / assemblyName` become **nullable** —
  null meaning Direct Component.
- `buildGroupingPlan` buckets null-assembly lines into a new
  `directLines: PlanLine[]` alongside `groups`, instead of `byAssembly`.
- `groupingRequired` derives from `groups.length > 0`, **not** from
  `detailLevel`. The `applicability` field, currently sourced from
  `detail_level`, is removed from grouping authority.
- `derivable` continues to mean *every group has an identity*; Direct Components
  need none.
- Reconciliation target becomes **Σ group amounts + Σ direct line amounts**.

**Direct Components must never be synthesized into one-member Item Groups.** A
one-member group is a legitimate Finished Product shape — Group B of the
certification is exactly that — so synthesizing one would make the two
structures indistinguishable in NetSuite and destroy the distinction at the only
layer that records it.

---

## 8 · markComplete / Sales Order projection

The payload builder already supports both shapes — and currently **refuses them
together** (`sales-orders.ts`), because Probe 7a proved that group lines plus
explicit member lines duplicate.

**That refusal must be narrowed, not deleted.** The prohibition is on emitting a
group's **own members** as explicit lines. A Direct Component is not a member of
any group, so `item: { items: [...groupLines, ...directLines] }` is correct. The
guard should assert *no direct line's item is also a member of an emitted group*
— which is stronger than today's blanket check and directly enforces the "not
both" half of §9.

Rate convergence applies to **group members only**. Direct Components carry their
negotiated rate on the line at CREATE, like the certified flat path (SO2701).

---

## 9 · Fail-closed invariants

> **Every governed commercial leaf in the accepted snapshot must project exactly
> once into the Sales Order structure.**

Enforced as an explicit count, not inferred:

```
projected = Σ group members + Σ direct lines
assert projected set == snapshot governed leaf set   (exactly, by quote_leaf_id)
assert no leaf appears in both
```

**Reconciliation is explicitly insufficient** and must not be accepted as
evidence: a dropped leaf removes its revenue from both the expected total and
the observed one, so the order balances against itself. This is the same
attribution-vs-completeness distinction banked in CLAUDE.md, and the reason the
current `continue` is invisible.

**The `continue` is deleted.** A leaf that cannot be projected raises — before
CREATE, where failure is still free.

---

## 10 · Mixed-quote behaviour

One quote, both kinds, one SO payload: group lines for Finished Products, flat
lines for Direct Components. No quote-wide structural mode.

Reconciliation: `Σ group expectedAmount + Σ direct amounts = accepted total`.
The success gate extends to assert flat-line rates and amounts alongside the
existing group assertions.

---

## 11 · Finished Product SKU rename semantics

**Established fact:** the Finished Product SKU is the `baseSku` in the
composition hash. Changing it yields a different `nxs-grp-*` identity — a
different reusable product record in NetSuite. It is presented today as free
text with placeholder *"auto-generated if blank"*.

**Proposed treatment:**

- **Before send** — renaming is harmless; no group exists. No warning needed.
- **After a group exists for that composition** — renaming creates a *new*
  downstream product rather than renaming the existing one. Copy, without
  hashing internals:
  > *This name identifies the product in NetSuite. Changing it creates a new
  > product record there — the previous one stays as it is.*
- **Audit** — a rename after first group creation should record the prior SKU,
  so a later reader can explain why two similar groups exist.
- **Invalidation** — **none.** Existing groups must not be mutated or retired on
  rename; they are shared master data that other orders may reference. This is
  the same reasoning that kept `75156` / `75254` intact rather than re-quantified.

---

## 12 · Backward compatibility / migration

**Existing data is uniformly ASY-backed: 150 `quote_leaves`, 0 assembly-less,
150 `assembly_leaves`.** That is the whole risk story.

- Every existing leaf classifies as a Finished Product member **with no data
  change** — the nullable is already non-null everywhere.
- The M1 backfill is 1:1 and total.
- **No historical structure is rewritten.** Existing Finished Products retain
  current semantics.
- Sent and completed quotes are unaffected; snapshot structure (§4) applies to
  quotes sent after it ships, with a documented read-fallback for older
  snapshots.

**One live-data caveat:** dev and prod share a database, so M1 lands in
production the moment it is applied — migrations before the code that reads
them, per the banked rule.

---

## 13 · Implementation slices, in dependency order

| # | slice | gate |
|---|---|---|
| **0** | Resolve **OD-012** — repair the Drizzle baseline, or ratify hand-authored-only | nothing else may author a migration |
| **1** | **OD-017**: M1 re-key cost inputs to `quote_leaf_id`; adapter/actions read new column | existing quotes cost identically; 942+ suite green |
| **2** | Tree + classification: `loadAssemblyTree` loads assembly-less leaves as top-level; classification derived from `assembly_id` | a hand-seeded Direct Component appears in Setup, Costs, Pricing |
| **3** | Authoring: attach-target choice, renamed toggle, tree rendering | an operator can deliberately create either, and Mixed |
| **4** | Snapshot structure (M2) + freeze; markComplete reads snapshot not live tree | post-Send Setup edit cannot change a sent quote's structure |
| **5** | grouping-plan `directLines`; `groupingRequired` off `detail_level` | plan projects Mixed correctly; unit-provable |
| **6** | SO projection + narrowed payload guard + §9 invariants + gate extension | fail-closed proven by falsification |
| **7** | Customer View / PDF for Mixed; §6 combination answered | both structures render under both presentations |
| **8** | One live sandbox certification of a **Mixed** quote | new provider evidence, same discipline as Track B |

Slices 1–2 are invisible to operators. The capability first becomes reachable at
slice 3 — deliberately after costing works, so a Direct Component is never
creatable-but-unpriceable.

---

## 14 · Regression / falsification plan

Governed command only (`npm run test:unit`), baseline on `main` first.

**Must pass:**

1. Direct Component projects to exactly one flat SO line, never a one-member group.
2. Finished Product still projects to its certified deterministic group — Track B behaviour unchanged.
3. Mixed quote emits group lines and flat lines in one payload; reconciliation = Σ groups + Σ flat.
4. `detail_level` does **not** affect `groupingRequired` in any of the four combinations.
5. Snapshot structure governs: mutating live assemblies after Send does not change the projection.
6. Finished Product SKU rename yields a different identity; the prior group is untouched.

**Must fail (falsifications — the ones that matter):**

7. A leaf present in the snapshot but absent from the projection → **refused**, even though totals reconcile. *(the current silent `continue`)*
8. A leaf projected both as a group member and as a flat line → **refused**, even though totals reconcile. *(double-count with a correct sum)*
9. A Direct Component synthesized into a one-member group → **refused** as indistinguishable from a legitimate one-member Finished Product.
10. A group's own member emitted as an explicit flat line → **refused** (Probe 7a duplication, preserved).
11. An empty Finished Product composition → **refused**.
12. A cost authored against a Direct Component before slice 1 → proves the OD-017 ordering is load-bearing.

Tests 7 and 8 are the point of the plan: both reconcile perfectly and are both
wrong. Any suite that only checks totals passes them.

---

## Scope kept

Track B / Item Group machinery untouched — this changes its input. OD-021
separate. No implementation, no mutation; this package is reads only.
