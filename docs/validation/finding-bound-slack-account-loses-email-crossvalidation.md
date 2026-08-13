# Finding — a bound Slack account loses email cross-validation silently

**Status: OPEN · recorded 2026-08-13 · documentation only. Not implemented.**
**Do not expand the current Slack controlled walk to repair this.**

---

## Observation

Once `users.slack_user_id` is bound, the binding is cross-validated against the
Slack account's verified email **only when that email resolves to an existing
Nexus user**. In two distinct situations it is trusted without any check:

1. **Slack `users.info` is unavailable** — the call throws, the handler catches,
   and `emailUser` becomes `null`.
2. **The Slack email matches no Nexus user** — the lookup succeeds and returns
   nobody, so `emailUser` is `null`.

The guard short-circuits on the same expression in both cases
(`src/lib/below-floor-approval-request.ts`):

```ts
if (boundUser) {
  if (emailUser && emailUser.id !== boundUser.id) → binding_conflict
  return ok(boundUser)          // ← reached whenever emailUser is null
}
```

`emailUser &&` is the hinge. With no `emailUser` there is nothing to compare, so
a **wrong pre-established binding is never detected** and the Slack account
silently carries the bound user's authority.

## Why the two cases must not be conflated

They produce identical behaviour and mean opposite things:

- an **outage** is an instrument failure — the system learned nothing;
- an **unmatched email** is a durable fact about identity — the system learned
  something, and what it learned is that the binding cannot be corroborated.

This is the same shape as the standing rule banked from OD-027: *a lookup
wrapper that catches errors and returns "missing" cannot establish nonexistence,
because it reports the same value for "deleted" and "the call failed."* Here the
conflation is one level up — not "does this record exist" but "can this binding
be corroborated" — and the cost is that a real absence of corroboration is
indistinguishable from a transient failure to look.

## What is deliberate, and what is not

**Deliberate and correct:** an unavailable `users.info` must not revoke a bound
approver. Failing closed on an outage would make a Slack incident silently
disable below-floor approvals, which is worse than the exposure it removes. The
inline comment says exactly this and should stay.

**Not deliberate:** case 2 inherits case 1's leniency for free. A Slack email
that corresponds to nobody in Nexus is not a transient condition, and treating it
as "no evidence either way" is a weaker posture than the code intends. Nothing
distinguishes them today.

## Current mitigation

**Reviewer eligibility is now a test-quality requirement, not convenience:** a
controlled-walk reviewer's Slack email must resolve to the *same unique Nexus
user* as their Nexus login. That places the binding squarely in the case where
live `users.info` genuinely cross-validates it during the callback.

Expressed as the preflight verdict already in use:

| Slack email resolves to | Verdict |
|---|---|
| the same Nexus user | **SAFE** — binding is cross-validated at callback |
| no Nexus user | **UNVERIFIED** — binding trusted without check |
| a different Nexus user | **CONFLICT** — refused |

This is a selection rule for who may act as reviewer. It does not change the
code's behaviour for anyone else.

## Likely remediation boundary

Separate the two nulls so the code can tell "I could not look" from "I looked and
found nobody" — the same distinction OD-027 required (`exists` /
authoritative `not_found` / `read_failed`, with the third INDETERMINATE). A
lookup failure would keep today's lenient behaviour; an authoritative
no-such-user against a bound account is a different question and deserves its own
answer, which may be to refuse, to warn, or to require the binding be
administratively re-confirmed.

Not decided here, and deliberately not implemented — the right answer depends on
how bindings are administered once Microsoft OAuth/SSO lands, which is also the
boundary named in the sibling self-approval finding.

**Cross-references:**
`governance-finding-self-approval-identity-vs-human.md`,
`below-floor-approval-lifecycle-package.md`, and the OD-027 lesson on lookup
wrappers that cannot establish nonexistence.
