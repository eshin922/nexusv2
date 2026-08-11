# AM-005 · S-7 measures software and mutable production data together

**Status: DISPOSITIONED 2026-08-10 — the `ZZ-VALIDATION-*` namespace is excluded
from the S-7 preservation basket.** Not a Pricing regression, and never was.

> **The two incidents below are the evidence for that decision and are retained
> verbatim.** They are not superseded by it: one instance could be argued as
> mishandling, two — three hours apart, the second while the first was still
> being written up — are the mechanism. Neither has been deleted, rewritten, or
> reduced to a summary.

## Disposition

**Excluded the governed validation namespace at basket selection.**

*Rationale, as dispositioned:* S-7 is a **preservation invariant**. Validation
quotes are intentionally mutable instruments and therefore cannot simultaneously
serve as stable preservation references.

Four things were explicitly **not** done:

| not done | why it would have been wrong |
|---|---|
| restore the quote to make the digest green | treats the instance, leaves the mechanism — it had already re-broken once |
| re-baseline the `0.5072` margin | accepts a mutation as a reference, and destroys the remainder digest that proves the other 23 are preserved |
| exclude only the quote **id** | the next validation quote joins the basket the moment it is created |
| weaken comparison of the remaining population | the retained 23 are compared exactly as before, at full float precision |

### Implementation

`scripts/gate-1b/basket.ts` — one definition, imported by **both** the capture
script and the verifier. Extracted rather than copied for the reason
`canonical-digest.ts` was: two copies of a selection rule drift into a
difference that reads exactly like a commercial regression and is not one.

The exclusion is **symmetric**. Dropping the namespace from the live selection
alone would leave the captured entry unmatched and the verifier would report
*"in baseline, absent now — coverage silently shrank"*: the same red under a
different heading.

The reference for the global digest is now the **remainder digest** — the same
recorded per-quote digests, re-aggregated over the retained subset. Baseline
values only; no current value enters it. AM-005's one-off isolation script,
promoted into the standing check.

### A-1 additions, separated from movements

The raw digest could not see the line A-1 draws: a key the baseline never held
has no captured scalar to be identical to, but it moves the hash exactly as a
changed value would — because `canonical(undefined)` and `canonical(null)` are
the same string. P3-017's five new per-tier quantities therefore read as 23
failures.

`scripts/gate-1b/projection.ts` compares against the baseline's **own key set**.
Additions are set aside and **named in the report**, never silently dropped; a
key the baseline held — *including one it held at `null`* — survives projection
and fails if it moved. Pinned by `tests/unit/s7-basket-and-projection.test.ts`,
which is written mostly against what must NOT be tolerated, since both the
basket rule and the projection can only ever fail by making the check weaker
without making it red.

### Verified

| check | result |
|---|---|
| no `ZZ-VALIDATION-*` quote enters the basket | `gate1b:basket-membership` — 24 structural, 1 instrument, **23 in basket**; the two sets partition the estate exactly |
| retained population byte-identical to its preserved state | global digest **`e9943ad8c0fb6092e4e97e27239c1e56cea7cc45c4bfe087dcb41475699d9894`** — the same remainder digest recorded in *The investigation* below, reached independently by the standing check |
| additions are the approved A-1 set and nothing else | 2214 instances, exactly six shapes: `sellBeforeAdjustmentPerUnit`, `adjDeltaPerUnit`, `sellAfterAdjustmentPerUnit`, `liftDeltaPerUnit`, `sellAfterLiftPerUnit`, `overrideDeltaPerUnit` |
| `verify:s7-preserved` passes | **yes** — 23 quotes, every captured commercial scalar identical |
| `prebuild` passes with the verifier retained as a governed step | **yes** |
| `test:unit` | 744/744 |

The quote itself is left exactly as it stands, at `0.5072`. It was never
restored and its value was never adopted as a reference — it is simply no longer
asked to be one.

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

## Second instance — the same quote moved again, three hours later

Re-measured during P3-017's close-out. The figure is no longer `0.4530`:

| when (UTC) | change | source |
|---|---|---|
| 20:57:49.126 | tier `02278df4…` `null` → `0.1166` | `pricing_suggestion_surgical` |
| 20:57:49.755 | tier `02278df4…` `0.1166` → `0.2468` | `pricing_suggestion_surgical` |
| 20:57:59.771 | quote — bulk apply, `apply_delta 0.10995896…`, 4 tiers | `pricing_suggestion_global` |
| 20:57:59.790–.845 | all four tiers → `0.5676` / `0.3839` / `0.1100` / `0.1100` | `pricing_suggestion_global` |

**The 629ms compounding pair is the P3-016 signature again**, and it is not a
regression of the repair: `b6de377` is on the release branch and **not on
`main`**, so production is still serving the unfixed write-at-click path. The
repair cannot stop an operator using the deployed application.

Current blended margin: **`0.5072339132761682`**.

### Proof that the arithmetic is not implicated — exact, and not via the engine

`scripts/gate-1b/probe-zz-tier-propagation-margin.ts` (read-only). An adjustment
scales a tier's revenue and leaves its cost alone, so if the adjustment is the
*whole* cause then the moved figure must be reproducible from the **baseline's
own** cost and revenue:

```
baseline Tier 1   cost 11500        revenue 14887.5     margin 0.22753988245172124
live adjustment   0.5676
14887.5 × 1.5676 = 23337.645, cost held at 11500
predicted         0.5072339132761682
reported          0.5072339132761682
residual          0
```

Deliberately arithmetic rather than a re-run with the adjustments zeroed: a
re-run answers the question *through* the code under suspicion, and what is
being established is that the code did not change what it computes. Cost is on
the left-hand side at its captured value, so any drift in a cost input, a
markup, a freight allocation or the blend itself would surface as a residual.
There is none.

### What this second instance changes about the disposition

Not the diagnosis — it is the same finding, twice. What it changes is the case
for a **per-quote restore**, which is now visibly the wrong shape of fix:
restoring the four adjustments to `null` (their captured state, recoverable
exactly from the audit trail) would return the digest and leave the mechanism
untouched. It has already re-broken once. The next manual walk re-breaks it
again.

**The mutation is not intentional, and it is also not the problem.** The quote's
own `intent_note` reads *"DISPOSABLE VALIDATION ARTIFACT — do not use for
commercial work. Created 2026-08-06 to certify tier → Freight break
propagation."* Pricing adjustments are not what it exists to hold. But an
artifact that announces its own disposability and still sits in the release's
governing evidence is the basket question, not a data-hygiene question.

### The wiring made this urgent — and is now satisfied

`verify:s7-preserved` is now the ninth step of `prebuild`, so a change to
`SkuPerTierRollup` can no longer pass the build without executing the verifier
that governs it. That is the intended guard. Its side effect is that **`prebuild`
now fails whenever any of the 24 basket quotes is edited by anyone** — builds
are bound to production data.

That coupling is precisely this record's finding, arriving at a place where it
costs something. The two were one decision, and taking it resolved both: the
basket now holds only preservation references, so `prebuild` measures the
software rather than the estate. `verify:s7-preserved` is retained as a governed
prebuild step and passes.

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
| **Investigate the quote further** | Nothing left to find, and now proven rather than argued: the movement is reproducible to a residual of zero from the adjustment alone. See *Second instance* |
| **Restore the quote** | Available and exactly reversible — all four adjustments were `null` at capture, recoverable from the audit trail. Returns the digest; leaves the mechanism. Already re-broken once between the first investigation and the second |
| **Freeze the basket as an explicit ID list** | Broadest. Makes coverage a decision rather than a side effect of a query, at the cost of new quotes not joining automatically |

**Chosen 2026-08-10: the first.** S-7 measures a preservation reference set, not
the production estate — a mutable instrument cannot be a stable reference, and
that is the whole of the reasoning. See *Disposition* at the head of this
record.

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
