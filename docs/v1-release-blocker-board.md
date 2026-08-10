# V1 Release Blocker Board

**Governing artifact:** [`v1-spec-compliance-matrix.md`](v1-spec-compliance-matrix.md).
This board carries **only the six distinct release blockers**. Nothing else
belongs on it, and nothing is added to it without a matrix row.

**Work from the six. Not from the finding count.** Thirty-five findings is an
audit result; six is the release position.

---

## Two tracks, and they are not the same kind of work

| | Track A | Track B |
|---|---|---|
| **Blockers** | REG-2 · OD-002 | REG-4 · OD-004 · OD-005 · P1-014 |
| **Nature** | **Business governance** | Engineering + evidence |
| **Gate** | A disposition | A walk against a real provider |
| **Engineering may begin** | **No — not until the approval model is dispositioned** | Yes |

**Track A is not an implementation backlog item.** REG-2 names a commercial
control that requires a business decision about who may authorise a below-floor
sale. No amount of engineering readiness advances it, and starting engineering
before the model is settled would build a mechanism against five unanswered
questions.

**Track B is one workstream with one evidence objective**, carrying five
identifiers: **REG-3 · REG-4 · OD-004 · OD-005 · P1-014**. Four are blockers;
REG-3 is folded in because it shares the objective exactly. They are not five
risks. They are one risk — *the accounting handoff has never been exercised
against a real NetSuite* — recorded five times in five documents.

---

## Track A · Below-floor margin approval

| | |
|---|---|
| **Blockers** | **REG-2** · **OD-002** |
| **Owner** | **Edward** (decision) · Finance / Commercial Leadership (business owner, per the register) |
| **Engineering owner** | **None assigned, deliberately.** Assigned when Track A's gate clears |
| **Governing evidence** | [`BV-005-below-floor-margin-approval.md`](business-validation/BV-005-below-floor-margin-approval.md) · [`PRODUCTION_READINESS_REGISTER.md`](business-validation/PRODUCTION_READINESS_REGISTER.md) gate 2 · [OD-002](OPEN_DECISIONS.md) · [`PHASE-4-MARGIN-APPROVAL.md`](../PHASE-4-MARGIN-APPROVAL.md) |
| **Corroborating rows** | BV003-002 · BV005-001 · SPEC-018 · P4-001…P4-015 (all roll up here) |

### The gate — five business questions, all from OD-002

None is an engineering question. All five are prerequisites to a brief, not
outputs of one.

1. What governed list or permission identifies **Commercial Approvers**?
2. Who owns **membership**, and who are the **initial approvers**?
3. Is **self-approval** allowed?
4. Is **one approval sufficient**?
5. Is **Slack availability required for launch**?

### Completion evidence — what would close REG-2

- **OD-002 closed** with an amended BV-005 recording all five answers.
- A governed approver list exists and is the authorisation model — **not**
  channel membership.
- Phase 4's H8 demonstrated: **an unauthorised Slack response cannot approve.**
  The register's own wording is that *Slack failure never approves*.
- H2/H3/H12 demonstrated: any change to the approved commercial state voids the
  approval, **including one that improves the margin**.
- A **rollback runbook** exists (XP-011). Slack messages cannot be recalled; this
  is the first phase where undoing the deploy is insufficient.

### Current exposure, stated plainly

**Today an accepted quote can sit below floor with no approval at all.** Three
independent governing documents record this gap — the register, BV-003's
ownership gaps, and SPEC §13.5, the oldest dating to April. It is the only
blocker on this board that is a live commercial control rather than a missing
proof.

---

## Track B · Accounting handoff — one evidence objective

| | |
|---|---|
| **Blockers** | **REG-4** · **OD-004** · **OD-005** · **P1-014** |
| **Folded in** | **REG-3** — same objective, recommendation disposition |
| **Owner** | **Nexus engineering** · Accounting / Finance (business) · **NetSuite administrator** (required — the walk cannot happen without one) |
| **Governing evidence** | [`PRODUCTION_READINESS_REGISTER.md`](business-validation/PRODUCTION_READINESS_REGISTER.md) gates 3 and 4 · [OD-004](OPEN_DECISIONS.md) · [OD-005](OPEN_DECISIONS.md) · [`PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md`](../PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md) H10/H11/H14 · [`BV-003-master-data-ownership.md`](business-validation/BV-003-master-data-ownership.md) |
| **Corroborating rows** | P1-011 · SPEC-020 — same objective; both close when the walk lands |

### The objective — one sentence

> **Exercise the complete accepted-to-Sales-Order handoff against a real
> NetSuite, once, and record what it did.**

Everything below is a property of that walk. It is one procedure, not five.

### The four blockers, and what each needs from it

| ID | What is missing | What the walk must show |
|---|---|---|
| **OD-004** | The **applicability datum** — which business value determines detailed items vs Item Group vs finished-good Assembly | The datum named and read from a real record. **This is an input, not an output** — the walk cannot compute applicability until it exists |
| **OD-005** | HubSpot Product `price` → NetSuite Base Price propagation, untested across the node boundary | A controlled create/read-back proving a **`$0.00` catalogue placeholder never becomes the commercial price** at either node |
| **REG-4** | Item Group creation, reuse and member-rate pricing | Applicable completion creates **or reuses one deterministic group**, uses it once, and **preserves the accepted commercial total** |
| **P1-014** | That no unresolved cost reaches a real NetSuite | Completion rejects unresolved cost **before any external write**. The send-side half is already proven (P1-004); the ERP boundary is not |

### Also closed by the same walk

| ID | Disposition | What it needs |
|---|---|---|
| **REG-3** | Recommendation, folded | Convergence under **real response-loss and real concurrency**. The key is stable and prior-success is checked; only the proof is absent |
| **P1-011** | Recommendation | Two simultaneous completions reach the same Sales Order |
| **SPEC-020** | Recommendation | Existing HubSpot → NetSuite sync continues without regression |

### Sequencing within the track

**OD-004 first.** It is the only item that is an input rather than a
measurement. Applicability cannot be walked before the datum that determines it
exists, so scheduling the walk before OD-004 closes would produce a walk that
cannot answer REG-4.

### Completion evidence — what closes Track B

A single recorded rehearsal, in the shape of R1: **run, not argued.** It names
the NetSuite environment, the quote walked, the datum read, the group created or
reused, the amount pushed, the response-loss and concurrency behaviour observed,
and the read-back proving no `$0.00` reached a commercial field.

**One artifact closes five identifiers.** That is why they are one workstream.

---

## Everything else — off this board

Reclassified from the matrix's 35 findings. **These do not gate release.**

| bucket | count | rows |
|---|---|---|
| **Release recommendation** | 8 | P1-011 · P2-013 · OD-009 · OD-012 · OD-013 · OD-015 · OD-016 · SPEC-020 |
| **Post-V1** | 9 | XP-011 · BV003-003 · BV006-003 · OD-006 · OD-008 · OD-010 · OD-011 · OD-017 · OD-020 |
| **Specification maintenance** | 8 | BV004-002 · BV009-001 · OD-001 · OD-019 · AM-002 · AM-003 · AM-004 · SPEC-021 |

**Specification maintenance is new**, and it is where every *specification
drift* row went. These are documents to correct, not code to change — and
correcting them is cheap, unblocked, and independent of both tracks. Two of
them are load-bearing for anyone reading the repository cold:

- **AM-002 / AM-003** — AUTHORITY_MAP and README both still say Phase 3 is
  *"Not started."* It closed on 2026-08-10.
- **OD-019** — still filed under *Blocking* with *"Phase 3 does not close
  without it"*, though the `ratio` node kind cites it by name and BV-010 defines
  the quantity.

Arithmetic: 9 blocker-disposition rows + REG-3 folded + 8 + 9 + 8 = 35. Every
finding has a home.

### Specification maintenance — status

Corrected 2026-08-10, independently of both tracks. Documents only; no code,
no Pricing, no Phase 3.

| row | action | status |
|---|---|---|
| **AM-002** | AUTHORITY_MAP: Phase 3 → *Closed for implementation 2026-08-10*; Phase 4 no longer blocked on Phase 3; reconcile date advanced | **Closed** |
| **AM-003** | README: same two rows | **Closed** |
| **OD-019** | Marked **SETTLED 2026-08-07**, body retained in place (it is why the graph has a `ratio` kind and not a `margin` one), Closed-table row added | **Closed** |
| **BV004-002** | Pricing Vendor row closed; below-floor and Item Group rows now cite REG-2/REG-4 and their gating ODs; *gross margin* now cites BV-010 | **Closed** |
| **SPEC-021** | SPEC §12 marked **HISTORICAL** in place, pointing at OPEN_DECISIONS as the live register | **Closed** |
| **AM-004** | Recorded in the charter: the next audit's baseline starts from AUTHORITY_MAP's governing set, not a hand-assembled list. **The freeze was not widened** | **Closed as recorded** |
| **OD-001 / BV009-001** | **Not closable by document edit.** BV-009 needs *ratification* — a business act, Edward's. Production code ships on an unratified rule, and Phase 1 and Phase 3 both cite it to place costing arithmetic out of scope | **Open — awaiting ratification** |

**Five closed, one recorded, one escalated.** OD-001 is deliberately not
"fixed": writing a ratification into the file would manufacture the authority
the row exists to report as missing.

One correction landed while doing this, and it is worth naming because it is a
real sequencing fact rather than a typo: **Phase 3 shipped ahead of Phase 2
operator acceptance, not after it.** The old AUTHORITY_MAP row recorded that
dependency; the new one records that it was not met.

---

## Amendment protocol

**The matrix is not re-run.** Closing a blocker updates the affected rows and
nothing else.

1. Land the completion evidence as a recorded artifact.
2. Update **only** the affected matrix rows — verdict, disposition, evidence.
3. Note the amendment against the row's ID. IDs are append-only and never
   reused, so an amended row keeps its identifier and its history stays
   citable.
4. Update this board's track status.

**Do not reopen completed rows.** A row closed against the frozen baseline stays
closed unless a blocker's evidence contradicts it.

**Pricing Phase 3 remains closed.** No blocker on this board reaches it: Track A
extends surfaces Phase 3 built without changing them, and Track B is downstream
of acceptance. Phase 3 reopens only if a blocker's evidence explicitly requires
it.

---

## Independence — what may proceed now

| workstream | |
|---|---|
| **Microsoft OAuth** | **Proceed.** Confirmed independent — it changes who may enter, not what any number means |
| **Pre-launch cleanup** | **Proceed, conditionally** — touching no Track A or Track B surface and no S-7 input |
| **Comprehensive CB suite** | **May begin; cannot complete.** It cannot be comprehensive while REG-2's surfaces do not exist. Beginning it is nonetheless the useful move: it is what converts P1-011, P1-014 and SPEC-020 from *insufficient evidence* to a verdict |
| **Specification maintenance** | **Proceed.** Documents only; independent of both tracks |

---

## Board status

| Track | Blockers | Status |
|---|---|---|
| **A · Below-floor approval** | REG-2 · OD-002 | **Awaiting business disposition.** Engineering not started, by instruction |
| **B · Accounting handoff** | REG-4 · OD-004 · OD-005 · P1-014 *(+REG-3)* | **Open.** OD-004 first; the walk requires a NetSuite administrator |

**Six distinct blockers. Zero closed.**
