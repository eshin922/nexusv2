# Shared Nexus sandbox rollout

Status: in progress, 2026-10-12. This is a separate team environment, not the
local disposable validation harness and not the production cutover.

## Created

- Supabase organization **The DPS Sandbox**, Free plan.
- Supabase project **nexusv2-sandbox**, ref `awmnppovoyghaocrjfck`, West US
  (Oregon), healthy at creation. Automatic exposure of new public tables was
  disabled. No Nexus schema or data has been loaded yet.
- Private `quote-pdfs` storage bucket created and verified in the sandbox;
  the `quote-attachments` bucket and its policies remain part of the manual
  schema setup.
- A Git-ignored local `.env.local` exists in the dedicated worktree
  `C:\Code\nexusv2-library-index`. It contains the project URL and blank
  credential slots. It does not contain production credentials.

## Cost boundary

- Supabase Free supplies at most two active free projects across organizations
  where the owner is an owner or administrator, 500 MB database, and 1 GB file
  storage. Inactive free projects can pause after seven days. The new project
  occupies the remaining free slot as observed on the dashboard.
- The current Vercel team is Hobby. Vercel restricts Hobby to non-commercial
  use, so the team sandbox must not be deployed there.
- Edward selected Netlify Free for the shared app. Its free plan permits
  commercial projects and has a hard 300-credit monthly cap; a site pauses at
  that cap rather than charging automatically. Netlify's Next.js adapter
  supports App Router, server actions, route handlers, and SSR. Platform
  compatibility still needs a real build and browser smoke test.
- Clerk's Hobby plan is free and includes development instances. A development
  instance is appropriate for this test environment, but Clerk describes its
  security posture as unsuitable for production workloads. Keep this site
  restricted to test data and team testing.
- No paid plan, add-on, or auto-recharge is authorized by this plan.

Sources: [Supabase Free](https://supabase.com/pricing),
[Supabase free-project billing](https://supabase.com/docs/guides/platform/billing-on-supabase),
[Vercel Hobby terms](https://vercel.com/docs/limits/fair-use-guidelines),
[Netlify Free](https://www.netlify.com/pricing/),
[Netlify Next.js support](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/),
[Clerk pricing](https://clerk.com/pricing), and
[Clerk instance guidance](https://clerk.com/docs/guides/development/managing-environments).

## Isolation contract

`NEXUS_SHARED_SANDBOX=1` activates a startup guard. It pins the Supabase
project URL and session-pooler database identity to the new project, rejects
all HubSpot tokens until development-portal routing is ready, requires Clerk
development keys, and rejects
NetSuite credentials unless the account is structurally an `_SBn` account with
`NETSUITE_ENV=sandbox`. A Netlify deployment without that flag fails at build.
The guard is covered by `tests/unit/runtime-config.test.ts`.
Supabase's new publishable and secret keys are opaque, so the guard can check
their format but cannot prove their project ownership from their text.
The first deployment must verify both keys against the sandbox endpoint before
any team access is granted.

The existing `NEXUS_ISOLATED_TEST=1` harness remains local-only. It must not be
used as the shared deployment. It substitutes fake providers and requires a
loopback database, while a deployed Next.js process uses production Node mode.

## Bring-up order

1. Edward enters the new Supabase database password in the ignored local env
   file or a password manager. Construct both database URLs with that password,
   URL-encoded, using the new project's session pooler on port 5432. Never
   print or commit the password.
2. Obtain the **new project's** publishable and server-only secret keys. Set
   the existing `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` variables from those keys. Verify the project
   ref, URL, and database username agree before the first database write. Run
   `node --env-file=.env.local --experimental-strip-types
   scripts/validation/shared-sandbox-preflight.ts`; it only reads the pinned
   database, validates both keys against the project endpoint, and confirms
   the PDF bucket is private. It must pass before migrations.
3. Apply the repository's migration journal to the empty sandbox database.
   Verify schema version and required Realtime publications. Create the
   private `quote-attachments` bucket and its policies, and confirm the
   already-created private `quote-pdfs` bucket. Do not clone
   production quotes, customers, tokens, or audit records.
4. Create a separate Clerk development instance and configure its test keys
   and sandbox origin. Microsoft Entra SSO needs a separate tenant-admin
   consent grant if the team is to sign in the same way as production.
5. Create a Netlify Free site for this worktree/branch. Set its environment
   variables explicitly, including `NEXUS_SHARED_SANDBOX=1`; do not copy the
   production Vercel env block. Keep auto-recharge off. Deploy and test sign-in,
   Setup, Costs, Pricing, PDF storage, and Realtime before inviting the team.
6. HubSpot and NetSuite stay unconnected initially. The current HubSpot read
   client is hardwired to a production token and production pipeline IDs;
   `NODE_ENV=production` also makes its Products client select the production
   route. Implement and test all-domain development-portal routing before
   adding a HubSpot development token. NetSuite may be enabled only with a
   sandbox `_SBn` account and a sandbox-only token after a write probe.
7. Seed representative **synthetic** projects, products, item groups, and
   quotes. Preserve the distinction between a persistent shared sandbox and
   disposable automated-test fixtures. Then expand browser tests against the
   shared sandbox for Realtime/storage/pooler behavior; keep deterministic CI
   tests on the local isolated harness.

## Current blockers

- Local database password slot is empty, so migrations have not run.
- Netlify account/site creation and Clerk development credentials remain.
- The new sandbox has no usable app data yet.
- HubSpot development-portal routing and team SSO are separate implementation
  work. Until then, do not describe this as a full end-to-end integration
  sandbox.

## Acceptance checks

- Build refuses a production Supabase URL, database username, or transaction
  pooler URL when sandbox mode is on.
- Sandbox users cannot read or mutate production Nexus, HubSpot, or NetSuite
  records through the sandbox app.
- Two team users can sign in and independently create/test quotes against the
  sandbox database; one user's edits update the other through sandbox Realtime.
- Quote PDF and attachment bytes appear only in sandbox storage.
- A full release runs tests and migrations against the sandbox first, then
  production changes remain a separate authorized step.
