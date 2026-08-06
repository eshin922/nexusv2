# Phase 1 — Quote Commercial Integrity

**Status:** implementation specification · awaiting approval
**Author:** CA
**Date:** 2026-08
**Phase:** 1 of 4 · independently deployable · independently reversible

---

## Business Invariants

These rules govern the implementation. The implementation does not create or
reinterpret them.

- **One accepted Quote Revision produces exactly one NetSuite Sales Order.**
  The Quote remains the business identity; the accepted revision is the state
  of that Quote authorised for the Sales Order.
- **Quote → Sales Order remains 1:1.** A retry continues the same accounting
  handoff. It does not create another Sales Order.
- **A sent Quote Revision is immutable.** Its customer-facing commercial state,
  compliance verdict, and supporting evidence cannot be changed in place.
- **Draft completeness and commercial validity are different lifecycle states.**
  A draft may contain unresolved null-cost cells while a PM builds or revises
  it. No customer send may cross the boundary with an unresolved cost.
- **Corrections after send use the existing clone + revision workflow.** A
  revision changes the state of the same Quote; a clone creates a separate
  Quote. Neither concept substitutes for the other.
- **Retries never create another Sales Order.** Known-success and
  ambiguous-response retries converge on the original Sales Order using the
  same durable send identity.
- **NetSuite becomes the accounting authority after successful Sales Order
  creation.** Nexus retains the immutable commercial and handoff evidence.
- **NetSuite-derived values never become new commercial authority.** ERP
  sourcing, numbering, totals, and downstream accounting state do not reprice
  or redefine the Quote.
- **Accounting corrections are ERP execution, not Quote edits.** They occur
  inside the governed NetSuite process and do not silently revise or resend the
  Quote.

---

## Success Criteria

**Business** — a Quote that has been sent means what it meant when it was sent.
Firm policy can change without retroactively repricing or invalidating work
already in a customer's hands.

**Implementation** — one canonical resolver for commercial settings. Sent
revisions read a pin; drafts read live. No catalogue value reaches an attached
LEAF's price.

**Operator** — a PM changes a firm markup default and nothing they have already
sent moves. **Correct behaviour here is nothing happening**, which is why the
operator check is the load-bearing one.

---

## Objective

**Make a sent Quote commercially immutable.**

Today a sent Quote's price and compliance verdict can change without anyone
editing that Quote. Three mechanisms allow it, all verified in the repository.
Phase 1 closes them.

**Success is a single sentence:** once a revision of a Quote is sent, the price
its customer received and the compliance verdict it carried can no longer
move.

**This phase changes no operator workflow and adds no feature.** It is
commercial correctness, and everything downstream assumes the numbers are
trustworthy.

---

## Business Authority

| Contract | Governs |
|---|---|
| **Quote isolation rules** (Edward, 2026-08) | LEAF cost ownership · firm-settings pinning · independent pinning of each sent state |
| **BV-009 — Freight treatment** | Pass-through is presentation, not pricing |
| **BV-006 §Commercial Cost Model** | Quote-specific values belong to the quote-scoped attachment, not the reusable LEAF |

**The three rules, as approved:**

**Rule 1 — LEAF cost is quote-owned from attachment.**
> Attaching a LEAF copies its catalogue cost into the Quote. From that moment
> the Quote owns it. External updates to the product master — Library edits,
> HubSpot pulls — never reach an attached LEAF at any lifecycle stage, draft
> included.

Edward's reasoning: a PM who finds a wrong cost fixes it on the Quote, because
that is where the work is. Multiple operators collaborate on a live draft and
their edits must be visible to each other — but **a cost changing because
someone edited the master elsewhere is not collaboration, it is drift.**

**Rule 2 — firm settings are live in draft, pinned at send.**
> Firm markups, target margin, and floor margin are read live while a Quote is
> in draft. At send they are pinned to that sent state of the Quote.

Edward: *"Firm settings will change — that's why they're there. We can't
retroactively void quotes done in the past that are now below floor. Active
quotes yes, it should apply."*

**This pins the compliance verdict, not only the price.** Target and floor come
from firm settings, so a sent Quote reading current thresholds could flip from
*above target* to *below floor* with nothing having changed on the Quote.

**Rule 3 — a sent revision's pinned values remain retrievable.**
> v1 pins at v1's send. v2 pins independently at its own send. Changes in v2
> never reach back to v1.

**Mechanism correction (Codex, 2026-08):** the pin is **Quote-scoped and
superseded**, not keyed by revision number. Only `quote_snapshots` records the
version number of a sent state; the live Quote remains the business identity, and every other
commercial value — `sell_price_override`, adjustments, targets — is quote-scoped
already. **A revision-number-keyed pin would invent an axis the model does not have.**

The rule survives; the implementation differs. **One active pin per Quote,
superseded on revise, historical rows retained.** Same pattern as
`quote_snapshots.superseded_at`. v1's values remain retrievable because the row
is superseded rather than overwritten.

**BV-009 — freight:**
> Pass-through is presentation, not pricing. Freight remains part of the
> commercial calculation and may carry markup. The flag controls only how the
> customer sees it.

The pricing engine is correct as built. **The PDF's "not included" wording is
wrong** and is a presentation-contract defect.

---

## Implementation Authority

**The repository and the approved business rules above.**

This phase has no design authority and requires none. It changes no operator
surface except one PDF string and one error message.

**Where an implementation choice is not determined by the rules above, stop and
ask.** Do not infer intent from existing code — the existing code is what this
phase is correcting.

---

## Out of Scope

- Any Costs page change *(Phase 2)*
- Any Pricing page change *(Phase 3)*
- The surgical lift *(Phase 3)*
- Margin Approval *(Phase 4)*
- Bulk Raw beyond leaving the existing plumbing inert
- Packaging `purchase_qty` — a persisted input that never reaches the engine.
  **Business Validation, not Phase 1.**
- One-time fees bypassing the engine when `allocate_service_fees_to_cost` is
  off — believed intentional, **confirm at BV, do not change here**
- Renaming the freight `treatment` flag or relocating it *(Phase 2 or 3)*
- The `ON DELETE SET NULL` on the audit user FK — real, and out of scope

---

## Dependencies

**None.** Phase 1 depends on no other phase and no other phase depends on it
shipping.

**But Phase 3 consumes a contract Phase 1 defines.** See *Contract for
downstream phases* below. That contract must be written and approved as part of
Phase 1, not left implicit in the implementation.

---

## The three exposures, verified

### 1 · Unresolved quote-owned cost in the read path

**Corrected finding (Business Validation, 2026-08).** The active path is on the
**inputs table**, not on `leaves`. `assembly_leaf_inputs.unit_cost` is nullable
and the costing adapter currently allows null to reach a numeric helper that
coerces it to zero.

There is no approved catalogue-cost inheritance on this path. The exposure is
not that a valid draft inherits from the Library; it is that an **incomplete
draft value can appear numerically resolved** and could cross a commercial
boundary unless send validates completeness.

**The reachable null paths are intentional:**

- adding a SKU;
- adding a tier;
- adding packaging;
- applying a preset; and
- clearing a cost before entering its replacement.

These are expected draft-construction states. They are not commercially valid
states and cannot be sent.

**Required boundary behavior:**

- **Draft:** null allowed. Internal warning or incomplete-state presentation is
  permitted. Editing remains available.
- **Customer send:** hard validation failure naming every unresolved attachment
  and tier. No snapshot, pin, PDF artifact, or sent transition is committed.
- **NetSuite send:** impossible because only a commercially valid sent Quote may
  become accepted. Completion also retains a defense-in-depth unresolved-cost
  guard.

**Never treat unresolved null as a commercially resolved zero.** Zero remains a
valid explicit cost when entered intentionally; null means unresolved.

The Library and HubSpot isolation rule remains unchanged: neither may rewrite
an attached Quote cost after attachment.

### 2 · Firm settings read live on sent Quotes

Markup defaults, `target_margin_pct`, and `floor_margin_pct` are read at every
calculation. An admin change reprices every Quote — including accepted ones
awaiting a NetSuite send.

**The PDF is a stored artifact, so the customer's document does not change.**
The value behind it does. **The divergence is invisible** until the NetSuite
push, where the recomputed value is what goes.

### 3 · Freight double-presentation

A pass-through leg is inside `computedSellPerUnit` *and* projected separately as
a `freightLines` entry the PDF describes as **not included in the turnkey
total.**

- Pricing inclusion — `costing.ts:1118`
- Separate projection — `customer-view-resolver.ts:367`
- "Not included" presentation — `customer-pdf-grand-total-row.tsx:149`

**Per BV-009 the arithmetic is correct and the wording is wrong.**

---

## Implementation Boundary

### In scope

**1 · Enforce unresolved-cost completeness at the commercial boundary.**

A draft may retain and edit null quote-scoped costs. `sendQuote` must query the
quote-owned input cells and reject any null with an explicit error naming the
attachment and tier. The validation happens before customer artifact creation
and before the snapshot/pin/status transaction.

`markComplete` retains a defense-in-depth check so unresolved costs cannot reach
NetSuite even if lifecycle state was created outside the governed send action.
The check does not replace the send boundary.

**2 · Build the sent-revision firm-settings pin.**

**Not on `quote_snapshots`.** That table is PDF-artifact provenance — one row per
version, no tier dimension. Firm settings resolve **per tier** through category
chains and fallback rungs. A per-tier resolution set on a per-version row means
a JSON blob: *"opaque to SQL, unvalidatable by constraints, and invisible to the
invariant suite."*

**A separate structure, tier-grained, Quote-scoped with supersede.**

**Not keyed by revision number** — the Quote is the business identity and the
live Quote has no separate durable revision entity. One active pin per Quote;
superseding on revise preserves the prior sent state without making Quote
Revision a competing business identity.

**Pin the resolution outcome, not the source table.** For each resolved markup:

```
{ category, chosen_rung, pct, set_by, set_at }
```

**The chosen rung is the answer to "why this markup"** — the same shape CD's
`resolution` node renders. Pinning the outcome preserves the explanation, not
just the number.

**Pin the thresholds too** — `target_margin_pct` and `floor_margin_pct`.
Otherwise the compliance verdict moves while the price holds.

**Durable association to the sent snapshot.** The snapshot represents the
state of the Quote at that send; it is not a separate business identity. The pin set and the
`quote_snapshots` row written at the same send must be linked, not merely
coincident in time. **Without that link, a superseded pin cannot be attributed to
the sent state it served** — and Phase 4's approval record, which must reproduce an
approved price, has nothing to resolve against.

**One canonical resolver.** Every consumer — costing, compliance evaluation, the
trace's `resolution` node, the banner verdict, Phase 3's `liftTo(threshold)`,
Phase 4's approval reproduction — resolves commercial settings through **one
function**. Not a convention; a single call site. **Two resolvers will diverge.**

**3 · Read pinned values at and after `sent`.**

Draft reads live. Sent, accepted, and complete read the pin. **The boundary is
send** — the moment a number reached the customer.

**4 · Correct the PDF freight wording — IN SCOPE, gated on one answer.**

Per BV-009, freight is in the unit price. **"Not included" is false**, and it is
the only user-visible incorrectness this phase touches.

**Codex proposed deferring this to Phase 2 or 3** because the wording depends on
a design decision. **Rejected.** Phase 1 is what makes this page true; shipping a
correctness phase that leaves the one customer-facing false statement in place
defeats its purpose.

**But the copy cannot be written without one answer.** If freight is in the unit
price *and* shown as a line, what is the line for?

- **Informational:** *"your unit price includes $0.35 of freight."* A
  disclosure explaining part of the total. The total is unchanged.
- **Additive:** the line is a charge, and the displayed unit price should
  *exclude* freight, with the total adding them back.

**The first is consistent with BV-009. The second reintroduces the divergence in
the opposite direction.**

### The answer — **DECIDED**

> **Neither. When freight is in the unit price, remove the freight line
> entirely.**

Edward: *"Remove the freight line altogether when it's in the unit price."*

**The reasoning, and it corrects CA's recommendation:** the whole purpose of
bundling freight is that **the customer sees one number.** A freight line —
even one labelled *"included"* — reintroduces the itemisation bundling exists to
avoid. An informational line contradicts the business need it was meant to
serve.

**So:**

- **Freight bundled** → **no freight line.** The unit price is the number, and
  it says nothing about freight.
- **Freight genuinely shown separately** → the line appears, and the unit price
  reflects that treatment.

**This is simpler than either option originally offered**, and it is the only
reading consistent with BV-009.

### Explicitly not in scope

- Changing what a **draft** reads. Drafts stay live on firm settings — that is
  the rule, not an oversight.
- Any change to the pricing arithmetic. **BV-009 confirms the engine is
  correct.**
- Backfilling pins for already-sent Quotes. See *Open question* below.

---

## Contract for downstream phases

**This is a Phase 1 deliverable and must be written and approved, not inferred.**

> **The Pinned Commercial Settings contract.**
>
> A sent revision of a Quote resolves its markups, target margin, and floor margin
> from its pin, not from `firm_settings`. Any consumer computing a price,
> margin, compliance verdict, or threshold for that sent state **must read the
> pin.**

**Why it matters for Phase 3:** the surgical lift is
`cost / (1 − threshold)` — the threshold is an argument. **If Phase 3 computes a
lift against current firm settings on a Quote that has been sent and revised, it
targets a threshold that sent state never consumed.**

Phase 3 does not need Phase 1 shipped. **It needs Phase 1's contract to exist.**

**Also consumed by:** compliance evaluation, the trace's `resolution` node, the
banner verdict, and any Phase 4 approval, which records a resulting price that
must be reproducible.

---

## Repository Dependencies

| Component | Dependency |
|---|---|
| Costing input adapter | preserves null as unresolved draft state; never establishes commercial validity by coercing null to zero |
| Send action | validates all quote-owned costs before rendering/uploading or writing snapshot, pin, and status |
| Completion action | defense-in-depth unresolved-cost rejection before any NetSuite write |
| `costing.ts` markup resolution | pin read replaces live read at ≥ sent |
| Compliance evaluation | threshold pin |
| `customer-view-resolver.ts` | freight projection unchanged; presentation only |
| `customer-pdf-grand-total-row.tsx:149` | wording |
| `quote_snapshots` | **untouched** — not the home for the pin |
| Send transaction | writes the pin, in the same transaction as the existing snapshot |
| Revise | the same Quote returns to draft; its next sent state receives a new pin and the prior pin remains historical |
| Clone | new Quote; starts unpinned and receives an independent pin at its own send |
| Sales Order push | binds the accepted state of the Quote, accepted tier, frozen payload, idempotency identity, and NetSuite result to the sent snapshot |

**Slice-12 precedent that applies:** the send path already writes a snapshot row
transactionally. **The pin belongs in that same transaction** — a revision sent
without a pin leaves that sent state reading live, which is the defect.

---

## Rollout Risk

| Risk | Severity | Mitigation |
|---|---|---|
| Draft null cells are mistaken for invalid workflow | **High** | Preserve editing; validate only at customer send and as NetSuite defense in depth |
| Null is coerced to a commercially resolved zero | **High** | Preserve unresolved state and hard-fail the commercial boundary with attachment/tier context |
| Pin written but not read, or read but not written | **High** | Both sides ship together. A partial pin is worse than none |
| Sent Quotes existing before the pin have none | **High** | See *Open question* — must be decided before deploy |
| PDF wording changed while a customer holds the old one | Low | Stored artifact; existing PDFs unchanged |
| Pin structure wrong and needs migration later | Medium | Tier-grained from the start; do not compress to per-version |

**The highest risk is partial deployment.** Writing the pin without reading it
changes nothing. Reading without writing breaks every sent Quote. **They are one
change.**

---

## 1 · Harness Invariants

**Permanent automated protections. Assert business behaviour, not implementation.
Run in CI and release validation. Remain after the phase ships.**

**H1 · A sent Quote reads pinned settings.**
Change a category markup, the target and the floor. A sent Quote's price,
margin and compliance verdict are unchanged.

**H2 · A draft reads live settings.**
Same change, unsent Quote. Price and verdict update. **This is the rule, not a
bug** — asserting it stops a later "fix" from pinning drafts.

**H3 · Sent states resolve independently.**
Send v1 of a Quote. Revise that Quote. Change firm settings. Send v2. **The
first sent state's pinned values are retrievable and unchanged; the second sent
state carries the new ones.**

**H4 · A null quote-scoped cost is valid in draft and blocked at send.**
Draft construction and editing continue. Customer send fails before artifact,
snapshot, pin, or status writes with an explicit error identifying the
attachment and tier. **Never inherited and never accepted as resolved zero.**

**H5 · A catalogue-cost edit reaches no Quote.**
Change the LEAF's catalogue value. **No Quote at any lifecycle stage changes** —
draft included.

**H6 · A HubSpot product pull reaches no attached LEAF's price.**
Same assertion via `pullProductsBatch`.

**H7 · The pin round-trips its resolution.**
Pinned rung, actor and date are retrievable — **not only the resolved
percentage.** Phase 3's trace consumes this.

**H8 · One resolver, one answer.**
Every consumer computing a price, margin, threshold or verdict for a sent
state resolves through the same commercial-settings resolver. **No second
path.**

**H9 · A newly sent revision of a Quote has a pin.**
No post-Phase-1 send exists without one. **A sent state without a pin reads
live, which is the defect.**

**H10 · One accepted Quote Revision produces one Sales Order.**
The successful push is durably associated with the Quote's accepted sent
snapshot. A second successful Sales Order for that accepted state is rejected.

**H11 · Retry converges.**
Repeated or concurrent completion attempts for the accepted state use the same
durable send identity and converge on the same NetSuite Sales Order.

**H12 · Clone and revision identities do not collide.**
A revision remains part of the same Quote history. A clone is a new Quote and
cannot reuse the source Quote's pin, snapshot, or Sales Order send identity.

**H13 · NetSuite-derived values do not flow back as commercial authority.**
NetSuite numbering, sourced fields, totals, and downstream accounting changes
cannot alter the sent Quote's price, margin, compliance verdict, or pin.

**H14 · An unresolved cost cannot reach NetSuite.**
The governed lifecycle makes acceptance unreachable after a failed customer
send, and completion independently rejects unresolved costs before any external
write.

---

## 2 · Rehearsal Procedures

**Controlled operational proofs. Run against production-shaped data at a named
release gate. Record artifacts. Not permanent coverage.**

### R1 · Legacy sent-Quote handling

**Gate:** before deploy.

Every Quote sent before Phase 1 has no pin. Rehearse the chosen disposition
*(Open Question C)* against a copy of production data:

1. Snapshot every sent Quote's `required_sell_per_unit`, margin and verdict
2. Deploy Phase 1
3. Recompute. **Compare.**
4. Change a firm setting. **Recompute. Compare again.**

**Record:** before/after values for every sent Quote, and which disposition was
applied.

**Stop condition:** any sent Quote's price changes at step 3. That means the
deployment itself repriced something, which is the failure this phase exists to
prevent.

### R2 · Pin-write and pin-read atomicity

**Gate:** before deploy.

**The highest risk in this phase is partial deployment.** Write without read
changes nothing; read without write breaks every sent Quote.

Rehearse a send in a controlled environment. **Prove the pin is written in the
same transaction as the existing snapshot** — force a failure after the snapshot
write and confirm neither lands.

**Record:** transaction boundary evidence, failure-injection result.

### R3 · Unresolved-cost boundary proof

**Gate:** before deploy.

Enumerate and exercise every intentional null-producing draft workflow: add a
SKU, add a tier, add packaging, apply a preset, and clear a cost before
replacement.

For each path, prove the draft remains editable and visibly incomplete. Then
attempt customer send and prove there is no PDF artifact, snapshot, pin, or
status transition. Finally, bypass lifecycle state only in the isolated harness
and prove completion performs no NetSuite write.

**Record:** path enumeration, named validation output, send-side-effect counts,
and the fake-NetSuite call count.

---

## 3 · Regression Requirements

**Everything that computes a price is downstream of this change.**

- Existing costing unit tests pass unchanged **for drafts**
- Customer view and PDF produce identical output for a draft with unchanged
  settings
- NetSuite payload arithmetic unchanged — **`requiredSellPerUnit` is what
  reaches the SO**
- The four lifecycle guards still reject commercial writes at sent and accepted

**Explicit non-regression:** a sent Quote's `required_sell_per_unit` before and
after deploy, **with firm settings unchanged, must be identical.** If it moves,
the pin captured something different from what was live.

**Not a Phase 1 regression check:** *sections + adjustment + overrides = quoted
sell*. That assertion lives in R11's prototype, not the current harness. **Adding
it here would be inventing scope.** It belongs with Phase 3.

---

## 4 · Operator Validation Checklist

**Edward, before Phase 2 begins.** Answers a different question from the harness
and the rehearsals: **can a real user understand and complete the workflow?**

- [ ] Send a Quote. Confirm the price and verdict on screen.
- [ ] Change a firm markup default in admin.
- [ ] **Reopen the sent Quote. Price and verdict unchanged.**
- [ ] Open a draft Quote. **Price and verdict reflect the new default.**
- [ ] Revise the sent Quote, send as v2. **v2 on new values, v1 still on old.**
- [ ] Open the customer PDF for a pass-through freight leg. **Wording no longer
      says "not included."**
- [ ] Confirm the total on the PDF matches the total in Nexus.
- [ ] Immediately after **Send to NetSuite** succeeds, capture the permanent
      retry/support reference as one evidence bundle:
  - NetSuite transaction ID;
  - the corresponding Nexus `netsuite_so_pushes` ledger entry;
  - the NetSuite idempotency key; and
  - the payload hash, or the equivalent immutable payload identifier recorded
    for the frozen first-attempt payload.
  Confirm that all four identifiers refer to the same Quote, accepted sent
  snapshot, and Sales Order before continuing.

**This is the phase most likely to appear to work while being wrong**, because
its correct behaviour is *nothing changing*. **A pin capturing the wrong values
looks identical to one capturing the right ones until a setting moves.** Step 2
is therefore the load-bearing step, not a formality.

**Stop if any check fails.** Do not proceed to Phase 2.

---

## 5 · Release Evidence Required

**Codex returns all of the following. A phase is not complete without them.**

| Artifact | Content |
|---|---|
| **Harness results** | Test names and outcomes for H1–H9. Named, not counted. |
| **Unresolved-cost proof** | R3's path enumeration and evidence that drafts remain editable while customer and NetSuite sends fail without side effects |
| **Legacy-Quote comparison** | R1's before/after table for every sent Quote |
| **Transaction proof** | R2's failure-injection result showing pin and snapshot are atomic |
| **Pin resolution proof** | Not a sample row — the **chain**: markup category → resolution chain → chosen rung → pinned outcome, per tier. **Proves the explanation survives pinning**, which is what Phase 3's trace consumes |
| **Non-regression proof** | `requiredSellPerUnit` before/after for a sample of sent Quotes, firm settings unchanged |
| **PDF before/after** | The freight wording change, or a stated deferral with the retained false statement documented |
| **Rollback proof** | Confirmation that pin rows are inert if unread |
| **NetSuite retry reference** | Transaction ID, Nexus push ledger entry, idempotency key, and immutable payload identifier captured together immediately after successful Sales Order send |
| **Operator sign-off** | Edward's completed checklist |


## Explicit Stop Conditions

**Stop and report. Do not proceed, do not work around.**

1. **A null `unit_cost` can cross customer send.** Null rows are valid in draft;
   any artifact, snapshot, pin, or sent transition with one is a release stop.
2. **The pin cannot capture a resolution rung.** If the fallback chain resolves
   in a way that cannot be recorded as `{category, chosen_rung, pct, set_by,
   set_at}`, the structure is wrong. **Stop — do not store a bare percentage.**
3. **Anything else is read live on a sent Quote** that participates in price or
   compliance and is not covered by Rules 1–3. **A fourth exposure means the
   sweep was incomplete.**
4. **The freight line's purpose is ambiguous.** If the PDF wording cannot be
   written without deciding informational-vs-additive, **stop and ask.**
5. **A Sales Order push cannot be associated with the accepted sent snapshot.**
   Without that association, one-Quote/one-order and retry convergence cannot
   be proven. **Stop — do not fall back to mutable Quote state.**
6. **Draft null-cost workflows stop being editable.** The commercial-validity
   guard belongs at send, not at draft construction. **Report the regression.**

---

## Open Questions — must be answered before deploy

### A · Which identity does the pin key on? — **ANSWERED**

> **The pin keys on `quote_leaves.id`, the canonical commercial attachment
> identity — subject to Question B's query coming back clean.**

The legacy identity is retired when the compatibility window closes. **Keying on
it means migrating the pin later**; keying on the canonical one does not.

*Original analysis retained below.*

Slice 1 established `quote_leaves.id` as the canonical commercial attachment
identity. **`assembly_leaf_inputs` is still keyed on `assembly_leaves.id`**, and
the two coexist by design during the compatibility window.

**A per-tier resolution pin has to key on one of them.** Keying on the legacy
identity means migrating the pin later; keying on the canonical one means
resolving through the compatibility mapping at write time.

**This is a schema decision inside Phase 1 and it cannot be deferred.**

### B · Do legacy grouped rows resolve cleanly? — **ANSWERED: TECHNICAL DEPENDENCY**

> **Classification: B. This is a technical dependency that can remain behind
> the approved Slice 1 compatibility strategy during Phase 1 implementation.**

The read-only preflight on 2026-08-03 found 132 grouped memberships: 12 exact
canonical matches and 120 missing canonical rows, with zero value conflicts,
duplicates, orphan grouped rows, cross-Quote references, nested memberships, or
invalid required references.

This is **not a business blocker** because it changes none of the invariants
above and requires no choice about Quote ownership, revision meaning, cloning,
or Sales Order authority. The canonical identity and compatibility strategy are
already approved. Phase 1 may therefore be implemented against
`quote_leaves.id` while Slice 1 completes its controlled backfill and contract
cutover.

It remains a **deployment gate**. An existing draft whose grouped attachment has
no canonical row cannot write a complete pin at send. Phase 1 must fail closed
for that Quote; it must not synthesize identity from `leaf_id`, key new pins on
the legacy identity, or perform an implicit backfill in the send path. Before
Phase 1 deployment, the approved Slice 1 process must handle the 120 rows and a
fresh preflight must show that every sendable attachment resolves canonically.

This separation is why implementation can proceed while deployment cannot:
the compatibility boundary isolates code from the legacy identity, but it
cannot manufacture historical canonical rows that the controlled migration has
not yet created.

*Original analysis retained below.*

If any commercial attachment cannot resolve to a canonical `quote_leaves` row,
**the pin cannot be written for that Quote.** The approved compatibility
strategy permits implementation against the canonical contract, but deployment
remains blocked until the controlled Slice 1 data gate is clean.

### C · What happens to Quotes already sent when Phase 1 ships? — **ANSWERED**

> **Leave them as they are. A missing pin means read-live.**

The fix applies going forward. Nothing is in production, so no customer-facing
work is affected.

*Original options retained below.*

They have no pin. Three options:

- **Backfill from current firm settings.** Wrong — it pins today's values as
  though they were the ones consumed at send.
- **Leave unpinned; treat missing pin as "read live."** Preserves current
  behaviour for existing Quotes and applies the fix going forward. **Simplest,
  and the exposure persists for the old ones.**
- **Leave unpinned; treat missing pin as an error.** Breaks every existing sent
  Quote.

**Nexus is not in production, so the population is test data.** The second
option is almost certainly right, and it should be a decision rather than a
default.

### D · Does a clone inherit a pin? — **ANSWERED**

> **No. A clone starts unpinned and pins at its own send.**

A clone is a fresh Quote. **The pin belongs to the act of sending**, not to the
content being copied.

---

## What "done" looks like

> Change a firm markup default. Every sent Quote's price, margin, and compliance
> verdict is exactly what it was. Every draft reflects the change. A LEAF cost
> edited in the Library reaches no Quote at all. And the PDF says something true
> about freight.
