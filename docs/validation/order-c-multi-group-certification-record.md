# Order C — multi-Item-Group Accounting artifact

**SO2708** (internal id 361642) · deal `59184980904` Kirby Beauty · quote
**DPS-1049** · completed 2026-08-13. All verification checks pass.

## Amendment to the approved structure

Approved C specified Group B at **qty 500** (`$1,025`, SO total `$4,525`). That
is **not expressible**: `mark-complete.ts` emits every group line as
`quantity: groupingPlan.tierQty`, and `matchGroupMembership` asserts
`headerQuantity === tierQty`. There is no per-group quantity in the schema or
the plan.

Dispositioned to one tier quantity. C's demonstrative purpose is unaffected —
it rests on differing **member sets** (which mint distinct masters) and on the
shared Bottle priced independently, not on quantity asymmetry.

## Artifact

```
Group ASY-c3c951c7-A-G   qty 1,000
  10064-GNX-Box     1,000 @ $1.10 = $1,100   class 10
  DPS-BOTTLE-0001   1,000 @ $2.40 = $2,400   class 1
EndGroup                                3,500

Group ASY-c3c951c7-B-G   qty 1,000
  DPS-BOTTLE-0001   1,000 @ $2.05 = $2,050   class 1
EndGroup                                2,050

ORDER TOTAL                             $5,550     customer 167468, Net 30
```

**Two distinct Item Group masters**, different composition hashes
(`nxs-grp-49322dc0…` / `nxs-grp-bf79be1d…`) — confirming the hash keys on member
set, not rate. The shared Bottle carries **$2.40 in A and $2.05 in B**.

Guards: no $0.00 governed member · no 1,000,000 member quantity · exactly one SO
for the deal.

Nexus: `complete`, mirrors 361642 / SO2708, durable push `succeeded`.
Production HubSpot **unchanged** — stage `195274339`, amount `30000`, closedate
and lastmodified at baseline.

## Findings banked

1. **`quote_leaves.assembly_id` is the grouped-membership marker.** Seeding it
   NULL produced **zero** assembly revenue while each leaf's own rate computed
   correctly — the leaves were treated as Direct Components. Caught by verifying
   the math *before* Send. A NULL there reconciles to nothing, quietly.
2. **Browser input is silently dropped when the tab is backgrounded.** Clicks
   and keystrokes report success and do not dispatch when
   `document.visibilityState === "hidden"`, even with `hasFocus === true` and the
   target topmost and enabled. Check `visibilityState` before UI interaction.
3. **Acceptance "their words" did not capture** on C (empty). Optional PM
   narrative that never reaches the SO, so the artifact is unaffected; recorded
   for completeness. Tier and channel captured correctly.
