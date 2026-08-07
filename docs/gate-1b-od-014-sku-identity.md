# OD-014 — the governed commercial SKU for Pricing aggregation

**Status:** settled 2026-08-07 by Edward. This document is the recorded answer;
[`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) carries the closed-entry pointer.

---

## The decision

> **A commercial SKU for Pricing aggregation is the quote-scoped leaf
> attachment: `quote_leaves.id`.**

Component blends, and every future aggregation over "SKUs", aggregate over that
population **regardless of assembly-tree shape**. An implementation that reads
the tree to decide who participates has re-encoded an artefact of how the quote
was authored.

---

## Why — the five sources

| Source | Finding |
|---|---|
| **Phase 3 authority** | The surgical lift is keyed `(quote_leaf_id, tier_id)` and the specification calls this *"the canonical commercial attachment"*. The lift is defined as *"one SKU, one tier"*, so Phase 3 already equates one SKU with one `quote_leaf_id`. It forbids resolving through `leaf_id`, and forbids migrating to `assembly_leaf_id` for convenience |
| **Canonical attachment semantics** | `quote_leaves` is quote-scoped and carries `quantity` and `position`. `assembly_id` is **nullable**. `canonical-attachment-identity.ts` brands the id and warns *"Never construct this from leaf_id"* |
| **Per-SKU Pricing behaviour** | `pricing-classifier-context.tsx` filters `skuRole === "leaf"` as a standing invariant. Sell-price overrides and client targets both reject non-leaf, with the math layer as defence in depth |
| **Customer-facing quote** | `customer-view-resolver.ts` filters `skuRole === "leaf"`; each leaf carries `requiredSellPerUnit` per tier. Assemblies never appear as a priced line — only as spec-addendum grouping |
| **Setup's SKU model** | Diverges. See C-1 |

**Pricing aggregates the same entity the customer is quoted a price for.** That
was the test the decision had to pass, and it passes.

## What the production data settles independently

- **The same library leaf attaches up to three times within one quote** — ten
  such cases. Three attachments of one component are three commercial lines,
  and only the quote-scoped attachment distinguishes them. This rules out
  `leaf_id` on evidence, not only on authority.
- **Every one of the 137 live attachments carries `quantity = 1`.** A weighted
  and an unweighted mean are therefore numerically identical on every quote in
  the database. Two consequences: the derivation inventory's *"wrong kind of
  average"* finding is real but has **no live numeric impact today**, and **no
  fixture built to production shape can distinguish the two.** The population
  error was the one that moved numbers.

---

## C-1 · Setup authors commercial values nothing consumes

**Disposition (Edward, 2026-08-07): a Setup-authoring defect. Not evidence that
assemblies are priced SKUs. Pricing identity does not move around these fields.**

`assemblies` carries `unit_price`, `unit_cost`, `margin_pct` and `markup_pct`.
The Add Product modal presents ASY mode as *"commercial fields"* and LEAF mode
as *"identity fields"*. Those four columns are written by `createAssembly` and
**read by nothing** — zero readers anywhere in `src/`.

So operators can author commercial values that no downstream authority consumes.
Nothing warns them, and the values look authoritative in the surface that
collects them.

The long-term direction makes this sharper rather than softer: **ASY is expected
to become optional during quote authoring.** A quote may then contain no
assembly at all, so assembly-level commercial fields cannot be the commercial
identity under any reading.

Tracked as [OD-016](OPEN_DECISIONS.md).

---

## C-2 · The population boundary — corrected

**Disposition (Edward, 2026-08-07): a blocker before Increment 7 resumes.
Corrected in this change.**

### What was wrong

`loadNewModelCostDataForQuote` discovered the SKU population by walking
`assembly_leaves → assemblies → quote`. **The presence of an assembly was a
precondition for being a SKU at all.** A leaf attached directly to the quote
(`quote_leaves.assembly_id IS NULL`) — a form the schema indexes for with a
dedicated partial index, and that the identity module explicitly validates as
*"Direct canonical attachment … valid without a legacy mapping"* — was
structurally invisible to costing, Pricing and the customer quote.

Zero such rows exist today, so nothing was mispriced. It was latent, not live.

### What changed

The population now comes from `quote_leaves`, LEFT joined to `assembly_leaves`
for the legacy id. Compatibility data is not population: **the absence of a
transitional artefact must never remove a governed SKU from a quote.**

**Population and keying are separate questions.** The math layer is still *keyed*
by `assembly_leaf_id` wherever one exists, because every cost-input table is.
That is what let the population move without moving a single commercial number.
The canonical id travels on every emitted SKU as `canonicalQuoteLeafId`, which
is the identity Increment 7 uses for contributors.

### Why this is the intended architecture, not a local fix

The long-term direction is that **quote construction allows direct commercial
attachment without requiring an ASY**, while the Product Library continues to
model products as ASY + LEAF. Deriving the population from the canonical
attachment is exactly what that requires. The nullable `assembly_id` was already
the schema affordance; the old query is what made it unreachable.

---

## Plumbing finding — direct attachments are representable but not priceable

Stated rather than designed around, per the instruction not to invent behaviour
for this case.

Every cost-input table — `assembly_leaf_inputs`, `assembly_leaf_overrides`,
`assembly_leaf_targets` — keys on `assembly_leaf_id`. A direct canonical
attachment has no such row, so **no cost can be authored against it.** After
this change it appears as a governed SKU whose cells are unpriced, via the
existing zero-revenue-and-zero-cost missing-cell semantics that Pricing and the
customer quote already share. Nothing invents a price.

**Under ASY-optional authoring this stops being an edge case and becomes the
main path.** Re-keying those tables to `quote_leaf_id` is the real blocker, and
it is a schema change → [OD-012](OPEN_DECISIONS.md). Tracked as
[OD-017](OPEN_DECISIONS.md).

## Second finding — the canonical id was dropped from the engine's output

**RESOLVED 2026-08-07.** `canonicalQuoteLeafId` was carried on the engine's
**input** (`CostingSku`) and never copied onto its **output** (`SkuRollup`), so
no consumer could read commercial identity from a rollup. Increment 7 reads
contributor identity from exactly there.

It is now surfaced on `SkuRollup`, as an identity field only. It is `null` on
assemblies, which are not commercial lines, and `null` — never the legacy
`skuId` — when it cannot be resolved. Substituting `skuId` would pass off the
legacy `assembly_leaf_id` as a commercial identity, which is the resolution
Phase 3 forbids; consumers must fail closed instead.

### The digest movement was classified before the re-baseline, not after

Adding a field to the payload moves the S-7 digest, and a moved digest normally
means a commercial regression. [OD-013](OPEN_DECISIONS.md) records why a check
that gets re-baselined whenever it fails is not a check.

`scripts/gate-1b/classify-identity-field-digest.ts` recomputes the digest with
the new field **stripped**. A purely additive change reproduces the prior
baseline exactly:

```
prior global digest          7e2c2f8330e4b54442bf49e4e85ef7dcf5d61f80e715b940d254e17b72777d76
recomputed, field stripped   7e2c2f8330e4b54442bf49e4e85ef7dcf5d61f80e715b940d254e17b72777d76
```

Byte for byte, over all 24 quotes — and **137 of 137 leaf rollups carry the
identity**, so the match is not vacuous. The prior digest is pinned as a literal
rather than read back from the baseline file, so the proof cannot agree with
itself, and the script stays re-runnable after the re-baseline it authorised.

New baseline: **`150d9f5ab0e8261da2ea3d6b292dbe5c835265f55e8a076af5fb0a65110717e0`**.

### One canonicaliser, not three

The first attempt at that proof reported all 24 quotes as differing. The cause
was a private copy of the digest canonicaliser that omitted its number branch —
`toPrecision(17)`. Every value then hashed differently, which reads exactly like
a total commercial regression and was nothing of the kind.

That is the most expensive possible shape of bug for a preservation check: it
manufactures the failure the check exists to detect. The function now lives once
in `scripts/gate-1b/canonical-digest.ts` and is imported by the capture, the
verify and the classification scripts, so the copies cannot drift again. A
second implementation of a hash is a second implementation, which is the thing
Gate 1B exists to argue against.

---

## Evidence

| Requirement | How it is met |
|---|---|
| All 137 attachments represented | `scripts/gate-1b/verify-sku-population.ts` — 24 quotes, 137 attachments, compared **by identity**, not by count |
| Commercial outputs byte-identical | S-7 digest `7e2c2f83…` unchanged at the time of the C-2 change; now `150d9f5a…` after the classified, identity-only addition |
| Repeated library leaf stays distinct | `tests/unit/costing-adapter-sku-population.test.ts` |
| Direct canonical attachment | same file — including a quote with **no assemblies at all** |
| Nested / unequal-quantity fixture | same file — quantities 2, 3, 5, 7, asserted distinct so weighting stays observable |

Every check was **adversarially proven**: reinstating the assembly precondition
fails 6 tests, keying identity on `leaf_id` fails 4, and flattening quantities to
production's uniform 1 fails 3. A check that cannot fail is not a check.

The fixture is deliberately unlike production. That is the requirement, not a
defect — production cannot distinguish a weighted mean from an unweighted one,
and OD-015 exists because the reverted increment-7 fixture inherited exactly
that blindness.
