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

## Release signal — classified failures REMAINING

Reported as remaining unknowns, not as a cumulative count of everything ever
found. The cumulative number only grows and rewards discovery; what matters for
release is how fast unknowns become classified and then closed.

| | count | |
|---|---|---|
| **Closed** | **1** | VAL-104 — passes end to end |
| **Classified, not closed** | **2** | VAL-101 harness contamination · VAL-103 harness race |
| **Boundary established, cause open** | **0** | — |
| **Unclassified** | **2** | VAL-209 · VAL-101 |

**Eleven scenarios were failing or unmeasured when classification began. Five
remain unclassified.** No pass count was pursued, and one scenario moved to
passing only because six migration artifacts were removed from it.

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

**Vendor-selection boundary — Playwright probe, first failing boundary
established 2026-08-10.**

`vendor-selection-probe.spec.ts` walks the four candidate boundaries in order
using the same driver VAL-104 uses. No force-clicks, no native setters, no
synthetic events, no selector workarounds, no timeout inflation.

| boundary | result |
|---|---|
| 0 · `Clear Pricing Vendor` control, searchbox present | ✅ |
| **1 · the input retains what was typed** | ✅ |
| **2 · a matching vendor option exists** | ❌ **`toHaveCount(1)` → received 0** |
| 3 · visible · enabled · geometry | not reached |
| 4 · click emits a save request | not reached |
| 5 · save responds ok | not reached |
| 6 · selection reflected in UI | not reached |

**Boundary 1 passing settles the earlier mess.** The controlled input accepts
`.fill()` and holds the value. The raw-JS probe was the broken instrument, not
the product, and nothing it reported stands.

**First failing boundary: the option does not exist.** One step earlier than
*"not actionable"* — there is nothing to be actionable. Run twice, once with
the full vendor name and once with `Contract`, **VAL-104's own search term**, so
the result is not an artifact of asking a different question than the scenario
asks. Zero options both times.

**Classification: the boundary is established; the cause is not.** Two
candidates remain, and they are cheap to separate:

- the vendor is **not in the eligible set** for this quote — a fixture or
  eligibility-rule question;
- the option renders with a **different accessible name** than the literal — a
  test-expectation question, and the fourth of that kind on this scenario.

Both are one query away and neither is a save-path defect, so the vendor-save
wiring remains **unexamined** — the boundary that was reported as "the first
that may implicate the product" has not been reached.

**The probe is an instrument, not coverage.** It is marked for removal once the
cause is settled, and it does change the suite count while present.

**Eligibility boundary resolved 2026-08-10 — fixture/test expectation defect.**

**The eligible set.** `searchPricingVendors` delegates to
`hubspot.searchVendors`, and under `NEXUS_HUBSPOT_PROVIDER=isolated` that is
`tests/harness/providers/fake-hubspot.ts`, which filters a seeded `vendors`
array by case-insensitive substring. **The eligible set is the fixture's vendor
list**, not a database query.

**Is `Validation Contract Manufacturer` in it? No.** The seeded vendors include
`Validation Packaging Vendor` — the one VAL-104 correctly asserts as the
pre-existing selection — and the string `Validation Contract Manufacturer`
appears **nowhere in `src/`, `tests/harness/` or `scripts/`.** It exists only in
two spec files: VAL-104 itself, and the probe written to chase it.

**Governing reason for exclusion:** none. It is not excluded by an eligibility
rule — it was never created. A substring search for `Contract` over a vendor
list containing no vendor with `Contract` in its name correctly returns zero.

**Classification: fixture/test expectation defect.** The projection is behaving
correctly; the scenario selects a vendor the fixture world does not provide, and
then asserts `pricing_vendor_name_snapshot: "Validation Contract Manufacturer"`
in the database afterwards. The fixture **is** meant to satisfy the eligibility
contract here — it supplies the first vendor and not the second.

**Not a product defect in the eligibility-to-combobox projection**, which was
the alternative branch. And **save wiring remains unexamined**: the vendor has
still not been proven renderable, so nothing downstream of it can be
investigated yet.

**Fifth stale assumption in this one path**, after the runId literal, the removed
disclosure control, the mis-scoped leaf assertions, and the full-name search
term.

**Remediation shape — a fixture-world change, so not made unilaterally.** Either
add `Validation Contract Manufacturer` to the fake provider's vendor set, which
preserves the scenario's intent (switch from one governed vendor to another), or
retarget the scenario at a vendor that exists. The first is truer to what
VAL-104 is testing; both alter the fixture world and therefore the baseline, and
that is a decision to take deliberately rather than fold into a repair.

**VAL-104 PASSES END TO END — 22.1s from a clean seed, 2026-08-10.**

**Correction to the previous entry.** I wrote that no seeded vendor contained
`Contract`. That was wrong — `Acme Contract Manufacturing` (`…002`) does, and
the substring search returned it. The scenario found no option because it looks
for a vendor by a name nothing carried, not because the search matched nothing.

**What the id/name pair revealed.** VAL-104's persisted-snapshot assertion is
`{ id: "900000000000002", name: "Validation Contract Manufacturer" }` — **both
halves of one row.** So `…002` *was* this vendor, and was renamed to `Acme
Contract Manufacturing` without the scenario being updated. The spec kept both
halves of the old pair, and they stopped belonging to the same row.

**Adding a third vendor under that name looked right and was not.** The save
then persisted `…003` while the scenario asserted `…002`, and the run failed one
boundary later on the snapshot comparison — which is how the rename surfaced.
**Restoring the name to `…002`** makes both halves true at once, and keeps the
intent: switching between two *governed* vendors, not retargeting the scenario
at whatever happens to exist.

**Fixture revision recorded.**

| | |
|---|---|
| file | `tests/harness/providers/fake-hubspot.ts` |
| blob | **`b2b20d0` → `3426ebd`** (213 lines) |
| change | vendor `900000000000002` renamed `Acme Contract Manufacturing` → `Validation Contract Manufacturer` |
| probe | `vendor-selection-probe.spec.ts` **removed** — an instrument, not coverage |

**The suite is a different measurement system now.** The fixture world changed,
so **post-change totals are not comparable to BASELINE-01** and must not be
reported as though they were. BASELINE-01 is unedited and remains the historical
reference. A successor is established only when the revised suite is again
eligible for one — which it is not, while two scenarios are known to be
non-deterministic.

**What VAL-104 now proves, in full:** one Pricing Vendor already selected ·
another eligible vendor found by search · the operator switches to it · the new
vendor persists into the governed Pricing Vendor snapshot · the dormant Pricing
Date stays absent.

**Six stale assumptions, all in this one scenario:** the runId literal, the
removed disclosure control, the mis-scoped leaf assertions, my own full-name
search term, the missing vendor, and the renamed vendor identity. Every one a
migration artifact; none a product defect. That is what an unmeasured row
conceals, and it is the strongest argument in this document for why unmeasured
is worse than failing.

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

### `costs-reconciliation-ordering` — **PRODUCT DEFECT · stop condition reached**

Reproduces in isolation from a clean seed, deterministically, same cell, same
value. Not a race, not contamination, not slowness.

**First failing boundary** — `spec:74`, cell 3 after reconciliation settled:
`Expected "4.44" · Received "20"`.

**The selector sweeps two kinds of field, and that is what exposed this.** The
scenario's comment says "Packaging cost cells", but
`.r6-dt.pkg input[inputmode], .r6-dt.pkg input[type='number']` matches, per
line: one **markup percent** input (`parentCls markup`, `step 0.01`) then two
**unit cost** cells (`parentCls cell-num`, `step 0.0001`) — 18 inputs over six
lines on `sixSku`. Indices 0 and 3 are markup on two DIFFERENT lines.

Narrowing the selector to cost cells only would make this pass and would hide
the defect. It is not done.

**The edit is discarded, not delayed.** Probed at a 25s settle window plus the
5s assertion timeout — 30s total — and cell 3 still reads `20`. The database
agrees: after the run, line 1 carries `markup_pct 0.0111` (cell 0, saved) and
**no line carries `0.0444`**. Cell 3's edit never reached the server at all.

**Mechanism.** `packaging-drilldown.tsx` commits line-meta — markup, category,
vendor — through `scheduleMetaSave`, which is **change-debounced only**:

```
if (metaDebounce.current) clearTimeout(metaDebounce.current);
metaDebounce.current = setTimeout(() => fireMetaSave(overrides), DEBOUNCE_MS);
```

There is **no `onBlur` commit anywhere in the file**. The edit therefore lives
only inside a pending `setTimeout` until the debounce elapses. A reconcile
triggered by an EARLIER row's save re-renders the row and resets `markupPct`
from `storeMarkupPct` before that timer fires — so a sibling row's successful
save silently destroys this row's uncommitted edit.

Cell 0 survives because nothing interrupted its debounce. Cell 3 is the last of
four rapid edits and is interrupted by the reconciles the first three caused.

**Operator-visible symptom:** type a markup, tab away, watch it revert to the
old value with no error and nothing saved. That is the exact reported behaviour
this scenario was written to catch — the scenario is doing its job.

**Classification: product defect.** Not harness, not fixture, not expectation
drift. Pattern 47 already names the correct shape for fields where per-keystroke
save is wrong — the blur/Enter commit sub-pattern, implemented for freight as
`LegDateInput`. Packaging line-meta never adopted it.

**Not repaired — this is a stop condition.** The fix is a real implementation
decision with more than one defensible answer: flush the pending debounce on
blur; flush on unmount; adopt the Pattern 47 blur/Enter commit for line-meta
outright; or make reconcile defer to rows holding uncommitted meta edits the way
`markupDirty` already tracks. These differ in blast radius across markup,
category and vendor, all three of which share `scheduleMetaSave`.

### PVS-018 — **product defect (small) + three test defects; now passes**

The governed post-create contract, as dispositioned: **a successful creation must
be immediately confirmable and deterministically discoverable. It does not imply
first-page placement** in an alphabetically paginated catalog — this library is
1049 components, so a new name lands wherever it sorts.

**Product defect — the confirmation could not say what it confirmed.**

`AddProductModal` called `onClose()` before composing the toast, and `onClose`
resets the form. The toast read the already-cleared field, so the operator was
told `Added "" to the library`. A confirmation that cannot name its subject is
not one. Repaired by capturing the name before the reset (`586dcd0`), and
`onSuccess` now carries it to the caller.

The toast surface itself was never broken. Trace timings settle it:

| t | action | outcome |
|---|---|---|
| 6.0s | click **Add leaf** | ok |
| 6.0s | `expect(toast).toBeVisible()` | **passed in 0.1s** |
| 6.1s | reopen library (test step) | **hung 24.4s → timeout** |

So the notification already survives modal close. The earlier reading — that the
toast was owned by the modal and died with it — was wrong: `AddProductModal`
renders the toast outside its `open` conditional, and the library that hosts it
does not close on create.

**Three test defects**, each of which had been reporting as something else:

1. **A reopen step that could not succeed.** The scenario clicked "+ Add
   component" to go back to the library — but the library had never closed, and
   `onSuccess → refreshLibrary(name)` had already refocused it on the exact
   name. The click was aimed at a page button sitting behind the library's own
   backdrop. It could only ever time out. The assertion now reads the state the
   operator is actually left in.
2. **Cleanup keyed on a variable assigned too late.** `createdLeafId` is set
   *after* the discoverability assertions, so any run failing before them left
   its component behind. The name is deterministic, so the next run found
   several identically-named components and failed on ambiguity — a
   discoverability defect that was really the previous run's debris. Three had
   accumulated before the pattern was legible. Cleanup now keys on fixture
   identity (SKU/name not present at entry).
3. **Cleanup removed one of two junctions.** Attaching writes `assembly_leaves`
   *and* `quote_leaves`; only the first was deleted, so Postgres refused the
   delete and raised an FK violation from the teardown.

**Deliberately not done**, per the disposition: no pinning of new records into
page 1, no navigation added solely to satisfy the scenario, and no weakening to
database existence. The scenario asserts two independent facts — the toast names
the component, and exact-name search returns exactly one row.

`toHaveCount(1)`, not `toBeVisible()`: leftovers from a dead run would otherwise
satisfy a visibility check and quietly pass on someone else's component.

**Verified:** two consecutive full runs, 2 passed each, and zero residual leaves
or product types after the second.

### VAL-208 — **harness issue: two concurrent projects share one mutable quote**

Classified from zero evidence, in the recorded sequence.

**Reproduction is configuration-dependent, and that is the finding.**

| configuration | result |
|---|---|
| VAL-208 alone, clean seed | **passes** (7.2s) |
| `costing` project, clean seed | **passes** |
| full suite, clean seed | **fails** |

So the scenario is sound and the product is sound. Something outside the
`costing` project is the differentiator.

**First failing boundary** — `getByRole("status")`, *element(s) not found*,
waiting for `"Pricing updated."` after Apply. The page snapshot at that moment
names the cause outright:

> `alert: This quote is in 'sent' status. Editing is disabled. To make changes,
> create a new draft version from the project page.`

**Mechanism, verified rather than inferred:**

- VAL-208 targets `manifest.quotes.draft` and assumes it is editable.
- `tests/e2e/slice-12/primary-send-lifecycle.spec.ts:31` targets the **same**
  `manifest.quotes.draft`, sends it (`:93`), and asserts `status === "sent"`
  (`:128`).
- `playwright.config.ts`: `lifecycle-serial` (`workers: 1`) and `costing-serial`
  (`workers: 1`) are **separate projects**, and top-level `workers` is
  `undefined` off CI. Each project is internally serial; **the two projects run
  concurrently against one shared database.**

So the two race for one mutable fixture row. When the send lands first, VAL-208's
Apply meets a sent quote and is correctly refused. `workers: 1` reads as
protection and is not — it serialises *within* a project, never *between* them.

**Classification: harness issue** — cross-project fixture isolation.

Explicitly **not** the alternatives, each ruled out on evidence:

- **Not a product defect.** The refusal is Pattern 52 draft-lock behaving as
  designed, with correct copy. The product's only role here is to be right.
- **Not a fixture/test expectation defect.** VAL-208's expectation matches the
  fixture contract *as seeded*; nothing in the contract says the draft quote
  survives a concurrent sender.
- **Not specification drift.** No governed behaviour changed.

**Not repaired — the repair is a fixture-world decision, not a mechanical one.**
Two candidates, with different costs:

| candidate | effect | cost |
|---|---|---|
| **A · give the send lifecycle its own quote** | `quotes.draft` stops being shared with a destructive actor | changes the seeded fixture world; suite totals not comparable to BASELINE-01 |
| **B · serialise the two projects** | removes the race wholesale | slower full-suite wall clock; masks rather than removes the sharing |

A treats the cause, B treats the symptom. Both change the instrument, so the
choice is yours rather than mine — the same disposition shape as the governed
vendor fixture.

**Scope discipline:** this race is a plausible contributor to other intermittent
scenarios, and that is deliberately **not** asserted here. Each remaining
scenario is still classified from zero evidence.

### `phase-2-component-freight` — closed as a workstream

**The crash is fixed on `main`.** Extracted from this branch to a narrow hotfix
and merged independently as **`954163d`** (PR #261): the `shipReads` thread into
`ShipmentLedger`, plus `costs-renders-with-freight-shipment.spec.ts` — which
asserts the blast radius (no error surface · Packaging trigger with real
geometry) rather than the arithmetic, and asserts the ≥1-destination
precondition so a fixture that lost its destinations cannot pass while proving
nothing. Confirmed to fail without the one-line fix.

PR #260 rebased onto the merged `main`. Exactly one `shipReads={shipReads}` at
the call site; `verify:types` clean. The branch's own `221fd26` now carries only
its record — the code hunk was correctly absorbed by `main`, so its subject line
describes a finding whose repair now lives in #261.

**Final scenario ledger — no product defect remains:**

| scenario | verdict |
|---|---|
| worksheet break saves actual freight | **passes** |
| Costs renders a shipment with ≥1 destination | **passes** — new regression, guards the crash |
| 1/6/10 SKU scales | **stale expectation** — Add-line intentionally removed `a32d41a`, Business Authority 2026-08-06 |
| nested comparison surface | **evidence drift** — 18 commits since the `051a7d5` baseline. Requires explicit Design Authority disposition. **Baseline not refreshed** |

The visual baseline was **not** updated as a side effect of the hotfix.

### `phase-2-component-freight` ×3 — one cause, not three

**RESOLVED to a product defect. The cause is a client render crash, not layout.**

The ancestor map was run on `oneSku` and terminated the layout line of inquiry
outright. Level 6 is `div#S:0`, `hidden=""`, `display:none` — React's streaming-SSR
holding pen. Everything measured in the previous two sessions was **orphaned SSR
content that was never inserted into the live tree.**

```
i  element                     display   rect
0  button.r6-section-row       grid      0 × 0     aria-expanded="true"
1  article.r6-section open     block     0 × 0     overflow:hidden
2  div.r6-sections.flex-col    flex      0 × 0
3  main.r6-page                block     0 × 0     max-width 1480px
4  div.pl-64                   block     0 × 0
5  div.min-h-screen            block     0 × 0     min-height 1445.6px
6  div#S:0  hidden             none      0 × 0     ← THE BOUNDARY
7  body                        block     1556 × 1445.6
```

No wrapper collapse, no suppressed content column, no accordion state — levels
0–5 report normal `display`, `visibility:visible`, `opacity:1`, no `contain`, no
`content-visibility`, and no dimensional clamp. They are zero because their
container is `display:none`, and that container is React's, not ours.

**None of the three offered classifications fit; the true one is a fourth.**
The live tree is not a collapsed Costs page — it is the **error boundary**:

```
Cannot read properties of undefined (reading 'get')
  at freight-drilldown.tsx … Array.map … at DestinationRow
```

The client render threw, the error surface replaced the tree, and the completed
SSR chunk was consequently never revealed — which is exactly why the trigger was
present, hydrated, `aria-expanded="true"`, and unlaid-out all the way to `body`.

**The defect is one dropped prop.** `shipReads` is resolved at
`freight-drilldown.tsx:109` and consumed by `DestinationRow` (`:331`) and
`CustomsLedger` (`:437`). `ShipmentLedger` declares it (`:269`) and forwards it
(`:290`, `:293`) — but the `<ShipmentLedger>` call site at `:241` never passes it,
so it arrives `undefined` and `shipReads.get(…)` throws.

`git blame`: the threading landed **2026-08-09 in `85d8d1f`** (Gate 1B — worksheet
freight reads the graph, PR #221), which added `:109`, `:269` and `:290` but left
the `:241` call site untouched since 2026-08-05.

| | |
|---|---|
| **Classification** | **Product defect** — render crash, freight |
| **Ownership** | Ours |
| **Introduced** | `85d8d1f`, 2026-08-09, PR #221 |
| **On `origin/main`** | **Yes** |
| **Trigger condition** | any Costs page rendering a shipment with ≥1 destination |
| **Blast radius** | the **entire Costs page**, not just Freight |

**Repair applied on this branch** — `shipReads={shipReads}` added at `:241`.
Verified in-browser on `oneSku`: no error surface, no orphaned `S:0`, trigger
`1145.6 × 78.5` at top 755 with `offsetParent = body`.

**Single cause confirmed, and the workstream now separates.** 3 failed → 1 passed,
2 failed — both at **new** boundaries downstream of the crash, neither yet
classified, neither repaired:

| scenario | new boundary |
|---|---|
| worksheet break saves actual freight | **passes** (15.2s) |
| 1/6/10 SKU scales | `spec:63` — inside the Packaging `article`, `getByRole("button", {name: /^Add line/})` resolves to **0**, expected 1 (`oneSku`). 14 × re-resolved |
| nested comparison surface | snapshot 840×**1722** expected vs 840×**1814** received, 5% of pixels differ. Baseline committed `051a7d5` **2026-08-05** — it **predates `85d8d1f`**, so it is not evidence of the crashed state, and the 92px growth may be intended by the Gate 1B TOTAL change. **Do not refresh the baseline before that is settled** |

#### Residual 1 — `1/6/10 SKU scales` · `spec:63` · **stale test expectation**

The Add-line control does not resolve differently. **It does not exist.** The
only occurrence of the string in `src/` is its own removal notice:

> `src/app/actions/assembly-leaf-inputs.ts:142` — *REMOVED: addAssemblyLeafInput
> (manual "Add line" in Packaging). Setup owns packaging structure; Costs
> consumes and prices it. Multiple cartons, labels or inserts are separate Setup
> components, not PM-authored cost rows. Packaging rows now materialize from
> Setup structure through `src/lib/packaging-materialization.ts` on both axes —
> leaf attach and tier creation — so there is no state this action was needed to
> reach.* **Business Authority confirmation, 2026-08-06.**

Removed in `a32d41a`, 2026-08-06 — **three days before the crash landed**. The
scenario was therefore already failing here between 08-06 and 08-09; `85d8d1f`
then masked it by failing earlier. Same class as VAL-104's *Other SKUs*
disclosure: a governed removal the scenario never absorbed.

The spec counted one Add-line button per SKU as a **proxy** for "the Packaging
drawer rendered one row per SKU." The proxy is gone; the capability intent is
still valid and still worth asserting. **Not repaired** — the replacement anchor
should be chosen deliberately, not reverse-engineered from whatever currently
counts to N.

#### Residual 2 — `nested comparison surface` · **stale baseline, and the 92px is explained**

The baseline is `051a7d5`, 2026-08-05. **Eighteen commits have touched
`freight-drilldown.tsx` since it was captured**, among them:

| commit | change |
|---|---|
| `ffcbed7` | coverage-aware shipment defaults **and a coverage strip** |
| `8b1f27d` | governed selector for Freight Type |
| `6379450` | action-scoped pending + **explained disabled states** (Pattern 47f) |
| `4196ded` | shipment reversal with refusal-based safety (F-5) |
| `eb3bfa3` | Add Destination protected by request idempotency |
| `85d8d1f`, `f1dc5af` | Gate 1B — freight reads the graph; graph declares its evaluation |

The diff image agrees with that reading: it is a **cumulative downward shift**,
not scattered content substitution. Rows match in kind and drift progressively
further out of register down the page — the signature of height added near the
top and inherited by everything below, rather than of a redesign.

So the 92px is not one change and not a consequence of the crash. It is five
days of separately-governed surface evolution that the baseline predates.

**The baseline is deliberately NOT refreshed.** A refresh is defensible only as
an explicit decision that each contributing change is intended — which is a
Design Authority call, not a byproduct of the crash being fixed. Until then the
snapshot stands as evidence.





Run in isolation from a clean seed, all three fail on the **same root**: the
section-drawer trigger.

| scenario | signature |
|---|---|
| worksheet break saves actual freight | `spec:13` — `trigger.getAttribute("aria-expanded")` times out; the locator never resolves |
| renders at 1, 6 and 10 SKU scales | `button[aria-controls="section-packaging-drawer"]` — **expected visible, received hidden** |
| worksheet matches nested comparison | `spec:13` — same timeout as the first |

The middle one is the informative one: **the element exists and is hidden**, so
this is not a renamed control. All three open a section drawer before doing
anything else, and none of them gets past it.

**Three rows, one cause.** That is worth stating on its own — the failure count
overstates the problem, and a fix here converts three rows at once.

**Not yet classified.** Two candidates, and the evidence does not separate them:

- the Costs surface restructured its drawers and these specs open them the old
  way — a stale-expectation question, which would make it the seventh of that
  kind in this suite;
- the drawers are genuinely hidden in the state these fixtures produce — a
  fixture or product question.

The draft quote's Costs surface **does** render `Packaging` / `Production` /
`Freight` disclosures carrying `aria-expanded`, observed directly earlier in
this session. These specs use the operator fixtures (1 / 6 / 10 SKU), so the
next step is narrow: confirm whether the trigger is present-and-hidden on those
quotes specifically, and if so what state hides it.

#### The visibility condition — located, and it is not where it looked

**There is no visibility condition on the trigger.** Source inspection, before
touching any spec:

- `section-with-drilldown.tsx:140-154` renders the toggle **unconditionally**
  inside `<article className="r6-section">`. No guard, no conditional, no
  `hidden` attribute. `aria-controls={`section-${id}-drawer`}` is always
  emitted.
- `costs/page.tsx:588` renders the Packaging `<SectionWithDrilldown>`
  **unconditionally** inside `<CostBuildAccordion>`. It is not gated on
  `pkgRows.length` — the row count only feeds the sublabel and status chip.

So on any Costs page that renders, the trigger exists. **Which moves the
question up a level:** the failure is not the drawer refusing to show, it is
that the surface the drawer lives on did not render for these fixtures.

That reading fits all three signatures better than a hidden control does. Two
scenarios time out because the locator never resolves — consistent with an
absent page, not a hidden button — and Playwright reports a zero-match
`toBeVisible()` as *hidden*, which is what made the middle one look like a
visibility problem.

**Next check, and it is one request:** fetch the Costs deep link for an operator
fixture (1 / 6 / 10 SKU) and establish whether the page renders at all. If it
does not, the classification question becomes why — and the three candidate
classes stay exactly as posed, just one level up:

- the page renders and the trigger is genuinely hidden → product defect;
- the page does not render for these fixtures → fixture or product, depending on
  whether the fixture is expected to produce a renderable quote;
- the page renders under a different route or shape than these specs open →
  stale test expectation, and the seventh of that kind.

**No spec was modified, no selector changed, no visibility forced.** The three
scenarios remain one workstream.

#### Page-level boundary — established 2026-08-10

One request, the `oneSku` operator fixture, the exact deep link the failing spec
opens:

| | |
|---|---|
| status | **200** |
| final URL | **unchanged** — no redirect, no different route |
| `aria-controls="section-packaging-drawer"` | **present in the served HTML** |

**The Costs surface renders and the trigger exists.** Both of the alternative
classifications are eliminated: this is not a fixture that cannot reach the
surface, and not a stale expectation pointing at a route that moved.

**Classification: the failure is at the spec's timing/driver boundary.** The
element is in the server-rendered markup, so whatever the specs are waiting for
is a property of how they reach it — not of whether it is there.

**Still one workstream.** Nothing separates the three, and the shared root now
has a shared shape: all three open a section drawer as their first act, and all
three fail against a page that demonstrably serves the control they are looking
for.

**What this does not yet say.** Why the driver cannot resolve an element the
server sends is not established, and the two candidate readings — the client
tree differing from the served HTML at the moment the spec looks, versus the
spec looking before hydration attaches the control — remediate differently. That
is the next question, and it is now a narrow one asked against a known-good
page.

#### Where the trigger disappears — it does not. It never gets a layout box.

Client DOM, `oneSku`, after load:

| | |
|---|---|
| present in client DOM | **yes** — it survives hydration and reconciliation |
| `aria-expanded` | **`"true"`** — already expanded |
| bounding rect | **0 × 0** |
| `offsetParent` | **`null`** |
| own `display` / `visibility` / `opacity` | `grid` / `visible` / `1` |
| `.r6-section` count | 2 |

**None of the five candidate moments applies.** The trigger is not removed after
hydration, after reconciliation, after data load, or after navigation. It is
present the whole time.

**The signature is specific.** An element reporting its own `display: grid` and
`visibility: visible` while having a zero rect and a null `offsetParent` is
**not laid out** — the shape produced when an **ancestor** is `display: none`.
Computed style is read from the element itself, so its own properties keep
reporting normal values while it occupies no space.

**That is the boundary.** Not routing, not rendering, not hydration timing: the
control is in the tree and outside layout, so a driver waiting for something
actionable waits forever, and `toBeVisible()` reports *hidden* — the word that
sent this investigation toward a visibility bug two steps ago.

**Ownership not yet classified**, and the next question is exactly one level up
from here: **which ancestor is collapsed, and why, on this fixture.** Candidates
remain open and are not ranked — an accordion whose collapsed state hides the
whole section rather than only its drawer; a container that lays out only after
a measurement these fixtures never trigger; a CSS rule that applies to this
fixture's section count. `aria-expanded="true"` on a control inside a collapsed
subtree is itself worth explaining, since the state says open while the layout
says absent.

**Still one workstream.** Nothing observed separates the three.

#### Ancestor walk — the collapse is not local to the accordion

Walking up from the trigger, `oneSku`:

| # | element | display | rect |
|---|---|---|---|
| 0 | `button.r6-section-row` — `aria-expanded="true"` | `grid` | **0 × 0** |
| 1 | `article.r6-section open` — **carries `open`** | `block` | **0 × 0** |
| 2 | `div.r6-sections flex flex-col` | `flex` | **0 × 0** |
| … | … | | **0 × 0** |
| **7** | first ancestor **with** a layout box | | non-zero |

**Chain length 8; the first laid-out ancestor is index 7** — the last element
before `<html>`. So **nothing between the trigger and the document body has a
layout box.** Seven levels, all zero.

**That eliminates the collapsed-accordion reading.** The section `<article>`
carries the `open` class and the trigger reports `aria-expanded="true"`, so the
accordion state is open, not collapsed — and the suppression continues far above
anything the accordion controls. No `display: none`, no `hidden`, no
`max-height: 0` was found on the levels captured; each reports an ordinary
`display` while occupying no space.

**Ownership still not classified, and none of the three candidate readings fits
yet.** The parent is logically open, which points at *"layout remains
suppressed"* — but the suppression is page-wide rather than section-local, so
calling it a drawer defect would be wrong at the same moment it looked right.

**The next step is narrow and is the last one in this chain:** name levels 3–6
and the index-7 element, and identify which one is the outermost with zero
height. A container whose whole content column has no height on this fixture is
a different defect from a drawer that will not open, and the two are told apart
by which element first has a box.

**Instrument note:** the walk reports non-zero geometry at index 7, so the probe
measures layout correctly; zero rects below it are the observation, not a probe
failure.

### Where that leaves the ten

| scenario | classification |
|---|---|
| VAL-101 | **harness** — cross-project fixture contamination |
| VAL-104 *(was unmeasured)* | **PASSES.** Six migration artifacts found and fixed; no product defect at any boundary |
| VAL-103 *(was unmeasured)* | **harness** — non-deterministic CDP race |
| VAL-208 bulk pricing lift | **harness issue** — `quotes.draft` shared with `primary-send-lifecycle` across two concurrently-running projects |
| costs-reconciliation-ordering | not yet classified |
| phase-2-component-freight × 3 | **RESOLVED — product defect.** Dropped `shipReads` prop at `freight-drilldown.tsx:241` (`85d8d1f`, PR #221, **on `main`**) crashed the whole Costs page; the trigger was orphaned SSR content inside React's `div#S:0`. Repaired. 1 of 3 now passes; 2 sit at new unclassified boundaries |
| product-library-create-component × 2 | **PASSES.** One small product defect (confirmation carried no name) plus three test defects; no defect in creation itself |
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
