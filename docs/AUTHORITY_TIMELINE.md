# Authority Timeline

**Purpose:** why the project's governing model is what it is, what each change
replaced, and what would justify changing it again.

This document preserves history. It does not rewrite it. Earlier decisions are
recorded as they were made and as they were superseded — because a future
reader needs to know not only what is true now, but what was tried, what failed,
and therefore which arguments have already been had.

**If you are about to propose reverting something here, read the era that
introduced it first.** Most of these changes were made because the prior
approach failed in a specific, recorded way.

---

## Era 1 · Slice-based construction — 2026-04-28 → 2026-07

**Model:** the project was built as a numbered sequence of slices, 1 through
17, each a vertical increment. Design arrived as CD rounds R1–R9. Scope lived in
per-slice briefs; fidelity lived in designer notes and prototypes.

**Why it worked:** it did. Roughly ninety percent of the current codebase was
built this way — schema, costing engine, HubSpot and NetSuite integration,
customer PDF, the store and realtime architecture. The slice model was
appropriate for construction against a known specification.

**What it produced that is still authority:** the pattern library in
`CLAUDE.md`; ADRs 004–007; the subsystem contracts under `docs/costing/`; the
Data Traceability standard. These are **tier 4** platform conventions and remain
valid.

**Why it ended:** slices sequenced *implementation*. They did not gate on
whether the business rule being implemented had been settled. Several slices
implemented a plausible reading of a rule nobody had approved, and the divergence
surfaced later as rework.

**Residue to be aware of:** slice numbering, the v1 release path, and
"before new Slice 13 feature work…" preambles are **superseded**. Where you find
them, they are historical. The four-phase model replaced them.

---

## Era 2 · Validation as a gate — 2026-07-29

**Change:** the isolated validation harness became a first-class subsystem with
a mandatory merge gate.

**What it replaced:** manual smoke testing by Edward, and per-slice smoke guides
written by the implementation agent.

**Why:** manual smoke does not scale across a codebase with a costing engine,
two external integrations, a lifecycle state machine, and immutable snapshots.
More specifically, it cannot prove *absence* — that a change did not silently
alter a historical quote's economics.

**Still authority.** [`validation/merge-gate.md`](validation/merge-gate.md) is
the sole acceptance checklist;
[`validation/operational-runbook.md`](validation/operational-runbook.md) is the
execution procedure. Core documentation deliberately does not duplicate them,
so there is exactly one place a procedure can be wrong.

**What would reopen it:** the harness becoming slower to run than the defects it
catches cost. Not currently true.

---

## Era 3 · Business Validation before implementation — 2026-07-30 → 2026-07-31

**Change:** the [`business-validation/`](business-validation/) library was
established. Business requirements, invariants, and data integrity are settled
*before* architecture and implementation.

**What it replaced:** business rules inferred from briefs, or from the existing
code's behaviour.

**Why:** the failure it prevents is specific — a technical capability being
mistaken for an architectural right. *"A field being technically writable does
not establish Nexus ownership."*

**Still authority.** BV-001, 003–008 are approved; BV-006 is frozen. BV-002 is
intentionally unassigned.

**Known defect from this era:** **BV-009 was cited before it was written, and
was never written.** See [`business-validation/BV-009-freight-treatment.md`](business-validation/BV-009-freight-treatment.md)
and [OD-001](OPEN_DECISIONS.md). The lesson generalises: an identifier is not a
document, and citing one creates the appearance of authority without the
substance.

---

## Era 4 · Four phases replace slices — 2026-08-03

**Change:** work reorganised into four independently deployable phases:

| Phase | Scope |
|---|---|
| 1 · Quote Commercial Integrity | Immutable pins; a sent quote means what it meant when sent |
| 2 · Costs Workspace | Every cost entry point on one page |
| 3 · Pricing Workspace | Compliance grid, traceability, staged adjustment |
| 4 · Margin Approval | Governed below-floor exception |

**What it replaced:** the numbered slice sequence and the v1 release path.

**Why:** phases are organised around **business outcomes with independent
reversibility**, not implementation increments. Each carries its own governing
authority, its own rollback position, and an explicit statement of what to do
when authority conflicts. A slice said *what to build next*; a phase says *what
must be true, on whose authority, and how to undo it*.

**The dependency structure is deliberately minimal:** exactly one hard release
dependency — Phase 4 requires Phase 3. Everything else is coupled only by
contract. Phase 3 needs Phase 1's *contract* (pinned settings) but not its
release.

**Reversibility is not uniform, and this is the property phases exist to make
visible:**

| Phase | Point of no return |
|---|---|
| 1 | None — writes no external data |
| 2 | None — rendering only |
| 3 | First Apply — **unresolved**, see [OD-003](OPEN_DECISIONS.md) |
| 4 | First request sent to Slack — **not cleanly reversible** |

**Still authority.** Phase 1 is frozen and shipped. Phase 2 is in progress.
Phases 3 and 4 are specified and not started.

---

## Era 5 · Record, do not recreate — 2026-08

**Change:** the governing principle became:

> Nexus records what the operator determined. It does not recreate the
> operator's reasoning.

**What it replaced:** an implicit assumption that Nexus should compute anything
it had the inputs to compute.

**Why — the freight case.** The original freight implementation allocated cost
across components using CBM proportions. It was arithmetically defensible and it
was wrong: Logistics does not allocate that way. Logistics reads a number from a
forwarder's workbook and assigns it. Nexus had built a **second costing engine**
whose answers diverged from the authoritative one.

The insight that generalised: reconciling two engines is unbounded work.
Recording one determination is bounded work.

**What it changed beyond freight:** Item Groups, Phase 1 commercial integrity,
and the planned Raw Materials and OCR work all now record rather than derive.

**Consequence — external authority became a gate.** For every subsystem:
*what external business artifact already exists?* Freight → forwarding workbook.
Packaging → vendor quote. Raw Materials → supplier quotation. Pricing → customer
negotiation. Accounting → NetSuite. Nexus digitizes the workflow around the
artifact rather than inventing a replacement.

**What would reopen it:** a subsystem with no external authority and no operator
determination, where Nexus must originate the figure. That is legitimate and
requires an explicit business disposition naming Nexus as the authority.

**Recorded in:** [`NEXUS_IMPLEMENTATION_STANDARD.md`](NEXUS_IMPLEMENTATION_STANDARD.md) §1, §3.

---

## Era 6 · Freight redesign — 2026-08-03 → 2026-08-04

**Change:** the freight business model was replaced outright.

| | Abandoned | Current |
|---|---|---|
| Structure | Leg → Component → Tier | **Subcategory → Destination Candidates → Quantity Breaks** |
| Cost basis | CBM-proportional allocation | **Operator-determined amount, recorded once** |
| Authority | Nexus's own model | The Straight Forwarding workbook |

**Why the shape changed too.** The worksheet's structure is not a UI preference
— it is what Logistics actually works with. A subcategory is a shipment; a
destination is a *candidate* being compared; a break is a quantity tier. The
prior leg/component/tier model had no concept of comparing destination
candidates, which is a routine part of the real workflow.

**Rules that came with it:**

- **Shipment authority** — freight belongs to a commercial product; commercial
  structure is owned exclusively by Setup
- **Membership is evidence, not allocation** — a shipment asserts *these
  components travel together*; contribution enters the owning product **once**,
  never once per component
- **Customs V1** — invoice-entered Duty and Tariff only
- **Tracking is operational** — never commercial authority, never mutates a
  historical snapshot
- **V1 manual / V2 import converge** on one persistence model; no import-only
  schema

**Migration record:** `0053_phase_2_component_freight_expand` →
`0054_phase_2_freight_authority_cutover` →
`0055_phase_2_worksheet_freight_expand` →
`0056_phase_2_worksheet_freight_snapshots`. The `authority_cutover` migration is
where the abandonment is visible in the schema.

**The abandoned model's documentation** is archived at
[`_archive/CUSTOMS_AND_FREIGHT.md`](_archive/CUSTOMS_AND_FREIGHT.md). Retained
as history; **not** a valid implementation reference.

---

## Era 7 · Design Authority — 2026-08-04

**Change:** where authoritative implementation artifacts exist — JSX, CSS,
component hierarchy — they are **executable specification**. Assemble; do not
reinterpret.

**What it replaced:** instructing the implementation agent to "follow the
design," with screenshots and prose as the working reference.

**Why — the second freight lesson.** The freight implementation produced correct
persistence, correct CRUD, and correct business behaviour, and reproduced the
*concept* of the worksheet rather than its *implementation*. It approximated the
supplied CSS instead of using it. The result diverged in hierarchy, typography,
spacing and nesting, and carried an invented parallel class grammar alongside
the canonical one.

The distinction that came out of it:

> **Business correctness and design fidelity are independent properties. Both
> are required. Passing one does not indicate the other.**

**Consequence — operator review became tier 2 authority, above the bundle.**
This is the subtlest change in this document. Operator findings are not defects
against the design; they carry information the design's author did not have, and
they **refine the bundle itself**. See
[`NEXUS_IMPLEMENTATION_STANDARD.md` §2](NEXUS_IMPLEMENTATION_STANDARD.md).

**Consequence — the Design Authority Matrix was voided.** It marked all thirteen
freight rows PASS. It recorded *engineering completion*, self-certified before
operator validation. Operator review superseded it. The current gap list is
[`phase-2-freight-dom-parity-audit.md`](phase-2-freight-dom-parity-audit.md).

**What would reopen it:** a project where no design source exists. Then prose and
screenshots are all there is, and the rule is inapplicable rather than wrong.

---

## Era 8 · Documentation authority remediation — 2026-08-04

**Change:** implementation paused. The repository was made the authoritative
record of the project.

**Why:** the code had outpaced the durable documentation. Eras 5, 6 and 7 were
agreed verbally, applied consistently, and never written down. The repository
contained the *results* of a method it did not contain. The design bundles
governing two phases were untracked ZIPs plus extractions inside a gitignored
directory shared with disposable build caches.

The test applied: **could another engineer clone this repository in six months
and reach the same architectural conclusions without conversation history?**
Before this era, no.

**What was created:**

| Document | Answers |
|---|---|
| [`NEXUS_IMPLEMENTATION_STANDARD.md`](NEXUS_IMPLEMENTATION_STANDARD.md) | On whose authority may I build? What must be true first? What on conflict? |
| [`AUTHORITY_MAP.md`](AUTHORITY_MAP.md) | Which document governs this, right now? |
| `AUTHORITY_TIMELINE.md` *(this file)* | Why is it this way? What would change it? |
| [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) | What is not decided, who decides, what settles it? |
| [`design-authority/`](design-authority/) | What is the executable design source, verifiably unmodified? |
| [`business-validation/BV-009-freight-treatment.md`](business-validation/BV-009-freight-treatment.md) | What did the missing contract say? *(unratified)* |

**What was preserved unchanged:** all historical slice communications, audit
findings, per-slice verification records, and design prototype rounds. History
is not rewritten. Superseded documents are **marked**, not deleted — a reader
who follows an old citation must land somewhere that explains what replaced it.

**What would reopen it:** the same test failing again. It will, eventually —
method keeps evolving. The remedy is to amend the standard's amendment log and
add an era here, not to let the gap reopen silently.

---

---

## What comes after V1

Recorded here so the sequence after the four phases is not conversation-only
knowledge.

### V1 · The four phases

Phase 1 (shipped) → Phase 2 (in progress) → Phase 3 → Phase 4, then production
go-live per [`slice-13/GO_LIVE_READINESS_CHECKLIST.md`](slice-13/GO_LIVE_READINESS_CHECKLIST.md).

### Beta

Before operators use Nexus in anger, the enhancements in
[`V1_BETA_READINESS.md`](V1_BETA_READINESS.md) must land — currently
**V1-BETA-001**, in-app bug reporting with governed diagnostic context. Beta is
the first time the tool meets people who did not build it; without in-app
reporting, findings arrive as conversation and are lost when it ends.

### V1.5 · Raw Materials

**Current placeholder. Disposition: implement after V1.**

Raw Materials will follow **the same engineering methodology established by
Freight** — the eight gates, external authority identified first (supplier
quotation), record rather than derive, design bundle as executable
specification, manual/import convergence.

This is a deliberate statement, not a default. Freight is the worked example of
the method precisely so that the next subsystem does not have to rediscover it.
An engineer opening Raw Materials should read
[`NEXUS_IMPLEMENTATION_STANDARD.md`](NEXUS_IMPLEMENTATION_STANDARD.md) and
Era 5–7 above before writing anything.

### Beyond

Two directions are recorded but not scheduled: **OCR** of external artifacts
(same record-don't-recreate posture) and the **Operations wrapper** — a
cross-quote orchestration layer above the per-quote flow. Operations is
explicitly **not V1 scope**; see [`UX_BACKLOG.md`](UX_BACKLOG.md) and the
Operations section of [`../CLAUDE.md`](../CLAUDE.md) for the scope inventory.

---

## Reading the eras against each other

| If you are... | Read |
|---|---|
| Implementing anything | Era 5, 7 — the two that most often decide whether work was correct |
| Touching freight | Era 6, then the parity audit |
| Touching pricing or approval | Era 4 for reversibility, then the R12 bundle |
| Wondering why a doc is stale | Era 1 — most stale docs are slice-era residue |
| Proposing a process change | Era 8 — and add an era rather than editing one |
