# Governance finding — self-approval is enforced by user identity, not human identity

**Status: OPEN · recorded 2026-08-13 · documentation only.**
**Classification: deferred identity/governance work.**

No repair implemented. The self-approval implementation, both Ed Shin accounts,
the binding-conflict guard and all authorization state are **unchanged**.

---

## The finding

The independent-approval control is enforced as:

```ts
decided_by_user_id !== requested_by_user_id
```

That is a comparison of **Nexus user records**, not of **people**. Where one
human holds two Nexus user records, the invariant is satisfied while the control
it exists to enforce is not.

Two enforcement points, both keyed the same way:

- `evaluateApprovalDecision` — `actor.userId === request.requestedByUserId`
  (`src/lib/below-floor-approval-request.ts`)
- `evaluateBelowFloorAuthorization` — `actingUserId` vs the authorization's
  approver (`src/lib/below-floor-authorization.ts`), the Track A gate

Neither is wrong about what it compares. Both are silent about who is behind it.

## Observed configuration and evidence

The condition exists in the live estate **today**, found during Slack controlled-walk
preflight:

```
029e5318-9991-4b26-90cb-6710e892f743   edward.shin@gmail.com   "Ed Shin"   admin
e60b5670-86d8-437b-9654-36a1284c7b19   edward@thedps.co        "Ed Shin"   admin

users with any slack binding : 0
commercial approvers          : 0
```

Both records are the **same human**. The mismatch is intentional and temporary —
the `@gmail.com` record is the current Nexus login pending the Microsoft
OAuth/SSO migration.

**How it surfaced.** During preflight a walk configuration was proposed using
`029e5318` as requester and `e60b5670` as reviewer. It passes every technical
check: two distinct UUIDs, two distinct emails, a genuine signed Slack callback
from a real Slack account. Edward rejected it on the substance — both accounts
are him.

**Nexus could not have caught this.** It took a human who knew whose accounts
those were. There is no field, constraint or check in the system that relates
the two records, and the resulting audit trail would have looked impeccable:
distinct requester, distinct approver, distinct emails, valid signature,
mandatory reason captured.

## Business / control risk

The below-floor floor exists so that pricing beneath the firm's governed margin
requires a **second person's** judgement. This finding means that control can be
satisfied without a second person ever being involved — not by circumventing the
system, but by using it exactly as built.

Two properties make it materially worse than an ordinary gap:

1. **It is invisible after the fact.** Every artifact a reviewer or auditor would
   inspect — the audit rows, the approval record, the Slack message, the
   signature — is genuine and consistent. There is nothing to notice.
2. **It reconciles perfectly.** Same class as the standing rule *"exact
   reconciliation is necessary but not sufficient"*: the numbers, the identities
   and the evidence all agree, while the substance is wrong.

Present exposure is limited — the estate has **zero commercial approvers**, so
no below-floor decision can succeed at all today. The risk is realised the moment
`commercial_approver` is granted to any account belonging to a human who holds
another account.

## Why the binding-conflict guard does not solve this

The Slack binding-conflict guard **is not a control on this axis**, and its
apparent relevance here is coincidental.

What it governs: *does this Slack account map to the Nexus user it is bound to?*
It compares the Slack account's verified email against the bound Nexus user and
fails closed on disagreement. It says nothing about whether two **Nexus** users
are the same person.

It happened to refuse the proposed binding above — but for an unrelated reason:
the Slack email (`edward@thedps.co`) resolved to a different Nexus record than
the proposed binding target (`edward.shin@gmail.com`). That is an email
disagreement, not a same-human detection.

**The guard would have passed cleanly** on a configuration with the identical
control defect — for example one human holding `ed@thedps.co` and
`edward@thedps.co`, with Slack bound to whichever matched. Nothing would have
refused, and self-approval would have been fully defeated. Treating this guard as
mitigation would be relying on a coincidence.

## Current mitigation

**Controlled approval walks require a genuinely different human reviewer.**
Procedural, human-enforced, and adequate only because the estate currently has
zero commercial approvers and every walk is individually authorised.

It does not scale, and it is not a control — it is a person paying attention.

## Likely remediation boundary

The repair belongs upstream of the approval logic, not inside it:

- **Canonical identity consolidation during the Microsoft OAuth/SSO migration** —
  the duplicate arises from a temporary login arrangement, and SSO is the natural
  point at which one human resolves to one Nexus user. This removes the condition
  rather than detecting it.
- **Or a governed same-human identity mechanism** — an explicit link between user
  records (a person entity, or a verified-alias relation) that the self-approval
  comparison consults instead of comparing raw user ids.

Explicitly **not** recommended: heuristic matching on name, email similarity or
login metadata. A control that infers human sameness from a fuzzy signal fails
in both directions — blocking legitimate distinct approvers who look similar, and
admitting duplicates that do not.

## Scope held

Not implemented, and deliberately so. No change to the self-approval
implementation, no identity merge, no modification to either Ed Shin account, no
authorization change. The Slack controlled walk remains at its existing boundary
pending selection of an independent reviewer.

**Cross-references:** `slack-enablement-package.md`,
`below-floor-approval-lifecycle-package.md`, and the standing rule *"exact
reconciliation is necessary but not sufficient"*.
