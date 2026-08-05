# V1 Beta Readiness Backlog

**Status:** Live register. Enhancements required before the beta period begins.
**Relationship to other registers:** this holds work that must exist *before
operators use Nexus in anger*. Production launch readiness is
[`slice-13/GO_LIVE_READINESS_CHECKLIST.md`](slice-13/GO_LIVE_READINESS_CHECKLIST.md);
undecided questions are [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md); phase scope
is the phase specifications.

Nothing here is Phase 2 scope.

---

## V1-BETA-001 — In-App Bug Reporting and Diagnostic Context Capture

**Priority:** High · **Status:** Logged, not started · **Blocks:** beta start
**Logged:** 2026-08-04

### Business purpose

Beta operators will encounter incorrect calculations, stale or missing data,
workflow failures, unexpected validation, visual and interaction defects, and
behaviour that is confusing without being wrong. The last category matters as
much as the others: a report that turns out to be a documentation gap is still
a finding, and the reporting flow has to be able to tell those apart.

Operators must be able to report an issue **from the page where it occurs,
without reconstructing technical context by hand.** An operator who has to
work out which table or module was involved will either not report, or report
something engineering cannot reproduce.

### Minimum operator workflow

A persistent but unobtrusive **Report a Bug** action, reachable throughout
Nexus. The operator supplies:

- what they expected
- what actually happened
- the steps immediately preceding
- severity or impact
- optional screenshot or attachment
- optional additional comments

**The operator is never asked to identify the module, table, or root cause.**
That is engineering's job and asking for it degrades the report.

### Automatically captured context

Attached where available:

| Category | Fields |
|---|---|
| Identity | Authenticated user · timestamp |
| Build | Environment · application version / commit |
| Location | Current route · workspace · active section |
| Governed record | Quote · project · customer · other governed identity, plus relevant entity IDs |
| Client | Browser · viewport |
| State | Current reconcile / store revision where applicable |
| Errors | Recent client-side error or validation state |
| Correlation | Request / correlation IDs from the triggering operation |
| Connectivity | Whether the page was online, reconnecting, or operating after a realtime interruption |

**Constraint — data minimisation.** Commercially sensitive field values must
not be captured indiscriminately. Context capture follows access control, data
minimisation and the existing authority rules. A bug report is not a licence to
exfiltrate a quote's economics into an issue tracker.

This interacts directly with the customer-view boundary discipline and with
[`architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md`](architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md):
being able to read a value on screen does not establish a right to copy it into
a report.

### Submission and lifecycle

A submitted report receives a unique report ID, submission confirmation, status
tracking, and a classification — **bug · data issue · usability issue ·
training/documentation issue · enhancement** — plus assignment, internal notes,
and a link back to the governed Nexus record where permitted.

**The destination system is an open authority decision.** It may be an internal
Nexus issue table or an approved external tracker. **Do not assume GitHub,
Monday, HubSpot or anything else is authoritative** — that choice determines
retention, access control and who can see a report's status, and it is a
business decision rather than an implementation convenience.

### Eight gates — none answered

Per [`NEXUS_IMPLEMENTATION_STANDARD.md` §3](NEXUS_IMPLEMENTATION_STANDARD.md).
Recorded as open so nobody mistakes a logged enhancement for a specified one.

| # | Gate | Open question |
|---|---|---|
| 1 | Business Workflow | What does an operator do today when something breaks, and who do they tell? |
| 2 | Business Authority | Who owns report triage? Which system is authoritative for issue status? |
| 3 | External Authority | Does an issue tracker already exist for this firm? If so, Nexus records into it rather than replacing it — the governing principle applies here as everywhere |
| 4 | Data Traceability | What may be captured automatically? Retention and access rules? |
| 5 | Commercial vs Operational | A report is operational. It must never mutate, and must never be able to mutate, a commercial record |
| 6 | Snapshot / Clone / Revision | How does a report link to quote snapshots, revisions and audit history? A report against a since-revised quote must still identify what the operator actually saw |
| 7 | Regression Contract | What invariant protects the boundary — that reporting cannot leak restricted values and cannot write commercial state? |
| 8 | Design Authority | No design source exists. Either CD ships one or its absence is explicitly dispositioned |

### Further open questions

- Do screenshots and attachments require redaction, and if so is it automated
  or operator-driven?
- How are duplicate reports identified?
- Can beta users see status, or only receive confirmation?
- What distinguishes a production incident from an ordinary bug report — and
  does the flow need to escalate differently?

### Acceptance criteria for beta

**Operator:** can submit a reproducible issue from within Nexus in **under two
minutes**, without leaving the affected workflow.

**Engineering:** receives enough governed context to identify who encountered
it, where it occurred, which business record was involved, which application
version produced it, and what the operator observed.

Both halves are required. A flow that is fast but yields unreproducible reports
fails, and so does one that captures everything but takes ten minutes.

### Why this is beta-blocking rather than nice-to-have

Beta is the first time Nexus meets operators who did not build it, on real
quotes with real money attached. Without in-app reporting, findings arrive as
conversation — unattributed, unreproducible, and lost when the conversation
ends. That is the same failure mode the repository authority remediation
existed to correct, in a different register: knowledge that only exists in
someone's memory.

### Not in scope

Automated error reporting, session replay, telemetry, or anything that captures
without an operator deliberately submitting. Those are separate decisions with
their own consent and data-governance questions.

---

## Adding to this register

An entry belongs here when it must exist before operators use Nexus in beta,
and it is not already covered by a phase specification. Give it a
`V1-BETA-nnn` identifier, state the business purpose before the mechanism,
record the eight gates as open unless they genuinely are not, and say plainly
why it blocks beta rather than merely improving it.
