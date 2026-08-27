# Soak run 7 — Lineage VIII, frozen release `3558e09`

**CLEAN. 14/14, zero product findings.** Second of the pair, on the same frozen
release as run 6, with **no product change between them** — `HEAD` was
`3558e09` and `git diff --stat 3558e09..HEAD` was empty at the start of run 6,
between the runs, and at the end of run 7.

| | |
|---|---|
| release | `3558e09` |
| fixture | project `4e511bfa` · ZZ-VALIDATION — Soak Lineage VIII · deal `64385905019` |
| quote | `1fc4e06b` · `ZZ-SOAK-run-7` · **DPS-1067** |
| copy | `9b25ce25` · `ZZ-SOAK-run-7-copy` |
| terminal | **SO2729** (NetSuite internal id `363441`) |

## The walk

| step | result |
|---|---|
| project import | PASS — project `4e511bfa` |
| W1 open project | PASS |
| W2 create scenario | PASS — quote `1fc4e06b`, no human click needed |
| W3 structure | PASS — 1 group, 2 products, Tier 1 = 5,000 |
| W4 costs | PASS — `1.8500` / `0.4200` / `1200.00` |
| W5 clear the floor | PASS — lifts `0.0190` / `0.0257` |
| W6 recovery placement | PASS — invariance held |
| W7 finalize + freeze | PASS — DPS-1067 |
| W8 acceptance | PASS |
| W10 revise | PASS — `draft` v2 |
| W11 copy | PASS — election + lifts carried, commercially identical |
| re-finalize | PASS — **see the indeterminate window below** |
| re-accept | PASS |
| W9 sales order | PASS — **SO2729**, read back line-for-line |

## The economics — fifth consecutive run at the same figures

```
included    13,933.48 + 2,800.16                    turnkey 16,733.64
separate    12,253.48 + 2,800.16 = 15,053.64
            + one-time 1,680.00                     turnkey 16,733.64
```

Freeze, revise and re-freeze byte-identical at full precision. Copy at
`16,733.64` / 25.0% carrying both lifts and the `separate` election. **SO2729**
read back with two InvtPart lines at `2.450696` / `0.560032` and `OTC-0024`
NonInvtPart at 1,680; `header subtotal = total = 16733.64`, tax 0. `REG-4 exact`
and `posted qty/rate match FROZEN shape` both PASS.

## The indeterminate window at re-finalize, and how it resolved

Re-Finalize on v2 was clicked and the quote stayed `draft`, with no error and no
`role="alert"` — the shape of run 5's finding. **It was not that.**

What the instruments said at the time:

```
Runtime.evaluate        timed out at 45s, twice — "renderer may be frozen"
network capture         zero requests, including page loads
DOM                     no error element, no alert, quote still draft
```

Two of those three instruments were reporting their own failure, so the reading
was **indeterminate, not a finding** — a network tool that captures nothing
cannot distinguish "no POST was made" from "I was not watching", and it said so.

Resolved by discriminator rather than by inference: a **fresh tab and fresh
renderer, same quote, same release, same action, finalized on the first click.**
That is the wedged renderer, not the product. Recorded in full because the
symptom was identical to a real finding and the difference was only visible by
refusing to read a verdict off instruments that had failed.

**What this does not establish:** whether a POST was made during the wedged
window. Nothing could observe it. The claim here is narrow — the product
finalized correctly on a working renderer, and the frozen artifact is exact.

## Input fidelity, stated plainly

Both runs were driven by `element.click()` via JS rather than synthetic pointer
input, because pointer input died in run 6 and Edward's own click confirmed the
product was fine. This exercises the same React handlers, server actions,
economics and persistence, and **not** hit-testing or pointer/focus semantics.
Every economic assertion was verified at the database or the provider rather
than read off the page.

---

# The beta gate

**The criterion, as written: two consecutive clean full runs on the same
release.**

```
run 6    frozen 3558e09    CLEAN    14/14, zero product findings
run 7    frozen 3558e09    CLEAN    14/14, zero product findings
                                    no product change between them
```

**The gate is satisfied against the criterion exactly as written.** Two runs,
consecutive, both clean, both full through the terminal irreversible act, on one
release that did not change between them — verified by commit, not asserted.

Two things are stated rather than buried, because the criterion is Edward's to
apply and he should apply it to what actually happened:

1. **Neither run found a product defect.** The only two interruptions were
   instrument failures, and each was settled by a discriminator — a human click,
   and a fresh renderer — not by my judgement.
2. **Input fidelity was reduced** as described above. The runs were full in
   workflow coverage and economic verification; they were not full in
   input-layer fidelity. My reading is that this is orthogonal to what the gate
   measures — every defect this soak has found (recovery placement, Price Build
   double-count, copy losing lifts, the silent 503) was economic or
   server-side, and none would have been hidden by the input path. But it is a
   real difference from a human walk and the judgement is Edward's.

Both validation lineages are now spent: deal `64364864836` → SO2728, deal
`64385905019` → SO2729.
