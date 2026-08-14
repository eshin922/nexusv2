# Slack enablement — Step 0 package

**Scope: establish the secure transport and identity boundary for governed Nexus
approvals.** Below-margin approval is the first consumer. This is not a general
notification platform.

**Nothing implemented.** This package is for review.

---

## 1 · Current Slack integration state — verified, not assumed

**There is none.** Verified from zero:

| Checked | Result |
|---|---|
| `@slack/*` in `package.json` | **none** |
| `node_modules/@slack` | **not installed** |
| `SLACK_*` env references in `src/` `scripts/` | **none** |
| Slack API route | **none** — the only routes are `certification-status`, `dev/dump-deal-props`, `import/cache-status`, `quotes/[quoteId]/customer-pdf` |
| OAuth flow / workspace install / bot token / signing secret | **none** |
| Slack user identity mapping | **none** — `users` has `clerkUserId`, `email`, `role`, `commercialApprover`, `hubspotOwnerId`; no Slack column |

Every `slack` hit in the codebase is a **comment or UI string**, not integration.

### ⚠ Finding — live UI already claims Slack behaviour that does not exist

`src/components/mark-accepted/mark-accepted-pending.tsx` and
`mark-accepted-both-gates.tsx` render, verbatim:

> "Slack DM sent · waiting on admin approval"
> "Override request pending · **Slack DM sent to sales leadership.**"
> "You'll be notified in Slack and in-app the moment approval …"
> "Approval logs back via Slack reaction or button click"

They are rendered by `mark-accepted-host.tsx`, which is rendered by
`/projects/[id]/quotes/[quoteId]/mark-accepted/page.tsx` — a route that **still
exists and does not redirect**. No Slack integration exists, so **no DM was ever
sent**. This is the Pattern 45 class: an operator-facing surface asserting an
external action that did not occur.

Mitigating: the governed acceptance path is the Quote umbrella
(`tab-mark-accepted.tsx`), which shares none of these components. The legacy
route is reachable by URL but is not the primary path.

**Banked, not fixed** — flagged for disposition alongside this work, since the
copy becomes true only once this integration ships.

---

## 2 · Recommended architecture

**A single-workspace internal Slack app with a bot token. No OAuth
distribution flow.**

Nexus serves one workspace (The DPS). A single-workspace app is installed
directly from its own configuration page and yields a bot token immediately —
**the entire OAuth authorization-code flow, redirect URL, token storage and
refresh machinery is unnecessary**. OAuth is only required to distribute an app
to workspaces you do not control.

**HTTP interactivity, not Socket Mode.** Socket Mode avoids exposing a public
URL but requires a persistent WebSocket process. Nexus runs on Vercel
serverless functions, so Socket Mode is **not viable**. Approvals therefore
require a public HTTPS callback secured by Slack request signing (§8).

**What V1 does NOT need:** Events API subscriptions, slash commands, user
tokens, `im:write`/DMs, message shortcuts, workflow steps, or a Slack app
manifest beyond the two endpoints below.

---

## 3 · Manual Slack administrator setup

**Everything in this section is yours to perform.** No Nexus code involved.

1. **Create the app** — api.slack.com/apps → *Create New App* → *From scratch*.
   Name e.g. `Nexus Approvals`, pick The DPS workspace.
2. **Add bot scopes** — *OAuth & Permissions* → *Bot Token Scopes* (§4).
3. **Install to workspace** — *Install to Workspace*, approve. This produces the
   **Bot User OAuth Token** (`xoxb-…`).
4. **Copy the Signing Secret** — *Basic Information* → *App Credentials*.
5. **Enable Interactivity** — *Interactivity & Shortcuts* → on → set the
   **Request URL** (§6). Slack sends a verification challenge; the endpoint must
   exist and verify signatures before this will save.
6. **Create/choose the approval channel**, and **invite the bot** to it
   (`/invite @Nexus Approvals`). Provide the **channel ID** (`C…`, from
   *View channel details → About → bottom*).
7. **Confirm reviewer emails** — each authorised reviewer's Slack account email
   must match their Nexus `users.email` (§9).

**Optional second app for local development** — see §7.

---

## 4 · OAuth scopes required

Bot token scopes only. Minimum for V1:

| Scope | Why |
|---|---|
| `chat:write` | post the approval request, and update it after disposition |
| `users:read` | resolve the acting Slack user |
| `users:read.email` | obtain that user's email — the identity bridge to a governed Nexus user |

`chat:write.public` is **not** required if the bot is invited to the channel
(step 6), which is the cleaner posture — it keeps the bot's reach to exactly one
channel rather than every public channel.

No user scopes. No `channels:read`, no `im:write`.

---

## 5 · Credentials Nexus needs

Environment variables — secrets, therefore per-environment, never in the repo:

| Variable | Source | Notes |
|---|---|---|
| `SLACK_BOT_TOKEN` | step 3 (`xoxb-…`) | posting + `users.info` |
| `SLACK_SIGNING_SECRET` | step 4 | verifies every inbound callback |

**The channel is NOT a secret and must not live in env or in code.** See §8.

Absence must fail closed: with either variable unset, approval **requests**
cannot be posted — and per the governance rule, a failed post must never
authorize anything (Send gating is unaffected because it consults Nexus state,
not Slack).

---

## 6 · Request URLs Nexus must expose

| Purpose | Route | Auth |
|---|---|---|
| Approve / Reject button callbacks | **`POST /api/slack/interactivity`** | **public route + Slack signature verification** |

That is the only endpoint V1 requires. No OAuth redirect URL (single-workspace
install), no Events endpoint.

**Middleware change required.** `src/lib/auth/production-middleware.ts` gates
everything behind Clerk except an explicit allowlist
(`isPublicRoute`, currently `/sign-in(.*)` and `/api/certification-status`).
Slack cannot carry a Clerk session, so the interactivity route must be added to
that allowlist — and its security then rests **entirely** on signature
verification (§8). This is a deliberate, reviewable widening of the public
surface, not an incidental one.

---

## 7 · Local development vs deployed

Slack must reach the callback over public HTTPS. Outbound posting works fine
from localhost; **interactivity does not**.

**Slack permits exactly one Interactivity Request URL per app.** So:

- **Deployed (Vercel)** — the production app points at the deployed URL. This is
  where interactivity is genuinely exercised.
- **Local** — requires either a tunnel (`cloudflared` / `ngrok`) *and* a
  **second, separate Slack dev app** pointing at the tunnel, or simply not
  testing interactivity locally.

**Recommendation for V1:** one production app; develop the posting side locally
against a private test channel; exercise Approve/Reject on a Vercel preview
deployment. A second dev app is only worth creating if callback iteration proves
slow — and it doubles the admin setup.

---

## 8 · Channel configuration model

**`firm_settings`** — the existing versioned, admin-editable home for firm
policy (target/floor margin, payment terms, incoterms all live there). Add one
column, e.g. `slack_approval_channel_id`.

Rationale: the channel is **configuration, not a secret** — it belongs where an
admin can change it without a deploy, and where the change is versioned and
audited like every other firm policy. Env vars are for credentials.

**Do not hardcode channel IDs or reviewer identities in application logic.**

⚠ `firm_settings` is versioned — per the standing carry-forward rule, any new
column must be carried forward by `versionedFirmSettingsUpdate`, or a later
margin edit silently nulls it.

---

## 9 · Slack-user → Nexus-user identity strategy

**Slack identity alone is never sufficient.** The chain must terminate in a
governed Nexus user with authority.

Nexus already has the authority flag: **`users.commercialApprover`** (boolean,
default false). Nothing new is needed to express "authorised reviewer".

**Proposed resolution, fail-closed at every step:**

1. Slack's interaction payload supplies `user.id` (`U…`).
2. Resolve that to an email via `users.info` (`users:read.email`).
3. Match the email to `users.email` (unique) → a governed Nexus user.
4. **Require `commercialApprover === true`** on that user.
5. **Require the reviewer is not the requester** (self-approval prohibition).
6. Persist the resolved `slack_user_id` on `users` on first successful action —
   a durable binding for audit and a fast path afterwards.

Any step failing ⇒ **reject the callback, post an ephemeral error to the
reviewer, change no Nexus state.**

Step 6 implies a second small schema addition: `users.slack_user_id` (nullable,
unique). An admin may also pre-populate it, which makes step 2 unnecessary for
pre-mapped users — but the email path must remain as the bootstrap.

---

## 10 · Security boundary

The interactivity endpoint is **public** — it must therefore authenticate
Slack itself, cryptographically, on every request:

1. Read `X-Slack-Request-Timestamp`; **reject if older than 5 minutes** (replay
   window).
2. Compute `HMAC-SHA256(signing_secret, "v0:{timestamp}:{raw_body}")`.
3. Compare to `X-Slack-Signature` in **constant time**.
4. Reject on any mismatch, before parsing the payload or touching the database.

Requires the **raw request body** — Next.js route handlers must read
`await req.text()` and parse afterwards; parsing first breaks the signature.

Further boundaries, all of which sit *inside* Nexus and none of which Slack can
weaken:

- **Slack decides nothing.** The callback invokes the existing governed action;
  authority, self-approval and state checks are evaluated in Nexus.
- **Nexus audit is authoritative**, not Slack message history.
- **Slack delivery failure cannot bypass Send gating** — gating reads Nexus
  authorization state, which a failed post never creates.
- **Callbacks must be idempotent** — Slack retries on timeout, so a duplicate
  Approve must not produce a second authorization.
- The endpoint must return within Slack's **3-second** window; slower work
  belongs behind an immediate acknowledgement.

---

## 11 · What this does NOT cover

This package establishes the **capability boundary only**. The approval
workflow design — request lifecycle, message content, failure semantics, and the
gap analysis against the existing Track A machinery — follows once you approve
this.

**One finding from the trace is worth stating now, because it sizes that work:**
`below_floor_authorizations` is a **decision-only** model. Its own schema comment
is explicit — *"There is no request lifecycle … no asynchronous request, no
routing, no Slack, no quorum. An authorized approver decides; the gates consult
the decision."* There is no pending state, no requester identity, and **no
representation for a rejection**. Slack does not merely add a delivery surface
to an existing request flow; the request flow is the part that does not exist
yet. That is the substance of the next package.
