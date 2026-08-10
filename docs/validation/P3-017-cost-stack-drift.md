# P3-017 · The Pricing Cost Stack is not the accepted R11/R12 stack

**Status: VERIFIED 2026-08-10 — incomplete implementation, not intentional
simplification.** Not repaired. The Design Authority is to be restored, not
replaced with a new layout.

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

## Restoration scope — not started

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

**Data availability is unverified.** Before implementation, confirm the math
layer exposes per-tier `adjDelta`, `liftDelta` and `overrideDelta` as
first-class values. CLAUDE.md's *"Two computations for similar-labeled displays
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
