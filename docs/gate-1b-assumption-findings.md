# Gate 1B — assumption findings (S-1, S-2, S-5, S-6, S-8) and the S-7 baseline

**Instruction:** settle the five code-answerable assumptions and establish the
S-7 preservation proof before modifying `computeQuoteCosting`.

**Headline: nothing changes the Gate 1B design.** Four assumptions confirm, one
confirms with a named precondition, and S-7 is established and adversarially
tested. Three findings change *implementation detail*; none changes a contract.

---

## S-1 · Are the engine's intermediate locals complete enough to emit every node without new arithmetic?

**CONFIRMED, with one precondition.**

Read against `computeLeafPerTier` (`costing.ts:1065-1410`) and
`rollUpAssemblyPerTier`:

| Kind | Available today? |
|---|---|
| `sum` | yes — `packagingCostSum`, `factoryCostPerUnit`, `sellWithoutGlobalAdj` |
| `markup` | yes — `packagingMarkupSum`, `productionMarkupSum`, `rawMarkupSum` |
| `allocation` | yes — `internalProductionCogsPerUnit`, `allocatedServiceFeesPerUnit`, and both numerators |
| `rate` | yes — `computeShipmentContribution` returns duty and tariff separately |
| `adjustment` | yes — `computedSellPerUnit = sellWithoutGlobalAdj × (1 + adj)` |
| `override` | yes — `cellOverride`, and `computedSellPerUnit` is retained as the superseded value |
| `flagged-out` | yes — `production.customerShipsRaws` is in scope where `rawCost` stays 0 |
| `blend` | yes — `rollUpAssemblyPerTier` already weights by tier units |
| `origin` | **input values yes, provenance no** — see A-2, unchanged |
| **`resolution`** | **NO — the ladder is collapsed. See below.** |

### The precondition: `lookupMarkup` returns an answer, not a resolution

```ts
function lookupMarkup(defaults, category, fallbackCategory = "Other"): number {
  if (category && defaults[category] !== undefined) return defaults[category];
  if (defaults[fallbackCategory] !== undefined) return defaults[fallbackCategory];
  return FALLBACK_MARKUP;
}
```

A `resolution` node needs the **losing candidates and why each lost** — R10 §1
is explicit that collapsing to the resolved value *"re-creates exactly the
opacity the principle exists to remove."* This function discards that.

**Every input the ladder needs is already in scope** at the call site
(`p.markupPct`, `p.category`, `markupDefaults`). So the change is that the
function reports its path alongside its result — the same comparisons, retained
rather than discarded. **That is not new arithmetic**, and it stays inside
Amendment A-1.

### A naming hazard worth fixing before it is built on

`computeLeafPerTier` takes a parameter named `globalAdj`. It is not the global
adjustment — `costing.ts:1648-1650` resolves `tier.tierPriceAdjPct ?? globalAdj`
and passes the **effective** value under that name.

An `adjustment` node built from that parameter and labelled "global adjustment"
would be **wrong on every tier carrying its own adjustment — 39 rows today.** The
`resolution` node for the adjustment must also be emitted at line 1648, where
both candidates are in scope, not inside the leaf function where only the winner
arrives.

---

## S-2 · Can deterministic keys be built from durable identifiers alone?

**CONFIRMED.** No positional data is required.

| Node scope | Durable identity available |
|---|---|
| packaging line | `CostingPackagingInput{quoteSkuId, tierId, lineGroupId}` |
| freight shipment | `CostingFreightShipmentBreak{freightSubcategoryId, ownerSkuId, tierId}` |
| freight leg | `FreightLegBreakdown{legId, legGroupId}` |
| production | `CostingProductionInput{quoteSkuId}` × `tierId` |
| leaf / tier | `sku.id`, `tier.tierId` |

Every node site already carries a stable triple. §3.1's requirement — keys are a
pure function of position in the computation, not generated — is satisfiable
without adapter changes.

---

## S-5 · Are per-`(shipment, tier)` and per-`(line, tier)` nodes derivable from current engine inputs?

**CONFIRMED — and one duplicate is eliminable immediately.**

The engine already *receives* both at the granularity the drilldowns display; it
aggregates them away:

- `CostingPackagingInput[]` is **per line per tier**. The per-line marked-up
  value exists as `lineCost * (1 + markup)` inside the loop and is added to a
  running sum without being retained.
- `computeShipmentContribution(shipment)` is an **exported pure function**
  returning `{freightCostPerUnit, freightBillablePerUnit, dutyCostPerUnit,
  dutyBillablePerUnit, tariffCostPerUnit, tariffBillablePerUnit, …}` — precisely
  the shape `freight-drilldown.tsx` recomputes by hand in five places.

**That last point is actionable today.** The freight drilldown's duplicate can be
removed by calling the existing exported function; it does not wait on the graph.
That is a smaller, independently-verifiable change, and doing it first shrinks the
graph work's blast radius.

---

## S-6 · Does one evaluation serve every consumer without per-consumer thresholds?

**CONFIRMED, with two sites to correct.**

Most Pricing reads already go through one resolved policy
(`state.policy.{target,floor}_margin_pct`). Two do not:

| Site | Issue |
|---|---|
| `costs/cost-stack-header.tsx:130` | re-implements the effective-target `??` chain locally: `(quoteTargetMargin ?? firmSettings.targetMarginPct)` |
| `pricing/lines-requiring-review.tsx:80` | `needForFloor(cost) = cost / (1 - floorMarginPct)` — a required-sell derivation |

The first is correct today and is a **second implementation of a resolution the
engine already performs**. CLAUDE.md's Slice 9.2 note calls this out as a
two-directional foot-gun: read only the firm value and you silently ignore the
override; read only the override and you break every quote without one.

**The asymmetry is intentional and should not be "fixed":** target is
quote-overridable, floor is firm-level only. Reading `firmSettings.floorMarginPct`
directly is therefore *correct*; reading `firmSettings.targetMarginPct` directly
is not.

### The A-6 sweep missed one, and that matters

`needForFloor` is a commercial derivation — required sell to clear the floor —
and **none of the inventory's six grep shapes match it.** No `* (1 +`, no
`/ qty`, no `- cost) /`.

This is the blind spot the inventory named in its own §1, demonstrated. It is
added to the inventory, and it is the strongest evidence for that document's §5
conclusion: **a grep-shaped verifier cannot enforce this rule.** The sweep found
it only because S-6 asked a different question.

---

## S-8 · Does the customer tree need only projected values?

**CONFIRMED.**

`verify:boundaries` covers 19 files including
`src/components/pdf/customer-pdf-helpers.ts`, so the tree structurally cannot
import costing — the boundary is doing its job. The seam
(`customer-view-resolver.ts`) does **not** currently project `perUnit`; the
render tree computes `total ÷ units` itself.

The fix is at the seam, per Pattern 51: the seam reads the node, projects a
customer-safe scalar, and the render tree receives data. **The graph must remain
unreachable from the customer subtree** — R10 §6.9, enforced as a build-time
assertion, *"not a runtime prop."*

No contract changes. One field is added to the projected `CustomerView` shape.

---

## S-7 · The preservation baseline

### 1 · Fixtures — every quote, not a sample

`scripts/gate-1b/select-fixtures.ts` scored all 62 quotes by which node kinds
their data can produce. The capture then took **all 24 quotes that have
commercial structure** rather than a chosen subset.

A hand-picked set encodes the author's belief about where divergence is likely,
and that belief is exactly what a preservation proof is not entitled to assume.
The run is cheap because the engine is pure.

### 2 · Baseline captured

```
scripts/gate-1b/capture-costing-baseline.ts
  quotes captured   24
  failed             0
  global digest      16b5fd2796d8ff523c49fa13e51c714e3280759101161633a2bf421362ce6e1b
```

Artifacts: `docs/gate-1b/costing-baseline.json` (per-quote digests) and
`costing-baseline-detail.json` (full values, so a drift can be located rather
than merely detected).

Covers the whole `QuoteCostingResult`: `quote`, `firmSettings`, `tiers`,
`skuRollups` (every scalar on every `SkuPerTierRollup` plus per-leg freight
breakdowns), `quoteRollup`, `quoteSummary`. Deliberately the whole result — a
chosen subset is a prediction about which numbers matter.

**Reproducible:** two consecutive runs produced byte-identical output. A
baseline that is not deterministic is not a baseline.

### 3 · The invariant

> Every commercial scalar returned by `computeQuoteCosting` is byte-identical to
> the value captured before the node graph existed.

Compared at 17 significant digits — full float precision.

### 4 · Zero drift, not tolerance

`scripts/gate-1b/verify-costing-preserved.ts` fails on **any** difference. A
tolerance would be a decision about how far a customer-facing price may quietly
move during a refactor, and the answer to that is none.

On failure it reports **where**, not just that:

```
FAIL  0d76e2eb…  SAMPLE — Aurora Botanica · Hydra-Glow Serum / Alt 2
        quoteRollup[0].blendedMarginPct: 0.3647534442764756 -> 0.36475346619268695
```

It also fails if a quote in the baseline is absent now — coverage cannot shrink
silently.

### 5 · Adversarially tested

Perturbing `packagingMarkupSum` by **1 part in 10⁷** produced 5+ located
failures and exit 1. Reverted; re-run green.

**The first attempt at this test is itself a finding.** Perturbing
`FALLBACK_MARKUP` (0.3 → 0.30000001) changed *nothing* — the check passed. That
constant is never reached: every packaging line in the database resolves to a
line markup or a category default, so **the last rung of the markup resolution
ladder is unexercised by all production data.**

Had I stopped at that first test I would have concluded the verifier was broken.
It was measuring correctly; the coverage was the gap.

### 6 · What the baseline cannot prove

Two of the ten node kinds have **zero rows in the entire database**:

| Kind | Source | Rows |
|---|---|---|
| `override` | `assembly_leaf_overrides` | **0** |
| `flagged-out` | `assembly_production_inputs.customer_ships_raws` | **0** |

Also zero: `assembly_leaf_targets` (client benchmark, the third threshold).
Reachable and covered: allocation-off (4 rows), bulk raw (3), customs breaks (6),
tier adjustments (39), global adjustments (5).

So "preserve existing behaviour" for `override` and `flagged-out` means
preserving behaviour **no production data has ever exercised**. The verifier
prints this on every green run rather than letting a pass be read as complete.

**Remediation, and it needs no schema:** `computeQuoteCosting` is a pure function
over `QuoteCostingInput`. Unit coverage constructing overrides, customer-shipped
raws, and the `FALLBACK_MARKUP` rung directly closes the gap without a database
and without touching OD-012.

---

## Does anything change the Gate 1B design?

**No.** Every contract in the specification stands.

Three findings change implementation detail:

1. **`lookupMarkup` must report its resolution path** (S-1) — a precondition for
   `resolution` nodes, and within Amendment A-1.
2. **The adjustment `resolution` node must be emitted at `costing.ts:1648`**, not
   inside `computeLeafPerTier`, where only the winner arrives (S-1). The
   `globalAdj` parameter name is actively misleading and should be corrected
   before anything is built on it.
3. **`computeShipmentContribution` already returns what the freight drilldown
   recomputes** (S-5) — one inventory duplicate is removable now, independently
   of the graph.

Two obligations carried into implementation:

- **Unit coverage for `override`, `flagged-out`, and the fallback markup rung**
  before rollups derive from nodes.
- **The remaining measurement assumptions** — S-3 (engine cost), S-4 (provenance
  query cost, still A-2), S-9 (second-run cost) — remain explicit validation
  obligations. None alters the graph contract.

**No schema work is proposed or required by any of this.** OD-012 is untouched.
