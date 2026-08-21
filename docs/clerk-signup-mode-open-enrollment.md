# Production Clerk accepts arbitrary account enrollment

**Banked 2026-08-21. Recorded, not repaired.** Discovered while tracing
`signUpForceRedirectUrl` semantics for PR #329; unrelated to that PR, and
deliberately not changed during its production smoke.

**Updated 2026-08-21 with Clerk's support response**, which settles the
instance-configuration half of this record and narrows the open question. See
"Vendor-confirmed configuration" below.

## The finding

Production Clerk (`clerk.thedps.co`, `ins_3HICAPFehy0D0phy6vy1kg4DATw`) has:

```json
sign_up: { "mode": "public", "progressive": true, "captcha_enabled": true, … }
```

`SignUpModes = 'public' | 'restricted' | 'waitlist'`. Production is on
**`public`**, and `accounts.thedps.co/sign-up` renders a live "Create your
account" form with an email field. Combined with Email verification code —
which is required configuration, not a workaround — **any email address can
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

## Vendor-confirmed configuration

**Clerk support, 2026-08-21 — dispositive.** Email verification code is
**required configuration for the current Clerk architecture**, not a provisional
workaround pending a better answer. The earlier framing in this document was
wrong on that point and is corrected here.

Clerk confirms:

- **Enterprise SSO does not satisfy Clerk's instance-level generic-first-factor
  requirement.** At least one generic first factor must remain enabled.
- **Email verification code is the recommended pattern** for that requirement.
- **For a domain-bound Enterprise identifier such as `@thedps.co`, Clerk
  resolves `supportedFirstFactors: ["enterprise_sso"]` only** — so OTP is never
  offered in the normal DPS flow. This matches what was measured empirically
  before the ticket was answered.
- **Email OTP remains usable through FAPI for identifiers outside an Enterprise
  connection domain.** Hiding it in the Nexus UI does not disable the API
  capability, and should not be mistaken for having done so.

The governed Production Clerk configuration is therefore **settled**:

| factor | state |
|---|---|
| Enterprise OIDC · The DPS Microsoft | **enabled** |
| Email verification code | **enabled** — required, vendor-confirmed |
| Microsoft social | disabled |
| Google | disabled |
| Password | disabled |
| Email verification link | disabled |

**An Enterprise-only / no-generic-factor instance is not to be investigated
further.** Clerk states it is unsupported. The self-inflicted production outage
that surfaced this — disabling both social providers left zero generic first
factors and FAPI rejected the instance with `user_settings_invalid` — was the
empirical form of the same answer.

## The remaining open question

Narrower than when this was first banked. It is no longer about which factors
are enabled; it is only about enrollment mode:

> **Can `sign_up.mode = restricted` close arbitrary Clerk enrollment while still
> allowing first-time DPS Enterprise SSO transfer for a pre-authorized Nexus
> employee?**

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

`restricted` mode permits sign-up only via invitation or allowlist. Whether the
enterprise transfer is exempt is **not established**, and if it is not,
switching would block every new employee's first login while appearing to be a
pure hardening change — discovered one employee at a time.

## What settles it

A test, not a reading. It needs a `@thedps.co` identity that has never signed
in to Production Clerk, so it belongs with **the Jackie onboarding
certification** rather than before it:

1. Set `sign_up.mode = restricted` on Production Clerk.
2. Have the pre-authorized employee complete Continue with The DPS.
3. Transfer succeeds → keep `restricted`; arbitrary enrollment is closed.
4. Transfer fails → revert to `public` and find the supported mechanism
   (domain allowlist, invitation-based provisioning, or whatever Clerk advises)
   before tightening again.

**Do not change sign-up mode before step 2.**

## Related, unresolved

- **`transferable` defaults to `true`.** `TransferableOption.transferable`
  ("prevents opaque sign ups when a user attempts to sign in via OAuth with an
  email that doesn't exist") is the callback-level enrollment lever. We do not
  pass it, so it defaults true — which is what makes first-login onboarding
  work. If enrollment is ever narrowed at the callback, this is the prop, not
  the redirect URLs.

## Cross-references

- `docs/user-onboarding-pre-authorized-binding.md` (#327) — the pending-row
  binding design this interacts with, and the roster whose first member
  certifies the question above.
- PR #329 — the sign-in splash and Enterprise SSO initiation path. Its
  production certification **remains valid and closed**; this finding was
  surfaced by, but is not caused by, that work.
