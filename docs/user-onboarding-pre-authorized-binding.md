# Pre-authorized first-sign-in binding — user-management closure

**Standing business requirement. Design only — explicitly NOT part of the SSO
cutover.** Recorded 2026-08-21 per Edward's directive.

Scope this only after Edward is through the production path and the
architecture is certified. It is the user-management closure required before
broad employee onboarding — not a step in getting the first user working.

---

## The business requirement

Onboarding a DPS employee must require exactly this, and nothing else:

> **Admin → Users → Add User → corporate email + Nexus authority → Save**

No per-user Clerk administration. No Entra configuration. No secrets. No
invitations. No Vercel work.

## Authority model

| layer | owns |
|---|---|
| **Entra** | proves corporate identity |
| **Clerk** | brokers authentication and session |
| **Nexus** | determines application enrollment and authority |

Each layer answers one question. The binding design below exists so that the
Nexus layer can be provisioned *before* the Clerk layer has ever seen the
person — which is what makes the one-step admin flow possible.

---

## The flow

1. An admin creates a Nexus user row with a unique `@thedps.co` email and the
   intended role and authorities.
2. The row is **explicitly marked pending first sign-in** and carries **no
   Production Clerk binding**.
3. On first Enterprise SSO login, Nexus binds the authenticated Clerk identity
   to that row — but **only** when every condition below holds.
4. Every subsequent login resolves normally by `clerk_user_id`. The pending
   state is consumed once and never returns.

## Binding preconditions — all five required

1. Clerk/SSO supplies the **verified corporate email**.
2. **Exactly one** pending Nexus user exists for that normalized email.
3. The Nexus row has **no existing Clerk binding**.
4. The incoming Clerk id is **not bound elsewhere**.
5. The identity satisfies the normal DPS authorization policy.

Any failure is a refusal, not a fallback. A refusal must be legible — the
operator needs to know an admin has to act, not retry.

## What the binding writes

**Bind `clerk_user_id` only.** Preserve `users.id` and every configured
authority. The row's identity and its permissions predate the binding and are
not derived from it; the binding attaches an authentication handle to an
already-governed record.

This matters for referential integrity: `users.id` is referenced across the
audit log and every historical record. A binding that replaced the row would
orphan them.

## The boundary that keeps this safe

> **This must not become a generic email-rebinding fallback for existing or
> historical users.**

The mechanism is only reachable from the pending state. It is a one-time
transition on a row an admin explicitly provisioned, and it is unreachable for
any row that has ever been bound. If a bound user's Clerk identity changes,
that is an admin action with its own audit trail — never an implicit rebind at
sign-in.

State it as a property to assert, not a convention to remember:

```
for every user row U:
    if U.clerk_user_id IS NOT NULL:
        no sign-in path may write U.clerk_user_id
```

The historical-actor case is the one this protects. `edward.shin@gmail.com`
remains the historical Nexus actor and must not be silently re-pointed by a
tenant sign-in that happens to normalize to a matching address.

## Governance separation

**`role` and `commercial_approver` stay separately governed.** Neither is
derived from the SSO identity, from group membership, or from anything Entra
asserts. Enrollment and authority are the Nexus layer's decision; SSO proves
only who the person is.

---

## Open questions for the scoping slice

| | question |
|---|---|
| Q1 | Does the pending state need an expiry, so a provisioned-but-never-used row cannot be claimed indefinitely? |
| Q2 | What does an admin see for a pending row, and can they revoke before first sign-in? |
| Q3 | Email normalization rule — case folding is obvious; what about plus-addressing and aliases? |
| Q4 | Audit shape: is binding its own action, or a field on the sign-in event? (Recommend its own — it is a state transition, per the transition-not-mechanism naming rule.) |
| Q5 | What happens when precondition 2 fails on *two* pending rows for one email — refuse, or is that unrepresentable via a uniqueness constraint? |

Q5 is worth resolving structurally rather than at runtime: a partial unique
index on normalized email where the row is pending would make the ambiguous
case unrepresentable instead of merely checked.

---

## Cross-references

- `docs/quote-presentation-profile-brief.md` — sibling design-only brief;
  same posture of scoping before implementing.
- CLAUDE.md "Audit action naming — transitions, not mechanisms" — governs Q4.
- `src/lib/auth/ensure-user.ts` — today resolves ONLY by `clerk_user_id`, and
  its insert does not suppress the `users_email_unique` conflict. That is the
  code this design changes, and the reason a naive email-match fallback would
  be the wrong shape.
