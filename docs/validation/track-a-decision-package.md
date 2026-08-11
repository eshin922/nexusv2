# Track A · below-floor governance — decision package

**For Edward. Business dispositions only; nothing implemented.**
Prepared 2026-08-10 from [OD-002](../OPEN_DECISIONS.md),
[BV-005](../business-validation/BV-005-below-floor-margin-approval.md), and the
current runtime.

**Implementation history is separated from business authority throughout.**
Where Nexus already behaves a certain way, that is recorded as *behaviour*, not
as policy, and never offered as a reason to keep it.

---

## First, a correction to the record

The blocker board states: *"Today an accepted quote can sit below floor with no
approval at all."* **On the primary path that is not true, and the truth is
close to the opposite.**

| gate | code | today |
|---|---|---|
| **Send to customer** | `sendQuote` — `quotes.ts:1400+` | **NO floor gate.** A below-floor quote can be sent |
| **Record acceptance** | `quotes.ts:2341` | **HARD BLOCK**, unconditional |
| **Complete / push to NetSuite** | `mark-complete.ts:190` | **HARD BLOCK**, unconditional |

Both blocks carry comments saying an override "is not yet wired". There is no
approval path of any kind.

**So the live V1 exposure is not an ungoverned below-floor sale. It is a dead
end mid-deal:** a below-floor quote can be sent, the customer can say yes, and
Nexus then refuses to record their acceptance — with no override, no request
path, and an error message telling the operator that the thing they need does
not exist.

The board's statement remains true for one narrower case: **the firm floor is
versioned**, so raising it later leaves already-accepted quotes below the new
floor. BV-005 already addresses that ("a later firm-floor change alone does not
erase or invalidate historical approval").

**Consequence for this package:** OD-002's five questions are all mechanics of
an approval feature. They are downstream of a question nobody wrote down —
whether V1 has that feature at all. That is Decision 1, and four of the five
become moot under one of its answers.

---

## Decision 1 · May V1 permit a below-floor quote to be accepted, and under what authority?

**This is the decision. The rest are consequences of it.**

**Current behaviour (not policy):** unconditional hard block at acceptance and
completion. No approval, no override, no request path.

| disposition | consequence |
|---|---|
| **1a · Keep the hard block. No below-floor sale in V1.** | Commercially: the firm cannot sell below floor at all until V1.1, including deals leadership would approve. Every such deal must be repriced to floor or abandoned — and if the customer has already accepted, the operator must go back to them. Operationally: **the dead end above stays**, so this disposition is only honest if paired with Decision 2. Engineering: **zero.** OD-002 Q1–Q5 become moot for V1; BV-005 stays approved-but-unimplemented and Phase 4 leaves V1 scope. |
| **1b · Full BV-005 approval record.** | Commercially: the firm can sell below floor with a governed, auditable exception — request, decision, authority evidence, invalidation on material change. Operationally: an approval round-trip enters the critical path of every below-floor deal. Engineering: **the largest remaining V1 item** — new tables, request/decision lifecycle, invalidation rules, two gate integrations, plus Decisions 3–6. Phase 4's point of no return (first Slack request) needs a rollback runbook before it starts. |
| **1c · Minimal governed override: one authorized actor, recorded, no request lifecycle.** | Commercially: the same exception capability, with authority and audit, but no workflow — the approver acts in Nexus at the moment of acceptance rather than being asked asynchronously. Operationally: no round-trip; the constraint is that an authorized person must be present. Engineering: one authority check, one immutable decision record, one escape clause per existing guard. Decisions 3, 4, 6 collapse; Decision 5 still applies. **Does not preclude 1b later** — the record shape is a strict subset of BV-005's. |

**Recommendation: 1c.**

Because the exposure that is actually live is the dead end, not ungoverned
selling — and 1c closes it while still satisfying BV-005's non-negotiables
(authority is a governed permission, not the `admin` role; the decision is
recorded with decision-time authority evidence; material change invalidates).
1b's asynchronous request lifecycle buys routing and delegation, which are
valuable at volume and are not what a ~12-person firm needs to ship V1. 1a is
defensible only if the firm genuinely never sells below floor — which is a
factual claim about the business that I cannot check and you can.

---

## Decision 2 · Should sending a below-floor quote be gated?

**Live today regardless of Decision 1, and independent of it.**

**Current behaviour (not policy):** ungated. `sendQuote` performs no floor
check, so a below-floor quote reaches the customer freely while its acceptance
is blocked.

| disposition | consequence |
|---|---|
| **2a · Leave sending ungated** | Preserves negotiating latitude — a PM may knowingly send an aggressive price. But without Decision 1 permitting acceptance, it preserves the dead end: the firm can make an offer it cannot honour. |
| **2b · Warn on send, do not block** | The operator is told before the customer sees it. Cheap, no new authority. Does not prevent the dead end, but stops it being a surprise. |
| **2c · Block send below floor** | The dead end becomes impossible. Also the strictest: the firm cannot table a below-floor offer even as a negotiating position, and the block would sit on the one action the customer sees. |

**Recommendation: 2b under 1c or 1b; 2c only under 1a.** If acceptance can be
authorised, sending should stay possible and merely honest. If it cannot, then
sending an offer the system will refuse to honour is the defect, and blocking is
the only coherent position.

---

## Decisions 3–6 · Only if Decision 1 is 1b or 1c

### 3 · Who may authorise? *(OD-002 Q1 + Q2)*

**BV-005 already forbids one option:** authority "must not be hardcoded to the
`admin` role", and "Slack identity alone never grants authority". That is
approved business contract, so the live choice is narrower than OD-002 implies.

| disposition | consequence |
|---|---|
| **3a · A `commercial_approver` flag on the user record, administered by admin** | Smallest governed representation that satisfies BV-005. Membership is visible and auditable. Needs initial members named before day one. |
| **3b · A settings-managed named list** | Same effect, membership edited as data rather than per-user. Slightly more admin surface. |

**Recommendation: 3a** — one column, one admin screen, and it satisfies the
contract. **You must name the initial approvers**; the feature is unusable on
day one without them.

### 4 · Is self-approval permitted? *(OD-002 Q3)*

| disposition | consequence |
|---|---|
| **4a · Permitted** | A commercial approver can price and approve their own deal. In a firm this size that may simply be reality — the approver may be the only person who knows the deal. |
| **4b · Forbidden** | Genuine separation of duties, at the cost of blocking a deal whenever the only available approver is the author. |

**Recommendation: 4a for V1, recorded as a deliberate choice**, with the
approver identity on the record so the pattern is visible in audit. 4b is the
better control and the wrong constraint at ~12 people; it is a V1.1 tightening
once there is more than one approver in practice. BV-005 notes this is enforced
in code and *"changing it later invalidates prior approvals"* — so record the
reasoning, not just the answer.

### 5 · Is a rejection reason mandatory? *(BV-005 open question)*

| disposition | consequence |
|---|---|
| **5a · Mandatory** | Every refusal carries a why, which is what makes the audit trail useful commercially rather than merely complete. Trivial to implement. |
| **5b · Optional** | Faster to refuse; the record loses its explanatory value. |

**Recommendation: 5a.** It costs one required field.

### 6 · One approval or a quorum? *(OD-002 Q4)* · and Slack at launch? *(OD-002 Q5)*

| | recommendation | reasoning |
|---|---|---|
| **Quorum** | **One approval** | Quorum changes the schema, not just the UI. At ~12 users a second approver is availability risk, not control. Revisit with volume. |
| **Slack at launch** | **Not required for V1** | BV-005 already classifies Slack as "V1 when required for launch" and forbids it from ever granting authority. Under 1c there is no asynchronous request to route, so Slack has nothing to carry. Deferring it also removes Phase 4's stated point of no return — *"the first request sent to Slack"* — and with it the need for a rollback runbook before Track A can start. |

---

## Separate disposition · C-2 · Bulk Raw markup

**Not part of REG-2/OD-002.** Recorded here because it is the other Track A
business decision, not because the two are related.

**Established facts.** `Raw ingredients` is a distinct engine markup category.
It has **no row in `markup_defaults`**, so the engine falls through to `Other`,
currently **15%**. Bulk raw is therefore priced at 15% against Manufacturing's
30%. Since C-1 the Costs surface shows that rate truthfully.

**This is an absent configuration being silently absorbed by a fallback — not a
configured policy.**

> **Is Bulk Raw intentionally governed by the `Other` markup rate for V1, or
> must `Raw ingredients` receive its own explicit governed markup?**

| disposition | consequence |
|---|---|
| **C-2a · `Other` is intended** | No repricing. But the coupling becomes policy: `Other` also governs "Other service fee total" and every uncategorised line, so retuning it silently reprices **all bulk raw across every quote**. The `costing.ts:841` comment would then be wrong rather than merely stale and must be rewritten, so a later engineer does not "fix" a decision. |
| **C-2b · `Raw ingredients` gets its own governed rate** | One `markup_defaults` row, Finance-set. **Every draft quote carrying bulk raw reprices the moment it lands** — a live commercial change, not a configuration tidy-up. It also moves the S-7 preservation baseline for each affected quote, which should be captured deliberately rather than discovered. Sent and accepted quotes are unaffected (Pattern 52 draft-lock). |

**No recommendation offered.** Both are commercially coherent; the answer
depends on whether the firm marks raw ingredients up like miscellaneous spend,
which is a fact about the business rather than about the system. What I would
flag is that C-2a's coupling is invisible at the point of edit — an admin
changing `Other` today has nothing telling them bulk raw moves with it.

---

## What closes Track A

- **Decision 1** answered, and **Decision 2** with it.
- If 1b/1c: **Decisions 3–6** answered, and **initial approver membership named**.
- **C-2** answered.
- BV-005 amended to carry the answers, which is what OD-002 says settles it.

Under **1a** that is a documentation change and Track A closes with zero
engineering. Under **1c** the engineering is bounded and does not require the
Slack dependency or the rollback runbook Phase 4 assumes.


---

## Track A dispositions — Edward, 2026-08-10

**1c** minimal governed override · **send warns, does not block** ·
`commercial_approver` permission, not admin · **self-approval PROHIBITED** ·
mandatory reason · one approver, no quorum · no Slack. No fallback to
self-approval when no eligible approver exists — that condition stays blocked.

### The membership question has no answer yet, and the reason is structural

**Production holds three user rows, all carrying Edward's name:**

| name | email | role | activity |
|---|---|---|---|
| Ed Shin | `edward.shin@gmail.com` | admin | sales rep on 1 project · recorded 2 acceptances |
| Ed Shin | `edward@thedps.co` | admin | PM on 3 · rep on 3 · recorded 1 acceptance |
| Edison Shin | `edisonlshin@gmail.com` | pm | none |

Confirmed by Edward: **no users have been onboarded yet**, and **Microsoft OAuth
is still being planned**.

Rows are created at **first sign-in**. Staff will sign in through
organisation-tenant SSO. So the dependency is not a preference:

```
MS OAuth ships → staff sign in → user rows exist
              → commercial_approver membership can be granted
              → the below-floor override becomes exercisable
              → Track A closable on evidence
```

**There is no membership list to supply today, and none can be supplied until MS
OAuth lands.** That is the answer to the outstanding question, rather than a
delay in answering it.

### Consequence 1 — the control can be built now, but not closed now

Self-approval prohibited, plus no fallback, plus one human, means every
below-floor acceptance stays blocked for everyone. Built today, 1c ships
**dormant** — behaving exactly like 1a, the hard block it exists to make
governable — until a second person holds the permission.

That is not an argument against the disposition, and not a reason to defer the
build: the implementation is bounded and independent. It is a statement about
**what closing Track A can mean**. The gate cannot be exercised end to end
against a one-person estate, so Track A can reach *implemented and unit-proven*
now, and *closed on operator evidence* only after MS OAuth.

**Edward's call:** build now and ship dormant, or hold until MS OAuth. Building
now costs nothing but sequencing risk; holding keeps the two dependent items
together.

### Consequence 2 — "must differ" needs a definition, and MS OAuth resolves it

The rule says the approving actor must differ from the actor owning the
acceptance. Two of the three rows appear to be **one person with two accounts**,
and `users.id` is the only identity the system has — so signing in as the other
account would satisfy the check while being self-approval in substance, with the
audit recording two "different" approvers who are the same human.

**MS OAuth is the natural resolution.** Under organisation-tenant SSO, identity
becomes tenant-governed (`@thedps.co`), and the two gmail rows are pre-SSO
artifacts rather than a standing hole. What is needed is a decision that they
are **retired or deactivated at the SSO cutover** rather than surviving as
parallel identities — because a duplicate that outlives the cutover turns a
tenant-governed control back into a defeatable one.

### What remains outstanding

1. **Nothing actionable on membership until MS OAuth ships.** The list is a
   post-SSO input, not a pre-implementation one.
2. **Build now (dormant) or hold?** — Edward's sequencing call.
3. **Pre-SSO account retirement** — confirm the gmail rows are deactivated at
   cutover, so `users.id` distinctness and person distinctness coincide.
