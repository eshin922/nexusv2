# Cross-Phase Authority & Dependency Map

**Companion to the four implementation specifications.**
**Author:** CA · **Date:** 2026-08 · **Amended:** 2026-08-04

---

## 0 · The constant that outranks every row below

[`docs/NEXUS_IMPLEMENTATION_STANDARD.md`](docs/NEXUS_IMPLEMENTATION_STANDARD.md)
governs **method** for every phase: the governing principle, the eight
implementation gates, and the five-tier precedence model. Per-phase authority
rows say *which artefact* governs a phase. The standard says *how any artefact
is used*, and what to do when two disagree.

**The five tiers, in order:** later approved business dispositions →
operator-reviewed corrections → design bundle → existing Nexus conventions →
stop rather than invent.

Which document governs a given subsystem right now:
[`docs/AUTHORITY_MAP.md`](docs/AUTHORITY_MAP.md). What is undecided:
[`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md).

---

## 1 · Authority per phase

**Which artefact governs, and what happens when it and the repository disagree.**

| Phase | Governing authority | Design-authoritative? | On conflict |
|---|---|---|---|
| **1 · Quote Integrity** | Approved isolation rules · BV-009 ⚠️ · BV-006 §Commercial Cost Model | **No** — and requires none | Stop and ask. **Do not infer intent from existing code — the existing code is what this phase corrects.** |
| **2a · Costs — Packaging / Production** | **The production Costs page as it exists** | **No** — and the CD Costs round is **set aside** | Preserve, do not improve. Stop and ask. |
| **2b · Costs — Freight** | `freight-1a` **Option A bundle** + four approved deviations, **as amended by operator review** | **Yes** | **Stop and report. Do not invent an alternative.** |
| **3 · Pricing Workspace** | CD R10 / R11 / R12 bundle | **Yes** | **Stop and report. Do not invent an alternative.** |
| **4 · Margin Approval** | **BV-005** · `approval-states-design-position.md` · Edward's four answers | **Yes**, on the state model | BV-005 governs. **It must be amended first** — see §5. |

### Amendment 2026-08-04 — Phase 2 split into 2a and 2b

The original single Phase 2 row read: *"the production Costs page as it exists ·
CD round set aside · preserve, do not improve."* **That is now correct only for
Packaging and Production.** It was inverted for Freight when the freight model
was replaced and a design bundle became authority for the surface.

**2a — Packaging and Production.** Unchanged. Edward set aside the CD Costs
round: *"too far from what we've built in production."* The design replaced
data-entry surfaces with computed summaries. **It must not be consulted during
implementation.** Preservation is the constraint.

**2b — Freight.** The business model was replaced outright (Leg → Component →
Tier became Subcategory → Destination Candidates → Quantity Breaks), and the
`freight-1a` Option A bundle became executable specification. Design fidelity is
required, not merely permitted.

**The ordered Freight authority register** — all eleven entries across the five
tiers — is in [`docs/AUTHORITY_MAP.md`](docs/AUTHORITY_MAP.md). Two entries
matter most at implementation time:

- [`docs/phase-2-freight-dom-parity-audit.md`](docs/phase-2-freight-dom-parity-audit.md)
  — tier 2, **the live gap list**, and the document to work from
- [`docs/design-authority/freight-1a/BUNDLE.md`](docs/design-authority/freight-1a/BUNDLE.md)
  — tier 3, the bundle and its four approved deviations

The earlier [`docs/phase-2-freight-design-authority.md`](docs/phase-2-freight-design-authority.md)
matrix marked all rows PASS. **Those verdicts are void** — they recorded
engineering completion, self-certified before operator validation.

### ⚠️ BV-009 does not exist as an approved document

Cited above for Phase 1, and in Phase 2 and Phase 3. It has **never existed** in
any branch at any point in history, yet production code already ships on its
authority. A reconstruction from citations — explicitly **not ratified** — is at
[`docs/business-validation/BV-009-freight-treatment.md`](docs/business-validation/BV-009-freight-treatment.md).
Tracked as [OD-001](docs/OPEN_DECISIONS.md).

**Consequence for this table:** the Phase 1 row's authority is currently
incomplete, and Phase 1 and Phase 3 both cite BV-009 to place costing arithmetic
out of scope. If the reconstruction is wrong, both scopes rest on a rule that
may not exist.

### Design bundle locations

The bundles cited in this table were untracked ZIP files at the repository root
plus extractions inside gitignored `.artifacts/`. They are now tracked:

| Cited as | Now at |
|---|---|
| `Extract file as project (11).zip` | [`docs/design-authority/freight-1a/`](docs/design-authority/freight-1a/) |
| `Extract file as project (7).zip` · CD R10/R11/R12 bundle | [`docs/design-authority/r12-pricing-workspace/`](docs/design-authority/r12-pricing-workspace/) |
| `approval-states-design-position.md` | [`docs/design-authority/r12-pricing-workspace/docs/approval-states-design-position.md`](docs/design-authority/r12-pricing-workspace/docs/approval-states-design-position.md) |

Original archives retained under `docs/design-authority/_intake/` with
checksums. See [`docs/design-authority/MANIFEST.md`](docs/design-authority/MANIFEST.md).

---

## 2 · Dependency graph

```
Phase 1 ──────── contract ────────┐
(pinning)                         │
                                  ▼
Phase 2                       Phase 3 ──── ships before ──── Phase 4
(costs)                       (pricing)                      (approval)
   │                              │                              │
   └── independent ───────────────┘                              │
                                  └──── liftTo(threshold) ────────┘
```

**One hard release dependency:** Phase 4 requires Phase 3. It adds a marker
channel to the compliance grid, an approval channel to the banner verdict, and a
request control to the below-floor cell. **None of those surfaces exist before
Phase 3.**

**Everything else is independent at the release level** and coupled only by
contract.

| Consumer | Provider | What is consumed | Hard? |
|---|---|---|---|
| Phase 3 | Phase 1 | **Pinned Commercial Settings** | **Contract must exist. Phase 1 need not ship.** |
| Phase 4 | Phase 3 | `liftTo(threshold)` · grid · banner · staging bar | **Yes — release dependency** |
| Phase 4 | Phase 1 | Pinned settings, so an approved price is reproducible | Contract |
| Phase 3 | Slice 1 | Canonical attachment identity | Contract — see §3 |

**Why Phase 3 needs Phase 1's contract but not its release:** the lift is
`cost / (1 − threshold)`. **If Phase 3 resolves thresholds against current
`firm_settings` on a Quote that has been sent and revised, it targets a threshold
that version never consumed.**

---

## 3 · Cross-phase interfaces

**Three contracts crossing phase boundaries. Each must be written, not inferred.**

### I1 · Pinned Commercial Settings *(Phase 1 → 3, 4)*

> A sent Quote version resolves its markups, target margin and floor margin from
> its pin, not from `firm_settings`. **Any consumer computing a price, margin,
> compliance verdict or threshold for a sent version must read the pin.**

**One canonical resolver.** Costing · compliance evaluation · the trace's
`resolution` node · the banner verdict · `liftTo(threshold)` · Phase 4's
approval reproduction — **all through one function.** Not a convention; a single
call site. **Two resolvers will diverge.**

**Durable association.** The pin set and the `quote_snapshots` row written at the
same send **must be linked**, not merely coincident in time. Without it a
superseded pin cannot be attributed to the version it served — and Phase 4's
approval record has nothing to resolve against.

### I2 · Identity resolution *(Slice 1 → Phase 3)*

> **Surgical lifts persist against `quote_leaf_id`.** Costing inputs may remain
> keyed through the legacy grouped-membership identity during the compatibility
> window. **Every lift read, preview, apply and removal must resolve the
> canonical-to-legacy mapping and prove Quote, Product, LEAF, quantity and
> position parity.** Missing, duplicate, cross-Quote or drifting mappings **fail
> closed.** No resolution through reusable `leaf_id` or inferred tuple matching
> is permitted.

**Do not migrate to `assembly_leaf_id` for implementation convenience.** The
mapping outlives the phase; the shortcut does not.

### I3 · The parameterised threshold *(Phase 3 → 4)*

> `liftTo(threshold)`, not `liftToFloor()`. **The threshold is an argument.**

**Why it matters:** Phase 4's rejection carries a target — *"work it better to
25%"* — and **the existing lift retargets to it with no new mechanism.** Making
the threshold an argument in Phase 3 is what makes Phase 4's corrective path a
parameter swap rather than a second control.

**X is per-cell, not blended.** Unambiguous, strictly stronger, and clearing
every cell to X guarantees blended ≥ X.

---

## 4 · Release order and gates

| Order | Phase | Gate before the next |
|---|---|---|
| 1 | **Phase 1** | Operator validation · **R1 legacy-Quote comparison** |
| 2 | **Phase 2** | Operator validation · **R1 structural read** completed first |
| 3 | **Phase 3** | Operator validation · **R1 rollback rehearsal** |
| 4 | **Phase 4** | Operator validation by Edward **and an approver** · **R1 Slack security** |

**1 and 2 may run concurrently.** They share no surface and no contract.

**Recommended actual order: 1 → 2 → 3 → 4.**

Phase 1 first because everything downstream assumes the numbers are
trustworthy. **Phase 2 second because it is what Edward has been waiting on** —
the multi-SKU question started this workstream and has been overtaken by four
rounds of Pricing.

---

## 5 · Reversibility

**Not uniform. Two phases are cleanly reversible; two are not.**

| Phase | Point of no return | Reversible? |
|---|---|---|
| **1** | **None** | ✅ Writes no external data. Pin rows are inert if unread. |
| **2** | **None** | ✅ Rendering only. No schema, no data, no arithmetic, no external system. |
| **3** | **First Apply** | ⚠️ **Reversible, with a required step.** R1 measured the outcome as `ignores`. A runtime rollback MUST be preceded by `DELETE FROM quote_leaf_lifts;` |
| **4** | **First request sent to Slack** | ❌ **Not cleanly reversible. Requires a runbook.** |

### Phase 3 — settled 2026-08-10. The outcome is `ignores`

**The question was not whether the current runtime renders lifts** — it does
not, because they did not exist. **It was what a runtime without lift support
does when it meets a database containing them.**

[R1](docs/rehearsals/R1-rollback-after-first-apply.md) answered it by
measurement, not argument: the pre-Phase-3 runtime was RUN, from a worktree at
`bcd6469`, against the same database carrying one applied lift.

It does not error and does not consume the rows. It **computes a different
price from the one displayed before rollback** — $15.93 → $15.13 on the lifted
cell, 25.0% → 21.0%, and $797.61 off that tier's NetSuite amount. The other 23
of 24 cells were identical, so the effect is bounded exactly to cells carrying
a lift row.

> ## The operational requirement
>
> **Before running a pre-Phase-3 runtime against a database that has received
> applied lifts, delete the rows:**
>
> ```sql
> DELETE FROM quote_leaf_lifts;
> ```
>
> **Otherwise the old runtime silently prices below the operator-approved
> amount.** It does not warn, and it cannot: it has no concept of the rows, so
> every number it produces is internally consistent and wrong only by reference
> to what was displayed before the rollback.

The table is additive, so a rollback that skips the DELETE is safe in the
structural sense — nothing crashes, nothing is lost, and re-deploying Phase 3
restores every price exactly. What it opens is a window in which quoted prices
sit below what an operator approved. That is a commercial exposure, not a
technical one, which is why it belongs in the procedure rather than in a note.

**Phase 3 is: cleanly reversible before first Apply; after it, reversible with a
known, bounded and documented consequence — provided the DELETE runs first.**

### Phase 4 — the first phase where "undo the deploy" is insufficient

**Slack messages cannot be recalled.** Approval records mean something after the
surface showing them is gone. A Quote may have been sent under an approval.

**The specific hazard:** a Quote approved to sell below floor showing as below
floor **with no permission visible** — worse than either state alone.

**Ships with a rollback runbook, not an assumption of reversibility.**

---

## 6 · Verification structure — consistent across all four

**Three sections, three different questions.**

| Section | Question | Lifespan |
|---|---|---|
| **1 · Harness Invariants** | **Does the contract hold?** | Permanent. Runs in CI and release validation, remains after the phase ships, increases coverage. |
| **2 · Rehearsal Procedures** | **Can we deploy and recover safely?** | One-time, at a named gate. Records artifacts. **Not permanent coverage.** |
| **4 · Operator Validation** | **Can a real user understand and complete the workflow?** | Per release. **Not folded into rehearsals.** |

Plus **3 · Regression Requirements** and **5 · Release Evidence Required**.

**Operator validation is separate for a reason.** Three of the last four
significant findings came from Edward using the product, not from any automated
layer. **CB and the harness check internal consistency; neither can check
business fitness.**

---

## 7 · Blocking questions, by phase

**Answers required before the phase can be implemented.**

### Phase 1 — **all answered**
- ✅ **Pin keys on `quote_leaves.id`**, the canonical identity — subject to the
  query below coming back clean
- 🔍 **Do legacy grouped rows resolve?** — **a query, not a decision.** Codex
  runs it and reports the number
- ✅ **Quotes already sent** — leave as they are. Missing pin means read-live
- ✅ **Clones** — start unpinned, pin at their own send
- ✅ **The freight line** — **removed entirely when freight is in the unit
  price.** Not informational, not additive. Bundling exists so the customer sees
  one number; a line labelled "included" reintroduces the itemisation it exists
  to avoid

### Phase 2
- **Freight arity across all four dimensions** — persistence *(established:
  Quote-level)* · Costs rendering · per-tier arithmetic · **customer
  projection.** *Blocking.*
- Does collapse have a place here? *(Recommend deferring.)*
- Should Bulk Raw removal ship separately? *(Recommend yes — otherwise a Phase 2
  revert resurrects it.)*

### Phase 3
- **What does Apply do when the cost base has moved** — recompute and
  re-present, or reject and force re-staging? *A PM with three staged lifts needs
  to know which of their numbers changed.*
- Should CD consolidate the 26 load-bearing items into one list first?
  *(Recommend yes. Codex implements verbatim; a list assembled from three
  documents loses items.)*

### Phase 4 — **two answered, three open**
- ✅ **The approver "role"** — an **admin settings page** listing approved
  executive approvers, each row carrying a Nexus user and their Slack identity.
  Not a general role system
- ✅ **What authorises a Slack response** — **a specific list of people, defined
  on that page.** Not channel membership. **The page is the authorisation
  model**, and the Slack-to-Nexus mapping is a column on the approver row
- ✅ **Approver removal** — an approval granted while the approver was on the
  list **stands permanently.** New requests use the list as it stands at request
  time. The approval record stores **who approved**, not a revocable membership
  reference
- ✅ **No response** — **indefinite.** No timeout, expiry or escalation in Nexus.
  Escalation is a business process via designated approver tiers
- ✅ **Revision** — **voids the approval.** Any change to the commercial state
  requires re-approval, **including one that improves the margin.** *"The
  approver will think he approved 23%, not 25%"* — Nexus cannot infer that a
  better number is still covered
- ✅ **Rejection** — **only superseded by a new request.** Workflow is fail →
  request → correct → request → approved. Correction does not auto-resubmit

**All Phase 4 questions are answered. No blockers remain across the four
phases** except Phase 1's identity query, which Codex runs.

---

## 8 · The fixture rule — applies to all four

> **Fixtures derive from production contracts. They never invent values.**

**Seven instances this project** of a fixture diverging from what production
generates — each either hiding a real defect or manufacturing a false one.

| Phase | Specific requirement |
|---|---|
| **1** | Firm settings read from `firm_settings`, not literals. **A fixture with hardcoded markups cannot test pinning — it has nothing to pin from.** |
| **2** | **One SKU · five to seven · ten.** Repository evidence shows real Quotes at 5–7; the earlier 2–3 estimate was wrong. |
| **3** | **`data.js` is the contract.** Every number computed from inputs, no stored totals. **R6's figures do not reconcile and must not be used.** |
| **4** | **A hardcoded approved price cannot test invalidation** — there is nothing for the chain to disagree with. |

---

## 9 · What each phase must not do

| Phase | Prohibited |
|---|---|
| **1** | Change what a **draft** reads. Change pricing arithmetic. Backfill pins as though today's values were consumed at send. |
| **2** | Improve any surface while extending it. Add a completeness ledger or summary layer. **Consult the set-aside design.** |
| **3** | Reinterpret the design. Let the trace reach Customer View. Fall back to `assembly_leaf_id`. Add a fifth lifecycle guard vocabulary. |
| **4** | Make approval easier than the lift. Build a general RBAC system. Approve on a Slack message alone. Ship without a rollback runbook. |
