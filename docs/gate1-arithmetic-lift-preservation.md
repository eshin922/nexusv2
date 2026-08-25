# Gate 1 — deployed customer-artifact preservation

**Arithmetic lift, `6e3b59a` → `324a03a`.** Captured from production either side
of the deploy, by decoding the customer PDF's drawn text runs through their
ToUnicode CMaps.

**Content, not bytes.** react-pdf stamps a `CreationDate`, so the PDF bytes
differ on every render of identical content. A byte comparison would report a
change every time — an instrument that always says "changed" is as useless as
one that always says "same".

---

## Result

### `4781e4bb` — PRESERVED EXACTLY

| | before | after |
|---|---|---|
| decoded runs | 159 | 159 |
| money values | 36 | 36, **all equal, in order** |
| quantity labels | 12 | 12, all equal |
| diffs | — | **zero** |

Covers tier quantities, unit prices, extended line totals, tier totals,
one-time fee amounts and line presence, itemized treatment, and the labels this
projection participates in.

### `52bd0077` — CHANGED. NOT byte-preserved, and not claimed to be.

The artifact moved. Stated plainly because the attribution matters more than
the verdict:

```
[0]  $9.67      -> $9.53
[1]  $9,666.00  -> $9,526.00
[3]  $17,135.12 -> $16,435.12
[5]  $51,060.00 -> $49,660.00
[7]  $44,040.00 -> $42,640.00
[20] $1,400.00  -> $140.00        + a new $1,400.00 line
runs 108 -> 124
```

**Attributed to a commercial-state change, not to the lift.** Between the two
captures, Project setup moved from *In unit price* to *Separate* on that quote.
The rail confirms it: `Project setup = Separate (elected)`, with a `$140.00`
setup line in the fee section that did not exist at capture time.

That is exactly the shape of the deltas — a charge leaving the unit price
lowers every unit price and adds a fee line.

### The invariant that settles the attribution

The lift cannot fake this, and a change in the arithmetic could not preserve it:

```
tier 1 line totals   $9,526.00 + $3,840.00   = $13,366.00
one-time fees        $140.00 + $1,400.00     =  $1,540.00
                                       total = $14,906.00   ✓ as printed
```

And the four printed turnkey totals —

```
$14,906.00   $31,405.12   $75,140.00   $69,800.00
```

— are **character-for-character the values captured before the lift**, during
the glyph-truncation certification.

**Placement moves the breakdown; the all-in total is invariant.** That is the
commercial model behaving correctly. If the lift had altered the arithmetic,
the all-in totals would have moved too — and they did not, on the very quote
whose breakdown moved most.

Corroborated by the other two lines of evidence: `4781e4bb` was identical
across the same deploy under the same code, and the preservation suite asserts
identical figures for identical inputs, including the `31405.120000000003`
IEEE-754 artifact.

---

## A gap in the method, recorded rather than smoothed over

**The baseline captured the artifact without the commercial state that produced
it.** A control that does not record its inputs cannot attribute its outputs,
and this one could not: the attribution above rests on a corroborating
invariant and on the rail's current state, not on the capture itself.

That is weaker than it should have been. It is the same class as the fixtures
rule — a control is only as good as what it records.

**Remedy, for every comparison after this one:** capture the commercial state
alongside the artifact, in the same snapshot, so a later difference can be
attributed rather than argued.

---

## Gate 2 — renderer arithmetic boundary

Extended `verify:boundaries`. **Falsified before being trusted:** both shapes
reintroduced against the real file and the rule watched to go red.

```
return unitPrice * quantity;   -> extended amount            FLAGGED
return total / pricedCount;    -> the T-1 divisor, exactly   FLAGGED
```

Clean again on restore. Patterns match commercial *constructions* rather than
arithmetic in general, because a renderer legitimately computes column widths
and page counts. The composition seam is exempt by design and by name — two
files, not an allowlist (Pattern 51). Comments are stripped before matching.
The success line reports the shape count, so the rule cannot pass while
matching nothing.
