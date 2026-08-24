# Allocation-OFF margin exclusion — certification record

**Certified 2026-08-24.** The evidence for the repair in
[`allocation-off-margin-exclusion-repair.md`](allocation-off-margin-exclusion-repair.md),
and the permanent record of the one historical discrepancy it produced.

This document **is** the records-governance artifact. Per Edward's disposition
(2026-08-24) no application data model was created to memorialise a calculation
known to be defective, and no dual-margin UI was built.

---

## 1 · What was wrong

`separateServiceFees = 0` was unconditional (`costing.ts:1858`), so an
allocation-OFF one-time charge was absent from the costing engine entirely —
not in `contributionCostPerUnit`, not in `requiredSellPerUnit`, and therefore in
neither `totalCost`, `totalRevenue` nor `blendedMarginPct`.

The customer was still billed for it: the projection emits the line. So the
money was real on both sides and only the engine could not see it. ≈ **$75,025**
across 8 quotes.

**Only the analytical margin calculation was wrong. The historical contract was
not.** See §3.

---

## 2 · What the repair changed, per tier

Measured from the engine, before and after, on the affected population.

| quote | status | tier | margin before | margin after | classification |
|---|---|---|---|---|---|
| `93a5d4bb` | sent | 1 | 74.36% | **66.26%** | GOOD → GOOD |
| `97d25286` | complete | 1 | 29.58% | 29.56% | BELOW_TARGET, unchanged |
| | | 2 | 30.20% | 30.13% | BELOW_TARGET, unchanged |
| | | 3 | 31.03% | 30.85% | BELOW_TARGET, unchanged |
| `4781e4bb` | draft | 1–4 | 29.04–31.92% | 28.88–31.64% | BELOW_TARGET, unchanged |
| `52bd0077` | draft | 1–4 | 38.96–42.37% | 35.93–41.26% | GOOD, unchanged |
| `f2db6e10` | draft | 1 | 11.86% | **14.54%** | BELOW_FLOOR, unchanged |
| `f5f5ac14` | draft | 1 | 11.86% | **14.54%** | BELOW_FLOOR, unchanged |

**No tier changed floor or target classification.**

Direction is not uniform, and that was the finding: a charge at cost `e` and
recovery `e(1+r)` raises the margin only below `r/(1+r)` and dilutes it above.
The exclusion distorted margin **inconsistently** rather than conservatively.

---

## 3 · The historical contract was already correct

The projection has always billed the charge, so
`quote_snapshot_tier_totals.tier_commercial_total` has always included it. The
engine did not. Post-repair, on `97d25286` — the only affected quote that has a
frozen commercial record — across both snapshot versions and all three tiers:

```
frozen $ 7240.00  (otc $  140.00)   engine $ 7240.00   reconciles
frozen $17175.00  (otc $  700.00)   engine $17175.00   reconciles
frozen $18800.00  (otc $ 1400.00)   engine $18800.00   reconciles
```

**6 of 6 reconcile; 0 differ.** Pre-repair the engine was short by exactly the
OTC subtotal in every row.

The repair moves the engine **toward** the document the customer received, not
away from it.

**Coverage, stated rather than generalised:** only `97d25286` has frozen tier
totals. `93a5d4bb`, `071486be` and `a264a755` have snapshots but no frozen
commercial record — they predate that mechanism, and only 7 quotes DB-wide have
one.

---

## 4 · The historical discrepancy — `93a5d4bb`

`MISTR - Sachet Rollstock Test Roll / smoke-matrix-charges-0727`, status `sent`.
Recorded here and **nowhere else**; there is no application-level "historical
margin" concept in Nexus and none was created.

| | |
|---|---|
| historical live-calculated margin, before repair | **74.36%** |
| corrected analytical margin | **66.26%** |
| customer-facing economics | **unchanged** |
| frozen margin authority | **none existed** |

Charge: **$225.00**, recovered at **$292.50**.

The recovery is priced at **×1.30, not ×1.40**: this quote is `sent` and pins
`Production` at 0.3000 against the live default of 0.4000, so the repair priced
it at the rate the quote itself was priced at. The sizing estimate said 66.67%
using the live default; the engine produced 66.26% using the pin. **The engine
is right and the estimate was wrong** — which is why the estimate was never what
this was certified against.

**No external notification, and not a commercial correction.** The money charged
and the customer-facing economics do not change.

**Why no "corrected" label ships.** There was never a frozen-margin authority to
be in tension with, and labelling a figure "corrected" indefinitely would make a
one-time defect repair look like a permanent dual-authority model. Where a
frozen commercial record exists, the stronger proof is §3: live revenue
reconciles to the frozen customer total exactly.

---

## 5 · Certification evidence

**Customer-facing control — captured on both sides, not argued.** The
commercial projection for all 8 affected quotes, captured with the repair
stashed and again with it restored: **byte-identical, 8,636 bytes each**
(`scripts/gate-1b/alloc-off-repair-pdf-control.ts`). A structural argument is
how a NetSuite double-count nearly shipped (§6), so the control is measured.

**Amounts — every charge booked at exactly its stated amount**
(`scripts/gate-1b/alloc-off-repair-certify.ts`). Not a formality: a charge is
amortised at the leaf, bubbled up × `qty_per_parent` and multiplied back out by
tier quantity, so where `qty_per_parent ≠ 1` the round trip returns
`charge × qty_per_parent`. It could have booked $225 as another number with
every margin still looking plausible.

**Frozen snapshots untouched.** The repair is pure math in `costing.ts` and
performs no write. Snapshot count unchanged at 29.

**`markComplete` re-proven — the negative claim, stated as one.** The gate
refuses on `blendedMarginStatus` read from a **live** bundle on an
already-accepted quote (`mark-complete.ts:236, 255`), so this repair moves a
value a *governed gate enforces on*. **All 4 accepted quotes carry zero
allocation-OFF money; nothing became un-completable.**

Established with a `LEFT JOIN` across **both** owner branches after a first
query — joining only through `assemblies` — returned 0 accepted quotes against a
census of 4. *A filter that cannot express the failure it checks for reports
zero because it can only ever report zero.* The same correction found 11
production rows owned by a `quote_leaf` that the original population query would
also have missed; all 11 are allocation-ON, so the population table was complete
— by the data, not by the query.

**The Sales Order amount is unaffected.** `currentAmount` already reads the
**frozen** commercial total (`mark-complete.ts:313, 652`), not the live rollup.
`tierRollup` survives at that call site only for margin verdicts and the
per-unit cost basis.

---

## 6 · Two places the obvious implementation would have been wrong

**Not in `contributionCostPerUnit`.** That field *is* the unit cost Nexus sends
NetSuite (`mark-complete.ts:624, 716`), and a separately-billed charge already
travels as its own line carrying its own cost read live from
`assembly_production_inputs`. Adding it there too would have sent the same cost
**twice** — invisibly, because each side looks correct alone.

**No revenue when the rate does not resolve.** `productionMarkup` falls open to
0, so the bare product would book the charge's *cost* as though it had been
billed at cost. The projection fails visible in that case (BV-013) and bills
nothing. Booking revenue the customer was never charged is worse than booking
none.

---

## 7 · The S-7 recapture, and what it absorbs

The recapture is a deliberate act with this record attached. **It is not a way
to clear failures**, and the distinction matters here because the new baseline
absorbs more than this repair produced.

### Certified by this repair — absorbed knowingly

`93a5d4bb` (newly failing) and the growth in `f5f5ac14`'s existing failure.
Every moved scalar is one of: `costBreakdown.serviceFees`,
`costBreakdown.separateServicesMarkupSum`, `totalCost`, `totalRevenue`,
`blendedCost`, `blendedRevenue`, `blendedMarginPct`,
`separateServiceFeesPerUnit`, `separateServicesMarkupSumPerUnit`, and
`suggestedGlobalAdjPct` (derived from margin).

**No `requiredSellPerUnit`, no `contributionCostPerUnit`, no sell-ladder field
moved** — the claim the repair had to make.

### NOT certified by this repair — absorbed as a side effect

⚠️ **The baseline is stale for reasons that predate this work, and recapturing
blesses those too.** Four quotes were already failing S-7 on pristine `main`,
previously dispositioned as *pre-existing operator edits to live data* under a
standing instruction not to update the baseline. Recapturing supersedes that
instruction. What it takes in:

| quote | pre-existing movement |
|---|---|
| `27581262` SAMPLE | revenue +$25k, `blendedMarginStatus` **BELOW_TARGET → GOOD**, 24 scalars |
| `2f29af72` Smart Pressed Juice | `skuRollups` 10 → 9, revenue −$35.7k, `globalPriceAdjPct` 0.05 → 0.0463 |
| `f5f5ac14` | production/raw markup sums, suggestion microcopy |
| `f88c22e3` | `sellBeforeAdjustmentPerUnit` movements not accounted for by attribution |

These are **not** consequences of this repair — they reproduce with it stashed —
and they are **not** certified by it. They are named here so the new baseline
blesses nothing silently.

**Reversible:** the baseline is a committed file. Reverting the recapture commit
restores the prior one.

---

## 8 · Verification

- **2155/2155** under the governed runner (`npm run test:unit`)
- `npx tsc --noEmit` clean after the last edit
- customer-facing control byte-identical across the repair
- S-7 isolated by running it on **both** sides rather than against the stale
  baseline alone
