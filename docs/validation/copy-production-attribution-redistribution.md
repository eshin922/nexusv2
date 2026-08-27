# A copy redistributes per-leaf production attribution

**Found 2026-08-26** while building the falsification for the applied-lifts
copy repair (#452). **Reported separately and deliberately uncoupled from that
repair**, which neither caused it nor fixes it.

**ADJUDICATED 2026-08-26** — see the disposition at the foot. In short: it is the second consumer of **OD-028**'s root cause, it is not a commercial-integrity defect, and it is not cosmetic either. Folded into OD-028 rather than filed separately.

## What happens

Copying a quote moves per-leaf PRODUCTION attribution between sibling leaves of
the same Item Group. The tier total does not move.

```
source   factory cost per unit, by leaf   {2, 3.14, 4}     sum 9.14
copy                                      {2, 3, 4.14}     sum 9.14
```

One leaf gains `1.00` per unit and a sibling loses it.

## Why

Production is per-ASSEMBLY, and the engine attributes it to one child — the
lowest-positioned leaf, the documented anchor-leaf coercion:

> the adapter attaches the value to the lowest-position child (the "anchor
> leaf") and leaves siblings unattached. Math correctness preserved via
> additive parent rollup.

The coercion is sound and the parent total is right by construction. What moves
on copy is WHICH child is the anchor, because the clone does not reproduce the
source's leaf ordering deterministically.

## What it is not

**Not caused by the lift repair.** A probe using no lifts at all reproduces it:
two generations of plain copy, identical row counts throughout
(7 leaves, 21 packaging, 3 production, 2 assemblies), and the distribution
still moves.

**Not a quote-total defect.** Tier revenue, tier cost and blended margin are
identical across the copy — asserted by `verify-scenario-copy`'s Phase 2c,
which compares tier economics precisely because this per-leaf movement would
otherwise fail a claim it is not about.

**Not obviously harmless either**, which is why it is written down rather than
dismissed. Per-leaf margin is what the Pricing compliance grid reads, so two
commercially identical quotes can present different per-cell verdicts — and a
cell's verdict is what an operator acts on.

## Curiosity worth keeping

A copy-of-a-copy returned to the source's distribution:

```
source  {2, 3.14, 4}
gen 1   {2, 3, 4.14}
gen 2   {2, 3.14, 4}
```

Consistent with a deterministic order flip rather than randomness. If so, the
ordering rule is recoverable and the fix is likely small — but that is a
hypothesis from three observations, not a finding.

## What would settle it

1. Whether `quote_leaves.position` / `assembly_leaves.position` are reproduced
   by the clone in source order, or re-derived.
2. Whether the anchor should be positional at all, or whether per-assembly
   production should stop being coerced onto a child — the math-layer
   extension already banked as "Per-assembly production fan-out".
3. Whether any surface an operator acts on reads per-leaf production
   attribution as a decision input. If none does, this is cosmetic; if the
   compliance grid does, it is not.

---

# Adjudication — 2026-08-26

## It is not an independent finding

The clone is already deterministic. `cloneQuoteGraph` reads
`assembly_leaves` ordered `(position, createdAt, id)`, and its own comment says
what remains:

> It does NOT make the anchor stable: the costing loader orders by
> `(assemblyId, position)` with no tiebreak of its own, so which member anchors
> per-assembly production is decided by physical row order at read time.

That is **OD-028's root cause exactly** — `position` is not unique within an
assembly, and "lowest-position leaf" ties break by storage layout. OD-028
measured it on the *freight* anchor and even recorded the copy case
(`source anchor 7733dc76 → copy anchor 45cf4e60`). This is the same defect
observed through a second consumer: the *production* anchor.

**So it is folded into OD-028, not filed as its own decision.** Two entries for
one root cause is how the two get repaired differently.

## It is not a commercial-integrity defect

Traced, not assumed. Nothing that gates, freezes, bills or prints reads per-leaf
production attribution:

| consumer | reads | affected |
|---|---|---|
| below-floor send gate | `quoteRollup.find(r => r.tierId === …)` — tier totals | **no** |
| authorization fingerprint | `totalRevenue` / `totalCost` / `blendedMarginPct`, all tier-level | **no** |
| customer document | tier lines + OTC | **no** |
| frozen snapshot | `quote_snapshot_tier_totals` + lines | **no** |
| NetSuite Sales Order | snapshot lines | **no** |

The anchor moves cost *between siblings inside one assembly*; the assembly and
tier totals are invariant by construction (additive parent rollup), and
`verify-scenario-copy` Phase 2c asserts tier economics match exactly across a
copy. Three soak runs put the same figure — `16,733.64` — through document,
freeze and provider readback on quotes carrying this coercion.

**An anchor flip also cannot invalidate an existing below-floor authorization**,
because the state fingerprint is computed from tier totals that did not move.

## But it is not cosmetic

The Pricing coaching layer reads **per-cell** margin
(`pricing-classifier-context.tsx`: `for (const sku of skus) for (const cell of
…) if (isBelowTarget(m, effectiveTarget))`). The anchored leaf carries the whole
assembly's production cost, so its cell margin is depressed and its siblings'
are inflated. A copy therefore changes:

- **which SKU is named `worst_sku_name`** in the coaching sentence, and
- **which cells display below-target.**

And the guidance is actionable in a way that persists: a lift is written
per-leaf into `quote_leaf_lifts`. An operator following distorted guidance lifts
the wrong SKU, and per-leaf sell price **is** customer-visible — the document
prints a unit price per product. The tier still clears the floor, so nothing
refuses; the customer simply receives a different split across the same total.

So the honest classification is narrower than "presentation" and wider than
"cosmetic": **an operator-guidance defect with an indirect path to a
customer-visible difference.** OD-028's note that it is "explicitly NOT a
commercial-integrity defect" remains accurate for the freight display it was
written about, and understates this consumer.

## What the repair is, when it is taken

Not now. Two candidates, and the choice is a real one:

**(a) Give the anchor a governed tiebreak.** Order `(position, createdAt, id)`
in the costing loader as the clone already does. Small, and it makes the anchor
*stable* — but stably arbitrary. It fixes reproducibility across copies and
fixes nothing about a per-leaf figure that was never a per-leaf fact.

**(b) Stop coercing per-assembly production onto a child.** The math-layer
extension already banked as "Per-assembly production fan-out" — give
`computeQuoteCosting` an input slot keyed `(assembly_id, tier_id)` so production
never has to belong to a leaf at all. This removes the question rather than
answering it, and it is the change that makes per-cell coaching honest.

**(a) is a stopgap that would make the symptom stop moving; (b) is the fix.**
Recommending they be sequenced that way only if (b) cannot be scheduled — an
anchor that is stable and wrong is harder to notice than one that visibly
wanders, which is the argument against taking (a) alone.

**Both are post-gate.** Neither is a soak repair: no total moves, no gate
changes, and the guidance distortion predates every run.
