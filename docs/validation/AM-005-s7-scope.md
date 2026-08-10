# AM-005 · S-7 measures software and mutable production data together

**Status: INVESTIGATED 2026-08-10. Awaiting disposition.** Not a Pricing
regression. Not repaired, and deliberately not — changing the hash scope is the
decision this record exists to inform.

---

## The finding

`gate1b:verify-preserved` fails against production:

```
baseline global 541a75a041dd1a2912d077b555fbab575750329930e3b743089ec493bae44fb2
current  global c0951e5100c29b0c357c88a7f066afcc2fcccc26c8d4be4a572953f12c5d0c65
```

Identically in three places — **`main` (`024d231`), this branch, and this branch
with the P3-016 repair applied.** No branch work causes it.

## The investigation — does the delta originate solely from the validation quote?

Asked because "one quote reported FAIL" is a weaker statement than it looks. The
global digest is a hash over every quote's digest in order, so a second quote
drifting, or the covered set changing size, moves it exactly the same way and
reads the same in the hash.

**Method.** Recompute every quote's payload digest with the verifier's own
canonical function, then compute the global digest **with the suspect quote
removed from both sides** and compare the remainders.
(`scripts/gate-1b/am-005-isolate.ts` — read-only; delete on disposition, since
the scope it assumes is the scope under question.)

| check | result |
|---|---|
| Covered set | **24 → 24.** None added, none dropped |
| Quotes whose digest differs | **exactly 1** |
| | `52bd0077…` · *Smart Pressed Juice — Juice Cleanse Reorder 2026 / ZZ-VALIDATION-tier-propagation* · `ba8725a1…` → `0c5adbb4…` |
| **Remainder, suspect excluded** | **`e9943ad8c0fb6092e4e97e27239c1e56cea7cc45c4bfe087dcb41475699d9894` on both sides — byte-identical** |

**Confirmed: the delta originates solely from the validation quote.** The other
23 are preserved exactly, and the software is not implicated.

## Why that quote moved — and it is not a coincidence

The audit trail names the cause precisely:

| when | entity | change | source |
|---|---|---|---|
| 2026-08-10 **17:55:44.682Z** | tier `02278df4…` | `null` → **`0.1884`** | `pricing_suggestion_surgical` |
| 2026-08-10 **17:55:45.409Z** | tier `02278df4…` | `0.1884` → **`0.4123`** | `pricing_suggestion_surgical` |

Both by `edward.shin@gmail.com`. **727 milliseconds apart.**

`1.1884² − 1 = 0.4123` — the composition rule applied to its own output.

**That is P3-016, in production, doing exactly what its record predicts.** The
first press committed silently: the below-floor headline did not clear, no chip
appeared, nothing confirmed anything. So it was pressed again. The second press
compounded onto the first, and the quote's blended margin moved
**0.2275 → 0.4530**.

The S-7 failure and the Pricing blocker are therefore related, but **not in the
direction the digest implies.** The software did not change a number. A defect in
the software led an operator to change one, by hand, on a quote inside the
measured basket.

### What this fixed in the repair itself

The double-press evidence exposed a defect the isolated observation could not:
the repair as first written composed the recommendation onto the **working** set,
so a repeat press compounded exactly as production had — visibly and
discardably, but still wrongly.

The classifier computes the recommendation from **committed** state, so
`lift_pct` is a lift measured from committed, and composing it onto a working
value that already contains it applies it twice. Corrected to read committed;
a repeat press is now idempotent. Verified in the browser — two presses, one
chip, unchanged at `15.4%` — and pinned by
`pricing-recommendation-stages.test.ts`.

**Pattern 50**: two subsystems answering the same question from different bases.

## What the finding actually is

**S-7 measures software and mutable production data together, and cannot
distinguish them.**

The invariant it states is about code: *"every commercial scalar returned by
`computeQuoteCosting` is byte-identical to the value captured before the node
graph existed."* The measurement is a digest over live computation from live
production rows. Any change to those rows fails the check with a message that
says a commercial number moved — which is true, and says nothing about the
software.

Two conditions make this reachable rather than theoretical:

1. **Dev and prod share one Supabase project.** Hand-made validation scenarios
   live in production because there is nowhere else to put them.
2. **The basket is defined by a query, not a list.** Every quote with an
   assembly-leaf attachment is included, so a scratch scenario created for a
   test joins the release's governing evidence automatically, and silently.

`ZZ-VALIDATION-tier-propagation` announces itself in its own label. It is in the
basket anyway.

## Options — for disposition, not recommended here

| | |
|---|---|
| **Exclude `ZZ-VALIDATION-*` from the basket** | Narrowest. Restores the invariant's meaning without re-freezing anything, and the naming convention already exists. Leaves any future scratch quote that does **not** follow the convention in the basket |
| **Re-baseline** | Accepts the current values as the new reference. Cheapest, and it discards the only evidence that the other 23 are preserved — the remainder digest above is exactly what re-baselining would throw away |
| **Investigate the quote further** | Nothing left to find: the audit trail is unambiguous, and the movement is fully explained by two operator clicks |
| **Freeze the basket as an explicit ID list** | Broadest. Makes coverage a decision rather than a side effect of a query, at the cost of new quotes not joining automatically |

**Not chosen here.** The first is the smallest change that restores the
invariant's meaning, but which is right depends on whether S-7 is meant to
measure *the production estate* or *a fixed reference set*, and that is a
question about the evidence's purpose.

## What must not be concluded

- **Not that the software regressed.** The remainder digest proves the other 23
  quotes are byte-identical.
- **Not that the quote's movement was a bug in the arithmetic.** It was the
  documented composition rule, applied twice because a silent write invited a
  second click.
- **Not that S-7 can be ignored.** It caught a real change to a production
  quote. It reported it under the wrong heading, which is the finding.

## Cross-references

- [P3-016](P3-016-surgical-staging-bypass.md) — the defect that caused the
  operator to press twice, and the repair.
- **AM-004** — the audit baseline is narrower than AUTHORITY_MAP's governing
  set. `docs/gate-1b-assumption-findings.md`, which defines S-7, is outside the
  baseline; this row is a direct instance.
- CLAUDE.md, *"Single Supabase project — dev and prod share one DB"* — the
  standing condition that puts validation scenarios in the measured estate.
