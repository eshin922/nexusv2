# P3-017 · The Pricing Cost Stack is not the accepted R11/R12 stack

**Status: FULLY CLOSED 2026-08-10.** Both halves shipped — the price ladder
published at tier scope (`94f8c63`), then the R11/R12 layout restored from the
Design Authority (`b4ebbd5`) — and the S-7 preservation check dispositioned by
cause and returned to green as a governed `prebuild` step (`168f76d` + this
commit). Nothing was restored to make a digest green; nothing was re-baselined.

*Original finding, retained below.* **VERIFIED 2026-08-10 — incomplete
implementation, not intentional simplification.** The Design Authority was to be
restored, not replaced with a new layout.

**Presentation and information architecture. Not arithmetic.** Business
semantics are settled and unchanged; every number the production stack shows is
correct. What is missing is the reconciliation that explains how `Quoted sell`
is constructed.

---

## The question Edward asked

> Verify whether this was an intentional simplification or an incomplete
> implementation of the accepted R12 Cost Stack.

**Incomplete implementation.** Four independent pieces of evidence, one of them
conclusive.

## What the Design Authority specifies

R12 designer notes §0: *"Everything R11 established holds: … the cost stack as
trace level 1 **transposed**, entry-at-node, the reconciliation assertion…"*

R11 §4, *"The stack reconciles all the way to the quoted price"*:

```
[the six level-1 section nodes]
Sell before adjustment
+ Price adjustment      (tier ?? global — replaces)
+ Surgical lifts        (corrective — one cell each)
+ PM overrides          (not derived — a human act)
= Quoted sell
  Unit cost
  Margin
```

Then a **reconciliation strip** asserting the arithmetic across every tier at
once — `sellBefore + adjDelta + liftDelta + overrideDelta === sell` — with the
canonical copy *"every column reconciles — sections + adjustment + lifts +
overrides = quoted sell, at all four tiers."*

Two rules in R11 are marked load-bearing:

> **11.** The `PM overrides` row. Without it the stack silently stops
> reconciling wherever an override exists.

> **Every lever that can change a quoted price owes the cost stack a row.** If
> it cannot be shown as a row, the stack cannot assert reconciliation, and the
> assertion is the thing that makes the stack trustworthy. **← LOAD-BEARING**

## What production renders

`detail-zone.tsx:690` — a `psr-tier-table` with **tiers as rows**:

```
Tier | PKG | PROD | RAW | FRT | D+T | Sell before adj | Quoted sell · unit | Margin
```

| canonical row | in production |
|---|---|
| section nodes | ✅ as columns |
| Sell before adjustment | ✅ as a column |
| **Price adjustment** | ❌ **absent** |
| **Surgical lifts** | ❌ **absent** |
| **PM overrides** | ❌ **absent** |
| Quoted sell | ✅ as a column |
| **Unit cost** | ❌ **absent** — the name was reused for the section subtotal, then renamed away |
| Margin | ✅ as a column |
| **Reconciliation strip** | ❌ **absent** |

Three of the four terms in the reconciliation have no row, so the assertion is
not merely missing — it is **unstateable**.

## The evidence

**1 · The reconciliation strip's stylesheet is in the repo with zero callers.**

`.r11-recon` is defined in `src/styles/r11-pricing-workspace.css` and referenced
by **no JSX anywhere in `src/`**. The canonical CSS was adopted verbatim per
Pattern 30; the component it styles was never built. An intentional
simplification does not import the stylesheet for the thing it decided to omit.

This is the orphan shape CLAUDE.md already records under *"Surface unification
can orphan components"* — the file exists, nothing renders it, and it goes
unnoticed for months.

**2 · The stylesheet states the contract the implementation contradicts.**

`r11-pricing-workspace.css:196`:

> *Trace level 1, transposed: components as rows, every tier at once.*

Production renders tiers as rows and components as columns — the transpose of
what the adopted stylesheet describes. The canonical `.r11-srow` / `.r11-slab` /
`.r11-scell` grammar **is** used in production, but by `compliance-grid.tsx`.
The stack itself uses `psr-tier-table` from the **overrides** stylesheet — a
Nexus-authored table, not the canonical stack.

**3 · A rename resolved a contradiction that only exists because two rows were
collapsed into one.**

`detail-zone.tsx:705`:

> *Was "Unit cost". These columns carry MARKED-UP component values, so the
> figure is sell-side; describing it as cost made the row read as impossible
> beside the sell column.*

Correct diagnosis, and the canonical design has no such problem: `Unit cost` is
its own row **below** `Quoted sell`, while the component rows sum to `Sell
before adjustment`. Production collapsed two distinct rows into one column, hit
the contradiction that produced, and renamed the column. **That is the signature
of an incomplete port meeting the design's own logic** — the design was right,
and the implementation reached for a label instead of the missing row.

**4 · The history explains it, and no decision closes it.**

The pricing-surface redesign brief, §"Components to REUSE":

> **R6 cost stack:** composed from `app/r6/cost-stack.jsx`, not reinvented.
> Treat R6 as a black box dependency.

R6's stack is `PKG · PROD · RAW · FRT · D+T` — exactly what production renders.
So the carry-over was **deliberate and correct at the time**, and it predates
R11. R11 then redesigned the stack, R12 built staging on top of it, and R12's
staging half **was** implemented — the production cells carry `renderDelta` and
staged margin deltas in points, per R12 §6.

**Nothing recorded a decision to keep the R6 stack once R11 superseded it.** The
R12 delta work was fitted onto the R6 table. There is no Pattern 39 extension
header, no OPEN_DECISIONS entry, and no brief disposition anywhere in the repo
recording a deliberate divergence.

## Why it matters beyond fidelity

The three missing rows are exactly the three levers an operator manipulates on
this surface — the quote-wide/per-tier adjustment, surgical lifts, and PM
overrides. So the drift has a workflow consequence, and it is the one Edward
observed: **the adjustment controls are visually disconnected from the
reconciliation they are meant to influence.** An operator changes a lever and
the stack shows a different `Quoted sell` without showing the lever's
contribution — which is the R6 failure the whole R10→R12 line of work was
built to prevent.

It is also the same shape as P3-016 one layer up. There, a lever wrote without
appearing in the staging model. Here, a lever moves a price without appearing in
the reconciliation. Both are levers acting outside the structure that is
supposed to account for them.

## Restoration scope — not started (authority now published; see the gate below)

Restore R11 §4 as accepted; do not invent a layout.

1. **Transpose** — components as rows, tiers as columns, per the adopted
   stylesheet's own contract. Reuse the canonical `.r11-srow` / `.r11-slab` /
   `.r11-scell` grammar already in production for the compliance grid.
2. **Three missing rows**, each conditional exactly as the canonical source has
   them: `Price adjustment` always; `Surgical lifts` when any exist;
   `PM overrides` when any exist.
3. **`Unit cost` restored** as its own row below `Quoted sell`, which lets the
   section subtotal go back to being `Sell before adjustment` and retires the
   rename.
4. **The reconciliation strip** — `.r11-recon` finally rendered, asserting
   `sellBefore + adjDelta + liftDelta + overrideDelta === sell` across all tiers.
5. **Preserve what already works** — R12 staged deltas on component rows,
   `Quoted sell` and `Margin` (in points); entry-at-node tracing on every cell.

## Pre-implementation gate — **STOPPED 2026-08-10**

> Verify that adjustment, lift and override deltas already exist as governed
> values. If any must be recomputed in the presentation layer, stop and classify
> that as a reconciliation-authority defect rather than implementing around it.

**They do not. Implementation stops here.**

### What the blend publishes

`BlendedTierComponents` carries seven governed values per tier, each read
through `readNodeValue` from a canonical node key:

```
pkg · prod · raw · frt · dt · sellBefore · sell   (+ margin, nullable)
```

Those are **the two endpoints and the components beneath the first one.**
Between `sellBefore` and `sell` sit three levers, and the blend publishes no
level between them.

### Why that cannot be worked around in the display layer

The three deltas are differences between successive levels:

```
adjDelta       = sellAfterAdjustment − sellBefore
liftDelta      = sellAfterLift       − sellAfterAdjustment
overrideDelta  = sell                − sellAfterLift
```

**Neither intermediate level is published at tier scope**, so none of the three
is recoverable. And they are not recoverable *in principle* from what is
published: `sell − sellBefore` is the sum of all three, and one gap cannot be
split into three addends. A display layer could only re-derive them by
re-running the per-cell arithmetic and re-blending it — a second computation of
values the graph already owns, which is the defect this stack exists to prevent.

`Unit cost` blended is absent for the same reason: all seven published values
are sell-side.

### The defect, stated precisely

**The per-cell graph is correct.** `adjustmentNode`, `liftedNode` and the
override node all exist, and `costing.ts` cites R11 §13.2 by name while building
them — *"every lever that can change a quoted price owes the cost stack a row…
So this is a constraint on the graph, not on the UI."* The rule was honoured
where the nodes are built.

**The blend does not carry it forward.** Blending to tier scope publishes the
first level and the last, and drops the levers in between. So at the scope the
stack actually renders, the reconciliation the graph can express becomes
unstateable — not because the UI is wrong, but because the governed values it
would read do not exist at that scope.

**This is a reconciliation-authority defect, not a layout task.** It sits
upstream of P3-017's restoration and gates it: restoring the rows first would
force exactly the presentation-layer recomputation the rule forbids, and the
first row rendered from a re-derived number would be the next divergence
(CLAUDE.md, *"Two computations for similar-labeled displays will diverge"*).

### Which quantities become published authority — the determination

Edward's three candidates are necessary. **They are not sufficient**, and the
reason matters more than the list.

**Necessary — the missing intermediate levels.**

| published node | why |
|---|---|
| `sellAfterAdjustment` | the level between `sellBefore` and the lift. Without it the adjustment row has no upper bound to sit against |
| `sellAfterLift` | the level between adjustment and override. It also bounds the override row from below |
| `unitCost` (blended) | the `Unit cost` row. Every value published today is sell-side; this is the only cost-side quantity the stack shows, and it is what retires the `Sell before adj` rename |

With those three, all four levels of the ladder exist at tier scope:
`sellBefore → afterAdjustment → afterLift → sell`.

**Not sufficient — and this is the part that decides whether the strip means
anything.**

If each row's delta is computed in the presentation layer as the difference of
two published levels, the reconciliation strip asserts

```
sellBefore + (a − sellBefore) + (l − a) + (sell − l)  ===  sell
```

which telescopes. **It is true for any four numbers, so it can never fail.** A
strip that cannot fail is not an assertion; it is decoration — and the whole
argument for the stack is that the assertion is what makes it trustworthy.

So the **deltas themselves must be published**, not just the levels:

| published node | |
|---|---|
| `adjDelta` | the adjustment's contribution in dollars |
| `liftDelta` | the lifts' contribution |
| `overrideDelta` | the overrides' contribution |

Then the strip asserts that **independently published levels and independently
published contributions agree** — an identity over six governed values that can
genuinely fail if the blend is wrong, which is exactly what it is for.

This is also Pattern 57 read strictly: a stack row asserts it is an
independently governed commercial quantity. A row whose value is a subtraction
the display performed is not one.

**Six published quantities, then, not three.** The three levels make the ladder
expressible; the three deltas make the assertion falsifiable.

### Published tier-scope authority — the accepted set (2026-08-10)

Eight quantities, published at tier scope:

```
sellBeforeAdjustment · adjDelta      · sellAfterAdjustment
                     · liftDelta     · sellAfterLift
                     · overrideDelta · quotedSell
blended unitCost
```

**The constraint that makes them worth publishing:**

> **Do not obtain the deltas by subtracting the published levels.**

Each contribution node aggregates from the governed **per-cell** adjustment /
lift / override authorities. Each post-lever level aggregates independently from
the corresponding governed cell states. The two aggregations never consult each
other.

That independence is what makes the strip falsifiable.
`sellBefore + adjDelta + liftDelta + overrideDelta == quotedSell` is then an
assertion that **two independent aggregations of the same underlying graph
agree** — it fails if the blend is wrong. Obtained by subtraction it telescopes
and holds for any four numbers. The intermediate levels are verified separately,
under the same independence.

**Gate for the layout work:** do not start the R11 restoration until this
tier-scope authority exists **and reconciles independently**. P3-017 stays on
its own track and is not folded into presentation work.

### What has to happen first

The blend must publish `sellAfterAdjustment`, `sellAfterLift` and blended
`unitCost` as governed values with canonical node keys, exactly as it publishes
`sellBefore` and `sell` today. Then every stack row reads a node, the deltas are
differences between published levels, and the reconciliation strip asserts an
identity over values the graph owns.

**SHIPPED 2026-08-11 — the gate is open.** The math layer now publishes all
eight quantities at tier scope. `sell-before`, `sell` and `cost` already
existed; `adj-delta`, `sell-after-adj`, `lift-delta`, `sell-after-lift` and
`override-delta` are new, each aggregating independently through the same
weighted `blend` the other tier nodes use.

**The deltas come from the levers' own rates, not from differences between the
levels.** That is the part that makes the strip mean anything, and it is easy to
get wrong in a way that still reconciles. Blending is linear over a shared
weight vector, so `blend(a − b)` is exactly `blend(a) − blend(b)` — deriving the
deltas by subtraction would telescope *through* the aggregation and leave an
identity true for any four numbers. So `adjDelta = sellBefore × adjustmentRate`
and `liftDelta = adjustedSell × liftRate`, per cell, before blending.

`overrideDelta` is the one honest exception: an override is terminal — a
person's number replacing a computed one — so its contribution *is*
definitionally the difference it makes. There is no rate to multiply by, and
inventing one would be worse than naming the difference.

Assembly rollups fold the ladder the same way every other per-unit quantity
folds (child × `qtyPerParent`), so the identity holds for assemblies built from
reconciling children.

Proven in `tests/unit/p3-017-tier-ladder-authority.test.ts`: the eight nodes
exist and are distinct; the identity reconciles with a lift and an override
live; the intermediate levels sit where the ladder says; a lift moves
`lift-delta` without touching `adj-delta`; a rejected lift contributes zero
while staying reachable as a node; and each tier's `adj-delta` scales with the
rate *that tier* resolved — 10% global on T1, its own 20% on T2, which is what
pins the deltas to the authorities rather than to the levels beside them.

## Layout restoration — SHIPPED 2026-08-10

Restored from the registered Design Authority, not evolved from the R6 summary.
The stack is **transposed**: quantities are rows, tiers are columns, which is
what makes a column readable as one tier's price from what the sections cost to
what the customer is quoted, with every lever that moved it in between.

Row order, canonical: five blended sections → `Sell before adjustment` (rule) →
`Price adjustment` → `Sell after adjustment` → `Surgical lifts` → `Sell after
lifts` → `PM overrides` → `Quoted sell` (total rule) → `Unit cost` → `Margin` →
`ReconStrip`.

**Every rendered quantity is READ, none derived.** `blendedByTier` in
`pricing-surface-shell.tsx` resolves all thirteen through
`readNodeValue(graph, quoteScopeKey(tierUuid, name))`, which fails closed on
missing, duplicate *and* flagged-out nodes; a tier missing any one of them is
omitted from the map entirely rather than partially filled. No level is
subtracted from another to manufacture a contribution row.

### The two conditional rows key on EXISTENCE

`Surgical lifts` and `PM overrides` render when any column has a lever, never
when a contribution is non-zero. A lift refused by an override contributes
exactly nothing (§13.3, pinned by the authority test), so keying on the delta
would delete the one rendering that shows a refusal happened. The row appears
because the lever was pulled; the contribution says what it moved, including
when the answer is nothing.

### Four decimals is load-bearing

The Design Authority renders every stack row at `money(v, 4)` and the port now
matches. At two decimals a $0.0035 lift displays as `+$0.00` and the visible
column stops adding up — while the strip, reading the underlying values, still
says it does. A correct assertion sitting under numbers that appear to
contradict it is worse than either alone.

### Verification

| requirement | evidence |
|---|---|
| each column reconciles sell-before → quoted sell | `tests/e2e/costing/cost-stack-ladder.spec.ts` sums the figures **read from the DOM**, independently of the component's own predicate, within the display's rounding budget |
| unit cost and margin read governed tier values | both resolved via `readNodeValue` from `quote/{tier}/cost` and `quote/{tier}/margin`; the margin cell offers no trace when the ratio is undefined |
| the assertion can fail | `tests/unit/p3-017-cost-stack-reconciliation.test.ts` — 8 tests over deliberately corrupted fixtures, including a corrupted *contribution* rather than only a corrupted total. Separately falsified end-to-end: rendering `sell-after-adj` in the `Quoted sell` row failed the e2e (`0.9499 + 0 + 0 + 1.9883 = 2.9382, but Quoted sell renders 0.9499`); reverted and re-verified byte-identical |
| no S-7 governed scalar moves | `gate1b:verify-preserved` output **byte-identical** with and without the restoration (see below) |

Gates: `test:unit` 731/731, `prebuild` PASS, `tsc` clean, `test:e2e` **26
passed / 2 failed** — both the previously-classified freight findings.

### One defect this introduced, and its repair

The first cut put `role="status"` on the reconciliation strip. It is not in the
Design Authority and it does not belong — an ARIA live region announces a
*transient* message about something that just happened, and the strip is a
standing assertion about the numbers above it. It also made every
`getByRole("status")` on the pricing surface ambiguous and broke VAL-208, which
waits on the "Pricing updated." confirmation. Repaired by removing the addition,
not by narrowing VAL-208's locator: an unrelated test that starts failing is
reporting something true.

## S-7 preservation — CLOSED 2026-08-10

**Dispositioned by cause, not by re-baseline.** The 23 additive fields are
accepted under A-1; the single `blendedMarginPct` movement is
[AM-005](AM-005-s7-scope.md), resolved by excluding the `ZZ-VALIDATION-*`
namespace from the preservation basket. `verify:s7-preserved` is a governed
`prebuild` step and **passes**: 23 quotes, every captured commercial scalar
identical, global digest `e9943ad8…` — the same remainder AM-005 recorded.
Nothing was restored and nothing was re-baselined. Full detail in AM-005.

The measurement that produced that disposition is retained below.

### The measurement

`gate1b:verify-preserved` currently FAILS. Three measurements separate what
caused what:

| state | S-7 result |
|---|---|
| `fc97fdb` (before the authority publish) | **1** failure — `quoteRollup[0].blendedMarginPct: 0.2275 → 0.5072` on `ZZ-VALIDATION-tier-propagation` |
| `94f8c63` (authority publish) | that same 1, **plus 23** × `sellBeforeAdjustmentPerUnit: null → <value>` |
| + layout restoration | **byte-identical to `94f8c63`** |

Two findings, and they are not the same kind of thing.

**The 23 are field ADDITIONS**, from publishing the ladder. `null → value` is
the digest reporting a key that did not previously exist; no existing number
moved. Permitted under Amendment A-1 — *exposing computation structure is
permitted, changing existing numbers is not*.

**The 1 is a real movement, and it predates both commits.** DISPOSED 2026-08-10
as **[AM-005](AM-005-s7-scope.md), second instance** — not commercial drift, and
not a P3-017 concern. Proven to a residual of **zero**: the moved figure is
reproducible from the *baseline's own* cost and revenue scaled by the live tier
adjustment (`scripts/gate-1b/probe-zz-tier-propagation-margin.ts`), so no cost
input moved and the arithmetic did not change. The cause is operator clicks on
the deployed Pricing surface, which still serves the unfixed P3-016 write-at-
click path because `b6de377` is not on `main`. Full evidence in AM-005; the
disposition owed is a **basket-scope** decision, not a per-quote restore.

**The baseline has deliberately NOT been re-captured.** Re-baselining would bake
that movement in silently and destroy the remainder digest — the only evidence
that the other 23 quotes are byte-identical.

**Process gap, closed.** `gate1b:verify-preserved` was not part of `prebuild`,
and I did not run it when publishing the authority at `94f8c63`; the gates
reported there were accurate and incomplete. `verify:s7-preserved` is now the
ninth step of `prebuild` (`--env-file-if-exists`, so a build without a local env
file falls back to real environment variables rather than hard-erroring). A
change to `SkuPerTierRollup` can no longer pass the build without executing the
verifier that governs that shape.

**Consequence, stated rather than discovered later:** because S-7's basket is a
query over live production quotes, `prebuild` is now bound to production data
and currently **fails** — on the AM-005 movement, not on anything in P3-017.
That coupling is AM-005's finding arriving somewhere it costs something, and the
same basket-scope decision resolves both.

---

*Superseded pre-check (retained for the reader): before implementation, confirm
the math layer exposes per-tier `adjDelta`, `liftDelta` and `overrideDelta` as
first-class values.* CLAUDE.md's *"Two computations for similar-labeled displays
will diverge"* applies directly: if any of the three has to be derived in the
display layer rather than read from a node, that derivation becomes the next
reconciliation defect. **A row that cannot be sourced from a node is a Pattern
57 question before it is a layout question.**

## Cross-references

- R11 designer notes §4 and load-bearing items 11 + "every lever owes a row" —
  `docs/design-authority/r12-pricing-workspace/docs/r11-designer-notes.md`
- Canonical implementation —
  `docs/design-authority/r12-pricing-workspace/app/r12/pricing-page.jsx`,
  `CostStack` and `ReconStrip`
- [P3-016](P3-016-surgical-staging-bypass.md) — the same shape one layer up
- CLAUDE.md *"Surface unification can orphan components"* — the `.r11-recon`
  orphan is a textbook instance
- CLAUDE.md Pattern 57 — a stack row must be an independently governed quantity
