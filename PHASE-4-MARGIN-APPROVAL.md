# Phase 4 — Margin Approval

**Status:** implementation specification · awaiting approval
**Author:** CA
**Date:** 2026-08
**Phase:** 4 of 4 · independently deployable · **not cleanly reversible — see Rollback**

---

## Success Criteria

**Business** — below-floor business becomes possible through a governed
exception rather than an off-system conversation, and the firm can prove what
was approved, by whom, and at what price.

**Implementation** — approval and margin are independent axes. An approval is
pinned to a commercial set and voids when that set changes. No response
approves without signature verification, sender authorisation and request
correlation.

**Operator** — a PM knows what happens next when they request, an approver can
decide without opening Nexus, and **asking for approval is harder than fixing
the price.**

---

## Objective

**Give DPS a governed way to sell below the margin floor.**

Below-floor business is permitted — but only through an explicit commercial
exception with a named approver, a recorded reason, and an audit trail. Today
the floor is a hard block with no path through, and the exception happens in
conversations Nexus never sees.

**Success is a single sentence:** a PM can request permission to sell below
floor, an executive can grant or refuse it with a reason, and the resulting
price is provably the one that was approved.

**This is the phase that introduces governance**, and it is the first that
writes outside Nexus.

---

## Business Authority

| Contract | Governs |
|---|---|
| **BV-005 — Margin Approval** | The approval workflow contract |
| **Epic 2 requirements** (Edward, 2026-08) | Twelve requirements, twelve compliance sections |
| **Edward's four answers** (2026-08) | Approver · scope · invalidation · rejection |

> **BV-005 is the governing contract and this specification does not replace it.
> If BV-005 and this document disagree, BV-005 governs and this document is
> wrong.** Read it before implementing.

**BV-005 must be amended or supplemented before implementation.** Edward's four
answers — per-Quote scope, no in-app approve button, bidirectional invalidation,
rejection-with-target — **reverse or extend what the Epic 2 requirements
document states.** Notably, per-Quote scope directly reverses *"a single
non-compliant SKU should not require approving the entire Quote."*

**A governing contract that contradicts the approved decisions is not a
governing contract.** Amend it, then build.

**Edward's four answers, which changed the design:**

**1 · Approver.** An **Executive Approval role in Nexus**, not yet built.
Requests go to a **Slack channel**; authorised responses there approve.

> **There is no in-app approve button.** The PM does not chase a named person —
> they wait on a channel, and the response arrives from outside the product.

**2 · Scope — per Quote, not per cell.** *"Per cell is too much overhead."*
**This reverses the Epic 2 requirements document**, deliberately. One approval
state on the Quote; cells carry margin state only.

**3 · Invalidation — in both directions, without exception.**

> **An approval covers exactly the commercial state at the moment it was
> granted. Any change to that state — price, margin, or the set of breaching
> cells — voids it. Direction is irrelevant.**

Edward's reasoning, and it is the load-bearing part:

> *"The approver will think he approved 23%, not 25%, even if it's more
> beneficial."*

**Nexus cannot read the intent behind a rejection note**, and it cannot infer
that a better number is still covered by a worse approval. **Any judgement it
makes there is a guess about what a person meant.**

So a quote approved at 23% and reworked to 25% **requires a fresh approval**,
even though the change favours the firm.

**This also collapses a distinction that would otherwise exist.** There is no
*spent* versus *invalidated* — **there is one rule, one state, one message.**

**4 · Rejection — rejects the whole Quote, with notes.** Typically *"approved"*
or **"work it better to X%."** So a rejection carries a **target**, and X is a
number the grid can act on directly.

---

## Implementation Authority

**Design-authoritative**, on two artefacts:

| Artefact | Role |
|---|---|
| `docs/approval-states-design-position.md` | **The state model.** Two axes, three channels, invalidation, control-vs-state lifespan |
| R12's page as built | The surface it lands on — space already reserved |

> **Codex implements exactly what the design specifies. If implementation
> conflicts with the design, Codex stops and reports rather than inventing an
> alternative.**

**The state model, as designed — two independent axes. Do not flatten it.**

> **A cell has a margin state and, independently, an approval state.** *Below
> floor + awaiting* is a different cell from *below floor + rejected*, and both
> differ from *below floor + nothing requested.*

**Axis 1 — Margin state.** *Per cell. Determined by the cell's own numbers
against the operative threshold.*

- Above Target
- Below Target *(reports, does not block)*
- Below Floor *(mandate breached)*
- Corrected to Operative Threshold *(lifted, or set directly)*

**Axis 2 — Approval state.** *Per Quote. Determined by the permission workflow.*

- None Required
- Requestable
- Awaiting
- Approved
- Rejected
- Invalidated

**These are enumerated separately because they are separate.** A table pairing
them row-for-row would assert a correspondence that does not exist.

### Valid combinations

**Approval state is per Quote; margin state is per cell.** So the constraint is
between a Quote's approval state and **the set of margin states its cells hold.**

| Approval state | Requires | Notes |
|---|---|---|
| **None Required** | No cell below floor | The ordinary case |
| **Requestable** | ≥1 cell below floor, no live request | The control appears; the state has not been entered |
| **Awaiting** | ≥1 cell below floor at the moment of request | **Quote is not sendable.** The approved set is fixed at request time |
| **Approved** | **The commercial state is unchanged since approval** | Quote is sendable **despite** below-floor cells. Any change voids it — including one that improves the margin |
| **Rejected** | Any margin state | Carries a target X. **X becomes the operative threshold**; cells re-evaluate against it |
| **Invalidated** | The set changed after approval | **Must not revert to "no request."** A PM would read that as never asked |

**Two combinations that must be impossible:**

- **Approved with a changed commercial state.** Including a state that improved.
  **It invalidates** — there is no "still covered" case.
- **Awaiting with no below-floor cell.** The PM corrected the problem while
  waiting; **the request withdraws.**

**Note what follows from the invalidation rule:** a Quote whose cells are all
corrected does not hold a dormant approval. **It invalidates**, and if a cell
later drops below floor again that is a **new request** — the old approval
covered a state that no longer exists.

**Corrected to Operative Threshold is one margin state, not two.** A cell
lifted to the floor and a cell lifted to a rejection target X are the same
margin state against different thresholds. **The threshold is the variable; the
state is not.** *(This is why `liftTo(threshold)` is parameterised.)*

**Three channels, and they map to the axes:** colour → **margin state** ·
marker → **approval state** · badge → history *(was it lifted, was it set
directly).*

**Approval must not enter the colour ramp.** A cell awaiting approval is still
below floor; a fourth colour would say its margin changed when only its
permission did.

**Approval must not enter the colour ramp.** A cell awaiting approval is still
below floor; a fourth colour would say its margin changed when only its
permission did.

**CD's cost estimate:** five changes, four of them parameter swaps —
`liftToFloor` → `liftTo(threshold)`, `marginState` taking the operative
threshold, `evaluateCells` carrying it, the staging-bar warning, and the
banner's approval channel. **If the build proves materially larger than that,
something has been misunderstood — stop and report.**

---

## Out of Scope

- Any Costs page change *(Phase 2)*
- The Pricing page's structure *(Phase 3)* — Phase 4 adds a channel to it
- Quote isolation *(Phase 1)*
- **General-purpose role and permission infrastructure.** The Executive Approval
  role is required; a wider RBAC system is not.
- Slack as a general integration. **One channel, one message shape, one response
  parser.**
- Approval for anything other than below-floor margin

---

## Dependencies

**Phase 3 must ship first.** This is the only hard inter-phase dependency in the
four.

**Why:** Phase 4 adds a marker channel to the compliance grid, an approval
channel to the banner verdict, and a request control to the below-floor cell.
**None of those surfaces exist before Phase 3.**

**And two contracts:**

**Phase 1's Pinned Commercial Settings** — an approval records a resulting price
that must be **reproducible**. If the thresholds move, the approved price cannot
be verified against what was approved.

**Phase 3's `liftTo(threshold)`** — a rejection carries a target X, and the
existing lift retargets to it. **No new mechanism**, which is why the parameter
was worth making an argument rather than a constant.

**One external dependency:** a Slack channel, and whatever authorises a response
in it.

---

## Implementation Boundary

### In scope

**1 · The approver list — an admin setting, and it is the authorisation model.**

> **An admin settings page listing approved executive approvers. Each row carries
> a Nexus user and that user's Slack identity.**

**Not a general role system.** A bounded list on a settings page, maintained by
an admin.

**This page IS the Slack authorisation model**, which resolves what Codex
flagged as a separate gap. The Slack-user-to-Nexus-user mapping is **not a
lookup table maintained elsewhere — it is a column on the approver row.**

> **A Slack response counts if and only if its sender maps to a row on this
> page.**

**Approver removal — decided:**

> **An approval granted while the approver was on the list stands permanently.**
> Removing them afterwards does not void it. **New requests use the list as it
> stands at the time of the request.**

The approval was valid when granted, the same way an audit record is valid for
the state that produced it. **Retroactively voiding approvals when a person
leaves would invalidate commercial decisions that were properly made.**

**Implementation consequence:** the approval record stores **who approved**, not
a reference to a list membership that can later be revoked. The record is
self-contained.

**2 · The approval record.**
Per BV-005 and Edward's §9: **approver · timestamp · reason · resulting price.**

**Plus the commercial fingerprint** — enough to prove the approval covers *this*
commercial state and not a later one. **Without it, invalidation cannot be
detected**, and invalidation is the load-bearing behaviour of this phase.

**The fingerprint covers an approved commercial set, not a singular price.**
Approval is per Quote, so the approver authorises **the set of below-floor
cells** — their SKUs, tiers and margins. **Any change to that set voids the
approval**, not only a change to one price.

**3 · Request Approval.**
Appears only on a below-floor Quote. **Per Quote, not per cell.**

**The request states its contents, not a count.** CD:

> *"3 cells below floor: RPL-200 · T1 (22.8%), GLW-30 · T1 (23.5%), GLW-50 · T4
> (23.3%)"*

**Because the approver authorises a set** — and an invalidation message is only
legible if the set was legible when it was sent.

**4 · Slack delivery and inbound authorisation — a full integration build.**

**Codex confirmed there is no inbound Slack approval handler to extend.** So
this is not *"which Slack setting authorises approval"* — it is a
security-sensitive integration to design and build, and **a material portion of
this phase.**

**Must define:** inbound mechanism · **Slack signature verification** · Slack
user → Nexus user mapping · authorised-approver check · request correlation ·
structured approval/rejection payload · replay protection · idempotency ·
duplicate response handling · stale or superseded request handling ·
withdrawn/invalidated request handling · audit and failure evidence.

> **A Slack message posting successfully does not create an approval workflow.**
> The inbound authorisation and state transition are the substance.

**Observability is required, not optional.** This is an external authorisation
surface, and the first sign of a problem will be a metric rather than a bug
report.

**Emit counts for:** requests created · approvals · rejections · invalidations ·
stale or superseded responses · **unauthorised attempts** · **replay attempts**.

**The last two are security signals.** A rising count is an attack or a
misconfiguration, and neither surfaces any other way.

**Rejection carries notes**, typically a target.

**5 · The states, on the surface.**
`awaiting` · `approved` · `rejected` · `invalidated` — as **markers**, in their
own channel.

**Durable and legible without interaction.** They reach three places: the
**cell**, the **tier rollup**, and the **banner verdict**.

**A Quote awaiting approval is not sendable**, and the banner says so **from the
same `evaluateCells`** — load-bearing 23.

**6 · Invalidation, stated not silent.**

> **An approval is pinned to a price. When any input to that chain moves, the
> approved price is no longer the price — and the approval no longer covers
> anything.**

**The message, as designed:**

> ⊘ **Approval void.** Approved at **$2.87** by Edward on 30 Jul. **Packaging**
> rose $0.04 on 1 Aug (Verre Pacific re-quote, Ana Reyes) — the price is now
> **$2.92**. The approval covered $2.87. → *Request approval at $2.92*

**No new data.** The chain that produced the approved price names the operand
that changed.

**It must never quietly revert to "below floor."** A PM would read that as never
requested.

**7 · Self-invalidation, warned in the staging bar.**
A PM stages a lift while awaiting approval, applies it, and voids their own
request. **Unlike cost drift, this is caused by the person it hurts, in the
moment they act.**

CD's placement, and the rule behind it:

> **A consequence that only appears in the confirm dialog appears too late to
> change the decision. The confirm is where you acknowledge a consequence; the
> working surface is where you learn it.**

**The warning belongs in the staging bar**, visible from the moment the
offending change is staged. The Apply button carries it too.

**8 · Withdraw request.**
The one real PM move while waiting. **Withdrawn is history, not a state** — the
Quote is below floor, editable, every action identical. But **visible in the
same slot the invalidation notice uses.**

The asymmetry: **invalidation must stop and inform because the PM did not cause
it. Withdrawal need not, because they just did it and are already acting.**

**9 · Rejection with a target.**
A rejected Quote with a target is **a corrective state with a higher bar**, not
a refusal. **It should feel like below-floor** — actionable, threshold named,
lift offered.

**X is per-cell, not blended.** Unambiguous, strictly stronger, and clearing
every cell to X guarantees blended ≥ X.

**X supersedes the floor in the colour channel; the floor is stated as context
in the header; a badge marks cells that were also below the firm floor** — so
*"which were originally the problem"* survives if X is later relaxed.

**10 · Traceability survives approval.**
*Why is this price what it is* answers through cost, markup, adjustments,
override, **and approval.**

**11 · Returning to baseline withdraws outstanding requests.**
Otherwise Phase 3's *"remove every layer and you are exactly where you started"*
becomes false.

### Explicitly not in scope

- Approving anything other than below-floor margin
- An in-app approve control. **There is none by design.** *"A control that
  cannot do anything is worse than none."*
- Per-cell approval. **Per Quote.**
- A conditional favourable-change rule. **Invalidate in both directions.**

---

## Repository Dependencies

| Component | Dependency |
|---|---|
| Compliance evaluation | carries approval state |
| Banner verdict | approval channel; **not sendable while awaiting** |
| Compliance grid | marker channel |
| `liftTo(threshold)` *(Phase 3)* | retargets to X |
| `marginState` | takes the operative threshold |
| Staging bar | self-invalidation warning |
| Pinned settings *(Phase 1)* | approved price reproducible |
| Audit | approval, rejection, withdrawal, invalidation |
| Trace | approval as a terminal act |
| New: approval record + role + Slack adapter | schema, auth, integration |

---

## Rollout Risk

| Risk | Severity | Mitigation |
|---|---|---|
| **Silent invalidation** — quote sends at a price nobody approved | **Critical** | Stated invalidation; never reverts to below-floor |
| **Self-invalidation unnoticed** | **High** | Staging-bar warning at the moment of staging |
| Approval state not reaching the banner | **High** | Load-bearing 23: one evaluation |
| Approval folded into the colour ramp | **High** | Three channels; design-authoritative |
| Slack response parsed from an unauthorised sender | **Critical** | Authorisation is the gate, not the channel |
| Slack down or message lost | Medium | State is in Nexus; Slack is delivery |
| Approval survives a change it should not | **Critical** | Fingerprint must be sufficient |
| Baseline return leaves an orphan request | Medium | Withdraw on return |

**Two are critical for the same reason:** a quote could send at a price nobody
approved. **That is the failure this phase exists to prevent**, and it is
reachable by both silent invalidation and a mis-parsed response.

---

## 1 · Harness Invariants

**Permanent automated protections.**

**H1 · A Quote awaiting approval is not sendable** — from `evaluateCells`, not a
second source.

**H2 · Invalidation fires on any input change.** Move a packaging cost after
approval. **The approval voids, the message names the operand, and the state is
not "below floor."**

**H3 · Invalidation fires downward too.** Price drops, margin improves —
**still voids.** A Quote approved at 23% and reworked to 25% is **not
approved.**

**H4 · Self-invalidation warns at staging.** Stage a lift while awaiting.
**Warning appears in the staging bar, before Apply.**

**H5 · Withdraw returns to below-floor with visible history.**

**H6 · Rejection with a target retargets the lift.** `liftTo(0.25)` where the
floor is 0.20 — grid, tier action and banner all move to X.

**H7 · X applies per cell**, not blended. Every cell clears X.

**H8 · An unauthorised Slack response cannot approve.** **The critical
invariant** — this is a commercial control, not a feature.

**H9 · A replayed Slack response cannot approve twice.**

**H10 · A response to a withdrawn, superseded or invalidated request cannot
approve.**

**H11 · The approval record reproduces its price.** Given the record and the
pinned settings, the approved price recomputes exactly.

**H12 · The approved commercial state is what invalidates** — not a singular
price. **Any change to the state voids the approval**, since the approver
authorised the state: which cells, at which margins.

**H12a · A revision voids an approval.** Even one that improves every margin.

**H12b · A rejection never becomes an approval without a new request.** No
auto-resubmit on correction.

**H12c · No request expires.** Assert that no timeout, sweep or escalation path
exists — **its absence is the specification**, and a later "helpful" addition
would contradict it.

**H13 · Return to baseline withdraws outstanding requests.**

**H14 · Approval never colours a cell.** Three channels: colour → margin,
marker → approval, badge → history.

**H15 · The trace includes approval as a terminal act** — approver, date,
reason.

---

## 2 · Rehearsal Procedures

**Controlled operational proofs at a named gate.**

### R1 · Slack inbound authorisation — **the security rehearsal**

**Gate:** before deploy. **Blocking.**

**Codex confirmed there is no inbound Slack handler to extend.** This is a
complete integration to design and build, not a configuration.

**Rehearse in a controlled environment:**

- signature verification against a tampered payload
- a response from an unauthorised Slack user
- a response from an authorised user with no Nexus mapping
- a replayed response
- two simultaneous responses to one request
- a response to a request already withdrawn
- a response to a request whose commercial set has changed

**Record:** every case, with the outcome and the audit entry produced.

**Stop condition:** any path that approves without passing signature
verification, sender authorisation **and** request correlation.

### R2 · Rollback after first request — **the phase is not cleanly reversible**

**Gate:** before deploy.

**Slack messages cannot be recalled.** A request has left the building.

**Rehearse:**

1. Send a request. Approve it.
2. Send a second request. Leave it outstanding.
3. Revert the application.
4. Determine, for each: what does the Quote show, is it sendable, and can the
   approval be seen at all?

**The specific hazard:** a Quote approved to sell below floor showing as below
floor **with no permission visible** — worse than either state alone.

**Record:** state of both Quotes post-revert, and the runbook for resolving
outstanding requests.

**A revert must include** a means of resolving outstanding requests, a decision
on approved-not-yet-sent Quotes, and a Slack message stating that outstanding
requests are void.

### R3 · Invalidation across a real cost change

**Gate:** before operator validation.

Approve a Quote. Have a **different operator** change a cost in a section they
own — Logistics on freight, Purchasing on packaging.

**Record:** the invalidation message, whether it names the correct operand and
actor, and how long it took to surface.

**This exercises the multi-owner hazard**: the approval was the PM's, the change
was someone else's, and neither of them is watching for it.

---

## 3 · Regression Requirements

- **A Quote with no below-floor cells behaves exactly as after Phase 3.** No
  approval surface, no marker, no change.
- Costing output unchanged. **Approval is permission, not arithmetic.**
- Phase 3's staging, undo and baseline return unchanged **except** the
  withdraw-on-return addition
- The four lifecycle guards unchanged
- Banner behaviour unchanged for a compliant Quote

**Explicit non-regression:** approval must not become the path of least
resistance. **If a PM can request approval more easily than lift a cell, the
page has inverted the firm's own policy** — the floor is a mandate and the lift
is the ordinary correction.

---

## 4 · Operator Validation Checklist

**Edward and an approver, before launch.**

- [ ] Open a compliant Quote. **No approval surface anywhere.**
- [ ] Open a below-floor Quote. **Request Approval appears.**
- [ ] Confirm the request **names the cells**, not a count.
- [ ] Send it. **Slack message arrives, legible, same contents.**
- [ ] **Banner says not sendable while awaiting.**
- [ ] Approve from Slack **as an authorised responder.** State updates.
- [ ] Approve **as an unauthorised responder. Nothing happens.**
- [ ] Change a cost after approval. **Invalidation names the operand and the
      route.**
- [ ] Confirm the state is **not** "below floor."
- [ ] Request again. Reject with *"work it better to 25%."*
- [ ] Confirm the grid retargets to 25% and the lift offers it.
- [ ] Stage a lift while awaiting. **Warning in the staging bar.**
- [ ] Withdraw. **Below floor, history visible.**
- [ ] Return to baseline with a request outstanding. **It withdraws.**
- [ ] Press an approved price in the trace. **Approver, date, reason.**

**The judgement is not "does the workflow complete."** It is:

- Does the PM know **what happens next** when they request?
- Does the approver have enough to decide **without opening Nexus?**
- When an approval voids, is the reason obvious **and the route clear?**
- **Is asking for approval harder than fixing the price?** *(It should be.)*

**Stop if any check fails.**

---

## 5 · Release Evidence Required

| Artifact | Content |
|---|---|
| **Harness results** | H1–H15, named. **H8 called out separately.** |
| **Slack security manifest** | R1's seven cases, each with outcome and audit entry |
| **Rollback runbook** | R2's post-revert state, plus the resolution procedure — **not an assumption of reversibility** |
| **Invalidation trace** | R3's message, naming the operand and actor |
| **Approval record sample** | Approver · timestamp · reason · resulting price · **commercial fingerprint** |
| **Reproduction proof** | The approved price recomputed from the record and the pin |
| **Design fidelity manifest** | Against `approval-states-design-position.md` |
| **UI-delta scope note** | CD's five changes are the **UI delta only.** Report the full build against it. |
| **Browser traces** | Awaiting state · invalidation · rejection-with-target |
| **Operator sign-off** | Edward's and the approver's checklists |


## Explicit Stop Conditions

**Stop and report. Do not proceed, do not work around.**

1. **Slack authorisation cannot be verified.** An unauthorised approval is a
   commercial control failure, not a bug.
2. **The fingerprint cannot detect a change** that should invalidate. **The
   whole phase rests on invalidation being reliable.**
3. **Invalidation cannot name the operand that changed.** Then the message is
   *"something changed"* — the state is on screen, the reason is not.
4. **Approval state cannot reach the banner from one evaluation.** Load-bearing
   23. Two sources will diverge.
5. **The build is materially larger than CD's five changes.** Either the design
   has been misunderstood or a surface is missing. **Report before building.**
6. **BV-005 disagrees with this document.** BV-005 governs.
7. **Per-cell approval is required by any behaviour discovered during
   implementation.** Per-Quote was a scope decision; a per-cell requirement is a
   business change, not an implementation detail.

---

## Open Questions

### A · What authorises a Slack response? — **ANSWERED**

> **A specific list of people, defined on the approver settings page.**

**Not channel membership.** Not an emoji from anyone present. **The sender's
Slack identity must map to a row on the approver list.**

**Three checks, all required:** signature verification *(the message genuinely
came from Slack)* · **sender authorisation** *(their Slack identity maps to an
approver row)* · request correlation *(the response refers to a live request)*.

**Any one failing means no approval**, and the attempt is counted in the
observability metrics.

### B · What if the approver never responds? — **ANSWERED**

> **Indefinite. No timeout, no expiry, no escalation in Nexus.**

Escalation is handled by **designated approver tiers as a business process.**
**Not a Nexus requirement.**

**Design consequence:** do not build a timeout, an expiry sweep, or an
escalation path. **A request sits until answered or withdrawn**, and Withdraw
remains the PM's one move.

### C · Does an approved quote that is revised carry its approval forward? — **ANSWERED**

> **No. Any change to the commercial state requires re-approval.**

Covered by the invalidation rule above. **A revision changes the state**, so the
approval voids and a fresh request is required — regardless of whether the
revision improved the margin.

### D · Can a rejection be superseded by a later approval without a new request? — **ANSWERED**

> **No. A rejection is only superseded by a new request.**

**The workflow is: fail → request → correct → request → approved.**

A PM who receives *"work it better to 25%"* and does so **must ask again.** The
correction does not auto-resubmit, and a rejection never converts into an
approval.

**Same reasoning as the invalidation rule:** Nexus cannot read the approver's
note and decide that the corrected number satisfies it.

---

## What "done" looks like

> A PM has three cells below floor and a commercial reason to keep them there.
> They request approval; the request names exactly which cells and what margins.
> An executive sees it in Slack, approves it, and the quote becomes sendable.
> A week later a freight cost moves, the approval voids, and the page says
> exactly why and exactly what to do next — without anyone having to notice.
