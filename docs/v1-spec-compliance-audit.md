# V1 · SPEC compliance audit — charter and source inventory

**Status:** SCOPED, NOT RUN.
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

## Sources — the registered specifications

| document | lines | role |
|---|---|---|
| `docs/SPEC.md` · `docs/spec.md` | 647 each | the product specification |
| `PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md` | 726 | phase contract |
| `PHASE-2-COSTS-WORKSPACE-MULTI-SKU.md` | 688 | phase contract |
| `PHASE-3-PRICING-WORKSPACE.md` | 658 | phase contract — **closed, evidence complete** |
| `PHASE-4-MARGIN-APPROVAL.md` | — | phase contract — blocked on OD-002 |
| `CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md` | 360 | sequencing, dependencies, reversibility |
| `docs/AUTHORITY_MAP.md` | 188 | which document governs what |
| `docs/OPEN_DECISIONS.md` | 1050 | what is undecided |
| `docs/business-validation/BV-001 … BV-010` | 10 docs | business contracts |
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

## Method

1. **Enumerate** every governed requirement from the sources above, one row
   each, with its citation.
2. **Evidence** each row against implementation: a test, a verifier, a rehearsal
   record, or a code citation. **A row with no evidence is a finding**, not an
   assumed pass.
3. **Classify** each finding:
   - **release blocker** — V1 cannot ship correct or usable without it
   - **release recommendation** — ships without it; carries known risk
   - **post-V1** — real work, not a V1 obligation
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
