# Below-floor approval request lifecycle — design package

**Design only. Nothing implemented.** Follows the accepted Slack enablement
boundary (`577d47c`).

---

## 1 · What Track A already solves — reuse, do not redesign

The authorization machinery is substantially complete and correct. **The Send
gate needs zero changes.**

| Capability | Where | Status |
|---|---|---|
| Below-floor detection | costing engine → `tierRollup.blendedMarginPct` vs floor | ✅ reuse |
| Approver authority | `mayAuthorizeBelowFloor(user) = user.commercialApprover === true` | ✅ reuse |
| Decision record | `below_floor_authorizations`, one row per decision | ✅ reuse |
| Commercial-state binding | `fingerprintCommercialState({totalRevenue, totalCost, blendedMarginPct})` | ✅ reuse |
| Stale invalidation | gate compares current fingerprint to stored | ✅ reuse |
| Version binding | `quoteVersionNumber` — a revision inherits nothing | ✅ reuse |
| Self-approval prohibition | evaluated **at the gate** against the acting user | ✅ reuse |
| Fail-closed gate | `evaluateBelowFloorAuthorization`, consulted by `markAccepted`/`markComplete` | ✅ reuse |
| Mandatory approver reason | `reason` NOT NULL | ✅ reuse |
| Decision-time evidence | `marginAtDecision` / `floorAtDecision`, never recomputed | ✅ reuse |
| Invalidation as transition | `invalidatedAt` / `invalidatedReason`, not delete | ✅ reuse |

Two design choices are worth preserving deliberately, because a request
lifecycle creates pressure to move them:

- **Independence is a property of the GATE, not of the decision.** Who records
  acceptance is unknowable at authorization time. Keep it there; do not "improve"
  it into the request by requiring the approver to differ from the requester at
  request time only — the gate check must remain.
- **Authority is read from the database at decision time**, never from anything
  the caller supplies. A Slack payload is caller-supplied input, which makes this
  rule more load-bearing, not less.

## 2 · What is actually missing

| Missing | Consequence today |
|---|---|
| Request identity | nothing to reference from a Slack message |
| Requester identity | nobody is recorded as having asked |
| `pending` state | "asked, awaiting decision" is unrepresentable |
| **`rejected` state** | **a refusal is indistinguishable from never having asked** |
| Delivery state | a failed post is indistinguishable from no attempt |
| Callback idempotency key | Slack retries could double-decide |
| Superseded-request state | the *authorization* invalidates; a *request* has nowhere to record it |

**The rejection gap is the sharpest.** Edward's invariant — *rejection is a
durable business decision, not absence of approval* — is currently
unrepresentable: `below_floor_authorizations` has no decision column, so a row
is an approval and a refusal is silence.

---

## 3 · Persistence model

**One new table. `below_floor_authorizations` is unchanged.**

```
below_floor_approval_requests
  id                      uuid pk
  quote_id                uuid  NOT NULL → quotes(id) cascade
  quote_version_number    integer NOT NULL          ─┐ same scope triple as
  tier_id                 uuid  NOT NULL → quote_tiers(id) ┘ the authorization

  requested_by_user_id    uuid  NOT NULL → users(id)
  requested_at            timestamptz NOT NULL default now()
  justification           text  NOT NULL            -- requester's why

  state_fingerprint       text  NOT NULL            -- captured at request time
  margin_at_request       numeric(9,6) NOT NULL     ─┐ evidence, never an input
  floor_at_request        numeric(5,4) NOT NULL     ─┘ to a later computation

  status                  text  NOT NULL            -- see §4
  decided_by_user_id      uuid  NULL → users(id)
  decided_at              timestamptz NULL
  decision_reason         text  NULL                -- REQUIRED on reject
  authorization_id        uuid  NULL → below_floor_authorizations(id)

  slack_channel_id        text  NULL
  slack_message_ts        text  NULL
  delivery_status         text  NOT NULL default 'pending'   -- pending|delivered|failed
  delivery_error          text  NULL

  created_at, updated_at  timestamptz NOT NULL
```

**Partial unique index — at most one live request per scope:**

```sql
CREATE UNIQUE INDEX below_floor_request_pending_idx
  ON below_floor_approval_requests (quote_id, quote_version_number, tier_id)
  WHERE status = 'pending';
```

Same shape as `netsuite_so_pushes_success_unique_idx`. It makes duplicate
requests structurally impossible rather than conventionally discouraged.

**`authorization_id` is the join between the two tables.** A request does not
authorize anything; it *produces* an authorization row on approval, and the
existing gate reads only that row. This is why the gate needs no changes.

**Decision and delivery are orthogonal axes.** `status` records what a human
decided; `delivery_status` records whether Slack received the message. A request
may be `pending` + `failed` — which authorizes nothing, by construction.

---

## 4 · State machine

```
                      ┌──────────► superseded   (economics changed before decision)
                      │
   [below floor] ──► pending ────► approved  → writes below_floor_authorizations
                      │
                      ├──────────► rejected     (durable refusal + required reason)
                      │
                      └──────────► cancelled    (requester withdrew)
```

- **`pending`** — created; Slack delivery attempted (success or failure).
- **`approved`** — terminal. Sets `decided_by`, `decided_at`,
  `authorization_id`. The authorization row carries the reason and the gate
  consumes it.
- **`rejected`** — terminal, **durable**, requires `decision_reason`. Produces
  **no** authorization. Send remains blocked — and now for a recorded reason
  rather than by absence.
- **`superseded`** — terminal. Set when the current fingerprint no longer
  matches `state_fingerprint` at decision time. **Never produces an
  authorization.**
- **`cancelled`** — terminal. Requester withdrew.

All four terminal states are absorbing: a later callback against them is a
no-op that re-syncs the Slack message and changes nothing in Nexus.

---

## 5 · Slack callback sequence

```
1  Slack  ──POST──► /api/slack/interactivity        (raw body preserved)
2  verify signature: timestamp ≤5 min · HMAC v0 · constant-time
   └─ fail ⇒ 401 BEFORE parsing. No state read, no state written.
3  parse: user.id · action_id (approve|reject) · value = request id · trigger_id
4  resolve Slack user → Nexus user (§6). fail ⇒ ephemeral error, no state change.
5  views.open  ← reason modal (required on reject, optional on approve)
   └─ respond 200 within Slack's 3-second window
6  view_submission → re-verify signature, re-resolve identity, then ONE transaction:
     a  SELECT … FOR UPDATE the request
     b  status ≠ 'pending'          ⇒ no-op, go to 7
     c  recompute current fingerprint
        ≠ state_fingerprint         ⇒ status = 'superseded', no authorization
     d  approve: require commercialApprover AND decided_by ≠ requested_by
                 insert authorization (shared Track A core) · status = 'approved'
        reject : require decision_reason · status = 'rejected'
7  chat.update the original message to the terminal state
```

**Step 6b is the idempotency guarantee**, expressed as
`UPDATE … WHERE id = ? AND status = 'pending'` — zero rows affected means
already decided. Idempotent by **request identity + status**, not by HTTP
request, exactly as required. A Slack retry, a double-click, and a delayed
duplicate all land on the same no-op.

**Step 7 is a projection, not a source of truth.** If `chat.update` fails the
decision stands; the message is stale, Nexus is correct. It should be
re-syncable, and a stale message must never be read back as state.

### One required refactor

`authorizeBelowFloor` derives its actor from `ensureUser()` — a Clerk session,
which a Slack callback does not have. Extract the core to accept an **explicit
approver id** (the shape `runMarkComplete({ actorUserId })` already uses) and
keep the existing action as a thin session-bound wrapper. **No authorization
logic changes** — only where the approver identity comes from.

---

## 6 · Identity enforcement and reconciliation

`users.slack_user_id` (nullable, unique) is a **durable binding**, not a lookup
convenience.

**Resolution order — binding first:**

1. `slack_user_id` already bound → **use that binding. Ignore email entirely.**
2. Unbound → bootstrap: Slack `users.info` → email → `users.email` → bind.
3. Require the resolved user exists, `commercialApprover === true`, and
   `decided_by ≠ requested_by`.

**Reconciliation — explicit, and fail-closed in both directions:**

| Condition | Behaviour |
|---|---|
| Bound Slack id; email now resolves to a **different** Nexus user | **Refuse the decision.** Do not remap. Surface an admin reconciliation error. |
| Email resolves to a Nexus user that already carries a **different** `slack_user_id` | **Refuse.** Two Slack accounts claiming one Nexus identity. |
| No Nexus user for that email | **Refuse.** Slack identity alone is never sufficient. |
| Resolved user lacks `commercialApprover` | **Refuse.** Not an authority question Slack can answer. |

Rebinding is an **administrative act**, never an inference from a changed email.
An email change is exactly the event that should *stop* an automated remap, not
trigger one.

---

## 7 · Slack message — minimum reviewer context

Not a quote representation. Enough to decide, and a link for everything else.

```
⚠  Below-floor approval — Kirby Beauty LLC
   Deal      Kirby Beauty — Restoring Shampoo & Conditioner
   Scenario  DPS-1049 · Tier 1 · 1,000 units
   Margin    18.4%   ·   floor 25.0%      ← requested vs governed
   Impact    $5,550 order · $3,650 below floor at this tier
   Requested by  Ed Shin
   Why       "Strategic entry pricing — customer committed to Q4 reorder."
   [ View in Nexus ]      [ Approve ]   [ Reject ]
```

**Reason capture.** Rejection **requires** a short reason — symmetric with the
approver reason already mandatory on the authorization, and a refusal without a
why is exactly as useless to an auditor as an approval without one. Approval
**may optionally** capture one; when omitted, the authorization's mandatory
`reason` records the approver endorsing the requester's stated justification,
attributed as such. Both use the same modal, so it is one code path.

---

## 8 · Failure semantics

| Failure | Behaviour |
|---|---|
| Slack unavailable / post fails | request persists `pending` + `delivery_status='failed'`. **Send stays blocked.** Operator sees the failure and can contact the approver directly or retry delivery. |
| Callback arrives twice | second is a no-op (§5 step 6b). One decision, one authorization. |
| Reviewer unknown / unmapped | refuse; ephemeral Slack error; **no state change**. |
| Reviewer lacks authority | refuse; ephemeral error; no state change. |
| Request already decided | no-op; re-sync the Slack message to the true terminal state. |
| Quote economics changed | `superseded` at decision time; **no authorization**; requester must raise a new request. |
| Slack message deleted | irrelevant to authorization. Nexus state is authoritative; the message is a projection. |
| Nexus callback endpoint unavailable | Slack retries; nothing is decided. Send stays blocked. |
| Signature invalid or timestamp stale | 401 **before parsing**. Nothing read, nothing written. |

**The through-line: every failure path leaves authorization absent, and absence
blocks Send.** Nothing in the delivery layer can manufacture authority. Ordinary
quote editing is untouched throughout — only the below-floor Send/Accept gate is
affected.

---

## 9 · Minimal changes

**Schema (2)**
1. `below_floor_approval_requests` + the partial unique index.
2. `users.slack_user_id` (nullable, unique).
3. `firm_settings.slack_approval_channel_id` — **must be added to
   `versionedFirmSettingsUpdate`'s carry-forward**, or a later margin edit
   silently nulls it.

**Code**
- `POST /api/slack/interactivity` (public route + signature verification).
- Slack client: `chat.postMessage`, `chat.update`, `views.open`, `users.info`.
- `requestBelowFloorApproval` action (creates request, attempts delivery).
- `decideBelowFloorApproval` core (approve/reject, transactional, idempotent).
- Refactor `authorizeBelowFloor` to accept an explicit approver id.
- `src/lib/auth/production-middleware.ts` — add the route to `isPublicRoute`.

**Unchanged:** `evaluateBelowFloorAuthorization`, `fingerprintCommercialState`,
`mayAuthorizeBelowFloor`, `below_floor_authorizations`, and the
`markAccepted` / `markComplete` gates.

---

## 10 · Targeted regression plan

Pure-rule tests where possible; a stubbed Slack client for the callback path.

1. request captures requester, fingerprint, margin and floor at request time
2. second pending request for the same scope is refused (partial unique)
3. approve by a non-`commercialApprover` → refused, no authorization
4. **approve by the requester → refused** (self-approval, at the gate)
5. approve after economics change → `superseded`, **no authorization**
6. **duplicate approve callback → exactly one authorization**, second no-ops
7. reject → durable `rejected`, no authorization, **Send still blocked**
8. reject without a reason → refused
9. delivery failure → `pending` + `failed`, **Send still blocked**
10. invalid signature → 401 **before parse**, no state read or written
11. stale timestamp (>5 min) → rejected
12. unmapped Slack user → refused, no state change
13. **bound `slack_user_id` whose email now resolves elsewhere → refused**, no remap
14. approved request authorizes **only** the exact version + tier + fingerprint
15. approval does not survive a version revision

**Falsification:** a `rejected` request must not read anywhere as "not yet
requested". Assert that Send's refusal message and the operator surface both
distinguish *refused* from *never asked* — the two are identical today, and that
collapse is the defect this lifecycle exists to remove.

Assertions are on **authorization existence and count**, not on request status
alone: a status-only assertion passes an implementation that also wrote a stray
authorization.

---

## 11 · Deliberately out of scope

Slack notifications for anything other than below-floor approval; approver
routing or quorum; reminders/escalation; a Slack home surface; DMs. Below-margin
approval is the first governed consumer, not the first feature of a
notification platform.
