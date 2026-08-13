# V1 · SPEC compliance audit — charter and source inventory

**Status:** **COMPLETE.** Baseline frozen · convention set · ID scheme frozen ·
enumeration executed in one pass. **The matrix is
[`v1-spec-compliance-matrix.md`](v1-spec-compliance-matrix.md)** — 136 rows,
35 findings, 6 distinct release blockers. This document remains the charter and
the immutable reference set; it is not restated there.
**Baseline:** `main` @ **`024d2316f5881601a7a408ed8f2e79c9a3d1cf82`**, 2026-08-10.
**Nature:** release-risk **discovery**. Not an implementation exercise, and no
finding in it proposes an implementation.

---

## Why this document exists rather than a partial matrix

A compliance matrix is read as complete. A matrix with a third of its rows
filled and no marker saying so is worse than no matrix, because it converts
"not yet examined" into "examined and fine" — which is precisely the failure
this project has already paid for once, when a wrong test runner produced a
persistent, plausible-looking "12 pre-existing failures" that was reported
across several turns.

So this is the charter and the source inventory. The matrix is the next
session's deliverable, and it starts from here.

## Frozen baseline

Every finding in this audit is evaluated against **this reference set and no
other**. A source that changes after this point does not retroactively alter a
finding; it invalidates the row, and the row is re-run.

**Repository:** `main` @ `024d2316f5881601a7a408ed8f2e79c9a3d1cf82`
(2026-08-10, PR #259 merged).

### Specifications in scope

| document | blob | lines | last changed |
|---|---|---|---|
| `docs/SPEC.md` | `875cd0e` | 647 | 2026-07-29 |
| `PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md` | `e67398c` | 726 | 2026-08-06 |
| `PHASE-2-COSTS-WORKSPACE-MULTI-SKU.md` | `20fb29c` | 688 | 2026-08-06 |
| `PHASE-3-PRICING-WORKSPACE.md` | `e47eae8` | 658 | 2026-08-06 |
| `PHASE-4-MARGIN-APPROVAL.md` | `65c980f` | 698 | 2026-08-06 |
| `CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md` | `5fa5ac4` | 360 | 2026-08-10 |
| `docs/AUTHORITY_MAP.md` | `7088f57` | 188 | 2026-08-05 |
| `docs/OPEN_DECISIONS.md` | `ef2f1b8` | 1050 | 2026-08-09 |

### Production Readiness Register

| document | blob | lines | last changed |
|---|---|---|---|
| `PRODUCTION_READINESS_REGISTER.md` | `cec6ac4` | 81 | 2026-07-31 |

### Business Validation contracts

| document | blob | lines | last changed |
|---|---|---|---|
| `BV-001-pricing-vendor-identity.md` | `155be97` | 139 | 2026-07-31 |
| `BV-003-master-data-ownership.md` | `77bb483` | 63 | 2026-07-30 |
| `BV-004-business-decision-matrix.md` | `3c7ec13` | 63 | 2026-07-30 |
| `BV-005-below-floor-margin-approval.md` | `2a349f1` | 159 | 2026-07-30 |
| `BV-006-product-structure-contract.md` | `2987740` | 380 | 2026-07-31 |
| `BV-007-product-setup-workflow.md` | `446ca38` | 499 | 2026-07-31 |
| `BV-008-commercial-product-transition.md` | `88dc6d4` | 382 | 2026-07-31 |
| `BV-009-freight-treatment.md` | `1a66b07` | 209 | 2026-08-05 |
| `BV-010-blended-margin-definition.md` | `c11735a` | 123 | 2026-08-09 |

**Nine BV documents. BV-002 does not exist** -- the sequence runs 001, 003-010.

### The baseline is narrower than the governing set — recorded, not repaired

**AM-004.** Discovered during enumeration and deliberately **not** used to widen
the freeze. These documents govern and were not frozen:

`NEXUS_IMPLEMENTATION_STANDARD.md` (**tier 1** — outranks every per-phase
authority row) · `validation/merge-gate.md` · `validation/operational-runbook.md`
· `validation/VALIDATION_PRINCIPLES.md` + ADRs 004–012 ·
`slice-13/GO_LIVE_READINESS_CHECKLIST.md` ·
`production-bugs/PRODUCTION_BUG_REGISTER.md` ·
`architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md` ·
`pattern-52-freeze-list.md` · `phase-2-freight-dom-parity-audit.md` (tier 2) ·
`design-authority/` bundles.

A baseline that moves during an audit is not a baseline, so this was evaluated
as a finding against the audit's own scope rather than closed by expanding the
freeze. **The next audit's baseline should start from the AUTHORITY_MAP's
governing set rather than from a hand-assembled document list** — the map
already enumerates it, which is what made the gap visible.

### Two observations from freezing, carried as candidate rows

Neither is a finding, and **neither is resolved here.** Freezing is not
auditing. They are recorded now so they are not rediscovered as surprises
mid-matrix, and they **enter the matrix as rows like any other** — the completed
audit assigns each a verdict and, if it is a finding, a classification of
implementation defect, specification drift, or **repository governance** (a
third category these two raise: a condition of the repository itself rather than
of the code or of a specification's content).

**B-1 . `docs/spec.md` and `docs/SPEC.md` are ONE file.** Git tracks exactly one
path, `docs/SPEC.md`; the lowercase form is the same file surfaced by a
case-insensitive filesystem. On a case-sensitive checkout -- CI, or a Linux
contributor -- a second file could be created at the other path and neither
would shadow the other. Whether that matters is a matrix question.

**B-2 . OD-001 is titled "BV-009 does not exist", and BV-009 exists**
(`1a66b07`, 209 lines, freight treatment, last changed 2026-08-05). Either the
OD is stale and should close, or it cites something specific that resolves to
nothing while the document itself is present. That is the specification-drift
versus implementation-defect distinction in its purest form, on the very first
row -- and it is drift if the OD is simply out of date.

## Sources — the registered specifications

| document | lines | role |
|---|---|---|
| `docs/SPEC.md` | 647 | the product specification — one tracked path; see **B-1** |
| `PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md` | 726 | phase contract |
| `PHASE-2-COSTS-WORKSPACE-MULTI-SKU.md` | 688 | phase contract |
| `PHASE-3-PRICING-WORKSPACE.md` | 658 | phase contract — **closed, evidence complete** |
| `PHASE-4-MARGIN-APPROVAL.md` | 698 | phase contract — blocked on OD-002 |
| `CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md` | 360 | sequencing, dependencies, reversibility |
| `docs/AUTHORITY_MAP.md` | 188 | which document governs what |
| `docs/OPEN_DECISIONS.md` | 1050 | what is undecided |
| `docs/business-validation/BV-001 … BV-010` | **9 docs** — BV-002 absent | business contracts |
| `docs/business-validation/PRODUCTION_READINESS_REGISTER.md` | 81 | **the V1 gate register** |

## The spine — and the first thing the audit must not do

**A V1 gate register already exists**, with four gates carrying claimed
statuses:

| gate | claimed status |
|---|---|
| 1 · Pricing Vendor identity | **V1 COMPLETE** |
| 2 · Below-floor margin approval | business contract approved, **implementation open** |
| 3 · Idempotent Sales Order send | integrity contract confirmed, **implementation open** |
| 4 · Item Group applicability and pricing | ownership settled, **closure open** |

The audit's job is to **verify these claims against implementation**, not to
restate them. A status in a register is a claim; the audit is the evidence for
or against it. Three of the four are already self-reported as open, which makes
gate 1 — the one claiming completion — the highest-value single row in the
matrix.

## Audit IDs — assigned before evaluation, never reused

Every requirement row carries a stable ID, assigned at enumeration and fixed
before any verdict is reached. **Findings, discussions and later corrections
cite the ID, never the row position**, so inserting a requirement later cannot
renumber a finding that has already been discussed.

| block | source |
|---|---|
| `REG-1 … REG-4` | the four Production Readiness Register gates |
| `SPEC-nnn` | `docs/SPEC.md` |
| `P1-nnn` `P2-nnn` `P3-nnn` `P4-nnn` | the four phase contracts |
| `XP-nnn` | `CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md` |
| `AM-nnn` | `docs/AUTHORITY_MAP.md` |
| `BV001-nnn … BV010-nnn` | the business validation contracts |
| `OD-nnn` | `docs/OPEN_DECISIONS.md` — **the document's own numbering** |
| `B-n` | observations raised by freezing the baseline |

Two rules make the IDs stable rather than merely present:

1. **Where a source already carries its own identifier, the audit ID embeds it**
   rather than inventing a parallel number. OD-012 is `OD-012` in this matrix,
   not `AUD-047`. A second identifier for the same object is a second thing to
   keep in sync.
2. **Numbering is append-only within a block.** A requirement discovered later
   takes the next free number in its block; it is never inserted into the middle
   of the sequence, and no ID is ever reused, even if a row is withdrawn. Order
   in the table may change. An ID may not.

## Audit convention — every row ends in exactly one verdict

Fixed before enumeration begins, so the vocabulary is not invented row by row
while the matrix is being written.

| verdict | means |
|---|---|
| **Satisfied** | implementation evidence supports the requirement |
| **Unsatisfied** | implementation **contradicts** the requirement |
| **Insufficient evidence** | no acceptable implementation evidence was found |
| **Specification drift** | the specification set is internally inconsistent or stale |
| **Out of scope** | explicitly excluded from V1 |

Exactly one. Not two, not a hedge, not a blank.

**"Insufficient evidence" is never collapsed into "Unsatisfied."** They are
different claims about the world and they carry different remediation.
*Unsatisfied* asserts the code was examined and does the wrong thing — it names a
defect. *Insufficient evidence* asserts only that the audit could not find proof
either way; the requirement may well be met. Collapsing the second into the first
manufactures defects, and collapsing it the other way — into *Satisfied* — is the
failure this whole exercise exists to avoid. The honest verdict is its own value
precisely because it is the one that is uncomfortable to record.

A row may be **Satisfied** and still carry a note. A note is not a verdict.

### The second axis — disposition, and only for findings

The verdict says what the audit found. The **disposition** says what release
should do about it, and applies only to rows whose verdict is *Unsatisfied*,
*Insufficient evidence* or *Specification drift*:

- **release blocker** — V1 cannot ship correct or usable without it
- **release recommendation** — ships without it; carries known risk
- **post-V1** — real work, not a V1 obligation

*Satisfied* and *Out of scope* rows take no disposition. Keeping the two axes
separate is what stops "we have no evidence" from silently becoming "it is fine"
on its way through the table.

## Method

1. **Enumerate** every governed requirement from the sources above, one row
   each, with its citation.
2. **Evidence** each row against implementation: a test, a verifier, a rehearsal
   record, or a code citation. **A row with no evidence is a finding**, not an
   assumed pass.
3. **Verdict, then disposition**, per the convention above.
4. **Distinguish drift from defect.** Specification drift is the spec no longer
   describing what was deliberately decided; an implementation defect is the
   code not doing what the spec still says. They read alike in a matrix and are
   remediated in opposite directions — one amends a document, the other changes
   code.
5. **Propose nothing.** A finding names the gap and its disposition. The fix is
   a later decision.

## What is already evidenced, and can be cited rather than re-derived

Phase 3 closed with its evidence intact. These do not need re-running:

| | evidence |
|---|---|
| Phase 3 Pricing | `docs/rehearsals/phase-3-release-readiness.md` — gates, journey, sticky/scroll |
| Rollback after first Apply · OD-003 | `R1-rollback-after-first-apply.md` — outcome `ignores`, settled |
| Identity-resolution parity · R2 | 137/137 both directions |
| Staged-versus-committed · R3 | 8/8 |
| Lift persistence checklist | 11/11 |
| A-2 provenance | `a2-provenance-evidence.md` — queries proven against production, cost measured |
| R12 visual acceptance | `r12-visual-acceptance.md` — permanent `r12Visual` fixture |
| Customer View content | `v1-customer-view-content-check.md` — PASS |
| Costing preservation | S-7 `541a75a041dd1a2912d077b555fbab575750329930e3b743089ec493bae44fb2` |

## Standing evidence limits to carry into the matrix

Recorded so the audit does not silently treat them as covered:

- **NetSuite real-provider push not walked.** The validation environment runs an
  isolated provider by construction. Gates 3 and 4 of the register are exactly
  here.
- **Production performance not inferred.** All timings to date are dev-server
  cold compiles.
- **Customer View read, not proof-read.** Figures compared digit by digit;
  prose read but not spell-checked.

## Known open decisions the matrix must reach a disposition on

Not new discoveries — they are already recorded, and the audit's job is to say
whether each blocks V1:

| | |
|---|---|
| **OD-012** | `db:generate` unsafe; every migration hand-written. Guard exists by convention only |
| **OD-013** | S-7 depends on a mutable shared production database |
| **OD-016** | Setup authors commercial values nothing consumes |
| **OD-017** | Cost inputs key on `assembly_leaf_id`, blocking ASY-optional authoring |
| **OD-002** | BV-005 must be amended before Phase 4 — five unanswered questions |
| **OD-015** | S-7 does not validate the semantics of graph-only nodes |

## Independence check — required before anything else starts

The instruction is that Microsoft OAuth, pre-launch cleanup and the CB suite do
not begin until the audit completes **unless the audit proves them
independent**. That proof is a matrix output, not an assumption, and it belongs
in the first pass: an item that touches no governed commercial capability is
independent; one that could change a governed value is not.

**Initial read, to be tested rather than trusted:** Microsoft OAuth is an
authentication-boundary change with no commercial arithmetic in scope and is the
most likely of the three to prove independent.
