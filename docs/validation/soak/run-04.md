# Soak run 04 — the first clean run

**Release under test: `2f02912`** — frozen for the whole run.
**2026-08-26. CLEAN.**

Fixture built by the walk: `ZZ-SOAK-run-4` / `37d5b545` → **DPS-1064**, on
ZZ-VALIDATION — UAT Case 6, HubSpot deal `64200019819`. That deal is now
**consumed** by SO2726.

## Measurement

```
steps exercised            11  (W1-W11)
  PASS                     11
findings                    0
  catastrophic              0
  correctness               0
  presentation              0
repeat-territory steps     11
findings in repeat          0   <- the number that must trend to zero
```

**Every step was repeat territory, and every step passed.** The first run of
the soak with zero product findings.

## Steps, in the corrected walk order

W9 is terminal, so W10 and W11 were walked before it — the order established
after run 3 discovered that a completed W9 makes Revise unreachable.

| Step | Result | Territory |
|---|---|---|
| W1 · project + deal context | PASS | repeat |
| W2 · create scenario | PASS | repeat |
| W3 · item group, 2 products, tier | PASS | repeat |
| W4 · Costs — packaging + production | PASS | repeat |
| W5 · Pricing — clear the floor | PASS | repeat |
| W6 · Commercial Recovery | PASS | repeat |
| W7 · Preview + Finalize (v1) | PASS | repeat |
| W8 · Client Review + Acceptance | PASS | repeat |
| W10 · Revise → v2 | PASS | repeat |
| W11 · Copy scenario | PASS | repeat |
| — re-Finalize + re-Accept (v2) | PASS | consequence of W10, see below |
| W9 · Sales Order — **SO2726** | PASS | repeat |

## The commercial model, verified end to end

**Recovery placement invariance held.** Measured on the live quote before the
election, across all three placements:

```
legacy (no election)   unit 16,733.64   otc     0.00   total 16,733.64
elected included       unit 16,733.64   otc     0.00   total 16,733.64
elected separate       unit 15,053.64   otc 1,680.00   total 16,733.64
```

The recovery moves between the unit subtotal and its own line. **The total does
not move.** Run 2 measured `-$28.05` at this step on the pre-repair release.

**The Price Build reconciled to the customer document.** Run 3 found the
operator surface showing `$18,413.64` against a document total of `$16,733.64`
— the embedded recovery counted twice. After repair #453 the two agree, and the
`ORDER RECONCILIATION` heading is true for the first time.

**Finalize, freeze and Acceptance were economically identical.** The frozen
snapshot carried exactly what Preview showed, and Acceptance moved nothing:

```
v1 frozen   unit 15,053.64 + otc 1,680.00 = 16,733.64
v2 frozen   unit 15,053.64 + otc 1,680.00 = 16,733.64
accepted    unchanged
lines       2.45069600 / 0.56003200 / Project setup 1,680.00
```

Rates froze at full precision under a `$2.45` display — derive-from-amount
working, not a rounded rate stored. HubSpot suppression held at acceptance:
`stage_written false`, `amount_written false`, `from_stage_id == to_stage_id`,
and the amount that WOULD have been written, `16,733.64`, matches the turnkey.

**The copy preserved the recovery election AND the applied lifts.**

```
source   lifts 0.0190 / 0.0257   election project_setup=separate
copy     lifts 0.0190 / 0.0257   election project_setup=separate
source   unit 15,053.64  otc 1,680.00  total 16,733.64  blended 25.001%
copy     unit 15,053.64  otc 1,680.00  total 16,733.64  blended 25.001%
```

Both `BELOW_TARGET` and sendable. In run 3 the copy came out at `16,435.00` and
`23.639%` — **below the floor** — because the lifts did not clone. Repairs #448
(elections) and #452 (lifts) are both confirmed on the real surface, and the
copy is now commercially identical to its source to the cent, which is what the
clone contract requires.

Lifecycle correctly reset on the copy: draft, no quote number, no Sales Order,
not sent, not accepted.

## SO2726, read back from NetSuite

The order was created and converged to `succeeded`, then read back from the
sandbox rather than trusted from the push record:

```
SO2726 · id 363241 · deal 64200019819 · customer 388800 · foreigntotal 16,733.64
  66476  InvtPart      5,000 x 2.450696  =  12,253.48
  1024   InvtPart      5,000 x 0.560032  =   2,800.16
  26348  NonInvtPart       1 x 1,680.00  =   1,680.00
```

**Line-for-line consistent with the frozen quote**, and byte-identical in shape
to run 3's SO2725: full-precision rates, the one-time charge as its OWN line
rather than folded into a unit price or counted twice, and a total matching the
frozen figure exactly. `netsuite_so_tranid` populated.

The push passed through `awaiting_rates` — the documented state between the
bare grouped CREATE and member-rate convergence — before reaching `succeeded`.
That is the lifecycle working, not a stall.

## Instrument limitation — NOT a product finding

**W5 required Edward's human click.** So did four other steps.

The cause was mine: the browser automation **reused stale element references**.
A ref captured before an interaction re-rendered the DOM no longer addresses a
live node, and the click resolves to nothing. Re-finding the reference
immediately before each click fixes it, which is what the second half of this
run did — every step from W11 onward was driven without assistance, including
the irreversible send.

**The product was never at fault**, and the discriminator that established it
is the same one run 1 used: one human click on an unchanged fixture succeeded
where five synthetic clicks had failed. The release was exonerated before any
finding was written.

Recorded because the misdiagnosis cost real time and was made twice — the
failures were framed as a possible regression on the frozen release on two
separate occasions, and both times a human click disproved it. This is run 1's
finding #6, logged then and under-weighted for three runs.

**Method, now explicit:** re-`find` the element reference immediately before
every click. Never reuse a reference across an interaction that could
re-render. `scroll_to` alone is not sufficient and was not the cause.

## Sequence finding — W10 unwinds Acceptance

**Revise necessarily rolls the acceptance back**, because that is what revising
a sent-and-accepted quote means: `unmarkAccepted` runs first, then the version
bump. The quote returns to `draft` at v2 with `sent_at` preserved and
`accepted_at` cleared.

So walking W10 before W9 — the order run 3 established — **costs a re-Finalize
and a re-Accept** to get back to sendable. The order is still correct; it simply
is not free, and the walk must budget for the two extra acts.

Both were exercised here and both behaved: v2 froze to the same figures as v1,
and the re-acceptance carried the same tier with suppression intact.

## State left behind

- **DPS-1064 is `complete`** at v2, carrying SO2726. Deal `64200019819` is now
  **consumed** and can never produce a second Nexus Sales Order.
- `ZZ-SOAK-run-4-copy` (`58eeba72`) — a draft, commercially identical to its
  source, left in place as the evidence for the copy repairs.
- **One clean lineage remains**: ZZ-VALIDATION — Soak Lineage VI
  (`64362942065`), provisioned for exactly this. Run 5 is the last run that can
  exercise W9 without new fixture capacity.

## What this does and does not establish

Run 4 is **one** clean full run on `2f02912`. The gate is **two consecutive
clean full runs on the same release**, so this is half of it.

Run 5 must execute on the same frozen release with no product change between
them — a repair in the gap would make them two measurements of two products,
which is the freeze rule stated as an acceptance criterion rather than as
etiquette.
