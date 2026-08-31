# UX Backlog

Tracked UX issues to address at Slice 13.5 (mid-build UX pass) or Slice 17 (polish).
Items here are intentionally deferred - capture, don't fix in the moment.

## Slice 12 Step 10 CB walk BANK items (2026-07-29)

Follow-ups from the Step 10 close bundle. Each item has an explicit trigger
condition so future maintainers know when it becomes live.

- **Terms drift silently on revise when firm_settings edited mid-flow.**
  Mismatch banner (`src/components/quote-umbrella/mismatch-banner.tsx`)
  currently warns about **pricing** drift between v1-sent and v2-draft.
  It says nothing about **terms** (payment_terms, lead_time, incoterms,
  T&Cs) drift. Real production scenario: PM sends v1, admin edits
  firm_settings payment_terms, PM revises + re-sends v2. v2's snapshot
  columns pull the NEW firm values silently — customer receives
  different terms with no warning surface.

  **Trigger:** first customer email escalation about "the terms
  changed between the two quotes you sent me" — or preemptive at
  Slice 13/14 when admin surfaces for firm_settings editing get
  meaningful use.

  **Proposed shape:** extend mismatch-banner detection to compare
  v-current snapshot columns against latest superseded snapshot
  columns; surface any differing terms alongside the pricing drift
  warning. Reference `docs/pattern-52-freeze-list.md` for the exact
  column set.

- **mark-accepted/* scaling contract (Q5 (B) — banked as live trap,
  not tidy-up).**
  `mark-accepted-both-gates.tsx` / `margin-verdict.tsx` /
  `override-modal.tsx` render blendedMarginPct AS-IS (already
  scaled 0-100) because their parent page (`src/app/projects/[id]/
  quotes/[quoteId]/mark-accepted/page.tsx:182`) hands them one
  scaled prop (`blendedPct = summary.blendedMarginPct * 100`) AND
  two raw props (`targetPct`, `floorPct` — raw fractions 0-1).
  Internal render code correctly scales the raw props with `* 100`
  and leaves the pre-scaled prop alone.

  **The trap:** this contract is invisible at the component
  boundary. Any refactor of the page's scaling — normalizing all
  three props to the same scale, extracting a helper — silently
  breaks the margin display on the **below-floor gate**, the
  surface whose entire job is showing whether a tier clears the
  floor.

  **Trigger:** any code change that touches
  `mark-accepted/page.tsx:112-182` OR any of the three internal
  files' prop types.

  **Proposed shape:** unify all margin props to a single scale
  (recommend raw fractions 0-1 per QuotePerTierRollup contract),
  add `* 100` uniformly at render sites. Full test coverage on
  the below-floor gate + override modal after refactor. Slice 13
  or 14 — deliberate refactor with test discipline, not opportunistic.

- **Q4b happy-path smoke needs a real production send.**
  Q4b's `resignSnapshotPdf` action is verified structurally against
  the fixture (which fabricates an audit_log storagePath pointing
  at a nonexistent Storage object — action returns a signed URL
  that 404s at browser). Full happy-path smoke — click View v{N} →
  new tab opens → actual PDF renders — requires a real production
  send. First real quote sent post-merge exercises the path
  cleanly. Note in the CB smoke handoff.

- **App-wide confirmation pattern sweep** — Q8 broader scope
  (Slice 12 Step 10 walk finding).
  Q8 fixed the umbrella-scope `window.confirm` (mark-accepted
  rollback → portal-backed Modal). Six other `window.confirm`
  sites remain across the app:
  - `src/components/costs/freight-drilldown.tsx:259, 411`
  - `src/components/costs/packaging-drilldown.tsx:419`
  - `src/components/scenario-actions/scenario-actions-menu.tsx:57`
  - `src/app/admin/markup-defaults/markup-defaults-table.tsx:267`
  - `src/app/projects/[id]/confirm-button.tsx:19`
  - `src/app/projects/[id]/quotes/[quoteId]/tier-preset-select.tsx:66`

  Same defect class: browser-chrome prompt, no dark-mode support,
  no styling consistency with the rest of the app. **Trigger:**
  any user-visible design QA pass (Slice 13.5 mid-build UX pass
  or Slice 17 polish). **Proposed shape:** shared
  `useConfirm({title, body, confirmLabel, danger?})` hook that
  returns a `{ open, ConfirmModal }` pair. Migrate each site.
  Removes the last window.confirm callers app-wide.

- **Sales Order tab (`?tab=tier`) receipt view for complete quotes.**
  Q13 route-level guard coerces `activeTab='preview'` on
  `status='complete'` — heavy-handed but definitely safe. PMs
  wanting to view the completed SO receipt (NetSuite id, tranid,
  push status) can't reach it via URL anymore. CB observed the
  tier tab "falls back to Preview with one unexplained first-load
  exception" pre-fix; the render path clearly has a state gap
  that needs investigation.

  **Trigger:** first PM ask for "I need to see the SO receipt
  after complete." **Proposed shape:** investigate the render-path
  state gap; land a proper complete-state variant for the tier tab
  (SO id, tranid, push-status ledger, "if something's wrong"
  callout); remove the Q13 heavy-handed coercion so `?tab=tier`
  works on complete quotes. Different surface fix than the
  quote_completed / assertNotFrozen unification already shipped.

- **Slice 13 admin surfaces: assertNotFrozen adoption on every
  write path** (Pattern 52 enforcement).
  Q13 threaded `assertNotFrozen` into two acceptance-family actions
  reachable from the umbrella. Slice 13 admin surfaces (retry
  failed SO push, manual overrides, reconcile jobs) MUST call
  `assertNotFrozen(quote)` at the top of every action that writes
  Pattern 52 columns. Per Pattern 52 §0.5 protocol: brief's §0.5
  verification includes explicit "does this write any Pattern 52
  column?" check. Track compliance during Slice 13.

- **"When you fix a display rule, grep for every surface applying
  it"** (Q2 lesson).
  #146 Step 7 walk fixed a `sent_at` rendering bug in ONE file;
  Q2 (Step 10 walk) surfaced two sibling files with the same shape.
  Same class as the "Mark Accepted →" label bug earlier. Rule:
  after fixing a display rule, grep the codebase for every surface
  applying that rule. Add to the walk-close checklist.

  **Trigger:** any display-rule fix commit. Reviewer checklist:
  "did we grep for siblings applying the same rule?"

## Slice 13 admin-surfaces BANK items (Slice 12 Step 10 §0.5)

- **Stale `customer_accepted_tier_id` / `customer_response_channel`
  on unmark → revise → draft path.** `unmarkAccepted`
  (`src/app/actions/quotes.ts:2489`) does NOT clear the
  `customer_accepted_*` columns when transitioning accepted → sent;
  `reviseFromAccepted` (`:1898`) does NOT clear them either. Post-unmark
  or post-revise quotes carry stale acceptance data until re-accept
  overwrites.

  **Trigger for the concern (not "safe today, ignore" — the trigger
  is Slice 13 itself):** admin surfaces built during Slice 13 (retry
  failed SO push, manual overrides, reopen-for-edit affordances,
  reconcile jobs) are exactly the kind of thing that would read
  `customer_accepted_tier_id` on a draft/revised quote out of context
  and misrepresent history. The v1 UI doesn't render those columns
  on draft, so the smell is invisible; the moment Slice 13 admin UI
  does, the stale value becomes a data-quality bug.

  **Disposition when Slice 13 lands:** either (a) clear the
  `customer_accepted_*` columns in the `unmarkAccepted` +
  `reviseFromAccepted` tx bodies (defensive; simpler; loses the
  forensic "customer had said X but PM revised" nuance) OR (b)
  every admin reader explicitly guards on
  `quote.status === 'accepted'` before treating those columns as
  live signal. Path (b) matches the existing convention (columns
  are pre-set signal, not post-set truth) but requires per-reader
  discipline.

  Bank noted per Slice 12 Step 10 §0.5 Architect BLOCKER-adjacent
  finding + CA's disposition ("trigger explicitly named").

- **`netsuite_so_pushes.payload_snapshot` retention.** Every SO push
  attempt (succeeded + failed) writes the full REST payload as
  `payload_snapshot jsonb`. Zero pruning story today. At v1 scale
  (~5-50 pushes/month, ~5-20KB each) storage growth is trivial for
  6-12 months. But no policy exists.

  **Trigger:** first month post-v1-launch that CS/support requests
  a rollup of "all payloads pushed in the last 90 days" and the
  query starts pulling MB of jsonb per response.

  **Proposed disposition (Slice 14 or v1.1 admin hygiene):** after
  90 days for `status='succeeded'` pushes, null the `payload_snapshot`
  column (keep the row for forensic identifier trail). Failed pushes
  retain payload indefinitely (rare + diagnostic-critical).

  Bank noted per Slice 12 Step 10 §0.5.

- **`netsuiteSoId varchar(50)` vs `netsuiteSoTranid text` type
  asymmetry on `quotes`.** Cosmetic today (both hold string ids
  that fit `varchar(50)` easily). But the two columns are of the
  same field family and diverge — a future-CC diffing them will
  notice + wonder why.

  **Trigger:** any future migration that touches either column for
  any reason. Fold the type unification into that migration; don't
  ship a standalone migration for cosmetics.

  Bank noted per Slice 12 Step 10 §0.5.

## Slice 14 L2 candidates

- **Smoke-generated audit rows leave orphans on shared dev/prod DB
  (Slice 12 Step 9 CA finding, 2026-07-29).** The fixture cleanup
  script deliberately doesn't cascade to `audit_log` — that's
  correct for real audit trail forensic value. But every smoke run
  leaves permanent audit rows whose `entity_id` points at a
  deleted quote/project. Slice 12's two CB walks produced two
  orphan `quote_completed` rows (formerly `netsuite_so_pushed` —
  see rename); deleted manually as part of the Step 9 rename.
  Slice 13 and 14 will run many more.

  **Two paths, CA disposition banked:**
  - **Add a smoke marker.** Every smoke-fired action writes
    `diff_json.source = 'smoke_fixture'` (or a slice-scoped variant
    like `'smoke_cb_walk'`). Orphan rows are then filterable via
    `WHERE diff_json->>'source' = 'smoke_fixture'` — sweep them
    without touching production data. Pattern matches
    `initial_seed_8c3_post_merge` on `netsuite_customer_map` rows
    (Slice 12 Step 8c-3 seed).
  - **Cascade cleanup to audit_log.** Simpler but breaks the
    forensic-value guarantee for any real audit rows the cleanup
    accidentally sweeps.

  The marker approach is CA's lean — filterable-without-loss beats
  cascade-with-risk. Slice 14 L2 scope; not urgent.

## v1 readiness — pre-launch checklist items

(Items that must be verified before v1 ships. Not deferred polish;
operational pre-flight.)

- [Production DB connection-string posture]

  **Item:** Prod `DATABASE_URL` Vercel env var must point at
  Supabase **session-mode** pooler (port `:5432`), NOT
  transaction-mode pooler (port `:6543`).

  **Why:** transaction-mode pgbouncer multiplexing layer races
  postgres-js's response-correlation logic under concurrent
  `Promise.all` bursts (the `getCostingBundle` pattern). One
  query in the burst orphans; Vercel function hangs until timeout;
  page never renders. Full failure-mode signature + diagnostic
  ladder banked in CLAUDE.md ("Prod uses session-mode pooler
  (:5432), not transaction-mode (:6543)" section).

  **Verification:** at deploy time, confirm Vercel project env
  vars → Production → `DATABASE_URL` ends in `.pooler.supabase
  .com:5432/postgres?...` (not `:6543`). Pre-launch checklist
  + any env-var rotation procedure.

  **Banked from:** cell_ovr postmortem, 2026-06-17.

- [Production Supabase tier]

  **Item:** Production Supabase project on Pro tier ($25/mo) +
  at least Small compute add-on ($15/mo, 2 GB RAM + 2-core ARM
  CPU dedicated). Nano + Micro tiers are dev/preview only.

  **Why:** Nano + Micro share CPU with other tenants; catalog
  queries can stall for minutes under host load. Caused 2026-06-17
  production hang investigation.

  **Verification:** at deploy time, Supabase Dashboard → Project
  Settings → Compute → confirm tier ≥ Small.

  **Banked from:** 2026-06-17 production hang investigation.

- [Slice 11.5.1 — finish OLD-table drops + 5-file migration]

  **Item:** complete the OLD-model retirement that Slice 11.5
  Step 8 carved out. Five deeply-integrated files
  (warnings.ts engine, markup-defaults admin, sku-tree
  library, actions/quotes.ts legacy functions, quote-guards.ts
  helpers) need their OLD-schema reads migrated to NEW-model
  reads OR deleted; OLD tables then drop from `src/db/schema.ts`
  + drop migration applied to prod.

  **Why pre-launch (not v1.1+):** the Slice 11.5 brief's Q2
  wipe-and-reseed-at-launch posture eliminates OLD-table data.
  Once data is gone:
  - Legacy reads in those 5 files return empty
  - Either they break (NULL handling, type assumptions),
    render degraded (empty warnings / admin views), or work
    fine
  - We don't know which without verifying

  We can't safely wipe OLD tables at launch unless either
  (a) Slice 11.5.1 has shipped — files migrated to NEW model
  or deleted, OR (b) we explicitly confirm all 5 files
  gracefully handle empty OLD data. (a) is the safer, less
  archaeological path.

  **Verification:** Slice 11.5.1 ships pre-launch (not v1.1+
  per Edward's reclassification 2026-06-18). Slot in between
  Slice 11.5 close and Slice 11 audit, OR in parallel with
  Slice 12 external lead time. Half-day-to-day scope; cheap
  to absorb.

  **Banked from:** Slice 11.5 Step 8 carve (PR #73, 2026-06-18).

## Open

- **Cross-tier presentation in Commercial recovery and the Accounting agreement
  card**

  **Driver:** Edward, 2026-08-29. **Presentation finding. No implementation as
  part of the OD-032 work.** Banked with a worked example so the class is
  recognisable when it is picked up.

  **The rule that governs it:** *tiers must not be aggregated together. They are
  alternative quote tiers, not additive commercial revenue.* A customer buys one
  tier. A figure summed across tiers is not a quantity anyone will ever pay, and
  a tier-specific figure shown without naming its tier reads as quote-wide.

  **Worked example — quote `2f29af72-805b-446c-866c-73e9b0991b1a`.** An operator
  reported Commercial recovery showing elected one-time charges totalling
  **$14,560** while the customer PDF beside it showed **One-time fees $0.00**,
  and read it as a projection defect. It is not one. Reconciled per tier
  (`scripts/gate-1b/od-032-otc-reconcile.ts`):

  | tier | governed cost | engine revenue | doc unit | doc OTC | doc total | residual |
  |---|---|---|---|---|---|---|
  | Tier 1 | 10,400 | 164,944 | 150,384 | **14,560** | 164,944 | 0.0000 |
  | Tier 2 | 0 | 214,920 | 214,920 | **0.00** | 214,920 | 0.0000 |
  | Tier 3 | 200 | 714,768 | 714,488 | 280 | 714,768 | 0.0000 |
  | Tier 4 | 0 | 1,248,000 | 1,248,000 | 0.00 | 1,248,000 | 0.0000 |

  Engine and document agree exactly on every tier. The $14,560 is **Tier 1**
  derived recovery (tooling `10,000 x 1.4 = 14,000`, plus `100 x 1.4 = 140`
  four times); Tier 2 genuinely carries no one-time-charge economics, so `$0.00`
  is correct. The operator was reading a Tier 1 figure against a Tier 2 column.
  Nothing was wrong with the money — only with which tier each number belonged
  to, and neither surface said.

  **Two distinct code sites, one class:**

  1. `src/components/quote/customer-view-rail.tsx:163` — the agreement card keys
     on `${chargeKey}::${treatment}` and sums `governedRecovery`. Its own comment
     states the frozen instruction is per **(charge, owner, tier)**; the key
     drops the tier, so a charge priced at more than one tier adds across
     alternatives. (Not verified as the arithmetic behind the observed $14,560 —
     that figure equals Tier 1's OTC subtotal exactly — but the summation is
     structurally present either way.)
  2. `src/lib/commercial-recovery/impact.ts:180` — `customerTotalBefore` /
     `customerTotalAfter` reduce `tierCommercialTotal` across every tier. On the
     quote above that is ~2,342,632, a number no customer will ever pay.
     **Currently unrendered** — no consumer outside the module — so this is
     latent, not live. Any future consumer inherits a meaningless figure.

  The per-tier breakdown already exists in `impact.ts` (`tiers[]`, with the
  comment "so a multi-tier quote does not hide where the change lands"). The
  model is right; the scalars beside it are not.

  **Whoever picks this up should decide:** whether these surfaces name a tier,
  show a per-tier breakdown, or scope to the recommended tier — and should
  remove the cross-tier scalars rather than leave them for a later consumer.


- **V1.1 — Final Quote artifact on the NetSuite Sales Order**

  **Driver:** Edward, 2026-08-17. **V1.1 enhancement. Explicitly NOT part of
  the Production/OTC workstream, and not a change to V1 SO payload
  certification.**

  **The ask:** when Nexus pushes a Sales Order from a finalized/accepted
  quote, the customer-facing Quote PDF must be reachable directly from that
  Sales Order.

  - **Preferred:** attach the finalized Quote PDF to the NetSuite SO.
  - **Acceptable alternative** if NetSuite/API constraints make attachment
    undesirable: a durable Nexus link in a dedicated SO custom field.

  **The governing constraint:** the artifact must correspond to the finalized
  commercial state that produced the Sales Order. Regenerating a mutable
  "current" quote later is not acceptable where it could differ from the
  accepted/pushed state.

  That constraint has a direct bearing on existing architecture: `quotes.pdf_url`
  is already the persisted send-time artifact and is the Pattern 52 partial
  mitigation for exactly this class of drift — it answers "what did the
  customer receive" when live columns have moved. Whatever V1.1 chooses should
  start from that pointer rather than introduce a second notion of "the final
  PDF".

  **V1.1 design must determine:**

  - attachment vs durable-link/custom-field mechanism;
  - where the immutable/final artifact is stored;
  - replay/re-push behaviour, so a second push does not create duplicate
    attachments — note the SO push is already idempotency-keyed, so this should
    compose with that rather than invent a second scheme;
  - whether a revised quote/SO preserves the prior artifact or supersedes it;
  - access/authentication requirements if a Nexus URL is used — a link a
    NetSuite operator cannot open is not traceability;
  - NetSuite sandbox certification that an operator can open the correct quote
    artifact directly from the resulting SO.

  **Scope:** traceability and operator convenience only. No commercial figure,
  no payload field that participates in reconciliation.

- **Classifier config validation: `floor_margin_pct <= target_margin_pct`**

  **Driver:** Slice 12 Step 8c-3 smoke build (2026-07-28).

  **The gap:** `firm_settings` has no invariant preventing an admin
  from setting `floor_margin_pct > target_margin_pct`. The classifier
  order is `GOOD if margin >= target, else BELOW_TARGET if margin >=
  floor, else BELOW_FLOOR`. If floor is bumped above target, the
  BELOW_FLOOR branch becomes unreachable when the tier is above
  target — the guard silently stops firing on high-margin tiers.

  In production this holds by convention (target > floor always),
  but nothing enforces it. Slice 12's below-floor guard on
  markComplete depends on the classifier being correct. If an admin
  inverts them, the guard silently no-ops on quotes where target is
  cleared but floor is left high, and a below-margin-floor quote
  could complete → SO push → invoiced.

  **Candidate fix (small, self-contained):**

  - Add a CHECK constraint OR a `versionedFirmSettingsUpdate`-side
    validator that rejects any update where the resulting row has
    `floor_margin_pct > target_margin_pct`
  - Same shape as the "carry-forward audit" discipline documented in
    CLAUDE.md — one line of validation in the update helper, plus
    a CHECK on the table for durability

  **Not this slice.** Bank + revisit when firm_settings admin surface
  gets its next touch.

- **Pattern 52 freeze verification via an in-request-scope test harness**

  **Driver:** Slice 12 Step 8c-3 smoke build (2026-07-28).

  **The gap:** The smoke script attempts to verify the Pattern 52
  draft-lock by calling `updateQuoteGlobalPriceAdj` on a completed
  quote and asserting it's rejected. That action calls `ensureUser()`
  which uses Clerk's `auth()` — which requires a Next.js request
  scope. Smoke runs outside a request context and fails with:
  `Clerk: auth(), currentUser() and clerkClient(), are only supported
  in App Router (/app directory)`.

  The smoke currently falls back to a DB-drift check (verify
  `status` still `'complete'` after the mutation attempt), which is
  weak — the mutation didn't happen because Clerk blocked at
  `ensureUser()`, not because the freeze guard fired.

  Slice 12 Step 8b's `complete-status-writer` verifier proves at
  build time that only `mark-complete.ts` writes `status='complete'`
  — but proving that DRAFT-LOCK guards fire from every other
  mutating action requires either:
  1. A Playwright E2E-style test with real Clerk auth (in-request-
     scope)
  2. A refactor that extracts `ensureUser`-free variants of the
     action bodies for direct invocation (adds surface area)
  3. A dedicated harness that spins up a minimal Next.js request
     context for smoke scripts

  Not this slice. Bank as durable coverage improvement.

- **NetSuite `class` field is dead on live SOs; `custbody_dps_project_service_s` is the real signal**

  **Driver:** Slice 12 Step 8c-3 Correction 1 cross-check
  (2026-07-28).

  **The finding:** Across the 30 newest SOs in the sandbox, **zero
  have `class` populated** — every one shows `class=(none)`. The
  NetSuite `classification` table has one `Turnkey` entry
  (id=1790), but no SO uses it as its `class` field. The label
  Edward remembered seeing ("Business Segment / TurnKey" on
  SO2646) doesn't come from the `class` field — it may have been
  a UI-rendered surface backed by a different column, or an
  artifact of an older SO era.

  **What SOs actually carry** as the "what type of work is this"
  signal is `custbody_dps_project_service_s`. Every recent SO has
  it populated (via the HubSpot workflow that copies from
  `project_service_s_` on the deal). Distinct values in the 30
  sampled: `Product 360°`, `Primary Packaging`, `Secondary
  Packaging`, `Soft Goods & Accesories`, `Formulations`, `Other`.

  **Related findings from the same probe:**
  - HubSpot `business_segment` is populated on only 1 of 65 cached
    deals (Epicuren-Pro Masks, `id=1` / label `Product 360°`).
    The field exists but is essentially unused as a filter axis.
  - HubSpot `business_segment` enum has ONLY 2 options today
    (`1=Product 360°`, `3=DPS Packaging`). `Turnkey` is NOT in
    the current enum; Product 360° is the current active label
    (not retired as previously assumed).
  - `custbody_dps_auto_generate_project` distribution across ALL
    SOs: 413 `T` (58%), 284 `F` (40%), 1 `NULL`. In the newest
    30, 21 of 30 (70%) have a `job` attached. Consistent with
    Vu's ~60% baseline. The correlation of `has_job` with
    `service_s` is imperfect — Primary/Secondary Packaging
    attach ~50%; Product 360° / Soft Goods / Formulations attach
    ~100%.

  **Implications for any future Project-related work:**
  - Don't filter/derive on `business_segment` — the coverage is
    ~1.5% of deals. Under-populated at HubSpot.
  - Don't filter on `class` — always empty on live SOs.
  - Use `custbody_dps_project_service_s` (or its HubSpot source
    `project_service_s_`) as the enum-shaped signal. It's
    populated on essentially every SO and carries the granular
    service classification PMs actually set.
  - Historical `custbody_dps_auto_generate_project` distribution
    can't support a business rule — the flag defaulted to `true`
    on every SO until 2026-07-28. Populations generated under a
    blanket default don't reveal intent.

  **Slice 12 disposition (2026-07-28):** Projects stay out of
  Nexus's scope entirely. Nexus does not set
  `custbody_dps_auto_generate_project`. It defaults to whatever
  NetSuite's default is (now `false` post-Vu-change). Amy
  continues handling Projects manually as she does today.

  If Project creation is ever brought back into Nexus's scope,
  this entry is the starting map of what fields carry what
  signals. Skip the dead ends (business_segment / class) and
  start with `project_service_s`.

- **Slice 13 entry gate — Sales Order lineage and behavioral parity**

  **Priority:** must complete before new Slice 13 feature work.

  Build a field-level trace across HubSpot → Nexus → NetSuite sandbox for every
  accounting-relevant Sales Order field. Classify each result as `PARITY`,
  `INTENTIONAL CHANGE`, `ENVIRONMENT DIFFERENCE`, `SOURCE DATA GAP`,
  `MAPPING GAP`, `NETSUITE CONFIG GAP`, or `UNKNOWN / BLOCKER`.

  Production and sandbox need not be literally identical where environment
  configuration differs, but every difference must be traced to its root
  source. Completed Item Groups are the only intended Accounting-visible
  behavioral change. All other relevant SO data must remain commercially and
  operationally equivalent or carry an explicit, evidence-backed environment
  distinction.

  Item Group creation requires valid item-level pricing. `$0.00` upstream
  catalog pricing is sufficient to pass NetSuite validation, but it is a
  technical placeholder only and must never become the commercial transaction
  price. Unknown pricing lineage is a blocker.

  Validation policy and handover:
  `docs/validation/slice-12-handover.md`.

- **NetSuite Item Group SO attachment — REOPENED, required for v1
  (Probes 5 → 7 + Vu's finding)**

  **Driver:** Slice 12 Step 8c-3/4 investigation arc
  (2026-07-28/29). This entry preserves the full reasoning trail
  because the entry's value is the arc, not the endpoint — closed,
  then reopened after diagnosing the actual error. Reader in six
  months should see we were wrong first and why.

  ### Arc

  **Probe 5 — PATCH refused. Believed closed.**
  Following the earlier POST + SOAP probes, Probe 5 tested whether
  NetSuite's PATCH validator was more permissive than POST —
  hypothesis: UI's "add group then price members" flow might mirror
  a REST create-flat-then-PATCH-group pattern. Four PATCH variants
  against a successfully-POSTed flat SO (customer 131860, group
  64026, 3 leaf lines with rates):

  ```
  B1 · APPEND     PATCH items=[flat×3, group]                → 400 at [3]
  B2 · REPLACE    PATCH items=[group, member×3-with-rates]   → 400 at [0]
  B3 · REPLACE    PATCH items=[flat×3, group-at-end]         → 400 at [3]
  B4 · REPLACE    PATCH items=[group-alone]                  → 400 at [0]
  ```

  Identical `USER_ERROR: "Please enter a value for Amount"` at the
  group's position across all four. Combined with POST + SOAP,
  concluded: "all API-surface paths for Item Group SO attachment
  are closed; only SuiteScript's `record.create` accepts group
  lines." **That conclusion was wrong.**

  **Probe 6 — the error message was diagnostic, not architectural.**
  CA push-back — "diagnose the error, don't work around it" —
  reopened the question. `"Please enter a value for Amount"` meant
  exactly what it said. Three sub-probes:

  - **6c** — read-only inspection of TCS-BAR-01's live members
    (41350 · 21447 · 19840) showed EMPTY `/price` sub-collections
    despite carrying UI-typed rates on the live SO's tx-lines. NS
    UI populates rates on the tx-line side; API validator reads
    item-side `/price` at parse time.
  - **6b v4** — created a throwaway Item Group with a single member
    that HAS a populated `/price` (item 2769, priceLevel=1/currency=1
    = $6.884). Bare-group SO POST (zero rate on the group, no
    member lines in payload) → **204 CREATED (SO 359847).**
    Hypothesis confirmed: bare-group POST works when members are
    item-level priced.
  - **6d** — verified whether inline member rates on the request
    substitute for item-level `/price` (they don't). Four variants
    against real TCS-BAR-01 unpriced members; every group-line
    variant refused; only the flat-lines control passed.

  **Diagnosis:** NetSuite's REST SO validator runs a "compute per-
  line amount from group members" step atomically at parse time,
  BEFORE reading inline `rate` or `amount` on member lines. When
  members have populated `/price`, that step succeeds; when they
  don't, it fails with the error we saw seven times across two
  API surfaces.

  **Probe 7 — POST bare-group → GET expandSubResources → PATCH each
  member line works. $0.00 satisfies the validator.**
  - **7a** — line rate does NOT override item price. Adding an
    explicit member line alongside the group creates a DUPLICATE
    line (both fire, totals double). Group rate on the group line
    is ignored.
  - **7b** — throwaway InvtPart with `/price = $0.00` accepted
    (bare-group POST 204). `$0.00` is a legal, validator-satisfying
    "no standing price yet" placeholder.
  - **7d** — `PATCH /salesOrder/{id}/item/{lineIdx}` with `{rate: X}`
    updates the auto-expanded member line IN PLACE (204, rate
    changes, amount recomputed, no duplication). Full-sublist PATCH
    duplicates; single-line PATCH is the safe shape.

  **Vu's finding — the fix relocates upstream.**
  NetSuite items are unpriced because the HubSpot products are
  unpriced. The HubSpot → NetSuite sync propagates prices when
  they exist; it can't invent them. Fix source shifts from
  Nexus's payload shape to HubSpot's product-price backfill (see
  the price-backfill directive, Probes 8a-d).

  ### Current state — reopened, required for 1.0

  **The Item Group wrap is customer-visible, not cosmetic** — it's
  why the customer invoice shows one turnkey line at $X per unit
  instead of freight / customs / setup components separately
  (INV2978 canonical). Aisha wrapping manually post-SO-push
  becomes structurally unnecessary once member prices exist.

  **Three routes, none blocked:**
  - **(a)** HubSpot product `price` backfill (Vu's tract). Every
    HubSpot Product gets `hs_price = 0` where currently empty;
    sync carries that to NetSuite. Recurring inflow: `mapLeaf
    ToHubspotCreate` skips `price` by design (`src/lib/hubspot-
    mapper.ts:20`) — one-line change adds `hs_price: 0`.
  - **(b)** NetSuite-side batch update via SuiteQL / REST batch
    (Vu's alternative if the HubSpot pipeline stops propagating
    the value at scale). ~937 unpriced InvtPart items in scope
    per Probe 8c.
  - **(c)** Nexus-side per-SO PATCH of expanded member rates
    (Probe 7d single-line PATCH pattern). More per-SO code but
    doesn't require touching the catalog.

  Route (a) is the cleanest — item pricing is a data attribute of
  the item, not the order.

  ### Lesson — bank explicitly

  **A thorough elimination is not a diagnosis.** Seven payload
  shapes across two API surfaces (Probes 5's PATCH ×4, plus the
  earlier POST + SOAP + PATCH APPEND) looked definitive. The
  conclusion drawn from them — "the API refuses Item Groups" —
  was wrong. The error message named a missing field (`Amount`),
  and that's what it was. When a system rejects something, explain
  the stated reason before accepting any conclusion built on it.
  Probe 5's "PATCH validator identical to POST" wasn't false —
  it just wasn't the finding. Both validators refuse the same
  input for the same reason; that's a data condition, not an
  architectural one.

  Applied elsewhere in this slice: the same discipline caught the
  fixture-masked `accepted_tier_id` P0 (freeze-tx wrote every
  visible column except the one Pattern 52 required).

  ### Hazards banked from Probes 6-7 (grouped-SO implementation
  contract when Route (a)/(b)/(c) lands)

  1. **Sublist PATCH silently duplicates at 204.** `PATCH /salesOrder/
     {id}` with `item.items=[group, member@rate, …]` returned 204
     but ADDED a second full group expansion. 12 tx-lines total,
     rollup doubled, no error surfaced. If any grouped-SO
     implementation reaches for sublist PATCH instead of single-line
     PATCH (`/item/{lineIdx}`), it ships wrong SOs that report as
     successful. Must be structurally impossible in the
     implementation — a code convention isn't enough.
  2. **Partial-failure mid-sequence produces a valid-looking wrong
     SO.** The write is [POST bare-group → GET expandSubResources →
     N × PATCH member rates]. Crash between step 3.j and 3.j+1
     leaves the SO created, group expanded, some members priced,
     some at their `/price` value (which may be $0). Order looks
     valid; nothing flags the drift. Recovery design: either
     wrap the N PATCHes in a Nexus-level transaction with SO
     delete on any failure, or read back `transactionline` via
     SuiteQL post-PATCH and assert every expanded member carries
     the intended rate before persisting `netsuite_so_pushes.
     status='succeeded'`.

- **NetSuite Assembly migration (v1.5 / v2.0 candidate)**

  **Driver:** Slice 12 Step 8c-3/4 REST + SOAP + PATCH probes
  (2026-07-28/29). Even with Item Group SO attachment reopened
  via the priced-member route (see entry above), Assemblies remain
  the durable strategic direction. This entry catalogues why.

  **Five aligning points make the case (updated after Probes 5-7):**

  1. **NetSuite's API models Assemblies as first-class** — proven
     via Probe 4 (2026-07-28). REST POST of a SalesOrder with an
     Assembly line succeeds cleanly (204 CREATED, tx-line-level
     pricing, no "Please enter a value for Amount" error). SOAP
     analogously accepts them (post-entitlement).
  2. **Item Groups on SOs have a hidden data precondition** —
     Probe 7 (2026-07-29) proved that REST accepts Item Group
     lines when member items carry populated `/price` sub-
     collections; refuses them at parse time when members are
     unpriced. SOAP behaves identically. The UI's SuiteScript
     `record.create` bypasses the parse-time check by populating
     rates on the tx-line side during the interactive save.
     Assemblies have no equivalent precondition — they price at
     the assembly level, one line, no member-side dependency.
  3. **Nexus's ASY/LEAF model is assembly-shaped, not
     group-shaped** — parent SKU with children, qty_per_parent,
     roll-up pricing, cost + revenue decomposition. Assemblies
     have a build model + component consumption + inventory
     transformation; Item Groups are a presentation wrapper.
     Nexus's data already matches the former.
  4. **The v2 roadmap already targets NetSuite-direct integration
     with native BOMs** — this migration compounds cleanly with
     the direction Edward already set for post-v1 evolution.

  **Plus one detail that makes it tractable:** DPS already has
  **9 Assembly items in the NetSuite catalog** (probed sandbox
  2026-07-28: `Berry Hanks Hydration Assembly`, `BrainMD 355
  Hydration 20ct Pouch(Assembly))`, `BrainMD-351 Brain Boost-
  Assembly`, `Fanny Bum Butter Assembly`, `Joop Skin Assembly`,
  others). This is EXPANSION not greenfield — Melinda's team
  knows Assembly setup; Aisha's workflow can extend the pattern
  from 9 to N without new NetSuite-side concept training.

  **Slice 12 Step 8c-3 stakes:** Item Group wrap remains Aisha's
  MANUAL STEP after Nexus's SO push. She wraps in the NetSuite
  UI before invoice generation — this is CUSTOMER-VISIBLE (the
  group is why customer invoices show one turnkey line at $X per
  unit instead of freight/customs/setup components separately —
  INV2978 is the canonical example). Not cosmetic. Nexus delivers
  correct pricing (Aisha stops retyping); the group wrap is
  still hers to do until the Assembly migration lands.

  **What the migration would do:**
  - Aisha's team creates NetSuite Assembly items for each Nexus
    quotable ASY (or, better, Nexus authors them programmatically
    via the REST create path Probe 4 proved works)
  - `markComplete` references the resolved Assembly item on the
    SO — one clean line, no group wrap needed
  - The `netsuite_item_groups` table + `composition_hash` +
    `findOrCreateItemGroup` primitives from Slice 12 Steps
    8c-1/8c-3 stay live-tested via
    `npm run smoke:netsuite-item-groups` (against a real sandbox
    Item Group create + delete cycle). When Assemblies land, we
    either extend those primitives for Assembly find-or-create
    (similar shape, different NS record type) or retire them
    entirely if Aisha's team maintains the Assembly catalog
    manually.

  **v1.1 vs v2 timing:** the migration is bounded (9 existing
  Assembly items to extend to N; the API path is proven to
  work). Could ship as a v1.1 mini-slice if Aisha wants to
  eliminate her wrap step soon; otherwise natural fit for the
  v2 NetSuite-direct workstream Edward already planned.

  **Not touching until Slice 12 ships.** Flagged in
  `src/lib/netsuite/mark-complete.ts` STEP 5 block with a
  pointer back to this entry.

- [Per-assembly production fan-out — math layer extension]

  **Driver:** Slice 11.5 Step 3 adapter implementation
  (PR #68; re-banked Step 5 — original Step 3 push missed the
  merge window).

  **Current v1 implementation:** assembly_production_inputs is
  per-(assembly, tier) in the NEW model, but the math layer
  expects production[] keyed by leaf id. The adapter
  (`src/lib/costing-adapter.ts`) attaches production data to the
  FIRST assembly_leaf under each assembly (lowest `position` —
  the "anchor leaf"); siblings get zero production. Math total
  is preserved correctly via additive assembly rollup; Production
  drilldown UI shows asymmetric per-leaf rendering (one row with
  the production cost, siblings empty).

  **v1.1+ candidate scope:** extend `computeQuoteCosting` to
  consume per-assembly production directly via a new
  `assemblyProduction[]` input slot keyed by (assembly_id,
  tier_id). UI then renders production at the assembly row level
  (one row per assembly per tier), not per-leaf. Eliminates the
  anchor-leaf coercion + UI asymmetry.

  **Why deferred from Slice 11.5:** Pattern 22 §3 commitment is
  "math layer is the load-bearing surface; future cost-data
  migrations don't touch the math, only the adapter." Adding the
  `assemblyProduction[]` slot is a math-layer change — belongs in
  a later slice with explicit math-layer scope, not folded into
  the adapter-only Slice 11.5.

  **Mitigation in Slice 11.5 (if needed):** Step 5 CB walk
  evaluates PM reaction to the anchor-leaf rendering. If walk
  surfaces confusion, low-effort UI clarity options stay
  in-scope:
  - Tooltip on the production cost cell: "Production cost shown
    on lowest-position component; represents total for this
    assembly"
  - Visual treatment differentiating the anchor leaf (label /
    icon)
  - Hide production from non-anchor leaves entirely; show only
    at the anchor row with "assembly-level cost" framing

  If walk surfaces no confusion (PMs intuit it), skip the UI
  tweak. Decision deferred to Step 5 CB outcome.

  **Banking rationale:** "per-assembly source → per-leaf adapter
  coercion" is a real architectural pattern that future-CC
  should recognize. The math layer's per-leaf assumption is
  load-bearing for v1; relaxing it is a deliberate v1.1+ move,
  not a casual addition.

- [Per-component vs per-product flagging on Mark-Accepted +
  Pricing surfaces (banked from Slice 11.5 Step 5 audit)]

  **Driver:** Slice 11.5 Step 5 surface audit (PR #70; banked
  2026-06-18).

  **What changes in NEW model:** the math layer's `skuRollups[]`
  now contains per-(assembly_leaf, tier) verdict rows for
  marginStatus (GOOD / BELOW_TARGET / BELOW_FLOOR). In OLD
  model, leaf SKUs WERE finished products, so leaf-level
  flagging matched PM mental model ("which PRODUCT is below
  floor"). In NEW model, leaves are COMPONENTS of an assembly,
  so leaf-level flagging surfaces component-level concerns
  (e.g., "LIB-PP-BOTTLE-30 — T1 — 24% margin"). PMs may expect
  product-level flagging ("HGS-30-001 — T1 — 24%").

  **Surfaces affected:**
  - Mark-Accepted page (`mark-accepted/page.tsx`) flaggedLines
    section: shows leaf-level rows for any leaf with
    marginStatus=BELOW_FLOOR
  - Pricing surface `LinesRequiringReview` component: same
    pattern; renders only when blendedMarginStatus is BELOW_FLOOR

  **v1.1+ candidate mitigation options:**
  - Roll leaf-level BELOW_FLOOR up to parent assembly's
    BELOW_FLOOR status, then show only assembly rows in
    flaggedLines (matches PM mental model)
  - Show BOTH: assembly row when any child triggers + drilldown
    to component details
  - Add explicit "Components below floor: 1 of 4" sub-text on
    the assembly row's status line

  **Why deferred:** same posture as anchor-leaf production
  banking — the math layer is doing the correct math; UI surface
  ergonomics is the polish concern. Step 5 CB walk evaluates
  empirical PM confusion before authorizing the UI work.

  **Step 5 walk asks:** present sample-order data to PM; trigger
  a leaf-level BELOW_FLOOR (override on one component below
  floor); show the Mark-Accepted modal; ask "is this clear?"
  Same exercise on the LinesRequiringReview affordance during
  Pricing surface walk.

- [Packaging copy-tier-to-all helper — promote priority if PMs ask]

  **Driver:** Slice 11.5 Step 4 close-out (PR #69; banked
  2026-06-18). OLD `copyTierValueToAllTiers` action had no §4
  counterpart in the NEW model; its sole caller was the orphan-on-
  disk `packaging-line-row.tsx` deleted with the cutover, so no
  v1 user-visible affordance was lost.

  **What it did:** packaging lines have one row per (line_group,
  tier). When a PM had identical unit_cost or purchase_qty across
  tiers (common during early data entry — same supplier price
  before tier-volume discounts negotiated), copy-tier-to-all
  propagated a single tier's value to siblings in one click.

  **NEW-model analog (when implemented):** server action
  `copyAssemblyLeafInputTierToAll(formData)` keyed by
  `lineGroupId` + `sourceTierId` + `column`; reads
  `assembly_leaf_inputs` rows by `line_group_id`, applies source-
  tier value to non-source siblings via transaction; audit row
  `assembly_leaf_input_tier_value_copied`. Behavior + audit
  shape lift from OLD action verbatim.

  **UI re-attach point:** packaging-drilldown's per-line cell
  cluster. A `↪` chevron next to the cell or row-level menu
  affordance.

  **Promote priority signal:** if PMs surface data-entry
  friction during real-data testing post-Slice-11.5 ("I'm
  retyping the same value across 3 tiers"), promote this from
  v1.1+ to a low-effort polish slice. Single-action + single-
  affordance scope ≈ half-day implementation. Audit name is
  already namespace-consistent.

- [PR #54 PSR action-zone affordance audit (Slice 11 audit scope expansion)]

  **Driver:** Slice 11.5 CB walk MIG-4/5 cannot-verify results
  (PR #74 close-out; 2026-06-18). RequiredSellCell +
  ClientTargetCell components are orphan-on-disk (zero active
  imports). PR #54 PSR redesign moved override + client target
  workflows out of inline cell-click into action-zone /
  detail-zone patterns, but the OLD per-cell input components
  were never deleted.

  **Open question:** did PSR move the affordances to
  action-zone (Hypothesis A — workflow lives in
  `request_override` action button + similar for client target),
  OR remove them without replacement (Hypothesis B — PMs hit
  SUGGESTION-LED / BLOCKED modes with no way to set override
  or target)?

  **If Hypothesis A:** CB walk spec update (banked under
  comprehensive CB test suite) documents the actual workflow
  + state-prep steps; affordances WORK; bank UX discoverability
  improvement for Slice 11 audit (better visual cue than
  workflow-buried action button).

  **If Hypothesis B:** pre-launch UX item — PMs WILL hit
  suggestion-led/blocked modes in real use; affordance must
  exist somewhere. Slice 11 audit absorbs scope.

  **Verification approach:** during Slice 11.5.1 work, inspect
  `src/components/pricing-surface/action-zone.tsx` and
  detail-zone for sell-price override / client-target entry
  components. Findings feed into Slice 11 audit pre-brief
  inventory.

  **Slice 11.5 disposition (closed 2026-06-18):** NOT a Slice
  11.5 regression. Orphan state predates Slice 11.5. Step 4
  wired the orphan components to NEW write actions for
  forward-compatibility; Slice 11.5.1 §A3 deletes the orphans.

- [Slice 11.5.1 bonus catch: per-cell override + client-target realtime subscriptions]

  **Driver:** Slice 11.5.1 §A2 (banked 2026-06-18; ships with
  the slice). Positive externality of the NEW-model wiring.

  Slice 8.5 originally omitted `quote_sku_tiers` +
  `quote_sku_tier_targets` from realtime subscriptions (sparse-
  row tables with no realtime consumer at the time). The NEW
  model equivalents (`assembly_leaf_overrides` +
  `assembly_leaf_targets`) ALSO weren't wired by default.

  **Slice 11.5.1 §A2 brings these online** alongside the
  primary OLD→NEW subscription migration. Per-cell sell-price
  override + client-target edits propagate cross-tab for the
  first time.

  **Verification:** MIG-8 re-walk during Slice 11.5.1 explicitly
  exercises this: edit a sell-price override on tab A → tab B
  reflects the change via realtime per Slice 8.5 wait-for-quiet
  reconcile pattern.

- [Quote umbrella + NetSuite finalization — v1 path item 4]

  **Slice:** v1 release-critical path item 4 (absorbs former
  standalone Mark-Accepted external writebacks scope).

  **Combined slice covering:** Quote sub-tab IA restructure
  (Preview Quote · Send to Client · Mark Accepted · Tier
  Selection) + Advance action mechanism + HubSpot deal stage
  push (on Mark Accepted sub-tab Advance) + NetSuite SO push
  (on Tier Selection sub-tab Advance) + finalization warning.

  **Brief:** `docs/quote-umbrella-brief.md`. Edward + CA
  disposition: combined slice (no X/Y split).

  **Prereqs before kickoff:**
  - Pricing reframe v1 ships
  - Leaf-detach micro-slice ships
  - CA-drafted frame doc (`docs/post-pricing-flow-ia-frame.md`)
    locks
  - CD R7 design round ships Pattern 30 deliverables
  - Edward dispositions Q1-Q7 from brief §7 (especially HubSpot
    deal stage mapping + NetSuite SO creation status)
  - Architect Pattern 22 §0.5 verification against post-revision
    canon

  **Scope IN:** Sub-tab IA + structural UI; state enum extension
  (`preview_ready`, `complete`); new schema columns
  (`selected_tier_id`, `netsuite_so_id`, `netsuite_pushed_at`);
  finalization warning; HubSpot writeback on Mark Accepted
  Advance; NetSuite SO push on Tier Selection Advance with
  idempotency key (`quote_id + quote_version`).

  **Scope OUT:** Operations wrapper artifacts (BoM, packing
  list, freight tracker — see Operations wrapper entry below);
  customer self-serve flows; quote versioning workflow for
  post-Complete changes (v1.5+ backlog); multi-tier orders.

  **Absorbed scope:** This slice subsumes the standalone Mark-
  Accepted external writebacks slice that previously sat at v1
  path item 9. HubSpot deal stage push moves to Mark Accepted
  sub-tab Advance; NetSuite SO push moves to Tier Selection
  sub-tab Advance. Net +1 slice on v1 path; timeline shifts
  ~1-2 weeks. Updated v1 release window: late July to early
  August 2026.

- [Operations wrapper / orchestration layer — post-v1]

  **Slice:** post-v1 (v1.1+ / v2). NOT a peer surface; NOT v1
  scope.

  **Concept:** Future cross-cutting surface that sits **above**
  the per-quote flow. Different KIND of surface than the per-
  quote linear sequence — a wrapper / dashboard / orchestration
  layer that manages many quotes/deals from above.

  **Conceptual contents:**
  - Home dashboard
  - Items in flight (cross-quote view)
  - Post-acceptance tracking (procurement status, production
    status, shipment status, delivery confirmation, invoice link)
  - BoM generation (assembly-aware bill of materials)
  - BoM Compliance Claims
  - Packing list
  - Freight tracker
  - Cross-shipment views
  - Actuals-vs-estimate reconciliation

  **Strategic frame:** Nexus's per-quote flow ends at NetSuite
  SO push (v1, per Quote umbrella slice). Operations wrapper is
  where Nexus's assembly-aware operational spine renders as a
  managed-across-flows dashboard layer. Replaces the operational
  fragmentation Aisha identified (Monday.com + SharePoint +
  bouncing between HubSpot / NetSuite for status).

  **Validated against ops-analyst feedback May 15 2026** — Aisha
  Manjra independently identified "operational dashboard to
  replace Monday.com + SharePoint" as the wrapper need.

  **Placement TBD.** Three candidate options banked:
  1. Home-page-level dashboard above the per-quote flow
  2. Deal organizer level inside workspace concept (Round 4
     backlog)
  3. Separate workspace concept entirely

  Design round (R8+) determines placement when scoped post-v1.

  **Open boundary questions banked:**
  - Packing list ownership: Nexus authors vs. NetSuite
    Fulfillment authors and Nexus mirrors. Data gaps (per-
    package contents, per-package weights, carrier interface)
    need disposition first.
  - Procurement status: Nexus inbound from NetSuite POs (read-
    only feed) vs. read-only embed (iframe-like) vs. Nexus
    becomes the authoring surface and writes to NetSuite. Same
    question shape applies to production status.
  - Returns / change orders / revisions: wrapper scope vs.
    separate workflow? RMAs intersect quote lifecycle but may
    deserve their own surface.
  - HubSpot deal pipeline display: read-only vs. bidirectional
    vs. agnostic.
  - Lifecycle event emission: which mutations are events
    (acceptance, BoM-generated, PO-cut, shipment-departed, etc.)
    vs. derived state? Affects schema choice between a dedicated
    `lifecycle_events` table vs. extending `audit_log`. Quote
    umbrella slice (item 4) should emit events compatible with
    Operations wrapper consumption when it ships; specific
    schema decision deferred until Operations wrapper design
    round.

  **Revision note (2026-05-17):** This entry replaces an earlier
  "Operations surface — post-acceptance lifecycle hub" entry that
  framed Operations as a 6th peer surface in v1.1+. That framing
  was the wrong shape. Operations is a wrapper layer above the
  per-quote flow, not a peer in the per-quote linear sequence —
  different KIND of surface. v1 surface canon stays at 4 peer
  surfaces (Setup / Costs / Pricing / Quote). See CLAUDE.md
  "Surface naming canon" section + Quote umbrella structure
  subsection.

- [Product specs storage + customer-facing Quote PDF toggle — v1.1]

  **Slice:** v1.1. SKU-attached specs field plus customer-facing
  visibility control on Quote PDF.

  **Schema sketch:** `quote_skus.specs jsonb` (recommended given
  beauty/wellness spec variability — fragrance notes, ingredient
  lists, fill volumes, regulatory claims, etc. Structure later if
  patterns emerge across categories. JSONB beats early-typed
  columns when the shape is unknown). Customer-facing Quote PDF
  gains optional show/hide toggle (per-quote initial scope; per-
  SKU is v2 refinement if the use case surfaces).

  **Pattern 25 verification at brief time:** spec field shape
  (JSONB column, NULL default), Quote PDF binding path (specs
  optionally consumed in PdfPricingTable or a dedicated spec
  sub-block), toggle storage (`quotes.show_specs_on_pdf bool`
  default false vs. surface in Quote chrome only).

  **Pattern 45 verification:** specs are real binding through
  action layer → quote-fixtures → customer-view boundary. No
  placeholder strings on the customer-facing render. Empty specs
  → block renders empty (not "{specs-pending}").

  **Validated against ops-analyst feedback May 15 2026** — Aisha
  + Edward agreed specs live under each SKU in Nexus with
  optional visibility toggle on quote documents. Removes the
  "spec sheet lives elsewhere, has to be cross-referenced"
  friction.

- [Quote attachments — file storage for manufacturing quotes + accounting docs — post-v1]

  **Slice:** Lives in Operations wrapper layer (post-v1). Surface
  details depend on Operations wrapper design (R8+). Previously
  scoped as a v1.1 per-quote feature; reframed 2026-05-17 per
  canon revision — attachments are an operational artifact that
  fits the wrapper's document-archive concept better than a
  per-quote-surface bolt-on.

  Original design notes preserved below for the eventual
  Operations wrapper design pass.

  **Concept:** New architectural piece — first surface that
  writes user files to Supabase Storage. Operational document
  archive on the quote.

  **Stack addition:** Supabase Storage layer (already in the
  Supabase project; no new vendor). New `quote_attachments`
  table:
  - `id uuid pk`
  - `quote_id uuid fk → quotes(id) on delete cascade`
  - `type` enum (`manufacturing_quote | accounting_doc | other`)
  - `original_filename text not null`
  - `supabase_storage_path text not null` (bucket + path)
  - `uploaded_by uuid fk → users(id)`
  - `uploaded_at timestamptz`
  - `size_bytes int`
  - `content_type text`
  - `is_archived bool default false` (soft delete for version
    handling)

  **UI placement:** attachments panel on Quote (or Setup —
  disposition at brief time; depends on whether PMs upload pre-
  or post-acceptance more often). Probably Setup — uploads tend
  to happen during quote authoring.

  **Boundary explicitly excluded:** artwork stays on SharePoint.
  Scope is internal/operational documents only — manufacturing
  quotes from suppliers, accounting docs, internal worksheets.
  Artwork has its own workflow that doesn't fit a quote-scoped
  attachment model.

  **Operational concerns to scope at brief:**
  - File size limits (Supabase Storage default 50MB per file;
    raise per-bucket if needed).
  - Retention policy (delete-on-quote-delete via cascade vs. soft
    archive forever for audit).
  - RLS policies on the storage bucket (Clerk-Supabase JWT bridge
    not yet in place — see broader RLS-off framing in CLAUDE.md
    "Realtime ↔ optimistic store contract / RLS-off latent
    dependency" section).
  - Downloadable-vs-viewable (PDF/image inline; other types
    download-only).
  - Version handling on re-upload (new row with `is_archived`
    flag on previous vs. overwrite vs. version chain).

  **Validated against ops-analyst feedback May 15 2026** — Aisha
  + Edward agreed manufacturing quotes + accounting docs
  uploadable to Nexus directly. Eliminates the "where did Sarah
  save that PDF" SharePoint hunt.

- [AI-based price optimization — v2+]

  **Slice:** v2+. Bank only — no design needed today.

  **Concept:** AI layer that recommends sell-price adjustments
  given quote inputs + historical win/loss + market signals.
  Adjacent to Slice 9 anomaly detection but inverted in
  direction:
  - Anomaly detection (Slice 9): warns when a price looks wrong
    given the cost stack.
  - Optimization (v2+): recommends a price given win-likelihood
    + margin targets.

  Two-layer architecture is intentional. Anomaly layer is
  load-bearing for trust (PMs can't ship at obviously-wrong
  prices); optimization layer is opportunistic uplift. Ship
  trust-layer first.

  **Surfaced in ops-analyst feedback May 15 2026** — Edward
  referenced future AI optimization capability as part of the
  quoting tool roadmap. Bank for visibility; no implementation
  scoping today.

- [Drizzle journal hygiene — retire `drizzle-kit push` for shared infra; hash-match-on-disk verification before any journal-row mutation]

  **Slice:** Dev-hygiene; non-blocking. Bank for the next dev-tooling
  pass.

  **Reference moment:** R6.2 commit 1 (2026-05-15). Shared Supabase
  `drizzle.__drizzle_migrations` had three rows whose hashes
  matched no on-disk file (ids 19, 20, 24). When CC's
  `0026_r6_2_freight_legs_additive.sql` was generated and Edward
  ran `npm run db:migrate`, drizzle's position-based comparison
  silently skipped the new migration. CC mis-diagnosed the
  surface-visible orphan rows (ids 26/27/28), Edward
  rubber-stamped the null-op claim, and a DELETE of ids 26/27/28
  removed the journal records for migrations 0023/0024/0025 —
  whose schema effects were still in the DB. The mistake was
  recovered cleanly from a captured backup. Final correct
  diagnosis: hash-match every DB row against on-disk files
  (LF-normalized SHA-256). The genuine orphans were ids 19, 20,
  24 — different rows entirely.

  **Two lessons banked from the incident:**

  1. **`drizzle-kit push` retirement for shared infra.** Push
     writes to `__drizzle_migrations` without going through the
     normal migration flow. That's exactly how an entry ends up
     in the journal with no corresponding file. On a single
     shared dev/prod project the orphan persists forever and
     confuses future migrate runs. Convention: only use
     `drizzle-kit generate` + `npm run db:migrate`. If schema
     experimentation is needed, do it locally against a sandbox
     DB, not the shared project.

  2. **Drizzle journal nullity test = hash match, not end-state
     schema match.** Add-then-drop net-zero migrations leave the
     end-state schema clean but the intermediate journal rows
     are still load-bearing for drizzle's "what's next" sequence.
     Before deleting a journal row, compute SHA-256 (LF-normalized)
     of every on-disk migration file and confirm the target row's
     hash doesn't match any. Schema-state inventory is necessary
     but not sufficient.

  **Forensic artifact:** `docs/r6-2-journal-cleanup-backup.md`
  retains the SQL needed to recover the three rows that were
  briefly deleted in this incident (now restored). The three
  genuine orphans (ids 19, 20, 24) remain in the DB; their
  cleanup can be tackled separately once R6.2 lands, this time
  with hash-match verification.

- [Production input one-time-vs-recurring distinction — surface prominence audit — Slice 11 design question]

  **Slice:** Slice 11 design conversation. No immediate code action.
  Bank for the Slice 11 design-conversation phase to surface to CD
  when Slice 11 fires; v1.1 polish for the smart-defaults / lint /
  templates work.

  **Architectural context:** `production_inputs.is_one_time` flag
  drives whether a row surfaces in customer-facing Additional
  charges (as a one-time service fee) or rolls into per-unit tier
  prices (as recurring production cost). Same architectural pattern
  as `freight_inputs.freight_treatment` (`bundled` vs `pass_through`)
  — flag determines customer-facing visibility + accounting register
  for the same underlying cost row.

  Currently PM-set, no defaults derived from cost category, no
  validation against row name patterns. Slice 11 wires the binding
  cleanly (production_inputs.is_one_time = true → service fee row in
  Quote PDF) but the binding correctness depends on PMs reliably
  setting the flag right.

  **CD design question for Slice 11:** does the Cost build's
  Production section row UI give the one-time-vs-recurring
  distinction enough visual prominence? If it's a buried checkbox
  in a drilldown, the binding is silently easy to get wrong — and
  the failure mode (recurring cost mislabeled as one-time, or
  one-time fee silently amortized into per-unit price) is
  customer-visible and PM-confusing.

  Audit-worthy because: same pattern that bit Quote PDF Additional
  charges (placeholder fixtures shipping) — flag-driven
  customer-facing distinctions need surface-level visibility, not
  drilldown-buried treatment.

  **v1.1 polish candidates** (separate from the Slice 11 design
  conversation):

  1. **Smart defaults by `cost_category`** — tooling / setup /
     R&D categories default `is_one_time = true`; labor / QC /
     packout default false. Reduces PM cognitive load on the
     most common cases.
  2. **Inline lint warnings** when row name/category pattern
     doesn't match the flag state. E.g., name contains "tooling"
     + flag is false → warning; name contains "labor" + flag is
     true → warning. Same lint shape as Cost build section
     assignment validation (banked earlier in this UX_BACKLOG).
  3. **Common one-time charge templates** — pre-configured rows
     with flag values set ("Mold tooling," "Project setup,"
     "Formulation R&D") that PMs add by template instead of
     hand-building each row.

  **Sequencing dependency on Quote PDF Additional charges block
  real-data binding entry (above):** the customer-facing impact
  of the is_one_time flag only becomes visible once Slice 11 wires
  the binding. Until then, PMs can't see the flag's effect on the
  customer PDF; lint + defaults + templates work is less urgent.
  Once Slice 11 ships, mis-flagged rows become an immediate
  customer-quality risk.

  **Cross-references:**
  - Quote PDF Additional charges block — real-data binding
    (Slice 11 owner; this entry's parent)
  - Cost build section assignment validation (banked v1 blocker
    in the leaf-detach micro-slice scope)
  - `freight_inputs.freight_treatment` parallel pattern — same
    audit applies to whether the bundled/pass_through choice has
    enough visual prominence on the Freight section UI.

  **Banked from Edward observation 2026-05-13.** No immediate
  action; Slice 11 owns the conversation when it fires.

- [Costs pulse-dot sync indicator — wire real HubSpot refresh source — Slice 11]

  **Slice:** Slice 11 (HubSpot data binding cluster). Currently a
  Pattern 21 dev-scaffolding visible-pending stub.

  **Current state (post-rest-of-app-sweep Step 10):** CostsHeader
  renders the pulse-dot affordance with `.meta.pending` modifier:
  dimmed dot (no good-soft glow), copy reads "Sync status pending
  · Slice 11", visual register signals not-yet-wired. Component
  header documents the Pattern 21 framing.

  **What Slice 11 owns:**

  1. Wire actual `lastHubspotRefreshAt` source. Candidates:
     `project.lastHubspotRefreshAt` (project-level, set when
     project metadata last synced), `quote_skus.lastHubspotRefreshAt`
     (per-SKU, set by the per-SKU refresh action), or a quote-level
     rollup that aggregates across the quote's SKUs.
  2. **Resolve the live-sync-vs-manual-pull semantic question.**
     Currently HubSpot data is manually refreshed via per-SKU
     refresh actions; "live" implies push-based sync we don't
     have. Two semantic possibilities:
     - **Pulse-dot stays pulsing** if we add a polling layer (e.g.,
       background refresh every N minutes); copy reads "synced
       N minutes ago" relative-time format.
     - **Pulse-dot goes static** if we stay manual-pull; copy
       reads "last refreshed N hours ago" with explicit PM-pull
       semantic.
  3. Remove the `.meta.pending` modifier once wired; the real
     timestamp's presence/absence drives the visual state.

  **Banked from rest-of-app fidelity sweep Step 10 audit MEDIUM-1
  + Edward disposition 2026-05-14.**

- [Pricing surface — cost-stack as mini-stack reference — v1.1 polish]

  **Slice:** v1.1 polish slice. Not on release-critical path.

  **Current state:** `pricing/page.tsx` Room 1 mounts the full R6
  `CostStackHeader` component (reused from Costs surface). This is
  a documented Pattern 39 nexus extension (header comment in
  `pricing/page.tsx` carries full rationale per rest-of-app sweep
  Step 10 audit MEDIUM-4 disposition).

  **Future v1.1 work:** replace the full CostStackHeader on Pricing
  with a **read-only mini-stack reference** + explicit caption
  ("cost construction on Costs · this is read-only"). Cleaner
  divergence than full component duplication; preserves at-a-glance
  cost-vs-margin affordance with less surface area + complexity.

  **Rationale for deferral:** sweep should land fidelity-and-
  cleanup work, not redesign decisions. Mini-stack is the better
  long-term answer but warrants its own design + smoke cycle —
  needs CD design pass on mini-stack proportions, visual register,
  and which cost-stack data points compress into the mini-view.

  **Cross-references:**
  - `pricing/page.tsx` header comment Pattern 39 rationale (read
    first when starting this slice)
  - CLAUDE.md Pattern 39 ("Nexus-side extension precedent") —
    promotion path
  - R2 designer notes lines 122-127 (cost-stack belongs at the
    bottom of Cost Build per R2 canon — relevant if v1.1 design
    pass revisits placement entirely vs mini-stack on Pricing)

  **Banked from rest-of-app fidelity sweep Step 10 audit MEDIUM-4
  + Edward disposition 2026-05-14.**

- [Quote PDF Additional charges block — real-data binding — Slice 11 follow-up]

  **Slice:** Slice 11 (Quote PDF render path). Was the implicit
  owner; Edward smoke 2026-05-13 promoted the Architectural concern
  to a v1 blocker. Hotfix interim landed in rest-of-app sweep
  Step 9 (this commit) strips the placeholder fixtures so production
  PDFs no longer ship fake $5,250 / $12,400 / $3,200 charges to
  customers; full real-data binding remains Slice 11's deliverable.

  **What hotfix shipped (rest-of-app sweep Step 9):**

  - Stripped `EMPTY_CHARGES` + `PASS_THROUGH_CHARGES` fixtures and
    the `chargesForSubState` / `skusForSubState` mutator functions
    from `quote-host.tsx`.
  - `view.serviceFees` + `view.freightLines` + `view.skus` now flow
    verbatim through to PdfChargesBlock + PdfPricingTable. Real
    bundle data, no fixture substitution.
  - `deriveDefaultSubState(view)` picks the conceptual register
    (pure / passThrough / partial) from real data shape. Dev
    switcher can still override for prototype preview; production
    PMs never see it.
  - `isTwoPage` gated on `hasAdditionalCharges = serviceFees.length
    > 0 || freightLines.length > 0`. Dev toggle to "passThrough"
    on a zero-charges quote no-ops rather than rendering an empty
    second page.
  - `introCopy` generalized — removed hardcoded fixture-SKU
    references (Glow Capsule / CAP-60) and hardcoded tier labels
    (Tier 2 / 25,000 units). `single_tier` layout now derives the
    tier label from `view.tiers[recommendedTierIdx]`.

  **What Slice 11 still owns:**

  1. `production_inputs.is_one_time = true` rows → service-fee
     line items (project setup, tooling, R&D). Group by
     `production_inputs.scope` (project vs sku) for the qtyLabel
     copy ("1 (per project)" vs "1 (SKU-LABEL only)").
  2. `freight_inputs.freight_treatment = pass_through` lines →
     freight charge rows with per-tier amounts. Compute
     `tierAmounts[i]` from the line's lane × tier-qty + duty/tariff
     when separable (vs bundled into per-unit price).
  3. Customer/contact/role/address data — currently stubbed to
     project.clientName; Slice 11 imports HubSpot contact data.
  4. Pack format on quote_skus — currently "{pack-format-pending}";
     Slice 11 schema add.
  5. Recommended tier flag from real data (currently middle-tier
     stub per page.tsx:200).

  **Pattern 45 candidate — "customer-facing render data-source
  verification":** Every customer-facing render block must trace
  to a real bundle data source. Placeholder fixtures shipping to
  production is a fidelity-sweep finding, not designer chrome.
  Promote to standing pattern if a SECOND similar instance
  surfaces in the rest-of-app sweep. CC discipline going forward
  on any PDF / public-facing render: grep for hardcoded numbers,
  hardcoded names, hardcoded labels in component bodies — those
  should all derive from props.

  **Pass-through Fix A dependency (banked earlier):** the
  pass-through bundling/extraction logic fix had presumed real
  freight data. With the placeholder fixtures stripped + real
  binding deferred to Slice 11, the Pass-through Fix A
  application also sequences AFTER Slice 11's data binding —
  fix needs real data to verify end-to-end.

  **Banked from Edward smoke 2026-05-13.**

- [Pricing surface — token-discipline migration of hardcoded gray-*/slate-* utilities — v1.1 cleanup]

  **Slice:** v1.1 cleanup slice. Not on release-critical path.

  **Scope updated 2026-05-14 per rest-of-app sweep Step 10 audit:**
  Original entry banked 29 refs; designer audit re-counted **41
  refs across 4 Pricing component files** (the original audit
  undercounted; HIGH-1 expanded the scope).

  **What:** 4 Pricing component files carry 41 hardcoded `bg-white`
  / `bg-gray-*` / `text-gray-*` / `border-gray-*` / `bg-blue-*` /
  `bg-amber-*` / `text-slate-*` Tailwind utility refs. Other
  surfaces touched by the rest-of-app fidelity sweep (Mark Accepted,
  Quote, Costs) are already clean of these refs.

  **Per-file breakdown + priority:**

  1. **`reverse-solve-dialog.tsx` — 24 refs (HIGHEST PRIORITY).**
     Step 10 audit HIGH-1. Primary surface for one of Slice 9.4b's
     three signature affordances (suggested-tier-adj reverse-solve).
     PMs see this modal every time they apply a suggested tier
     adjustment. Migrate to canonical R2 register: `.r2-chip
     warn`/`bad`, `.r2-btn primary`, `.warn-band`, `.warn-band.bad`,
     `.modal-head` / `.modal-body` / `.modal-foot`, `var(--rule)` /
     `var(--paper-2)` for frame. Origin-row highlight maps to
     `var(--accent-soft)`. **Sweep Step 10 hotfix landed the
     namespace-wrap structural fix** (portal root carries
     `r2-pricing` className) so canonical primitives resolve; this
     entry covers the cosmetic register migration. Estimated lift:
     ~150 LOC.
  2. **`client-target-cell.tsx` — 9 refs.** Per-cell client target
     affordance + reverse-solve "→ apply suggested adj" chip +
     error-state pill. Migrate to canonical `.r2-chip` register;
     Pattern 29 read↔edit affordance status documented in component
     header per the brief §3.2 ACCEPTED NEXUS EXTENSION
     disposition.
  3. **`active-tier-selector.tsx` — 6 refs.** Tab pattern (≤4 tiers)
     + dropdown (≥5 tiers). Both mounted on Pricing AND Cost-stack
     pages (confirmed live, not dead code). Migrate to
     `.r2-chip`/`.r2-btn.sm` primitive register; dropdown to
     canonical `.r2-form` or equivalent.
  4. **`competitive-indicator.tsx` — 2 refs.** Comment-only at this
     point (refs to past `bg-white` removal). Spot-check during
     migration.

  **Why not v1:** the globals.css central override layer (shipped
  Slice RI.8 step 8 dark-mode sweep) maps `bg-white` → `var(--paper)`,
  `text-gray-700` → `var(--ink-2)`, etc. via `!important` rules so
  ALL hardcoded utilities swap correctly in dark mode at runtime.
  Pricing renders correctly in both themes today. The cleanup is
  cosmetic code-hygiene (replace `bg-white` with `bg-paper` etc.
  for cleaner provenance + ability to eventually drop the central
  override hack).

  **Risk axis when revisited:** `text-gray-700` and `text-gray-600`
  both map to ink-2/ink-3 depending on context — manual review of
  each instance needed to pick the right token. Don't do this as a
  pure search-and-replace.

  **Mapping reference** (from `src/app/globals.css` central override):
  - `bg-white` → `bg-paper`
  - `bg-gray-50` / `bg-slate-50` → `bg-paper-2`
  - `bg-gray-100` / `bg-slate-100` → `bg-paper-3`
  - `border-gray-200` / `border-gray-300` / `border-slate-200` /
    `border-slate-300` → `border-rule`
  - `text-gray-900` / `text-slate-900` → `text-ink`
  - `text-gray-700` / `text-gray-800` / `text-slate-700` /
    `text-slate-800` → `text-ink-2`
  - `text-gray-500` / `text-gray-600` / `text-slate-500` /
    `text-slate-600` → `text-ink-3`
  - `text-gray-400` / `text-slate-400` → `text-ink-4`
  - `text-blue-*` → `text-accent-ink`
  - `border-blue-*` → `border-accent`

  **Estimated work:** 1-2 hours; per-file context-aware
  search/replace + visual smoke pass on each touched file.

  **Banked from rest-of-app fidelity sweep Step 8 audit, May 2026.**

- [Pricing surface — blended margin reframe — v1.1 product thinking]

  **Slice:** v1.1 product-thinking slice. Not on release-critical
  path. Trigger when bandwidth allows.

  **Current state:** Pricing surface's headline reads `BLENDED
  MARGIN · ALL SKUS · ALL TIERS` (e.g., 40.5%) — portfolio average
  across all SKUs × all tiers. PM-confirmed reality is that
  customers realize per-tier margin at acceptance time (~95% of
  cases pick a single tier). Blended is decorative as a per-deal
  decision tool but useful as a quote-construction sanity check.

  **Why not v1:** functional and not actively misleading
  day-to-day (PMs understand the model). Pricing's structural job
  in v1 — single source of truth for adjustments + verdict — is
  working. Reframe is product-thinking refinement, not bug.

  **Three reframe options when revisited:**

  1. **Demote blended to secondary; promote recommended-tier
     margin to primary headline.** Uses ★ Recommended from Setup
     (which already exists). Headline becomes "Margin at
     recommended tier: X%" with blended kept as a secondary chip
     for portfolio context. Closest to PM workflow today.
  2. **Keep blended primary but reframe verdict copy** to
     acknowledge uncertainty: "Range: X% — Y% · realized depends
     on accepted tier." Lowest-touch change; preserves headline
     real estate.
  3. **Side-by-side equal weighting** of blended + recommended-
     tier margins. Two-column verdict band. Highest design lift;
     forces PM to read two numbers instead of one.

  **Decision criteria when prioritized:** observe which margin PMs
  actually quote during customer conversations (recommended-tier
  is the hypothesis); calibrate the headline to match the spoken
  number. If multiple PMs default differently, option 3 (side-
  by-side) handles the ambiguity at the cost of cognitive load.

  **Cross-references:**
  - Setup ★ Recommended tier flag (Slice §6.b Step 5
    `quote_tiers.recommended` BOOL) — already wired; reframe
    option 1 reads it directly.
  - Margin verdict pill primitive (Slice 9.2 GOOD / BELOW_TARGET
    / BELOW_FLOOR) — semantic register stays; only the source
    margin changes.
  - Slice 9.4b CompetitiveIndicator pattern — verdict surfacing
    convention (interpretation inline, raw values in tooltip)
    applies if reframe changes either layer.

  **Banked from Edward product-thinking observation, May 2026.**

- [Setup page-head button removal — v1 blocker]

  **Slice (DISPOSITIONED, 2026-05-13 — Edward at slice time):**
  Fold into rest-of-app fidelity sweep slice (currently in progress)
  as a small copy/removal commit. Promotes §6.b Designer audit
  Finding 01 from MEDIUM banked to v1 blocker.

  **What:** Two duplicative / non-functional buttons in the Setup
  page header (`src/app/projects/[id]/quotes/[quoteId]/page.tsx`
  lines 145-162) should be removed entirely:

  1. **`+ Add SKU`** — duplicative of the working `+ Add Product`
     button in SKU table footer. Single canonical affordance for
     product addition belongs near the table.
  2. **`Save draft`** — disabled (`cursor: not-allowed` on hover);
     appears to be an autosave placeholder. Non-functional button
     implies functionality that doesn't exist.

  **Pre-removal verification (Pattern 28 fidelity-discipline):**
  smoke-confirm Setup autosaves on field blur. **Verified
  2026-05-13:** `sku-row.tsx` has 6 `onBlur` / `fireSave` /
  `useActionState` references; Slice 5 form-state pattern
  (CLAUDE.md `Form state pattern` + `Save handler pattern`) is
  the canonical autosave wiring across Setup. Save-draft button's
  own `title="Saved automatically as you edit."` confirms intent.

  **Implementation:** copy/removal commit only. Drops the `.actions`
  block contents in `.r7b-head` (cluster goes empty — keep the
  `<div className="actions">` empty for now so CD canonical
  structure is preserved). No schema or component restructure.

  **Source reference:** §6.b Designer audit Finding 01 (was MEDIUM
  banked; promoted to v1 blocker per Edward smoke).

  **Banked from Edward smoke, May 2026.**

- [Add Product button copy rename — small]

  **Slice (DISPOSITIONED, 2026-05-13 — Edward + CA at slice time):**
  Fold into rest-of-app fidelity sweep slice (currently in progress)
  as a small copy commit, OR carry into the queued leaf-detach
  micro-slice. Either fits.

  **What:** Setup surface SKU footer button copy change:
  `+ ADD PRODUCT` → `+ CREATE NEW PRODUCT`.

  **Rationale:** clarifies action shape — distinguishes from
  `↗ PULL FROM HUBSPOT` (which also "adds a product" in user-
  mental-model terms but is a different operation: attach
  existing vs create new). "Create new" makes the create-vs-
  attach distinction explicit at the affordance level.

  **Affected:** SKU footer trigger button in
  `src/app/projects/[id]/quotes/[quoteId]/sku-footer.tsx`
  (and the matching default `triggerLabel` value in
  `AddProductModal` if PMs see it before clicking).

  **Implementation:** copy-only change; no schema, no component
  restructure, no canonical-CSS impact. 2-line diff (button
  text + modal-trigger default label).

  **Cross-references:** Designer audit Finding 01 already
  flagged the page-head `+ Add SKU` button as duplicative of
  the footer affordance — this rename is unrelated but
  complementary; clarifies the footer affordance's intent
  while §6.b separately decides the page-head deduplication
  story.

  **Banked from Edward UX observation, May 2026.**

- [AddProductModal LEAF create — HubSpot write confirmation in toast — v1.1 polish]

  **Slice:** v1.1 polish (post-PR #50 merge).

  **What:** When LEAF mode createLeaf completes via the
  HubSpot-first path (Step 4 refactor in slice-hubspot-
  bidirectional), the post-submit toast says
  `Added "{name}" to the library · specs deferred.` — which
  reads as a Nexus-side confirmation only. PM has no signal
  that the write to HubSpot also succeeded, even though the
  HubSpot-first invariant guarantees it did (no local row
  exists unless `createProduct` returned a HubSpot id).

  **Surface gap:** PMs accustomed to the prior Slice 2-era
  "import from HubSpot" pattern expect a visible HubSpot-side
  confirmation. The current toast implicitly hides the success
  signal even though it's the more important half of the round-
  trip (Nexus DB write is uninteresting; HubSpot write is the
  cross-system commitment).

  **Proposed shapes (pick at slice time):**

  1. **Minimal copy change** — extend the toast: `Added "{name}"
     to the library · HubSpot product id {hubspotProductId}
     · specs deferred.` Adds the HubSpot id inline so PMs know
     the cross-system write landed. Pros: 1-line code change;
     useful for debugging. Cons: id string is ugly visual
     weight in a success toast.
  2. **Affirmative copy + chip** — toast says `Added "{name}"
     to the library · ⤓ HS synced` (chip register matches the
     Step 7 library browse `⤓ HS` chip). Cleaner visual; PM
     reads "synced" as the HubSpot confirmation. HubSpot id
     surfaces in the chip's title tooltip for forensics.
  3. **Open-in-HubSpot link** — toast carries a `View in
     HubSpot →` link to
     `https://app.hubspot.com/products/{hubId}/library/{productId}`.
     Strongest confirmation (PM can click and verify on the
     HubSpot side). Pros: full round-trip closure. Cons: dev
     vs prod URL switching needs the dev/prod-aware hub id
     (env-driven); link is broken in dev if PM isn't logged
     into the sandbox.

  **CC lean (subject to disposition):** option (2) — affirmative
  copy + ⤓ HS chip in toast — best matches the slice's existing
  vocabulary (library browse chip) and reads at-a-glance.

  **Affected files:**
  - `src/components/add-product/add-product-modal.tsx:170-172`
    (toast copy)
  - May also extend the toast component to render a chip register
    if option (2) is chosen.

  **Out of scope for slice-hubspot-bidirectional (PR #50):**
  toast copy fix is post-merge polish; doesn't block CB sign-off.
  Banked here so future-CC slots it into v1.1 polish sweep.

  **Update (2026-06-15, PR #50 CB smoke patch round):** the
  separate issue of the toast being *invisible* (CSS positioning
  gap inside `.a1v2-card { overflow: hidden }` + JSX missing
  canonical glyph + body structure) was fixed in the same patch
  round that banked this entry. Toast now renders fixed bottom-
  right and is visually confirmed. Remaining gap is the
  HubSpot-specific signal in the copy itself — the polish
  options above still apply unchanged.

  **Cross-references:**
  - Slice-hubspot-bidirectional Step 4 createLeaf refactor
    (HubSpot-first pattern restoration)
  - Step 7 library browse `⤓ HS` chip (visual vocabulary
    precedent)
  - Pattern 32 (Pre-production engineering tolerance) — gap
    is real but cosmetic; dev smoke can verify via API + DB
    instead of UI confirmation.

  **Banked from Edward observation during PR #50 CB smoke walk
  HBS-1, 2026-06-15.**

- [Mobile / iPad responsive support — v2]

  **Slice:** Dedicated v2 work. Prerequisite: full design round
  (R9 or equivalent) per Pattern 41 — multi-surface architectural
  features warrant a dedicated R-round design pass before
  implementation. Implementation slice follows R9.

  **What:** Today the app is desktop-only (per CLAUDE.md role-as-
  affordance + grid layouts assuming 1380px max-width on Costs,
  640px modal width on Add-product, etc.). Mobile / iPad
  workflows surface in customer-facing review contexts: PMs
  showing quotes on iPads in client meetings, sales-rep
  on-the-go status checks, etc.

  **Surfaces affected (every quote-scoped surface + admin):**
    - Setup (R7b) — SKU table grid, tier rail, Notes split
    - Costs (R6) — cost stack grid, section drilldowns, drawer
      toolbar grids
    - Pricing (R2) — verdict band two-column, per-tier table
    - Quote (R3) — PDF preview (already paged + responsive-ish),
      preview chrome
    - Mark Accepted (R3) — verdict band, tier card grid, CTA
      cluster
    - Home (R4) — outer + inner rail (240px collapsible),
      organizer grid, project detail
    - Future R6.2 freight panel — multi-leg shipping editor
    - Admin (R5) — firm settings, markup defaults, audit log

  **R9 design round dispositions needed:**
    - Touch-vs-pointer affordance differences (hover-reveal
      patterns like the §6.b ⋯ overflow menu need touch-
      friendly alternatives)
    - Breakpoint strategy (one mobile breakpoint vs tablet +
      phone vs adaptive component-level)
    - Inner rail behavior on narrow viewports (collapsible
      already shipped per UX_BACKLOG; reuse for mobile?)
    - Modal sizing on narrow viewports (Add-product modal is
      640px; needs to adapt below 768px)
    - Cost stack rendering on narrow viewports (5-tier grid
      doesn't fit; horizontal scroll vs stacked rendering?)
    - Type badge / click targets (44px minimum tap target
      recommendation; current sizes are pointer-optimized)

  **v1 component primitives that likely need mobile-aware
  variants** (surface during R9 design pass, NOT as v2
  implementation findings):
    - `.calc-display` (cross-surface calculated-value row)
    - `.warn-band` (inline warning band; touch CTA sizes)
    - `.r7b-empty-state` (empty list register)
    - `.r2-pricing` namespace (Pricing surface body)
    - `.r3-shared` namespace (Quote + Mark Accepted body)
    - `.r4-home` namespace (Home; future)
    - `.r7b-head` (page chrome — eyebrow + h1 + action cluster)
    - `.r7b-sku-row` (SKU row grid)
    - `.r7b-tier-row` (Tier row grid)
    - `.r6-stack` (cost stack grid)

  **Pattern 30 implementation discipline:** R9 design ships
  responsive canonical CSS per surface; CC implements via
  Pattern 30 path-B verbatim adoption (or namespace-scoped
  variant if R9 uses unprefixed mobile selectors). Touch
  affordances likely come as new canonical classes
  (.r7b-sku-row.mobile-stack etc.) — CC adopts under same
  Pattern 30 verbatim discipline.

  **No code action.** Banked as v2 reference for the
  eventual R9 design round + implementation slice.

  **Banked from Edward UX observation post-§6.b, May 2026.**

- [Leaf detach from parent assembly — v1 blocker]

  **Slice (DISPOSITIONED, 2026-05-13):** Micro-slice queued
  BETWEEN rest-of-app fidelity sweep PR and R6.2 freight
  implementation. **NOT folded into sweep** — avoiding mid-flight
  scope creep. Sweep ships clean; this lands immediately after.

  **Problem:** Currently no UI path to disconnect a leaf from
  its parent assembly once assigned. Workaround is to delete the
  leaf and recreate — destructive, loses per-SKU notes, retail
  bench data, drawer state, sort_order.

  **Two affordance entry points** (both implemented):

  1. **Parent's drawer child-SKU list** — per-row "✕ Detach" or
     "Remove from assembly" action button in the action column
     next to the existing "↗ Costs" link. Click → confirmation
     (if leaf has notes / retail data) → detach.
  2. **Leaf row's ⋯ overflow menu** — conditional "Detach from
     {parent name}" item that renders only when the leaf has a
     parent_sku_id set. Click → confirmation → detach.

  **Implementation:**

  - **Action:** new server action `detachLeafFromParent(skuId)`.
    Writes `parent_sku_id = NULL` + `qty_per_parent = NULL` on
    the leaf. **Pattern 22 — verify exact column name in schema
    BEFORE encoding** (confirm against `src/db/schema.ts`
    `quote_skus.parentSkuId` + `quote_skus.qtyPerParent` current
    shape per Slice 5.5 assembly rules).
  - **Audit:** action key `sku_detached_from_parent` with
    diff_json carrying `{ before: { parent_sku_id, qty_per_parent
    }, after: { parent_sku_id: null, qty_per_parent: null } }`
    + the parent's sku_label snapshot for human-readable
    forensics ("detached from PARENT-CODE").
  - **Confirmation modal:** if leaf has any non-empty per-SKU
    notes OR retail benchmark value, surface a confirmation
    modal warning "Detaching preserves this leaf's notes +
    retail benchmark, but it'll no longer roll up under
    {parent}. Cost / pricing impacts:..." with Cancel + Confirm
    CTAs. If leaf is empty (no notes, no retail), skip the
    modal and detach immediately.
  - **Tree validation:** `validateAssemblyOperation` from
    `src/lib/sku-tree.ts` already handles parent unset (writes
    parent_sku_id = NULL); reuse the validator path.
  - **Leaf row visual updates on detach:** tree-line connector
    (`└─` prefix in the .label-pack) is removed; the
    QtyPerParentInline widget (renders inline `× N per parent`
    on assigned leaves) is removed. The row becomes standalone
    register — same visual shape as any never-assigned leaf.
    Visual transition driven by `sku.parentSkuId === null`
    branching already in place in `sku-row.tsx` (treeLine +
    QtyPerParentInline are conditional on parentSkuId); revalidation
    after detach flips the props.

  **Cross-references:**
  - Slice 5.5 assembly rules (CLAUDE.md "Assembly rules"
    section) — Detach already documented as the "assembly →
    leaf" transition path; this entry is the UI for that.
  - Pattern 22 schema verification before ANY column writes
  - Pattern 39 nexus-extension precedent — if the canonical
    R7b drawer doesn't render a Detach affordance, the addition
    is a documented extension (most likely; canonical drawer
    didn't anticipate the carved child-list shape we ship)

  **Risk if not shipped:** PMs accumulate dead leaves under
  assemblies they no longer want as children. Delete + recreate
  loses cost-bench data (retail benchmark) + drawer state
  (per-SKU notes) silently. Has come up in §6.b smoke + Edward
  PM-workflow observation.

  **Release-critical-path placement:** between rest-of-app
  fidelity sweep PR and R6.2 freight implementation. Must land
  before v1 release. Carry forward into any CA session handoff
  doc as a release-critical entry.

  **Banked from Edward UX observation, May 2026.**

- [ASY → LEAF conversion warning on assemblies with children — v1 blocker]

  **Slice (DISPOSITIONED, 2026-05-13):** Extension to the queued
  leaf-detach micro-slice. Same slice; shares confirmation-modal
  + detach-action layer infrastructure. Net additional scope:
  one warning modal + cascade-detach logic. Probably half-day
  on top of the leaf-detach work.

  **Problem:** Type badge click on an assembly with children
  currently no-ops (silently rejected by `eligibleRoleTargets`
  via `validateAssemblyOperation` since "assembly → leaf"
  is refused when children exist per Slice 5.5 assembly rules
  + CLAUDE.md "Assembly rules" section). PM clicks the badge,
  nothing happens, no signal — confusing.

  **Three improvements (all in scope):**

  1. **Warning modal when ASY has ≥1 child.** Click on Type
     badge surfaces a confirmation modal:
       Title: "Convert to leaf?"
       Body: "{N} children will be detached as standalone
       leaves. Their data (notes, retail bench, sort_order) is
       preserved. They'll appear as top-level SKUs in this
       quote."
       CTAs: Cancel · "Convert + detach {N} children"
  2. **Cascade-to-detach on confirm.** Children's
     `parent_sku_id` writes to NULL + `qty_per_parent` writes
     to NULL. Their data (notes, retail, sort_order) preserved.
     Tree-line connector + QtyPerParentInline visual updates
     fire per the leaf-detach entry's visual-update spec.
  3. **Silent toggle when ASY has 0 children.** No modal; just
     the type change fires immediately. Existing flow shape
     (Type badge click → action fires) preserved for the
     empty-assembly case.

  **Separate concern (NOT in this micro-slice):** "ASY is a
  child of another ASY" — converting this ASY to LEAF does
  NOT affect its OWN parent relationship. The parent_sku_id
  + qty_per_parent on THIS sku stay intact; only the role
  enum flips and the children get detached. To detach this
  ASY from its own parent, PM uses the separate ⋯ → Detach
  from parent action (the original leaf-detach micro-slice
  scope above).

  **Implementation:**

  - **Action:** new server action `convertAssemblyToLeaf
    (assemblySkuId)`. Inside a DB transaction:
      a. Load all child SKUs of the assembly
      b. For each child: write `parent_sku_id = NULL` +
         `qty_per_parent = NULL`; audit
         `sku_detached_from_parent` per child with
         diff_json carrying the parent reference + cascade
         context flag
      c. Update the assembly's `sku_role` to 'leaf'; audit
         `sku_type_changed_asy_to_leaf` with diff_json
         carrying `{ cascaded_children: N, child_ids: [...] }`
    Single transaction so partial-failure doesn't leave a tree
    half-detached.
  - **Pattern 22 verification:** confirm column names against
    `src/db/schema.ts` `quote_skus.skuRole` enum +
    `quote_skus.parentSkuId` + `quote_skus.qtyPerParent` —
    shared check with the leaf-detach micro-slice.
  - **Audit:** TWO action keys fire per ASY→LEAF conversion
    with cascade:
      `sku_detached_from_parent` × N (one per child detached)
      `sku_type_changed_asy_to_leaf` × 1 (the assembly itself)
    Separate keys per child detach so the audit-log timeline
    reads clearly when reviewing "what got detached when."
  - **Confirmation modal:** shared `.warn-band` primitive
    (extracted in sweep Step 1) PLUS the canonical .r7b-modal
    chrome (Add-product modal precedent). Cancel + Confirm CTAs
    use .btn ghost sm + .btn primary sm primitives.
  - **Empty-assembly case (silent toggle):** existing
    `setSkuRole(skuId, "leaf")` action handles this when
    childCount === 0; no UI changes needed for that path.
    Modal gate fires only when childCount > 0.

  **Visual updates after conversion:**

  - The converted SKU's row: type badge flips ASY → LEAF
    (canonical R7b style, same as a never-promoted leaf)
  - Each cascaded child's row: tree-line connector removed,
    QtyPerParentInline widget removed (mirrors the leaf-detach
    spec's visual-update notes)

  **Cross-references:**
  - Companion to leaf-detach micro-slice above (shared
    infrastructure)
  - CLAUDE.md "Assembly rules" section — assembly→leaf
    transition path documented; this entry is the UI for that
    plus the cascade-detach safety
  - Pattern 22 schema verification before action layer encoding
  - Pattern 39 nexus-extension precedent — confirmation modal
    is a Nexus-side addition (canonical R7b drawer doesn't
    render a conversion-warning modal; the cascade-detach
    semantics are a Slice-5.5 assembly-rule enforcement we
    surface visually)

  **Risk if not shipped:** PMs hit a silently-rejected Type
  badge click on assemblies, mistake it for broken behavior,
  workaround = delete + recreate each child as standalone (data
  loss). Same risk class as the leaf-detach blocker.

  **Release-critical-path placement:** same as leaf-detach —
  between rest-of-app fidelity sweep PR and R6.2 freight
  implementation. Must land before v1 release. Carry forward
  in CA session handoff doc as a release-critical entry under
  the leaf-detach micro-slice scope.

  **Banked from Edward UX observation, May 2026.**

- [LEAF → ASY conversion warning when cost data exists — v1 blocker]

  **Slice (DISPOSITIONED, 2026-05-13):** Extension to the queued
  leaf-detach micro-slice (sister entry to ASY→LEAF conversion
  above). Same modal + action-layer infrastructure; same
  release-critical-path placement.

  **Problem:** When PM toggles Type badge LEAF → ASY on a SKU
  that has cost inputs in Cost build's Packaging / Production /
  Bulk Raw / Freight sections, current behavior either no-ops
  silently OR flips the role and orphans the cost data. Either
  way violates the architectural invariant that **cost inputs
  are strictly inherited from leaves** — ASY rows are
  computed-only (sum of child contributions); they can't
  themselves carry packaging lines, production fees, freight
  rows, or bulk-raw assignments.

  **Confirmation modal copy:**

  > ⚠️ This SKU has cost data on the Costs surface (Packaging:
  > T&L $2.00/tier-1, ...). Converting to assembly will leave
  > that cost data orphaned. Move or remove the cost data
  > first, then re-toggle.

  Modal body enumerates the existing cost lines (section +
  line summary) so PM sees exactly what they're routing
  around.

  **Three implementation options surfaced:**

  - **(a) Block conversion until cost data is moved/removed.**
    Safer; adds friction. PM must navigate to Costs surface,
    find each cost line, delete/move via existing affordances,
    return to Setup, re-toggle. Modal shows the cost data
    inventory + "Remove these on Costs first" copy with no
    Confirm CTA (just Cancel + "Open Costs to fix").
  - **(b) Confirm and detach cost data.** Faster; destructive
    — cost lines become orphaned OR get deleted on confirm.
    Modal carries the warning + a "Delete cost data + convert"
    destructive CTA.
  - **(c) Confirm and migrate cost data to a new auto-created
    child leaf.** Smartest; complex. Modal carries "Convert
    + move cost data into new child SKU 'name + " — child'"
    CTA; on confirm, server creates a leaf child, re-points
    each cost line's quote_sku_id to the new child, sets the
    converted SKU's role to assembly. Preserves PM intent
    + data.

  **Disposition (Edward, 2026-05-13):** **(c) APPROVED — smart-
  migrate to auto-created child leaf.** Smartest path; preserves
  PM intent + data. Implementation complexity is contained by
  reusing the leaf-detach action infrastructure + a new
  auto-create-child action.

  **Auto-naming convention:** new child leaf gets sku_label
  `{ORIGINAL-SKU}-CMP` (suffix signals "auto-generated, rename
  me"; PM can rename via the SKU table's inline-edit affordance
  any time post-creation).

  **Cost line distribution:** single auto-created child holds
  ALL cost lines across packaging / production / freight / bulk
  raw sections. PM can split later if needed (manual move via
  Cost build's per-row SKU-target picker).

  **Child inheritance defaults:**
    - `qty_per_parent = 1` (one auto-child per parent)
    - `sort_order = max(siblings.sort_order) + 1` (placed at end
      of parent's component list)
    - `notes = NULL` (empty)
    - `retail_benchmark = NULL` (empty)
    - `parent_sku_id = original SKU's id` (relationship attached
      atomically with the parent's role flip)

  **Original SKU preservation on convert:**
    - `sku_role` flips LEAF → assembly
    - `notes` PRESERVED (still useful as finished-product
      customer reference)
    - `retail_benchmark` PRESERVED (same — finished-product
      level retail data)
    - `parent_sku_id` unchanged (this conversion doesn't affect
      the original's own parent relationship)

  **Implementation (Option c):**

  - **Action:** new server action `convertLeafToAssembly
    (skuId)`. Inside a DB transaction:
      a. Load all cost-input rows where quote_sku_id = skuId
         (packaging_inputs + production_inputs + freight_inputs)
      b. Check existing cost data; if none, fire silent toggle
         (no child creation, no modal). If yes, surface the
         pre-confirm modal with the migrate summary
      c. On PM confirm: create new child SKU row with auto-
         naming convention + child inheritance defaults +
         parent_sku_id pointing at the original
      d. Re-point each cost-input row's quote_sku_id → new
         child SKU's id
      e. Flip original SKU's sku_role to 'assembly'
    Single transaction so partial-failure can't leave a half-
    converted state.
  - **Modal copy on cost-data presence:**
      Title: "Convert to assembly?"
      Body: "This SKU has {N} cost lines across {sections}.
      They'll be moved to a new auto-created child SKU named
      '{ORIGINAL}-CMP' so the data stays connected to the
      assembly's rollup. You can rename the child after
      conversion."
      CTAs: Cancel · "Convert + migrate cost data"
  - **Pre-conversion check action:** `checkSkuCostData(skuId)`
    returns the cost-line inventory across packaging /
    production / freight inputs. Used by the modal to render
    the "{N} cost lines across {sections}" summary.
  - **Audit:** three action keys fire on a cost-data
    conversion:
      `sku_type_changed_leaf_to_asy` × 1 (original SKU)
      `sku_created_auto_for_cost_migration` × 1 (new child)
      `cost_data_reparented` × N (one per re-pointed
      cost-input row; diff_json carries old quote_sku_id +
      new quote_sku_id + section name)
    Separate keys per re-parent so the audit-log timeline
    reads clearly when reviewing the conversion forensically.
  - **Pattern 22 verification:** confirm column names against
    `src/db/schema.ts` — `packaging_inputs.quoteSkuId`,
    `production_inputs.quoteSkuId`, `freight_inputs.quoteSkuId`
    all confirmed (uuid foreign-key references to
    `quote_skus.id`); `quote_skus.skuRole` enum confirmed;
    `quote_skus.parentSkuId` + `quote_skus.qtyPerParent` +
    `quote_skus.sortOrder` confirmed.

  **Cross-references:**
  - Sister to ASY→LEAF entry above (opposite direction)
  - Architectural invariant: "cost inputs strictly inherited
    from leaves" — documented in CLAUDE.md "Assembly rules"
    section + Slice 5.5 assembly schema commitment
  - Pattern 39 nexus-extension precedent — the
    block-with-warning modal is a Nexus-side enforcement of
    the architectural invariant; canonical R7b drawer
    doesn't render this affordance because R7b didn't
    anticipate cross-surface data validation

  **Risk if not shipped:** PMs flip LEAF → ASY on a SKU with
  cost data; orphaned cost lines silently survive in
  packaging_inputs / production_inputs / freight_inputs;
  cost rollups break silently (ASY can't carry these inputs;
  the rows become invisible to compute). Same data-quality
  risk as the leaf-detach blocker.

  **Release-critical-path placement:** same as leaf-detach
  + ASY→LEAF entries — micro-slice between rest-of-app
  fidelity sweep PR and R6.2 freight implementation.

  **Banked from Edward UX observation, May 2026.**

- [Cost build section assignment validation — v1 blocker]

  **Slice (DISPOSITIONED, 2026-05-13):** Extension to the queued
  leaf-detach micro-slice. Sister to the LEAF→ASY entry above
  — same architectural invariant ("cost inputs strictly
  inherited from leaves"); different enforcement surface.
  Where LEAF→ASY guards the type-toggle path, this entry
  guards the cost-input creation path on Cost build.

  **Problem:** Cost build's section row pickers (Packaging /
  Production / Bulk Raw / Freight) currently accept ASY
  SKUs as cost-input targets. Architecturally invalid —
  cost data on ASY rows orphans on first leaf-promotion or
  cost-rollup attempt. Bug shape: action layer accepts an
  ASY target; row gets created; compute path silently
  skips it; PM thinks data is in the system but rollup is
  wrong.

  **Implementation:**

  - **UI-level filter:** pickers in each cost section
    (`src/app/projects/[id]/quotes/[quoteId]/costs/...`
    drilldown + add-line affordances) filter the SKU list
    to `sku_role === "leaf"` only. ASY SKUs don't appear in
    the picker. Display caption: "Select a leaf SKU
    (assemblies inherit cost from leaves)."
  - **Action-layer enforcement:** every cost-input create
    action (packaging-add-line, production-input-set,
    freight-add-line, bulk-raw-assignment) validates target
    SKU role at the action boundary; throws
    ActionGuardError(ERR.VALIDATION, "Cost inputs can only
    be assigned to leaf SKUs.") if target is ASY. Defense
    in depth even if the UI filter is bypassed.
  - **First-load surfacing for existing ASY-attached rows:**
    on Cost build page load, query for any cost-input rows
    where target SKU's role is ASY (one-time data audit
    below). If found, render a warning band on each affected
    row + a summary count at the top of Cost build:
      ⚠️ {N} cost lines target assembly SKUs — needs
      reassignment to a leaf. [Show me]
    Click "Show me" → highlights/scrolls to each affected
    row. PM resolves by reassigning the target SKU on the
    row (existing affordance, may need a small extension to
    support cross-SKU re-target).
  - **Pattern 22 verification:** confirm the schema column on
    each Cost build section table that references the target
    SKU (`quote_sku_id` text uuid on packaging_inputs /
    production_inputs / freight_inputs / bulk_raw_section_*).
    Filter logic enforces `target_sku.skuRole === 'leaf'` at
    both layers.

  **One-time automated cleanup pass (5-step process):**

  Edward dispositioned: automated migration over manual cleanup,
  using the LEAF→ASY smart-migrate infrastructure (Option c)
  from the sister entry above. Steps:

  - **Step 1 — Audit query (DONE, 2026-05-13):** CC ran the
    query against the shared dev/prod DB. Pattern 22 column
    verification confirmed (packaging_inputs.quote_sku_id +
    production_inputs.quote_sku_id + freight_inputs.quote_sku_id
    all uuid FK to quote_skus.id; quote_skus.sku_role enum
    'leaf' | 'assembly' per Slice 5.5). Bulk_raw_*
    tables are quote-keyed, NOT sku-keyed; out of scope for
    this audit.

    **Findings (current dev/prod DB state):**

    | Section | Rows | ASY SKUs | Quotes affected |
    |---|---|---|---|
    | packaging_inputs | 4 | 1 | 1 |
    | production_inputs | 4 | 1 | 1 |
    | freight_inputs | 4 | 1 | 1 |
    | **TOTAL** | **12** | **1** | **1** |

    Same 1 ASY SKU × 4 tier rows × 3 sections = 12 rows total.
    Pattern strongly suggests stale dev/seed data — one ASY
    SKU used as cost-input target during early testing before
    the architectural invariant was enforced.

  - **Step 2 — Dry-run output:** CC writes
    `docs/orphaned-cost-data-audit.md` listing per-SKU what
    would be migrated + auto-generated child leaf name +
    affected rows per section. Output schema mirrors the
    smart-migrate logic from the LEAF→ASY entry — one
    `{ORIGINAL-SKU}-CMP` auto-child per ASY SKU, ALL cost
    lines (across all sections) re-pointed to that child,
    original ASY's role + relationships preserved.

  - **Step 3 — Edward review:** spot-check naming + line
    distribution feel against the dry-run output. Approve OR
    request adjustments (e.g., different naming convention,
    per-section child split, manual cleanup for some rows).

  - **Step 4 — Migration run:** on Edward approval, CC runs
    the migration with one audit-log entry per affected row:
      `sku_type_changed_leaf_to_asy` × 1 per converted SKU
      `sku_created_auto_for_cost_migration` × 1 per auto-child
      `cost_data_reparented` × N per re-pointed cost row
    Wrapped in a single DB transaction per SKU so partial
    failure can't leave half-migrated state.

  - **Step 5 — Post-migration re-query:** rerun the audit
    query; confirm zero remaining orphans. Output the result
    + the count of converted SKUs to docs/orphaned-cost-data-
    audit.md as a closing log.

  Audit query stays in `scripts/q.mjs` or extracted to a
  dedicated script if Edward wants reusability — single-use
  utility otherwise.

  **Cross-references:**
  - Sister to LEAF→ASY entry above (opposite enforcement
    surface for the same invariant)
  - Pattern 22 schema verification (extended to "code
    architecture" per CLAUDE.md Pattern 22 refinement,
    2026-05-13 banking)
  - Architectural invariant per CLAUDE.md "Assembly rules"
  - Pattern 32 pre-production tolerance — dev sandbox may
    have stale ASY-attached rows that are safe to clean up
    or ignore depending on disposition

  **Risk if not shipped:** Silent data inconsistency. Cost
  inputs target ASY SKUs; compute path skips them; rollup
  silently wrong; PMs trust the displayed cost which is
  missing contributions. Same data-quality risk class as
  leaf-detach + LEAF→ASY blockers.

  **Release-critical-path placement:** same as the other
  three entries in the leaf-detach micro-slice umbrella.

  **Banked from Edward UX observation, May 2026.**

- [Child SKU flat-list visibility — post-v1 usability watch (R7c candidate)]

  **Slice:** Post-v1 observation, not v1 work. Banked as R7c
  future consideration if a third design round on Setup ships.
  No code action.

  **Observation:** Child SKUs appear in TWO places on the Setup
  SKU table today:
  1. **Top-level flat list** with tree-line connector (`└─ ` prefix
     on the label) and indentation. PM scrolls the flat list and
     sees nested children inline beneath their parent assembly.
  2. **Assembly drawer's child-SKU list** (the `.r7b-comp-table.
     child-list` register added in §6.b pre-PR fidelity check).
     PM expands an assembly's drawer and sees the same children
     in a more-structured table with the canonical grid grammar.

  The duplication is intentional today (each view answers a
  different read-mode question — flat scan vs nested drill-in),
  but may cause workflow confusion: PMs editing a child via the
  drawer expect it to update, but they might also try to edit
  via the flat-list row and get a different affordance set
  (Reassign-via-overflow-menu vs in-drawer Reassign-via-form).

  **Watch dimension:** PM workflow confusion specifically —
  "where is the child SKU really" / "which view is authoritative
  for editing." Track via PM-observed error reports + the cross-
  surface autosave refactor watch (already in backlog).

  **Possible R7c remediations** (if confusion materializes):

  - **(a) Drawer-only by default + flat-list toggle.** Children
    render only inside the assembly drawer; flat list shows
    parents only. A "show all children inline" toggle on the
    SKU table head exposes the flat tree-view on demand. PMs
    who think in flat lists toggle on; PMs who think in
    drawers stay on the default.

  - **(b) Collapse children into parent on default render +
    expansion affordance.** Flat list shows the parent assembly
    row with a `▸ N children` indicator; clicking expands the
    children inline (same component, different default state).
    Drawer still works for in-context editing. Children only
    visible when explicitly expanded.

  - **(c) Defer entirely.** If PM observation doesn't surface
    real confusion in production, the duplication is fine and
    nothing changes. Most likely outcome — the flat-list
    tree-line + drawer table serve different scan modes and PMs
    learn the distinction quickly.

  **Banked from Edward UX observation, post-§6.b smoke (May
  2026).** No code action; observation logged as a R7c future
  consideration. If/when R7c (Setup refinement) ships, this
  entry is the input to the design-round disposition.

- [Scenario name inline edit — eyebrow read↔edit]

  **Slice:** v1.1 candidate. Best decided when rest-of-app
  fidelity sweep brief drafts. Could fold into that sweep if the
  eyebrow gets touched there anyway, OR a small standalone slice.

  **What:** Edit scenario/quote variant names after creation
  in-place. Today the eyebrow renders the variant label as
  display-only (e.g., `EPICUREN · PRIMARY · V2`). PMs who want
  to rename "Primary" to "Alt" or similar have no row-level
  affordance.

  **Pattern:** Pattern 29 R6 read↔edit (same vocabulary already
  in use across Setup retail bench, tier qty, tier label,
  units_per_pack chip). Click the scenario-name segment of the
  eyebrow → switches to input → blur/Enter commits → returns to
  formatted read mode.

  **Surface:** Eyebrow line on each quote-scoped surface (Setup,
  Costs, Pricing, Quote, Mark-Accepted). Single primitive
  reused across all five.

  **Schema (Pattern 22 verify at slice time):** likely
  `quotes.scenario_label` (already on the table per RI.7 work).
  Audit action via existing audit-log mechanism; new
  `scenario_label_updated` action key.

  **Open questions for slice-time disposition (not blocking
  backlog logging):**
  1. **Just the variant name, or also version handling?**
     `PRIMARY · V2` has both a variant name and a version number.
     Version is presumably system-managed (auto-increments on
     quote modifications). Edit-in-place likely scoped to
     variant name only; version stays system-managed. Confirm at
     slice time.
  2. **Uniqueness scope?** Variant names probably need to be
     unique per project (can't have two "Primary" quotes on the
     same project). Validation surfaces on blur — same shape as
     the SKU dup-check warn band (Designer audit Finding 18
     cross-surface primitive opportunity; if `.warn-band`
     extraction lands first, this consumes it).

  **Cross-references:**
  - Pattern 29 (R6 read↔edit cell)
  - Designer audit Finding 18 (`.warn-band` cross-surface
    primitive — uniqueness validation candidate)
  - Pattern 22 (schema verification before encoding)

- [Multi-route shipping support — v1 or v1.1, pending Edward's call]

  **Slice:** Pending R8 design round + dispositions before any
  implementation slice opens. NOT scoped into v1 release path
  until R8 completes.

  **Reference workflow:** Korea production → China packaging →
  US final delivery. Three destinations, two transit legs.

  **Specifications:**
  - Max 3 destinations (2 transit legs)
  - Currently single-destination model across the stack
  - Requires UI state for single-route vs multi-route

  **Surfaces affected:**
  - Cost build freight section — multi-leg cost rollup, lead time
    composition, per-leg supplier/mode
  - Customer view / Quote PDF — shipping terms presentation,
    which destinations are customer-facing vs internal
  - Setup (possibly) — route declaration as a quote-level config
    vs per-SKU
  - Mark-Accepted NetSuite SO ship-to defaulting — final-
    destination selection logic when SO is generated

  **R8 dispositions needed before implementation:**
  - IA placement — does multi-route live on Setup (declarative)
    or Cost build (operational)?
  - Single-route vs multi-route UI state — collapsed by default
    with expand-to-multi toggle? Or always-visible legs with
    "add leg" affordance? Inline editing register?
  - Customer-PDF presentation — show all legs or just final
    destination? Lead time aggregation copy?
  - NetSuite SO final-destination defaulting — which destination
    flows to ship-to on SO creation; PM override path?

  **Sequencing:**
  1. R8 design round (CD)
  2. R8 dispositions (Edward + CA)
  3. Implementation slice (CC) — multi-surface; estimate after
     R8 lands
  4. Mark-Accepted external writebacks slice consumes
     the destination model for NetSuite ship-to defaulting

  **Banked:** Edward's directive during §6.b Phase 1 era (May
  2026). Pattern 34 (candidate) applies — multi-surface feature
  warrants dedicated R-round before piecemeal implementation.

- [Drag-and-drop nesting — leaf into assembly]

  **Slice:** Setup-affordance polish (small standalone or fold
  into post-§6.b rest-of-app fidelity sweep). Estimated ~50 LOC
  in `sku-row-list.tsx` + small visual prop on `sku-row.tsx`.

  **What:** Today, attaching an existing leaf SKU to an assembly
  requires the leaf's `⋯` overflow menu → "Reassign to parent" →
  inline parent picker + qty input. The §6.b Step 9 drag-and-drop
  reorder mechanism makes the inline reorder feel natural but
  leaves the reassign flow as a clunky modal-like sub-form.

  **Future state:** extend drag-and-drop with 3-zone hit detection
  on each row — top 33% = insert-above (current reorder), bottom
  33% = insert-below (current reorder), middle 33% = **nest into**
  (only when the hovered row is an assembly AND the dragged row
  is a leaf). Drop on the middle zone calls `assignSkuToParent`
  with `qty_per_parent` defaulting to 1; PM edits via the existing
  inline `QtyPerParentInline` cell after the drop. Assembly row
  highlights with an accent border while a leaf hovers in its
  middle zone so PMs discover the affordance.

  **Tradeoff:** un-nesting (assembly child → top level) stays in
  the overflow `⋯` menu as "Detach" — drag-and-drop is naturally
  one-directional. Detach isn't a frequent op so the asymmetry
  is acceptable.

  **Server-side:** `assignSkuToParent` action already exists and
  handles cycle detection + parent eligibility validation. No
  schema changes needed. Pattern 32 doesn't apply — production
  ready; just deferred for scope.

  **Banked:** Edward's smoke during §6.b Phase 1 (May 2026).
  PM workflow observation: the overflow-menu Reassign flow feels
  clunky vs the natural drag affordance for reorder. Drag-nest
  is the cohesive extension.

- [Attach existing leaf via assembly drawer]

  **Slice:** Same as drag-nest above — natural co-bundle.
  Estimated ~30 LOC alongside the drag-nest work.

  **What:** Assembly drawer currently has `+ Add child SKU` which
  creates a NEW Nexus-local SKU as a child. There's no in-drawer
  affordance to attach an EXISTING leaf — PMs have to use the
  overflow menu Reassign flow (or, post-drag-nest above, drag the
  leaf onto the assembly).

  **Future state:** add `+ Attach existing leaf` ghost button
  next to `+ Add child SKU` in the drawer footer. Clicking
  expands a small inline picker (search by sku_label / product_
  name) → select → submit → `assignSkuToParent` with `qty_per_
  parent` default 1. Cleaner than the row-level overflow menu
  for PMs already exploring an assembly's contents.

  **Tradeoff:** picker UI duplicates some of the row-level
  Reassign inline form. Acceptable if drag-nest above ships
  alongside — the overflow menu Reassign becomes the rarely-used
  fallback path, the drag + drawer-attach become the discoverable
  paths.

- [Audit log activity comprehensiveness — rail + page entries]

  **Slice:** Audit log polish slice (~3-5 days, bundled scope).
  Co-bundle candidate with RI.9 nav slice if both touch inner
  rail.

  **What:** Both the inner-rail activity feed (~240px, truncated
  to 6 entries) and the full `/admin/audit-log` page render
  terse `{actor} {action}` summaries. Example from current state:
  "Ed Shin price adj" — PM can't tell which tier, which cell,
  what the previous value was, or what it is now. Misses the
  point of an audit trail (chase down a change → know what
  changed). Already-logged adjacent gaps: 5 pre-RI.7 action
  renderers still show as raw strings; Designer audit L3 entity
  hyperlinks deferred to v1.5. Bundle all three together.

  **Future state — activity rail (constrained ~240px):**
  - Short-form: `Ed Shin · T2 Std $14.20→$15.10`
  - Or 2-line: action header + delta line
  - Direction arrow + magnitude where applicable
  - Truncate gracefully with ellipsis; hover or expand for full
  - Critical: surface scope (tier / scenario / cell) so PM can
    tell adjustments apart at a glance

  **Future state — full audit log page (comprehensive):**
  - From-value → to-value for every change
  - Scope context: scenario name, tier label, cell identity,
    surface origin
  - All pre-RI.7 actions get rich renderers (existing UX_BACKLOG
    entry — folds into this scope)
  - L3 designer audit finding: entity hyperlinks to source
    records (v1.5; folds into this scope)

  **Open design questions when slice spawns:**
  - Activity rail format constraints: lines per entry?
    Truncation strategy?
  - Tiered priority — which actions get rich rendering vs
    minimal? Defaults for unknown action types?
  - Schema sufficiency check: does `audit_log.diff_json` carry
    enough scope keys + old/new values for every action type
    today, or do some actions lose detail at write time? Audit
    each action emitter; backfill diff shape where missing.
  - Currency / percent formatting consistency with cost stack
    register
  - Action type → renderer map; default fallback renderer

  Reference: flagged by Edward during Slice RI.8 smoke
  (May 2026) — screenshot of inner rail showing terse "Ed Shin
  price adj" entries.

- [HubSpot webhook integration — 2-way sync foundation]

  **Slice:** Likely Slice 12 expansion (combined with Mark-
  Accepted writeback) OR dedicated foundation slice.

  **What:** Currently HubSpot → Nexus sync requires manual
  refresh via the "Refresh from HubSpot" button. PMs may quote
  against stale deal data when changes happen in HubSpot (deal
  stage advances, deal value updates, owner changes) without
  Nexus being notified.

  **Future state:**
  - HubSpot webhook endpoint in Nexus (authenticated, idempotent,
    error-recovery)
  - Subscribe to deal property change events in HubSpot
  - Nexus updates cached deal data automatically when webhook
    fires
  - Audit log integration tracks which webhook events triggered
    changes

  **Open design questions when slice spawns:**
  - Which HubSpot events to subscribe? (Deal property changes,
    deal stage changes, deal owner changes, deal deletion,
    association changes)
  - Conflict resolution: if PM edits the deal in Nexus AND
    HubSpot updates same field, who wins?
  - Webhook delivery failure handling: HubSpot retries N times;
    how does Nexus queue + dead-letter?

  **Scope:** ~1-2 days for webhook handler implementation.
  Could bundle with Slice 12 (Mark-Accepted writeback) for full
  bidirectional sync foundation; combined scope ~3-4 days.

  Reference: flagged by Edward during Slice RI.8 architecture
  discussion (May 2026).

- [Collapsible inner rail]

  **Slice:** Possible homes — bundle with navigation IA CD R7
  ask findings, RI.9 nav slice implementation, OR step 7
  cross-surface tactical polish.

  **What:** The inner rail (scenarios list + sub-rail + activity
  section) on quote-scoped surfaces takes ~240px of horizontal
  space. On smaller screens or when PMs want maximum main-content
  area (especially the Costs cost stack which is dense), the
  rail consumes valuable real estate without always being needed.

  **Future state:**
  - Collapse / expand toggle (chevron or similar affordance) on
    inner rail
  - Collapsed state shows minimal indicator (project glyph or
    vertical accent strip) or hides entirely
  - Expanded state restores the full rail
  - State persists per session or per user preference
  - Smooth animation transition between states

  **Open design questions when slice spawns:**
  - Collapse to fully hidden, or to a thin vertical strip with
    hover-to-expand?
  - Per-session state (resets each session) vs persistent user
    preference (stored in user settings)?
  - Should the outer rail (project switcher) also be
    collapsible, or only the inner rail?
  - Keyboard shortcut to toggle?

  Reference: flagged by Edward during Slice RI.8 smoke
  (May 2026).

- [Incoterm selector for freight]

  **Slice:** RI.9 or freight-model-expansion slice (~4-6h).
  Adjacent to deferred "Freight mode first-class representation"
  entry (ocean-import / domestic / air / mixed); candidate to
  bundle both into a single freight model expansion slice.

  **What:** Freight line currently shows DDP hardcoded (no
  visible affordance). PMs need to specify other incoterms
  (EXW for buyer pickup, FOB for port handoff, CIF cost +
  insurance + freight, CFR, DAP, FCA, etc.) — these determine
  which costs flow into customer-facing price vs are excluded.

  **Open design question — placement:**
  - (a) Per freight line — most flexible; rare in CDM workflow
  - (b) Per freight section
  - (c) Quote-level setting with optional per-line override
    (CA lean — most quotes have a single shipping arrangement;
    per-line override handles the rare mixed case)
  - (d) Firm default + per-quote override

  **What incoterms affect:**
  - Math: which costs flow to customer-facing unit price vs are
    excluded. DDP includes duty/tariff in price; EXW excludes
    them (buyer's cost). Math layer's current container-only
    markup + D+T pass-through model assumes DDP; other
    incoterms shift this.
  - Customer-facing PDF terms display ("FOB Long Beach" vs
    "DDP Customer Door"). Slice RI.7 already wires
    `incoterms_default` on firm_settings + `incoterms_snapshot`
    on quotes — leveraged at send-time for PDF rendering.
    Selector here would override the snapshot per-quote /
    per-line.
  - Insurance responsibility assignment (CIF includes
    insurance; CFR doesn't).

  Reference: flagged by Edward during Slice RI.8 cost-stack
  smoke (May 2026).

- [Cross-section consistency within Costs surface]

  **Slice:** Strong candidate for proposed RI.9.5 Design Audit
  Slice. If that stays deferred, log as standalone for a
  dedicated CD R7 round.

  **What:** Packaging, Production, and Freight sections on the
  Costs surface have inconsistent visual treatments:
  - Different color palettes (Freight has amber CUSTOMS subsection)
  - Different layout patterns (Packaging has clean table;
    Freight has header strip + per-tier row + customs subsection)
  - Different input visibility (Packaging MARKUP clearly inline
    column; Freight Duty/Tariff partially obscured in subsection)
  - Different column registers and footer treatments

  Pattern of inconsistency extends beyond just these two sections
  — Production section likely has its own variations.

  **Future state:** Unified section visual register across Costs
  surface. Same card chrome, same header strip pattern, same
  column structure (component/category/supplier/markup/tiers),
  same MARKUP placement, same TOTAL footer, same input
  visibility, same color palette (reserve amber for actual
  warnings/errors only — not subsection backgrounds).

  **Recommendation to Edward + CA:** reconsider scoping
  RI.9.5 Design Audit Slice. Slice RI.8 hotfix surfaced
  multiple architectural-consistency findings reactively (cost
  stack semantic mismatches × 3, cross-section visual diverge,
  CustomsRow orphaning during route consolidation, "?" tooltip
  trigger, autosave focus loss, numeric step attrs); each smoke
  surfaces another instance. Reactive logging is preserving
  signal but the systematic review is the structural fix. CC
  estimate: 1-2 days for a proper cross-surface audit.

  Reference: flagged by Edward during Slice RI.8 cost-stack
  smoke (May 2026); latest instance of the architectural-
  consistency pattern.

- [Cost stack bar hover tooltip — cost + markup breakdown]

  **Slice:** Step 7 (cross-surface tactical polish) for (a);
  RI.9 for (b). OR bundle both into a dedicated "cost stack UX
  enhancements" slice.

  **What:** Cost-stack bars currently show total component value
  (e.g., PKG $5.80) with a visual cost+markup bar segmentation
  but no numeric breakdown. Hover tooltip showing cost + markup
  composition would help PMs understand contribution sources
  without leaving the cost stack.

  **Future state — two scope levels:**

  (a) **Tier-level breakdown** — hover PKG bar → tooltip shows
  "Cost $4.00 + Markup $1.80 = $5.80". Reads from per-component
  buckets (`componentCost` + `componentMarkupSum` from the math
  layer). ~1 hour. Implementation depends on Option 2 (per-
  component markup primitives) — shipped in current Slice RI.8
  hotfix; data is available, just needs the hover trigger +
  tooltip rendering.

  (b) **Per-line breakdown** — hover PKG bar → each packaging
  line's contribution listed ("T&L: $4.00 × 1.45 = $5.80;
  Secondary: ...; etc."). ~3-4 hours; touches drilldown data
  shape; visual considerations for multi-line sections (clipping,
  scrolling within tooltip).

  Apply consistently across PKG, PROD, FRT, D+T components. Use
  single tooltip component pattern for cross-component
  consistency.

  **Why deferred from RI.8 hotfix:** scope discipline — the hot-
  fix is already large (Option 2 + freight markup feature + 5
  prior commits). Tooltip enhancement is polish work, not bug
  fix. Edward deferred (a) tier-level alongside (b) per-line so
  both ship in the same future slice for consistency.

  Reference: flagged by Edward during Slice RI.8 cost-stack
  smoke (May 2026).

- [Freight markup category scope-restriction decision]

  **Slice:** RI.9 or schema-architecture slice.

  **What:** Slice RI.8 freight-markup feature shipped with the
  open-model assumption: firm `markup_defaults` entries are
  identified by category name (text), and any category can be
  used in any cost section (packaging or freight). Freight
  auto-populates from `markup_defaults.category = "Freight"` on
  freight line creation, but nothing prevents PMs from also
  applying that category to a packaging row, or using a
  packaging category on a freight row.

  **Architectural question to resolve:** should firm "Freight"
  category be scope-restricted (only usable in Freight section)
  or stay open (any category usable anywhere)? Restricting
  prevents misuse / cross-bleed but limits flexibility. Open
  model preserves current behavior.

  **Implementation cost when decided:** if scope-restrict, add
  `markup_defaults.scope` enum column (`global` / `packaging`
  / `freight`) + migration + UI dropdown filter on each section
  to only show relevant categories. Action validation rejects
  out-of-scope assignments.

  Reference: deferred from Slice RI.8 freight-markup feature
  (May 2026). The freature shipped with open-model auto-populate;
  this entry captures the scope-restriction follow-up.

- [HelpTooltip trigger — replace bare "?" with Info icon]

  **Slice:** RI.8 step 7 (cross-surface tactical polish)

  **What:** `src/components/help-tooltip.tsx` renders a bare "?"
  inside a small bordered circle as the tooltip trigger. Edward
  smoke: reads as awkward / free-floating, doesn't telegraph
  "interactive." Standard accessibility + clarity pattern is a
  proper Info icon (lucide-react `<Info>` or equivalent).

  Single-source-of-truth: HelpTooltip is the only "?" trigger
  pattern in the codebase (grep verified). Replacing the
  child glyph inside the existing `<button>` propagates to every
  consumer (CustomsRow, freight-line-row, etc.).

  **Audit task during step 7:**
  - Replace "?" character with `<Info size={12} />` (or token
    SVG) inside the trigger button
  - Verify visual register still matches the surrounding
    register (small + secondary; doesn't compete with the
    label it annotates)
  - Spot-check every consuming surface (Setup, Costs, Pricing,
    Quote, admin pages) for hover/click + dark-mode contrast

  Reference: flagged by Edward during Slice RI.8 hotfix
  (May 2026).

- [Cross-surface autosave refactor — blur+Enter pattern]

  **Slice:** RI.8 step 7 (cross-surface tactical polish) OR a
  small dedicated sweep slice.

  **What:** Slice RI.8 hotfix replaced debounced-on-keystroke
  autosave with blur+Enter commit on two surfaces (FreightTierCell
  totalFreight, CustomsRow duty/tariff). Edward smoke: keystroke
  autosave + optimistic re-render caused focus loss mid-typing
  for multi-digit numbers — PMs entering "10000" with pauses
  between digits lost focus on every save fire.

  Pattern: local state updates on every keystroke (input renders
  correctly), commit fires ONLY on blur (tab out / click away)
  OR Enter key. Optimistic store push happens at commit, not on
  every change, so cost-stack / section headers stay in sync at
  commit boundaries.

  **Remaining files** (~11) using debounced-on-change autosave:
  - src/app/projects/[id]/quotes/[quoteId]/freight/freight-line-row.tsx (legacy /freight surface)
  - src/app/projects/[id]/quotes/[quoteId]/notes-editor.tsx
  - src/app/projects/[id]/quotes/[quoteId]/packaging/packaging-line-row.tsx
  - src/app/projects/[id]/quotes/[quoteId]/production/production-section.tsx
  - src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx
  - src/app/projects/[id]/quotes/[quoteId]/sku-search-panel.tsx
  - src/app/projects/[id]/quotes/[quoteId]/tier-row.tsx
  - src/components/costs/packaging-drilldown.tsx
  - src/components/costs/production-drilldown.tsx
  - src/components/global-price-adj-input.tsx
  - src/components/tier-price-adj-input.tsx

  Reference: Slice RI.8 hotfix (May 2026). The 2 freight surfaces
  establish the canonical pattern.

  **Convention to bank**: numeric/text inputs that fire server
  saves should commit on blur+Enter, never on keystroke. Keystroke
  saves only safe when the input is uncontrolled OR when the
  parent guarantees no remount on save (rare in practice).

- [CBM share — unit-level input model]

  **Slice:** RI.9 cost-stack work

  **What:** Slice RI.8 hotfix added then removed an inline per-tier
  CBM input on FreightTierCell per Edward's UX call (awkward
  placement, redundant across tiers — same SKU has identical CBM
  on each tier). Equal-allocation fallback math in costing.ts
  handles the no-CBM case correctly for all single-product or
  similar-sized-SKU shipments.

  **Future state**: single unit-CBM input per SKU on Setup or
  Costs surface; system computes per-tier `sku_total_cbm` as
  `unit_cbm × tier_qty` internally. Only matters for
  ocean-multi-SKU shipments with mixed product sizes — deferred
  until that use case becomes visible.

  Reference: flagged by Edward during Slice RI.8 hotfix
  (May 2026). Existing `freight_inputs.sku_total_cbm` column
  preserved; backfill from a new `quote_skus.unit_cbm` column
  when this lands.

- [Cross-surface numeric input step attribute audit]

  **Slice:** Slice RI.8 step 7 (cross-surface tactical polish)
  OR a small dedicated sweep slice.

  **What:** Slice RI.8 Option B+ hotfix flagged that the CBM
  share input had `step="0.0001"` — spinners incremented by
  ten-thousandths, making the arrows useless. Hotfix fixed the
  four freight inputs (totalFreight, skuTotalCbm, dutyPct,
  tariffPct) to `step="1"`. PMs can still type fractional values
  freely (the step attribute only constrains the spinner
  increment + form-submit validation; onChange handlers accept
  any input).

  **Audit scope:** every `<input type="number">` with a `step`
  attribute across the app. Likely candidates:
  - Markup defaults table: defaultMarkupPct (step="0.01" today)
  - Firm settings: target/floor margin (step="0.01" today)
  - Setup SKU rows: retail benchmark, quantity inputs
  - Production drilldown: lump-sum fields (filling/blending,
    setup fee, etc.)
  - Packaging line rows: unit cost, qty_per_sellable_unit,
    markup pct
  - Global price adjustment slider
  - Tier qty inputs
  - Per-cell sell-price override input

  **Convention to bank** if it doesn't already exist: arrows
  should increment by the natural unit PMs adjust by. Dollars =
  whole-dollar arrows (step="1"). Percentages = whole-point
  arrows (step="1"). CBM / fractional units = whole-unit arrows
  (step="1") with fractional typing supported. Sub-cent
  precision via arrows is never what PMs want.

  Reference: Slice RI.8 Option B+ hotfix (May 2026).

- [Restore cost-stack RAW + PASS rows under per-component split]

  **Slice:** RI.9 cost-stack work

  **What:** Slice RI.8 Option B+ landed the D+T row split. RAW
  (when rawsMode ≠ dps_sources) and PASS (services billed
  separately) still render as hardcoded em-dashes because their
  buckets aren't broken out from production / serviceFees yet.
  Complete the split:
  - RAW: extract `rawCost` from the production sum into its own
    breakdown bucket. Render only when `rawsMode = dps_sources`
    (otherwise raws fold into production, same as today).
  - PASS (passthrough): expose `separateServiceFees` as a
    breakdown row. Render when any production row has
    `allocate_service_fees_to_cost = false`.

  Pattern is "row appears when it carries signal" — same logic
  RAW already used (conditional on dps_sources mode). Avoid the
  always-visible-always-zero anti-pattern that motivated the
  D+T relabel in Option A.

  Reference: Slice RI.8 Option B+ hotfix (D+T split landed;
  RAW/PASS deferred).

- [Multi-tenant quote-number sequence (post-MVP)]

  **Slice:** Post-MVP / TBD (when multi-tenant becomes real)

  **What:** RI.7's quote-number trigger lands as `CREATE SEQUENCE
  quote_number_seq START 1000` — a single global Postgres sequence
  shared across all firms. Single-tenant v1 (The DPS only) — safe
  assumption. When Nexus is ever multi-tenant, the global sequence
  would race + collide across firms (Firm A's `DPS-1042` could
  accidentally be Firm B's `ACME-1042` if the sequence is shared).
  Worse: counter exposure leaks aggregate quote volume across firms.

  **Migration when it matters:**
  - Option A: per-firm sequence — `CREATE SEQUENCE quote_number_seq_{firm_id}`
    dynamically; bookkeeping in firm_settings or a separate
    `firm_quote_counters` table
  - Option B: `(firm_id, next_quote_number)` table with row-level
    locking on increment (`SELECT ... FOR UPDATE` per assignment)
  - Option B reads cleaner; Option A scales further (sequences are
    cheaper than transactional updates at very high volume — not a
    concern at Nexus scale)

  **Why log it:** when multi-tenant becomes real, this is one of the
  first things to fix. Single-tenant assumption is explicit in CR-SM
  DEC-4 + the migration comment. Not a v1 concern.

  Reference: `docs/ri7-state-machine.md` DEC-4; `docs/ri7-brief-amendment.md` §3.10.b.

- [Audit log read-view: new action renderers for RI.7]

  **Slice:** RI.7 (folded into base brief §3.12 implementation)

  **What:** The audit log read view from brief §3.12 ships with an
  action-renderer map (action enum → display function + chip color).
  RI.7 adds five new action types (plus extended diff_json shapes
  on an existing action) that need entries in that map, not just
  storage:
  - `quote_sent` — diff_json carries `{ quoteNumber, validUntil,
    snapshots: {tcs, paymentTerms, leadTime, incoterms, daysValid},
    preparedBy: {name, email, phone, derived_from} }`. Renderer:
    "Quote sent · {quoteNumber} · valid until {date} · prepared by
    {name} (resolved from {Nexus user|HubSpot one-shot})". Snapshot
    details available on expand.
  - `customer_acceptance_recorded` — diff_json carries
    `{ customer_accepted_tier_id, recorded_by_user_id, email_ref? }`.
    Renderer: "Customer accepted Tier N · recorded by [user] · email
    ref: [string|—]".
  - `customer_acceptance_cleared` — diff_json carries `{ from:
    tier_id, to: null }`. Renderer: "Cleared customer acceptance ·
    was Tier N".
  - `user_phone_updated` — diff_json `{ from, to }`. Renderer:
    "User phone updated · {from|—} → {to|—}".
  - `firm_settings_updated` — existing action, new diff_json column
    names for vendor identity / customer-facing defaults. Per-column
    renderer extends with: vendor_name, vendor_tagline, vendor_address,
    quote_number_prefix, tcs_default, payment_terms_default,
    lead_time_default, incoterms_default, days_valid_default.

  PreparedBy snapshot data lives inside `quote_sent.diff_json.preparedBy`
  rather than a distinct `prepared_by_snapshotted` action (CR-SM §1.DEC-8
  audit decision, May 2026 post-Edward-review): snapshots are immutable
  for sent quotes and emit only inside sendQuote, so a distinct action
  would duplicate the audit row. If a future slice introduces an
  independent re-snapshot path, split back out.

- [Admin surfaces visual rebuild (Round 5 + post-RI.0 token consolidation)]

  **Slice:** RI.8 polish (or dedicated admin-rebuild slice)

  **What:** Admin pages (`/admin/firm-settings`, `/admin/users`,
  `/admin/audit-log`, `/admin/markup-defaults`) were built in Slice 8
  with stock Tailwind utility classes (`bg-slate-900`, `border-slate-300`,
  `text-slate-700`, etc.). RI.0's `@theme` token rebuild replaced
  the default Tailwind palette with project-specific OKLCH tokens
  (paper / ink / accent / good / warn / bad / internal / freight),
  so the stock `slate-*` / `blue-*` palettes generate no CSS in Tailwind
  v4 emission. Symptom: admin buttons render as unstyled `<button>`
  elements, section cards have no visible borders/backgrounds, inputs
  use browser-default chrome.

  RI.7 surfaced this when Edward smoke-walked /admin/firm-settings
  and reported "Save button doesn't look like a button." Spot-fix:
  swapped the four Save / Search buttons to `.r2-btn primary` (loaded
  globally; project's button primitive). Rest of the admin chrome
  (card backgrounds, fieldset headers, input borders, dl summary
  panels, history table) still uses broken stock Tailwind utilities.

  **Scope when this slice runs:**
  - Replace `bg-slate-*`, `border-slate-*`, `text-slate-*` utilities
    on admin pages with `@theme`-token-backed alternatives (paper-N,
    ink-N, rule). Or migrate to scoped CSS files following the
    `r2-*.css` pattern used by other RI surfaces.
  - Brief §3.10 specifies a richer Round 5 firm-settings design
    (portfolio-effect strip, history rail, edit-mode preview-then-
    commit). Rebuild firm-settings UI to match that design while
    also fixing the palette issue.
  - Apply the same visual rebuild to markup-defaults (§3.11),
    audit-log (§3.12), and users (new RI.7 surface, no design
    round source yet — extrapolate from Round 5 register).

  **Why log it:** the spot-fix on the four buttons gets RI.7 to
  smoke-pass-able, but the broader admin chrome is visually broken
  across all four admin pages. PMs accessing admin during the RI.7
  → RI.8 gap will see functionally-correct but visually-incomplete
  surfaces. Acceptable for a v1 internal tool with limited admin
  use; not acceptable past RI.8.

  Reference: Edward's RI.7 smoke-walk surface, May 2026. Spot-fix
  commits on `slice-ri.7`.

- [T&Cs render: bullet-list support]

  **Slice:** RI.8 polish / TBD

  **What:** T&Cs commonly contain bulleted lists (logistics rate
  validity periods, exclusion conditions, etc.). PdfTerms currently
  splits on blank-line separators for paragraph rendering but has
  no support for in-paragraph bulleted items. Edward's first T&Cs
  paste hit this on the logistics rates section.

  **Workaround in place:** prose-with-semicolons reformatting
  (Edward's pasted version inlines the three logistics bullets into
  a single sentence with `;` separators). Functional but loses
  scannability for legal text where bullets aid review.

  **Future state:** parse common bullet markers (`-`, `•`, `*` at
  line start) within paragraph blocks into rendered `<ul>` lists
  with PdfTerms' small-text legal register. Or full Markdown
  rendering if other formatting (bold, headings) becomes needed.

  **Why deferred:** Edward's current T&Cs prose-reformatting is
  functional for v1. Bullet support is polish, not a blocker for
  ship.

  Reference: surfaced by Edward post-RI.7 T&Cs paste, May 2026.

- [Audit log read-view: explicit renderers for pre-RI.7 action types]

  **Slice:** RI.8 polish / TBD

  **What:** RI.7 shipped the audit log read view MVP with explicit
  renderer cases for the new RI.7 action types (quote_sent /
  customer_acceptance_* / user_phone_updated / firm_settings_updated)
  plus a handful of older ones (global_price_adj_updated,
  cell_override_updated, scenario_dropped, create/created,
  update/updated, delete/deleted). Self-smoke (May 2026) against the
  live audit_log surfaced 5 action types that still fall through to
  the generic action-key uppercased fallback:
  - `raws_mode_updated` (RI.4)
  - `production_policy_updated` (Slice 6)
  - `tier_price_adj_updated` (Slice 9.2)
  - `cell_target_updated` (Slice 9.4b)
  - `quote_level_client_target_updated` (Slice 9.4c — pulled back;
    7 stale audit rows persist as historical noise; explicit renderer
    not needed but consider data cleanup if forensic queries get
    confused)

  **Why log it:** generic fallback renders correctly (chip label =
  uppercased action key + neutral color + raw action key summary)
  but loses the action-specific surface treatment PMs benefit from.
  When RI.8 audit-log polish work happens (filters, time-grouped
  headers, cascade chips, CSV export), add explicit renderer cases
  for these five. Sample diff_json shapes available via
  `scripts/verify/audit-log-renderer-smoke.ts`.

  Reference: `src/app/admin/audit-log/renderers.ts`,
  `scripts/verify/audit-log-renderer-smoke.ts`. Convention from
  `docs/ri7-state-machine.md` §6.1 (audit log read-view rendering
  scope).

  **Why log it:** RI.7 implementation needs to extend the read-view
  renderer map alongside the actions themselves — not just write to
  audit_log and let the read view show "(unknown action)". The
  rendering work is scoped here so it's not forgotten when the
  state-machine actions are wired.

  Reference: `docs/ri7-state-machine.md` §6.1; brief §3.12.

- [Slice 13 — HubSpot library sync (vendors + products)]

  **Slice:** 13 (post-MVP enrichment)

  **What:** Promote vendors + products from ambient free-text fields scattered across Cost Build input pages (packaging supplier, production supplier, freight forwarder, etc.) to first-class tables with bidirectional HubSpot sync. Cost Build input rows retrofit from free-text supplier strings to dropdown selections backed by the synced vendor library. Products get the same treatment so SKU-level references can resolve to canonical entities instead of repeated free-text.

  **Scope:**
  - `vendors` + `products` first-class tables (schema, migrations).
  - HubSpot bidirectional sync (read + write). Read syncs vendor/product entries created in HubSpot CRM into Nexus. Write pushes Nexus-originated entries back to HubSpot. Conflict-resolution policy TBD at slice kickoff.
  - Retrofit Cost Build input pages: packaging line supplier field, production input supplier field, freight line forwarder field — all switch from text input to dropdown sourced from synced library.
  - Migration strategy for existing free-text values: best-match against synced library, mark unmatched entries for manual reconciliation by admin (don't silently lose data).

  **Dependencies:**
  - HubSpot CRM-side data setup — vendor records need to exist as HubSpot objects before sync can pull them. Confirm with HubSpot admin at slice kickoff.
  - RI.7 admin foundation — sync config UI (frequency, conflict policy, manual trigger) lives in admin.
  - Migration strategy — define before slice 13 starts since touch-everything-Cost-Build refactor depends on the canonical mapping rules.

  **Seed payload:** `docs/hubspot-vendor-seed.ts` — 127 raw `type = VENDOR` records pulled from HubSpot 2026-05-06. NOT cleaned: ~25 empty names, ~25 records where `name` = website domain, mixed-industry rows (SaaS + professional services co-mingled with operational suppliers). File docstring lists the industry filter set for cost-line eligibility + recommends Edward triage to a `cost_line_eligible` HubSpot custom field before Slice 13 sync filters on it. The `VendorRecord` interface is the v0 shape; final `vendors` table schema decided at slice kickoff.

  **Why log it:** anyone working Cost Build section drilldowns between now and Slice 13 needs to know the free-text supplier fields are TEMPORARY. Don't build dependent UX (filtering, grouping by supplier, reports) on top of free-text — wait for the dropdown retrofit. RI.6 + RI.7 + Slice 11/12 work is unaffected; this is a future enrichment, not a refactor of in-flight scope.

  Reference: post-RI.6 surface, May 2026.

- [Per-customer commercial defaults from NetSuite]

  **Slice:** Post-MVP / TBD (likely paired with or after Slice 13 HubSpot library sync — same external-sync infrastructure shape)

  **What:** Several "customer-facing defaults" in firm_settings vary per customer in The DPS's actual workflow — payment terms is the load-bearing example (Net 30 vs 50/50 deposit vs custom contractual). Incoterms and lead time often vary per customer relationship too. RI.7 ships firm-wide defaults with per-quote override as the only customization path, forcing PMs to re-enter the same customer-specific values for every quote to that customer.

  **Source of truth:** NetSuite. Customer records carry payment terms (and arguably incoterms / lead time) at the customer level.

  **Future state:** When a quote is created against a customer, pull customer-level commercial defaults from NetSuite and snapshot onto the quote at send. firm_settings defaults become the fallback for customers without customer-level configuration.

  **Field split:**
  - Per-customer (sync from NetSuite): payment terms, incoterms, lead time
  - Firm-wide (stay in firm_settings): T&Cs, days valid, quote-number prefix, vendor identity

  **Data flow:** NetSuite → Nexus (read sync). Could pair with Slice 13 HubSpot vendor library sync if sync infrastructure overlaps, or stand as its own slice.

  **Open design questions for slice kickoff:**
  - Customer-entity schema location in Nexus (new `customers` table? extend `projects`?)
  - Sync cadence (on-demand at quote creation / periodic / webhook-driven)
  - Fallback chain (customer terms → firm default → null)
  - Whether Nexus admin UI writes back to NetSuite or NetSuite is read-only source-of-truth

  **Why deferred:** RI.7 firm-wide-with-override is functional but friction-heavy for repeat customers. NetSuite sync is real infrastructure work (auth, sync model, conflict resolution); worth doing after Slice 13 establishes a HubSpot read-sync pattern Nexus can model NetSuite reads against.

  Reference: flagged by Edward post-RI.7, May 2026. Confirms earlier prediction in Slice 13 scoping that NetSuite would become relevant once payment workflows entered scope.

- [PreparedBy contact derivation (RI.7)]

  **Slice:** RI.7 (admin foundation / firm_settings extension)

  **What:** Customer-facing PDF "Prepared by" block currently has THREE lines on the right side of the header: firm name, contact (name/email/phone), firm address. RI.6 ships firm name + firm address as live (`VENDOR_FIXTURE` constant in `src/lib/customer-view-fixtures.ts`, promoted to `firm_settings` in RI.7); the contact line renders the visible-synthetic stub `{prepared-by-pending · derives from deal owner in RI.7}` via `QUOTE_STUBS.preparedBy` + the `.pdf-stub` dashed-underline marker.

  Contact is per-deal data — different sales rep per project — so it must derive from the HubSpot deal owner, not a firm-level constant. Resolution chain:
  `projects.salesRepUserId` (uuid FK → `users.id`) → `users.name` + `users.email` + `users.phone`.

  **What's wired today (schema audit, May 2026):**
  - ✅ `projects.hubspot_owner_id` (text, indexed) — captured at deal import time.
  - ✅ `projects.sales_rep_user_id` (uuid FK → users) — backfilled by `ensureUser()` on Clerk sign-in via HubSpot owner email match (`src/lib/auth/ensure-user.ts:50-60`).
  - ✅ `users.name` + `users.email` — populated on first sign-in from Clerk.
  - ❌ `users.phone` column — does not exist.
  - ❌ HubSpot owner sync extension — `findHubspotOwnerByEmail` + `fetchOwnerDetails` (`src/lib/hubspot.ts:121, 205`) return `{ id, firstName, lastName, email }` only. HubSpot owner records DO carry phone in the API; we just don't pull it.

  **Scope:**
  1. Migration: ADD `users.phone text` (nullable; not all users have phone).
  2. Extend `fetchOwnerDetails` + `findHubspotOwnerByEmail` to pull phone from HubSpot owners API; backfill `users.phone` in `ensureUser` on first sign-in.
  3. Admin manual-edit affordance for users.phone (HubSpot owner phone is often empty in CRM — needs manual entry path).
  4. Server helper `getQuotePreparedBy(quoteId)` returns `{ name, email, phone }` from `projects.salesRepUserId → users` join. Replaces `QUOTE_STUBS.preparedBy` stub in `PdfHeader`.
  5. Promote `VENDOR_FIXTURE` (name/sub/address) to `firm_settings` table columns with the constant as graceful-degradation fallback when columns are NULL.

  **Open PM question — un-signed-in-rep edge case:** if the sales rep on a deal hasn't signed into Nexus yet, `projects.salesRepUserId` is NULL and there's no users row to resolve to. Three options:
  - **(a) Render-time HubSpot fetch by `projects.hubspotOwnerId`.** One round trip per PDF render (cacheable per owner ID). Pro: always-correct render. Con: cache invalidation + adds HubSpot dependency to a customer-facing render path.
  - **(b) Eagerly snapshot at deal import.** Add `projects.prepared_by_name / _email / _phone` columns; populate from HubSpot at import. Pro: render path is purely DB. Con: snapshot goes stale if owner is reassigned in HubSpot after import; needs refresh-on-deal-refresh wiring.
  - **(c) Block PDF render until rep signs in.** Show an actionable "Sales rep hasn't signed into Nexus yet — they must sign in once before quotes can be sent." surface. Pro: simplest data model; forces backfill. Con: hard-gates a PM workflow on an unrelated sign-in event.

  Decide at RI.7 kickoff. Default leaning is (a) with a sensible TTL cache, since the deal-owner refresh button already establishes the pattern of HubSpot-as-source-of-truth at render time. (b) is the right answer if HubSpot rate limits become a real concern.

  **Why log it:** RI.6 ships with the stub as part of the visible-synthetic discipline; the architecture decision (data source = deal owner, not firm-level constant) is captured here so RI.7 doesn't have to re-derive it. Architectural correction call was Edward's May 2026 review of the RI.6 vendor block — hardcoding contact would be wrong for any quote not handled by one specific person.

  Reference: `src/lib/customer-view-fixtures.ts` `VENDOR_FIXTURE` + `QUOTE_STUBS.preparedBy`; `src/components/pdf/pdf-header.tsx` PreparedBy block; schema audit `src/db/schema.ts:156-208`.

- [Customer-view boundary guard: migrate from custom verifier script to ESLint no-restricted-paths]

  **Slice:** TBD (when ESLint infra arrives)

  **What:** RI.6 implemented the customer-view boundary guard via `scripts/verify/customer-view-boundary.ts` — a custom 90-line script that greps `src/components/pdf/**/*.{ts,tsx}` for forbidden imports (`@/components/cost-build`, `@/components/costing`, `@/lib/costing*`, `@/db*`, `@/app/actions/*`, `@/components/internal-only-badge*`). Hooked into the prebuild npm script so failures surface at `next build`. The Designer audit specced ESLint via eslint-plugin-import's `no-restricted-paths` rule, but the project has no ESLint configured today (v15.5.15's `next lint` is deprecated, and this codebase never set up the canonical eslint.config or eslint.json). Installing eslint + eslint-plugin-import + writing flat config just for one rule is yak-shaving for v1; the custom script delivers the same enforcement strength.

  **Why log it:** when Edward decides ESLint pays for itself across the codebase (likely Slice 17 polish or a separate codebase-hygiene slice), migrate the customer-view boundary check into the canonical `import/no-restricted-paths` config and delete the custom script. The script is 90 lines that someone has to remember to maintain; ESLint is the canonical mechanism. Until ESLint is otherwise needed, the custom script is the right shape.

  **Where designed:** Designer memory `reference_r3_pdf_token_lock.md` specced the ESLint mechanism on the (incorrect) assumption that Next.js's default eslint setup ships eslint-plugin-import. That assumption was wrong for this project. The mechanism intent (build-time error if costing imports leak into PDF subtree) is preserved either way.

  Reference: `scripts/verify/customer-view-boundary.ts`, `package.json` `prebuild` script, RI.6 implementation.

- [DB invariant: quotes.drop_reason ↔ scenario_status='dropped' (Slice 12 hardening)]

  **Slice:** 12 (Mark-Accepted + sibling auto-drop action)

  **What:** RI.1 added `quotes.drop_reason` (scenario_drop_reason enum) and `dropped_by_user_id` + `dropped_at` columns. Schema comment declares the invariant: "NULL on active/accepted; required (action-layer) when status transitions to 'dropped'." But the action layer that enforces this — sibling auto-drop on Mark-Accepted (Round 3 commitment #5), draft-at-accept auto-save (Round 3 commitment #2), manual drop UI — ships in Slice 12.

  **Risk window:** between RI.1 and Slice 12, a manually-inserted `scenario_status='dropped'` row could land with NULL `drop_reason`. Render path is graceful (`humanizeDropReason` returns the reason as-is; if null, badge renders empty). But the data quality drift is real if anything bypasses the action layer.

  **Where designed:** Slice 12 brief — auto-drop on accept implements the canonical write path. Designer RI.1+RI.2+RI.3 audit S5 surfaced + dispositioned (Justify-or-Fix; CC chose UX_BACKLOG over premature DB CHECK).

  **Two paths when the invariant ships:**
  1. Add a DB CHECK constraint via Slice 12 migration: `CHECK ((scenario_status = 'dropped') = (drop_reason IS NOT NULL))`. Hard guarantee at the schema layer. Defensible.
  2. Action-layer enforcement only (default to 'manual' when missing on dropped rows). Looser; relies on action discipline.

  **Why log it:** Don't add the CHECK now (premature; no auto-drop action to validate against). Don't lose the invariant (would create silent data drift). Slice 12 implementation should pick path 1 OR path 2 explicitly.

  Reference: `src/db/schema.ts` `quotes.drop_reason` column comment + Slice 12 brief auto-drop section.

- [Setup page feature enhancements]

  **Slice:** §6.b Setup redesign (when CD R7 lands) OR standalone "Setup enhancements" slice

  **What:** Two related enhancements both deferred from RI.8 polish
  scope. Bundled because they share natural slice routing — either
  Setup redesign (§6.b) or a standalone "Setup enhancements" slice.

  **(1) Add new product authoring**

  Current state: Setup page supports HubSpot product lookup (search
  existing) and "+ Add assembly (Nexus-local)" (compose existing
  components). PMs can't create a brand-new product from Setup —
  custom one-offs require leaving Nexus, adding to HubSpot, then
  returning to look up.

  Open design question: where does the new product LIVE?
  - (a) Nexus-local — quick add, no HubSpot pollution; good for
    one-off customs (1-2 days)
  - (b) HubSpot writeback — canonical across firm; good for items
    reused across customers (2-3 days)
  - (c) PM choice at creation time with chooser UX (3-4+ days)

  **(2) SKU table interactivity**

  Current state: Table supports basic operations (add/remove/reorder
  via up-down arrows). Lacks modern interactivity for the assembly
  use case — Assemblies are first-class (per existing TYPE column
  distinguishing Leaf vs Assembly) but nested component structure
  isn't surfaced in the table.

  Future state:
  - Drag-and-drop row reordering (replaces up/down arrows in
    ACTIONS column)
  - Assembly rows expand/collapse to reveal nested components
  - Inline edit affordances for nested components consistent with
    R5/R6 inline-edit table pattern
  - Better visual distinction between Leaf and Assembly row
    treatments

  **Routing — both enhancements:**
  - (a) Bundle into §6.b Setup redesign slice when CD R7 lands —
    Designer's redesign brief naturally covers both
  - (b) Standalone "Setup enhancements" slice if Edward wants
    enhancements before full redesign

  Cleaner if §6.b happens (bundles enhancement with redesign).
  Standalone is right if redesign waits indefinitely.

  Reference: both flagged by Edward post-RI.8 step 1.5 smoke,
  May 2026.

- [Per-SKU drill-down from Costing Sheet to Cost Build (post-MVP)]

  **Slice:** Post-MVP / TBD (validate workflow first)

  **What:** Costing Sheet currently routes to Cost Build only at the page level (no per-SKU context). When PMs land on Costing Sheet directly via inner rail or deep-link and want to drill into a specific SKU's decomposition, they re-navigate manually. Wire if/when smoke shows the workflow gap. Requires `?focus=<sku-id>` deep-link param on Cost Build + per-row "Open in Cost Build →" affordance on Costing Sheet rows.

  **Why log it:** R2's per-SKU surface had inline cost decomposition (no separate Cost Build); R6 split decomposition out to Cost Build. Costing Sheet R2 source has no per-row navigation because R2 didn't need it. With v1 RI.4+RI.5 architecture, the inter-page nav lives at the top-level Cost Build button. If PMs report "I wanted to drill into a SKU specifically, not the section," that's the signal to add `?focus=<sku-id>` deep-linking to Cost Build + a per-row affordance on Costing Sheet rows.

  **Where designed:** R2 `costing.jsx:388` confirms cards are NOT clickable in R2 source (cell-level affordances only); brief §3.3:362 specifies "Open Cost Build →" at page level only. v1 ships per option A from RI.5 Room 3 audit (May 2026).

  Reference: Designer Room 3 audit Q3 sub-question + Edward's escalation directive.

- [Production schema → variable-line model (post-MVP)]

  **Slice:** Post-MVP / TBD (data model migration)

  **What:** RI.4 ships Production drilldown as a flat `.r6-dt.prod` table by mapping CC's fixed cost fields (filling_blending, cm_assembly, setup_fee, tooling_artwork, rd, other_service, bulk_raw_cost) onto **virtual lines** per SKU. R6's prototype models production as variable lines per section (each with its own kind/category/supplier/markup). Schema migration would let users add arbitrary production lines (e.g., "Custom assembly fixture", "Secondary kitting") rather than being constrained to the 7 fixed fields. Visual register lands today; data model expansion = real work for v1.5+.

  **Migration sketch:** new `production_lines` table (parallel to `packaging_inputs` / `freight_inputs`) with `line_group_id` + `kind` (per_unit / amortized_nre) + `category` + `supplier` + `markup_pct`. `production_inputs` reduces to per-(line, tier) cell with `total_cost` only. Cost-rollup math layer reads from the new shape.

  **Where designed:** R6 `production-drawer.jsx` lines 85-127 (variable-line table); R6 `index.html:2811-2816` (`.r6-dt.prod` grid template).

  Reference: Slice RI.4 production-drilldown.tsx VIRTUAL_LINES bridge + CR-13 amendment-3.

- [Bulk Raw category + ingredient CRUD UI]

  **Slice:** RI.4 follow-up (post-RI.4 PR merge)

  **What:** RI.4 ships Bulk Raw drilldown read-only with R6 visual register. Add Category / Add Ingredient buttons currently DISABLED placeholders. CRUD action layer + form UIs deferred. Schema is in place (3 tables: bulk_raw_categories, bulk_raw_ingredients, bulk_raw_section_meta from migration 0019) — only the UI + actions ship in follow-up.

  Reference: `src/components/cost-build/bulk-raw-drilldown.tsx`.

- [Production line supplier picker]

  **Slice:** Post-MVP / TBD (depends on supplier infrastructure slice)

  **What:** R6 production line table has a Supplier column. CC's production_inputs schema has no per-line supplier (denormalized; production blocks track per-SKU policy only). RI.4 ships Supplier column rendering "—" placeholder. When supplier infrastructure ships (separate slice), Production line supplier picker lights up.

  Coordinates with: schema variable-line migration (entry above).

  Reference: R6 `production-drawer.jsx:110` `.r6-dt-row .sup`.

- [HTS code lookup for Bulk Raw ingredients]

  **Slice:** Post-MVP / TBD

  **What:** R6 Bulk Raw ingredient sub-line shows HTS code as sub-text under ingredient name. Schema has `bulk_raw_ingredients.hts_code text` column. Ingredient CRUD UI (entry above) needs an HTS picker / search affordance — typing a description matches against an HTS code list (DDP customs declarations require valid HTS).

  Reference: R6 `bulk-raw-drawer.jsx:133` `<span className="sub">HTS {ing.hts_code}</span>`.

- [Cost section ownership data model]

  **Slice:** Post-MVP / TBD (no owner-assignment surface ships in redesign-implementation)

  **What:** R6 section row anatomy includes an owner column (22px avatar with initials + owner name + " · N lines" trailing). RI.4 ships with placeholder rendering (paper-3 circle + em-dash + ink-4 "—" label) per Designer Pattern 1 audit Path A — the column track holds R6 anatomy but the data is absent. When owner-assignment lands, the placeholder lights up.

  **Schema:** new `cost_section_meta` table parallel to `bulk_raw_section_meta`:
  ```
  CREATE TABLE cost_section_meta (
    quote_id    UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    section_kind cost_section_kind NOT NULL,  -- enum: packaging/production/freight/bulk_raw
    owner_user_id UUID REFERENCES users(id),
    PRIMARY KEY (quote_id, section_kind)
  );
  ```
  `cost_section_kind` enum already exists for `cost_section_deposits`; reuse.

  **UI surface:** assignment via Cost Build page header dropdown ("Assigned to: PM Sarah") OR per-section right-click → reassign. Coordinate with role-as-affordance pattern from CLAUDE.md (Purchasing role sees Packaging editable, Production read-only with role-aware caption).

  **Where designed:** R6 `index.html` lines 2667-2678 (`.r6-section-row .owner`) + `section-summary-row.jsx` lines 25-29; brief §3.4:401.

  Reference: Designer Pattern 1 comprehensive audit C-5 (RI.4 block-boundary, May 2026).

- [Per-component cost-vs-markup math layer extension]

  **Slice:** Post-MVP / TBD

  **What:** R6's cost stack bar grammar uses two segments per component bar: `seg.cost` (solid component color) + `seg.markup` (ink-colored, 1px white separator). R6 fixtures explicitly split `cost` and `markup` per component. Nexus's cost-rollup math layer (`src/lib/costing.ts` `QuoteCostBreakdown`) currently exposes the SUM `cost × (1 + markup)` per component — the split isn't computed. RI.4 ships with `seg.cost` only (full-width segment, no markup overlay).

  **Math layer change:** extend `costBreakdown` to expose `{ packaging: { cost, markup }, production: { cost, markup }, ... }` per tier. Source data is already there (`packaging_inputs.markup_pct`, `production_inputs.allocate_service_fees_to_cost`, etc.); just needs a different aggregation shape.

  **UI consequence:** cost-stack-header.tsx `CompRow` already wires the second segment behind a guard; flipping the math returns +1 segment per bar with no further UI change. Per-component cost-vs-markup transparency is a real PM affordance ("how much of this packaging line is contribution vs uplift?") that R2/R6 prioritized.

  **Where designed:** R6 `index.html` lines 2495-2543 (`.r6-bar .seg.cost.* + .seg.markup`); R2 source canonical at `source/round-2/app/r2/styles.css:381-456`.

  Reference: Designer Pattern 1 comprehensive audit C-9 + RI.4 cost-stack-header.tsx CompRow comment.

- [Pulse-dot live HubSpot sync indicator]

  **Slice:** Post-MVP / TBD (data wiring; visual already lands in RI.4)

  **What:** R6 page header includes a 6px green pulse-dot + "Synced to HubSpot · {timestamp}" mono caption signaling realtime sync state. RI.4 ships the visual treatment (green dot with `box-shadow: 0 0 0 3px var(--good-soft)` halo) but the caption text is currently the project's deal/client name placeholder, not a real HubSpot sync timestamp.

  **Wiring:** existing Slice 5.6 cache (`getCacheStatus`) exposes `last_synced_at` per HubSpot entity. Add HubSpot deal sync timestamp to the project-load query path (`projects/[id]/cost-build/page.tsx`) + render in `cost-build-header.tsx` meta strip. Stage label ("Closed Won — Q3" etc.) is also queryable from the cached deal record.

  **Where designed:** R6 `index.html` lines 2357-2365 (`.r6-page-head .meta` + `.live`); brief §3.4 line 397 commitment to per-surface HubSpot sync trust chrome.

  Reference: Designer Pattern 1 comprehensive audit S-6.

- [RI.4 follow-up — Section row owner badge]

  **Slice:** Folded into "Cost section ownership data model" entry above (consolidated post-comprehensive-audit).

- [RI.4 follow-up — Bulk Raw CRUD UI (categories + ingredients)]

  **Slice:** RI.4 follow-up sub-slice (post-RI.4 PR merge)

  **What:** RI.4 ships Bulk Raw schema (3 tables from migration 0019) + read-only display in the new Cost Build drilldown + mode selector + INACTIVE state. CRUD action layer + form UIs for categories + ingredients are scaffolded as DISABLED placeholders ("+ New category" / "+ New ingredient" buttons; "ships in RI.4 follow-up" microcopy).

  **What ships in the follow-up:**
  - `addBulkRawCategory` + `updateBulkRawCategory` + `deleteBulkRawCategory` server actions
  - `addBulkRawIngredient` + `updateBulkRawIngredient` + `deleteBulkRawIngredient` server actions
  - Inline-edit affordances in the existing categories + ingredients table (per Round 5 admin inline-edit pattern)
  - Add Category modal/inline form + Add Ingredient modal/inline form
  - HTS code lookup integration (deferred separately; not blocking categories/ingredients CRUD)
  - Supplier picker (deferred; suppliers infrastructure ships separately)

  **Where designed:** Round 6 + Bulk Raw correction. RI.4 brief §3.4 line 419-426 spec'd the full UI; CC scope-cut to read-only + scaffold for v1.

  **Why log it:** Bulk Raw is brand-new schema with zero existing data. The read-only v1 lets PMs see future-state structure but not edit. CRUD UI is real product surface that needs Designer dispatch (Pattern 3 — small targeted design round) before CC implements.

  Reference: `src/components/cost-build/bulk-raw-drilldown.tsx` + `src/app/actions/bulk-raw.ts` (`setRawsMode` shipped; CRUD scaffold).

- [RI.4 follow-up — line-row component token reskin (Packaging / Production / Freight / Customs)]

  **Slice:** RI.4 follow-up OR RI.5 polish (Costing Sheet rebuild may swallow some of this)

  **What:** The line-row + section components reused inside the new Cost Build drilldowns are pre-RI utilitarian:
  - `src/app/projects/[id]/quotes/[quoteId]/packaging/packaging-line-row.tsx` (495 LOC)
  - `src/app/projects/[id]/quotes/[quoteId]/packaging/add-line-button.tsx`
  - `src/app/projects/[id]/quotes/[quoteId]/production/production-section.tsx` (549 LOC)
  - `src/app/projects/[id]/quotes/[quoteId]/freight/freight-line-row.tsx` (578 LOC)
  - `src/app/projects/[id]/quotes/[quoteId]/freight/customs-row.tsx`
  - `src/app/projects/[id]/quotes/[quoteId]/freight/add-line-button.tsx`

  Token regressions inside these components: `bg-gray-*`, `border-gray-*`, `text-red-700`, `bg-amber-50`, `text-amber-800`, `text-blue-700`, `text-gray-500`, etc. RI.0 token foundation didn't reach into these (the smoke targets were specific surfaces like the per-SKU summary table column header + verdict pills + sparkline).

  **Visible PM impact:** PMs opening any drill-down on the new Cost Build page see pre-RI styling (raw sRGB Tailwind palette) inside the drawer, visually inconsistent with the OKLCH-tuned shell surrounding it.

  **Where designed:** RI.4 brief §3.4 lines 396-433 describe the target drill-down structure (toolbar + table + per-tier columns); the visual treatment per CD's design system applies to the whole composition.

  **Why log it:** Mechanical reskin (find/replace `bg-gray-100` → `bg-paper-3`, etc.) plus a Designer pass to verify visual register matches R6. ~1-2 days of work. Could land as an RI.4 polish PR OR fold into RI.5 (Costing Sheet rebuild may share some of these surfaces).

  Reference: Designer audit X-1 (RI.4 block-boundary, Slice RI.4 PR review).

- [RI.4 follow-up — Cost rollup component breakout for RAW + D+T + PASS rows in cost stack]

  **Slice:** RI.4 follow-up OR RI.5 (Costing Sheet rebuild)

  **What:** The cost stack header (`CostStackHeader`) renders 5 or 6 component bar rows: PKG / PROD / [RAW when dps_sources] / FRT / D+T / PASS. The math layer's `QuoteCostBreakdown` only exposes 4 fields: `packaging`, `production`, `freight`, `serviceFees`. RAW + D+T + PASS rows currently render as 0 (component is structurally present but value source is empty).

  **What's needed:**
  - Math layer extension: `QuoteCostBreakdown` adds:
    - `bulkRaw: number` — sum of bulk raw ingredient costs (when dps_sources mode; else 0)
    - `dutyTariff: number` — sum of duty + tariff portions of landed freight (split out from current `freight` total)
    - `passthroughFreight: number` — pass_through-treatment freight (split out from `freight`)
  - Cost rollup helper updates: `rollUpAssemblyPerTier` + `quoteRollup` walk extends to compute these breakouts
  - Tests: `scripts/test-costing.ts` adds assertions for the new breakouts
  - `CostStackHeader.rowValue()` reads the new fields instead of returning 0

  **Why log it:** Without this, the cost stack header has 2-3 always-empty rows that visually communicate "this is structurally present but data isn't flowing." Functional v1 — PMs can read PKG/PROD/FRT — but the 0-rows are a fidelity gap. Math layer extension is real engineering work; deferred until the surface needs the differentiation enough to justify.

  Reference: `src/components/cost-build/cost-stack-header.tsx:240-254` `rowValue` helper + Designer audit X-3 (RI.4 block-boundary).

- [Per-SKU drill-down spacing audit (RI.5 smoke target)]

  **Slice:** RI.5 (Costing Sheet rebuild — Round 6 section-with-drill-down pattern)

  **What:** Slice RI.0 smoke (Edward, May 2026) surfaced spacing issues on the per-SKU drill-down table that the new tokens make more visible:
  - FREIGHT LINE #1 sub-block compression (vertical density too tight for the per-line content)
  - Value-label alignment drift across the cost-component rows
  - Per-tier column rhythm inconsistent (column widths don't match the rhythm established on the parent SKU summary table)
  - INTERNAL badge placement looks orphaned vs the rows it qualifies

  These are pre-existing on the drill-down surface (Slice 8 era + accumulated through 9.x cost-input surfaces). RI.0 token foundation makes the spacing issues more visible because the OKLCH-tuned palette + JetBrains Mono header reduce visual noise that previously camouflaged the layout drift.

  **Where designed:** RI.5 (Costing Sheet rebuild) per Round 6's section-with-drill-down pattern. The drill-down container itself gets re-architected as a section drill-down composition matching the cost-build sections (R6 designer notes).

  **Why log it:** Don't fix in RI.0. RI.0 ships token foundation only; the drill-down composition is being rebuilt in RI.5 against R6's pattern, and patching spacing in the current shape creates rework when the section-with-drill-down composition lands. RI.5 smoke explicitly verifies these four spacing concerns.

  Reference: `src/app/projects/[id]/quotes/[quoteId]/costing/sku-breakdowns.tsx` (current drill-down surface; RI.5 will replace).

- [Quote-total client target affordance (Slice 9.4c — pulled back)]

  **Slice:** Post-MVP / TBD

  **What:** When PMs negotiate at quote-total level ("can you do this for $X?"), surface a target affordance that lets them model the deal against the customer's stated total. Workflow case is real but uncommon; PMs currently derive by comparing against existing revenue total mentally. Discrete affordance deferred until real-user testing surfaces clear need + proper surface placement.

  **Where designed:** Slice 9.4c (briefed and partially implemented; pulled back during 9.4c.4 smoke after surface-placement audit revealed the Pricing Control Summary is being consolidated out in redesign-implementation §5, plus per-tier per-unit framing doesn't map to real customer negotiation patterns — customers communicate either per-cell-per-unit or quote-total; never "all SKUs at this tier should average $X/unit").

  **Why log it:** Architectural patterns from the 9.4c implementation work are reusable when (if) this affordance ships properly:
  - per-unit math at quote-level scope (revenue-per-unit vs target-per-unit)
  - divide-by-zero protection on tier_qty during per-unit derivations
  - validation rule shape for reconciliation mismatch (per-cell sum vs quote-level)
  - ε tolerance discipline for per-unit comparisons (~$0.01/unit for v1; tolerance scaling tracked separately per architect's queued thinking)
  - CR-12 Designer extension for warning vocabulary on Costing Sheet stays valid even though CR-12 itself was reverted; the broader chip + verdict + reconciliation pattern survives in CR-11.

  **Surface placement consideration:** if/when this ships, surface should be evaluated against the redesign-implementation cost stack panel + margin verdict band architecture (RI.5 Costing Sheet rebuild), not the pre-rebuild Pricing Control Summary. The proper home is likely the cost stack panel header or margin verdict band — places that have per-SKU breakdown visible alongside, proper visual register, and aren't being consolidated away.

  ### Architectural patterns to preserve (Slice 9.4c — deferred)

  When quote-level target was being built (subsequently pulled back), CC + architect worked out the math for per-unit verdict + reconciliation. Reusable when quote-level affordance ships properly post-MVP:

  - **Per-unit verdict shape.** `tier_required_sell_per_unit = total_revenue / tier_qty`; `competitive_verdict_quote_level: COMPETITIVE` if `tier_required_sell_per_unit <= target_per_unit` (no ε needed — matches per-cell direct comparison; equality counts as COMPETITIVE).
  - **Per-unit reconciliation.** `sum_of_cell_targets_per_unit_at_tier = Σ over leaf SKUs of cell_target_per_unit` (no qty multiplication on either side; both per-unit). `matches` if `|sum_per_unit - target_per_unit| ≤ ε` ($0.01/unit for v1).
  - **Divide-by-zero protection.** `tier.qty = 0 or NULL` → revenue_per_unit guard `tier.qty > 0 ? revenue / qty : 0`.
  - **Completeness gate (architect Q1).** Reconciliation rule fires only when ALL leaf SKUs at the tier have cell targets set; partial returns `not_applicable`. Empty-quote edge guarded against `every() === true` on empty arrays via explicit `leafSkus.length > 0` precondition.
  - **Identity tuple for warning row.** `scope='quote'`, `table_name='quote_tiers'`, `row_id=tierId` (genuine UUID-as-text), `field_name='client_target_price_per_unit'`, `tier_id=tierId`. One warning per tier with mismatch (variance IS the cross-cell pattern; no single cell "owns" the warning).
  - **Audit shape.** `action: "quote_level_client_target_updated"`, no `source` flag — set/change/clear on a single column = same semantic per CLAUDE.md "Audit source convention."
  - **Schema posture.** Per-tier granularity → direct column on `quote_tiers` (not sister table — sister-table justification of "column count + lifecycle independence" doesn't apply at quote-tier level; matches `tierPriceAdjPct` precedent).

- [Slice 9.5.5 — comprehensive mutation-action wiring + inline icons + realtime sync]

  **Slice:** 9.5.5 (follow-up to 9.5)

  **What (action wiring):** Wire `reconcileWarnings({ quoteId })` into the remaining mutation actions deferred from PR 2 scope: `addPackagingLine`, `deletePackagingLine`, `updatePackagingLineMetadata`, `upsertProductionInputs`, `updateSkuProductionPolicy`, `addFreightLine`, `deleteFreightLine`, `addTier`, `deleteTier`, `addSkuFromHubspotProduct`, `addAssemblySku`, `deleteSku`. Pattern is established (canonical site: `updatePackagingTierCell` in Slice 9.5 PR 2). Mechanical work; low risk.

  **What (inline icon wiring):** Wire `<WarningIcon>` + `<WarningPopover>` per brief §5.1 + Designer extension memo §A (CR-11) into existing cost-input cell components (`packaging-line-row.tsx`, `freight-line-row.tsx`, plus production cell rendering). Lands alongside the action-wiring sweep (same code path; cell components are the same surfaces the new mutation wirings re-validate). Brief §5.1 commitment timing shifts to 9.5.5; not a scope cut. Components already shipped in PR 2 — the wiring is the deferred piece.

  **What (realtime client subscription):** Wire the browser-side Supabase Realtime subscription on `quote_warnings` so cross-PM sync works (Scenario 5 from brief §7, deferred from PR 2 smoke). Pattern established by Slice 8.5 — extend `costing-store-provider.tsx`'s reconcile pipe to subscribe to `quote_warnings` postgres_changes events on the active quote, route through the existing 250ms coalesce window. Server-side publication membership already configured in PR 2's manual SQL (`drizzle/manual/0017_warnings_realtime_publication.sql`); only the client subscription is missing. Cross-tab smoke: PM 1 accepts warning → PM 2's chip count updates within coalesce window without page refresh.

  **Where designed:** Slice 9.5 brief §3 (action wiring) + §5.1 (inline icon UI) + §7 Scenario 5 (realtime sync); deferred from PR 2 scope to ship core pattern faster.

  **Why log it:** Some of these actions trigger different rule patterns (add/delete fires `tier_coverage_mismatch`; SKU lifecycle re-evaluates outliers; markup edits fire `markup_above_5x_default`) and may surface engine edge cases. Inline icons are the canonical "warning fires here" surface PMs see at the field level — chip + panel surfaces (shipped in PR 2) provide the summary view, but per-cell discoverability is the §5.1 commitment. Realtime client subscription closes the cross-PM sync loop the publication-membership ALTER set up. Bundle all three (action wiring + inline icons + realtime) in 9.5.5 since they share the same per-cell components and the optimistic store's `warnings` slice already feeds them.

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

- [Deferred after V1 validation] Project Archive/Unarchive has no approved
  lifecycle, authorization, reporting, or recovery contract. Both operator
  entry points remain excluded from V1; retained status/action compatibility
  must not be treated as approval to expose the workflow. Revisit through
  Business Validation rather than adding an isolated Unarchive button.

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

- [Gate 1A, open — data quality, not code] One current user row has no
  recorded `users.name`. Every audited action they take now writes
  `actor_display_name = "Unnamed user (<first 8 of id>)"`.

  This is deliberately NOT a defect in the writer, and deliberately not
  folded into Gate 1A. Blocking the write would stop a real person from
  performing any audited action, and inventing a name would be worse:
  the Pricing trace grades its terminals, and a fabricated identity would
  present as a SOURCED terminal — someone actually recorded this — when
  what happened is that nobody ever did. `isFallbackActorIdentity()` in
  `src/lib/audit.ts` keeps the two grades distinguishable so consumers
  can render the absence honestly rather than silently upgrading thin
  provenance to full.

  The fix is to record the missing name, which is an operations task, not
  a schema or code change. Worth doing before the backfill makes the
  fallback permanent across that user's history — after the backfill,
  rows already written keep the fallback string even if the name is
  supplied later, because the snapshot is taken at write time by design.

  Related: the same fallback will be applied by the Gate 1A backfill to
  any historical row whose `user_id` no longer resolves. Those are
  genuinely unrecoverable — the actor is only knowable at write time —
  and are a different case from this one, which is still fixable now.

- [Gate 1A, PROMOTED — no longer backlog] `npm run db:generate` is unsafe: its
  snapshot baseline stops at `0048` while migrations run to `0062`, so it
  generates plausible destructive SQL against the production database.

  **Promoted out of this backlog to `docs/OPEN_DECISIONS.md` OD-012, blocking.**
  Migration-tooling hazards do not belong in UX debt — a backlog entry is read
  when someone goes looking, and this one has to be read before someone runs a
  command. It blocks authoring any new schema migration; it does not block
  Gate 1B analysis.

## V1.1 — retire the obsolete pin-writer category vocabulary (BV-013)

`src/lib/commercial-settings.ts:118-122` hardcodes `"Manufacturing"` and
`"Raw ingredients"` into the category set captured by every NEW commercial pin,
alongside whatever `markup_defaults` contains.

Since BV-013 neither is a Production pricing authority. New pins are already
correct — the set spreads `markup_defaults`, which now includes `Production` —
so these two are simply pinned and never read.

**Deliberately not removed in the BV-013 slice**, and the reason is the whole
point of the item: those two names are what makes a pin taken today
structurally comparable with the 26 that predate the migration. Removing them
would split the pin population into two shapes for no operational gain, and
anyone later diffing a new pin against an old one would meet that difference
with no explanation attached.

Retire when there is a reason to — a pin-schema change, or a forensic tool that
has to special-case the two shapes anyway. Not as tidying.

Related: `docs/validation/bv-013-production-markup-migration-trace.md`
Appendix A, Step 4 consumer trace. Edward's disposition 2026-08-18: retire
nothing; the authority outcome is already achieved because nothing on the
Production pricing path reads them.

## Settings copy — Markup Defaults impact preview names the wrong cost share

The inline impact preview closes with:

> *Estimated blended-margin shift on those drafts: +3.0 to +6.0 pts
> (approximate; assumes 20–40% **packaging** cost share)*

That caveat was written when every category the preview could edit was a
packaging authority. Since BV-013 it also renders for `Production`, where the
denominator is the production share of the cost stack, not the packaging share.

The number is not necessarily wrong — 20–40% may or may not be the right band
for production — but the sentence explains it with the wrong basis, which is
worse than an unexplained range: a reader who checks the reasoning finds a
denominator that does not apply and cannot tell whether the range was computed
correctly or merely labelled carelessly.

**Bounded repair, Settings copy only.** Either name the share per category, or
drop the parenthetical and let the range stand as approximate. Do not reopen
BV-013 for it — the authority, the rate and the propagation behaviour are all
settled and correct; this is the explanatory clause beside them.

Found in the BV-013 operator walk, 2026-08-18. Edward's disposition: bank as a
bounded Settings-copy repair.

## Finalize can look available while Send will refuse unresolved recovery

**Observed 2026-08-31**, on quote `2f29af72` (SPJ · Primary), during the
component-charge cost-recognition trace. Banked deliberately rather than folded
into that repair (#517), which is arithmetic and does not touch this.

The Quote surface rendered **Finalize quote** enabled, not disabled, with no
notice, on a quote carrying **four component charges whose recovery is
undecided**. The refusal is real and correct, but it lives server-side:
`quotes.ts:1883` throws

> "Recovery is undecided for N one-time charges: … Choose how each is recovered
> in Commercial Recovery before sending."

only once the operator has clicked and the action has run.

**Why this is worth fixing rather than tolerating.** The same button already
PREDICTS the below-floor refusal from the shared projection the gate uses, and
`finalize-quote-button.tsx` says why in its own header: a surface predicate that
substituted for the gate was a defect, and the button agrees with the gate
because "they read one evaluation". Unresolved recovery is the one refusal that
does not get that treatment, so an operator learns it after acting rather than
before — and the work it names is on a different surface, so the click is a
round trip to nowhere.

`resolveCustomerView` already returns `unplacedRecoveryCharges`, so the
prediction needs no new query and no second authority — the same list the gate
refuses on.

**Not decided here:** whether the right shape is a disabled button with a
`title`, or an enabled button plus the `UnresolvedCostsNotice` work-list the
UNRESOLVED_COSTS refusal already renders (`action-result.ts` calls that the one
refusal the UI must render "as a work list rather than a sentence"). The second
is probably better — it names the charges — but it is a design call.

Adjacent, same family: Pattern 47(f), a disabled operator control must
communicate why.
