# Open Decisions

**Status:** Live register. Updated whenever a decision opens or closes.
**Purpose:** every question the repository cannot answer for itself, with who
decides it and what evidence would settle it.

---

## How to use this document

This register exists because of a specific failure mode. When an engineer meets
an unanswered question mid-implementation, the pull toward a reasonable
invention is strong and feels like progress. Six months later that invention is
indistinguishable from a decision, and it will be defended as one.

Per [`NEXUS_IMPLEMENTATION_STANDARD.md` §10](NEXUS_IMPLEMENTATION_STANDARD.md),
**stopping is a deliverable.** This is where a stop gets recorded so it is not
lost.

**If you are implementing and hit something this register covers: stop.** The
question is open because it is genuinely undecided, not because nobody got
around to it.

**If you close one:** record the decision in the appropriate Business
Validation document or phase specification — *not here* — then mark the entry
closed with a pointer. This register holds open questions and a closed-item
trail. It is not itself business authority.

Each entry states what would change if the answer went one way rather than the
other. An open question whose answers are indistinguishable in consequence is
not a decision; it is a preference, and should be settled by whoever is
nearest.

---

## Blocking — work cannot proceed

### OD-001 · BV-009 does not exist

**Owner:** Edward · **Blocks:** Phase 2 close, Phase 3 start, PDF freight presentation

BV-009 is cited as governing business authority in eleven places across five
files, including production code at
[`src/lib/customer-view-resolver.ts:368`](../src/lib/customer-view-resolver.ts#L368),
where it justifies suppressing the customer-facing freight line. **The document
has never existed** in any branch at any point in history.

Full provenance:
[`business-validation/BV-009-freight-treatment.md`](business-validation/BV-009-freight-treatment.md)
— a reconstruction from citations, explicitly **not ratified**.

**The decision:** is the reconstruction an accurate statement of what was
approved?

| Answer | Consequence |
|---|---|
| Yes | Ratify. The reconstruction becomes BV-009. Citations resolve. Nothing else changes |
| Yes, but incomplete | Amend before ratifying. Anything the citations do not capture is currently unenforced |
| No | Every citation is suspect, including the PDF suppression already shipped on its authority |

**What settles it:** Edward's recollection of the original approval, or an
external record of it.

**Cost of leaving it open:** a business rule that is enforced in production and
cannot be verified. Anyone auditing why the customer sees no freight line
reaches a citation that resolves to nothing.

---

### OD-002 · BV-005 must be amended before Phase 4

**Owner:** Finance / Commercial Leadership · **Blocks:** Phase 4 entirely

[`BV-005`](business-validation/BV-005-below-floor-margin-approval.md) is
approved as a business contract, but
[`CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md) §5
records that it **must be amended first**. Five questions are unanswered:

| Question | Why it blocks |
|---|---|
| What governed list or permission identifies Commercial Approvers? | Determines whether a permission model or a settings-managed list ships |
| Who owns membership, and who are the initial approvers? | Without initial membership the feature cannot be used on day one |
| Is self-approval allowed? | A rule enforced in code; changing it later invalidates prior approvals |
| Is one approval sufficient? | Single vs quorum changes the schema, not just the UI |
| Is Slack availability required for launch? | Determines whether Slack is a hard dependency or an enhancement path |

**What settles it:** a BV-005 amendment carrying all five answers.

Phase 4 is also the first phase that is **not cleanly reversible** — its point
of no return is the first request sent to Slack. It needs a rollback runbook
before it starts, independent of these five answers.

---

### OD-003 · Phase 3 rollback after first Apply

**Owner:** Nexus engineering · **Blocks:** Phase 3 release, not Phase 3 start

Phase 3 introduces persisted surgical lifts. The question is **not** whether
the current runtime renders them — it does not, they do not exist. It is what a
runtime *without* lift support does when it meets a database *containing* them.

| Outcome | Consequence |
|---|---|
| **Absorbs** | Consumes rows it cannot explain. Silent wrong price |
| **Ignores** | Computes a different price from the one displayed before rollback |
| **Rejects** | Fails visibly on the state |

Phase 3 is cleanly reversible **before** first Apply. After first Apply it is
unresolved.

**What settles it:** a rollback rehearsal against a database containing lift
rows. The rehearsal is cheap; the ambiguity is not.

---

### OD-012 · Drizzle migration generation is unsafe until its baseline is repaired

**Owner:** Nexus engineering · **Blocks:** authoring any new schema migration.
Does **not** block Gate 1B analysis, and did not block Gate 1A close.

`npm run db:generate` must not be used.

Drizzle's meta snapshots stop at `0048_snapshot.json`; migrations run to `0062`.
Roughly fourteen migrations in between were hand-written and applied without
regenerating a snapshot, so the generator diffs `schema.ts` against a picture of
the database from long ago. Run during Gate 1A close, it emitted a migration
that would `CREATE TABLE` the entire freight subsystem, re-add existing columns,
`DROP` a live index, and `ALTER TABLE freight_legs DROP COLUMN
freight_markup_pct` — against the database that also serves production. It was
read and discarded unapplied.

Nothing is currently wrong with the database. `db:migrate` reads the journal and
the `.sql` files, not the snapshots, so every hand-written migration applied
correctly and the schema is in its intended state. The snapshots are a
code-generation input only.

**Why this is a blocker rather than debt.** The failure is silent and
confident. It does not warn that its baseline is stale — it emits clean-looking
SQL that would destroy data, and the only thing standing between that output and
production is whether the person running it reads it closely. Migration
governance on this project is otherwise disciplined: pre-flight gates,
resolvability checks, additive-versus-restrictive ordering. A tool that
manufactures a plausible destructive migration undoes all of it in one command,
and does so at exactly the moment someone is moving fast.

| Option | Consequence |
|---|---|
| **Repair via `drizzle-kit pull`** | Introspect production into a fresh snapshot. Generation becomes usable again. The drift spans too many migrations to reconstruct by hand |
| **Guard** | Keep hand-writing migrations; make `db:generate` fail loudly, or remove the script, so it cannot be reached by habit |
| **Leave as-is** | Depends on every future engineer reading generated SQL in full, forever. This is the state that produced the near-miss |

**What settles it:** a `drizzle-kit pull` against production producing a
snapshot that yields an EMPTY diff against current `schema.ts`. Empty is the
only acceptable result — any non-empty diff means the snapshot still disagrees
with reality and generation is still unsafe.

Until then: migrations here are hand-written, as `0056`–`0062` were, and any
generated SQL is read in full before it is journalled.

---

### OD-013 · S-7 depends on a mutable shared production database

**Owner:** Nexus engineering · **Blocks:** S-7 entering CI. Does not block
Gate 1B.

The S-7 preservation baseline is captured from 24 live production quotes, so
**any legitimate operator edit invalidates it.** It cannot, on its own,
distinguish "the engine changed" from "the inputs changed".

This is not hypothetical. During Gate 1B increment 6 the check failed on one
quote with a large, non-float-shaped movement
(`blendedMarginPct 0.1847 -> 0.2275`). The cause was twelve
`assembly_leaf_input_cell_updated` audit rows — an operator entering costs on
the Costs surface while the increment was in flight.

**The classification sequence is mandatory before any re-baseline.** A
preservation check that gets re-baselined whenever it fails is not a
preservation check:

1. revert the candidate code
2. re-run against identical `HEAD`
3. distinguish input drift from engine drift
4. only then re-baseline, and only if the evidence shows legitimate data change

Two signals made the call quick and should be looked for again: a code
regression moves MANY quotes while an operator edit moves ONE, and the audit
trail names the actor and timestamp for every input change — which is Gate 1A's
actor snapshots being used as forensics rather than as provenance.

| Option | Consequence |
|---|---|
| **Deterministic isolated fixtures** | S-7 becomes reproducible and CI-eligible. The validation database already exists for e2e |
| **Leave on production data** | Every operator action is a potential false positive, and each one costs a manual bisect |

**What settles it:** an S-7 baseline captured against the isolated validation
database, reproducing byte-identically across two runs with the application in
use. Until then S-7 stays manual, per the standing decision that a transient
database failure must not masquerade as a code regression.

---

### OD-014 · What entity constitutes a commercial SKU for Pricing aggregation

**Owner:** Edward · **Blocks:** Gate 1B increment 7. Blocks any per-component
blend node entering the canonical graph.

Pricing presents blended per-unit figures — packaging, production, bulk raw,
freight, duty & tariff, sell before adjustment. Blending requires a population
to blend over, and **that population has never been stated as a business fact.**

The absence went unnoticed because two candidate populations coincide on the
common case. They diverge as soon as a quote contains an assembly, and the
divergence is not small: on quote `52bd0077` the two answers for blended
packaging are `5.0750` and `2.5375`. Both are arithmetically correct. They are
answers to different questions.

Increment 7 emitted a blend without settling this, and was reverted for that
reason — see `f1af346`.

**This is not a question about tree depth.** Whether an entity happens to sit at
the top of the assembly tree is an implementation artefact of how a quote was
built, and cannot be what determines whether it is a thing the firm sells. The
question is what Pricing means by "a SKU".

**Determine the answer from, in combination:**

| Source | What it should settle |
|---|---|
| Recovered Phase 3 authority | Whether the workspace was designed against a stated SKU identity |
| Canonical `quote_leaf_id` / commercial-attachment semantics | Which entity carries commercial attachment |
| Setup's SKU model | What an operator believes they are creating when they add a SKU |
| Existing per-SKU Pricing behaviour | What the per-SKU rows already treat as a SKU today |
| Customer-facing quote and publication semantics | What the customer is shown as a line they can buy |

The last is the strongest evidence available: **the entity the customer is
quoted a price for is the entity Pricing is aggregating.** If those two
disagree, the disagreement is itself the finding.

**Once the identity is established, the component blends must aggregate over
that governed population regardless of assembly-tree shape.** An implementation
that reads the tree to decide who participates has re-encoded the artefact.

**What settles it:** a stated definition of the Pricing SKU population, recorded
as tier-1 authority, with the coincidence case named explicitly so a future
fixture cannot pass by accident.

---

### OD-015 · S-7 does not validate the semantics of graph-only nodes

**Owner:** Nexus engineering · **Blocks:** reattempting Gate 1B increment 7.

S-7 hashes `QuoteCostingResult` — the commercial scalars that existed before
Gate 1B. It proves those are byte-identical. **It says nothing about nodes that
exist only in the graph**, because a node consumed by nothing changes no scalar.

Increment 7 passed S-7 byte-identically while emitting a node whose value was
wrong for the quantity it named. That is S-7 behaving correctly and being
misread as broader assurance than it offers. The gap is structural: a
preservation baseline over old outputs cannot validate new ones, and the graph
is now accumulating nodes faster than any consumer reads them.

The unit fixture did not close the gap either. It asserted the resulting
**number**, on a quote whose structure made the right and wrong populations
identical, so the assertion held for a reason unrelated to correctness.

**Before increment 7 is reattempted:**

1. Add a fixture whose structure matches real nested production data — at
   minimum one assembly with multiple leaves, and unequal per-entity
   quantities so an unweighted mean cannot pass as a weighted one.
2. Assert **contributor identity and population** explicitly — which entities
   participated, and how many — not only the resulting value. A test that
   checks only the number cannot distinguish the right answer from a
   coincidence.
3. Keep both assertions. The population assertion is what fails when the
   business identity in OD-014 is later revised.

**What settles it:** an increment-7 test suite in which deliberately corrupting
the contributor population fails a test, per the standing rule that a
reconciliation rule is not complete until a valid case passes and a corrupted
case fails.

---

## Open — needed before the relevant work starts

### OD-009 · Freight markup resolution when a break carries no markup

**Owner:** Edward + operators (Logistics) · **Blocks:** nothing today —
implementation deferred pending business disposition
**Classification:** **business disposition required**, not an engineering
decision. Engineering analysis complete; the choice is a workflow judgement.

`freight_destination_breaks.freight_markup_pct` is nullable and the action
layer can write NULL. The costing read path resolves NULL to **zero**
(`costing.ts:420` — `num(row.freightMarkupPct, 0)`), so a draft break with a
freight amount and no markup contributes freight **at cost**.

**Severity is bounded.** Send is blocked — `quote-cost-completeness.ts:45`
rejects a null `freightMarkupPct`. No customer can receive a quote in this
state. The effect is confined to **drafts**, where a PM mid-build sees margin
that will not survive completion, with no signal that the number is
provisional.

**Why this is not an engineering decision.** All three options are
implementable at similar cost. They differ in what an operator should *see*
while building, which is a workflow question, not a correctness one.

| Option | Behaviour | Argument for | Argument against |
|---|---|---|---|
| **A · Inherit silently** | NULL resolves to `quotes.freight_markup_pct` | Consistent with PHASE-2's "one Quote-owned freight markup authority". Draft margin is realistic immediately | A blank field looks answered. The operator sees a number sourced from a default they never confirmed, then hits a send block they did not expect |
| **B · Withhold commercial values** | Draft shows no freight contribution until markup is entered | Honest — nothing is displayed that the operator did not supply | Hostile during exploratory building. Entering an amount produces nothing until a second field is filled |
| **C · Inherit and mark provisional** | Resolves to `quotes.freight_markup_pct`, surfaced as inherited via existing `field_provenance` | The number is useful and its status is visible. Send gating unchanged | Adds a visual state to a surface currently under fidelity review; the design bundle does not specify an "inherited" treatment |

**Engineering recommendation: Option C.** It applies the governing principle
to its own edge — show what was inherited and say that it was inherited, rather
than inventing zero or refusing to speak. **Not implemented.** Recorded as a
recommendation only.

**What settles it:** Edward's disposition, ideally informed by how Logistics
actually works — whether a blank markup means *"use the standard"* or *"I have
not decided yet."* Those two intents want different options.

**Note on Option C and Design Authority:** the `freight-1a` bundle specifies no
"inherited value" treatment. If C is chosen, the visual state is either an
approved deviation recorded in
[`design-authority/freight-1a/BUNDLE.md`](design-authority/freight-1a/BUNDLE.md)
or a question referred to CD. Do not invent the treatment.

---

### OD-010 · Stale publication entries awaiting F3 Stage 5 removal

**Owner:** Nexus engineering · **Blocks:** nothing · **Tracked retirement obligation**

`scripts/verify/realtime-readiness.ts` still lists three tables dropped by
Slice 11.5.1 — `quote_skus`, `packaging_inputs`, `production_inputs`. They are
annotated in place rather than pruned, because that verifier is the executable
record of what should be published and removing them in an unrelated commit
would erase the evidence that the OLD-model publication cleanup happened.

**A code comment is not a retirement obligation, which is why this entry
exists.** Without it the annotation is a note nobody is accountable for.

**Removal is scoped to F3 Stage 5** (legacy freight model drop, post-V1),
alongside removing the four legacy freight tables from both the publication
and the `structure` channel bindings. Same commit, same cross-consumer audit:
reads, writes, realtime subscriptions, publication membership, raw SQL under
`src/lib/`.

**What settles it:** F3 Stage 5 shipping. Nothing else needs to happen first.

---

### OD-011 · Order-dependent browser fixture state in `basic-quote-persistence.spec.ts`

**Owner:** Nexus engineering · **Blocks:** nothing today
**Class:** validation infrastructure · **Pre-existing, unrelated to F9**

VAL-101 mutates fixture state that VAL-103 consumes. Running the spec file
sequentially without an intervening reseed fails; VAL-103 reports
`Protocol error (Network.getResponseBody): No data found for resource`, and a
whole-file run additionally surfaces `net::ERR_ABORTED` on a server-action POST.

**Both mandatory merge-gate items pass.** [`merge-gate.md`](validation/merge-gate.md)
invokes VAL-101 and VAL-103 as separate `-g` executions, so the coupling is
never exercised by the gate. Verified against clean fixture state at
`8fd2a18`: VAL-101 passes, VAL-103 passes.

**The gate is insulated by invocation shape, not by test isolation.** That is
the finding. [`operational-runbook.md`](validation/operational-runbook.md)
seeds once at §5 and resets at cleanup; nothing reseeds between browser gates.
Anyone who runs the file whole, reorders the checklist, or adds a third VAL
case to the same file hits it.

**Reproduces at `131af0a`** — established by the same bisect that cleared the
Stage 1b visual delta. Not caused by the Freight work and **not to be fixed
during Freight closeout** unless it becomes a demonstrated merge-gate failure.

**What settles it:** either per-test fixture isolation, or an explicit reseed
step between browser gates in the runbook. The second is cheaper; the first is
correct. Deciding which is the disposition.

**A caution for whoever takes it:** the current green state depends on an
accident of invocation. Treating the gate passing as evidence the tests are
isolated would be the wrong reading.

---

### OD-004 · Item Group applicability datum

**Owner:** Accounting / Operations · **Blocks:** Slice 13 Item Group gate

- What existing business datum determines detailed items vs Item Group vs
  finished-good Assembly?
- What controlled sandbox result approves the member-rate pricing procedure?

Accounting currently supplies this decision manually. No canonical Nexus datum
is approved.

**Standing constraint, independent of the answer:** a `$0.00` upstream catalog
price can satisfy NetSuite validation but **must never become the commercial
transaction price.**

---

### OD-005 · HubSpot Product price → NetSuite Base Price propagation

**Owner:** HubSpot / NetSuite integration owner · **Blocks:** Slice 13 go-live

Nexus-authored components default the HubSpot Product `price` payload to
`0.00` when no valid price is supplied. Proven in isolated validation only.
HubSpot → NetSuite Item price propagation is **untested**.

**What settles it:** a controlled live sync experiment proving the corresponding
NetSuite Item Base Price row is created or updated — or an approved
direct-to-NetSuite alternative path.

This is external to Nexus. No amount of Nexus-side work closes it.

---

### OD-006 · NetSuite assembly structure

**Owner:** Edward + Accounting · **Blocks:** Sales Order push design

Three discovery questions, answerable in parallel with other work:

1. Does the active HubSpot → NetSuite sync carry assembly metadata, or only
   leaves?
2. What does the firm's NetSuite administrator manually enter into Sales Orders
   today — assemblies or leaves?
3. Is the NetSuite assembly pricing model a separate price, or the sum of
   leaves?

Together these decide whether the Sales Order push sends assemblies, leaves, or
both.

---

### OD-007 · Pricing click-to-edit as accepted extension

**Owner:** Edward · **Blocks:** Phase 3 kickoff, not Phase 3 planning

Nexus's Pricing surface uses click-to-edit cells where the R12 canonical source
may render display-only. Under
[`NEXUS_IMPLEMENTATION_STANDARD.md` §9](NEXUS_IMPLEMENTATION_STANDARD.md) a
departure from the bundle is either an approved deviation or drift.

| Answer | Consequence |
|---|---|
| Accepted extension | Record in [`design-authority/r12-pricing-workspace/BUNDLE.md`](design-authority/r12-pricing-workspace/BUNDLE.md). Fidelity audits stop re-raising it |
| Not accepted | Phase 3 removes the affordance. **Check first whether it is the sole authoring surface for any field** |

**Decide at Phase 3 kickoff, not during implementation.** Deciding mid-build
means deciding under schedule pressure.

---

### OD-008 · Costs-page shell scope

**Owner:** Edward · **Blocks:** nothing today; will block Phase 2 close if unanswered

The `freight-1a` bundle ships `app/costs/styles.css` — 23 `cw-*` classes
defining a Costs-page shell (topbar, rail, ledger, crumb, legend, scope).
Production implements two of them.

**The decision:** is that shell in scope for Phase 2, or is it a separate
Costs-workspace pass?

The bundle is tier-3 authority for the Freight *section*. Whether it is also
authority for the *page around* the section has never been stated. The
[parity audit](phase-2-freight-dom-parity-audit.md) is scoped to the freight
worksheet and does not answer this.

**What settles it:** an explicit scope statement. "The bundle governs the
Freight section only" is a complete answer and closes this.

---

## Closed

*(Entries move here with the disposition and a pointer to where the decision
now lives. Nothing has closed since this register was created on 2026-08-04.)*

| ID | Decision | Closed | Recorded in |
|---|---|---|---|
| — | — | — | — |
