# Gate 1B · A-6 — derivation inventory

**Purpose.** Classify every independent computation of a commercial value
outside `src/lib/costing.ts`, so the rule

> no downstream consumer independently derives commercial values unless that
> derivation has been explicitly classified and justified

can be enforced rather than intended. Per Edward's instruction: *"Do not rely on
inspection during implementation."*

**Status:** complete for the sweep described in §1. Classification is proposed;
each row's disposition needs confirming before the code changes.

---

## §1 · Method, and what it does and does not cover

Six greps over `src/**`, excluding `src/lib/costing.ts`:

| Shape | Finds |
|---|---|
| `* (1 +` / `*(1 +` | markup and adjustment application |
| `/ tier.qty`, `/ qty`, `/ units` | allocation |
| `- cost) /`, `/ revenue`, `/ sell`, `1 - cost` | margin |
| `.reduce(` filtered to money-ish identifiers | sums and blends |
| `marginPct =` | assignment of a margin |
| `Σ`-shaped averaging (`/ known.length` etc.) | blends |

**What this does not catch, stated so the inventory is not read as stronger than
it is:**

- arithmetic behind a helper whose name hides it (`applyMarkup(x)`, `landed(x)`)
- values computed in SQL rather than TypeScript
- arithmetic in `scripts/**` and `tests/**` — out of scope; fixture writers are
  governed by Pattern 53
- anything computed in a component I did not reach through these shapes

This is why §5 argues the enforcement mechanism cannot be a grep-shaped prebuild
verifier of the kind Gate 1A shipped. That guard works because `insert(auditLog)`
is an unambiguous syntactic form. **"Commercial arithmetic" is not.**

**Baseline for contrast:** ~70 sites already read rollup values without
recomputing (`rollup.blendedMarginPct`, `perTier.*`, `skuRollups`). The compliant
pattern is the majority; these are the exceptions.

---

## §2 · The four classifications

Per Edward's disposition:

1. **Canonical duplicate to eliminate** — the engine computes this; the consumer
   must read it.
2. **Legitimate preview of an uncommitted state** — the engine has not computed
   this because the state does not exist yet.
3. **Temporary compatibility path** — bridging models during a migration window.
4. **Design error** — should not exist in any form.

### A fifth category the sweep required

Two sites compute **an input that will be persisted and then consumed by the
engine**, not a value presented to an operator:

- `src/lib/pricing-adjustment.ts:6` — `(1 + current) × (1 + delta) − 1`
- `src/app/actions/pricing-apply.ts:76` — the same composition at the write

This is **input composition**, and the rule does not reach it. The rule governs
*presented commercial values*; composing an adjustment is authoring, and the
engine consumes the result afterwards. Filing these under any of the four would
misrepresent them — they are not derivations of anything the engine already knows.

Recorded rather than force-fitted, per the standing preference for naming a
structural difference over asserting false uniformity.

---

## §3 · The inventory

### 3.1 · Design errors

| Site | What it does |
|---|---|
| `pricing-surface/detail-zone.tsx:452-464` | **unweighted** mean across cells, plus proportional markup re-allocation |

**This is the most serious finding in the sweep**, for three reasons.

**It is the wrong kind of average.** `avg(k) = Σ value ÷ known.length` is an
unweighted mean. The graph's `blend` node is a **weighted** mean,
`Σ(value × units) ÷ Σ units` (R11 §3). These agree only when every SKU carries
identical units at that tier. They diverge silently otherwise, and the divergence
grows with the spread of `qtyPerParent`.

**It re-introduces the exact defect the pattern library banked.** `mkShare()`
distributes markup proportionally: `(avg(k) / customerCost) × markupTotal`.
CLAUDE.md, *"Two computations for similar-labeled displays will diverge"*, records
this same shortcut causing a ~9% PM-visible mismatch between cost-stack PKG and
the packaging drilldown TOTAL, and closes with: *"Resist proportional-share
approximations when first-class primitives are achievable."*

**It already knows.** The code carries `TODO(Q6): replace this inline rollup with
costing-math-layer canonical roll-up shape once it lands. The math layer's
surfacing of {pkg, prod, frt, dt} per-cell will make this averaging redundant.`

That TODO is a correctly-formed deferral — marker, scope, and the exact capability
it waits on (contrast Pattern 54). **The capability it waits on is the node
graph.** This site is the clearest single argument that Gate 1B is not
speculative infrastructure: a load-bearing surface is already running an
acknowledged approximation while waiting for it.

**Disposition:** eliminate. Reads `blend` nodes and section nodes directly.

### 3.2 · Canonical duplicates to eliminate

| Site | Derives | Engine equivalent |
|---|---|---|
| `costs/freight-drilldown.tsx:310` | per-break sell/unit + customs sell | `FreightLegBreakdown.*WithMarkupPerUnit` — **different granularity**, see below |
| `costs/freight-drilldown.tsx:395,405-407` | shipment sell and per-unit sell | same |
| `costs/freight-drilldown.tsx:655` | `amount × (1+markup) ÷ qty` helper | same |
| `costs/freight-drilldown.tsx:666` | per-tier total freight + customs per unit | `freightContainerMarkupSumPerUnit` + `freightDutyTariffMarkupSumPerUnit` |
| `costs/packaging-drilldown.tsx:108,918` | `unit × (1+markup) × qty` per line | `packagingMarkupSumPerUnit` — **aggregate only** |
| `costs/cost-stack-header.tsx:305` | subtotal by summing component values | the `sum` node |

**An important qualification that changes the remediation.** Most of these are
not duplicates of a value the engine currently exposes — they are duplicates at a
**granularity the engine does not expose**. The engine computes freight per
`(leaf, leg)` and packaging as a per-leaf aggregate; the drilldowns display per
`(shipment, tier)` and per `(line, tier)`.

So "read the value instead" is not available today. Per §8.1 of the specification:
**if a consumer needs a value that is not a node, the answer is a new node.** These
sites are therefore requirements on the graph's granularity, not merely code to
delete — and that is a sizing fact for implementation.

**A second qualification.** These render during editing, from the optimistic
workbook, before reconcile. That makes them look like previews. They are not:
Phase 3 §3 settles the mechanism — *"Compute twice against the pure engine. No new
arithmetic."* The optimistic case is served by running the engine over optimistic
input, not by local arithmetic. **A preview computed locally is a duplicate
wearing a disguise**, and this is exactly the pair the specification warned could
not be told apart by inspection.

### 3.3 · Legitimate previews of uncommitted state

| Site | Derives | Note |
|---|---|---|
| `pricing-surface/pricing-classifier-context.tsx:465-470` | margin after a proposed surgical lift | intent legitimate, **mechanism wrong** |
| `pricing-surface/pricing-classifier-context.tsx:479-484` | blended margin after a proposed global lift | same |
| `lib/pricing-suggestions.ts:157,167,169` | the adjustment that would achieve a target margin | **solver**, see below |

**The first two are legitimate in intent and wrong in mechanism.** The state
genuinely does not exist yet, so the engine has not computed it — but Phase 3 §3
requires the second value to come from a **second engine run**, not from
`1 − cost / (revenue × (1 + delta))` in a React context. Remediation is to
replace the arithmetic with the second run, not to delete the feature.

**The solver is a different thing and should not be filed with them.**
`pricing-suggestions.ts` inverts the margin equation to find *what adjustment
would achieve a target*. That is a search over hypothetical states, not a
derivation of a displayed value — and the graph does not replace it.

But its output reaches the operator, so one rule follows:

> **A solver may propose an action. Only the engine may state its outcome.**

The suggested adjustment comes from the solver; the margin the operator is shown
for accepting it comes from an engine run at that adjustment. Today the same
arithmetic produces both, which is why a solver rounding convention
(`Math.ceil(adjNewRaw × 100) / 100`, CLAUDE.md "Suggested-GPA rounding") can move
a *displayed* margin. Those should not be coupled.

### 3.4 · Boundary case — the customer render tree

| Site | Derives |
|---|---|
| `components/pdf/customer-pdf-helpers.ts:101` | `perUnit = total ÷ units`, blended across SKUs |

**Classification: canonical duplicate — with a remediation the others do not
have.** This file is inside the customer-facing render tree covered by
`verify:boundaries`, so it **cannot** import costing to read a node. That is the
boundary working as designed, not an obstacle to route around.

Per Pattern 51, the fix belongs at the **composition seam**
(`customer-view-resolver.ts`), which is legitimately excluded from the forward
sweep precisely so it can do the projection. The seam reads the node and projects
a customer-safe value; the render tree receives it as data.

Two consequences worth stating plainly:

- The value a customer sees is currently computed in the presentation layer. Under
  Pattern 45 that is the sharpest boundary in the application — *"the only render
  path the firm doesn't get to apologise for after the fact."*
- The graph must **not** be reachable from the customer tree. R10 §6.9 and both
  data-source maps are unambiguous: exclusion is structural, a build-time
  assertion, *"not a runtime prop."*

### 3.4b · Added after the sweep — a site the shapes missed

| Site | Derives |
|---|---|
| `pricing/lines-requiring-review.tsx:80` | `needForFloor(cost) = cost / (1 − floorMarginPct)` — required sell to clear the floor |

**Found by S-6, not by this sweep.** None of §1's six shapes matches it: no
`* (1 +`, no `/ qty`, no `- cost) /`. It is a commercial derivation — the price a
cell would need in order to comply — presented to an operator.

Recorded prominently rather than quietly folded in, because it is this document's
own §1 blind spot demonstrated on the first occasion anyone looked from a
different angle. It is the strongest single argument for §5: **a grep-shaped
verifier cannot enforce this rule.**

**Classification:** canonical duplicate once the graph carries a required-sell-at-threshold
node. Phase 3's `liftTo(threshold)` is parameterised over exactly this quantity,
so the node is needed regardless.

**Also from S-6:** `costs/cost-stack-header.tsx:130` re-implements the
effective-target resolution locally — `quoteTargetMargin ?? firmSettings.targetMarginPct`.
Correct today, and a second implementation of a resolution the engine already
performs. CLAUDE.md's Slice 9.2 note records this as a two-directional foot-gun.
Note the asymmetry is intentional: target is quote-overridable, floor is
firm-level, so reading `firmSettings.floorMarginPct` directly is correct.

### 3.5 · Temporary compatibility paths

**None found.** The sweep surfaced no arithmetic whose justification is a
migration window. Recorded as a negative result, because an empty bucket is
evidence and an unexamined bucket is not.

### 3.6 · Not derivations

| Site | Why |
|---|---|
| `lib/pricing-adjustment.ts:6`, `actions/pricing-apply.ts:76` | input composition (§2) |
| `components/quote-umbrella/order-receipt.tsx:174`, `tab-sales-order.tsx:371` | summing one-time fee amounts already stated as data — no commercial transform |
| `components/pdf/customer-pdf-helpers.ts:60` | same; sums an array of fee amounts |
| `costs/page.tsx:570` | sums tier quantities — a count, not money |
| `costs/bulk-raw-drilldown.tsx:239` | ingredient native cost; Bulk Raw is provisional per A-7 and **never passed to `computeQuoteCosting`** — it has no engine equivalent to duplicate |

---

## §4 · Summary

| Classification | Count |
|---|---|
| Design error | 1 |
| Canonical duplicate to eliminate | 8 — two added by S-6, see §3.4b |
| Legitimate preview — mechanism must change | 2 |
| Solver — keep, decouple from displayed outcome | 1 |
| Boundary case — fix at the composition seam | 1 |
| Temporary compatibility path | 0 |
| Input composition — out of scope | 2 |
| Not commercial derivations | 5 |

**Two findings that change implementation sizing:**

1. **Most duplicates are duplicates at a granularity the engine does not expose.**
   Eliminating them requires nodes at per-`(shipment, tier)` and per-`(line, tier)`
   granularity, not merely deleting code (§3.2).
2. **The Pricing cost stack is already running an acknowledged approximation**
   waiting for exactly this capability, and it is both unweighted where it should
   be weighted and proportional where it should be primitive (§3.1).

---

## §5 · On enforcement

Gate 1A ended with a prebuild verifier because `insert(auditLog)` is an
unambiguous syntactic form. **Nothing here has that property.**

A grep for `* (1 +` would flag `pricing-adjustment.ts` (legitimate input
composition) and miss any helper named `landed()` or `applyMarkup()`. A verifier
built on that would be worse than none: it would report OK while the real
violations moved behind a function name — the failure mode CLAUDE.md's
governed-test-command rule was banked for, where a confident wrong signal beats no
signal only in the wrong direction.

**Proposed instead, in order of strength:**

1. **Structural, not syntactic.** Once rollups derive from nodes (§11.2 of the
   specification), the assertion *"every scalar equals its node's value"* runs at
   test time over real quotes. That catches divergence wherever it originates,
   including behind a helper.
2. **Typed values.** If a commercial value carries a branded type produced only by
   the engine, arithmetic on it fails to typecheck at the point of misuse. This is
   the only mechanism in the list that is genuinely airtight. It is also invasive,
   and it is a decision, not an implementation detail.
3. **A verifier over an allow-list of arithmetic sites**, inverted from Gate 1A's
   shape: rather than banning a form, enumerate the sites permitted to compute,
   and fail when a new one appears. This catches additions without needing to
   recognise arithmetic — the same reasoning that made Gate 1A's exception
   count-pinned rather than file-pinned.

**Recommendation:** 1 now, 3 alongside it, 2 as a separate decision. None of them
is free, and option 3 is the one that keeps the inventory from going stale — which
is the actual failure mode for a document like this.
