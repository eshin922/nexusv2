# OD-026 · Direct Component quantity — diagnosis

**Not implemented. Returned for disposition.** OD-026 gates OD-022.

---

## 1 · The mechanism, established from source

```ts
// costing-adapter.ts — sku construction, ALL leaves
{
  id: mathSkuId(al),
  parentSkuId: al.assemblyId,        // ← NULL for a Direct Component
  qtyPerParent: num(al.quantity),    // ← populated for EVERY leaf
}
```

```ts
// costing.ts · rollUpAssemblyPerTier — qtyPerParent is consumed HERE, only
for (const c of children) { packaging += c.rollup.packagingCostPerUnit * c.qtyPerParent; … }

// costing.ts · quote rollup — top-level SKUs use TIER quantity, not qtyPerParent
for (const top of topLevel) { breakdown.packaging += pt.packagingCostPerUnit * tQty; }
```

`qtyPerParent` is applied when folding **children into a parent**. A Direct
Component has no parent, so it is never a child, so **its quantity is stored,
carried into the math layer, and never consumed by anything.**

Measured (OD-025 trace, §B/§C):

```
assembly-backed leaf  qty 1/2/3 → packaging $10,000 / $20,000 / $30,000   scales
DIRECT leaf           qty 1/2/3 → packaging $10,000 / $10,000 / $10,000   ignored
```

## 2 · Classification — (3), undefined inheritance

**Not (1) a missing multiplication.** Nothing is absent: the multiplier is
applied at the parent fold, and that fold correctly does not exist. Adding a
multiplication at top level would be inventing a rule, not restoring one.

**Not (2) an intentional semantic difference.** No code decides this. There is
no branch, guard or comment expressing a Direct-Component quantity rule.

**It is (3): an undefined quantity inherited from the ASY-only model.** The
field is literally named **`qtyPerParent`** — *quantity per parent*. For a
Direct Component **there is no parent**, so the field has no referent. Its value
is not wrong; the question it answers does not exist. The current behaviour is
an artifact of a model in which every leaf had a parent, not a decision.

---

## 3 · Required return

**Current stored authority.** `quote_leaves.quantity` — `numeric NOT NULL
DEFAULT '1'`. Populated for Direct Components; **all 150 live rows are `1`**, so
no production quote can currently distinguish the readings.

**Current economic behaviour.** Read by the adapter into `qtyPerParent`,
**consumed by nothing** for a Direct Component. Packaging, production, freight,
sell and quote totals are all unaffected by its value.

**Flat NetSuite quantity implication (OD-022).** `buildGroupingPlan` emits
`lineAttribution` per line and the SO line quantity derives from the **tier**
quantity, not from `qtyPerParent` — which is why the Item Group contract is
`master qtyPerParent 1 → group line 1,000 → member 1,000`. So a flat Direct
Component would today project **tier qty (1,000)** and silently discard a
multiplicity of 2. **That is the load-bearing consequence**: the ambiguity does
not stay internal, it reaches the customer's Sales Order.

**Customer View implication.** The customer sees a per-unit price and a tier
quantity. Under reading (a) a multiplicity of 2 means the customer receives
2,000 cartons while the document says 1,000 — the document would be wrong. Under
reading (b) there is nothing to show. **No Customer View surface currently
renders leaf multiplicity**, so today the ambiguity is invisible rather than
resolved.

**Is multiplicity > 1 a legitimate business state?** For a **Finished Product
member**, unambiguously yes — two cartons per finished unit. For a **Direct
Component**, the component *is* the thing being sold; the tier quantity already
expresses how many are transacted. A second multiplier would mean "each sellable
unit is really 2 units", which is a **pack/UOM** concept, not a BOM one — and
Nexus has no pack model (`quote_skus.pack` was a Slice 11 deferral, never
landed). So multiplicity > 1 on a Direct Component is **not currently a
legitimate business state**, because nothing downstream can express it.

---

## 4 · Recommended V1 semantic

**A Direct Component's multiplicity is inherently `1`. The Direct Component IS
the commercial/sellable unit.** Reading (b).

Reasons, in order of weight:

1. **Nothing downstream can carry reading (a).** The flat NetSuite line takes
   tier quantity; the Customer View shows tier quantity. Choosing (a) would
   require a pack/UOM concept across projection *and* the customer document —
   far beyond OD-026, and it would make the customer document wrong until then.
2. **The tier already answers "how many".** Under (a), `tier × multiplicity`
   gives two competing answers to one question, with only one reaching NetSuite.
3. **It matches the observed behaviour**, so V1 ships what is already true
   rather than a silent change to live economics.
4. **It is the safe direction.** If (b) is wrong, a future pack model adds
   expressiveness. If (a) were adopted wrongly, quotes would ship understating
   quantity on the SO — a commercial error reaching the customer.

**Do not implement (a).** It would scale economics that nothing downstream
scales, reintroducing exactly the dimensional mismatch OD-025 just repaired —
the sellable-unit basis being multiplied a second time.

---

## 5 · Minimum repair

**Make the invariant explicit and enforced; change no arithmetic.**

1. **Refuse** `quote_leaves.quantity <> 1` where `assembly_id IS NULL`, at the
   authoring boundary (and ideally a DB `CHECK`). Today the value is accepted
   and ignored, which is the defect: it *looks* authored.
2. **Do not scale anything.** Live behaviour is already correct under (b); all
   150 rows are `1`, so a correct repair moves **zero** live money.
3. Record in `schema.ts` that `quantity` is meaningful only for an ASY-backed
   attachment, and that `qtyPerParent` has no referent without a parent.

Explicitly **not** in scope: a pack/UOM model. If Direct Components ever need
"2 per sellable unit", that is a pack concept requiring projection and
customer-document support — its own slice.

---

## 6 · Affected consumers

`costing-adapter.ts` (`qtyPerParent` population) · `costing.ts`
`rollUpAssemblyPerTier` + quote rollup · `grouping-plan.ts` (flat projection,
OD-022) · Customer View / PDF · Setup authoring (would need the guard) ·
`quote_leaves` schema. **No math change**, so no S-7 movement is expected — and
any movement would be evidence of over-reach.

---

## 7 · Falsification plan

1. Direct Component qty `1/2/3` → packaging identical (locks reading (b)).
2. **Falsify (a)**: if multiplication were added at top level, qty 2 doubles
   packaging — assert it does **not**.
3. Finished Product member qty `1/2/3` still scales `$10k/$20k/$30k` (OD-025
   preserved).
4. Mixed quote: member scales, direct does not, in one computation.
5. Authoring guard refuses `quantity = 2` on a direct attachment.
6. Guard permits `quantity = 2` on an ASY-backed attachment.
7. Flat projection sends **tier** quantity for a Direct Component.
8. Live S-7: **zero** monetary movement — measured with a filter that can
   represent numeric differences.

---

## 8 · Cross-references

Kept separate from **OD-027** (Product Library authority). Blocks **OD-023**,
then **OD-027**, then **OD-022**.

The 150/150 quantity-`1` population is the same coincidence that hid OD-025:
production data cannot distinguish the readings, so the defect is invisible
until Direct Components become operator-reachable — which is precisely what
OD-022 does.
