# Clerk Production cutover — identity-continuity boundary

**Status:** analysis only. Nothing implemented, no schema changed, no `ensureUser`
change, no Clerk user created, no `clerk_user_id` written.
**Date:** 2026-08-13
**Trigger:** Clerk Production carries a **disabled** Enterprise Custom OIDC
connection (`The DPS Microsoft`, domain `thedps.co`, tenant-specific Entra v2
discovery, callback `https://clerk.thedps.co/v1/oauth_callback`). No credentials
entered; nobody has authenticated through it.

---

## 1 · The three existing users rows

| `users.id` | email | `clerk_user_id` | admin | `commercial_approver` | `slack_user_id` | created |
|---|---|---|---|---|---|---|
| `029e5318-9991-4b26-90cb-6710e892f743` | `edward.shin@gmail.com` | `user_3D0A5PORXEkXhgGjpGXy7J9vExN` | **true** | false | NULL | 2026-04-28 |
| `e60b5670-86d8-437b-9654-36a1284c7b19` | `edward@thedps.co` | `user_3FewGyAxn0W421Ja4ANvnkcsayj` | **true** | false | `U02GZMEM19N` | 2026-06-26 |
| `6db0401a-e6c4-4085-87d6-f1248055de25` | `edisonlshin@gmail.com` | `user_3D0BYLNKMgAVObYG1y20oGu0MJZ` | false | false | NULL | 2026-07-15 |

### 1.1 Development or Production instance?

**All three are development-instance identities.** Established, not assumed:

1. Local config is `pk_test_…` / `sk_test_…` — a **development** instance.
2. Production authentication demonstrably works today — the attach-product
   incident was a real signed-in production operator action, and
   `edward.shin@gmail.com` carries **2,876 `audit_log` rows**.
3. A Clerk **production** instance cannot serve authentication before its domain
   resolves, and IT only just added the `clerk.thedps.co` CNAME records.

(1)+(2)+(3) admit only one conclusion: production has been running on the
**development** instance, and every stored `clerk_user_id` was minted there.

**Direct confirmation available to you, which I cannot read from here:** the
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` value in the Vercel **Production**
environment. If it begins `pk_test_`, the inference is confirmed outright.

**Consequence:** the Production instance has a **separate user pool**. Every
person who signs in through it receives a **new** `clerk_user_id`. This is not a
risk to monitor — it is a certainty of the cutover.

---

## 2 · What makes row replacement unsafe — 31 foreign keys

**31 foreign keys reference `users.id`.** Live reference counts:

| user | total referencing rows | heaviest |
|---|---|---|
| `edward.shin@gmail.com` | **3,349** | `audit_log`=2876, `user_surface_visits`=153, `pricing_events`=91, `quotes.created_by`=61 |
| `edward@thedps.co` | **62** | `audit_log`=30, `netsuite_customer_map.verified_by`=9 |
| `edisonlshin@gmail.com` | **0** | — |

Nine of the 31 are `ON DELETE NO ACTION` / `RESTRICT` — including
`assemblies.owner_id`, `leaves.owner_id`, `leaf_specs.created_by/updated_by`,
`quote_attachments.uploaded_by_user_id`, `quote_warnings.accepted_by_user_id`,
and **all three below-floor approval/authorization columns**. Those block
deletion outright. Three are `ON DELETE CASCADE` (`user_pinned_projects`,
`user_project_visits`, `user_surface_visits`) — deletion would **silently
destroy** navigation history rather than refuse.

**Therefore: never replace the row.** But note the shape of the problem —
`users.id` is what all 31 FKs reference; `clerk_user_id` is only an
authentication binding. **Rebinding the auth identity does not touch a single
foreign key**, because `users.id` never changes. The safe operation is an
`UPDATE` of one column, not a migration.

---

## 3 · Exactly what happens today on first Production login

`ensureUser` (`src/lib/auth/ensure-user.ts`), for `edward@thedps.co` arriving
with a new Production `clerk_user_id`:

1. **Fast path** — `SELECT … WHERE clerk_user_id = <new prod id>` → **0 rows**
   (the stored id is the dev-instance one).
2. **Slow path** — `INSERT … VALUES { clerkUserId: <new>, email:
   'edward@thedps.co', … }` `.onConflictDoNothing({ target: clerk_user_id })`.
3. `clerk_user_id` does **not** conflict — it is genuinely new.
   `users_email_unique` **does**.
4. The conflict target is `clerk_user_id`, so it does **not** suppress the email
   violation → the INSERT **throws**.
5. The error propagates out of `ensureUser`. No row is created; the aborted
   statement leaves no partial state.

**Blast radius: total.** `ensureUser` runs on essentially every authenticated
request (`recordSurfaceVisit` and friends call it per surface), so the person is
locked out of the whole application, not one page.

**Diagnostic trap:** authentication *succeeds* — Clerk and Microsoft both did
their jobs — and Nexus fails immediately afterward. It presents as a generic
error page and reads exactly like an OAuth defect. It is not one. The
discriminator is whether a `users_email_unique` violation appears in the server
logs.

---

## 4 · Minimum safe cutover

The goal is: **preserve `users.id` and all 3,411 business references; replace only
the authentication binding.**

```sql
UPDATE users SET clerk_user_id = '<new production id>' WHERE id = '<uuid>';
```

One column, one row, zero FK impact. The entire difficulty is **obtaining the new
production id**, since `clerk_user_id` is `NOT NULL UNIQUE` and the value is
minted by Clerk.

### 4.1 What evidence can supply the new id, and when

| Source | Available before `ensureUser` runs? | Notes |
|---|---|---|
| **Clerk Dashboard / Backend API, after a first sign-in attempt** | **Yes — after one failed attempt** | The Clerk user is created by the authentication itself. The Nexus insert fails, but the Clerk user now exists and its id is directly readable. **No code, no scripting.** |
| **Clerk Backend API `POST /v1/users` pre-creation** | Yes | Clerk **mints a real id** — this is not fabrication. Requires the Production `CLERK_SECRET_KEY`, and depends on Clerk linking the later SSO login to that user by verified email. If linking does not apply to enterprise connections, Clerk creates a *second* user and the pre-bound id is wrong. |
| **`user.created` webhook** | **No — cannot be relied on** | See §4.2. |

### 4.2 Webhooks do not solve the ordering problem

Inspected, not assumed:

- **No webhook receiver exists** — `src/app/api/` contains only
  `certification-status`, `dev`, `import`, `quotes`, `slack`.
- **`svix` is not a dependency** (`package.json` carries `@clerk/nextjs` only), so
  Clerk webhook signature verification cannot even be performed today.

Beyond the missing implementation, the ordering is the real objection: a webhook
is **asynchronous and unordered relative to the user's own browser redirect**.
After sign-in, Clerk redirects the browser to the app, and that request reaches
`ensureUser` within milliseconds. A webhook may arrive before, during, or after.
Building one would mean building a mechanism whose central guarantee — *arriving
first* — it does not provide.

A webhook is a fine **reconciliation** channel. It is not a pre-authorization
one, and it should not be introduced to solve this.

---

## 5 · Options, smallest first

### Option A — attempt, read, rebind, re-attempt (RECOMMENDED)

1. Enable the connection; the person signs in once. **The attempt fails** with a
   Nexus error. Clerk has now created the Production user.
2. Read that user's id from the Clerk Dashboard (or Backend API by email).
3. `UPDATE users SET clerk_user_id = '<new>' WHERE id = 'e60b5670-…';`
4. They sign in again — fast path matches, no insert is attempted.

**Zero code change. Zero schema change. No fabricated id. No duplicate. No FK
touched.** `users.id` and all 62 references survive untouched.

**Failure modes:** the person sees one broken page (acceptable for a controlled
cutover with three users); and the operation must be done per user, so it does
not scale to a large org — but this org has one corporate identity to move.

**Verify after step 3, before step 4:** exactly one row updated, and no second
row exists for that email.

### Option B — pre-create the Clerk user via Backend API

Mint the Production user through Clerk first, rebind, then sign in — avoiding the
visible failure. **Failure mode:** if Clerk does not link the enterprise SSO login
to the pre-created user by verified email, a *second* Clerk user is created, the
rebound id is stale, and you land back in §3 with an extra orphan Clerk user to
clean up. This trades a known, harmless one-time error for an unverified
assumption about linking behaviour. Not worth it for three users.

### Option C — change `ensureUser` to reconcile by verified email

Durable and correct for onboarding at scale, and it would also remove the
pre-provisioning blocker from `500cd24`. **Explicitly out of scope here**, and it
carries a real security property to design deliberately: an email-keyed claim path
is a privilege-escalation surface if the IdP ever returns an unverified or
attacker-controlled email. It must gate on `email_verified`, which is precisely
one of the open Entra questions. **Do not adopt it to unblock a cutover.**

---

## 6 · The larger finding: two of three users cannot authenticate at all

The connection's domain is **`thedps.co`**. Only **one** user carries a corporate
address:

| user | can sign in via The DPS Microsoft? | references at stake |
|---|---|---|
| `edward@thedps.co` | **yes** | 62 |
| `edward.shin@gmail.com` | **no** — personal Gmail | **3,349** |
| `edisonlshin@gmail.com` | **no** — personal Gmail | 0 |

So the cutover does not merely rebind three identities. **The row holding 3,349
references — including 2,876 audit rows and 61 quote-creation records, and holding
`admin` — is on a personal email with no path through corporate SSO.**

That history is not lost, and nothing here endangers it: the row stays, and every
FK keeps resolving. But after cutover it is attached to an identity nobody can
authenticate as, while the same human signs in as `edward@thedps.co` — a row with
62 references. Given the earlier disposition that both accounts represent the same
human, this is an **identity-consolidation** question, and it is genuinely
separate from the cutover.

It does **not** block the Slack walk, which needs `edward@thedps.co` only. It
should be decided deliberately rather than discovered later, and consolidating
3,349 references across 24 tables is not something to improvise. `edisonlshin@`
has zero references and is therefore free to leave, delete, or re-point at any
time.

**Not proposed here.** Flagged for its own disposition.

---

## 7 · Preserved — remaining Entra requests for the final IT ask

No new Entra app. No multitenant conversion. Against the **existing**
single-tenant Nexus registration:

1. Add redirect URI **`https://clerk.thedps.co/v1/oauth_callback`**.
2. Rotate / provide the **Client Secret** for the Clerk connection.
3. Confirm the ID token emits the **corporate email claim**. Entra v2 does not
   reliably emit `email`; it depends on the user's `mail` attribute being
   populated or `email` being added as an **optional claim** in Token
   configuration. Clerk maps `email → emailAddress`, and Nexus's identity
   contract types `email` as non-nullable — so an absent claim breaks
   provisioning regardless of Clerk's mapping being correct.
4. Confirm what Microsoft emits for **email verification** under this OIDC
   configuration. Clerk maps `email_verified → emailAddressVerified`. This matters
   beyond the cutover: it is the security precondition for Option C, and it is
   already load-bearing for the **Slack binding**, which resolves a verified Slack
   email to a Nexus user. If Entra does not emit `email_verified`, that needs to
   be understood before either path relies on it.
