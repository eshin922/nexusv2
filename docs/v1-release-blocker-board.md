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

## CB suite — primary engineering activity until it has a trusted baseline

Operational view: [`validation/CB_SUITE_HEALTH.md`](validation/CB_SUITE_HEALTH.md).

**Admission criterion:** *a trusted baseline exists only when two consecutive
executions from identical clean environments produce identical outcomes.*

**BASELINE-01 established 2026-08-10** — runs A and B agree exactly: 9 pass,
10 fail, 3 unmeasured. A delta against it is now a measurement.

It is a baseline, not a clean bill of health. **No failure is classified** —
classification is step 4 and has not started. The three unmeasured scenarios
sit behind VAL-101 in one serial file, and one of them is **VAL-104, REG-1's
browser-level evidence**.

## Microsoft OAuth — operational readiness, not engineering

| step | owner | status |
|---|---|---|
| Clerk configuration — enable Microsoft as an SSO connection | **Edward** (Clerk dashboard) | Not started |
| Entra admin consent — single-tenant app, tenant-level grant | **Edward** (Entra tenant admin) | Not started |
| Validation — sign-in against the configured tenant | Edward + Nexus | Blocked on the two above |
| Rollout | Edward | Blocked |

**No engineering implementation is created unless evidence shows dashboard
configuration cannot satisfy the requirement.** The repository state supports
that position: `@clerk/nextjs` is the auth provider, and the only OAuth code in
`src/` is NetSuite's — Nexus has never hand-rolled an identity provider
integration, and Clerk's Microsoft connection is dashboard-configured.

The one recorded hazard is on the Entra side, not the Nexus side: §0.5 catch #75
records that a single-tenant app **blocked user sign-in silently** until the
tenant-level admin consent grant landed. Sequence the consent grant before
validation, or validation will fail in a way that looks like a Clerk problem.

## Track C · R12 staging contract — **P3-016**

| | |
|---|---|
| **Blocker** | **P3-016** |
| **Owner** | Nexus engineering |
| **Governing evidence** | R12 interaction contract (accepted) · [`design-authority/r12-pricing-workspace/`](design-authority/r12-pricing-workspace/BUNDLE.md) · [P3-016 record](validation/P3-016-surgical-staging-bypass.md) |
| **Completion evidence** | Eight browser proofs, listed in the record. **Six observed, two pinned by a source-level guard** — no fixture renders a global recommendation, and none reaches a refusal through a recommendation path |

**Why this is a third track rather than an item in Track B.** It is neither a
business disposition nor an accounting-handoff proof. It is an **operator
workflow that does not obey its own accepted contract**, and it is the only
blocker on this board that reopens shipped Phase 3 code.

**REPAIRED 2026-08-10, pending merge.**

The runtime observation settled the branch immediately: one click moved
`quote_tiers.tier_price_adj_pct` from `null` to `0.1334`, wrote its audit row,
and left staging untouched — a **silent immediate-write**, not an inert button.
What made it read as inert is that the below-floor headline did not clear, the
CTA removed itself, and the only confirmation anywhere was a counter
incrementing in a bar the operator was not looking at.

The second caller was classified before any code moved, and it changed the shape
of the repair: `shell:238` is the **bulk-lift** workflow — preview, apply with
`expectedPreview`, receipt-based exact undo, walked end to end by VAL-208. That
is the separately-governed workflow the repair conditions already carve out, so
the boundary is the **caller**, not the action. Both recommendation CTAs moved
onto the staging model; `applySurgicalAdj` was removed for having no other
caller; bulk lift was left exactly as it was.

**Two open consequences, recorded rather than absorbed.** Recommendation
telemetry now has no writer, and what survives is `recommended_overridden` with
no accepted counterpart — a distortion worse than absence, and a design question
rather than a line of code. And **no test presses a recommendation CTA**, in any
suite, which is what let this ship at all.

**Phase 3's closure holds elsewhere.** P3-001…P3-015 are unaffected; this is a
new row against the interaction contract, not a reopening of any completed one.

## P2-014 · Pricing Vendor store-snapshot staleness — **a cleared vendor can be silently rewritten**

Observed during the VAL-104 repair, investigated independently of it, and **not
caused by it** — it reproduces with that repair reverted.

**Reported as display staleness. It is not display-only.**

Reproduction, measured (probe, `quotes.draft` first packaging line):

| step | database | rendered |
|---|---|---|
| page load | `Validation Packaging Vendor` | vendor chip |
| select a different vendor, then **Clear** | `null` *(verified persisted)* | **`Validation Packaging Vendor`** |
| edit **markup** — an unrelated field on the same line | **`Validation Packaging Vendor`** | — |

The clear reached the database and was then **undone by an edit to a different
field**. No error, no warning, and the operator has no reason to look again.

**The value names the cause.** What comes back is the vendor the *page was
loaded with* — not the one selected, and not empty. So the resolution at
`packaging-drilldown.tsx:481-485`:

```ts
const storeVendorId =
  storeLineRow?.pricingVendorHubspotCompanyId ?? line.pricingVendorHubspotCompanyId;
```

`??` cannot distinguish **"the store has no row"** from **"the row's value is
legitimately null."** For a clearable field those are different states, and only
the first justifies falling back to the RSC prop. A cleared vendor resolves to
the page-load value, that value lands in local state, and `fireMetaSave` sends
`stateRef.current.vendorId` on the *next save of any field* — so an unrelated
edit writes it back.

`StoredPackagingRow` does carry both vendor fields (`costing-store.ts:92-93`),
and they are populated end to end, so **row presence is a sound discriminator**
and the prop is only needed before the row exists.

**A bare clear does not reproduce it.** The first probe run cleared without
selecting first and came back clean — cleared render, `null` in the row. The
preceding select is required, which is why this surfaced only in the
select→clear sequence and not in VAL-104's own path.

**Proposed repair (not applied — this is a disposition, not a fix):** fall back
on row absence rather than value nullness, at all three sites resolved this way
(`category` at `:475` and `markupPct` at `:477` share the shape and should be
audited together, though only vendor is proven affected):

```ts
const storeVendorId = storeLineRow
  ? storeLineRow.pricingVendorHubspotCompanyId
  : line.pricingVendorHubspotCompanyId;
```

**Severity recommendation — fix before V1.**

Weighing it honestly:

- **Against blocking:** not customer-visible (Pricing Vendor is internal
  provenance and sits behind the customer-view boundary); recoverable by the
  operator after a reload; needs a specific sequence, not any clear.
- **For blocking:** it is **silent data loss on a governed commercial field**,
  reached by an ordinary sequence with no reload in it, and the operator's
  evidence — the rendered chip — *agrees with the wrong value*, so nothing
  prompts them to check. Pricing Vendor is the provenance for packaging
  pricing, which Track B's accounting handoff reads.

The repair is small and local. The reason to treat it as V1 is not its size but
its signature: a write that succeeds, is confirmed, and is then reverted by an
unrelated action.

**Disposition owner: Edward.** Recorded, not repaired.

## Board status

| Track | Blockers | Status |
|---|---|---|
| **A · Below-floor approval** | REG-2 · OD-002 | **Awaiting business disposition.** Engineering not started, by instruction |
| **C · R12 staging contract** | P3-016 | **CLOSED 2026-08-10** on the recorded browser evidence. Observation taken, both callers classified, surgical+global repaired together, 714/714 unit + prebuild green, S-7 unmoved by the repair |
| **B · Accounting handoff** | REG-4 · OD-004 · OD-005 · P1-014 *(+REG-3)* | **Open — the primary release engineering blocker once the harness baseline exists.** OD-004 first; the walk requires a NetSuite administrator |

**Seven distinct blockers. One closed — P3-016, Track C.**

**P3-017 · Cost Stack drift — a new implementation item, not a blocker.**
Verified 2026-08-10 as an **incomplete implementation**, not an intentional
simplification: production renders the R6 stack, carried forward as a black-box
dependency by a brief that predates R11 and was never revisited when R11
superseded it. `Price adjustment`, `Surgical lifts`, `PM overrides`, `Unit cost`
and the reconciliation strip are absent, so the assertion the stack exists to
make is unstateable. Conclusive: `.r11-recon` has canonical CSS in the repo and
**zero JSX callers**. Presentation and information architecture — business
semantics are settled and every number shown is correct. **Restore the Design
Authority; do not invent a layout.** See
[P3-017](validation/P3-017-cost-stack-drift.md).

**Separately — S-7 fails, and the investigation is done.** Not a Pricing
regression. The delta originates **solely** from one quote: covered set
unchanged at 24, exactly one digest differs, and the global digest excluding
that quote is byte-identical on both sides. The quote is
`ZZ-VALIDATION-tier-propagation`, and its audit trail names the cause — two
`pricing_suggestion_surgical` writes 727ms apart, `null` → `0.1884` → `0.4123`.
**That is P3-016 in production**: a silent write invited a second click, and the
composition rule compounded onto its own output.

So S-7 measures software and mutable production data together and cannot
distinguish them. Recorded as **AM-005**, awaiting disposition — a release
recommendation, and a direct instance of AM-004. See
[AM-005](validation/AM-005-s7-scope.md).

| Workstream | Status |
|---|---|
| **CB suite** | **Primary engineering activity.** BASELINE-01 established; classification unlocked, not started |
| **Microsoft OAuth** | Operational readiness. Awaiting Clerk configuration and Entra admin consent |
| **Pre-launch cleanup** | Active. First item shipped: the governed seed command could not reach its own database |
| **Specification maintenance** | **Complete.** Not reopened unless future work invalidates it |
