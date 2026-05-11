# RI.7 state machine design pass

**Status:** Draft for PM review — decisions DEC-1 through DEC-7 each carry
recommendation + alternatives + reasoning. PM call needed on each before
RI.7 implementation kicks off.

**Companion doc:** `docs/ri7-brief-amendment.md` — subscopes marked
"subject to CR-SM" depend on decisions resolved here.

---

## 0. Frame

RI.7 surfaces (firm settings admin, markup defaults admin, audit log
read view per brief §3.10–3.12) are downstream of an unresolved
question: **the quote lifecycle state machine has gaps and
under-specified transition triggers.** Examples the build has stepped
around so far:

- Customer-accepted-but-not-yet-PM-marked is invisible. Today: customer
  emails "yes Tier 2"; PM hasn't clicked Mark-Accepted; quote.status is
  still `sent`. No surface signals the in-between state, no place
  records the customer signal.
- T&Cs / payment terms / lead time are stub-rendered in RI.6's customer
  view because we don't yet know whether they freeze at send or at
  accept (or never).
- Quote-number assignment trigger is unspecified (on create? on save?
  on send? on accept?). PMs need a stable customer-facing identifier
  before send — most likely on send, but not decided.
- PreparedBy contact derivation has its own un-signed-in-rep edge case
  with three options (RI.6 UX_BACKLOG).
- Mark-Accepted page derives four sub-states (good / bothGates /
  pending / locked) from runtime margin + scenario fields, not the
  status enum. The locked state at end-of-flow has no enum value
  capturing it cleanly.

This doc enumerates every surface that branches on quote state, names
the gaps, and proposes decisions that close them coherently.

---

## 1. Current state — what exists

### Enums

```ts
quoteStatus    = ["draft", "sent", "accepted", "superseded", "lost"]
scenarioStatus = ["active", "dropped", "accepted"]
acceptSource   = ["manual_button", "hubspot_stage_change", "api"]
scenarioDropReason = ["superseded_by_copy", "draft_at_accept",
                      "accept_sibling", "manual", "other"]
```

### Columns on `quotes` related to lifecycle

```
status              quote_status     NOT NULL DEFAULT 'draft'
scenario_status     scenario_status  NOT NULL DEFAULT 'active'
scenario_label      text             NOT NULL DEFAULT 'Primary'
version_number      integer          NOT NULL
sent_at             timestamptz      nullable
accepted_at         timestamptz      nullable
accepted_by_user_id uuid             FK → users; nullable
accepted_tier_id    uuid             FK → quote_tiers; nullable
accept_source       accept_source    nullable (set at accept)
drop_reason         scenario_drop_reason nullable (set on dropped)
dropped_by_user_id  uuid             FK → users; nullable
dropped_at          timestamptz      nullable
accepted_snapshot_json jsonb         nullable; locked baseline
valid_until         date             nullable; per-quote override
customer_facing_notes text           nullable; per-quote
```

### Transitions (existing, per SPEC §7)

```
Within a scenario:
  draft ──► sent ──► accepted ──► (locked)
    │        │
    │        ├──► superseded (PM edited a sent quote → new draft)
    │        └──► lost
    │
    └──► (deletable while still draft)

Across scenarios:
  scenarioStatus 'active' (many) → one becomes 'accepted' →
    others auto-flip to 'dropped' with drop_reason='accept_sibling'
```

### Existing write paths

| Transition | Action | Existing? |
|---|---|---|
| (none) → draft | `createQuote` | ✅ Slice 5 |
| draft → sent | NOT YET WIRED — Slice 11 PDF send | ❌ |
| sent → superseded (auto, on draft-of-sent) | NOT YET WIRED — Slice 15 copy | ❌ |
| sent → accepted | `markAccepted` | partial — Slice 12 finishes |
| sent → lost | NOT YET WIRED | ❌ |
| any → draft (manual revive) | EXPLICITLY NOT WIRED — out of scope | n/a |
| scenarioStatus 'active' → 'dropped' (sibling accept) | NOT YET WIRED — Slice 12 | ❌ |
| scenarioStatus 'active' → 'dropped' (draft at accept) | NOT YET WIRED — Slice 12 | ❌ |
| scenarioStatus 'active' → 'dropped' (manual drop) | NOT YET WIRED | ❌ |

---

## 2. Surfaces that branch on state

Enumeration of every UI surface that reads quote/scenario state, with
what it branches on today and what it would render in each state.
Source files cited for traceability.

### S-1 — Home / Deal organizer (`src/app/page.tsx`, project list)

Branches on per-project rollup of latest quote status across active
scenarios. Today renders "latest quote status" column + "lines
requiring review" rollup. Round 4 design (brief §3.1) calls for richer
state badges including override-pending and accepted-closed-won.

### S-2 — Project Detail (`src/app/projects/[id]/page.tsx`)

Three explicit next-action card states per Round 4 brief §3.2:
- **just-created** (no quotes yet)
- **override-pending** (a quote has a pending admin override request)
- **accepted-closed-won** (any quote in this project has been accepted)
- **default** (active multi-scenario — card hidden)

Scenario cards branch on `scenarioStatus` (active / dropped / accepted)
and version chains branch on `quote.status` per row (draft / sent /
accepted / superseded / lost).

### S-3 — Cost Build (`src/app/projects/[id]/quotes/[quoteId]/cost-build/page.tsx`)

Editability gate: `status === 'draft'` enables input affordances;
otherwise read-only. Guard enforced server-side via `requireDraft` in
`src/lib/quote-guards.ts`; UI hides controls proactively.

### S-4 — Costing Sheet (`src/app/projects/[id]/quotes/[quoteId]/costing/page.tsx`)

Same editability gate as S-3. Margin verdict band renders against
runtime state (`blendedMarginStatus`), not enum state. Buttons in
costing-page-head route to customer view (`/customer-view`) and
mark-accepted (`/mark-accepted`); affordances reflect status (Mark
Accepted disabled when not sent; Preview customer quote available
anytime).

### S-5 — Customer view (`src/components/customer-view/customer-view-host.tsx`)

Today: three sub-states (Pure / PassThrough / Partial) are R3-source
visual shapes driven by freight treatment + cell completeness — NOT
quote.status. The page itself ignores quote.status (renders for any
status).

State-machine touch points it inherits:
- `quote.sentAt` decides whether the customer view shows "Issued · ___"
  with a real date or a stub
- `quote.validUntil` derivation depends on send-date + days valid
- PreparedBy contact derivation depends on deal owner resolution
- T&Cs / payment terms / lead time / incoterms render as stubs today
  pending RI.7 wiring

### S-6 — Mark-Accepted (`src/app/projects/[id]/quotes/[quoteId]/mark-accepted/page.tsx`)

Today: four sub-states derived from `blendedMarginStatus` +
`scenarioStatus`:
- **good** — sent, healthy margins, normal accept flow
- **bothGates** — sent, BELOW_FLOOR or UNDERPRICED lines (override gate)
- **pending** — override approval pending (read-only)
- **locked** — already accepted (read-only post-flow)

The "locked" sub-state currently keys on `scenarioStatus === 'accepted'`
not on `quote.status === 'accepted'`. They normally agree, but
this is a latent divergence worth resolving (see DEC-5).

### S-7 — Admin (RI.7 surfaces)

- Firm settings (brief §3.10): re-band preview computes against
  `WHERE status = 'sent'` quotes
- Markup defaults (brief §3.11): recompute applies to `WHERE
  status = 'draft'` line items only; sent quotes frozen at send-time
  markup
- Audit log (brief §3.12): renders transitions chronologically

---

## 3. The customer-accepted-before-PM-marked gap

This is the most-load-bearing decision in this doc. Today's flow:

```
quote sent ──► customer emails "yes Tier 2" ──► (no system state) ──►
   PM clicks Mark-Accepted ──► quote.status = 'accepted'
```

The (no system state) gap matters because:

1. **PM workflow signal lost.** No surface shows "customer has
   responded, PM needs to mark." PMs forget; quotes sit in `sent` even
   though the deal is won.
2. **HubSpot writeback timing.** Customer-accept is the business event;
   Mark-Accepted is a separate UI action that triggers HubSpot writeback
   (Slice 12). The conflation means writeback fires only when PM remembers
   to click — not when the customer says yes.
3. **No audit record of customer signal.** Today, audit captures
   `accepted` transition (PM click) but not the customer's prior
   acceptance event. Forensic question "when did the customer say yes
   vs when did PM mark it" is unanswerable.
4. **Round 3 design implies it.** Mark-Accepted's "both gates" + accept
   confirmation modals presuppose a moment between sent and accepted
   where the PM is reconciling the customer's acceptance against margin
   verdicts. That moment has no enum value.

### DEC-1: How to model the gap

**Recommendation: Option B — separate field, not enum extension.**

**Option A — add `customer_accepted` enum value:**
```
quoteStatus = ["draft", "sent", "customer_accepted", "accepted",
               "superseded", "lost"]
```
Transitions:
- `sent → customer_accepted` (PM records customer signal; lightweight click)
- `customer_accepted → accepted` (PM completes Mark-Accepted flow, optionally with override gate)
- `sent → accepted` (skip the intermediate — customer-signal + PM-mark in one step)

Pro: clean state-per-row read; every state-dependent surface can switch
on enum literal. Con: introduces a transient state that is mostly a
process artifact; enum proliferation; the `sent → accepted` skip path
muddies the model.

**Option B — add `customer_accepted_at` + `customer_accepted_tier_id`
columns, keep enum at 5:**

```
ALTER TABLE quotes ADD COLUMN customer_accepted_at timestamptz;
ALTER TABLE quotes ADD COLUMN customer_accepted_tier_id uuid
  REFERENCES quote_tiers(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN customer_accepted_recorded_by_user_id uuid
  REFERENCES users(id) ON DELETE SET NULL;
```

`customer_accepted_at IS NOT NULL AND status = 'sent'` is the
in-between state. PM records via a lightweight "Customer accepted Tier
N" affordance on Costing Sheet or Project Detail; Mark-Accepted flow
then locks the row by setting `status='accepted'` and copying
`customer_accepted_tier_id` to `accepted_tier_id`.

Pro: enum stays at 5 (matches SPEC §7 diagram); the customer-signal
event is recorded as data (timestamp + who/which-tier) without
state-enum churn; existing `status === 'sent'` guards keep working;
the Mark-Accepted page's runtime sub-state derivation extends
naturally to include a "customer-accepted-awaiting-mark" sub-state.
Con: surfaces that want to badge "customer accepted but not marked"
have to join the boolean derivation themselves; the truth is in
columns, not the enum.

**Why Option B wins:** SPEC §7 explicitly diagrams the lifecycle as
five states. Customer-acceptance is an *event* (timestamped), not a
*phase* (durable enum value) — a quote can sit in
"customer-said-yes-but-PM-hasn't-clicked" indefinitely without
behaving differently from `sent` for editing/writeback/scope. Enum
values should be durable phases. The event vs phase distinction is the
load-bearing instinct here. Option A's transient `customer_accepted`
state would last hours-to-days in practice — modeling a process
artifact as a phase creates the same noise as encoding
"send_email_drafted_but_not_sent" or "review_in_progress" as states.

**Open PM question:** does PM ever want to mark "customer accepted"
without immediately completing Mark-Accepted? Three scenarios:
- (a) Yes, frequently — customer responds Friday, PM does mark-accepted
  Monday after override approval — strong Option B
- (b) Sometimes — short window between customer signal and
  PM-mark — either option works
- (c) No, always atomic — customer-signal triggers immediate
  Mark-Accepted flow — argues that the gap is a UX problem, not a
  state-machine problem, and the answer is a one-click flow without
  storing the intermediate

PM call needed. My read leans (a)–(b); the override-gate flow at
brief §3.8 design explicitly accommodates pauses.

### DEC-2: Where customer-accept is recorded

If DEC-1 = Option B, add an action `recordCustomerAcceptance({ quoteId,
acceptedTierId })`. UI affordance candidates:

- **Costing Sheet** — adjacent to "Mark accepted" button, a smaller
  "Customer responded · Tier N" toggle that captures the signal without
  finalizing
- **Project Detail scenario card** — per-version "Customer accepted"
  badge with click-to-record
- **Mark-Accepted page itself** — top of flow, "Has the customer
  confirmed? Record their signal before reviewing gates" affordance

**Recommendation: Costing Sheet adjacent to Mark Accepted** —
single-surface for the PM workflow ("I'm looking at the costing,
customer just emailed yes, I record + start mark-accepted from here").
Round 3 Mark-Accepted design already lives on its own surface; adding
the record-signal action to that flow's entry surface keeps the
"signal then mark" sequence physically adjacent.

### DEC-3: Audit shape for customer-accept

Audit action `customer_acceptance_recorded` with diff_json carrying
`{customer_accepted_tier_id, recorded_by_user_id, customer_email_ref}`
(the last being a free-text PM-entered reference like "email subject
'Re: Glow Bundle quote' 4/28" — optional; supports forensic
reconciliation).

If PM later clears the customer-accept (customer reverses, scope
changes), action `customer_acceptance_cleared` with `from: tier_id, to:
null`.

This sits alongside the existing `accepted` action (which captures the
final Mark-Accepted transition). Per the audit-source convention in
CLAUDE.md, the two are semantically different events (one records
customer signal; one finalizes PM accept) so they get distinct
`action` values, not one with `source` flag disambiguation.

---

## 4. Other state-machine decisions

### DEC-4: Quote-number assignment trigger

Today: `quoteNumber` is fixture-stubbed (`{quote-number-pending}`).
RI.7 wires it for real. The question: when does a quote acquire its
customer-facing number?

**Options:**
- (a) On create (every draft has a number from inception) — risks
  number proliferation if PMs make many speculative drafts
- (b) On save (first persisted version gets numbered) — same problem
- (c) On send (number assigned when PDF goes to customer) — number
  becomes a commitment to the customer; drafts don't have numbers
- (d) On accept (number assigned at acceptance) — too late; customer
  needs a reference number on the quote they're reviewing

**Recommendation: (c) on send.** Quote number is a customer-facing
identifier; it lands when the customer first sees it. Drafts before
send don't have numbers, which matches PM intuition ("until I send
it, it's just a draft"). When PM revises a sent quote, the new draft
gets the same quote_number with `version_number` incremented (already
tracked).

**Format:** Configurable prefix from firm_settings (`{prefix}-{counter}`
where counter is a per-firm monotonic integer). Default prefix: TBD per
PM call. Counter table or sequence in DB — implementation detail.

### DEC-5: scenario_status vs quote.status invariant on accept

Today: `markAccepted` action (Slice 12) is responsible for setting BOTH
`quote.status='accepted'` AND `scenario_status='accepted'` AND
auto-dropping sibling `scenario_status='active'` to `'dropped'` with
`drop_reason='accept_sibling'`. The action discipline is the only thing
enforcing the invariant that "if any quote in scenario X has
status='accepted', scenario_status of X is 'accepted'."

If anything bypasses the action layer (manual SQL, future Slice 12+
batched ops, HubSpot webhook v2), the invariant could drift.

**Decision: action-layer enforcement only for v1.** Add a
`scripts/verify/scenario-quote-status-invariant.ts` script to surface
drift; defer DB CHECK constraint until evidence of drift exists. (Same
posture as the `drop_reason ↔ scenario_status='dropped'` invariant
already in UX_BACKLOG.)

### DEC-6: Mark-Accepted page sub-state derivation post-DEC-1

If DEC-1 = Option B, the page's sub-state derivation extends to five:

```
locked        → quote.status === 'accepted'
pending       → quote has pending override request
bothGates     → quote.status === 'sent', BELOW_FLOOR or UNDERPRICED
awaitingMark  → quote.status === 'sent', customer_accepted_at NOT NULL,
                no override gate to clear
good          → quote.status === 'sent', healthy margins,
                no customer signal recorded yet
```

The `awaitingMark` sub-state renders the same components as `good`
plus a "Customer responded · Tier N · [date]" affirmation chip,
streamlining the PM's flow ("you don't need to verify margins again;
just confirm and mark").

Visual grammar: chip in the `--accent` register (matches existing
"customer responded" affordances elsewhere). No new visual vocabulary
needed — see §5 below.

### DEC-8: PreparedBy snapshot at send

**Decision: snapshot at send** (Edward, post-review of CR-SM v1).

**Correction during implementation (May 2026):** the brief amendment
v1 assumed phone was syncable from HubSpot's Owners API. **It's not.**
Verified against `@hubspot/api-client`'s `PublicOwner` schema —
fields are `firstName`, `lastName`, `email`, `id`, `userId`, `type`,
`teams`, `archived`, `createdAt`, `updatedAt`. No phone. (Phone would
live on the HubSpot Users API or on a linked contact record; both
hacky for v1 and not the canonical source.)

**Revised phone source: manual admin UI only.** `users.phone` is
populated via a new admin user-management surface (per-user inline
edit, audit-logged). For users with no manually-entered phone,
`prepared_by_phone_snapshot` is NULL at send time — PdfHeader
renders the phone line conditionally (omits when NULL). Customer
view stays valid without phone; email is the canonical contact.

Rationale: same as DEC-7. Customer-facing commitments shouldn't shift
under the customer. R3 design implies "Prepared by" is fixed-at-send.
If the sales rep is reassigned in HubSpot, leaves The DPS, or changes
phone numbers after send, the customer view rendering an already-sent
quote MUST keep showing the rep who sent it. Without a snapshot, live
resolution against `projects.salesRepUserId → users` would silently
update past sent quotes — wrong.

**Schema (add to quotes):**
```sql
ALTER TABLE quotes ADD COLUMN prepared_by_name_snapshot text;
ALTER TABLE quotes ADD COLUMN prepared_by_email_snapshot text;
ALTER TABLE quotes ADD COLUMN prepared_by_phone_snapshot text;
```

**Read path:**
- `quote.status === 'draft'` → render live `getQuotePreparedBy(quoteId)`
  resolution (projects.salesRepUserId → users join + HubSpot fallback
  for un-signed-in-rep)
- `quote.status === 'sent' | 'accepted' | 'superseded' | 'lost'` →
  render `prepared_by_*_snapshot` directly

**Write path:** `sendQuote` resolves the live PreparedBy (one shot,
not cached) and writes the three snapshot columns into the quote row
alongside the other DEC-7 send-time snapshots.

**Refines §3.10.h of the brief amendment.** Under DEC-8, the
un-signed-in-rep edge case is a SEND-time problem, not a render-time
problem. The PDF render path reads the snapshot directly; HubSpot is
only hit at send. CC's brief-amendment recommendation (option (a)
render-time HubSpot fetch with TTL cache) updates to: **one-shot
HubSpot fetch at send, no TTL cache needed** — see the refined
§3.10.h in `docs/ri7-brief-amendment.md`.

**Audit:** action `prepared_by_snapshotted` fires from `sendQuote`
inside the same DB transaction as the snapshot writes; `diff_json`
carries `{ name, email, phone, derived_from: "users.id" | "hubspot_owner_id" }`.
The `derived_from` discriminator lets future forensic queries
distinguish "snapshot was based on a Nexus-resolved user record" vs
"snapshot was based on a HubSpot one-shot fetch because the rep
hadn't signed in yet" — useful when a customer disputes the contact
they were quoted under.

### DEC-7: T&Cs / payment terms / lead time / incoterms freeze rules

Today: these are stubs in RI.6 customer view. RI.7 wires them to real
data. The question: do they freeze at any state transition?

**Options:**
- (a) Always read firm-settings live (any update propagates to past
  sent quotes, even after accept) — wrong; breaks the snapshot
  baseline contract
- (b) Snapshot on send (sent quote freezes a copy; per-quote override
  also freezes) — matches existing markup-default snapshot pattern
  for sent quotes
- (c) Snapshot on accept only — drift between sent + accepted is
  visible; PM-friendly but customer-confusing

**Recommendation: (b) snapshot on send.** Matches the existing
"frozen at send" discipline already established for line item markup
(`markup_pct_source` history). Schema:

```
ALTER TABLE quotes ADD COLUMN payment_terms_snapshot text;   -- nullable
ALTER TABLE quotes ADD COLUMN lead_time_snapshot text;
ALTER TABLE quotes ADD COLUMN incoterms_snapshot text;
ALTER TABLE quotes ADD COLUMN tcs_snapshot text;
ALTER TABLE quotes ADD COLUMN days_valid_snapshot integer;
```

Send-action body: read current firm_settings, snapshot into the
quote row, compute `valid_until = sent_at + days_valid_snapshot
days`. Drafts read firm_settings live (preview); sent reads its
own snapshot.

Per-quote overrides (PM customizes payment terms for this customer)
write to the snapshot columns directly — overrides ARE the snapshot
once set.

---

## 5. Visual-grammar gap analysis

For the CD R7 ask question. Each new state from this CR needs to
render somewhere; checking each against existing R3/R6/R2 design
vocabulary:

| State / signal | Where renders | Existing register? | New grammar? |
|---|---|---|---|
| `customer_accepted_at` chip on Costing Sheet | adjacent to Mark Accepted button | `--accent` chip (existing) | ❌ no |
| "Customer responded · Tier N" affirmation on Mark-Accepted | top of mark-accepted-good sub-state | green tick / success register (existing R3) | ❌ no |
| `awaitingMark` sub-state of Mark-Accepted | full page | extends `good` with affirmation chip | ❌ no |
| Quote-number badge on customer view | PdfHeader doc-meta block | already designed in R3 (currently stub) | ❌ no |
| Quote-number on Project Detail scenario card version row | version badge | R3 already has version badge | ❌ no |
| T&Cs snapshot diff badge on customer view | PdfTerms | none — but PM-internal context, customer view doesn't show diff | ❌ no |
| Payment-terms-snapshot lock indicator (admin: "this firm setting affects N sent quotes") | firm-settings re-band-preview equivalent | R5 has portfolio-effect strip; extend | ❌ no |
| PreparedBy snapshot rendering (sent) vs live (draft) on customer view | PdfHeader already designed in R3; snapshot vs live is invisible to render | ❌ no |
| Audit log entries for new actions (`customer_acceptance_recorded`, `customer_acceptance_cleared`, `prepared_by_snapshotted`, `firm_settings_updated` with new diff_json shapes) | brief §3.12 action chip + structured diff table pattern | ❌ no |

**Verdict: zero new visual grammar needed.** Existing R3/R5/R6
registers cover every new state/signal this CR introduces.

**CD R7 ask: NOT NEEDED for state machine.** All state-conditional
rendering uses existing design vocabulary.

(Visual-grammar gaps for the brief-amendment scope — admin UI for new
firm_settings columns — are evaluated separately in
`docs/ri7-brief-amendment.md` §6.)

---

## 6. Decisions resolved (post-Edward review, May 2026)

All eight decisions endorsed. Recommendations stand.

- **DEC-1 — Option B (event-not-phase), 3 columns.** Edward confirms
  PMs DO record customer-accept without immediately doing
  Mark-Accepted (yes/sometimes), which unlocks Option B.
- **DEC-2 — Costing Sheet adjacent to Mark Accepted button.**
  Workflow proximity. Project Detail card is workable but more clicks;
  Mark-Accepted page is wrong surface (that's finalization,
  not signal-capture).
- **DEC-3 — Distinct actions:** `customer_acceptance_recorded` and
  `customer_acceptance_cleared`. Matches the audit-source convention
  in CLAUDE.md — semantically distinct events get distinct action
  values, not one with `source` flag disambiguation.
- **DEC-4 — On-send.** Quote number is customer-facing identifier;
  lands when customer first sees it. Drafts pre-send don't have
  numbers — matches PM intuition.
  - **DPS prefix: `DPS`.** First quote reads `DPS-1000`.
  - **Single-tenant v1 assumption — explicit.** `CREATE SEQUENCE
    quote_number_seq` is a global counter. Breaks if Nexus ever goes
    multi-tenant (different firms would share + race the same
    counter). When multi-tenant becomes real, replace with per-firm
    counter scoped by `firm_id` (e.g., per-firm sequence keyed by
    firm_settings row, or a `(firm_id, next_quote_number)` table
    with row-level locking). Logged in UX_BACKLOG.
- **DEC-5 — Action-layer enforcement + verifier script.** Defense in
  depth. Same posture as the `drop_reason ↔ scenario_status='dropped'`
  invariant pattern already in UX_BACKLOG.
- **DEC-6 — Extend `good` sub-state with affirmation chip.** Avoids
  component-count growth. Chip in `--accent` register adjacent to
  existing mark-accepted-good layout.
- **DEC-7 — Snapshot-on-send.** Matches existing markup-default
  snapshot pattern. Customer-facing commitments shouldn't shift under
  the customer.
- **DEC-8 — PreparedBy snapshot at send (NEW).** Same rationale as
  DEC-7. Without snapshot, if rep is reassigned / leaves / phone
  changes after send, customer view shows new rep — wrong. R3 implies
  fixed-at-send. Three columns added; refines brief amendment §3.10.h
  un-signed-in-rep edge case from render-time to send-time fetch.

## 6.1 Audit log read-view rendering scope (confirmation)

Brief §3.12 (audit log read view) renders chronological entries with
action chips + structured diff tables. The new audit actions this CR
introduces MUST be rendered by the read view, not just stored:

- `customer_acceptance_recorded` — action chip; diff_json shape:
  `{ customer_accepted_tier_id, recorded_by_user_id, email_ref? }`.
  Renderer surfaces "Customer accepted Tier N · recorded by [user]
  · email ref: [string|—]".
- `customer_acceptance_cleared` — action chip; diff_json shape:
  `{ from: tier_id, to: null }`. Renderer surfaces "Cleared customer
  acceptance · was Tier N".
- `prepared_by_snapshotted` — fires inside sendQuote; diff_json
  shape: `{ name, email, phone, derived_from: "users.id" |
  "hubspot_owner_id" }`. Renderer surfaces "PreparedBy snapshotted at
  send · [name] · resolved from [Nexus user|HubSpot one-shot]".
- `firm_settings_updated` — existing action; new diff_json shapes
  for vendor identity / customer-facing defaults sub-edits. Renderer
  inherits existing per-column diff display; new column names render
  per standard pattern (vendor_name / vendor_tagline /
  vendor_address / quote_number_prefix / tcs_default /
  payment_terms_default / lead_time_default / incoterms_default /
  days_valid_default).

Action-renderer pattern (mapping action enum → render function +
chip color) lives in the audit-log-read-view component family; brief
§3.12 has the existing pattern. RI.7 implementation extends the map
with the four entries above.

---

## 7. Implementation summary

All recommendations endorsed. RI.7 adds:

### Schema (migration)

```sql
-- DEC-1: customer-acceptance event recording (3 columns)
ALTER TABLE quotes ADD COLUMN customer_accepted_at timestamptz;
ALTER TABLE quotes ADD COLUMN customer_accepted_tier_id uuid
  REFERENCES quote_tiers(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN customer_accepted_recorded_by_user_id uuid
  REFERENCES users(id) ON DELETE SET NULL;

-- DEC-7: send-time snapshots (5 columns)
ALTER TABLE quotes ADD COLUMN payment_terms_snapshot text;
ALTER TABLE quotes ADD COLUMN lead_time_snapshot text;
ALTER TABLE quotes ADD COLUMN incoterms_snapshot text;
ALTER TABLE quotes ADD COLUMN tcs_snapshot text;
ALTER TABLE quotes ADD COLUMN days_valid_snapshot integer;

-- DEC-8: PreparedBy send-time snapshot (3 columns)
ALTER TABLE quotes ADD COLUMN prepared_by_name_snapshot text;
ALTER TABLE quotes ADD COLUMN prepared_by_email_snapshot text;
ALTER TABLE quotes ADD COLUMN prepared_by_phone_snapshot text;

-- DEC-4: quote-number assignment (1 column + counter)
ALTER TABLE quotes ADD COLUMN quote_number text;  -- nullable until send
CREATE SEQUENCE quote_number_seq START 1000;
-- Single-tenant v1 assumption: ONE global counter for The DPS. When
-- multi-tenant lands, replace with per-firm scoping (per-firm sequence
-- or `(firm_id, next_quote_number)` table). Logged in UX_BACKLOG.
-- prefix lives in firm_settings (see brief amendment)
```

### Actions

- `recordCustomerAcceptance({ quoteId, acceptedTierId, emailRef? })`
- `clearCustomerAcceptance({ quoteId })`
- `sendQuote({ quoteId })` — assigns quote_number, snapshots
  firm_settings commercial fields (DEC-7), and snapshots PreparedBy
  contact via one-shot resolution + HubSpot fallback (DEC-8) onto the
  quote row. Single transaction.
- `markAccepted({ quoteId, tierId })` — extends existing; promotes
  customer-acceptance fields to accepted_* fields

### Surfaces extended

- Costing Sheet: "Customer responded · Tier N" toggle adjacent to
  Mark Accepted
- Mark-Accepted: fifth sub-state `awaitingMark` derivation
- Customer view PdfHeader: real quote_number when sent (drops `.pdf-stub`)
- Customer view PdfTerms: real payment_terms / lead_time / incoterms /
  valid_until when sent (drops all `.pdf-stub`)
- Project Detail: scenario card version badges show real quote_number

### Verification

- `scripts/verify/scenario-quote-status-invariant.ts` — surfaces drift
  on `scenario_status='accepted'` ↔ at-least-one-quote-accepted

---

## 8. Decisions — all resolved

- [x] DEC-1 — Option B (event-not-phase), 3 columns
- [x] DEC-2 — Costing Sheet adjacent to Mark Accepted
- [x] DEC-3 — Distinct actions
- [x] DEC-4 — On-send; DPS prefix `DPS`; single-tenant v1 explicit
- [x] DEC-5 — Action-layer + verifier script
- [x] DEC-6 — Extend `good` sub-state with affirmation chip
- [x] DEC-7 — Snapshot-on-send for T&Cs / payment terms / lead time /
      incoterms / days_valid
- [x] DEC-8 — PreparedBy snapshot at send (3 columns); refines
      §3.10.h un-signed-in-rep to send-time fetch

RI.7 implementation ready to kick off once `docs/ri7-brief-amendment.md`
PM answers are also recorded (Edward provided §5.1–§5.7; §5.2 T&Cs
canonical text is the one open dependency — flagged as potential
kickoff blocker).
