# P1 — mixed-structure provider probe: SAFE

**Date:** 2026-08-13 · **Runtime target proven sandbox before the write**
**Artifact:** SO2713 (internal `362141`) — **created, measured, deleted, deletion
proven**
**Result: NetSuite does NOT duplicate.** Branch A of the certification matrix
applies.

---

## The question, narrowly

When one CREATE carries an **Item Group line** and a **flat line for an item that
is not a member of that group**, does NetSuite duplicate anything?

Probe 7a observed duplication for members sent alongside **their own** group.
That is a different payload and settles nothing here. `buildSalesOrderPayload`
refuses the combination on the strength of it, and the refusal — not the builder
— is what this measures, so the probe bypasses the builder deliberately.

## Method

Disposable Sales Order, customer `360189`, subsidiary `2`:

| line sent | item | qty |
|---|---|---|
| Item Group | `75554` (`ASY-89688023-1-G`, members `1024` + `66476`) | **2** |
| unrelated flat | `71529` (`BA146400`) — in **no** group | **7** |

Quantities chosen distinct, small and mutually non-divisible so a duplication or
a quantity multiplication is unmistakable rather than merely plausible.

## Result — read back from the created order

```
line 1  Group      75554   qty 2
line 2  InvtPart    1024   qty 2      ← group member, expanded by NetSuite
line 3  InvtPart   66476   qty 2      ← group member, expanded by NetSuite
line 4  EndGroup       0
line 5  InvtPart   71529   qty 7      ← the unrelated flat line
```

Computed verdict, not eyeballed: total lines **5**; group header ×1; each member
×1 at qty 2; unrelated item ×1 at qty 7; EndGroup ×1. **SAFE = true.**

The group expanded exactly once and the flat line was honoured exactly once.
Neither structure disturbed the other, and no quantity was multiplied.

## Cleanup

`DELETE` issued, then a follow-up `GET` returned an **authoritative 404** —
`CONFIRMED DELETED`. A non-404 error would have been reported as INDETERMINATE
rather than as absence (OD-027: a catch that returns "missing" cannot establish
nonexistence).

SO2707 / SO2708 / SO2709 untouched. `SO2713` consumed one transaction number,
which is the expected cost of a disposable sandbox probe.

## Consequence

**Branch A.** One mixed `turnkey_only` governed artifact can prove all four
mechanisms — M1 Direct projection, M2 Direct Unit Cost at CREATE, M3 Item Group
member Unit Cost by post-expansion PATCH, M4 mixed coexistence — instead of two
artifacts.

**It requires lifting the mixed-structure refusal in `markComplete` first.** That
is legitimate rather than a weakening: the refusal states that mixed projection
is *not yet certified*, and this probe is the certification it names. Not yet
done — no code change and no governed artifact has been made.

**What the probe does NOT establish.** It proves NetSuite's line handling. It
does not prove that Nexus's grouping plan, cost projection and rate convergence
behave correctly across a mixed order — those are Nexus mechanisms and remain
the governed artifact's job. The refusal should therefore be lifted with the
artifact, not in advance of it.
