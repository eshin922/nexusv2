# Soak run 6 — Lineage VII, frozen release `3558e09`

**CLEAN. 14/14, zero product findings.** First of the pair.

| | |
|---|---|
| release | `3558e09` — `main` and Production identical, tree clean, zero diff |
| fixture | project `f8c77db9` · ZZ-VALIDATION — Soak Lineage VII · deal `64364864836` |
| quote | `d721adf5` · `ZZ-SOAK-run-6` · **DPS-1066** |
| copy | `99eac4a6` · `ZZ-SOAK-run-6-copy` |
| terminal | **SO2728** (NetSuite internal id `363341`) |
| order | W1–W8 → W10 → W11 → re-Finalize → re-Accept → W9 terminal |

## The walk

| step | result | evidence |
|---|---|---|
| project import | PASS | project `f8c77db9`; VII only, VIII untouched; `client_name` from the cache |
| W1 open project | PASS | |
| W2 create scenario | PASS | quote `d721adf5` — **needed Edward's click**, see below |
| W3 structure | PASS | 1 group, 2 products, Tier 1 = 5,000 |
| W4 costs | PASS | Bottle `1.8500`, Box `0.4200`, setup `1200.00`, allocate = true |
| W5 clear the floor | PASS | lifts `0.0190` / `0.0257` |
| W6 recovery placement | PASS | invariance held (below) |
| W7 finalize + freeze | PASS | DPS-1066, one click |
| W8 acceptance | PASS | `accepted`; economics unmoved |
| W10 revise | PASS | → `draft` v2, same number |
| W11 copy | PASS | election + lifts carried; commercially identical |
| re-finalize | PASS | v2 froze byte-identical to v1 |
| re-accept | PASS | |
| W9 sales order | PASS | **SO2728**, read back line-for-line |

## The economics — fourth consecutive run at the same figures

```
included    13,933.48 + 2,800.16                    turnkey 16,733.64   $3.35/unit
separate    12,253.48 + 2,800.16 = 15,053.64
            + one-time 1,680.00                     turnkey 16,733.64   $3.35/unit
```

The Bottle line drops by exactly `1,680.00` — the whole charge, none of the
lift. Price Build reconciled: `15,053.64 + 1,680.00 = 16,733.64`, matching the
customer document. Freeze, revise and re-freeze were byte-identical at full
precision (`2.45069600` / `0.56003200`). The copy came out at `16,733.64` and
25.0%, carrying both applied lifts and the `separate` election.

**SO2728 read back from NetSuite:** two InvtPart lines at full-precision rates
and the one-time charge as its own NonInvtPart line (`OTC-0024`) at 1,680 —
not folded, not doubled. `header subtotal = total = 16733.64`, tax 0. Cost
rates carried the entered costs (1.85 / 0.42 / 1200).

The CERT-303 readback script's `VERDICT` block prints FAIL lines against its
own hardcoded fixture (quantity 2,000, item OTC-0016). Those are assertions
about a different quote and are not findings here; the two quote-specific
assertions — `REG-4 exact` and `posted qty/rate match FROZEN shape` — both PASS.

## Instrument, not product

**W2 required Edward's click.** Synthetic input died mid-session: `find` +
ref-click and raw-coordinate click both produced zero pointer events while JS
execution kept working, and recreating the tab did not restore it. Ruled out
beforehand: a second tab in the group, stale refs, coordinate mapping (this tab
measured 1:1, and the same coordinates had worked minutes earlier).

The control is hard — a synthetic click at `[1530, 330]` had created project
`f8c77db9` in the database minutes before, in the same session, with no product
change in between. Edward clicked `+ New scenario` once: **the modal opened.**
Instrument, settled by the discriminator rather than by my judgement.

**The rest of the run was driven by `element.click()` via JS**, which dispatches
a real click event to the same React handler. This is a deliberate substitute
and it is a genuine coverage reduction: it exercises handlers, server actions,
economics and persistence, but **not** hit-testing — visibility, obstruction,
z-order — nor pointer and focus semantics. Every economic assertion in this run
was verified at the database or at the provider rather than from the rendered
page, so the reduction does not touch what the soak measures. It is recorded
because it is a real difference between this run and a human one.

The lineage-builder's `netsuite_unavailable` is carried as a known harness
limitation per Edward's instruction; the customer/map/Sales-Order chain was
independently verified with a passing control read on customer `388800`.
