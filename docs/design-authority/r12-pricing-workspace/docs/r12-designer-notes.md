# Round 12 — the Pricing page as a working surface · Designer notes

**Deliverable:** Pattern 30 canonical source for the staged Pricing workspace.
**Prototype:** `Nexus Round 12.html` → `app/r12/{styles.css, pricing-page.jsx}`
**Relationship:** R12 **supersedes R11's page component** and reuses everything else
unchanged — `app/r10/*` (the contract and the trace) and `app/r11/data.js` (the quote-level
projections) are untouched.

> Load order: `styles.css` → `app/r10/styles.css` → `app/r11/styles.css` →
> `app/r12/styles.css`. R12's stylesheet is an addendum; it adds staging vocabulary and
> overrides nothing.

Everything R11 established holds: the compliance grid, the cost stack as trace level 1
transposed, entry-at-node, the reconciliation assertion, the override framing, and all
seventeen load-bearing items.

---

## 1 · What changed, and why it was nearly free

R11 was a **compliance surface**: read the state, take a corrective action, state updates,
each act committed on contact. R12 is an **exploratory** one: try a lift, watch it
propagate, undo it, try a different cell, compare, then commit deliberately.

The engine made this cheap. `computeQuoteCosting` is pure — it computes from inputs and
stores no totals — so the page simply **computes twice**: once against the committed input
set, once against the working one, and shows the difference.

That is also why the transient deltas cost nothing extra. The stack is trace level 1
transposed, so a staged input set produces a staged stack **from the same node objects**.
The two projections still cannot disagree, and neither can the staged and settled views.

| | R11 | R12 |
|---|---|---|
| Lift | committed on click | staged |
| Global adjustment | **preview with no commit path** | staged, same Apply |
| Direct price on a cell | not available | staged |
| Cost stack | settled state only | settled + transient delta while staged |
| Undo | remove one lift | discard one staged change · Reset all · remove applied · return to baseline |

## 2 · The staging model

- **Staged, not committed.** Lifts, direct prices and the global adjustment accumulate in a
  session-scoped working state. Nothing is written until Apply.
- **Session-scoped.** Leaving discards. There is no persisted-but-uncommitted third state,
  and the staging bar says so in words — *"nothing is written until you apply. Leaving the
  page discards these."*
- **One Apply governs the whole page.** Not one commit path per lever. This is the point:
  three half-flows cannot express "toggle freely, then decide", and a single deliberate act
  is also what makes the audit entry honest — one person, one decision, one payload listing
  the individual changes.
- **Reset** discards the working set and returns to last-applied.

**The global adjustment's missing Apply was the same defect one lever down.** Preview
without commit is staging with the second half absent — the concept was half-built, which is
exactly what R12 exists to finish. `Preview changes` now previews only; `Stage this
adjustment` puts it in the working set with everything else.

## 3 · Undo at both scopes

**While staged** — each pending change is a chip in the staging bar with its own ✕, plus
`Reset all`. Nothing has been written, so this is discarding working state.

**After Apply** — a `Return to computed baseline` control removes every applied lift, direct
price and adjustment in one act.

The guarantee that makes this safe is worth stating explicitly, because it is a property of
the model rather than a feature:

> **Pricing adjustments are additive layers over a computed base, and the base does not
> move. Remove every layer and you are exactly where you started — there is nothing lossy
> to reverse.** ← LOAD-BEARING

The applied bar says this in the same words, because a PM who believes they might not be
able to get back will not explore, and the page's whole purpose is exploration.

**Not versioning.** A version here means a customer-facing revision with its own pinned
inputs. Using that for pricing experimentation would create versions corresponding to
nothing the customer ever saw.

## 4 · The two undos are different undos

Same word, different guarantee, and the interface says so **at the point of removal** rather
than in a help doc:

- **Remove a lift** → the cell returns to its computed price. Ordinary reversal.
- **Remove a direct price** → the cell returns to *whatever the chain computes now*. If costs
  or markups moved since it was set, that is **not** the number it showed before.

The second carries a warn-tinted note stating precisely that. A lift *layers over* the
chain; a direct price *replaces* it — that distinction is load-bearing item 4 seen from the
undo side. ← LOAD-BEARING

## 5 · Margin colouring — the defect, and the rule behind it

A lift lands a cell **exactly** on the floor, and the float-exact comparison
(`m >= floor`) reported `0.2499999…` as still breaching. So a cell that had just been
corrected read red — identical to a genuine breach — while the `LIFTED 2.0%` badge said the
action had worked. The grid was training the eye to ignore red, which is the one thing it
cannot afford.

Fixed with an epsilon, and stated as a rule:

> **Colour encodes state — is this actionable? Badges encode history — was it corrected?**
> A corrected cell at the floor is *below target*, not *below floor*, and must not look like
> something still to do. ← LOAD-BEARING

With that, only genuinely-breaching cells are red, and the `needs N%` chip (already gated on
`outstanding`) marks exactly the cells with work left.

## 6 · Transient deltas

While anything is staged, the cost stack shows the delta against last-applied on every
component row, on `Quoted sell`, and on `Margin` (in points). A lift taken in the compliance
grid is therefore visible **where it lands**, not only where it was taken.

Deltas disappear on Apply, because the staged and settled states are then the same — the
absence of a delta is itself the signal that nothing is pending.

## 7 · Is Pricing single-owner? — the answer, and its consequence

**Its levers are. Its base is not.** That distinction matters more than the question.

Every lever on this page — global adjustment, tier adjustment, surgical lift, direct price —
is a commercial act belonging to the PM. Costs is section-major because Purchasing,
Production and Logistics own different **cost** sections; none of them touches a price.

So staging is safe as specified for the levers. But the **cost base underneath is
multi-owner**, and that is exactly the hazard you described: a PM stages three lifts,
Logistics updates a freight leg, the PM applies — against which costs?

**Recommendation: Apply must check that the cost base has not moved since staging began, and
say so if it has rather than committing silently against different numbers.** The staged
figures were computed from a snapshot; if that snapshot is stale, the PM is applying a
decision they did not actually make. That is the house rule once more, at the moment of
acting: *the state that determines the outcome should be on screen when the action is
taken.*

Cheap to implement — the working state already carries the inputs it was computed from, so
the check is a comparison, not new plumbing. **Flagged for CC as a required Apply guard, not
a nice-to-have.**

## 8 · Routine-decision panel — removed

Edward confirmed it: the routine act is checking compliance; the lift is the exception path.
The panel is off the page and the compliance-first ordering it was defending stays.

## 8a · The summary banner — preserved, and structurally coupled

Everything above and including *Your next move* is **preserved from production**: scenario
context, "Tune price & review", the state line, the next-move CTA, the SENDABLE badge, and
"What you're sending". R12 changes exactly one thing about it.

**`Show pricing detail` is gone as a control.** Not re-ordered — removed. The detail is the
page, per Edward's standing directive that it stay open.

### The seam, and the guarantee

The banner says *SENDABLE · All tiers above target*. The grid says which cells are where. If
those were computed independently they would eventually diverge — and the summary is the one
a PM trusts **without checking**, which makes it the more dangerous of the two to be wrong.

So neither surface computes its own view of compliance. Both read **`evaluateCells()`**, and
the banner's verdict is `verdictFrom(ev)` over that same result. This is the same means as
`sectionsOf()` reaching into `sellBefore.operands` rather than recomputing: **the guarantee
is structural, not a convention two surfaces are asked to honour.** ← LOAD-BEARING

Verified: lifting every breaching cell flips the banner from *NOT SENDABLE · 11 cells below
floor — 3 at T1, 2 at T2, 3 at T3, 3 at T4* to *SENDABLE · All tiers above floor · 11 below
target*, with no separate wiring.

### What it says when it is not sendable — and where it points

Your open question, answered rather than left to adjacency. Three verdict states, and the
**next-move CTA changes with them**:

| State | Badge | Verdict | Next move |
|---|---|---|---|
| Cells below floor | NOT SENDABLE | *N cells below floor — 3 at T1, 2 at T2…* | **Clear N cells below floor ↓** → scrolls to the grid |
| Above floor, some below target | SENDABLE | *All tiers above floor · N below target* | Preview quote PDF → |
| All above target | SENDABLE | *All tiers above target* | Preview quote PDF → |

The blocked verdict **names the tiers**, so the PM knows where before they scroll, and the
CTA is the route rather than a restatement. That is the house rule one level up: the verdict
is on screen, and the means of acting on it is the button beside it — not left to the fact
that a grid happens to sit below.

**Below target does not block.** It is reported but sendable, because target is a goal and
floor is a mandate — the same distinction that governs which cells the surgical lift offers
itself for (§7 of the R11 notes).

## 9 · Load-bearing — additions

R11's items 1–17 stand. Added:

18. **One Apply governs the whole page.** Per-lever commit paths cannot express "toggle
    freely, then decide", and they fragment the audit entry for what is one decision.
19. **Additive layers over an unmoving base.** Every pricing lever must remain removable
    without loss, and the page must say so — a PM who fears they cannot get back will not
    explore.
20. **Colour encodes state; badges encode history.** A corrected cell must never look like
    an outstanding breach.
21. **Removing a lift and removing a direct price are different undos**, and the difference
    is stated where the removal happens.
22. **Apply must verify the cost base has not moved** since staging began (§7).
23. **The banner and the grid read one compliance evaluation** (§8a). A summary that can
    disagree with the detail beneath it is worse than no summary, because it is the one
    trusted without checking.
24. **The verdict carries its own route.** When the page is not sendable it names where the
    breaches are and the CTA goes there. A verdict without a route is half a fix.
25. **Staged-ness is a difference, not a property.** `isStaged` must be derived from
    working-minus-committed; derived from the working set alone it stays true forever after
    Apply, and the page contradicts itself on the axis this round is about.

## 10 · Named structure (Pattern 30 — implement verbatim)

**New in `app/r12/pricing-page.jsx`:** `computeAgainst(flags, adj, lifts, overrides)` ·
`marginState(m)` · `DirectPrice` · the staging bar and applied bar inside
`PricingWorkspace` (`describe` · `unstage` · `apply` · `reset` · `toBaseline`).
**Changed:** `CostStack({settled})` · `ComplianceGrid({overrides, onOverride})` ·
`CellAction({onOverride})` · `AdjustmentPanel({adj, onAdj, committedAdj, removeAllLifts})`.
**Unchanged and reused:** all of `app/r10/*`, `app/r11/data.js`, `TraceAt`, `StackTrace`,
`SkuTrace`, `Reference`.

**Canonical classes** (`app/r12/styles.css`): `r12-staging`(`.applied`) `r12-chip`
`r12-delta`(`.up .down`) `r12-direct` `.r11-cellaction .body p.undo-note`.


---

## 13 · Client target — the third threshold, in the grid

Edward: *"The PM needs to know what it's comparing to."* Three thresholds, three questions,
and the tension between them **is** the commercial decision:

| | Question | Source |
|---|---|---|
| Floor | Are we allowed to sell this? | firm policy |
| Target | Are we making what we want? | firm goal |
| **Client target** | **Will they accept it?** | **the customer's RFP** |

R11 had it as a Reference block at the foot — the comparison sitting furthest from the
decision it informs. Same misplacement as the per-SKU breakdown in R11 §12: the right data
in the wrong role. **The Reference block is folded**, not duplicated, and the page loses
another surface.

### The shape — decided by a dimensional fact, not by tidiness

The complication you handed me (per SKU, and only 3 of 65 deals carry one) resolves once the
dimensions are separated:

> **The benchmark is per SKU — it does not vary by tier. The comparison is per cell — each
> tier prices differently.**

So the benchmark is **stated once on the SKU row**, and the **headroom shows on the cells**.
A column would assert that the benchmark varies across tiers, which it does not; it would
also leave an empty region on ~95% of quotes.

**Absence then costs nothing, because there is nothing to leave blank.** A SKU without a
target has no benchmark chip and its cells carry no marker — the region does not exist for
that row rather than existing and being empty. Verified on the fixture: two SKUs carry a
target, one does not, eight markers render, zero empty ones.

### It stays out of the colour ramp — and out of the verdict

Direction is meaningful (above the benchmark is harder to win), so the marker is directional
— `▼ $0.18 vs client` / `▲ $0.22 vs client` — but in its own muted channel, never the
margin colours.

**A price above the client's benchmark is a commercial risk, not a policy breach.** So:

- it does **not** enter `marginState` — colour still means the operative margin threshold;
- it does **not** enter `evaluateCells`' verdict — SENDABLE stays silent about it.

This is the third instance of one rule, and the pattern is now explicit enough to state
plainly: **approval does not enter the colour ramp; the approver's target supersedes the
floor within one channel rather than adding a fourth; client target gets a channel of its
own.** ← LOAD-BEARING

> **Three thresholds, three meanings. Conflating any two makes the page say something
> untrue** — and the specific untruth here would be the worst of them: telling a PM they
> may not send a quote because a customer might negotiate.

### Load-bearing — addition

26. **Client target is stated per row, compared per cell, and confined to its own channel.**
    It never colours a cell and never reaches the verdict.
