# Soak run 01

**Release under test: `713a964`** — frozen for the whole run, no merge to `main`.
**2026-08-26. CLOSED.**

Fixture built by the walk itself: `ZZ-SOAK-run-1` / `b055c021`, on the Smart
Pressed Juice deal. Products `DPS-BOTTLE-0001` and `10064-GNX-Box` inside item
group `ASY-b055c021-1`.

Every step was **new territory**. Run 1 buys almost no confidence on its own —
its job is to make run 2 repeat territory.

## Measurement

```
steps exercised            11  (W1-W11)
  PASS                     10
  BLOCKED                   1  (W9)
findings                    2
  catastrophic              0
  correctness               1
  presentation              1
  performance               0
repeat-territory steps      0
findings in repeat          0
```

**No verdict on stability is available from this run, and none is offered.**
With zero repeat-territory steps there is nothing yet to converge.

## Steps

| Step | Result | Notes |
|---|---|---|
| W1 · open project, deal context | PASS | project, deal, stage, rep, scenarios, activity |
| W2 · create scenario | PASS | modal complete; lands on Setup for the new draft |
| W3 · Setup — products, group, tier | PASS | 2 products into an item group; Tier 1 = 5,000 |
| W4 · Costs — packaging + production | PASS | 1.85 / 0.42; setup fee $1,200 allocated |
| W5 · Pricing — clear the floor | PASS | staged 2 lifts, applied; blended clears 25% |
| W6 · Commercial Recovery | PASS | election landed; **turnkey unmoved**; no second movement |
| W7 · Preview + Finalize | PASS | DPS-1062; frozen == previewed, to the cent |
| W8 · Client Review + Acceptance | PASS | accepted Tier 1; suppression held; frozen state unchanged |
| W9 · Sales Order | **BLOCKED** | provider reconciliation refused — finding 1 |
| W10 · Revise into v2 | PASS | number preserved, v1 snapshot retained as superseded |
| W11 · Copy scenario | PASS | structure carried, lifecycle not |

### The three that carried real weight

**W6 — the election moved presentation without moving money.** Electing
`project_setup` to a separate line moved $1,680 out of the unit price and onto
its own line, and the turnkey total did not change: `14,755 + 1,680 = 16,435`,
against `16,435` all-in beforehand. Re-measured after the debounced save
settled: identical figures, no additional audit row. Card 1 and the customer
document agreed throughout.

**W7 — the previewed state crossed Finalize intact.** Frozen lines
`12,334.04 / 2,800.16 / 1,680.00` are the exact figures the document showed
before the freeze. Rates froze at full precision (`2.46680800`) while the
document renders `$2.47` — the derive-from-amount discipline, not a rounded
rate stored. Customer identity froze at the same boundary
(`Jennifer Sevilla`), which is #431 Step 3 working on a real lifecycle.

**W8 — acceptance recorded a decision and moved nothing.** Frozen amounts
byte-identical to W7. Suppression held: `stage_written false`,
`amount_written false`, `from_stage_id == to_stage_id`. The amount that would
have been written, `16,814.20`, matches the turnkey total.

## Findings

### 1 · correctness · blocked ordinary workflow · ADJUDICATION REQUIRED

**W9.** A second accepted scenario on a HubSpot deal that already carries a
completed Sales Order cannot create its own. The send refused:

> `[markComplete] DUPLICATED DEAL could not be reconciled: Sales Order 362341
> (SO2715) is already owned by a different Nexus quote. Candidates are matched
> on HubSpot deal id, and one deal legitimately carries several scenarios —
> this order belongs to a sibling quote, not to this attempt. Adopting it would
> rewrite a completed order's commercial terms. Manual reconciliation required.`

**The guard behaved correctly.** It found the sibling SO, worked out it was not
this quote's, and refused rather than adopting it and silently rewriting a
completed order. Nothing posted; the quote stayed `accepted`.

The finding is the workflow, not the guard: multiple scenarios per deal is
described in the refusal itself as legitimate, yet the second one cannot be
sent, and the stated remedy — manual reconciliation — has no in-app path.

To determine after the run:

1. Is one HubSpot deal intended to support multiple independent Nexus Sales
   Orders?
2. If yes, what identity should distinguish them downstream — deal id is not
   sufficient.
3. Is "manual reconciliation" a governed operator procedure, or only an error
   message?

**If multiple scenarios per deal are normal and no sanctioned reconciliation
path exists, this is a beta blocker for W9.**

### 2 · presentation

The Send-order confirmation modal is substantially wider than its content and
leaves a large unused white column on the right. Post-run repair: max width
~760–820px, content/header take that width naturally, responsive behaviour
preserved, no copy/state/confirmation/send change.

## Observations — logged, not classified

Recorded so run 2 can tell whether they persist. None blocked the workflow.

1. **`synced 4mo ago`** in the project header, on a deal whose cache row was
   refreshed the same day.
2. **Two empty-cost registers on one table.** Setup shows `$0.00 cost` on one
   product and `— cost` on the other. One asserts zero, the other says unknown.
3. **`Sync status pending · Slice 11`** in the Costs header — reads as
   development scaffolding.
4. **`Add products…` creates another attachment** rather than moving an
   already-attached standalone product.
5. **Costs did not survive regrouping.** Packaging entered against standalone
   attachments was lost when those were removed and the products re-added as
   group members; 1.85 / 0.42 had to be re-entered. **Requires explicit
   adjudication after the run**: if regrouping an already-costed quote is a
   supported ordinary action, silent loss of entered costs is potentially
   correctness/data-loss rather than friction.
6. **Copy carried tier qty** (`Tier 1 = 5,000`), where an FR-12 note in
   CLAUDE.md describes qty as reset on copy.
7. **Copy did not carry the recovery election.** Source had
   `project_setup=separate`; the copy has none. Elections are arguably
   economics rather than lifecycle state.

## Not exercised

**Drag-to-group.** The only route I could not perform. Synthetic drags fail
against real drag-and-drop regardless of correctness, so this is recorded as
NOT EXERCISED — neither pass nor fail — and is excluded from the canonical
sequence pending a decision on whether it is part of the intended workflow.

## Canonical sequence for runs 2+

Recorded **as walked**, not as pre-written. Differences from the plan are kept.

1. W1 open project
2. W2 create scenario (from scratch)
3. **W3 structure FIRST** — create the item group, *then* add products into it
   via Item Group → `Add products…`, then set tier qty. This avoids the
   regrouping condition in observations 4 and 5, which gets its own
   investigation rather than being re-manufactured every run.
4. W4 Costs — packaging, then **explicitly expand Costs → Production** before
   entering production fees. Section state is URL-driven (`?section=production`)
   and defaults collapsed; do not assume it is open.
5. W5 Pricing — clear the floor via the governed lift
6. W6 Commercial Recovery — election, coherence, persistence
7. **Make the quote sendable before W7.** A quote below floor is correctly
   refused at Finalize; that is expected behaviour, not a step failure.
8. W7 Finalize → W8 Acceptance → W9 Sales Order → W10 Revise → W11 Copy

**W12, separate workflow, not folded into this path:** below-floor approval.
Different governance and different actors; it deserves its own entry rather
than being reached by accident when a walk happens to land under the floor.

## Instrument failures — mine, not the product's

Seven, recorded separately because every one of them presented as a product
defect and none was:

1. Add-product "did nothing" — missed click.
2. Retry added the wrong product — reopening the modal cleared the search.
3. Create-item-group "did nothing" twice — the modal WAS open; screenshots come
   back 1026×967 against a 1406×1326 viewport and cropped it.
4. "Drag is the only route into a group" — I had checked the row menu and not
   the group's own menu, which offers `Add products…`.
5. Setup fee would not persist, twice — the Production section was collapsed, so
   the input existed in the DOM and not on screen.
6. Stale element references after a structural re-render.
7. **The election.** Two of my clicks on `Separate` did nothing; Edward's single
   human click on the same unchanged fixture succeeded immediately.

**The discriminator that settled it:** one variable changed — who performed the
click.

Method correction adopted mid-run, and it cuts both ways: DOM evidence
establishes whether something exists; screenshots establish how it presents;
**neither substitutes for the operator interaction itself.** A cropped capture
is an instrument that cannot see the thing it is being asked to rule on, and
"the browser experience is the evidence" does not license trusting it blindly.
