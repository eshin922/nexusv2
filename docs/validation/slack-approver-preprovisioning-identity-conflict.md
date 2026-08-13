# Pre-provisioning a commercial approver before first SSO login — NOT SAFE

**Status:** blocking finding. No repair implemented, no authentication redesigned.
**Date:** 2026-08-13
**Question asked:** can a designated commercial approver exist as a governed Nexus
user — corporate email, `commercial_approver = true`, **no fabricated
Clerk/Microsoft identity** — such that their later first SSO login reconciles to
that same row rather than creating a duplicate?

**Answer: no.** Two independent structural blockers, either sufficient on its own.

---

## Blocker 1 — the row cannot be created without a Clerk identity

```
users.clerk_user_id   NOT NULL   UNIQUE
```

Verified against the live database, not inferred from the model. A governed
`users` row **cannot exist** without a `clerk_user_id`, and the real value is
unknowable until the person's first SSO login. Creating the row early therefore
requires **fabricating** a Clerk identity — explicitly out of bounds.

This is not a policy the code chose; it is a column constraint. No amount of
care at the call site works around it.

## Blocker 2 — even if such a row existed, first SSO login would fail closed

`ensureUser` (`src/lib/auth/ensure-user.ts`) reconciles on **`clerk_user_id`
only**:

1. **Fast path** — `SELECT … WHERE users.clerk_user_id = <external id>`. A
   pre-provisioned row has no matching id, so this misses.
2. **Slow path** — `INSERT … VALUES { clerkUserId, email, … }`
   `.onConflictDoNothing({ target: users.clerk_user_id })`.

**There is no email-based lookup anywhere in the authentication path.** The only
`eq(users.email, …)` in the codebase is in `actions/projects.ts`, mapping HubSpot
deal owners — unrelated to identity provisioning.

So the insert carries the *real* Clerk id and the *same* corporate email. The
conflict target is `clerk_user_id`, which does **not** suppress a violation of:

```
users_email_unique   UNIQUE (email)
```

The insert therefore **throws a unique-constraint violation**. It does not
duplicate, and it does not reconcile — it errors. The approver would be **locked
out of Nexus on every sign-in attempt** until someone manually repaired the row
by hand.

That failure mode is worse than the duplicate the question was guarding against:
a duplicate is visible and repairable, a hard sign-in failure blocks the person
entirely and presents as a generic error.

## Provisioning surface is singular — no alternative path exists

```
grep -rn "insert(users)" src/ scripts/   →   src/lib/auth/ensure-user.ts:69
```

**Exactly one writer** creates `users` rows in the entire tree. There is no admin
invite surface, no seed path, no pre-provision action, and no admin UI that
grants `commercial_approver` (the flag is read by the two below-floor action
files and written nowhere). So the conclusion cannot be routed around by using a
different entry point — there is no other entry point.

---

## Current walk prerequisites — live state

| User | Role | `commercial_approver` | Slack binding |
|---|---|---|---|
| `edisonlshin@gmail.com` | pm | **false** | — |
| `edward.shin@gmail.com` | admin | **false** | — |
| `edward@thedps.co` | admin | **false** | `U02GZMEM19N` |

`firm_settings.slack_approval_channel_id` = `C0BPZSQ96JV` · approval requests: 0

**No user currently holds `commercial_approver = true`** — the temporary grant
raised earlier in this workstream was rolled back as instructed, and nothing has
restored it.

---

## What this means for the controlled walk

The governed chain is unchanged and must stay unchanged:

> verified Slack identity → durably bound Nexus user → `commercialApprover = true`
> → reviewer ≠ requester

Channel membership is **not** approval authority, and nothing here proposes
making it one.

Because pre-provisioning is structurally unavailable, the designated approver's
governed Nexus identity **can only be established by their own first SSO login**.
That is not a convenience requirement invented for the walk — it is the only path
that produces a `clerk_user_id`, and `clerk_user_id` is what the identity model is
keyed on.

**Options, none implemented, for disposition:**

- **A — one real SSO login by a designated approver.** They sign in to Nexus once
  via Microsoft/Clerk, which creates the row correctly. An admin then sets
  `commercial_approver = true`. Their Slack account binds automatically on their
  first callback via the verified-email path. No code change, no fabricated
  identity, no weakened guard. **This is the only option that finishes the walk
  without touching authentication.**
- **B — make pre-provisioning real.** `clerk_user_id` becomes nullable, and
  `ensureUser` gains an email-reconciliation branch that claims a pre-provisioned
  row instead of inserting. This is an **authentication redesign**, explicitly
  excluded from this workstream, and it carries its own risk: an email-keyed
  claim path is a privilege-escalation surface if the identity provider ever
  returns an unverified or attacker-controlled email. It should not be adopted to
  unblock a walk.
- **C — walk with an existing user.** Technically possible (`edward@thedps.co` is
  already Slack-bound) but requires granting `commercial_approver`, and the
  requester would be another account representing the same human — which was
  already ruled insufficient for independent-human approval. It would test the
  **technical** integration only, with the governance claim explicitly NOT tested.

**Recommendation: A.** It is the only option that both finishes the walk and
leaves the identity model exactly as designed.

**Not done:** no authentication redesign, no fabricated Clerk identity, no
`commercial_approver` grant, no weakening of the Slack authority chain.
