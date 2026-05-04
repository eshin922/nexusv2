# UX Backlog

Tracked UX issues to address at Slice 13.5 (mid-build UX pass) or Slice 17 (polish).
Items here are intentionally deferred - capture, don't fix in the moment.

## Open

- [Cross-round reconciliation revalidation queue]

  **Slice:** Redesign-implementation (per-sub-slice)

  **What:** Provisional dispositions in `docs/cross-round-reconciliation.md` (CR-2 through CR-10) need Edward's visual revalidation when the affected surfaces ship. CR-2 (no breadcrumbs in v1) verified at RI.2; CR-4 (Settings = admin only) verified at RI.7; CR-10 (minimal topbar) verified at RI.3 + RI.4; CR-3, CR-5, CR-6, CR-8 as relevant surfaces ship.

  **Where designed:** Pre-RI.1 cross-round reconciliation pass.

  **Why log it:** Operational reminder, not a feature commitment. Edward smokes affected surfaces; provisional disposition either confirms (becomes decided) or refines. Tracked in reconciliation doc; flagged here so it doesn't get lost in slice momentum.

- [Competitive verdict epsilon — "OVER TARGET BY $0.00" after reverse-solve apply]
  Slice 9.4b's reverse-solve apply path (cell client target → tier
  adjustment) lands `requiredSellPerUnit` at-or-very-near the client
  target by design. Float precision + `numeric(5,4)` storage on
  `tier_price_adj_pct` produces a sub-cent overshoot that classifies
  as `OVER_CLIENT_TARGET` via the strict `<=` comparison in
  `computeCompetitiveStatus`. The competitive chip then reads "OVER
  TARGET BY $0.00" — magnitude rounds to zero at 2-decimal display
  but the chip color flips amber. This is the natural endpoint of
  every successful reverse-solve, so PMs see this on every apply.
  **Fix is one-line:** introduce an epsilon (e.g., 0.005 = half a
  cent) in `computeCompetitiveStatus` so values within tolerance of
  the target classify COMPETITIVE: `requiredSell <= target + EPSILON`.
  Either that or add a third verdict state ("AT TARGET") with
  distinct chip treatment. Recommend epsilon — simpler, matches the
  PM mental model of "I asked the system to land me here, it did,
  show competitive." Defer to next polish slice (9.5 validation
  engine work or earlier if PMs complain). Surfaced during 9.4b
  smoke Pass 3 Step 3 apply landing. Reference:
  `src/lib/costing.ts` `computeCompetitiveStatus`.

- [Light mode default + dark mode token tuning]

  **Status.** Captured during Round 6 closeout review. Not yet scheduled.

  **Context.** Across all six design rounds, CD's color tokens for the lowest text-contrast tier (used for small-caps column labels like TIER 1/2/3/4, metadata sublabels like "5 lines" / "29d ago", supporting numerics, and secondary helper text) render legibly in light mode but are too dim in dark mode. The pixel luminance values for "ink-4" (or equivalent lowest tier) sit too close to the dark background, which works against the perceptual contrast lift that bright/cream backgrounds provide naturally.

  Specific surfaces where the issue manifests across rounds:
  - **Round 4 deal organizer:** "12m" timestamps, "v3 sent" sublabels, "drop_reason=accept_sibling" forensic strings
  - **Round 5 admin pages:** column headers (CATEGORY / DEFAULT MARKUP / IN USE / LAST EDITED), "29d ago / EQ" sublabels under markup values
  - **Round 6 cost stack and section rows:** "5,000 units" sublabels under tier labels, TIER 1/2/3/4 small-caps labels in section row metadata strips, dollar values with insufficient pop
  - **Costing Sheet (current build):** column headers, sublabels, breakdown table headers
  - **Slice 9.4a per-SKU breakdown:** column headers and small-caps labels

  This is a systematic design-system issue, not a Round 6 specific one. The fix is tokens-level, not surface-level redesign.

  **Three commitments to land at implementation time.**

  **1. Light mode ships as the default.** Dark mode stays available as a user toggle (current carry-forward from Round 1), but light mode is what new users see on first login.

  Reasoning:
  - Cost Build's data-viz density (cost stack with five-to-six color-coded component rows, sparklines, ingredient tables) benefits from bright backgrounds for hue distinction
  - Long-session quote-building workflow favors light mode (sharper text rendering, less fatigue over hours of dense numerical data)
  - Mixed-environment lighting in DPS office settings (bright conference rooms, varying monitor calibration) is more forgiving in light mode
  - Dark mode remains valuable for users who explicitly prefer it (toggle stays in user preferences)

  **2. Dark mode token tuning pass.** When dark mode is selected, push the lowest text-contrast tier up by roughly +15-20% luminance. Apply the change at the CSS variable definition layer (`--ink-4` or equivalent), not surface-by-surface. Verify the corrected token reads cleanly in dark mode without becoming visually heavy in light mode (where the same token pulls a different palette).

  Specific surfaces to verify after tuning:
  - Cost stack header section row metadata strips (the tightest case)
  - Admin page table column headers
  - Deal organizer project row metadata
  - Costing Sheet per-SKU breakdown column headers

  **3. Per-component cost stack color luminance review.** The cost stack's component bars (PKG blue / PROD teal / FRT teal / RAW green / D+T purple / PASS gray) are distinguished primarily by hue, with similar luminance values. In light mode this works because all sit on cream and hue distinction is clean. In dark mode, the eye loses contrast between similar-luminance hues — particularly PROD vs FRT (both teal-family) and D+T's hatched purple (which nearly disappears).

  Adjust component color luminance for dark mode such that components remain perceptually distinct at glance. Light mode values should remain unchanged unless the parallel adjustment creates inconsistency.

  **Effort.** Tokens-only change. Probably 1-2 hours of designer time + 1 hour of build implementation time when redesign-implementation slice ships. CSS variable updates plus visual verification across representative surfaces. No re-rendering of design rounds required.

  **When this lands.** **RI.0 (token foundation sub-slice)** per the amended redesign-implementation brief. RI.0 ports CD's `:root` block verbatim into `globals.css` / `src/styles/design-tokens.css`, configures Tailwind v4 `@theme`, loads Newsreader / Instrument Sans / JetBrains Mono via `next/font`, and implements the dark-mode `--ink-4` luminance lift + per-component cost stack color luminance review. RI.8 (final polish) verifies legibility holds across all rebuilt surfaces.

  **Why deferred to implementation.** The fix is small enough to handle as part of build rather than a separate pre-build CD round. Designer audits the rendered Slice 9.4b surface post-token-port to verify tokens flow through correctly (this is the calibration pause point for the whole slice's visual baseline).

- [Mini-stack engagement instrumentation on Cost Build section rows]

  **Status.** Captured from Round 6 designer notes pushback #1. Not yet scheduled.

  **Context.** CD's Round 6 design includes a per-tier rollup mini-stack on each section row (Packaging / Production / Bulk Raw / Freight). The mini-stack shows per-tier per-unit cost values inline in the section header — answering "what does packaging cost at T2?" without opening the drill-down.

  CD flagged this as their own pushback: the same data is already visible in the cost stack header (PKG row × T2 column = same number). The mini-stack is structurally a duplicate of the cost stack header in miniature, three times. CD shipped it because it's load-bearing in empty/incomplete states (when the cost stack header has nothing to read at certain tiers) and serves as a tactile preview before drill-down opens.

  **The question to answer with data.** Do PMs scan section row mini-stacks to read per-tier cost values, or do they go straight to the cost stack at the top of the page?

  If PMs primarily use the cost stack header as the glance surface, the mini-stacks are decorative — replace with a single status pill plus owner badge.

  If PMs do scan mini-stacks (especially in incomplete/empty states), keep them.

  **Implementation when build ships.** Add basic interaction telemetry to Cost Build section rows during the first 2-4 weeks of real PM use:
  - Hover/scan tracking on section row mini-stack region
  - Click-through patterns: do PMs click into drill-down without first scanning mini-stack values, or does the mini-stack scan happen before the drill-down click?
  - Engagement in incomplete states specifically: when cost stack header has empty tiers, do mini-stacks get more attention?

  **Decision criteria after 2-4 weeks of use.** If telemetry shows section-row mini-stacks aren't read, replace with status pill + owner badge only (CD's proposed alternative). If telemetry shows they are read, keep as designed.

  **Effort.** Telemetry instrumentation: small. Decision review and potential UI simplification: small if simplifying. Total: 2-4 hours implementation + observation period.

  **When this lands.** After redesign-implementation slice ships and real PM users are onboarded (Slice 17 territory). Telemetry instrumentation can be part of redesign-implementation slice; the decision pass happens after observation.

  **Why this is a backlog item, not a build slice question.** CD's design decision is data-driven: the mini-stacks are correct if used, decorative if ignored. Without real-use data we'd be guessing. Defer to instrumentation-then-decide pattern.

- [Auth provider migration: Google → Microsoft 365 primary]

  **Status:** Captured during Slice 9.4b sounding-board session. Not yet scheduled.

  **Context.** Slice 1 shipped with Clerk + Google SSO (Edward's `edward.shin@gmail.com` is on the `@thedps.co` allowlist by explicit exception during development). DPS as a firm uses Microsoft for email and authentication. When real DPS team members are onboarded to Nexus, they sign in with their Microsoft accounts, not Google.

  **Scope of work.**

  1. **Clerk dashboard configuration.**
     - Enable Microsoft as OAuth provider in Clerk
     - Configure DPS Microsoft 365 tenant ID (verify with DPS IT — Edward to check before this work starts)
     - Confirm whether DPS is on Microsoft 365 / Entra ID (tenant-scoped) or generic Microsoft accounts (untenanted)
     - Make Microsoft the primary provider in the Clerk sign-in component
     - Decide: keep Google secondary for Edward's continued Gmail access, or remove Google entirely

  2. **Email allowlist behavior.**
     - Domain allowlist (`@thedps.co`) stays the same; works regardless of provider
     - Verify Clerk's domain-allowlist enforcement is provider-agnostic (it is, but verify)
     - Confirm Edward's `edward.shin@gmail.com` allowlist exception is provider-agnostic too if Google is retained

  3. **No schema changes required.** `users.email` is the user identity key; Clerk normalizes across providers. Existing user records persist.

  4. **No design changes required.** Clerk sign-in screen renders the configured providers; visual treatment is Clerk-default. Round 4 nav rail's avatar/initials work regardless.

  5. **Smoke test:** Configure in dev environment, verify sign-in with a real DPS Microsoft account before flipping production.

  **When this lands.** Slice 17 (real-user test) is the natural moment — at that point DPS PMs are being onboarded for the first time. Could land earlier as a small standalone task if Edward wants to test the flip, but no urgency before Slice 17.

  **Open questions to confirm before scheduling.**
  - Is DPS on Microsoft 365 / Entra ID, or generic Microsoft accounts? (Likely M365 — most small firms are — but verify with DPS IT.)
  - Does DPS have an existing Entra ID / Azure AD tenant? Tenant ID needed for Clerk config.
  - Does the firm want SSO-only (no fallback) or SSO-with-fallback (Google retained for break-glass)?
  - Should the migration moment also coincide with role-based seat licensing review? (12 users × Microsoft licenses already paid; Clerk seat counts already include Edward + dev/test accounts.)

  **Estimated effort.** Configuration work: 30-60 minutes. Verification: 30 minutes. Total: ~1 hour. Negligible compared to a build slice.

  **Why this isn't urgent now.** Edward is the only active user during Slice 1-16 development. Microsoft auth becomes load-bearing only when real DPS PMs sign in for the first time. Capturing now so it doesn't fall through the cracks; not a Slice 9.4b/9.5/redesign-implementation blocker.

- [Costing Sheet — summary-vs-working panel separation]
  The Per-SKU breakdown currently carries both summary signals
  (margin pill, sparkline, competitive verdict chip, required-sell
  display) AND tuning affordances (per-cell sell override entry,
  client target entry, reverse-solve "apply" button). Architectural
  mismatch — summary panels should be read-only review surfaces;
  tuning belongs on separate working surfaces. Specifically: the
  reverse-solve "apply" affordance writes to *tier-level* scope
  (`quote_tiers.tier_price_adj_pct`) from a *per-cell row* — the
  affordance's UI location implies cell-level effect, but its
  actual blast radius is the entire tier. Cross-cell consequence
  dialog tries to surface this at confirm-time; the deeper fix is
  putting the affordance on a tuning surface where the tier-level
  scope is structurally legible. Surfaced during Slice 9.4b smoke
  (Edward's architectural read of the Pass 3 dialog flow).
  Reshape is redesign-implementation slice scope — CD's design
  system handles surface separation explicitly, and the per-SKU
  table layout will get rebuilt against the new surface vocabulary
  at that point. Visual + architectural debt acknowledged for v1
  build period; ships 9.4b as-is. Slice 9.4c brief (quote-level
  client target) incorporates the surface-separation concern from
  day one — quote-level entry is a NEW affordance and should land
  on the right surface (likely a quote-level tuning panel, not the
  per-SKU row). Reference: `src/components/costing/client-target-cell.tsx`
  (cell-row affordance), `src/components/costing/reverse-solve-dialog.tsx`
  (consequence-surface mitigation), Slice 9.3 `<RequiredSellCell>`
  (per-cell override pattern that established this shape).

- [Action-layer test coverage gap — leaf-only invariants and beyond]
  `scripts/test-costing.ts` exercises pure costing math; there is no
  test framework or fixture infrastructure for action-layer logic.
  Slice 9.3's leaf-only invariant on `updateSellPriceOverride` and
  Slice 9.4b's leaf-only invariant on `updateClientTarget` /
  `applyClientTargetSolveTierAdj` are both enforced by 3-line guards
  in action bodies, both reviewed at PR time, neither covered by
  regression tests. Defense in depth lives only at the math layer
  (which doesn't exercise the action-layer guards). The pattern
  will grow with Slice 9.5+ work (validation engine adds more
  action-layer rejection paths) and Slice 10+ (mark-accepted
  writeback, NetSuite handoff). Two paths to consider when picking
  up: (a) live integration tests against the shared dev/prod DB
  with fixture insert + cleanup (risk: hits real data), or (b)
  extract validation logic to pure helpers testable in
  test-costing.ts (clean abstraction; one-line guards become
  helpers). Scope decision belongs in the perf-audit slice between
  11 and 12, before Slice 12 mark-accepted writeback ships and
  expands the action-layer surface area further. Reference:
  `src/app/actions/costing.ts:564-569` (Slice 9.3 leaf guard) and
  `src/app/actions/costing.ts` `updateClientTarget` (Slice 9.4b
  leaf guard, added in the strip commit).

- [Redesign-implementation — systematic accessibility pass]
  No formal accessibility audit on shipped surfaces (Slices 8–9.4b).
  Color-coded affordances (margin verdict pills, competitive indicator,
  sparkline active-tier point, OVR pills) likely fail WCAG color-
  contrast in places and don't carry redundant signals for color-blind
  users (protanopia/deuteranopia in particular). Examples flagged
  during build: sparkline blue-active vs slate-non-active relies on
  saturation/lightness contrast; verdict-pill red/amber/green ramp
  lacks shape redundancy. ARIA attributes are inconsistent across
  inline editors and disclosure buttons. Belongs in the redesign-
  implementation slice's systematic pass — pre-design Nexus styles
  weren't designed against an accessibility checklist; the redesign
  is the right slice to retrofit. Don't patch one-off in build slices.

- [Slice 9.2 polish — slider control for price-adjustment affordances]
  Per-tier and global price adjustment affordances ship as slider
  controls in redesign-implementation slice; current numeric input
  is v1 functional treatment, revisit at visual rebuild. CD's
  prototype intent was slider (continuous interaction for
  "explore the curve" use case); revising IA spec to match
  implementation would create retroactive drift in the design
  system. Numeric input as v1 + slider as redesign-implementation
  visual is consistent with the established v1-functional /
  redesign-implementation-visual split. IA spec lines 329 + 387
  remain unedited. Reference: `src/components/tier-price-adj-input.tsx`
  and `src/components/global-price-adj-input.tsx` for the v1
  numeric input pattern.

- [Slice 9.2 polish — gear popover advisory when per-quote target
  collapses verdict bands] When PM sets `quotes.target_margin_pct`
  below `firm_settings.floor_margin_pct`, the BELOW_TARGET zone
  disappears (any quote above floor is automatically GOOD relative
  to its own target — the PM-controlled soft signal collapses
  into the firm-controlled hard floor). Status quo per
  UX_BACKLOG.md:644-649: PM is allowed to do this (strategic
  deal pricing). Polish: surface the collapse explicitly in the
  gear popover. When draft target < firm floor, render an
  advisory line: "Target below firm floor — BELOW_TARGET verdict
  won't fire; only BELOW_FLOOR will gate." Doesn't block save,
  just signals the consequence. Caught Slice 9.2 smoke planning;
  Edward's call was ship status quo, log polish. Reference:
  `src/components/quote-target-margin-popover.tsx` Save handler;
  add the advisory check before the validate/save call.

- [dev infra — cure.mjs broken on Node 22.17.0+] `npm run cure`
  fails with `spawn EINVAL` after Node 22.17.0 tightened spawn
  validation for `.cmd` files on Windows. The script's
  `spawn("npx.cmd", ["next", "dev", "-p", "3000"], {stdio: "inherit"})`
  call needs `shell: true` added to the options object. Manual
  cure (Ctrl+C → `rm -rf .next node_modules/.cache` → `npm run dev`
  → fresh tab) is unaffected and is the current workaround.
  Caught Slice 9.2 smoke setup. One-line fix in
  `scripts/cure.mjs:65`. Not slice-blocking; out-of-slice cleanup.

- [data hygiene — finance confirmation of default markup %]
  Finance reviews and confirms default markup % values per category
  in the existing schedule (7 categories from the 360 worksheet +
  hybrid workbook additions; vocabulary is stable per Slice 9.1
  decision, see CLAUDE.md "Markup vocabulary decision"). When
  finance signs off on each value, an admin updates the per-category
  defaults via `/admin/markup-defaults` (audit-logs naturally,
  per-row inline edit pattern from Slice 8). **No code change
  required.** Not slice-blocking, not architectural — just
  shouldn't fall off the radar. Cross-references SPEC §12 open
  question #4.

- [v1.5+ — manual per-environment ops hygiene, gates second-developer
  onboarding] Broader-than-migrations risk: anything that must be
  applied per-environment outside of `git push → Vercel auto-deploy`
  has no environment indicator and can drift silently between dev
  and prod. The Slice 8 production crash was the first instance
  caught; the category is wider.

  In-scope ops:
  - **Drizzle migrations** (`npx drizzle-kit migrate`). Reads
    whatever `DATABASE_URL` is set; if `.env.local` briefly points
    at prod (or prod URL is in shell), migrations apply silently.
    Slice 8 example: digest 2641917463 — migrations applied to
    prod, code not yet deployed → schema/code drift → every quote
    drill-in 500'd until the PR merged.
  - **Supabase project config not modeled in Drizzle** — see
    `drizzle/manual/`. Realtime publication membership, RLS state +
    policies, Storage bucket config, Edge Functions. Slice 8.5
    introduced `ALTER PUBLICATION supabase_realtime ADD TABLE ...`
    as the first instance; future config in this category lands in
    the same directory.
  - **Vercel project env vars.** New env vars added in code but not
    set on prod silently fail (`process.env.X` returns undefined,
    handled or not by the consumer). Slice 8's `ADMIN_EMAILS` is
    handled gracefully (`?? ""`); other future env vars may not be.

  Mitigations (generalize across all three classes):
  - Separate `npm run db:migrate:prod` / `npm run manual:apply:prod`
    scripts that require an explicit `--confirm-prod` flag.
  - Check `DATABASE_URL` host (and other env-targeting indicators)
    against an allowlist before running; warn loudly if pointing at
    a prod host.
  - CI/CD-only application via a deploy hook (Vercel Build Step or
    GitHub Action) that runs migrations + manual SQL + env-var
    presence checks against prod only on `main` push, atomically
    with code deploy. Removes the local-machine path entirely.
  - Pre-deploy verification scripts (`scripts/verify/*`) run as
    part of CI; PR merge blocked if dev/prod parity fails.

  **Cross-reference: Slice 1 open question #7 (backup admin /
  bus-factor).** The foot-gun's blast radius scales with developer
  count — at solo dev it's recoverable in ~5 minutes; at 2+ devs
  the merge-vs-migrate (or merge-vs-manual-apply) ordering becomes
  a coordination problem. Dev A migrates locally to test, forgets
  to revert; Dev B's PR merges and deploys against the now-
  mismatched prod. Multiplies once Supabase config (publication,
  RLS) and env vars enter the manual-ops surface. **This is not
  nice-to-have — it gates safe onboarding of a second
  admin/developer.** Pull forward whenever the second dev is
  imminent.

- [v1.5+ — concurrent firm_settings write race] `updateFirmSettings`
  closes the prior current row + inserts a new current row in a
  transaction, but Postgres default `read committed` isolation
  doesn't prevent two concurrent admins from both reading the same
  prior row, both closing it (idempotent), and both inserting new
  current rows — yielding two rows with `effective_until IS NULL`.
  Every downstream read assumes the single-current invariant, so
  this would silently break margin-status thresholds.

  Fix: add a partial unique index.
  ```
  CREATE UNIQUE INDEX firm_settings_one_current
    ON firm_settings (effective_until)
    WHERE effective_until IS NULL;
  ```
  Postgres enforces "at most one row with NULL effective_until";
  the second concurrent insert fails with a unique-violation that
  the existing 22003-style action-result translator can map to
  VALIDATION_ERROR ("Another admin just updated firm settings;
  reload and try again.").

  Not slice-blocking — 2 admins, internal tool, near-zero
  probability of simultaneous Save clicks. But this is the right
  long-term answer; cheaper than implementing serializable
  isolation in application code. Slot into v1.5+ schema cleanup.

- [v1.5+ — quote versioning & rollback] Many users editing many
  surfaces over many hours. Without version control, "the quote got
  worse, can we go back" requires manual reconstruction or accepting
  the current state as final.

  Existing primitives:
  - `quotes.version_number` (Slice 4) supports linear versioning at
    the quote lifecycle level (draft → sent → accepted →
    superseded). Catches some revert needs but doesn't handle
    within-draft drift.
  - `audit_log` captures every mutation forensically but isn't
    designed for state reconstruction.

  Recommended architecture: hybrid of explicit version control +
  automatic snapshots.

  **(A) Lean into `version_number`** — explicit "Save as new
  version" button creates immutable prior version, clones to new
  draft. "Restore from v1" copies prior version's data into new
  active draft.

  **(C) Periodic + lifecycle snapshots** — new table
  `quote_snapshots` captures full quote state (all inputs) on
  triggers:
  - Auto: every 15 min if edits occurred (debounced)
  - Manual: PM clicks "Save Snapshot" with optional label
  - Lifecycle: status transitions, scenario branches, accept actions

  Retention: keep 24 rolling auto snapshots; all manual + lifecycle
  snapshots permanent.

  Restore action: select snapshot → confirm → auto-snapshot current
  first (so restore is itself reversible) → replace input rows with
  snapshot payload. Audit-logged.

  Skipped option: event-sourcing the `audit_log` into restorable
  state. Too complex for v1; audit log stays forensic, snapshots
  handle restoration.

  Estimated 8–12 hours. Slot after Slice 8.5 (multi-user realtime)
  since concurrent editing is the more frequent pain. Connects to
  Slice 14 scenarios (each scenario's branch point becomes a
  lifecycle snapshot automatically).

  Schema preview (don't build now):
  ```
  quote_snapshots (
    id                   uuid PK,
    quote_id             FK,
    snapshot_at          timestamptz,
    trigger              enum: auto / manual / lifecycle,
    manual_label         text nullable,
    created_by_user_id   FK,
    payload              jsonb (all inputs serialized),
    size_bytes           int
  )
  ```

- [Slice 8.5 — multi-user realtime sync] Multi-PM concurrent editing
  on the same quote requires real-time propagation of edits between
  users. Current architecture: each user's Zustand store is local;
  revalidation reaches other users' tabs only on their next page
  action. Role-aware design (PM on /packaging, Production on
  /production, Logistics on /freight) explicitly intends concurrent
  work — they shouldn't have to manually reload to see each other's
  edits.

  Implementation: Supabase Realtime subscriptions on `quote_skus`,
  `packaging_inputs`, `production_inputs`, `freight_inputs`,
  `quote_tiers`, and `quotes` for the quote being viewed.

  When a realtime notification arrives:
  - Reconcile fires on the receiving tab (same path as existing
    revalidation reconcile).
  - Wait-for-quiet pattern from sub-step 6 still applies — incoming
    changes don't clobber the current user's in-progress edits.
  - 100ms debounce on multiple incoming events to coalesce bursts.

  Affected components:
  - `src/components/costing-store-provider.tsx` — subscribe on
    mount, unsubscribe on cleanup.
  - New `src/lib/supabase-realtime.ts` — wraps subscription channel
    management with reconnect logic.

  Slice 8.5 also bundles small UX polish items already logged:
  - Production page → apply-to-all-tiers buttons (still pending).
  - "Total freight" label clarity / tooltip pass on freight page.
  - Bundled/Pass-through dropdown vs badge on freight (note: this
    specific item was shipped inline during sub-step 5 testing —
    can be removed from the bundle).
  - Other field-label clarity from the [Slice 8.5 mini-polish] entry.

  Estimated 1–2 days for core sync; presence indicator is +0.5 day
  and can defer. Ships between Slice 8 and Slice 9. Continue Slice 8
  sub-step 7 (final pre-Step-5 review). After Slice 8 ships clean
  (admin pages + smoke tests), Slice 8.5 starts.

  **Design notes** (refined post sub-step 6):

  The reconcile path from sub-steps 4–6 is correct and reusable.
  Realtime addition adds a new trigger; the rest of the architecture
  stays the same.

  1. **Coarse reconcile pattern.** Realtime notification triggers a
     full `getCostingBundle` re-fetch, then standard reconcile applies
     the fresh snapshot. Don't try to apply individual row diffs;
     the existing reconcile already handles full snapshots cleanly.

  2. **wait-for-quiet from sub-step 6 applies unchanged.** Local
     user's in-progress edits take precedence; incoming external
     changes defer until local user pauses for 800ms. Same
     `QUIET_PERIOD_MS`, same `RETRY_INTERVAL_MS`. No new code path —
     the existing tryReconcile in costing-store-provider.tsx already
     handles this for revalidation snapshots; realtime snapshots
     flow through the same pipe.

  3. **Coalesce realtime events.** Alice edits 5 cells in 1 second;
     Bob's tab should fire one re-fetch + reconcile, not 5. Add
     200–300ms debounce on incoming Realtime events before triggering
     re-fetch. (Distinct from the wait-for-quiet debounce — that's on
     the receiving end, this is on the trigger end.)

  4. **Edge case: incoming change invalidates local optimistic edit.**
     E.g., another user deletes a tier the current user is editing
     in. v1 handling: reconcile discards the orphaned optimistic
     state silently; surface a toast ("Data updated by another user
     — your unsaved edit may be lost"). Audit log captures actual
     server state. Better merge logic deferred to v2.

  5. **Subscription scope per page.** Subscribe to changes on tables
     that affect this quote's costing — `quotes`, `quote_skus`,
     `quote_tiers`, `packaging_inputs`, `production_inputs`,
     `freight_inputs`, `markup_defaults`, `firm_settings`. Filter by
     `quote_id` where applicable (works for `quotes`, `quote_skus`,
     `quote_tiers`). For per-input tables (`packaging_inputs`,
     `production_inputs`, `freight_inputs`) which only have
     `quote_sku_id`: Slice 8.5 ships with **broad subscribe + client-
     side payload filter on `quote_sku_id` membership in local
     store's known SKU set**. quote_skus ADD events trigger
     reconcile, which pulls new SKUs into the store, which makes
     subsequent input events on those SKU IDs pass the filter.

     **v2 optimization candidates (revisit if Slice 14 parallel
     scenarios meaningfully increases per-tab subscription count):**
     - Client-side filter using local known-SKU set (what 8.5 ships).
     - DB-side filter via denormalized `quote_id` column on the three
       per-input tables. Schema migration; clean filter; adds drift
       risk to input writes.
     - Authenticated Supabase client with per-quote channel scoped
       through RLS-aware filter expressions. Requires the JWT bridge
       infrastructure (see RLS-on branch in #45 diligence).

  6. **Connection management.** Handle Supabase reconnects gracefully.
     On reconnect, force a re-fetch + reconcile to catch missed
     events during the disconnect.

  7. **UX surface.** Small "Live" indicator near the page header
     showing active subscription state. When other users are editing
     the same quote, show "Alice is editing" or similar (Supabase
     Realtime includes presence support). Defer presence to v1.5 if
     it's significant work.

- [Slice 9 — client target cost / price benchmark] Workflow gap: PMs
  typically have a client-stated target price ("client wants $5
  landed per unit at 50k") that serves as a negotiation benchmark.
  Currently no field captures this; PMs mentally compare Required
  Sell to remembered targets.

  Schema: `quote_sku_tier_targets.client_target_price_per_unit
  numeric(10,4) NOT NULL` — sparse sister table to `quote_sku_tiers`
  per Slice 9.4b migration 0016. PMs typically apply the same target
  across all SKUs in a tier (UX bulk-fill is the right answer at the
  per-SKU summary row), but the data shape is per-cell so each
  (SKU, tier) intersection can carry its own benchmark when product
  mix matters. Lazy-row writes (INSERT for set, DELETE for clear)
  mirror Slice 9.3's `quote_sku_tiers` pattern.

  UI: per-SKU summary row on Costing Sheet gains a "Client Target"
  cell at the active tier. Shows:
  - Target price (PM-entered)
  - Gap (Required Sell − Target, $ and %)
  - Status indicator: **COMPETITIVE** (Required Sell ≤ Target),
    **OVER TARGET** (slightly above), **WAY OVER TARGET** (far above)

  Combined with margin status, gives PMs a two-axis view:
  - Margin GOOD + COMPETITIVE = strong position to win
  - Margin GOOD + WAY OVER TARGET = profitable but uncompetitive
  - Margin BELOW_FLOOR + COMPETITIVE = winning the deal at
    unsustainable margin
  - Margin BELOW_FLOOR + WAY OVER TARGET = nothing to do here

  Math: reverse-solve global_adj from target price.
  ```
  adj_to_hit_target_price = (target_price / required_sell_without_adj) - 1
  ```
  Same algebra as suggested-adj-to-hit-target-margin, with price as
  input instead of margin.

  UI affordance: "Apply suggested adj to match client target" button
  on rows where target is set and current sell ≠ target. One-click
  sets the per-tier override (uses the per-tier override field from
  the [Slice 9 — per-tier price adjustment] entry, not the global).

  Connects to:
  - [Slice 9 product spec] markup-driven vs margin-driven view
    toggle — target-price-driven is a third mode.
  - [Slice 9 — per-tier price adjustment] target-driven adjustments
    are per-tier; global override remains the simple case.
  - [Slice 9 — context-aware validation, with two-surface UX]
    target unset is acceptable; surfaces as info-level "no benchmark
    set" not warning.

  Future variant (post-v1.5): split into two fields — "client
  target" (their stated price) and "competing bid" (another vendor's
  reported quote). Different negotiation contexts deserve separate
  capture. v1: one field with notes, see how PMs use it.

  Don't build for Slice 8 or sub-step 6. The current /costing
  real-time fix proceeds independently.

- [Slice 9 — per-tier price adjustment] Current
  `quotes.global_price_adj_pct` is a single quote-level lever that
  applies uniformly across all tiers in the costing math.

  Problem: tier margin profiles diverge naturally (cost component
  scaling, MOQ-based vendor pricing, strategic pilot-vs-production
  pricing). A single global knob over-corrects for tiers that don't
  need adjustment and can't express tier-specific intent. The
  current "Apply suggested N% to hit target" button optimizes for
  the lead tier silently — lifting Tier 1 into GOOD can push Tier 3
  into over-priced.

  Slice 9 addition: per-tier price adjustment override.

  Schema: new nullable `quote_tiers.tier_price_adj_pct numeric(5,4)`.
  When NULL, tier uses the quote-level global. When populated, the
  override **replaces** the global for that tier (not stacks —
  replaces is cleaner; PMs setting an override know what they
  want).

  UI:
  - Per-tier rollup table in QuoteSummaryCard / Costing Sheet shows
    current effective adj per tier (global if no override, override
    value if set).
  - Click a tier's adj cell to override; clear to revert to global.
  - "Apply suggested N% to hit target" buttons available per-tier
    in the rollup table — clicking a tier's button sets only that
    tier's override.
  - Quote-level global remains, applies as default to non-overridden
    tiers.

  Math:
  - `effective_adj_for_tier = tier.tier_price_adj_pct ?? quote.global_price_adj_pct`
  - Required Sell calculation uses `effective_adj_for_tier` per tier.
  - Blended margin computes per-tier with each tier's own effective
    adj.

  Connects to: Slice 9 markup model work (per-line sell-price
  override also slated for Slice 9) and the Slice 9 status badges
  entry. All three share the "give PMs flexible, trustworthy
  pricing controls" theme.

  Continue Slice 8 with current global-only behavior. PMs testing
  during Slice 8.5/9 window will hit the limitation; that's the
  forcing function for Slice 9.

- [Slice 9 — pricing completeness, with status indicators] PMs need
  a fast way to know whether the costing math on a quote is
  trustworthy — whether all the cost data needed to compute margin
  is present, or whether the displayed margin is computed against
  partial inputs.

  Surface design: status badges on Cost Inputs nav cards (Packaging,
  Production, Freight) and at the quote-level summary, paired with
  the Slice 9 validation engine. The validation engine produces
  issues categorized by severity; the badges surface that severity
  at a glance:

  - **Complete** (no issues) — small green checkmark, quiet visual.
  - **Incomplete** (soft issues — tier coverage gap, missing customs
    values, etc.) — yellow warning badge with "(N items need
    attention)".
  - **Blocking** (must fix to send) — red badge with count.

  Click leads to the page with specific cells/rows flagged inline
  so PMs can find and fix gaps.

  Design rationale to preserve (status-with-severity beats
  alternatives):
  - A numeric ratio like "3/3" or "1/3 tiers covered" makes PMs do
    mental math and doesn't capture severity. 1/3 of optional
    fields is fine; 1/3 of pass-through freight cells is a real bug.
  - A progress bar lies about completion. "85% complete" gives
    false comfort if the missing 15% is the largest tier or a
    pass-through freight line.
  - A status pill with severity answers the binary question PMs
    actually have: "can I trust the margin number I'm seeing?" —
    which is the input to "should I send this quote?"

  Build alongside the validation engine in Slice 9. Don't ship
  preliminary completion indicators in earlier slices that would
  need redesigning when the validation rules are formalized.

  Connects to: the [Slice 9 prerequisite — pricing completeness
  validation] entry below. Same Slice 9 deliverable: validation
  produces the issues, badges surface them.

- [Slice 9 — context-aware validation, with two-surface UX]
  Validation engine produces warnings for both **completeness**
  (missing inputs) and **anomaly detection** (suspicious values).
  Currently the costing math treats missing input cells as "no
  contribution" rather than "data missing" — PMs see plausible
  margins on partial data without warnings.

  **Detection scope:**

  Completeness warnings (existing scope):
  1. Tier coverage mismatch on freight lines — `total_freight` for
     Tier 1 only → higher tiers compute zero freight contribution.
  2. Tier coverage mismatch on packaging lines — `unit_cost` on
     some tiers only → tier-dependent margin distortion.
  3. Tier coverage mismatch on production — partial filling/blending
     or `customer_ships_raws` toggle inconsistent across tiers.
  4. Customs incomplete — SKU has freight lines but `duty_pct`,
     `tariff_pct`, or `sku_total_cbm` is NULL.
  5. SKU on quote with no cost data anywhere — factory $0,
     contribution $0, sell $0; silently rolled into quote totals.
  6. Multi-line freight asymmetry — one freight line complete, one
     partial → broken line silently distorts landed-freight.

  Anomaly warnings (new scope, examples):
  - Flat-fee variance: tooling cost $5k on Tier 1, $50k on Tier 2.
  - Outlier: unit_cost 10× the median across this SKU's other
    packaging lines.
  - Customs inconsistency: duty_pct 25% on one SKU, 0% on a sibling
    SKU with the same HS code in notes.

  **Two display surfaces work together:**

  *Inline (per-field):*
  - Small ⚠ icon next to suspicious cells.
  - Hover for message.
  - Click opens popover with message, suggested fix when applicable,
    Accept and Fix buttons.

  *Summary box (per-page):*
  - Persistent panel below page header.
  - "N warnings on this page" count.
  - Expandable list with Accept/Fix per item.
  - "Accept all" with confirmation.
  - Items link to their cells (click → page scrolls to field).

  *Costing Sheet aggregation:*
  - Same summary-box pattern.
  - Aggregates warnings across all input pages.
  - Groups by source surface (packaging / production / freight /
    customs).
  - Pre-send gate — PM reviews this before quote sends.

  **Acceptance workflow:**
  - "Accept" suppresses warning, optionally captures reason.
  - Reason auto-suggestions: "Vendor MOQ break", "Customer-specific
    pricing", "Special handling fee", "(custom)".
  - Audit-logged with reason.
  - "Fix" applies suggested value where engine has confidence.

  **Persistence — new table `quote_warnings`:**
  ```
  id                   uuid PK,
  quote_id             FK,
  source_table         text,
  source_row_id        uuid,
  warning_type         enum (flat_fee_variance, outlier,
                              customs_inconsistency,
                              completeness_gap, ...),
  severity             enum (soft, blocking),
  message              text,
  suggested_value      numeric nullable,
  detected_at          timestamptz,
  accepted_at          timestamptz nullable,
  accepted_by_user_id  FK nullable,
  accepted_reason      text nullable,
  resolved_at          timestamptz nullable
  ```
  Warnings persist across sessions; not regenerated on every page
  load. Detected on save; resolved automatically when underlying
  data changes; manually accepted to suppress.

  **Severity gating:**
  - **Blocking:** SKU with no cost data at all; freight pass-through
    with null duty/tariff. Prevents Mark-Accepted (Slice 12).
  - **Soft warning:** tier coverage mismatch, customs incomplete on
    bundled freight, partial multi-line freight, anomalies. Warns
    but allows.

  **Architecture fit:**
  - Detection: validation engine in `src/lib/validation.ts` (new).
  - Real-time: optimistic store fires validation on input changes;
    warnings appear immediately.
  - Multi-user: warnings sync via Slice 8.5 realtime channel.
  - Severity gating: blocking warnings prevent Mark-Accepted (Slice
    12).

  Estimated 8–12 hours total (completeness + anomaly detection +
  two-surface UX + persistence).

  Supersedes the narrower [Slice 6.5] customs-NULL entry that
  previously lived here — context-aware validation expands to cover
  all input categories AND anomaly detection, not just customs/CBM.

- [Slice 13.5 polish — header chrome consolidation] Replace the
  current stacked-headers pattern (white app header + dark admin
  header on `/admin/*`) with **mutually-exclusive header states**:

  - **Inside `/admin/*`:** the dark admin header is the only header.
    It carries the app logo on the left (click → returns to quoting
    tool, replacing the redundant explicit "Back to quoting tool"
    link), the page title in the middle, and a user menu on the
    right (consolidating the email display, sign-out, and any
    future user controls).
  - **Outside `/admin/*`:** the white app header shows. Same logo
    + user menu, no admin link to itself.

  Eliminates: stacked chrome bars, redundant "Back to quoting tool"
  link (logo click does the same), inconsistent user-display
  patterns (email-as-text in admin header vs sign-out-button on
  home).

  Slice 8.5 shipped a partial fix — Settings link hides on /admin
  via pathname check in AppHeaderClient. That removes the
  pointing-at-self problem but leaves the stacked bars. Full
  consolidation lands here.

- [Slice 13.5 polish — UX clarity sweep] Field labels and helper text
  across all input pages. Many fields have names/placeholders that
  are clear to developers but require context PMs don't have. Sweep
  scope (do at once for consistency, NOT per-slice):

  1. **Self-explanatory labels** — replace abbreviations and jargon
     with what the field actually means in PM language.
  2. **Concrete tooltips** on every non-obvious field with one-sentence
     explanation + example where useful.
  3. **Smart placeholders** that hint at scale and unit (e.g.,
     `"10,000 (using tier qty)"` instead of `"default: 10,000"`).
  4. **Hover tooltips on icon-only buttons** (→ apply-to-all,
     refresh ↺, delete ×, reorder ↑↓).
  5. **Disambiguating ambiguous wording** (e.g., "Total freight" →
     "Shipment freight cost" with tooltip "Lump sum DPS pays
     forwarder for the entire shipment containing this SKU").
  6. **Status badge tooltips** (Bundled, Pass-through, GOOD,
     BELOW_TARGET) explaining what they mean and any decision the PM
     might take.

  Specific known instances captured during build:
  - Freight page: "Total freight" ambiguous; "default: 10,000"
    doesn't signal what field it is; → apply-to-all icons unlabeled.
  - Production page: "Filling/Blending" vs "CM/Assembly" distinction
    could be unclear; per-unit vs one-time costs not visually
    distinguished.
  - Packaging page: `inventory_eligible` checkbox visible but does
    nothing in v1.
  - Customs: "Internal — not shown to customer" badge clear but the
    customs subsection's overall purpose could use a one-line header
    ("Why is this here?").
  - Summary card: status badges may need tooltips when PMs first
    encounter them.
  - **Admin / markup-defaults delete:** native `window.confirm()`
    in `markup-defaults-table.tsx` `handleDelete`. The `\n\n` in
    the warn-with-count copy renders as raw newlines in the
    browser dialog; on mobile the dialog truncates aggressively.
    Functional for v1 (2 admin users, desktop-only) but the
    landed-on copy ("N existing input rows use this category and
    will be unaffected — they keep their saved markup. New rows
    of this category will have no default markup until you
    re-create it.") deserves a real modal component with proper
    line-break rendering and a "no, cancel" button styled as
    secondary.

  Sequencing: hold for Slice 13.5 with informed inputs from real PM
  testing in Slice 11+. Items causing immediate mid-build friction
  get promoted to Slice 8.5 (mini-polish slice between 8 and 9), not
  fixed inline.

- [Slice 8.5 mini-polish] Quick UX clarity pass on the most-active
  5–10 field labels/tooltips across freight, customs, summary card.
  NOT a full sweep — that's Slice 13.5. Just enough to make the
  freight page self-explanatory for PM testing during Slice 9+.
  Specific candidates:
  - **`npm run cure` script (SHIPPED in Slice 8.5).** Bundles the
    standard cure pattern (kill node + clear caches + restart) into
    one command. Lives at `scripts/cure.mjs`. Cross-platform
    (Windows taskkill / Unix pgrep) with PID exclusion so the
    script doesn't kill itself. Reduces friction of the
    repeatedly-needed cure cycle (4–5 manual invocations during
    Slice 8.5 dev alone). Step 4 (close browser tabs) is still
    manual — can't automate. CLAUDE.md "Server action ID
    invalidation" section now references the one-command path.
  - **Cross-user input-staleness awareness signal.** Surfaced
    during Slice 8.5 multi-user smoke test #51. Current behavior
    (correct, intentional): when a remote user edits a cell, the
    realtime reconcile updates the local store + rollup display,
    but each individual `<input>` retains its `useState`-bound
    local value (because we don't want to clobber the local
    user's typed-but-unsaved values). Net result: the rollup is
    fresh, but the input value-shown in the cell is stale. If the
    local user starts typing in that input, they overwrite the
    remote change without knowing. Footgun.

    Smallest viable signal: when a reconcile arrives that diff
    against the prior snapshot in any input row that the user
    isn't currently focused on, dispatch a CustomEvent that
    surfaces a small dismissible banner: "Updated by another
    user — input values may be stale until you reload." Banner
    disappears on next user action OR manual dismissal. NOT a
    full conflict-resolution UI (per the original Slice 8.5
    "don't do" list); just an awareness signal. PMs can decide:
    reload to pick up remote values, or proceed and overwrite.

    Implementation lives in `costing-store-provider.tsx` as a
    second pipe alongside the existing scheduleReconcile —
    compare snap-before vs snap-after on each reconcile, dispatch
    on diff. CostingStoreProvider is the right home because it
    sees both the prior store state and the incoming snapshot.
  - **Admin settings entry point in header nav.** Currently admins
    reach `/admin/*` only by typing the URL. Add a "Settings" link
    (or gear icon) in the top header, visible only when
    `isAdmin(email)` returns true (env-based check via
    `src/lib/admin-guard.ts` — no per-render DB hit; action-layer
    `requireAdminPage`/`requireAdminAction` remains the security
    boundary). Persistent across all pages, not home-only — admin
    settings are infrastructure, not a destination, and should be
    one click from anywhere. The `/admin` index page itself
    already exists (Slice 8) as a two-card landing page for
    Firm Settings + Markup Defaults; this entry only adds the
    header affordance to reach it. Layout sidebar / proper nav
    can come later when there are more admin pages.
  - Freight: "Total freight" → "Shipment freight cost" + tooltip
  - Freight: "default: 10,000" placeholder → "10,000 (using tier qty)"
  - Freight: → apply-to-all icon → tooltip "Apply to all tiers"
  - Customs: subsection header tooltip "Internal cost inputs for
    landed-cost rollup; never shown to customer."
  - Summary card: GOOD / BELOW_TARGET / BELOW_FLOOR badge tooltips
    explaining what each status means and what to do.
  - Production: per-row "(per unit)" / "(one-time)" indicators on
    cost field labels.
  Insert between Slice 8 ship and Slice 9 start.

- [Slice 9 product spec] Support both markup-driven and margin-driven
  pricing as first-class workflows. Business uses both today; current
  architecture is markup-driven (Sell = sum of cost × (1+markup)) with
  margin shown as a derived metric. The model already half-supports
  margin-driven via global_adj + suggested_adj, but the framing makes
  it feel secondary. Slice 9 surfaces it as a first-class workflow.

  Scope:
  1. Add quote-level `target_margin_pct` override (numeric(5,4)
     nullable on `quotes` table). When set, overrides firm target for
     this quote's suggested-adj math and status flagging. PMs can quote
     a strategic deal at a lower margin without changing firm-wide
     defaults.
  2. QuoteSummaryCard gains "Margin mode" toggle. Same data, different
     framing: margin mode anchors on margin %, target gap, and
     one-click Apply Suggested. Markup mode shows the per-component
     markup breakdown that's there today.
  3. Margin-driven workflow becomes prominent: PM types target margin
     → suggested adj computes → one-click apply. Same math as today
     (closed-form solve in costing.ts), just surfaced as primary.
  4. Per-line sell-price override (also Slice 9): PM forces a sell
     price on a specific component, margin compresses. Mirrors the
     Excel "set sell, watch margin" pattern PMs use during
     negotiation.

  Architecture impact minimal. Costing math unchanged; new schema
  fields and UI surfaces only. Caught Slice 8 sub-step 4 verification
  when Edward observed that bumping a packaging cost barely moves the
  blended margin (per-component markup math: revenue scales roughly
  with cost, so margin is nearly invariant under uniform cost
  changes). See `src/lib/costing.ts` formula header for the full
  derivation.

- [Slice 8 → Slice 13.5 polish] Surface markup_pct used per cost
  component on the per-SKU breakdown table. Currently shows component
  cost and final Required Sell; PMs can't see what category markup was
  applied to each component without cross-referencing the input page.
  Adding a column or inline marker showing
  "Packaging × 20% (Freight category)" would speed up
  "why is this number what it is" debugging. Caught Slice 8 sub-step 1
  verification when reverse-engineering a Required Sell that didn't
  match the Primary-default-markup mental model — turned out the line
  was categorized as "Freight" (markup 20%), not "Primary".

- [Slice 13.5 polish] Bulk-set tariff/duty across all SKUs in a quote
  when uniform. PM workflow today: 35% China-origin tariff applies to
  all SKUs in most shipments. Schema is already per-SKU (correct for
  flexibility); add a quote-level "Apply tariff X% to all SKUs"
  affordance that fans out a single value across all the quote's leaves.
  Same UX pattern as policy fan-out we use elsewhere
  (e.g. `updateSkuProductionPolicy`, freight metadata fan-out).

- [Slice 13.5 polish] Mixed-SKU pallet allocation guidance. When a
  pallet holds multiple SKUs, PM allocates the pallet's CBM by judgment.
  The `sku_total_cbm` field accepts the resulting number with no help.
  Future affordance: a "pallet builder" tool that lets PM enter pallet
  configurations (this pallet has 60% SKU-A, 40% SKU-B) and computes
  the CBM split. Defer until v1 in real PM use confirms the workflow
  needs help — current PM workflow uses Excel for this and copies the
  result into Nexus.

- [Slice 13.5+] Multi-PO consolidated shipments. Real DPS ocean
  shipments combine 2+ POs in one container (Nemah workbook NM1020 +
  NM1021). Freight allocation crosses quote boundaries operationally
  but not in our schema (`line_group_id` is per-quote). v1 keeps
  freight per-quote; PMs do consolidated allocation in a separate
  workbook. Future: cross-quote freight lines or shipment-level
  reconciliation outside the quote.

- [Slice 11 prerequisite] Pass-through freight rolls up to a quote-level
  customer line on the PDF; internal per-SKU/per-line splits are
  invisible to the customer. Bundled freight is invisible entirely
  (amortized into unit cost). Confirm PDF layout treats freight as a
  single bottom-of-quote line item, not per-SKU rows.

- [Slice 5.5 → Slice 13.5 polish] Packaging inputs `<details>` sections
  default to collapsed despite JSX setting `open`. Production
  (Slice 6) and Freight (Slice 7) use the same `<details open>`
  pattern and may have the same issue. Likely cause: browsers
  (Chromium especially) persist `<details>` open/closed state
  per-document across navigations within a session — once a user
  collapses a section, the browser overrides the HTML `open` default
  on subsequent visits. Fix options:
  - Replace native `<details>` with a controlled React component that
    initializes `open=true` regardless of browser state.
  - Add a `useEffect` that explicitly sets `open` after mount on each
    `<details>` element (heavy-handed but works with native element).
  - Accept browser persistence as intentional UX (PMs who collapse
    deliberately want it to stay collapsed) — but make the FIRST
    visit always-expanded for new SKUs/quotes.
  Apply the same fix across packaging, production, and freight pages
  for consistency.

- [Slice 7, fixed in slice] `addFreightLine` UI revalidation race —
  first click wrote to DB but didn't refresh the open tab; a second
  click 10s later triggered the visual refresh showing BOTH lines.
  Caught during smoke testing. **Fix applied:** `router.refresh()`
  after `useTransition` completes in `AddFreightLineButton`. Server's
  `revalidatePath` alone proved unreliable in Next 15.5 for pushing
  RSC updates to the open tab — the route segment cache holds the
  pre-action render. Pattern likely applies to other action triggers
  (add-tier, add-sku, add-packaging-line, refresh-from-hubspot) that
  haven't surfaced the bug yet but are at risk; revisit if reports
  arrive.

- [Dev environment — Windows] Next 15 dev server intermittently
  serves 404 on hard-refresh (`Ctrl+Shift+R`) of a working route.
  Pattern in dev log: `GET 200` succeeds, then `Compiling /_not-found`
  fires, then `GET 404`. Coincides with `EPERM: operation not permitted,
  rename '.next/cache/webpack/.../0.pack.gz_' → '0.pack.gz'` errors
  — Windows holding a lock on the webpack cache pack file. Workaround:
  hit URL in a new tab, OR kill dev server and restart. Not a
  production concern (Vercel doesn't use webpack dev cache). Consider
  filing upstream against Next.js if it persists.

- [Slice 7 → Slice 13.5] Destructive `applyTierPreset` has no undo
  affordance. Forensic data lives in `audit_log.diff_json` (`production_data_lost`,
  `freight_data_lost`), but recovery is manual: read the JSON in
  Supabase and re-type values. Add an "Undo last preset apply" button
  visible for ~5 minutes after the apply, OR a `revertTierPresetApply`
  server action that reads the most recent `tier_preset_applied` audit
  row and replays the snapshot. Considerations: tier IDs in the
  snapshot point at deleted rows (the new tier set has different IDs),
  so undo must restore the old tier set + reseed all input tables
  with the snapshot's per-line metadata + per-cell values. Bigger
  than it sounds; treat as a Slice 13.5 sub-project, not a 30-min
  fix.

- [Slice 7 → Slice 13.5 polish] Per-tier freight cells lack explicit
  column labels. Each freight line shows N tier rows with inputs for
  Total Freight ($) and Units in Shipment, but the only signal of
  what each input means is a `$` prefix on the first and placeholder
  text on the second. PMs scanning quickly read the layout as
  ambiguous. Add column headers above the tier rows ("Tier" /
  "Total Freight ($)" / "→" / "Units in Shipment" / actions), or
  inline labels next to each input. Same fix could apply to packaging's
  per-tier cells if the issue is general.

- [Slice 7 → Slice 13.5 polish] `freight_treatment` toggle is not
  obviously interactive. Currently rendered as a small pill ("Bundled"
  in gray, "Pass-through" in amber) — looks like a status badge, not a
  control. PMs miss it on first view. Replace with a visible toggle
  switch, two-button segmented control, or labeled dropdown so the
  click affordance is unambiguous.

- [Slice 7 → Slice 13.5 polish] Shared-shipment freight lines. When
  multiple SKUs travel in a single shipment (e.g., ocean container
  with 3 products), PMs currently enter freight as separate per-SKU
  lines with their pre-split share. Add a UI affordance for
  "create freight line on multiple SKUs with auto-split" — splits
  equally by default, options for by-units or by-weight if observed
  need. Lines remain independent per-SKU post-split (no live link),
  so the affordance is purely a UI convenience, not a schema change.

- [Slice 6 → Slice 13.5 polish] Production inputs UI clarity:
  - Add per-row unit indicators ("per unit" vs "one-time") to
    disambiguate scaling vs flat costs.
  - Add info tooltips on the Filling/Blending vs CM/Assembly distinction
    (PMs without manufacturing background will conflate them).
  - When Bulk Raw Cost row hides on `customer_ships_raws` toggle,
    replace with a disabled placeholder ("N/A — customer ships raws")
    rather than full hide. Keeps the row count stable and surfaces the
    "data is preserved, just hidden" semantics.
  - `actual_units_produced` should be edit-disabled by default, with
    an explicit unlock action; prevents accidental quote-time entry
    of post-production data into a row that's structurally meant for
    the post-production phase.

- [Slice 5.6] PM custom property TBD. `hubspot_deals_cache.pm_id` /
  `pm_name` / `pm_email` columns are nullable until the HubSpot deal
  property internal name is identified. Set `HUBSPOT_PM_PROPERTY=<name>`
  in env once known and the sync will populate the columns
  automatically. To discover candidates, run `dumpDealProperties()`
  (exported from `src/lib/hubspot-cache.ts`) — it lists deal properties
  whose name/label matches `pm|manager|lead|owner|coordinator|director`.

- [Slice 2] Home page paradigm is wrong. "Import Deal" is front-and-center 
  but PMs will spend 80% of their time looking at their existing projects, 
  not importing new ones. Home should be a project list with import as a 
  button on it, not a separate destination. Defer to Slice 13.5 once the 
  Deal Organizer ships in Slice 13.

- [Slice 3] No way to unarchive a project from the UI. Archive flow exists,
  the inverse doesn't. Currently requires a direct DB update. Add an
  "Unarchive" button (visible only when status=archived) parallel to the
  archive flow, with audit entry. Cheap addition; pull into Slice 13.5 with
  the Deal Organizer's archive filters.

- [Slice 4] Open question: should Nexus support creating new HubSpot Products
  from within the tool, or is reference-only the right model?

  Discovery needed before deciding:
  1. Who currently owns HubSpot product catalog creation at DPS?
  2. Is HubSpot the master for products, or is NetSuite the master?
  3. What HubSpot Product fields are required for the NetSuite sync to succeed?
  4. Are there existing catalog hygiene problems that distributed creation would worsen?

  Three architectural options:
  A) Reference only — PM context-switches to HubSpot for new products (current plan)
  B) Create-through — Nexus form POSTs to HubSpot Products API, PM never leaves
  C) Request-to-create — PM submits request, designated reviewer approves, creation happens

  Slice 4 ships with Option A. Revisit at Slice 13.5 once discovery is complete.

- [Slice 12 prerequisite] Verify the HubSpot → NetSuite sync handles
  line-item-level `hs_cost_of_goods_sold` gracefully. If COGS has been
  unpopulated historically, the sync may not have been tested with non-null
  values. Confirm with sync owner that populated COGS on line items either
  (a) flows to NetSuite cleanly, or (b) is safely ignored. Either is fine;
  silent failure is not.

- [Slice 9 prerequisite — high priority] The markup category schedule
  defined in v3 spec Section 5 is being redefined based on "line of work."
  Edward to provide new vocabulary and percentages before Slice 9 starts.
  Slice 9 cannot ship without this. Schema model (`markup_defaults` table)
  is flexible; only seed values and lookup logic depend on the decision.

- [Slice 5 → Slice 9] Markup categories on `packaging_inputs.category` and
  the `markup_defaults` seed are temporary placeholders matching the
  existing Excel worksheet vocabulary (Primary 40 / Secondary 50 /
  Manufacturing 30 / Tooling 20 / Freight 20 / Soft Goods 35 / Other 30).
  Slice 9 will redefine these with the new "line of work" schedule. The
  migration will rewrite category strings on existing `packaging_inputs`
  rows; `markup_defaults` rows will be rebuilt entirely. No FK between
  the two columns by design — soft reference, joined at read time.

- [Slice 5] `packaging_inputs.purchase_qty` is in the schema but not
  surfaced in the Slice 5 UI (Slice 5 only renders `unit_cost` per tier).
  Surface a `purchase_qty` entry path when Slice 8's costing logic needs
  it — likely as a sibling input next to `unit_cost`, or in a costing
  sheet review row.

- [Slice 5 → Slice 13.5 polish] Per-tier unit cost row layout in packaging
  inputs grid is sparse and visually unclear at 2+ tier scale. Tier cells
  are spread across the row width instead of clustered in clear columns,
  and the copy-to-all-tiers '→' buttons aren't visually anchored to their
  cells. Reconsider grid layout: option (a) put tier columns in the main
  metadata row alongside Supplier/Qty/Category/Markup as additional
  columns; option (b) use a more compact dense-cluster layout for tier
  cells with explicit column headers. Address in Slice 13.5 polish.

- [Slice 5 → Slice 13.5 polish] Short ID badges added on quote builder
  and packaging pages (and per-quote in the project detail list) for
  dev/test ergonomics — first 8 chars of the UUID, click-to-copy the
  full ID. At polish time, decide whether to keep visible to all users
  (useful for support / referencing in Slack) or hide behind admin
  role / dev-mode flag.

- [Slice 5 → Slice 13.5 polish] `$0` `unit_cost` UX is currently
  ambiguous — PMs may enter 0 to mean "no cost" (legitimate, e.g.
  customer-supplied raws) or leave the field blank meaning "not yet
  priced." Both render visually similar in the per-tier cost cell.
  At polish time, decide whether to: (a) treat 0 as a sentinel and
  warn before save, (b) require an explicit "free" toggle, or
  (c) accept both and surface the ambiguity in the costing sheet.

- [v2] Replace HubSpot ↔ NetSuite product sync with Nexus → NetSuite
  direct integration. Removes the structural bottleneck that prevents
  BOM/assembly metadata from flowing to NetSuite. NetSuite becomes the
  single product master; Nexus becomes the assembly intelligence layer.

- [v2] Direct Nexus → NetSuite Sales Order writeback with assembly
  support. Eliminates manual NetSuite assembly configuration step that
  ops currently performs. Nested BOMs flow as native NetSuite assembly
  items.

- [v2] HubSpot Products integration becomes one-way (NetSuite → HubSpot,
  optional, for CRM visibility only). Nexus stops referencing HubSpot
  Products as the canonical SKU source; references NetSuite items
  directly.

- [Slice 5.5 → Slice 13.5] Validate "Add assembly" button placement with
  real PM workflow — current placement is bottom of search panel; may
  belong as a separate tab, a top-of-page action, or inline with the
  search results depending on actual PM mental model. Decision deferred
  until we observe how PMs actually compose assemblies in practice.

- [v1.5+ consideration] Evaluate dropping `sku_role` entirely and
  inferring assembly status from tree position (has children vs. has no
  children). Trade-off: simpler schema, requires handling the edge case
  of adding children to a SKU that already has packaging_inputs (does
  the leaf's existing packaging persist as the now-assembly's packaging,
  or does the role transition force a packaging wipe?). Defer until
  real PM usage proves whether explicit role declaration adds value
  beyond what the tree shape already implies.

## Design-driven feature commitments

Items in this section are commitments that emerged from Claude
Design's redesign rounds (rounds 1–3, post-Slice-9.1). Each is
feature work that the redesign depends on. Items are tagged with
target slice or sequenced as v1.5+ / post-MVP. "redesign-slice"
means the item lands as part of the eventual redesign-implementation
slice (TBD sequencing — see "Slice 18 candidate — frontend
redesign" entry below).

Source rounds noted in parentheses on each entry. Schema column
names are illustrative; final names land at implementation time.

### Round 2 commitments

1. **System-suggested global price adjustment computation**
   *(Round 2 → Slice 9.2)*
   Live computation of the global price adjustment that lands
   blended margin at firm target. One-click "Apply suggestion" UX.
   Spec FR-7 references this; design provides concrete UX surface
   (coaching banner on Costing Sheet when blended diverges from
   target by ~0.3pp+). Implementation: pure function in
   `src/lib/costing.ts` reverse-solving margin → required
   adjustment. Cost: ~half a day.

2. **Deep-link URL contract for Cost Build**
   *(Round 2 → redesign-slice or Slice 13.5)*
   Pattern: `/quote/[id]/build?focus=<section>-<row-id>` where
   section ∈ {pkg, prod, frt} and row-id is the input row UUID.
   Cost Build page handles param on mount; scrolls cell into view,
   focuses input. Replaces need for a separate quick-edit surface.
   Notification emails and future Slack messages link directly to
   the cell. Cost: ~half a day.

3. **Allocated-fee provenance schema**
   *(Round 2 → Slice 13.5)*
   Schema addition: `production_inputs.allocation_source_total`
   (numeric — underlying one-time charge $) and
   `production_inputs.allocation_source_qty` (int — divisor used).
   Display as "$5,250 ÷ 25k" on allocated rows so PMs can trace
   per-unit allocated provenance. Currently allocation math happens
   in code with no audit trail surface. Cost: ~half a day.

4. **Multi-user presence layer**
   *(Round 2 → redesign-slice)*
   Per-quote presence channel in Supabase Realtime. Publishes
   `{user_id, current_page, current_section, last_active_at}` on
   subscribe; subscribes to peers. UI: avatar cluster in app header
   showing who's currently on this quote; per-user current-section
   indicator (e.g., "Tomás · editing Packaging"). Coalesce updates
   at 5s intervals. Builds on existing Slice 8.5 realtime
   infrastructure. Cost: ~1 session.

5. **Per-row "fresh since last visit" diff**
   *(Round 2 → v1.5+)*
   Schema addition: `quote_views` table tracking
   per-user-per-quote last-seen timestamp. UI: small "fresh" dot on
   rows updated since current user's last visit. Answers "where
   was I" for re-entry sessions. Lower priority than presence (#4):
   presence answers "who's here now," fresh-dot answers "what
   changed while I was away." Cost: ~1 session.

6. **⌘K global search**
   *(Round 2 → post-MVP / Slice 13.5+)*
   Quote-finding, SKU-finding, deal-finding, project-finding from
   any page. Modal command palette pattern. Searches across
   `quotes.scenario_label + version_number`,
   `quote_skus.sku_label + product_name`,
   `projects.deal_name + client_name`,
   `hubspot_deals_cache.deal_name`. Standard pattern; existing
   libraries (cmdk, kbar) handle most of it. Cost: ~1–2 sessions.

7. **Owner-badge convention**
   *(Round 2 → in progress in RI.4)*
   Owner badges on Cost Build sections ("OWNED BY PURCHASING",
   "OWNED BY PRODUCTION", "OWNED BY LOGISTICS"). Derived from
   static mapping of `users.role` to cost-input-table ownership.
   Surfaces implicit role assignments without making each role's
   view siloed. Cost: ~1 hour. Round 6 designs section-row owner
   badges directly; ships as part of RI.4 (Cost Build unification)
   per the redesign-implementation brief.

8. **Mark-Accepted gate visibility on Costing Sheet**
   *(Round 2 → Slice 12 spec — see SPEC FR-9)*
   Per CD's Round 2 pushback #2: gate state surfaces on the Costing
   Sheet from the moment a quote has data, not only at the
   Mark-Accepted action. Documented as SPEC FR-9 spec note (see
   `docs/SPEC.md` → "Action contract notes"). No separate slice
   work; clarifies FR-9 UX surface.

9. **Slice 9.3 reframe — per-cell sell override**
   *(Round 2 plan note → Slice 9.3, shipped)*
   Slice 9.3 was originally framed as "markup-driven vs
   margin-driven view toggle + per-line sell-price override," with
   toggle implying global edit mode. Per CD pushback: global mode
   dropped. Every sell-price cell is click-to-override; NULL =
   computed; non-NULL = overridden, badged "OVR" with ↺ revert.
   Schema: `quote_sku_tiers.sell_price_override` NOT NULL on the
   sparse table (lazy-row pattern; row exists ⟹ override is set).
   **Shipped as designed in Slice 9.3 + Slice 9.4a per-SKU summary
   row UI wiring; preserved through 9.4b client target work.**

10. **Role-as-affordance architectural principle**
    *(Round 2 → CLAUDE.md — see "Role gating — affordance, not architecture")*
    Documented as a CLAUDE.md note. Role checks happen at
    cell/section affordance level, not page-component or routing
    level. Single page, viewer param, dim non-owned sections. No
    separate slice work.

### Round 2.5 commitments

11. **Per-row tier-spread sparkline + drawer for multi-tier entry**
    *(Round 2.5 → redesign-slice)*
    Always-on per-row sparkline showing cost variation across tiers
    (shape vocabulary: `flat` / `step↓` / `partial` / `no costs`).
    Click sparkline → opens per-row drawer with all four tier cells
    visible, tab-traversable. Drawer footer has "↓ apply [active
    tier value] to all tiers" affordance for the common case.
    Optimizes "I just got a supplier quote sheet, paste in four
    prices" flow. The sparkline shape is the data-shape vocabulary
    that derives the customer-facing tier-pricing column (Round 3
    carry-forward). Cost: ~1 session.

12. **NULL = "no cost entered at this tier" semantics**
    *(Round 2.5 → architectural commitment)*
    NULL means "no cost entered at this tier" — never "inherit from
    active tier." Schema-honest; validation engine clarity (Slice
    9.5); audit-log fidelity. UX provides "↩ same as Tn" shortcuts
    and "apply to all" affordances for fast entry without
    inheritance logic. Materialized writes only. No new schema;
    convention applied across cost-input tables.

13. **"Mark as flat" SKU-level annotation**
    *(Round 2.5 → backlog, schema TBD)*
    Schema addition: `quote_skus.is_flat_pricing` boolean (or
    per-line equivalent) marking SKUs/lines that structurally have
    no volume break. Affordance in the multi-tier drawer
    ("↪ Mark as flat (no volume break)"). Future supplier
    re-quotes default to single-cost entry mode for flat-marked
    items. Distinguishes "happens to be the same right now" from
    "structurally no volume break." Cost: ~half a day.

### Round 3 commitments

14. **`quote_snapshots` table promotion (from inline json)**
    *(Round 3 → Slice 11)*
    Promotes spec section 10's v2 plan to v1. New table:
    `id, quote_id, version_id, event (sent | accepted | superseded),
    snapshot_json, created_at, created_by_user_id`. Replaces inline
    `quotes.accepted_snapshot_json`. Foreign-keyed from
    `quotes.accepted_snapshot_id`. Read paths for LOCKED state and
    Final PDF go through snapshots, not live tables. Earlier
    promotion than spec anticipated because we now want snapshots
    at *send* time, not just accept time.

15. **Send-event snapshot**
    *(Round 3 → Slice 11)*
    Every `sent` event writes a `quote_snapshots` row capturing the
    customer-view tree at send time. Distinct from accept-event
    snapshot. Required for the sent-vs-draft pinning model (#16).
    Customer-view tree = vendor, customer, quote metadata, tiers,
    skus.tier_prices, service_fees, freight_lines (everything in
    `<PdfPage>` subtree).

16. **Sent-version pinning in Mark-Accepted action**
    *(Round 3 → Slice 11; see SPEC FR-9 "Action contract notes")*
    Mark-Accepted action takes `version_id` (always the sent
    version), not the current draft. Prevents "PM edits post-send →
    silently accepts against draft" silent-data-corruption bug.
    Drafts created after send are saved as sibling scenarios with
    `status='dropped'`, `drop_reason='draft_at_accept'`.

17. **Quote-level override audit pair**
    *(Round 3 → Slice 12 spec; see SPEC FR-9)*
    Schema additions:
    `quotes.blended_below_floor_override_user_id` and
    `quotes.blended_below_floor_override_reason`. Parallel to
    existing line-level `underpriced_override_*` pair. Both pairs
    needed because both gates can fire independently.

18. **HubSpot writeback async confirmation UI**
    *(Round 3 → Slice 12)*
    LOCKED state shows "synced 2m ago" / "syncing…" / "sync failed
    · retry" based on `hubspot_writeback.status`. Async, not
    blocking. Failure is recoverable (retry button); success is
    auditable. Spec FR-9 says "writeback failure handling and
    retry"; CD specifies UX shape.

19. **Sibling auto-drop on accept**
    *(Round 3 → Slice 11 contract)*
    `accept_source: 'manual_button'` triggers drop of all
    `status='active'` siblings on same project. Schema: each
    dropped sibling gets `drop_reason='accept_sibling'`,
    `dropped_by_user_id` set, `dropped_at` timestamped. Auditable,
    reversible by admin. Spec FR-9 partially covers ("auto-marks
    any other active scenarios as dropped"); CD specifies
    drop_reason and audit capture.

20. **Draft-of-accepted-version sibling preservation**
    *(Round 3 → Slice 11 contract)*
    When PM accepts v3 but has v4 in draft on same scenario, v4 is
    saved as sibling scenario with `status='dropped'`,
    `drop_reason='draft_at_accept'`, `dropped_by_user_id` (the
    accepting PM). PM's edits are preserved (recoverable from
    dropped sibling), not silently discarded. Distinct from sibling
    auto-drop (#19) which targets *other scenarios*; this targets
    *the accepted scenario's own draft chain*.

21. **PDF render path**
    *(Round 3 → Slice 11)*
    Customer-view component tree renders to PDF deterministically.
    Same component, two render targets (web preview + PDF). Round
    3 designs the component; PDF backend (react-pdf or similar) is
    its own slice work. Build pipeline asserts component import
    boundary (#23).

22. **Snapshot-render path for LOCKED state**
    *(Round 3 → Slice 11)*
    `View snapshot` and `Final PDF` actions on LOCKED state render
    from `quote_snapshots.json`, not from live tables.
    Schema-versioned: if customer-view shape changes in future, old
    snapshots still render against captured shape. Snapshot is
    canonical post-acceptance.

23. **Boundary-guard build invariant**
    *(Round 3 → cross-cutting / implementation-slice; see CLAUDE.md
    "Customer-view boundary guard")*
    Build pipeline asserts `<PdfPage>` and descendants import zero
    modules from costing surface. Failure mode: build error, not
    runtime check. Prevents accidental leakage of internal-only
    fields (markup, margin, cost components, customs, version
    metadata) into customer-facing render tree. Visual notice on
    preview ("Nothing below this line is in the customer's tree")
    is design rhetoric; actual enforcement is structural.

24. **Send-time PDF layout choice**
    *(Round 3 → Slice 11 spec)*
    Send action accepts
    `pdf_layout: 'tier_table' | 'single_tier'` parameter. Default
    `tier_table` (preserves Excel-flow expectation). PM picks
    per-quote at send time. Both layouts render from same
    component tree; same boundary guard applies. Reversible
    (re-send with different layout creates new sent-event
    snapshot).

25. **Frozen Cost Build during pending approval**
    *(Round 3 → Slice 12 spec; see SPEC FR-9)*
    When override request is pending, Cost Build edits are frozen
    on that quote. Editing during pending-approval would invalidate
    the gate state the approver is approving against.
    Cancel-then-edit is the explicit path. Cancel sends a "request
    withdrawn" Slack reply automatically.

### Visual / chrome / observability commitments emerging across rounds

26. **Cost Build section visual close treatment**
    *(Round 2 polish observation → redesign-slice)*
    Section openings are unambiguous (colored accent bar, OWNED BY
    badge, COMPLETE chip, subtotal); section closes are invisible
    (Packaging's last row and Production's first row separate by
    same visual weight as adjacent rows within Packaging). CD to
    make the design call honoring existing visual system (likely
    color-coded left edge full-height, or extended section accent —
    *not* card encapsulation). Bundled into redesign-slice; not a
    separate ticket.

27. **Cost Build right-column elimination**
    *(Round 2 polish observation → redesign-slice)*
    Today's third column (presence panel + deep-link explainer)
    crushes work-surface real estate. Strip in production: presence
    becomes header element (avatar cluster top-right); deep-link
    contract works invisibly without explainer panel. Cost Build →
    two-column layout (tier rail + work surface). Bundled into
    redesign-slice.

28. **Cost stack panel live-interactive animation**
    *(Round 2 polish observation → Slice 9.2 / redesign-slice)*
    Slider drag animates cost stack bars to new state in real-time
    (CSS transition on width/height, not flicker-replace).
    Optimistic store already supports the data path; this is a CC
    implementation detail at slice time. CD's design specifies the
    animation grammar.

### Round 4 commitments

29. **Cross-project picker scaling for 60+ historical projects**
    *(Round 4 → backlog; surface before history accumulates)*
    Round 4 commitment carried forward in the redesign-implementation
    brief §9 deferrals. When a user has 60+ projects in their
    history, the cross-project Copy picker becomes unwieldy.
    Solutions to evaluate when surfacing: pagination, MRU
    compression, archive-by-default, search-first interaction
    model. Not a v1 concern; flagged so it surfaces before real
    history depth makes the pattern unusable.

### Round 6 commitments

30. **Cost stack lens toggle (absolute vs normalized)**
    *(Round 6 designer notes pushback #3 → backlog)*
    Defer until real PM use surfaces confusion about whether the
    cost stack reads as absolute dollars or normalized to a
    baseline. If telemetry/feedback indicates confusion, add a
    toggle (e.g., "Show: absolute / normalized to T1 / normalized
    to component"). Round 6 design ships absolute-only; this entry
    captures the deferred polish path.

31. **Per-section approval workflow on Cost Build**
    *(Round 6 deferred → backlog)*
    PMs may want to mark sections as "approved by purchasing" or
    similar before the Costing Sheet renders the contribution from
    that section. Defer until real PM workflow surfaces the need.
    Schema implication: `cost_section_meta.approval_status` enum +
    `approved_by_user_id` + `approved_at` (per-section variant of
    the existing approval pattern). No design exists yet; future
    Designer-extension work when the use case materializes.

32. **Inventory pool cross-project surface**
    *(Round 6 deferred → backlog)*
    Inventory-eligible items currently flagged on individual lines
    (`packaging_inputs.inventory_eligible` + related). A cross-
    project "what's in inventory across all my active quotes"
    surface — answering "do I have stock for this new quote
    elsewhere?" — is a separate workflow that hasn't been
    designed. Surface concept logged for future design round.
    Likely Slice 15+ territory.

33. **Empty-state line templates pre-fill**
    *(Round 6 deferred → backlog)*
    When a PM adds a new packaging or production line, pre-fill
    common shapes (e.g., "primary packaging — bottle" template
    with fields hinted: name slot, supplier slot, typical markup
    category). Quality-of-life improvement; defer until real PM
    frustration with empty rows surfaces. Not a feature commitment;
    UX polish.

34. **Cross-section deposit lifecycle UI polish**
    *(Round 6 + Bulk Raw correction → post-MVP)*
    The deposit lifecycle (DUE / INVOICED / PAID / RECONCILED)
    ships in RI.4 with basic visual treatment (chips on Production
    + Bulk Raw section headers per Round 6 design). Polish pass —
    receipt attachments, invoice number formatting, deposit-paid
    notification flow, automatic reconciliation match against
    HubSpot/NetSuite — deferred to post-MVP. Logged so the polish
    work doesn't get lost and so future schema additions
    (`deposit_invoice_attachments` table or similar) have a
    capture point.

### Late carry-over (Round 2 sign-off)

35. **Slack admin-override workflow**
    *(Round 2 → Slice 12)*
    When Costing Sheet is BELOW FLOOR and PM clicks "Request admin
    override," a Slack DM goes to the configured approver
    (director or above — e.g. `@nina (director)` or
    `@sales-leadership` channel). Approver responds in Slack with
    approve/deny + written reason. Approval logs to the quote's
    audit log with `approver_user_id`, `reason`, `ts`.
    Mark-Accepted unlocks for that quote until next material
    change. Promoted from "design intent" to "Slice 12 spec" at
    Round 2 close. Slack matches DPS's actual approval rhythm.
    Implements as the real override workflow when Mark-Accepted
    writeback ships in Slice 12. Carries forward CD bundle entry
    that wasn't previously merged into the project's working
    UX_BACKLOG; surfaced during post-Round-6 consolidation pass.

## Resolved

- [Slice 8 sub-step 5, resolved] Numeric overflow on percent fields.
  Typing a value beyond `numeric(5,4)` capacity (e.g., 3025 in a
  markup_pct input → decimal 30.25 > max 9.9999) crashed the page
  with PostgresError 22003 `numeric_field_overflow`. Fixed via three
  layers: (1) client-side `validatePercentDecimal` helper in
  `src/lib/percent-validation.ts` rejects values outside ±999% before
  store push or save, surfaces inline error per field; (2) `runAction`
  in `src/lib/action-result.ts` translates Postgres SQL state 22003
  (numeric_field_overflow) and 22001 (string_data_right_truncation)
  to ActionResult VALIDATION_ERROR so any bypass returns a structured
  error instead of a 500; (3) optimistic-rollback semantics on save
  failure — when server returns ok:false the user's typed value
  persists locally and the next edit re-triggers save (already
  implicit in the existing controlled-input pattern, just verified).
  Pattern applies to all `numeric(5,4)` percent fields:
  packaging_inputs.markup_pct, freight_inputs.markup_pct,
  quote_skus.duty_pct, quote_skus.tariff_pct,
  quotes.global_price_adj_pct, firm_settings.target_margin_pct,
  firm_settings.floor_margin_pct.

- [Slice 6.5 / 7 confirmation, resolved] PM confirmed CBM workflow:
  per-SKU allocation of total shipment CBM, derived from PM judgment
  (carton-counting for clean shipments, eyeballing for mixed pallets).
  Common case is two-SKU shared container (Roman gummies pattern: jars
  69% / caps 31% of container CBM). Multi-PO consolidated shipments
  are rare. Schema captures the result on
  `freight_inputs.sku_total_cbm`; how PM derives the value is her
  concern. Slice 8 schema correction dropped the per-unit CBM model
  (`quote_skus.cbm_per_unit`) and moved to per-(SKU, line, tier)
  totals. See `docs/CUSTOMS_AND_FREIGHT.md` for the full convention.

- [Slice 12, resolved] `hs_cost_of_goods_sold` on HubSpot Products is unused
  at DPS because COGS is composite per-quote, not per-product. Slice 12
  writeback populating line-item-level `hs_cost_of_goods_sold` from Nexus
  unlocks native HubSpot margin reporting (`hs_margin`) for the first time.
  Confirmed line-item-level COGS is the right and only target for writeback.
  No conflict with product-level (which stays unset).

- [Slice 4, resolved] `packaging_category` and `product_type` both dropped
  from Nexus `quote_skus`. Nexus references HubSpot products via
  `hubspot_product_id` only and snapshots minimal fields (`sku_label`,
  `product_name`). Markup logic will be redefined in Slice 9 with new
  categorization. `field_source_json` also dropped — overkill with only
  two HubSpot-sourced fields and no override semantics.

- [Slice 5, resolved] Form state pattern for all auto-saving forms is
  **controlled inputs + useTransition + debounced direct action calls**,
  not uncontrolled forms with `onBlur` + `<form action={fn}>`. The
  uncontrolled pattern races React 19's implicit form-reset against RSC
  revalidation and produces "field blanks ~1 second after save" bugs.
  Server actions that mutate row state return the full updated row
  (canonical snapshots), not void. The save handler reads the new value
  from the change event and passes it through as an explicit override
  rather than relying on a ref that may not have committed yet (avoids
  the "one step behind" off-by-one bug on immediate saves). Pattern is
  codified in CLAUDE.md ("Form state pattern" + "Save handler pattern").
  Applies to: SKU rows, Tier rows, packaging input rows, production
  input rows (Slice 6), freight input rows (Slice 7), Costing Sheet
  sell-price overrides (Slice 8+), notes textareas, all settings forms.
  Do not introduce uncontrolled `<form action={fn}>` with onBlur
  auto-save in any future slice.
