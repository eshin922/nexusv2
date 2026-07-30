# slice-mark-accepted — §0.5 Pattern 22 pre-approval verification findings

**Brief set:** v1 (`cc-comm-mark-accepted-netsuite-so-push-brief.md`)
+ v2 amendments (`cc-comm-mark-accepted-brief-v2-amendments.md`)
+ v3 amendments (`cc-comm-mark-accepted-brief-v3-amendments.md`)
**Status:** Pre-approval verification per Pattern 22 standing
protocol — surface BEFORE Edward + CA approve the brief, not after.
**Date:** 2026-06-17
**Slice cumulative §0.5 catches running total (post PR #54):** 50
across 12 slices.

This document lists every §0.5 catch surfaced during pre-approval
verification of the combined brief set. Each catch carries a
proposed disposition; final disposition belongs to Edward + CA.
Numbered catches **#A1..#A11** (avoiding renumber pressure on the
cumulative ledger; promoted to numbered ledger entries on Edward
+ CA disposition).

---

## §1 · Headline finding — current schema already carries the brief's "ADD COLUMN" set

The brief proposes adding `accepted_at`, `accepted_by_user_id`,
`accepted_tier_id`, plus a few neighbors. **All three columns
already exist** in production schema (`schema.ts:268-280`), added
during Slice RI.7's state-machine work (CR-SM). Plus `acceptSource`
enum + `accepted_snapshot_json` jsonb column + `customer_accepted_*`
neighbors exist already.

The slice scope is **finishing the Slice RI.7 stubbed
mark-accepted action** + writebacks + cutover — NOT a greenfield
acceptance schema add. The §3 schema migration shrinks dramatically;
the action-layer + integration work is unchanged.

This is a structural shift in the slice. The remaining §0.5
findings below all hang off this reframing.

---

## §2 · Catches surfaced

### Catch #A1 — `quotes.{accepted_at, accepted_by_user_id, accepted_tier_id}` ALREADY EXIST

**v1 §3 + v2 Amendment 3 propose:**
```sql
ALTER TABLE quotes
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN accepted_by_user_id uuid REFERENCES users(id),
  ADD COLUMN accepted_tier_id uuid REFERENCES quote_tiers(id),
  ...
```

**Reality** (`schema.ts:268-280`):
```ts
acceptedAt: timestamp("accepted_at", { withTimezone: true }),
acceptedByUserId: uuid("accepted_by_user_id").references(...),
acceptedTierId: uuid("accepted_tier_id").references(...),
```

Already exist (Slice RI.7 state-machine prep).

**Disposition (proposed):** drop these three ADD COLUMN statements
from the §3 migration. Brief is otherwise correct — the action
layer is what's missing.

---

### Catch #A2 — `quoteStatus` enum already includes `'accepted'`; `frozen` BOOL is duplicative

**Brief §3 proposes:** new `frozen` BOOL DEFAULT false on `quotes`.

**Reality** (`schema.ts:41-47`):
```ts
export const quoteStatus = pgEnum("quote_status", [
  "draft", "sent", "accepted", "superseded", "lost",
]);
```

`quote.status = 'accepted'` IS the frozen state. The slice's
`markQuoteAccepted` action would naturally set `status = 'accepted'`
+ the accepted_* columns. Existing edit paths already gate on
`status === 'draft'` (per PR #54 pricing page convention).

**Disposition (proposed):** drop `frozen` BOOL from §3 migration.
Use `status = 'accepted'` as the canonical frozen-state signal.
Existing convention already in production. Saves a column + a
parallel-state-derivation surface (Pattern 22 §3 source-of-truth
extension — `status` is the canonical truth; no parallel `frozen`
flag needs maintaining in lockstep).

If a future use case needs to distinguish "accepted but
not-yet-frozen" (e.g., async push-in-progress window), introduce
`netsuite_so_push_status = 'pending'` per Amendment 3 — that's the
right surface for the temporal sub-state.

---

### Catch #A3 — `acceptSource` enum exists; the brief's manual_button is already the value

**Reality** (`schema.ts:55-59`):
```ts
export const acceptSource = pgEnum("accept_source", [
  "manual_button", "hubspot_stage_change", "api",
]);
```

Brief doesn't mention this column explicitly but talks about who
initiates the action. The action writes `accept_source =
'manual_button'` for the Nexus Mark Accepted CTA path.

**Disposition (proposed):** action writes `accept_source =
'manual_button'`. Banked here so future readers know the column
exists + is part of the canonical authoring trail. Pattern 28
copy-from-existing-vocabulary preserved.

---

### Catch #A4 — `accepted_snapshot_json` jsonb column ALREADY EXISTS on `quotes`

**Reality** (`schema.ts:298`):
```ts
acceptedSnapshotJson: jsonb("accepted_snapshot_json"),
```

Added speculatively during Slice RI.7. Zero current writers
(grep on `acceptedSnapshotJson` returns no action-layer hits).

The brief's `production_recipes` table + `snapshot_json` field
overlaps in concept. Two paths:

**Option (a) — Drop `accepted_snapshot_json` column** in the §3
migration. Production_recipes is the canonical lifecycle entity
(per brief §3 justification: lifecycle states, v1.1+ consumer
queries). Saves an unused column.

**Option (b) — Keep `accepted_snapshot_json`** as a denormalized
inline copy for quote-level read-paths (e.g., Quote umbrella
header doesn't need to join production_recipes to render the
accepted state). Production_recipes is the authoritative entity;
the inline column is a cache.

**Disposition ask:** Edward + CA. CA lean per brief §3 justification:
(a) — drop the speculative column; production_recipes is the
canonical entity; v1.1+ consumers query the table. Inline column
re-creates a redundancy that v1.1+ CM packet + reconciliation
work would have to keep in sync.

---

### Catch #A5 — `quotes` is NOT versioned; brief's "versioned-table carry-forward" comment is incorrect

**v1 §3 says:**
> Versioned-table carry-forward audit: `quotes` is versioned. CC
> extends the `versionedQuotesUpdate` helper (or equivalent) to
> carry all new columns forward.

**Reality:** `quotes` has NO `effective_from` / `effective_until`
columns. Only `firm_settings` (`schema.ts:714-715`) and
`leaf_specs` (`schema.ts:1860`) carry the versioned-table pattern.
No `versionedQuotesUpdate` helper exists or could exist —
`quotes` is a straight mutable table with cascade-aware audit
discipline (Pattern from `quote_skus`).

**Disposition (proposed):** strike the versioned-table sentence
from v1 §3. Quotes use straight `UPDATE` semantics; audit
discipline is via `audit_log` rows with `caused_by_audit_id`
cascade pattern (per Catch #A6 below). Versioned-table
carry-forward pattern (Pattern from Slice RI.7) does NOT apply.

---

### Catch #A6 — `audit_log.caused_by_audit_id` exists ✓ (no catch, confirmation)

**Reality** (`schema.ts:1224`):
```ts
causedByAuditId: uuid("caused_by_audit_id").references(
  (): AnyPgColumn => auditLog.id, ...
),
```

Cascade audit pattern fully supported. Brief §7 audit chain works
as designed. **No change required.**

---

### Catch #A7 — Mark-Accepted UI ROUTE EXISTS as peer surface (`/mark-accepted/`); brief assumes Quote umbrella sub-tab

**v1 §5 says:**
> Quote umbrella canon (post-canon-revision May 2026) places Mark
> Accepted as a Quote sub-tab affordance. Per PR #54 Step 8
> tear-down, Pricing surface no longer carries this affordance;
> it lives on Quote umbrella.

**Reality:**
- `src/app/projects/[id]/quotes/[quoteId]/mark-accepted/page.tsx`
  exists (Slice RI.6 visual shell + sub-state switcher)
- `src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx` exists
  as the Customer View / PDF preview surface (NOT yet structured
  as the 4-sub-tab umbrella)
- Quote umbrella structure (Preview Quote · Send to Client · Mark
  Accepted · Tier Selection sub-tabs) per CLAUDE.md canon revision
  is the FUTURE IA — **not yet implemented**

**Scope question:** is this slice ALSO restructuring the Quote
surface into the 4-sub-tab umbrella, OR does it ship against the
existing `/mark-accepted/` peer surface and bank the Quote umbrella
restructure as a separate slice?

**CLAUDE.md v1 path item 4:** "Quote umbrella + NetSuite
finalization (combined slice)". Suggests the answer is "combined,
this slice ships both."

If "combined" → slice scope at least doubles. Brief's §5 + §15
slice plan don't account for the IA restructure work. v1 §15
suggests 8-step structure; combined slice probably needs ~12-14
steps.

If "separate" → brief §5 needs amendment to mount against
`/mark-accepted/` peer surface (Slice RI.6 visual shell) instead
of Quote umbrella sub-tab.

**Disposition ask:** Edward + CA. The scope answer reshapes the
entire slice plan.

---

### Catch #A8 — Brief assumes "PR #50 HubSpot client" supports deal-stage advancement; method DOES NOT EXIST yet

**v1 §6 says:**
> Use existing HubSpot client infrastructure from PR #50. Server
> action:
> ```typescript
> await hubspotClient.deals.update(deal.id, {
>   properties: { dealstage: 'Purchase Order' }
> });
> ```

**Reality** (`src/lib/hubspot.ts` exports):
- ✓ `getReadClient`, `getWriteClient` (token-aware client factory
  per CLAUDE.md token model)
- ✓ Owner queries, company queries, product CRUD
- ✗ NO `updateDeal`, `setDealStage`, `advanceDealStage`, or
  `deals.update` helper exists

PR #50 added the `HUBSPOT_WRITE_ACCESS_TOKEN` infrastructure
and Products-domain write paths (createProduct, etc.) — NOT
deal writeback methods. The deal-stage advance method needs
to be authored as part of Slice 12.

**Disposition (proposed):** add `advanceDealStage(dealId,
stageId)` to `src/lib/hubspot.ts` as part of the slice's HubSpot
writeback work. Brief §6 paragraph "Use existing HubSpot client
infrastructure from PR #50" updates to "extend HubSpot client
with deal-stage writeback path." Action implementation per
v2 Amendment 3 status model (`hubspot_stage_status` enum).
Add to the 4 implementation gates in v2 Amendment 9.

---

### Catch #A9 — No background-job infrastructure in codebase; v1 §4 `pushQuoteToNetSuite` "async" path needs Step 1 mechanism resolution

**v1 §4 says:**
> Enqueue async `pushQuoteToNetSuite(quoteId)` (via existing async
> pattern in codebase — TBD specific mechanism with CC)

**Reality:** grep on `background`, `setImmediate`, queue
abstractions, after-hooks — no existing async-job infrastructure.
Codebase is Next.js 15 server actions + revalidatePath synchronous-
first. Vercel function timeout is ~10s for hobby tier; longer for
paid plans. NetSuite RESTlet round-trip could easily exceed.

**Three options surface:**

(a) **Synchronous push** — block the markQuoteAccepted action on
NetSuite RESTlet response. Simpler but exposes PMs to NetSuite
latency / timeout. Two failure modes: total push fails → quote
isn't accepted (rollback); NetSuite slow → action times out.

(b) **Vercel function with manual polling** — markQuoteAccepted
returns immediately; PM polls (Quote umbrella refreshes status
periodically until `netsuite_so_push_status = 'succeeded'` /
`'failed'`). UI complexity grows.

(c) **Defer to a job queue (Upstash QStash, Inngest, similar)** —
proper async; introduces a new infra dependency for v1.

**Disposition ask:** Edward + CA + CC iterate. CA lean (mentioned
in §14 Q4): optimistic toast pattern. That's UX-level; doesn't
resolve the underlying mechanism. **CC propose:** synchronous push
v1; PM accepts NetSuite latency tradeoff; if it becomes a
problem, switch to queue v1.1+. Simpler error semantics + no new
infra dependency.

---

### Catch #A10 — users.canCreateLeaves pattern exists; brief's `can_mark_accepted` follows ✓ (no catch, confirmation)

**Reality** (`schema.ts:208-209`):
```ts
canEditSpecs: boolean("can_edit_specs").notNull().default(false),
canCreateLeaves: boolean("can_create_leaves").notNull().default(false),
```

Brief §5 / v1 §12 TBD #6 proposes `can_mark_accepted` per same
pattern. Pattern is consistent. **No change required**, just
note: action-layer guard via spec-permission-guard.ts-style
helper, NOT Postgres RLS (per Phase A.1 v2 Architect §0.5 Gate 5
disposition Path B).

Permission gate question (Edward TBD): does Mark Accepted require
`can_mark_accepted = true`, OR is `users.role = 'pm' OR
users.role = 'admin'` sufficient gating? Existing pattern
(`canCreateLeaves`) suggests boolean flag is the right shape.
Banked for Edward Step 1 disposition.

---

### Catch #A11 — `customer_accepted_*` columns are the customer-signal capture (DEC-1); brief's `accepted_*` columns are gate-finalization. State machine pattern already exists

**Reality** (`schema.ts:344-353` + `actions/quotes.ts:3003-3070`):
- `recordCustomerAcceptance(quoteId, tierId)` action — writes
  `customer_accepted_at` + `customer_accepted_tier_id` +
  `customer_accepted_recorded_by_user_id`. Quote status stays
  `'sent'`.
- Brief proposes `markQuoteAccepted(quoteId, tierId, userId)`
  action — would write `accepted_at` + `accepted_by_user_id` +
  `accepted_tier_id` + `status = 'accepted'` + accept_source +
  `accepted_snapshot_json` (or production_recipes per #A4
  disposition).

Two distinct events, already modeled in schema:
1. **Customer signal recorded** (DEC-1) → `customer_accepted_*`
   fields set; quote.status stays `'sent'`. Sub-state =
   `awaitingMark`.
2. **PM finalizes via Mark-Accepted action** → `accepted_*`
   fields set; quote.status moves to `'accepted'`. Sub-state =
   `locked`.

**Disposition (proposed):** brief explicitly distinguish the
two events. Mark Accepted is event #2 (the finalization gate).
Quote.customerAcceptedAt is the prerequisite (PM must record
customer signal first via existing recordCustomerAcceptance,
THEN finalize via Mark Accepted). This aligns with Slice RI.7
state machine + existing UI sub-states.

Implication for §5 UI flow: AcceptedTierPickerModal Step 1 may
not be needed — `customer_accepted_tier_id` is already captured.
The Mark-Accepted CTA inherits the tier from
`customer_accepted_tier_id`. PM still confirms via
AcceptanceConfirmationModal but doesn't re-pick.

---

## §3 · Schema-mismatch summary table

| Brief §3 proposal | Reality | Disposition |
|---|---|---|
| ADD COLUMN `accepted_at` | EXISTS | Drop ADD |
| ADD COLUMN `accepted_by_user_id` | EXISTS | Drop ADD |
| ADD COLUMN `accepted_tier_id` | EXISTS | Drop ADD |
| ADD COLUMN `frozen` BOOL | `quoteStatus='accepted'` covers | Drop ADD; use status |
| ADD COLUMN `netsuite_so_id` text | NOT present | Add |
| ADD COLUMN `netsuite_so_pushed_at` | NOT present | Add |
| ADD COLUMN `netsuite_so_push_status` | NOT present | Add (per v2 Amendment 3 enum) |
| ADD COLUMN `netsuite_so_push_error` | NOT present | Add |
| ADD COLUMN `netsuite_so_id_source` | NOT present | Add (v2 #4) |
| ADD COLUMN `manual_so_validated_at` | NOT present | Add (v2 #4) |
| ADD COLUMN `manual_so_reason` | NOT present | Add (v2 #4) |
| ADD COLUMN `hubspot_stage_status` | NOT present | Add (v2 #3) |
| ADD COLUMN `hubspot_stage_advanced_at` | EXISTS as `hubspot_deal_stage_advanced_at`? | Confirm naming alignment |
| ADD COLUMN `hubspot_stage_error` | NOT present | Add |
| Versioned-table carry-forward | NOT VERSIONED | Strike paragraph |
| `accepted_snapshot_json` deprecation | EXISTS unused | Catch #A4 dispose |
| NEW TABLE `production_recipes` | NOT present | Add ✓ |

Migration shrinks from 17+ column ADDs to ~10. Existing
column coverage is much wider than v1 brief anticipated.

---

## §4 · v2 Amendment §0.5 additions covered

v2 §13 §0.5 extensions:

| Extension | Status |
|---|---|
| Verify `quotes.version_number` behavior | Catch #11 from PR #54 ledger covered this; column is NOT NULL no default, fixture seeders need explicit value=1. Confirmed during PSR fixture work. |
| Async pattern for separate HubSpot vs NetSuite status tracking | Catch #A9 — no infra exists; disposition needed. v2 Amendment 3's two enums (netsuite_so_push_status + hubspot_stage_status) is the right schema shape regardless. |
| HubSpot client supports stage advancement | Catch #A8 — does NOT yet; method needs authoring. |
| Sandbox environment access for SV phase | External coordination (Edward + DPS NetSuite admin + Aisha). Not CC-verifiable; banked as Step 1 owner item. |

---

## §5 · Recommendations for brief amendment

CC recommends:

1. **§3 migration shrinks** — drop the 4 already-existing column
   ADDs (accepted_at + accepted_by + accepted_tier_id + frozen).
   Update remaining ADD list to only the NetSuite + HubSpot
   status-tracking columns (~10 columns).

2. **Strike versioned-table carry-forward sentence** in v1 §3.
   Replace with: "Quotes use straight UPDATE semantics; audit
   discipline via audit_log rows + caused_by_audit_id cascade."

3. **§5 UI flow simplification** — AcceptedTierPickerModal may
   become unnecessary if `customer_accepted_tier_id` is the
   inherited tier. Confirm with CD + Edward whether PM still
   re-picks (for safety) or inherits from customer-signal step.

4. **Catch #A7 scope question** — Edward + CA disposition needed
   on whether slice ALSO restructures `/quote/` into Quote umbrella
   4-sub-tab IA (combined slice per CLAUDE.md v1 path item 4),
   or ships against existing `/mark-accepted/` peer surface +
   banks Quote umbrella restructure as separate slice.

5. **Catch #A8 add to Amendment 9 gates** — HubSpot client deal-
   stage advancement method authoring becomes a 5th implementation
   gate alongside identity mapping / RESTlet contract / idempotency
   / sandbox validation.

6. **Catch #A9 async mechanism disposition** — Edward + CA pick
   synchronous push v1 (CC lean) vs Vercel function polling vs
   job queue. Shape of error UX surfaces from this disposition.

7. **§4 + §5 reconcile against existing state machine** — the
   recordCustomerAcceptance + Mark Accepted distinction is
   load-bearing. Brief explicitly names the two events. UI flow
   adjusts accordingly.

---

## §6 · Catches ALREADY confirmed (no action needed)

- `audit_log.caused_by_audit_id` cascade chain (Catch #A6) ✓
- `users.canCreateLeaves` permission-flag pattern (Catch #A10) ✓
- `quoteStatus` enum already includes `'accepted'` value
  (covered in Catch #A2)
- `acceptSource` enum already exists with manual_button value
  (Catch #A3) ✓

---

## §7 · Pre-build verification gates extension

Per v2 Amendment 9, the 4 implementation gates that must close
before Step 2 schema work. CC proposes 5th gate:

| # | Gate | Owner | Status |
|---|---|---|---|
| 1 | Identity mapping payload contract | CC + Aisha + Edward | Step 1 |
| 2 | RESTlet contract specifics | CC + Aisha + Edward | Step 1 |
| 3 | Idempotency mechanism (custbody_nexus_quote_id) | CC + Aisha + Edward | Step 1 |
| 4 | Sandbox validation phase | Edward + DPS NetSuite admin + Aisha | Step 1 |
| **5 NEW** | **HubSpot client deal-stage advancement method authored** | **CC** | **Step 1 / Step 5** |

Gate 5 is CC-scope; can land during Step 5 (per v1 §15 slice plan).
Surfacing here so it's not forgotten + so HubSpot stage
advancement isn't accidentally banked v1.1+ because "PR #50
already has this" (it doesn't).

---

## §8 · Status

**Architecture approved per v2 Amendment 9** — Step 1 kickoff
unblocked after these §0.5 catches dispose.

**Brief amendments needed before Step 2 schema work:**
1. §3 column-list shrink per Catch #A1, #A2, #A3, #A4, #A5
2. §5 UI flow note re: customer_accepted_tier_id inheritance
3. §6 HubSpot client work scoped per Catch #A8
4. v2 Amendment 9 gate list extended per Catch #A11 + §7 (5th gate)
5. §4 async mechanism disposition per Catch #A9

**No new BLOCKER-class catches surfaced.** All findings are
schema-mismatch (existing-column-overlap) or scope-clarification
(Quote umbrella sub-tab vs peer surface, async mechanism choice).

Ready for Edward + CA disposition pass.

---

**Slice §0.5 catch count contributed this round: 11 (#A1..#A11).**
Promote to numbered ledger entries on disposition.

**Cumulative §0.5 across slices post-disposition:** 50 + 11 = 61
across 13 slices.

Per Pattern 22 standing protocol — these are ALL surfaced
pre-approval. Mid-build escalation cost prevented:
- Catch #A1 alone: ~half-day rework + migration revert. Brief
  approval would have unblocked an unnecessary migration.
- Catch #A5 alone: full implementation cycle wasted authoring a
  helper that can't exist (table isn't versioned).
- Catch #A7 scope question: weeks of rework if discovered
  mid-slice that Quote umbrella sub-tab IA needs to ship alongside.

Pattern paying for itself again.

---

## §9 · v3 amendments cross-reference

v3 amendments arrived after this findings doc. Reconciling §0.5
catches against v3 content below.

### Catches resolved by v3

- **Catch #A9 async mechanism** — v3 §3 picks **Mechanism A
  (polling)** with backoff (250ms × 12 → 1s × 60 → 5s × 60 →
  stop), new endpoint `GET /api/quote-acceptance-status/{quote_id}`,
  client hook `useAcceptanceStatus`. CC's §0.5 lean was sync push;
  CA's lean is polling. Both are workable. Polling resolution
  unblocks Step 1 — no further disposition needed unless CC
  surfaces blockers during implementation.

- **Catch #A7 Quote umbrella scope question** — v3 §5 references
  "Quote umbrella Mark-Accepted sub-tab" as if the IA already
  exists. **Does NOT** (verified: `src/app/.../quote/page.tsx` is
  Customer View, not a 4-sub-tab umbrella; `mark-accepted/`
  remains a peer route). v3 doesn't address whether Slice 12
  restructures the Quote surface OR mounts on existing peer
  route. **My catch #A7 remains open** for Edward + CA
  disposition.

### v3 components / primitives verified

| v3 §1 / §6 reference | Status |
|---|---|
| `src/components/mark-accepted/accept-confirm-modal.tsx` | ✓ exists (Slice RI.6 stub) |
| `src/components/mark-accepted/mark-accepted-host.tsx` | ✓ exists (5 sub-states) |
| `src/components/mark-accepted/mark-accepted-locked.tsx` | ✓ exists |
| `r3-shared.css` `.pending-banner` | ✓ at line 767 |
| `r3-shared.css` `.locked-ribbon` | ✓ at line 803 |
| `r7b-primitives.css` `.warn-band` / `.calc-display` / `.r7b-empty-state` | ✓ (per PR #54 work) |
| `refresh-header.tsx` polling pattern reference | ✓ at `src/app/import/refresh-header.tsx` (NOTE: v3 §6 references `src/components/import/refresh-header.tsx` — minor path correction) |
| `/api/` route convention | ✓ `src/app/api/` exists (dev/, import/cache-status/) |

### New §0.5 catches surfaced by v3

#### Catch #A12 — v3 §1.4 keeps AcceptedTierPickerModal as net-new; conflicts with my Catch #A11

v3 §1.4 net-new list includes:
> **AcceptedTierPickerModal** (mentioned in v1 brief §5; flagged
> here as net-new for completeness) — explicit tier picker before
> AcceptConfirmModal opens.

But per my Catch #A11, `quote.customer_accepted_tier_id` is
ALREADY captured by `recordCustomerAcceptance` (existing
production action). The PM has explicitly picked the customer's
tier in an earlier step (RI.7 DEC-1). AcceptedTierPickerModal in
Slice 12 would either:

(a) Re-pick — redundant; risks PM picking different tier than
    customer-signal step captured; semantic split between two
    tier picks per quote.

(b) Display + confirm — show inherited tier from
    `customer_accepted_tier_id` as read-only; require explicit
    "Yes this is the tier" confirm before proceeding to
    AcceptConfirmModal.

(c) Skip entirely — `customer_accepted_tier_id` IS the accepted
    tier; AcceptConfirmModal opens directly.

**Disposition (proposed):** (b) is safest. PM sees inherited tier;
confirms it's still correct before Confirm. If customer changed
their mind, PM goes back to `recordCustomerAcceptance` flow to
update the captured tier, then returns to Mark-Accepted.

CD designs the inherit-display-confirm step within
AcceptConfirmModal (folds the picker into the confirm flow);
saves a modal mount.

Edward + CA disposition.

#### Catch #A13 — v3 §7 gate list is 6; should be 7 with my Catch #A8 (HubSpot client deal-stage method)

v3 §7 lists 6 gates:
1-4 from v2 (identity mapping, RESTlet contract, idempotency,
sandbox validation)
5. CD prototype delivery (v3 NEW)
6. Async mechanism confirmation (v3 NEW)

My Catch #A8 surfaced a 7th: **HubSpot client deal-stage
advancement method authoring** — `src/lib/hubspot.ts` has zero
deal-write methods. Slice 12 must add `advanceDealStage(dealId,
stageId)` as part of the work. CC-owned; can land during Step 5
(HubSpot writeback step in v1 §15 slice plan) but the gate
belongs in the Step 1 list so it's not banked as "PR #50 covers
it" (which is the v1 §6 mistaken assumption).

**Disposition (proposed):** add as gate 7. CC-owned;
non-blocking-of-others (parallel workstream with #4 sandbox
phase) but must close before Step 6 UI work uses it.

#### Catch #A14 — v3 §3 polling endpoint depends on quote-acceptance-status server route + hook conventions; neither exists

v3 §3 implementation details propose:
- `GET /api/quote-acceptance-status/{quote_id}` server endpoint
- `useAcceptanceStatus` client hook at
  `src/components/mark-accepted/use-acceptance-status.ts`
- Backoff: 250ms × 12 → 1s × 60 → 5s × 60 → stop

`/api/` route convention exists (verified — `dev/`, `import/`)
but the polling hook pattern is new. `refresh-header.tsx` uses
`onClick` → server action → revalidate. Different mechanic.

CC needs to design:
- Server route handler shape (Next.js 15 App Router route handler
  conventions; permission gate via `ensureUser()` + project
  ownership check)
- Hook implementation (`useEffect` + `setTimeout` with backoff,
  abort signal on unmount, error boundary)
- Component integration pattern (AcceptConfirmModal mounts the
  hook; status drives modal sub-state)

**Disposition (proposed):** CC drafts the polling spec during
Step 1 alongside other implementation work. Surfaced here so
"polling mechanism exists, just use it" assumption doesn't slip
through brief reading.

### v3 catches deferred or not §0.5-actionable

- v3 §1.4 status visual register (Option A/B/C inflight progress
  indicator) — CD design decision; CC-implementation when CD
  prototype lands. Not §0.5 territory.
- v3 §6 verification list — 8 items; component-level verification
  CC runs during implementation, not pre-approval.
- v3 §9 recommended Step 1 sequence — operational; not §0.5.

### Updated cumulative tally

§0.5 catches contributed by this slice (pre-approval verification
pass against v1 + v2 + v3):
- v1 + v2 reading: catches #A1..#A11 (11)
- v3 reading: catches #A12..#A14 (3)
- **Total: 14**

Cumulative across slices post-disposition: 50 + 14 = **64 across
13 slices since Pattern 22 adoption**.

Three of v3's amendments resolve open §0.5 questions (async
mechanism choice, primitives availability, refresh-header
reference). The remaining open questions (Catch #A7 scope,
Catch #A11 / #A12 tier-pick redundancy, Catch #A8 / #A13 5th-vs-7th
gate) all need Edward + CA disposition.

**Brief amendments needed before Step 2 schema work:** my prior
list (§5 of this doc) extends with v3 reconciliation:
1. §3 column-list shrink per Catches #A1, #A2, #A3, #A4, #A5
2. §5 UI flow: AcceptedTierPickerModal disposition per Catch #A12
3. §6 HubSpot client work scoped per Catch #A8 (gate 7)
4. v2 Amendment 9 / v3 §7 gate list extends from 6 → 7
5. §4 async mechanism — v3 §3 resolves to polling; CC drafts
   polling spec per Catch #A14
6. §5 Quote umbrella IA scope per Catch #A7 (still open)

