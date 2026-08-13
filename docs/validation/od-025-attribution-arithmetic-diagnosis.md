# OD-025 · Attribution must not change Freight economics — diagnosis

**Returned at the stop boundary. Nothing implemented, nothing applied.** The
correct quantity authority is ambiguous at the repair point, which is the
condition the brief named for stopping.

Pattern 58 is not weakened anywhere below. It is the standard the current
implementation fails.

---

## 1 · The finding is larger than the brief assumed

The brief frames OD-025 as *anchor selection changes the commercial
contribution*. That is true, but it is a **symptom**. The measurement:

```
ONE assembly · ONE leaf · ONE shipment of $500 over 1000 units
The correct quote-level freight is $500 regardless of BOM multiplicity.

  anchor leaf qtyPerParent = 1  →  quote freight $500    correct
  anchor leaf qtyPerParent = 2  →  quote freight $1000   OVER-COUNTED 2x
  anchor leaf qtyPerParent = 3  →  quote freight $1500   OVER-COUNTED 3x
```

There is no second anchor in that fixture. **Freight is over-counted outright**
whenever the carrying leaf has multiplicity ≠ 1. Attribution-sensitivity is what
you see when two anchors have *different* multiplicities; the defect underneath
is that multiplicity is applied at all.

This matters for scope: a repair that only equalised anchors would leave a
quote reporting **$1000 of freight for a $500 shipment** and still satisfy the
letter of "both anchors agree".

### It affects BOTH freight models

The worksheet/shipment model and the leg model fail identically:

```
freightShipmentBreaks    (worksheet)  qty 2 → $1000 for a $500 shipment
freightComponentTierCosts (leg model) qty 2 → $1000 for a $500 leg cost
```

The leg model has no anchor concept at all — its cost is already per-leaf. So
the defect is not *about* attribution. Any already-absolute freight amount
attributed to a leaf is scaled by BOM multiplicity.

---

## 2 · Complete arithmetic trace

| # | Stage | Code | Governing quantity | Class |
|---|---|---|---|---|
| 1 | Shipment/tier input | `ShipmentContributionInput` | `freightAmount` (absolute $ for the shipment at this tier) | — |
| 2 | Per-unit conversion | `computeShipmentContribution` `costing.ts:314-319` | **`tierUnits`** = `quote_tiers.qty` | **economic** |
| 3 | Markup | same fn, `:320-325` | rate only, no quantity | — |
| 4 | Customs (duty/tariff) | same fn, same denominator | **`tierUnits`** | **economic** |
| 5 | Leaf attribution | `costing.ts:2032-2041` — `shipment.ownerSkuId === sku.id` | none; addition only | **attribution** |
| 6 | **Assembly fold** | `rollUpAssemblyPerTier` `costing.ts:2580-2608` | **`qtyPerParent`** | **← DEFECT** |
| 7 | Quote rollup | `costing.ts:3085+` | `tier.qty` | **economic** |
| 8 | Quoted sell | derived from cost + markup | inherits stage 6 | — |

**Stage 6 is the exact point** the brief asked to identify.

---

## 3 · Governing quantity semantics

| Quantity | Meaning | Denominates | Legitimate use |
|---|---|---|---|
| `quote_tiers.qty` (`tierUnits`) | sellable units at this tier | freight, customs, quote totals | **economic** — stages 2, 4, 7 |
| `qtyPerParent` (`assembly_leaves.quantity`) | components per sellable unit | packaging / production / raw | **economic for component cost**; **attribution-only for freight** |
| `qtyPerSellableUnit` (packaging line) | units of a packaging line per sellable unit | packaging line cost | economic |
| `quote_leaves.quantity` on a **Direct** leaf | multiplicity | currently **ignored** — see §6 | undecided |

### Root cause — a dimensional error, stated precisely

```
packaging leaf unitCost   is  $ / COMPONENT unit
                          × qtyPerParent  →  $ / SELLABLE unit      ✅ correct

freight per-unit          is  $ / SELLABLE unit   (already ÷ tierUnits)
                          × qtyPerParent  →  $ / sellable unit × multiplicity   ❌ dimensionless nonsense
```

`rollUpAssemblyPerTier` treats **every** per-unit field on
`SkuPerTierRollup` as *per component unit*. That is true of packaging,
production and raw. It is **false of every freight-derived field**, which was
already denominated per sellable unit at stage 2.

`SkuPerTierRollup` therefore carries **two different dimensions in one record**,
and the fold cannot tell them apart. That is the root cause — not the
multiplication itself, which is correct for the fields it was written for.

---

## 4 · Why the minimum repair is not deleting the multiplication

Freight is not confined to the freight fields. It is embedded in composites that
are **legitimately** multiplied for their packaging/production content:

```
contribution   += contributionCostPerUnit  * qtyPerParent   ← contains freight
requiredSell   += requiredSellPerUnit      * qtyPerParent   ← contains freight
computedSell   += computedSellPerUnit      * qtyPerParent   ← contains freight
sellBeforeAdj / adjDelta / sellAfterAdj /
liftDelta / sellAfterLift / overrideDelta  * qtyPerParent   ← ladder, all contain freight
landedFreight / containerFreight / dutyTariff              ← pure freight
containerFreightMarkup / dutyTariffMarkup                  ← pure freight
```

Deleting `* qtyPerParent` on the five pure-freight lines fixes the freight
*breakdown* and leaves `contribution`, `requiredSell` and the entire sell ladder
still scaling freight — so cost and quoted sell would disagree with the
breakdown, and the reconciliation identity the fold's own comment relies on
(*"the fold is linear, so the identity that holds at each child holds for the
assembly"*) would break.

**Eleven fold lines are implicated, not five.**

---

## 5 · Two candidate repairs — and the ambiguity that stops me

### Repair A — dimension-aware fold

Decompose each composite before folding:

```
contribution += (componentPart × qtyPerParent) + freightPart
```

- **Preserves** the current model: freight stays visible on the leaf that
  carries it, per-leaf cost stacks are unchanged in shape.
- **Cost:** every composite must be split into a component part and a freight
  part at fold time, and the reconciliation identity re-proven for the split.
- **Risk:** the leaf's own per-unit record keeps mixing dimensions, so the next
  aggregate written against it inherits the same trap.

### Repair B — attribute freight above the leaf

Freight is determined at shipment/tier level and belongs to the **sellable
unit**. Attribute it at assembly/top level; the fold never sees it.

- **Removes the trap structurally** — one dimension per record.
- **Cost:** per-leaf freight disappears from leaf-level displays. That is a
  visible behavioural change to the Costs cost stack and the per-leaf drilldown,
  and it collides with Pattern 57: a per-leaf freight row would become a
  presentation of something not independently governed at that level.
- **Risk:** larger blast radius; changes what an operator sees, not just what
  the math computes.

### The ambiguity I will not resolve unilaterally

**Is a leaf's freight figure `$ per sellable unit` or `$ per component unit`?**

Both repairs are internally consistent; they answer that question differently,
and the answer determines whether per-leaf freight remains a governed display at
all. That is a commercial/presentation decision with a Pattern 57 dimension, not
an implementation detail — and the brief's stop boundary names exactly this case.

**My recommendation is Repair A**, on the grounds that it is the minimum change
that restores correctness without altering what operators see, and that Repair
B's display question can then be decided separately on its own evidence rather
than as a side effect of an arithmetic fix.

---

## 6 · Adjacent finding — NOT part of OD-025's repair

A **Direct** leaf's `quantity` is ignored entirely for packaging:

```
direct qty = 1 → quote packaging $10,000
direct qty = 2 → quote packaging $10,000
direct qty = 3 → quote packaging $10,000
```

An assembly-backed leaf scales correctly (§B of the trace); a direct one does
not scale at all. Latent today — every live attachment is quantity 1, and Direct
Components are UI-unreachable. **It becomes reachable exactly when OD-022
exposes them**, and it is a different question from OD-025 (component economics,
not freight attribution). Recorded here so it is not discovered as a surprise
inside OD-022.

---

## 7 · Affected consumers

- `rollUpAssemblyPerTier` — the fold itself (11 lines).
- `computeLeafPerTier` freight attribution — both models (`:2032-2041` worksheet,
  `:1960-1970` leg).
- Quote rollup `costBreakdown` — freight, freightContainer, dutyAndTariff, and
  every markup-sum sibling.
- Anything reading `SkuPerTierRollup` freight fields on an **assembly**: Costs
  cost stack, per-leaf drilldown, Pricing cost stack, customer PDF freight lines.
- `quoteSummary` blended margin — inherits via `contribution` / `requiredSell`.
- **S-7 baseline** — a correct repair CHANGES freight on any quote with a
  multiplicity ≠ 1 anchor. There are none today, so the expectation is **zero
  movement on live data**; any movement is evidence the repair over-reached.

---

## 8 · Production impact — recorded explicitly

- **Every live attachment carries quantity 1.** Measured: 150 `quote_leaves`,
  150 `assembly_leaves`, all quantity 1.
- **No observed production monetary drift is presently attributable to OD-025.**
  This is why S-7 reported zero monetary movement across the whole population
  through OD-017.
- The defect is **reachable by the approved future Product Structure model** and
  must close before OD-022, which would make multiplicity ≠ 1 and alternate
  attribution normal rather than theoretical.

---

## 9 · Regression / falsification plan

The brief's ten, each stated so it fails loudly if the repair over- or
under-reaches:

| # | Falsification |
|---|---|
| 1 | equal quantities `(1,1)` — both anchors identical freight economics |
| 2 | unequal quantities — both anchors identical freight economics |
| 3 | quantities `(1,2)` |
| 4 | quantities `(2,3)` |
| 5 | assembly-owned anchor vs membership-derived Direct anchor |
| 6 | Mixed shipment — one shipment, both leaf kinds |
| 7 | same shipment/destination/break/markup, only attribution changed |
| 8 | quote total invariant under attribution change |
| 9 | freight contribution appears exactly once (stated as arithmetic, not a count) |
| 10 | packaging/component quantity scaling **unchanged** — `(1,2,3)` still `$10k/$20k/$30k` |

Plus three the diagnosis added:

| # | Falsification |
|---|---|
| 11 | **absolute correctness** — a $500 shipment reports $500 at quote level for every multiplicity, with no second anchor in the fixture |
| 12 | **leg model** — `freightComponentTierCosts` fixed identically |
| 13 | **reconciliation identity preserved** — assembly `contribution` = Σ folded parts, and `requiredSell − contribution` margin unchanged where freight is absent |

**Tripwire handling.** The existing OD-025 tripwire in
`od-017-direct-component-economics.test.ts` is **retained until the repair
lands**, then **inverted into the permanent equality assertion** — not deleted.
Its failure is the signal that the repair worked.

---

## 10 · What I need before implementing

A decision on §5: **Repair A (dimension-aware fold, per-leaf freight preserved)**
or **Repair B (attribute above the leaf, per-leaf freight display removed)**.

On that answer I will implement, run the thirteen falsifications, re-run S-7
expecting zero monetary movement, and return with evidence.
