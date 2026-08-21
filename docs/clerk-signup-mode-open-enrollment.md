# Production Clerk accepts arbitrary account enrollment

**Banked 2026-08-21. Recorded, not repaired.** Discovered while tracing
`signUpForceRedirectUrl` semantics for PR #329; unrelated to that PR, and
deliberately not changed during its production smoke.

## The finding

Production Clerk (`clerk.thedps.co`, `ins_3HICAPFehy0D0phy6vy1kg4DATw`) has:

```json
sign_up: { "mode": "public", "progressive": true, "captcha_enabled": true, … }
```

`SignUpModes = 'public' | 'restricted' | 'waitlist'`. Production is on
**`public`**, and `accounts.thedps.co/sign-up` renders a live "Create your
account" form with an email field. Combined with Email verification code —
enabled as the Clerk instance-validity prerequisite — **any email address can
create a Clerk user in the production instance.**

## What this does and does not expose

**Nexus is not exposed.** `production-middleware.ts` revokes any session whose
email fails the `@thedps.co` check (or `ALLOWED_EMAILS`) and redirects to
`/sign-in?error=unauthorized`. An arbitrary Clerk account reaches nothing. The
new splash never links to sign-up either.

**The identity provider is exposed.** Arbitrary Clerk users can be created.
That is the same category of unintended alternate path as the Microsoft social
`/common` provider closed earlier the same day — it stayed invisible because
the social providers were the louder problem.

**This is not an acceptable final state.** It is recorded as open, not
tolerated.

## Why it was not tightened immediately

Because tightening it might break the thing it is meant to protect, and that is
a question with an answer rather than a guess.

**First-time Enterprise SSO onboarding goes through a sign-up transfer.**
Established from the installed SDK (`@clerk/types` 4.101.23):

```ts
// SignInResource
readonly isTransferable: boolean;
//  "Indicates that there is NOT a matching user for the first-factor
//   verification used, and that the sign-in can be transferred to a sign-up."

type VerificationStatus = … | 'transferable' | …;

type HandleOAuthCallbackParams = TransferableOption
  & SignInForceRedirectUrl & SignInFallbackRedirectUrl
  & SignUpForceRedirectUrl & SignUpFallbackRedirectUrl
  & { reloadResource?: 'signIn' | 'signUp';
      unsafeMetadata?: SignUpUnsafeMetadata; … };
//  unsafeMetadata: "stored alongside the User object when a SIGN-UP TRANSFER
//  occurs."
```

So a never-before-seen `@thedps.co` employee signing in for the first time is
routed through Clerk's **sign-up** object. `restricted` mode permits sign-up
only via invitation or allowlist. Whether the enterprise transfer is exempt
from that restriction is **not established** — and if it is not, switching to
`restricted` would block every new employee's first login while appearing to
be a pure hardening change.

That is the failure mode worth avoiding: a security tightening that silently
breaks onboarding, discovered one employee at a time.

## What settles it

A test, not a reading. It needs a second DPS identity that has never signed in
to Production Clerk, which is why it belongs with roster onboarding rather than
before it:

1. Set `sign_up.mode = restricted` on Production Clerk.
2. Have a never-before-seen `@thedps.co` employee complete Continue with The DPS.
3. If the transfer succeeds and a Clerk user is created → `restricted` is safe;
   keep it, and open enrollment is closed.
4. If it fails → revert to `public` and find the supported mechanism
   (allowlist by domain, invitation-based provisioning, or whatever Clerk
   support advises) before tightening again.

**Do not tighten before step 2 passes.**

## Related, unresolved

- **`transferable` defaults to `true`.** `TransferableOption.transferable`
  ("prevents opaque sign ups when a user attempts to sign in via OAuth with an
  email that doesn't exist") is the callback-level enrollment lever. We do not
  pass it, so it defaults true — which is what makes first-login onboarding
  work. If enrollment is ever narrowed at the callback, this is the prop, not
  the redirect URLs.
- **Email verification code** remains enabled as the Clerk instance-validity
  prerequisite (Clerk rejects an instance with zero generic first factors —
  `user_settings_invalid`, at FAPI, for custom flows too). A Clerk support
  ticket asking whether an Enterprise-SSO-only instance is supported was filed
  2026-08-21; its answer may remove both this dependency and part of this
  finding.

## Cross-references

- `docs/user-onboarding-pre-authorized-binding.md` (#327) — the pending-row
  binding design this interacts with, plus the unresolved `userRole` enum gap
  for Logistics / Finance / Sales.
- PR #329 — the sign-in splash and Enterprise SSO initiation path. This finding
  was surfaced by, but is not caused by, that work.
