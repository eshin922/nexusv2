# BV-005 — Below-Floor Margin Approval

## Status

**Business contract approved; V1 implementation not started.**

## Business promise

Below-floor pricing may proceed only through an authorized commercial
exception. Nexus is the system of record for the request, decision,
applicability, and audit evidence. Slack is notification and routing only.

## Current behavior

- Canonical costing detects `BELOW_FLOOR`.
- Pricing UI gives below-floor pricing blocking treatment.
- Server-side acceptance recalculates and rejects a below-floor selected tier.
- Completion independently recalculates and rejects a below-floor effective
  accepted tier.
- Existing quote override columns, firm policy, and pricing telemetry are
  preparatory but do not constitute an approval record.
- No operational Slack approval provider or authenticated Slack decision
  boundary is implemented.

## Approved V1 scope

An approval applies to exactly:

- one quote ID;
- one quote version;
- one tier; and
- one exact material commercial state.

It does not authorize other tiers or revisions. Line-level context may be
shown, but the current business gate is the tier’s blended margin.

## Approval authority

Approval authority is a distinct business permission represented by a
governed **Commercial Approver** list or permission.

- It must not be hardcoded to the `admin` role.
- Admin may administer the governed list or permission.
- Slack identity alone never grants authority.
- The decision record captures the Nexus approver and their Commercial
  Approver authority at decision time.

The exact governed representation and initial approver membership must be
approved before implementation.

## Minimum authoritative record

- request ID;
- quote ID;
- quote version number;
- tier ID;
- calculated margin at request;
- configured floor at request;
- material commercial-state fingerprint;
- requester identity and timestamp;
- business reason;
- approver identity and authority evidence;
- approval or rejection;
- decision timestamp;
- request status;
- optional Slack notification/message reference;
- notification status;
- invalidation reason and timestamp when applicable.

Request commercial facts are immutable. Decision and invalidation facts are
write-once. State transitions produce immutable audit evidence.

## Invalidation contract

Approval is invalidated by material quote-economic change, including:

- effective price or price override;
- global or tier price adjustment;
- source cost;
- freight/logistics cost or divisor;
- one-time fee or fee-allocation behavior;
- quantity, tier definition, or component quantity;
- cost-inclusion policy;
- quote revision;
- accepted-tier change.

A later firm-floor policy change does **not** by itself invalidate a previously
granted approval. The approval remains authoritative evidence of the policy
and commercial facts at decision time.

Current acceptance and completion still recalculate current economics. Any
separate rule governing new policy against already approved exceptions must
be an explicit future business decision, not silent invalidation.

## Slack boundary

Slack may provide:

- notification;
- deep-link routing;
- optional status visibility.

Approval occurs through an authenticated Nexus route unless a separately
approved and identity-bound Slack interaction is proven. Slack delivery
failure never creates approval or opens acceptance/completion.

## Gate behavior

Acceptance and completion independently require an approval that:

- matches quote ID, version, tier, and material commercial state;
- is approved and not invalidated;
- was decided by an authorized Commercial Approver;
- retains decision-time authority evidence.

## Failure and retry behavior

- Duplicate requests for the same state converge.
- Notification retries reuse the request.
- First valid terminal decision wins.
- Unauthorized, stale, invalidated, and late responses fail closed.
- Quote changes invalidate pending or approved requests when economically
  material.
- Slack outage leaves the request pending or notification-failed, never
  approved.

## V1 test contract

- below-floor acceptance and completion block without approval;
- matching approval permits the exact tier/version/state;
- rejection remains blocked;
- unauthorized approval fails;
- revision, tier change, price change, or cost change invalidates approval;
- later firm-floor change alone does not erase or invalidate historical
  approval;
- duplicate requests and notifications converge;
- concurrent decisions produce one terminal result;
- stale approval cannot be reused;
- decision and audit evidence remain immutable;
- Slack failure never authorizes progress.

## Classification

- **V1:** authoritative record, governed authority, request/decision lifecycle,
  invalidation, acceptance/completion gates, and audit evidence.
- **V1 when required for launch:** Slack notification and secure Nexus
  deep-link.
- **V1.5:** dashboards, reminders, escalation, and analytics.
- **V2:** generalized multi-department approval orchestration.

## Open business questions

- What governed list or permission represents Commercial Approvers?
- Who administers membership and who are the initial members?
- Is requester self-approval permitted?
- Is one approval always sufficient?
- Is a rejection reason mandatory?
- Is Slack operational availability a launch requirement?
- Which commercial details may appear in Slack?
