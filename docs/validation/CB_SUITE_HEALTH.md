# CB Suite Health

**The operational view while Track B is completed.** Updated per run, not on a
schedule.

**Last run:** 2026-08-10 · **Baseline:** **BASELINE-01 — ESTABLISHED.**
**BASELINE-02 attempted and NOT established** — the suite grew to 23 scenarios
and two clean runs disagreed on one. See below.

## What BASELINE-01 is, and is not

**Amended 2026-08-10 — the interpretation only. BASELINE-01 itself is unchanged
and will not be edited.**

> **BASELINE-01 is a stable reference measurement.**
> **It is not evidence that the harness is fully deterministic.**

Both halves are load-bearing. It remains the reference every run is compared
against, and every delta measured against it so far has been meaningful. What it
does not establish is that a scenario's result is a property of the code —
two of its twenty-two are now known to be races, and its own admission criterion
sampled twice and happened to agree.

## Admission criterion

> **A trusted baseline exists only when two consecutive executions from
> identical clean environments produce identical outcomes.**

One criterion, stated once, and nothing else counts as a baseline. Not "mostly
agrees," not "agrees on the failures that matter." **Identical outcomes** —
same passes, same failures, same unmeasured set.

## Sequence

Strictly ordered. Each step is meaningless before the one above it holds.

| | step | status |
|---|---|---|
| 1 | **Deterministic environment** | ✅ Established |
| 2 | **Deterministic harness** | ✅ Established |
| 3 | **Trusted baseline** | ✅ **BASELINE-01** — criterion met |
| 4 | **Scenario classification** | ⏳ **Started.** 3 classified, 7 remaining |

> **No failure below is classified, and none is discussed as anything.**
> Classification is step 4. Naming a cause before the harness is deterministic
> is how a fabricated failure category gets into a report — this project has
> paid for that once already.

---

## Status at a glance

| | status | evidence |
|---|---|---|
| **Harness** | ✅ Runs end-to-end from governed commands | 22 specs execute; isolation proven per run |
| **Seed** | ✅ **Deterministic** | Two reset→seed cycles, byte-identical counts |
| **Reset** | ⚠️ **Namespace-scoped, not absolute** | Clears its own `runId` world only; foreign-runId rows survive |
| **Clean environment** | ✅ **Reproducible** | `db:reset` → migrate → seed yields absolute counts **equal to** fixture counts |
| **Harness determinism** | ⚠️ **One known flake** | `lifecycle-surface-consistency` — agreed across BASELINE-01's two runs, then failed A′ and passed B′ |
| **Trusted baseline** | ✅ **BASELINE-01** | Two consecutive clean runs, identical outcomes |
| **Classified failures** | **3** | VAL-101 harness · VAL-104 test issue (fixed) · VAL-103 harness |
| **Unclassified failures** | **10** | Identical set in runs A and B |
| **Unmeasured (did not run)** | **3** | All in `basic-quote-persistence.spec.ts`, after VAL-101 |

---

## BASELINE-01 — the criterion is met

| run | environment | pass | fail | unmeasured | agrees? |
|---|---|---|---|---|---|
| **A** | clean | **9** | **10** | **3** | — |
| **B** | clean, identical procedure | **9** | **10** | **3** | ✅ **identical** |

Same passes, same failures, same unmeasured set. **BASELINE-01 is the trusted
baseline**, and a delta against it is now a measurement.

**It is a baseline, not a clean bill of health.** Ten scenarios fail in it and
three are unmeasured. What changed is that those numbers now mean something.

### What made the harness deterministic

One assertion was racing a client-side navigation. `lifecycle-surface-consistency`
clicked through to a destination route and asserted on its content immediately;
whether the RSC render beat the 5s expect timeout decided the outcome, so
identical inputs produced different results.

Fixed by waiting for the navigation to **commit** before asserting — at both
client-side transitions the spec deliberately exercises. **The assertion itself
is unchanged.** PB-005 is a claim about not needing a hard reload, not a claim
about how fast a soft navigation streams, so waiting for the URL asserts the
same behaviour deterministically rather than weakening it.

### The three unmeasured scenarios are precisely located

All three live in `basic-quote-persistence.spec.ts` **after** VAL-101, which
fails: **VAL-103** (concurrent debounced cost edits), **VAL-104** (governed
Pricing Vendor without dormant Pricing Date), and **PHASE2 Packaging targets
each SKU**. Serial execution stops the file at its first failure.

They are not passing and not failing. **They are unmeasured** — and VAL-104
carries more weight than the other two: it is REG-1's browser-level evidence,
and REG-1 is the one register gate claiming V1 COMPLETE.

---

## BASELINE-02 attempt — NOT ESTABLISHED (2026-08-10)

The suite intentionally changed: **VAL-209** was added
(`pricing-recommendation-staging.spec.ts`), walking the recommendation CTA whose
absence let P3-016 ship. A suite change is exactly when BASELINE-01's own rules
call for a **successor** baseline, so two clean runs were attempted.

| run | environment | pass | fail | unmeasured | total |
|---|---|---|---|---|---|
| A | clean, full procedure | **9** | **11** | 3 | 23 |
| B | clean, identical procedure | **10** | **10** | 3 | 23 |

**They disagree. The admission criterion is not met, so there is no
BASELINE-02.** BASELINE-01 remains the only established reference, and remains
untouched.

### What disagrees, and what does not

**VAL-209 passed in both.** The new coverage is itself deterministic, and run B
is exactly *BASELINE-01 plus VAL-209 passing* — same nine passes, same ten
failures, same three unmeasured.

The single disagreement is `lifecycle-serial › lifecycle-surface-consistency`
— **failed in A, passed in B.**

### The finding this produces

That is the same scenario that was non-deterministic before BASELINE-01
(passed run 2, failed run 3), and which a navigation-commit fix was expected to
settle. **It has another race, at a different assertion.** In run A it failed at
`spec:76` — `getByText("Order placed")` not visible within 5s after *Send order
to NetSuite* → confirm. That is nowhere near the client-side transitions the
earlier fix addressed.

So the honest reading of BASELINE-01 has to change, and it is worth stating
plainly:

> **Two consecutive agreeing runs can be satisfied by chance.** BASELINE-01's
> runs A and B agreed on this scenario. Three subsequent executions have now
> produced: fail (A), pass (B). The criterion did not detect the flake — it
> sampled twice and the samples happened to match.

**BASELINE-01 is not wrong and is not edited.** It remains an accurate record of
what two clean runs produced on 2026-08-10, and every delta measured against it
so far has been meaningful. What is now qualified is the *inference* from it:
its expected outcome contains at least one scenario whose result is not a
property of the code.

### What this does not license

- **Not re-running until two agree.** That converts the criterion into a search
  for a matching pair, which is how a flake gets certified as a baseline.
- **Not editing BASELINE-01** to mark the scenario unstable. A baseline that
  absorbs explanation stops being a measurement, which is the rule it opens
  with.
- **Not classifying the other ten.** They failed identically in A, B and
  BASELINE-01, and that stability is what makes them classifiable.

### What would settle it

`lifecycle-surface-consistency` needs its second race diagnosed the way the
first was — from the failure signature, not by adding waits until it passes.
Two candidates, in order: the NetSuite send confirmation may complete
asynchronously without the assertion waiting for the state it produces; or the
5s expect timeout may simply be racing a legitimate multi-second operation. The
distinction matters, because one is a test defect and the other is a contract
the spec never stated.

Until then the suite has **one known non-deterministic scenario**, and a
successor baseline cannot honestly be established.

## Superseded — why the criterion was not met before

| run | environment | passed | failed | did not run |
|---|---|---|---|---|
| 1 | dirty (residual foreign-runId world) | 7 | 12 | 3 |
| 2 | **clean** (`db:reset` → migrate → seed) | **9** | **10** | 3 |
| 3 | **clean** — identical procedure to run 2 | **8** | **11** | 3 |

**Runs 2 and 3 were produced by the same commands against the same rebuilt
environment and did not agree.** Until they do, no number this suite produces is
evidence, and a delta against it is not a measurement.

Two separate effects are visible, and they are different problems:

**Environment sensitivity (runs 1 → 2).** Two specs — `workspace-governance` and
`lifecycle-surface-consistency` — passed once the environment was rebuilt.
Residual state from a previous `runId` was reaching them. This is now controlled
by rebuilding rather than by fixture reset.

**Non-determinism (runs 2 ↔ 3).** `lifecycle-surface-consistency` **passed in
run 2 and failed in run 3**, on identical inputs. **Resolved** — see
BASELINE-01 above. The other ten failed in both.

## Classification — first three, with evidence (2026-08-10)

Step 4 has started. Each classification names **implementation defect ·
specification drift · harness issue · test issue · missing evidence**, and each
one below is a classification of a *scenario*, not of the product.

**None of these is an implementation defect.** That is a finding in itself: the
three failures examined so far are all properties of how the suite is built or
run.

### VAL-101 — **harness issue** · cross-project fixture contamination

**It passes.** Run `basic-quote-persistence.spec.ts` on a freshly seeded
database and VAL-101 passes in 33s. It fails only in a full-suite run.

The cause is fixture sharing across projects. Four `lifecycle-serial` specs use
`manifest.quotes.draft` — the same quote VAL-101 depends on — and one of them,
`primary-send-lifecycle`, **sends it**. `lifecycle-serial` runs before
`costing-serial`, so by the time VAL-101 opens the Costs surface the quote it
needs in `draft` is in `sent`, and the surface is read-only.

Corroborated independently: a database dump taken after a full suite run shows
`Validation draft` at status **`sent`**. After an isolated run it is still
`draft`.

**Consequence for the record.** VAL-101 was the head of the file, so its failure
is what left VAL-103, VAL-104 and PHASE2 Packaging unmeasured in BASELINE-01 —
**three unmeasured scenarios attributable to a fixture-sharing decision, not to
the product.** The `frame.join is not a function` runtime error captured in the
older artifact is a dev-mode React error-*deserializer* crash, and a plain
navigation to the same URL now renders cleanly; it is a symptom seen while the
page was in the contaminated state, not the defect.

**Fix shape, not yet applied.** Either give the lifecycle project its own quote
fixtures, or make `costing-serial` reseed rather than inherit. Both change the
fixture world and therefore the baseline, so neither is done silently.

### VAL-104 — **test issue** · a hardcoded run-id literal · **FIXED**

Measured for the first time, because VAL-101 no longer blocks it in isolation.

```
Expected substring: "VAL-SLICE12-1"
Received string:    "VAL-LOCAL-EXAMPLE-1 · 1/unit"
```

The fixture derives the component code from the runId (`VAL-{RUNID}-1`). The
spec asserted the literal `VAL-SLICE12-1`, which is only correct when
`NEXUS_VALIDATION_RUN_ID` happens to be `slice12`. Under any other runId — and
`.env.validation.local` sets `local-example` — **the scenario failed on the
spec's own hardcoding rather than on anything the product did.**

Fixed by deriving the expected value from `runId`, the same source the fixture
read. Pattern 53 applied to the assertion side: a test that writes down a value
the fixture computes is a second copy of a rule.

**This matters beyond one assertion.** VAL-104 is **REG-1's browser-level
evidence**, and REG-1 is the register gate claiming V1 COMPLETE. It has never
produced a verdict about the product — it has been failing on a string.

### VAL-103 — **harness issue** · non-deterministic, and a CDP race

Passed in one isolated run of the file and failed in the next, from an identical
clean seed. The signature is not a product assertion:

```
Error: response.text: Protocol error (Network.getResponseBody):
       No data found for resource with given identifier
```

The spec reads a response body that Chrome has already discarded — the shape
that happens when an RSC fetch is superseded and aborted mid-flight, which is
exactly what the surface under test does by design. The scenario is racing the
browser's own resource lifetime.

**Second non-deterministic scenario**, alongside `lifecycle-surface-consistency`.
Tracked with it, and it does not block classification of the stable failures.

### REG-1 browser evidence — reconsidered on the corrected harness

VAL-104 is REG-1's browser-level evidence, and the runId fix let it be measured
rather than blocked. Re-run on a fresh seed, alone:

**It gets further, and still does not produce a verdict.** The identity
assertions the hardcoded literal used to fail on now pass — `.name .lab` reads
`Validation Leaf 1` and `.name .sub` reads the derived
`VAL-LOCAL-EXAMPLE-1`, which is PB-006/PB-007 satisfied. It then times out at
`spec:466`, clicking the *"Other SKUs in this scenario (2)"* disclosure.

**Correction — the element is NOT on the page.** An earlier note in this file
said it was, on the basis of two occurrences of the string in the failure
artifact. Both were echoes: one the Playwright call log
(`waiting for getByText(...)`), one the test-source listing. **The rendered page
snapshot does not contain it.**

Confirmed independently in the browser against the same fixture: zero DOM nodes
whose text matches, on a fresh load of the Costs surface, and still zero after
selecting a packaging row (which only appends `?tier=…`).

**So the first failing condition is the first one on the list: the element does
not exist.** Not zero-size, not covered, not mid-animation, not unhydrated,
not replaced between discovery and click — absent. Every later condition is moot
until that is explained, and no timeout increase or force-click could have
reached it.

**Resolved 2026-08-10 — fixture expectation defect, not a product rendering
defect.**

Two facts settle it.

**The count is right.** The scenario has **three** leaves — `Validation Leaf 1`,
`2` and `3` — so a disclosure reading *"Other SKUs in this scenario (2)"* would
be arithmetically correct. The fixture is not short of SKUs.

**The control was deliberately removed**, and the rationale is recorded at the
removal site. `scenario-context-strip.tsx:6`, from the §6.b path-B Costs
migration:

> *"The redundant Other SKUs control is intentionally absent because the unified
> Costs page already renders every SKU."*

So the spec asserts a control the product intentionally no longer has. **The
capability it was probing is still satisfied** — more directly than before,
because the unified page renders every SKU rather than hiding the others behind
a disclosure.

**Classification: test issue.** The same class as VAL-104's first defect, and
the second time this one scenario has failed on its own expectations rather than
on the product. Both were invisible while the row was unmeasured.

**Remediation shape** (not applied): drop the disclosure click and assert
`Validation Leaf 2` visible directly, which is what the surface now renders. The
assertion's intent — other SKUs in the scenario are reachable from here — is
preserved and stops depending on a control that was removed three migrations
ago.

**Repaired, rerun, and it fails at a later boundary — classified below, and
only that one.**

The disclosure click was removed and the region assertions left in place. From a
clean seed, VAL-104 now clears the identity block and stops at `spec:476`:

```
Locator: getByRole('region', { name: 'SKU + scenario context' })
           .getByText('Validation Leaf 2')
Error:   element(s) not found
```

**The newly observed boundary: the assertion scopes to the wrong container.**
The region exists and renders — the failure snapshot shows its full contents:

```
region "SKU + scenario context":
  VAL-LOCAL-EXAMPLE-1 — anchor SKU · Validation Leaf 1 · 2 tiers · 600 units
  link "⌥ Switch scenario"
```

It is an **anchor-SKU context strip**, not a roster of the scenario's SKUs. It
names which SKU you are anchored on and offers a way out. Leaves 2 and 3 are
rendered by the unified Costs page — three packaging drilldown rows were
observed directly — but **outside this region**.

So the scope was inherited from the era when the removed disclosure expanded
*within* that strip. With the control gone, the container that renders every SKU
is the page, which is exactly what the §6.b rationale said: *"the unified Costs
page already renders every SKU."*

**Classification: test issue.** Third on this scenario, third not a product
defect. Not repaired — classified only, per instruction.

**Remediation shape** (not applied): scope the two leaf assertions to the page
rather than to the context region, and keep the negative assertion — that
`Validation draft assembly` does not appear — scoped to the region, since that
one *is* about the strip's contents.

**Repair completed, rerun, and it now reaches the vendor-save boundary.**

The first repair pass removed the disclosure click but left the leaf assertions
scoped to the context region — half the instruction, and the failure that
produced was avoidable. Completed: the two leaf assertions read the **page**,
which is the container that renders every SKU. The negative assertion stayed on
the region, because that one genuinely is about the strip's contents — the
anchor context names a leaf, never the assembly above it, and widening it would
assert the assembly is absent from a surface entitled to render it.

**VAL-104 now clears everything it has ever failed on** and runs deep into the
governed Pricing Vendor flow — identity block, scenario context, vendor search
including the empty-state copy *"No eligible HubSpot Vendors match…"*, and a
successful search round-trip for `Contract`. It stops at `spec:537`, waiting for
the save response after selecting `Validation Contract Manufacturer`:

```
Error: page.waitForResponse: Test timeout of 90000ms exceeded.
```

**Newly observed boundary — and it is the first that is plausibly about the
product.** Every earlier one was a stale expectation. This one is a save that
does not arrive.

**Not classified.** The evidence does not yet separate two candidates, and they
have different owners:

- the option never became selectable, so the click is what is pending — a
  harness or rendering question;
- the click fired and **no save POST followed** — a product defect in the
  governed vendor-save path.

`waitForResponse` is reported at the line where the promise was created, not
where execution is parked, so the artifact alone cannot tell them apart. The
next step is narrow and follows the same discipline as the disclosure
investigation: establish whether the option exists and is actionable **before**
reasoning about the save.

**Consequence for REG-1.** Its browser evidence has now failed three times for
three reasons, none of them the product: fixture contamination, a hardcoded
literal, and an expectation of a removed control. It stays **Insufficient
evidence** — with the qualification that nothing found so far argues against the
product, and nothing yet argues for it either.

**Status of REG-1's evidence, stated plainly:**

| | |
|---|---|
| Before | unmeasured — VAL-101 contamination blocked the file |
| After the VAL-104 fix | **measured, and failing at a later point** |
| Verdict about the product | **still none** |

What changed is that the failure is now visible and specific instead of hidden
behind an unmeasured row. REG-1 is the register gate claiming V1 COMPLETE, and
its browser evidence has still never passed.

### Where that leaves the ten

| scenario | classification |
|---|---|
| VAL-101 | **harness** — cross-project fixture contamination |
| VAL-104 *(was unmeasured)* | **test issue ×3, all fixed** — runId literal · removed *Other SKUs* control · leaf assertions mis-scoped. Now reaches the **vendor-save boundary** at `spec:537`, **unclassified** and the first candidate product defect |
| VAL-103 *(was unmeasured)* | **harness** — non-deterministic CDP race |
| VAL-208 bulk pricing lift | not yet classified |
| costs-reconciliation-ordering | not yet classified |
| phase-2-component-freight × 3 | not yet classified — one file, one surface, plausibly one cause |
| product-library-create-component × 2 | not yet classified |
| pvs-020-refresh-performance × 2 | not yet classified |

**No pass count has been improved.** Two scenarios that were unmeasured are now
measured, and one of those was fixed because it was asserting the wrong string.

## Known non-deterministic scenarios — tracked independently

Neither blocks classification of the stable failures.

| scenario | signature | first seen |
|---|---|---|
| `lifecycle-surface-consistency` | `getByText("Order placed")` not visible within 5s after *Send order to NetSuite* → confirm (`spec:76`) | BASELINE-02 attempt, run A′ |
| `VAL-103` | `Network.getResponseBody` — no data for resource identifier | isolated re-run, 2026-08-10 |

Both are races between an assertion and an asynchronous operation the spec does
not wait for. Neither is diagnosed by adding waits until it passes.

## Failure inventory — recorded, not classified

### Stable across both clean runs — 10

| project | spec |
|---|---|
| `lifecycle-serial` | `product-library-create-component` · ASY default |
| `lifecycle-serial` | `product-library-create-component` · PVS-018 catalog states |
| `lifecycle-serial` | `pvs-020-refresh-performance` · responsive/singular/complete |
| `lifecycle-serial` | `pvs-020-refresh-performance` · rollback + retry cursor |
| `costing-serial` | `basic-quote-persistence` · **VAL-101** |
| `costing-serial` | `bulk-pricing-lift` · **VAL-208** |
| `costing-serial` | `costs-reconciliation-ordering` |
| `costing-serial` | `phase-2-component-freight` · worksheet break saves actual freight |
| `costing-serial` | `phase-2-component-freight` · 1/6/10 SKU scales |
| `costing-serial` | `phase-2-component-freight` · nested comparison surface |

**Stable ≠ real.** A stable failure can still be a stale spec. That
determination is classification and has not been made.

### Non-deterministic — 0

`lifecycle-surface-consistency` was the only one. It now passes in both
consecutive clean runs.

### Did not run — 3

Both serial projects abort remaining specs after failures, so three are never
reached. They are neither passing nor failing; they are **unmeasured**, and a
report that counts them as either would be wrong.

## What is already established, and holds

**Seed determinism — proven.** Two `reset` → `seed` cycles produced identical
counts:

```
projects 10 · quotes 10 · tiers 24 · canonical_attachments 44
invalid_identity_mappings 0 · invalid_external_ids 0
freight: 11 subcategories · 22 destinations · 64 breaks · 43 memberships · 52 customs breaks
```

**Clean environment — reproducible.** After `validation:db:reset` (docker volume
destroyed) → `migrate` → `seed`, the **absolute** database counts equal the
fixture counts: 10 projects, 10 quotes, 24 tiers, and nothing else. That
equality is the definition of clean, and it is checkable in one query.

**Reset is namespace-scoped, and that is by design but not sufficient.**
`resetFixtureWorld(runId)` deletes only rows in its own deterministic
namespace — every id is `uuid(runId, …)`. A world seeded under a different
`runId`, and any row a spec created with a random id, survives it. **Fixture
reset is therefore not a clean-environment primitive.** `validation:db:reset`
is. That distinction was what separated run 1 from run 2.

## Known related decision

**OD-011 · order-dependent browser fixture state in
`basic-quote-persistence.spec.ts`** — already open, already recorded, and
consistent with what runs 2 and 3 show. It is not being re-litigated here; it is
named because the next investigator should read it before starting.

## Next step

**Step 4 — scenario classification — is now unlocked.** Steps 1 to 3 hold.

Classification has **not** started, and nothing in this document names a cause
for any of the ten. When it starts, the order that costs least is:

1. **VAL-101 first.** It is the only failure that also hides three unmeasured
   scenarios behind it, so settling it converts four rows rather than one — and
   one of those three is REG-1's browser evidence.
2. The three `phase-2-component-freight` failures next: one file, one surface,
   plausibly one cause.
3. The remainder individually.

Every classification re-runs against BASELINE-01 and amends only the rows it
touches.

## Procedure that produces a comparable run

```powershell
npm.cmd run validation:db:reset      # destroys the volume; rebuilds; migrates
npm.cmd run validation:prove-isolation
npm.cmd run validation:seed
npm.cmd run test:e2e
```

**Not** `validation:fixtures:reset` — that clears one namespace, not the
database, and a run started from it is not comparable to one started from
`db:reset`.

## Run log

| # | date | environment | pass | fail | unmeasured | note |
|---|---|---|---|---|---|---|
| 1 | 2026-08-10 | dirty | 7 | 12 | 3 | Governed seed repaired to make this possible at all |
| 2 | 2026-08-10 | clean | 9 | 10 | 3 | Environment sensitivity resolved |
| 3 | 2026-08-10 | clean | 8 | 11 | 3 | **Disagrees with run 2** — criterion not met |
| A | 2026-08-10 | clean | **9** | **10** | 3 | After the navigation-commit fix |
| B | 2026-08-10 | clean | **9** | **10** | 3 | **Identical to A — BASELINE-01 established** |
| A′ | 2026-08-10 | clean | 9 | 11 | 3 | BASELINE-02 attempt · suite now 23 (VAL-209 added) |
| B′ | 2026-08-10 | clean | **10** | **10** | 3 | **Disagrees with A′** — `lifecycle-surface-consistency`. No BASELINE-02 |
