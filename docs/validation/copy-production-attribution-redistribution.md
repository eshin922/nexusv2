# A copy redistributes per-leaf production attribution

**Found 2026-08-26** while building the falsification for the applied-lifts
copy repair (#452). **Reported separately and deliberately uncoupled from that
repair**, which neither caused it nor fixes it.

**Not yet dispositioned. No repair proposed here.**

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
