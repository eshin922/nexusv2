# Nexus Implementation Standard

**Version:** 1.0
**Status:** Governing. Applies to every subsystem built after 2026-08-04.
**Supersedes:** no prior document. This standard records working method that
previously existed only in conversation between Edward, CA, and the
implementation agent.

---

## Why this document exists

Between 2026-05 and 2026-08 the project's working method changed
substantially. The changes were agreed verbally, applied consistently, and
never written down. The repository therefore contained the *results* of a
method it did not contain.

An engineer reading this repository in six months must be able to answer three
questions without access to any conversation:

1. **On whose authority may I build this?**
2. **What must be true before I start?**
3. **What do I do when two authorities disagree?**

This document answers those three questions. It is method, not scope. Scope
lives in phase specifications; business rules live in the Business Validation
library; visual specification lives in the design bundles. This document
governs how those three are used.

**If you are about to write production code and have not read §2 and §3, stop
and read them.** They are the two sections that most often decide whether a
piece of work was correct.

---

## §1 · Governing principle

> **Nexus records what the operator determined. It does not recreate the
> operator's reasoning.**

This is the single sentence from which most of the rest of this document
follows.

The DPS runs on business processes that already exist and already work.
Logistics determines freight cost using a forwarding workbook. Purchasing
determines packaging cost from vendor quotes. Accounting determines ERP
treatment inside NetSuite. In each case a competent human, working with better
information than Nexus has, has already reached a conclusion.

Nexus's job is to **capture that conclusion, attribute it, make it traceable,
and carry it correctly through the commercial calculation.** Nexus's job is
*not* to rebuild the reasoning that produced it.

### Why this was adopted

The earlier freight implementation allocated freight cost across components
using CBM proportions. It was arithmetically defensible and it was wrong,
because Logistics does not allocate that way — Logistics reads a number off a
forwarder's workbook and assigns it. Nexus had built a second, competing
costing engine whose answers diverged from the authoritative one. Reconciling
two engines is unbounded work; recording one determination is bounded work.

### What this rules out

- Deriving a commercial figure that an external authority already publishes
- Building an allocation, spread, or apportionment where the operator supplies
  a determined value
- "Improving" on an operator's number by recomputing it from primitives
- Treating a technically-available computation as a mandate to perform it

### What this does *not* rule out

- Arithmetic Nexus genuinely owns — margin, markup application, tier rollups,
  the pricing engine. Nexus is the authority for commercial calculation over
  recorded inputs.
- Validation that a recorded determination is internally consistent
- Deriving *presentation* from recorded values

### The test

> Does an external business authority already produce this number?
> If yes — record it. If no — Nexus may compute it.

### What would reopen this

A subsystem where no external authority exists and no operator determination
is available, where Nexus must originate the figure. That is a legitimate
exception; it requires an explicit business disposition naming Nexus as the
authority for that figure, recorded in the Business Validation library.

---

## §2 · Five-tier precedence

When two sources conflict, the higher tier wins. This ordering is
authoritative and is not subject to interpretation at implementation time.

| Tier | Source | Notes |
|---|---|---|
| **1** | **Later approved business dispositions** | Decisions by Edward, or by the accountable business owner, recorded in the Business Validation library or a phase specification. Most recent wins. |
| **2** | **Operator-reviewed corrections** | Findings from a real operator working the real surface. These *refine the design bundle itself* — they are not defects against it. |
| **3** | **Design bundle** | Authoritative JSX / CSS / component hierarchy / interaction documents. See §9. |
| **4** | **Existing Nexus platform conventions** | The pattern library in `CLAUDE.md`, ADRs, subsystem contracts under `docs/costing/`. |
| **5** | **Stop rather than invent** | The floor. If tiers 1–4 are silent or contradictory, the correct action is to stop. |

### Why Tier 2 sits above Tier 3

This is the least obvious rule in the document and the one most likely to be
got wrong.

A design bundle is produced before an operator has worked the real surface with
real data. When an operator reviews the implemented surface and reports that
the hierarchy is unreadable or the rhythm is wrong, they are supplying
information the bundle's author did not have. Their correction **amends the
bundle's intent**, it does not violate it.

The failure mode this prevents: an implementer receives an operator finding,
checks it against the bundle, sees the bundle is being followed, and closes the
finding as invalid. The operator is then told the surface is correct while
continuing to be unable to use it.

The opposite failure mode is equally real: treating every operator preference
as authority and eroding the bundle by accretion. The discipline is that an
operator correction is recorded as an **approved deviation** against the
bundle, in the bundle's own record (see `docs/design-authority/`), so the next
implementer sees bundle-plus-deviations as one artifact.

### Why "stop rather than invent" is a tier and not a footnote

It is ranked because it competes. When an implementer is mid-task and an
authority is silent, the pull toward a reasonable invention is strong and feels
like progress. Ranking it as tier 5 makes explicit that inventing is *below*
every other source — including doing nothing.

**Stopping is a deliverable.** The correct output when authority is absent is:
name the decision, name the conflicting or absent sources, state what evidence
would settle it, and stop. That output is more valuable than a plausible guess,
because a guess is indistinguishable from a decision once it is in the
codebase.

---

## §3 · The eight implementation gates

No subsystem proceeds to production implementation until all eight are
complete. A gate is complete when its question has a **recorded** answer — not
when someone believes they know the answer.

| # | Gate | The question it answers | Complete when |
|---|---|---|---|
| **1** | **Business Workflow** | What does the human actually do today, step by step? | The workflow is described in business language, by or with the operator who performs it |
| **2** | **Business Authority** | Which approved business contract governs this? | A BV document or phase specification is cited by identifier and it exists |
| **3** | **External Authority** | What external business artifact already exists? | The artifact is named, and its relationship to Nexus is stated (record / import / reference / none) |
| **4** | **Data Traceability** | Where does every operator-entered field go? | Each field is traced through the full propagation chain (§7) with no orphans |
| **4b** | **Structural Inheritance** | Which upstream surface owns the structure this surface operates on, and what materialises it here? | A named materialisation path exists and has regression coverage, or the absence of inheritance is explicitly dispositioned |
| **5** | **Commercial vs Operational Authority** | Which of these values can change a price? | Every field is classified commercial or operational, and operational fields are proven unable to mutate commercial history |
| **6** | **Snapshot / Clone / Revision** | What happens to this data at send, clone, and revise? | Behaviour is specified for all three, including which values freeze |
| **7** | **Regression Contract** | What permanent test proves the invariant? | The invariant is stated, and the test that protects it is named |
| **8** | **Design Authority** | What is the executable visual specification? | The bundle is identified and tracked, or its absence is explicitly dispositioned |

### On gate 4b — structural inheritance

Gates 1 through 7 are **outbound**: they follow data the operator enters, or
that arrives from an external artifact, and trace it downstream. Gate 4b is the
only **inbound** question. It asks what must already exist on a surface before
the operator can enter anything at all.

The gap it closes is not hypothetical. Costs shipped without any materialisation
path from Setup: attaching a component in Setup wrote structure rows and
stopped, so cost rows existed only where a PM had manually created them. Every
other gate passed. The workflow "PM enters packaging costs per component per
tier" satisfies gate 1 completely, because gate 1 never asks *against which
rows, and who created them*. Gate 7's regression contract then protected the
entry behaviour — which worked — while the missing inheritance stayed invisible
to it.

The defect survived because **every other gate examines a single surface, and
this one lived in the seam between two**. Setup was correct. Costs was correct.
The relationship between them was owned by nobody.

Answer 4b with a named path — an action, a migration, a projection — not an
intention. "Costs inherits from Setup" is not an answer; `attachAssemblyLeaf`
materialises one `assembly_leaf_inputs` row per existing tier" is. If a surface
genuinely inherits nothing, say so explicitly; an unanswered 4b is the shape
this failure takes.

### On gate 3 — external authority

Ask, for every subsystem: **what business artifact already exists?**

| Subsystem | External authority |
|---|---|
| Freight | Straight Forwarding workbook |
| Packaging | Vendor quote |
| Raw Materials | Supplier quotation |
| Pricing | Customer negotiation |
| Accounting / Sales Orders | NetSuite (ERP) |

Where an external artifact exists, Nexus **digitizes the workflow around it**.
It does not invent a replacement for it. This is §1 expressed as a gate.

The gate is complete even when the answer is "none" — but that answer must be
recorded, because "no external authority exists" is precisely the condition
under which Nexus may legitimately originate a figure.

### On gate 5 — commercial versus operational authority

Every field is one or the other:

- **Commercial** — participates in cost, price, margin, or the customer-facing
  commercial record. Subject to pinning, snapshotting, and immutability rules.
- **Operational** — describes execution. Tracking dates, ETD/ETA, actual
  delivery, carrier reference, internal notes.

> **Operational data is never commercial authority. Operational data never
> mutates a historical commercial snapshot.**

A shipment that arrives late does not change what the customer was quoted. If
editing an operational field can alter a sent quote's economics, the
classification is wrong or the implementation is.

### On gate 7 — regression contract

The invariant, not the feature, is what gets protected. State it as a sentence
that could be falsified, then name the test that would fail if it were.

A gate-7 answer of "the feature is tested" is not an answer.

---

## §4 · Setup owns commercial structure

**Setup exclusively owns:** Products · Assemblies · Components · SKUs · Tiers.

No other surface creates, redefines, renames, or restructures them. Costs,
Pricing, and Quote **consume** commercial structure; they never author it.

If an operator working in Costs discovers they need another product, the
correct workflow is: **return to Setup.** Not: create it inline.

### Why

Commercial structure is the identity of what is being sold. Two surfaces able
to author it produce two definitions of the same product, and every downstream
consumer — costing, PDF, Sales Order, snapshot — must then decide which is
real. There is no correct answer to that question, only a chosen one, and the
choice will be made inconsistently.

The cost of the rule is a navigation step. The cost of breaking it is
structural ambiguity in the commercial record, discovered late.

### What this does not prohibit

Downstream surfaces attaching *quote-scoped* data to structure they do not own
— costs, markups, overrides, membership, freight assignment. Attachment is not
authorship.

---

## §5 · Shipment membership is evidence, not allocation

A shipment asserts:

> **These components travel together.**

It does not assert:

> ~~Allocate freight across these components.~~

### The consequence that matters

**A shipment's cost contribution enters its owning commercial product exactly
once.** Never once per member component. Membership records *which* components
were on the shipment — it is traceability, not a divisor.

An implementer who reads membership as an allocation instruction will produce
a figure that is a multiple of the correct one, and it will look plausible.

### Why this is stated as a rule rather than left to the schema

Because the schema alone permits the wrong reading. A junction table between a
shipment and N components is structurally identical whether it means "these
travelled together" or "divide across these." Only this rule distinguishes
them. The schema carries an inline comment to the same effect; this is its
governing statement.

---

## §6 · Manual and imported workflows converge

Where a subsystem will eventually support import from an external artifact,
manual entry and import **converge on the same persistence model.**

**There is no import-only schema.** There is no manual-only schema.

Freight is the worked example. V1 is manual worksheet entry. V2 will support
uploading the Straight Forwarding workbook. Both write the same tables, the
same grains, the same provenance fields. Import populates what an operator
would otherwise type.

### Why

A parallel import schema forces every downstream consumer — costing,
snapshot, PDF, Sales Order — to handle two shapes, and guarantees the two
drift. Convergence costs more design effort once and removes an entire class of
divergence permanently.

### The design obligation this creates

When building the manual path, model the fields the *external artifact* has,
not merely the fields the current form needs. Per-field provenance (`source`,
`field_provenance`) exists so an imported value and a typed value are
distinguishable without being structurally separate.

---

## §7 · Data traceability

Every operator-entered commercial field has a documented path through:

```
Persistence → Costing → Cost Stack → Pricing → Customer View
   → PDF → NetSuite → Snapshot → Clone → Revision → Regression
```

**No orphaned commercial fields are permitted.** A field that is captured but
reaches no consumer is either dead weight or an unfinished feature; both need
to be named as such.

The governing standard for field ownership across system boundaries is
[`architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md`](architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md).
Its central rule is worth repeating here:

> A field being technically writable does not establish Nexus ownership.

---

## §8 · Snapshot, clone, and revision

Every subsystem holding commercial data specifies its behaviour at three
moments. Gate 6 is not complete until all three are answered.

| Moment | Question |
|---|---|
| **Send** | Which values freeze? Where is the frozen copy? Can the live value drift from it? |
| **Clone** | Which values copy, which reset, which are inherited from the target context? |
| **Revision** | Which values carry forward? What supersedes rather than overwrites? |

Two established mechanisms:

- **Draft-lock** — mutation actions assert the quote is not frozen; immutability
  is held by convention plus a guard rather than by versioned columns
- **Explicit snapshot** — a complete immutable copy written at send, with no
  foreign keys back to mutable draft records

The freeze inventory is [`pattern-52-freeze-list.md`](pattern-52-freeze-list.md).
Any new column subject to freezing is added there.

---

## §9 · Design Authority and source-first implementation

Where authoritative implementation artifacts exist — JSX, CSS, component
hierarchy, interaction documents — **they are executable specification, not
reference material.**

### The rule

> **Assemble. Do not reinterpret.**

- Read the supplied JSX. Read the supplied CSS. Assemble those artifacts.
- Do **not** implement from screenshots.
- Do **not** implement from prose descriptions of the design.
- Class names come from the source. Nesting comes from the source. Geometry
  comes from the source.
- Local adaptations live in a separate overrides file, never edited into the
  canonical source.
- **Screenshot comparison is the final acceptance step, not the implementation
  strategy.**

### Why this became a rule

An earlier freight implementation was instructed to "follow the design." It
produced correct persistence, correct CRUD, and correct business behaviour —
and reproduced the *concept* of the worksheet rather than its *implementation*.
The result diverged in hierarchy, typography, spacing, and nesting, and carried
an invented parallel class grammar alongside the canonical one.

Both properties are required and they are independently verifiable:

- **Business correctness** — the behaviour is right
- **Design fidelity** — the assembled DOM matches the source

Passing one does not indicate the other. A subsystem is not complete until both
hold.

### When the bundle conflicts with business authority

Stop. Identify the contradiction. Name both authorities. Do not invent a
reconciliation. Business authority (tier 1) outranks the bundle (tier 3), but
the *resolution* is a business decision, not an implementation choice.

### Approved deviations

Where a business disposition requires departing from the bundle, the departure
is recorded as an **approved deviation** in that bundle's record under
`docs/design-authority/`. Deviations are enumerated and attributed. An
undocumented departure is drift, not deviation.

---

## §10 · Stop rather than invent

The escalation contract. When authority is absent or contradictory, produce:

1. **The decision that needs making** — stated as a question
2. **The conflicting or absent authorities** — cited by name and location
3. **The options**, with what each would cost or foreclose
4. **What evidence would settle it** — and who owns that evidence

Then stop. Record it in [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md).

**This is a deliverable, not a failure.** A recorded open decision is a
durable asset. A guess that entered the codebase is indistinguishable from a
decision six months later, and will be defended as one.

---

## §11 · Relationship to other governing documents

This standard governs **method**. It does not restate scope, business rules, or
visual specification.

| Concern | Authority |
|---|---|
| Which document governs what, right now | [`AUTHORITY_MAP.md`](AUTHORITY_MAP.md) |
| Why the architecture is as it is | [`AUTHORITY_TIMELINE.md`](AUTHORITY_TIMELINE.md) |
| What has not been decided | [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) |
| Approved business rules | [`business-validation/`](business-validation/) |
| Phase scope and sequencing | Phase specifications + [`../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md) |
| Executable visual specification | [`design-authority/`](design-authority/) |
| Platform patterns and conventions | [`../CLAUDE.md`](../CLAUDE.md) |
| What may merge | [`validation/merge-gate.md`](validation/merge-gate.md) |

---

## Amendment log

Amendments append. They do not rewrite. A subsystem built under v1.0 must
remain readable against v1.0.

| Version | Date | Change | Origin |
|---|---|---|---|
| 1.0 | 2026-08-04 | Initial standard. Records method agreed verbally between 2026-05 and 2026-08 and applied without being written down: the governing principle, five-tier precedence, eight gates, external authority, commercial/operational separation, Setup ownership, membership-as-evidence, manual/import convergence, design authority, stop-rather-than-invent. | Edward, project handover 2026-08-04 |
