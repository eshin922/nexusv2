# Phase 3 — Pricing Workspace

**Status:** implementation specification · awaiting approval
**Author:** CA
**Date:** 2026-08
**Phase:** 3 of 4 · independently deployable · independently reversible

---

## Success Criteria

**Business** — a PM can find a below-floor cell, correct it precisely, explore
alternatives without committing, and explain any number on the page down to the
person who set it.

**Implementation** — one compliance evaluation feeding both banner and grid. One
Apply governing the page. Every adjustment an additive layer over an unmoving
base. Every sum reconciling, unrounded.

**Operator** — the page feels safe to experiment with, *"which cells look
wrong"* is answerable at a glance, and **the routine decision needs no
expansion at all.**

---

## Objective

**Turn Pricing into the commercial decision workspace: every number able to say
why it is what it is, and every lever safe to try.**

Three things ship together because they are one experience:

- **Progressive traceability** — any number expands into the operation that
  produced it, terminating in a human act
- **The compliance grid** — margin by cell, every threshold visible, breaches
  actionable where they are named
- **The staging model** — lifts, direct prices and adjustments accumulate,
  preview freely, commit deliberately, undo at both scopes

**Plus one new mechanism:** the surgical lift — one SKU, one tier, the minimum
percentage to clear a threshold, independently persisted and independently
removable.

---

## Business Authority

| Contract | Governs |
|---|---|
| **Adjustment model** (Edward, 2026-08) | Four levers · surgical lift semantics · override precedence |
| **Staging model** (Edward, 2026-08) | Staged, session-scoped, one Apply, undo at both scopes |
| **Page boundary** (Edward, 2026-08) | Banner preserved · detail always open · disclosure removed |
| **Client target** (Edward, 2026-08) | Third threshold, benchmark not verdict |
| **Phase 1 — Pinned Commercial Settings** | **A sent version's thresholds come from its pin, not `firm_settings`** |

**The adjustment model, as approved:**

| Lever | Scope | Behaviour |
|---|---|---|
| Global | Whole quote | percentage |
| Per-tier | One tier, all SKUs | percentage, **replaces** global |
| **Surgical lift** *(new)* | **One SKU, one tier** | percentage, **independently persisted and removable** |
| Direct price *(override)* | One SKU, one tier | **terminal — blocks the lift** |

**Why the lift is independent:** it is *corrective* — the firm mandates a floor
and this cell breaches it. Global is *commercial* — the PM wants the quote to
earn more. **They answer to different authorities, so removing one must never
disturb the other.**

**Override precedence — reject, do not overrule.** An override is a person
saying *"this price, specifically."* A lift computing over it would silently
overturn a deliberate decision. **The reject names the person and the date and
offers a route to remove.**

---

## Implementation Authority

**Design-authoritative.** Claude Design's R10 / R11 / R12 bundle, implemented
verbatim per Pattern 30.

> **Codex implements exactly what the design specifies. Codex does not optimise,
> simplify, or reinterpret interactions. If implementation conflicts with the
> design, Codex stops and reports the conflict rather than inventing an
> alternative.**

**Canonical sources:**

| Artefact | Role |
|---|---|
| `app/r10/data.js` | **The contract.** Node kinds, `compute()`, `resolveMarkup()` |
| `app/r10/pricing-trace.jsx` | Trace presentation |
| `app/r11/data.js` | Quote-level projections |
| `app/r12/pricing-page.jsx` | **Supersedes R11's page component** |
| `app/r10 / r11 / r12 styles.css` | Load in that order; R12 is an addendum |
| `docs/r10 / r11 / r12-designer-notes.md` | 26 load-bearing items |

**`data.js` is the contract, not a fixture.** Every number computed from inputs,
trace generated from the same computation, no second source of truth. **That is
deliberate** — R6's fixture hard-coded totals beside lines that did not sum to
them, and a traceability design built on numbers that do not reconcile is worse
than no traceability.

**Load-bearing items are spread across three documents.** Ask CD to consolidate
them into one list before implementation — **a list assembled by reading three
documents is a list that loses items.**

**Where design and repository conflict, stop and report.** Do not resolve it.

---

## Out of Scope

- Any Costs page change *(Phase 2)*
- Margin Approval workflow *(Phase 4)* — but **the page must reserve its space**
- Quote isolation and pinning *(Phase 1)* — but **Phase 3 consumes its contract**
- Bulk Raw beyond what the trace already marks provisional
- The freight `treatment` rename or relocation
- Any change to costing arithmetic. **BV-009 confirms the engine is correct.**
- Customer View or PDF. **Trace is excluded from Customer View entirely** — see
  stop conditions.

---

## Dependencies

**No phase must ship first.** But two contracts must exist.

**1 · Phase 1's Pinned Commercial Settings contract — required, not optional.**

The lift is `cost / (1 − threshold)`. The threshold is an argument.

> **If Phase 3 computes a lift against current `firm_settings` on a Quote that
> has been sent and revised, it targets a threshold the version never
> consumed.**

Phase 3 does not need Phase 1 **shipped**. It needs Phase 1's contract to
**exist**, so the lift, `marginState`, and `evaluateCells` all read the same
resolved thresholds.

**2 · The surgical lift's persistence — a new field.**

Codex established: keyed on `(quote_leaf_id, tier_id)` — the canonical
commercial attachment crossed with the tier. **Not on `quote_tiers`**, which
necessarily affects every SKU. **Not folded into `assembly_leaf_overrides`**,
whose row currently means *a terminal absolute override exists* — adding a lift
there overloads an invariant.

**The minimum-lift algebra already exists** at the right granularity. New:
persistence, application, removal, preview, and one business rule.

---

## Implementation Boundary

### In scope

**1 · The surgical lift.**
New field on `(quote_leaf_id, tier_id)`. Independently persisted, independently
removable. `liftTo(threshold)` — **parameterised, not fixed to the floor**, so
Phase 4's approver target reuses it without a new mechanism.

**Override conflict: reject.** Message names the person and the date from the
audit record and offers a route to remove.

**1a · Identity-resolution contract — governed, not a stop condition.**

> **Surgical lifts persist against `quote_leaf_id`.** Costing inputs may remain
> keyed through the legacy grouped-membership identity during the compatibility
> window. **Every lift read, preview, apply and removal must resolve the
> canonical-to-legacy mapping and prove Quote, Product, LEAF, quantity and
> position parity.** Missing, duplicate, cross-Quote or drifting mappings **fail
> closed.** No resolution through reusable `leaf_id` or inferred tuple matching
> is permitted.

**Do not migrate to `assembly_leaf_id` for implementation convenience.** The
mapping outlives this phase; the shortcut does not.

**2 · The staging model.**
Session-scoped working state. Lifts, direct prices and the global adjustment all
stage. **One Apply commits the whole set as one audit entry**, individual
changes in the payload. **Reset** discards.

**Nothing persists across navigation.** There is no third state.

**3 · Transient deltas.**
While anything is staged, the cost stack shows the delta against last-applied on
every component row, on quoted sell, and on margin in points. **Deltas disappear
on Apply** — their absence is the signal that nothing is pending.

**Compute twice against the pure engine.** No new arithmetic.

**4 · Undo at both scopes.**
Staged: per-change chip with its own dismiss, plus Reset all. Applied: remove an
individual lift or adjustment, **plus one control returning to computed
baseline.**

**Removing a lift and removing a direct price are different undos.** A lift
layers; a direct price replaces. **The interface says so at the point of
removal.**

**5 · The compliance grid.**
Margin by cell, every SKU × tier. Colour → margin state. Badge → history.
**Marker channel reserved for approval** *(Phase 4)*.

**Epsilon on the floor comparison.** A lift lands a cell exactly on the floor
and `m >= floor` reported `0.2499999…` as breaching — a corrected cell read as
an outstanding one. **The comparison was wrong, not only the colour.**

**6 · The traceability trace.**
Nine node kinds. Entry at node — a stack cell opens the trace **at that node**,
not at the root. Reconciliation asserted at every sum level. **Trace displays
unrounded; the grid displays 2dp.** Grid for scanning, trace for truth.

**7 · Client target as the third threshold.**
Benchmark stated **once per SKU row**; headroom shown **per cell**. It does not
vary by tier, so a column would assert something untrue and leave ~95% of quotes
with an empty region.

**Own channel. Never colours a cell. Never reaches the verdict.** A price above
the client's benchmark is a commercial risk, not a policy breach.

**8 · The page boundary.**
**Preserved from production, untouched:** scenario context · *"Tune price &
review"* and its state line · **Your next move** CTA · SENDABLE badge and
verdict · *"What you're sending"*.

**`Show pricing detail` is removed as a control.** Not re-ordered — removed. The
detail is the page.

**9 · The banner and grid read one evaluation.**
Both read `evaluateCells()`; the verdict is `verdictFrom(ev)` over the same
result. **Structural, not a convention two surfaces are asked to honour.**

**The verdict carries its own route.** Not sendable → names the tiers and the
CTA scrolls to the grid.

**10 · Apply verifies the cost base has not moved.**
CD's §7, flagged as a required guard. **The levers are single-owner; the cost
base is not.** A PM stages three lifts, Logistics updates a freight leg, the PM
applies — against which costs?

**The working state already carries the inputs it was computed from**, so the
check is a comparison rather than new plumbing.

### Explicitly not in scope

- Trace on Customer View. **Structurally excluded.**
- Any change to the four existing lifecycle guards
- Approval controls *(Phase 4)* — space reserved, nothing built

---

## Repository Dependencies

| Component | Dependency |
|---|---|
| Pricing page route and components | replaced below the banner |
| Banner components | **preserved untouched** |
| `computeQuoteCosting` | **read-only** — compute twice, change nothing |
| New lift table `(quote_leaf_id, tier_id)` | schema addition |
| `assembly_leaf_overrides` | **untouched** — do not overload |
| `quote_leaves` | canonical attachment identity — Slice 1 |
| Compliance evaluation | single source for banner and grid |
| Pinned settings *(Phase 1)* | threshold resolution at ≥ sent |
| Audit | one entry per Apply, changes in the payload |
| The four lifecycle guards | **the lift uses the existing draft-only guard** |

**On guards:** four vocabularies already exist — `assertDraft`,
`requireDraft`, inline `!== "sent"`, inline `!== "accepted"`. **The lift resolves
its commercial attachment and calls the existing draft-only guard. No fifth
lifecycle policy.**

**Note `assertNotFrozen` allows `sent` and rejects `accepted`** — it is a
lifecycle-path guard, **not the one to use here.**

---

## Rollout Risk

| Risk | Severity | Mitigation |
|---|---|---|
| **Staged and committed diverge** — `isStaged` derived from the working set alone stays true forever after Apply | **High** | Load-bearing 25: derive from working-minus-committed |
| Banner and grid disagree | **High** | Load-bearing 23: one evaluation, structurally |
| Apply commits against moved costs | **High** | Load-bearing 22: required guard, not optional |
| Lift computed against unpinned thresholds | **High** | Phase 1 contract; see Dependencies |
| Trace shows arithmetic that does not reconcile | **High** | Reconciliation asserted at every sum; fail loudly if not |
| Design reinterpreted during implementation | **High** | Design-authoritative; stop-and-report |
| Float comparison at the threshold | Medium | Epsilon, and it was a real defect |
| Session state lost mid-edit | Low | Stated in the staging bar; PM is told |
| New lift table overloads an existing invariant | Medium | Separate table; do not extend overrides |

**The three highest are all "two things that should agree, computed
separately."** That is the failure class this whole design exists to prevent,
and it is the one most likely to be reintroduced by implementation.

---

## 1 · Harness Invariants

**Permanent automated protections.**

**H1 · Every sum level reconciles.** Operands reproduce their parent exactly, at
every level, in every state, **unrounded.** A level that does not reconcile
fails loudly rather than rendering.

**H2 · Banner and grid cannot disagree.** Both read `evaluateCells()`; the
verdict is `verdictFrom(ev)` over the same result. Lift every breaching cell —
**the banner flips with no separate wiring.**

**H3 · `isStaged` is a difference, not a property.** Derived from
working-minus-committed. After Apply it is false. **Derived from the working set
alone it stays true forever, and the failure is silent.**

**H4 · Deltas appear while staged and vanish on Apply.**

**H5 · Levers are independently removable.** Apply a lift and a global
adjustment. Remove either — **the other is untouched.**

**H6 · Return to baseline is exact.** Apply every lever, return to baseline —
**every cell is exactly its pre-adjustment computed price.**

**H7 · An override blocks the lift**, with a message naming the person and the
date from the audit record.

**H8 · Removing an override differs from removing a lift.** After a cost change,
removing an override returns the **currently computed** price.

**H9 · Apply rejects a moved cost base.** Stage lifts, change a cost, Apply.
**It does not commit silently.**

**H10 · The lift resolves against pinned thresholds** on a sent-then-revised
Quote. *(Phase 1 contract.)*

**H11 · Client target never colours a cell and never reaches the verdict.**

**H12 · The trace is unreachable from Customer View.** Build-time assertion, not
a prop.

**H13 · Identity resolution fails closed.** A lift whose canonical-to-legacy
mapping is missing, duplicate, cross-Quote or drifting **is rejected, not
resolved by fallback.**

**H14 · The lift is rejected at sent and accepted**, via the existing draft-only
guard.

---

## 2 · Rehearsal Procedures

**Controlled operational proofs at a named gate.**

### R1 · Rollback after first Apply — **the blocking rehearsal**

**Gate:** before deploy. **Phase 3 cannot claim reversibility without this.**

**The question is not whether the current runtime renders lifts** — it does not,
because they do not exist yet. **The question is what happens when a runtime
without lift support meets a database containing them.**

Three possible outcomes, each with a different commercial consequence:

- **absorbs** — continues consuming lift rows while failing to explain them
- **ignores** — calculates a different price from the one displayed before
  rollback
- **rejects** — fails because it cannot interpret the state

**Procedure:**

1. Apply lifts using the Phase 3 runtime
2. Persist the resulting rows
3. **Deploy or run the pre-Phase-3 runtime against that database state**
4. Compare, on the same Quote:
   - computed sell
   - displayed sell
   - margin
   - Customer View
   - PDF
   - Completion / NetSuite projection

**Record:** all six, before and after, with the outcome named — absorbs, ignores
or rejects.

**Until this proof exists, Phase 3 is: cleanly reversible before first Apply;
rollback after first Apply unresolved.**

### R2 · Identity-resolution parity

**Gate:** before implementation completes.

Slice 1's compatibility window means the lift and the cost base it modifies are
keyed through different identities.

**Rehearse against real quote data:** for every commercial attachment, prove the
canonical row and the legacy input membership refer to the same **Quote,
Product, LEAF, quantity and position.**

**Record:** the parity check across the full attachment set, and the count of
any failing category.

**Stop condition:** any missing, duplicate, cross-Quote or drifting mapping.
**Do not resolve through `leaf_id` or inferred tuple matching.**

### R3 · Staged-versus-committed at production shape

**Gate:** before operator validation.

Exercise staging at **five to seven SKUs × four tiers** — the production range,
not a two-SKU fixture.

**Record:** render timing with deltas active, staging-bar legibility at that
volume, and whether Apply's cost-base check completes acceptably.

---

## 3 · Regression Requirements

- **Costing output byte-identical** for an unchanged Quote. This phase computes
  twice and changes nothing.
- Customer view and PDF unchanged
- NetSuite payload unchanged
- The four lifecycle guards still reject commercial writes at sent and accepted
- Banner behaviour unchanged for a Quote with no breaches
- Existing Pricing browser scenarios pass, or are updated **only** where the
  disclosure's removal makes them obsolete

**Explicit non-regression:** a Quote with no lifts, no overrides and no
adjustment prices **exactly as it does today.**

---

## 4 · Operator Validation Checklist

**Edward, before Phase 4 begins.**

- [ ] Open a compliant Quote. **Banner and page read as today above the fold.**
- [ ] Confirm pricing detail is **open**, and no disclosure control exists.
- [ ] Open a Quote with cells below floor. **Banner says NOT SENDABLE and names
      the tiers.** CTA scrolls to the grid.
- [ ] Stage a lift. **Cost stack shows a delta.** Nothing is written.
- [ ] Stage a second lift and a global adjustment. **All three in the staging
      bar.**
- [ ] Remove one staged change. Others survive.
- [ ] Reset all. Page returns to last-applied.
- [ ] Stage again and **Apply.** One audit entry. Deltas vanish.
- [ ] Remove the applied lift. **The adjustment is untouched.**
- [ ] Return to computed baseline. **Every cell is its computed price.**
- [ ] Attempt a lift on an overridden cell. **Rejected, naming who and when.**
- [ ] Remove that override. **Note explains the price may differ.**
- [ ] Press a cost-stack cell. **Trace opens at that node, not the root.**
- [ ] Expand to a terminal. **It names a person and a date.**
- [ ] Confirm every sum states that it reconciles.
- [ ] Confirm client-target markers appear only on SKUs that have one, and
      **never colour a cell.**
- [ ] Lift every breaching cell. **Banner flips to SENDABLE.**

**The judgement is not "does it work."** It is:

- Does the page feel like a **playground** — safe to try things and get back?
- Is *"which cells look wrong"* answerable at a glance?
- Does the trace answer *why* on the **first** expansion, or does it take three?
- **Does the default answer the routine question without expanding anything?**

That last one is the design's own test *(load-bearing 8)*. **If it fails, the
default is wrong and disclosure is hiding it.**

**Stop if any check fails.** Do not proceed to Phase 4.

---

## 5 · Release Evidence Required

| Artifact | Content |
|---|---|
| **Harness results** | H1–H14, named |
| **Reconciliation output** | Every sum level, unrounded, at production shape |
| **Rollback rehearsal manifest** | R1's six comparisons, with the outcome named |
| **Identity parity report** | R2's full attachment sweep, with failing counts |
| **Staging timings** | R3 at 5–7 SKUs × 4 tiers |
| **Design fidelity manifest** | Pattern 27: what matched R10/R11/R12 verbatim, what is a Nexus adaptation and why |
| **Load-bearing checklist** | All 26 items, confirmed present or explicitly excepted |
| **Costing non-regression** | `requiredSellPerUnit` identical, sampled |
| **Browser traces** | The trace opening at node; the banner flipping |
| **Operator sign-off** | Edward's completed checklist |


## Explicit Stop Conditions

**Stop and report. Do not proceed, do not work around.**

1. **A sum level does not reconcile.** Do not render it. The whole design rests
   on the arithmetic being true.
2. **The banner and grid require separate evaluations.** They must not. Report
   why rather than wiring both.
3. **Phase 1's pinning contract does not exist** when the lift is built. The
   lift would target the wrong threshold on any sent-then-revised Quote.
4. **The identity-resolution contract cannot be satisfied** — any mapping is
   missing, duplicate, cross-Quote or drifting. **Fail closed and report.** Do
   not fall back to `assembly_leaves.id` or infer a match.
5. **Design and repository conflict.** Report the conflict. **Do not invent an
   alternative.** Design-authoritative.
6. **The trace can reach Customer View** by any route. **The operation is the
   markup and the operands are cost and supplier.** Structural exclusion, not a
   prop someone remembers.
7. **Apply cannot verify the cost base.** Load-bearing 22 is a required guard.
8. **`isStaged` cannot be derived from working-minus-committed.** Load-bearing
   25 — the failure is silent and permanent.

---

## Open Questions

### A · What does Apply do when the cost base has moved?

CD flagged the guard as required and did not define its failure. **Recompute and
re-present, or reject and force re-staging?**

A PM with three staged lifts against moved costs needs to know **which of their
numbers changed** — not merely that something did.

### B · Do the load-bearing items need consolidating first?

**26 items across three documents.** Codex implements verbatim. **Recommend
asking CD to consolidate before implementation begins.**

### C · Rollback after first Apply — **now a rehearsal, not a question**

Moved to **R1**. It cannot be answered by reading the current repository — the
current runtime does not render lifts because they do not exist. **The question
is what a runtime without lift support does when it meets a database containing
them**, and that requires the rehearsal.

**Phase 3 remains: cleanly reversible before first Apply; rollback after first
Apply unresolved until R1 completes.**

---

## What "done" looks like

> A PM opens a Quote with three cells below floor. The banner says so and names
> the tiers. They press the CTA, land on the grid, see exactly which cells. They
> stage a lift, watch the cost stack move, stage another, change their mind,
> reset, try a global adjustment instead, and apply — once. Then they press a
> number and it tells them why it is what it is, all the way down to a person
> and a date.

---

## Accepted Implementation Correction — Cost-Stack Inline Trace

**Disposition (Edward/CD, deferred during Phase 1):** this is a required Phase 3
implementation correction, not a redesign, feature, or business-behavior change.
It must be included in the Phase 3 implementation plan before production code is
written and must not be deferred as post-launch polish.

Required behavior:

1. Pressing a cost-stack cell opens the trace immediately beneath the pressed row.
2. The pressed row remains visually pinned while the trace is open.
3. The trace closes by restating the downstream pricing chain using live values.
4. Rows resume beneath the inline trace.
5. Compliance-grid behavior remains unchanged.

Load-bearing CSS contract:

```css
/* Keep overflow clipped without creating the scroll container that breaks the
   pressed row's sticky positioning while its inline trace is open. */
overflow: clip;
```

The property and its explanatory comment are inseparable implementation
requirements. Replacing `overflow: clip` with `overflow: hidden` is a regression
even when the surface appears visually correct, because it silently breaks sticky
positioning.

Phase 3 operator validation must prove:

- inline placement immediately beneath the pressed row;
- the sticky row remains visible at short viewport heights;
- the downstream pricing chain displays correct live values;
- the compliance-grid interaction remains unchanged; and
- `overflow: clip` and the explanatory comment remain intact.
