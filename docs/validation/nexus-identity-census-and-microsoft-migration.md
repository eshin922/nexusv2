# Nexus identity census — current providers vs intended DPS Microsoft identities

**Status:** census and analysis only. No Clerk user created, no email overwritten,
no `clerk_user_id` written, no row merged, no `ensureUser` change.
**Date:** 2026-08-13
**Correction absorbed:** existing users were created with whatever authentication
worked at the time. `users.email` must **not** be assumed to equal the employee's
DPS Microsoft address.

---

## 1 · Census — established, not inferred

Providers read directly from the Clerk **development** instance (`sk_test`),
GET-only. Business references counted from the live database.

| `users.id` | current email | Clerk provider (actual) | email verification | intended `@thedps.co` Microsoft email | refs |
|---|---|---|---|---|---|
| `029e5318-9991-4b26-90cb-6710e892f743` | `edward.shin@gmail.com` | **Google OAuth** (`oauth_google`) | `verified / from_oauth_google` | **⚠ REQUIRES CONFIRMATION** | **3,349** |
| `e60b5670-86d8-437b-9654-36a1284c7b19` | `edward@thedps.co` | **none — email code** | `verified / email_code` | **⚠ REQUIRES CONFIRMATION** | 62 |
| `6db0401a-e6c4-4085-87d6-f1248055de25` | `edisonlshin@gmail.com` | **Google OAuth** (`oauth_google`) | `verified / from_oauth_google` | **⚠ REQUIRES CONFIRMATION** | 0 |

Roles: `edward.shin@gmail.com` **admin**, `edward@thedps.co` **admin**,
`edisonlshin@gmail.com` `pm`. `commercial_approver` = **false** on all three.
Slack binding `U02GZMEM19N` is on **`edward@thedps.co`**. No user has a password.

### 1.1 Two facts that change the plan

**No user has ever authenticated via Microsoft.** `enterprise_accounts` is
**NONE** on all three, and `external_accounts` carries only Google. The Microsoft
identity path is entirely unexercised — consistent with the connection being
disabled, and it means the cutover has no working precedent to lean on.

**Even the corporate-email row is not a Microsoft identity.**
`edward@thedps.co` was created by **email code** (OTP), with no OAuth and no
enterprise account. Its corporate-looking email is a Clerk email-OTP identity, not
an Entra one. Judging the row by its email domain would have got this wrong —
which is precisely the correction being applied.

**The intended Microsoft address column cannot be filled from any system I can
read.** It is business knowledge. I have deliberately left it as
`REQUIRES CONFIRMATION` rather than guessing a mapping — in particular I have
**not** assumed `edisonlshin@gmail.com` belongs to a second employee, nor that it
maps to any `@thedps.co` address.

---

## 2 · Classification

### (a) Row already uses the intended DPS email
**`edward@thedps.co`** — *pending confirmation that this is the exact Microsoft
UPN/mail value.* Holds the Slack binding and 62 references. Needs only a
`clerk_user_id` rebind, **provided** Entra emits this exact address.

> If the Microsoft mail/UPN differs from `edward@thedps.co` in any way — an
> alias, a `firstname.lastname@` form, a differing UPN — this row falls into
> category (b) instead, and the plan changes. Worth confirming against the real
> token rather than the mailbox display.

### (b) Personal email, same employee
**`edward.shin@gmail.com`** — Google OAuth, **3,349 references**, `admin`.
Previously dispositioned as the same human as `edward@thedps.co`. This is the row
that carries essentially the entire operating history: 2,876 `audit_log`, 153
`user_surface_visits`, 91 `pricing_events`, 61 `quotes.created_by`.

**`edisonlshin@gmail.com`** — Google OAuth, **0 references**. Cannot be
classified without your input: same employee, different employee, or obsolete.
Zero references means it is free to leave, re-point, or remove under any answer.

### (c) New employee, no Nexus row
The designated commercial approvers who are in Slack but have never signed in.
Per finding `500cd24`, their governed identity can only be created by their own
first authenticated login — pre-provisioning remains structurally unavailable and
nothing here changes that.

---

## 3 · The merge-direction decision (the real question)

If `edward.shin@gmail.com` and `edward@thedps.co` are one employee, **two rows
already exist for one human today** — this is a pre-existing split, not something
the cutover creates. The cutover only forces the decision.

`users.email` is `UNIQUE`, so both rows cannot hold `edward@thedps.co`. One must
yield. **Direction dominates cost:**

| Direction | Keep | Must re-point | Blast radius |
|---|---|---|---|
| **Merge into the Gmail row** | `029e5318…` (**3,349** refs) | **62** refs across 12 tables, then free the corporate email and move the Slack binding | **smaller** |
| Merge into the corporate row | `e60b5670…` (62 refs) | **3,349** refs across 24 tables | far larger |

**Keeping the 3,349-reference row and re-pointing the 62 is the smaller
operation by roughly 50×.** It also preserves `users.id = 029e5318…` as the
identity every audit row, quote and pricing event already points at — which is
the stated requirement that the row carrying business history and authority
survives.

That path then needs, in one transaction:
1. re-point 62 references from `e60b5670…` to `029e5318…` across
   `audit_log`, `assemblies`, `netsuite_customer_map`, `projects` (×3 columns),
   `quote_review_events`, `quote_snapshots`, `quotes` (×2), `user_project_visits`,
   `user_surface_visits`;
2. move the Slack binding `U02GZMEM19N` — it is `UNIQUE`, so it must be cleared
   from the old row **before** being set on the new one, within the same
   transaction;
3. delete `e60b5670…` — blocked while any `NO ACTION` reference remains, notably
   its 9 `netsuite_customer_map.verified_by_user_id` rows, so step 1 must be
   complete and verified first;
4. only then set `email = edward@thedps.co` and the new production
   `clerk_user_id` on `029e5318…`.

**Not proposed for execution.** Steps 2 and 3 are order-sensitive in a way that
fails loudly if done wrong (unique violation, FK refusal) — which is the good
case. Step 1 is the one that could silently mis-attribute history if a column is
missed, so it wants an explicit column-by-column checklist derived from the
31-FK inventory rather than an ad-hoc sweep.

---

## 4 · Sequencing — what must be proven before any of this

Per instruction, no Gmail identity is overwritten and no Microsoft user is created
until the production Microsoft path is proven. The order that keeps every step
reversible:

1. **Prove the Microsoft path in isolation.** Enable the connection, have one
   person authenticate, and capture what Entra actually emits — the exact `email`
   value and whether `email_verified` is present. This is the only step that
   answers the category-(a) question above, and it is read-only with respect to
   Nexus: the login will fail at `ensureUser` (§`b5a09df` §3), harmlessly and
   without creating a row.
2. **Confirm the intended Microsoft address per employee** — the column left
   blank in §1.
3. **Then** decide merge direction with those two facts in hand.
4. **Then** rebind, or merge-and-rebind, per §3.

Step 1 costs one broken page and yields the two facts everything else depends on.
Doing it before the mapping decision means the decision is made against the real
token rather than an assumption about it.

**Explicitly not done:** no Microsoft user created, no Gmail identity overwritten,
no email changed, no row merged or deleted, no `commercial_approver` granted, no
`ensureUser` change, no Slack promotion.
