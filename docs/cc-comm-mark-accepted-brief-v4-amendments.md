# slice-mark-accepted-netsuite-so-push — Brief AMENDMENTS v4

**Brief baseline:** v1 (full brief) + v2 (Edward's 8 critiques) + v3 (UI scope + async + CD discipline)
**Amendment driver:** Edward + CA dispositions on CC's §0.5 findings (`docs/cc-slice-mark-accepted-section-0-5-findings.md`); 14 catches resolved
**Status:** All dispositions locked. Step 1 unblocked. CC reads canonical brief set as **v1 + v2 + v3 + v4 with v4 taking precedence on conflicts.**
**Date:** 2026-06-17

This document amends v1 + v2 + v3. v4 supersedes specified sections of
each. CC reads all four as the canonical brief set; on conflict, v4
wins.

---

## §0 · Dispositions locked

| Catch | Disposition | Affects |
|---|---|---|
| **#A1+A2** | DROP ADDs for `accepted_at`/`accepted_by_user_id`/`accepted_tier_id` (already exist) + `frozen` BOOL (duplicative). Use `status = 'accepted'` as the lock signal. | v1 §3, v2 §3 |
| **#A4** | DROP orphan `quotes.accepted_snapshot_json` jsonb column in first migration. `production_recipes.snapshot_json` is canonical. | v1 §3 |
| **#A5** | v2 Amendment 5 version anchor INVALIDATED. `quotes.version_number` exists but is per-scenario (not version-history); no `versionedQuotesUpdate` helper exists; can't exist (table isn't versioned). DROP `snapshot_quote_version_number` from `production_recipes`. Replace with `status = 'accepted'` guards + audit cascade. | v2 §3, v2 Amendment 5 |
| **#A7** | **COMBINED slice.** Quote umbrella restructure folded into Slice 12 per CLAUDE.md v1 path item 4. | v1 §1, v1 §5, v3 §5 |
| **#A8+A13** | Add Gate 7 — HubSpot deal-stage write method authoring (CC-owned). PR #50 HubSpot client has no deal-stage write method. | v3 §7 |
| **#A12** | FOLD `AcceptedTierPickerModal` into `AcceptConfirmModal` as adaptive (inherit-display-confirm when `customer_accepted_tier_id` populated; empty-state required-input fallback). | v1 §5, v3 §1 |

Catches #A3 / #A6 / #A9 / #A10 / #A11 / #A14 either confirmed
existing patterns OR were resolved by v3 amendments OR are CC-owned
implementation work; no brief amendment needed beyond carry-through.

---

## Amendment 1 · §3 Schema corrections

**v1 §3 + v2 Amendment 3 superseded for the `quotes` table additions.**
Final shape:

```sql
-- Per #A1+A2 disposition: accepted_at / accepted_by_user_id /
-- accepted_tier_id ALREADY EXIST from Slice RI.7. Do NOT re-add.
-- `frozen BOOL` is duplicative — use `status = 'accepted'`.
-- Per #A4: DROP the orphan jsonb column inherited from RI.7.
ALTER TABLE quotes
  DROP COLUMN accepted_snapshot_json,

  -- NetSuite SO push tracking (v2 §3 unchanged)
  ADD COLUMN netsuite_so_id text,
  ADD COLUMN netsuite_so_pushed_at timestamptz,
  ADD COLUMN netsuite_so_push_status text NOT NULL DEFAULT 'not_pushed',
  ADD COLUMN netsuite_so_push_error text,

  -- Manual SO fallback tracking (v2 Amendment 4 unchanged)
  ADD COLUMN netsuite_so_id_source text DEFAULT 'restlet',
  ADD COLUMN manual_so_validated_at timestamptz,
  ADD COLUMN manual_so_reason text,

  -- HubSpot stage advancement (v2 Amendment 3 — separate from SO push)
  ADD COLUMN hubspot_stage_status text NOT NULL DEFAULT 'not_advanced',
  ADD COLUMN hubspot_stage_advanced_at timestamptz,
  ADD COLUMN hubspot_stage_error text;

-- Two status enums (v2 Amendment 3 unchanged)
ALTER TABLE quotes
  ADD CONSTRAINT quotes_netsuite_so_push_status_check
    CHECK (netsuite_so_push_status IN (
      'not_pushed', 'pending', 'succeeded', 'failed', 'retrying', 'manual'
    )),
  ADD CONSTRAINT quotes_hubspot_stage_status_check
    CHECK (hubspot_stage_status IN (
      'not_advanced', 'pending', 'succeeded', 'failed', 'retrying', 'skipped'
    )),
  ADD CONSTRAINT quotes_netsuite_so_id_source_check
    CHECK (netsuite_so_id_source IN ('restlet', 'manual'));
```

Migration shrinks from ~17 ADDs (v1+v2) to **10 ADDs + 1 DROP** under
v4. State semantics tables in v2 Amendment 3 carry forward unchanged.

**Per #A5 disposition: `production_recipes` schema** (v2 Amendment 5
superseded; drop the version anchor):

```sql
CREATE TABLE production_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id),

  -- v2 Amendment 5's `snapshot_quote_version_number` REMOVED per #A5.
  -- `quotes.version_number` is per-scenario, not version-history;
  -- can't serve as an immutable anchor. Freeze enforcement uses
  -- `status = 'accepted'` instead (Amendment 2 below).

  frozen_at timestamptz NOT NULL DEFAULT now(),
  frozen_by_user_id uuid NOT NULL REFERENCES users(id),
  accepted_tier_id uuid NOT NULL REFERENCES quote_tiers(id),
  snapshot_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'completed')),
  cm_packet_generated_at timestamptz,
  cm_packet_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX production_recipes_quote_id_idx ON production_recipes (quote_id);
CREATE INDEX production_recipes_status_idx ON production_recipes (status);
```

`snapshot_json` shape (v2 Amendment 5 superseded): drop the
`snapshot_quote_version_number` top-level field. v1's original shape
stands.

---

## Amendment 2 · §3 Freeze enforcement strategy

**Replaces v1 §4 "Validate quote is in acceptable state" + v2 Amendment
5's version anchor.** Quote freeze enforcement uses `status =
'accepted'` as the canonical signal:

1. **Every UPDATE-path server action that mutates quote-scoped state**
   guards with:

   ```ts
   if (quote.status === 'accepted') {
     throw new ActionGuardError(ERR.FORBIDDEN, "Quote is locked");
   }
   ```

   OR the equivalent via `quoteByIdDraft()` (existing guard helper) —
   CC enumerates the call sites during Step 2.

2. **`quoteByIdDraft` already enforces this for draft-only paths.**
   CC inventories which actions use it vs. raw `db.update(quotes)` and
   ensures complete coverage during Step 2 schema work. New §0.5
   wrap-up item.

3. **Drift detection via audit cascade.** If an admin override
   (`underpriced_override_user_id` + reason) ever bypasses the status
   guard, audit_log's `caused_by_audit_id` chain captures the
   override-driven mutation. v1.1+ may add a scheduled drift-check
   over the audit chain; v1 relies on the cascade lineage.

4. **`production_recipes.snapshot_json` is the immutable record of
   acceptance state.** If a frozen quote is somehow mutated despite the
   guard (admin override or schema-direct UPDATE), the production recipe
   still reflects the original accepted state. The recipe IS the
   contract; the quote table state is informational post-freeze.

**Banked for v1.1+** (per #A5 disposition): a proper quote versioning
system (per-scenario versioned-table pattern à la `firm_settings` or
`leaf_specs`) would enable point-in-time anchoring for production
recipes. Out of scope for v1.

---

## Amendment 3 · §1 UI scope — COMBINED slice per #A7

**Quote umbrella restructure folded into Slice 12.** v1 §1 +
post-canon-revision Quote umbrella structure (CLAUDE.md) BOTH ship as
part of this slice.

### Quote umbrella structure (target IA)

`src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx` restructures
into a **4-sub-tab host** matching CLAUDE.md canon:

1. **Preview Quote** — existing customer view content relocated, not
   rewritten. PDF preview + version selection + edit-or-finalize.
2. **Send to Client** — sending action + post-send waiting state. CC
   inventories current send-quote location during Step 1 §0.5 wrap-up
   (item below).
3. **Mark Accepted** — Mark Accepted content migrated from peer
   `/mark-accepted/` route. HubSpot deal stage push fires on Advance.
4. **Tier Selection** — finalization warning + NetSuite SO push fires
   on Advance + quote completes. CC inventories current location
   during Step 1 §0.5 wrap-up.

Each sub-tab carries an explicit Advance action button (state-machine
progression). Earlier sub-tabs become read-only after their Advance
fires. Tier Selection Advance is the **irreversible commit point**
(quote → `status='accepted'`; admin override required to revert).

### Migration scope

- `src/app/projects/[id]/quotes/[quoteId]/mark-accepted/page.tsx`
  retires. Content migrates into the umbrella's Mark Accepted sub-tab.
  Peer route either deletes or 301-redirects to umbrella deep-link.
- Nav rail consolidation: single "Quote" entry replaces separate
  "Quote" + "Mark Accepted" entries. CC + CD coordinate the nav
  treatment in Step 1.
- Bookmark + internal `href` audit: enumerate all references to
  `/mark-accepted/` path (CC inventories during Step 1) + update to
  new sub-tab URL.

### Sub-tab IA — net-new UI extensions land INSIDE the umbrella

All net-new components from v3 §1 (AcceptConfirmModal extensions,
MarkAcceptedLocked extensions, ManualSOIDEntryModal,
RetryPushSurface, InflightProgressIndicator, ProductionRecipeLink,
two-status badge cluster) mount **inside the Mark Accepted +
Tier Selection sub-tabs**, NOT on a separate peer route.

### Existing scaffolding reuse

Existing components survive — they relocate, not rewrite:
- `src/components/mark-accepted/accept-confirm-modal.tsx` (extends
  per v3 §1 + #A12 fold)
- `src/components/mark-accepted/mark-accepted-host.tsx` (relocates
  into Mark Accepted sub-tab; 5-sub-state switcher posture preserved)
- `src/components/mark-accepted/mark-accepted-locked.tsx` (extends
  per v3 §1.4)
- All `src/styles/r3-shared.css` primitives (`.pending-banner`,
  `.locked-ribbon`) + `r7b-primitives.css` primitives carry through

### Pattern 34 — multi-surface design discipline

Original v3 §5 listed 6 surfaces. Combined scope adds:
- `/quote/page.tsx` host (the umbrella scaffold itself)
- Send to Client sub-tab (formalized as own surface)
- Tier Selection sub-tab (formalized as own surface)
- Nav rail consolidation
- Peer route retirement

**Surfaces affected: ~11.** CD prototype scope expands to cover BOTH
umbrella scaffolding AND Mark-Accepted writeback UI extensions per
Pattern 30 path-B-default. Step 1 Gate 5 expanded scope (Amendment 5
below).

---

## Amendment 4 · §1 UI scope — AcceptedTierPickerModal FOLDED per #A12

**v3 §1.4 "net-new" list amendment.** `AcceptedTierPickerModal`
REMOVED from the net-new list. Its scope folds into `AcceptConfirmModal`
as an adaptive state.

### AcceptConfirmModal — two-state adaptive design

**Pre-filled state** (`customer_accepted_tier_id` is populated —
typical case, customer signal captured upstream via existing
`recordCustomerAcceptance` action):

- Tier display is read-only at top of modal: "Customer accepted: T3
  · 5,000 units · $42,500"
- PM verifies the tier matches their understanding
- Edit affordance ("Change tier") expands a tier picker INSIDE the
  modal (no separate modal mount) if PM needs to override

**Empty state** (`customer_accepted_tier_id` is null — edge case,
e.g., verbal acceptance without prior `recordCustomerAcceptance`):

- Tier display becomes a required input (radio list of tiers with
  qty + order value + margin)
- PM picks the tier explicitly
- Confirm button disabled until selection made

One modal, two states. v1 §5 step 1 + step 2 collapse into a single
modal mount. UX is cleaner (one fewer click in the typical
pre-filled flow); v3 §1.4 "(mentioned in v1 brief §5; flagged here
as net-new for completeness)" entry removed.

CD prototype delivers both states with explicit transitions.

---

## Amendment 5 · §4 CD coordination scope expansion (Gate 5)

**v3 §4 superseded.** CD prototype delivery (Gate 5) now covers BOTH:

1. **Quote umbrella scaffolding:**
   - 4-sub-tab host shell with Advance action mechanism
   - Per-sub-tab read-only-after-advance treatment
   - Nav rail consolidation (single "Quote" entry)
   - Sub-tab state machine visual states (pre-advance vs. post-advance)

2. **Mark-Accepted writeback UI extensions** (per v3 §1.4):
   - AcceptConfirmModal adaptive (pre-filled vs. empty state) — per
     #A12 fold
   - MarkAcceptedLocked two-status badge cluster (NetSuite SO + HubSpot
     stage; per v2 Amendment 3 separate enums)
   - ManualSOIDEntryModal (per v2 Amendment 4)
   - RetryPushSurface for failed states (NetSuite + HubSpot
     independently)
   - InflightProgressIndicator (Mechanism A polling visual; per v3 §3)
   - ProductionRecipeLink (v1 scope: link only; recipe browser v1.1+)

CC + CD coordinate scope expansion early in Step 1. **CD bandwidth
check is a Step 1 deliverable** — if combined scope exceeds CD's Step
1 window, CC + CA re-evaluate whether to split umbrella from Mark-
Accepted at the CD-delivery boundary (not the slice scope; just CD's
prototype sequencing).

Pattern 30 path-B-default discipline carries through — canonical
HTML+JSX+CSS bundle from CD, copied verbatim with surface-anchored
prefix, Pattern 39 nexus extensions documented inline.

---

## Amendment 6 · §7 Step 1 gates — 7 gates (was 6)

**v3 §7 superseded.** Final gate list:

| # | Gate | Owner | Resolution |
|---|---|---|---|
| 1 | Identity mapping payload contract | CC + Aisha + Edward | Step 1 |
| 2 | RESTlet contract specifics | CC + Aisha + Edward | Step 1 |
| 3 | Idempotency mechanism (`custbody_nexus_quote_id` as primary key + Manual SO validation patches the custom field + retry safety) | CC + Aisha + Edward | Step 1 |
| 4 | Sandbox validation phase (SV-1 through SV-13 per v2 Amendment 7) | Edward + Aisha + DPS NetSuite admin | Step 1 |
| 5 | CD prototype delivery (expanded scope — Amendment 5) | CD | Step 1 |
| 6 | Async progress mechanism confirmation (Mechanism A polling per v3 §3) | CC | Step 1 |
| **7** | **HubSpot deal-stage write method authoring** | CC | Step 1 |

### Gate 7 detail

PR #50 HubSpot client (`src/lib/hubspot.ts`) has read paths +
Products-domain write paths (`createProduct` etc.) but **no deal-
stage write method**. v1 §6's example call `hubspotClient.deals.update(...)`
references an API that doesn't exist as a Nexus helper.

CC extends `src/lib/hubspot.ts` with:

```typescript
export async function advanceDealStage(
  dealId: string,
  stageId: string,
): Promise<{ ok: true } | { ok: false; error: string }>;
```

Uses `HUBSPOT_WRITE_ACCESS_TOKEN` per CLAUDE.md HubSpot token model
(write-enabled token; previously added Slice 12 scope per CLAUDE.md
comment — this slice IS Slice 12, so the token model lands here).

Authored during Step 1 (CC-owned, parallel with other CC gates).
Lands before Step 5 (HubSpot writeback step in v1 §15 slice plan).

---

## Amendment 7 · Unchanged (carry through from v1+v2+v3)

The following remain unchanged by v4. CC reads them from their
authoritative section in the prior brief docs:

- **Backend architecture** (v1 §2, §4, §6, §7): three-leg ownership
  model, triangulation patterns (per v2 Amendment 1 concrete-IDs-
  first), Item Group line structure, server action surface,
  RESTlet contract shape, audit chain
- **NetSuite RESTlet contract specifics** (v2 Amendment 1 + v2
  Amendment 6): concrete IDs in payload, line-level Nexus IDs,
  error response context shape
- **Status model split** (v2 Amendment 3): two enums
  (`netsuite_so_push_status`, `hubspot_stage_status`), independent
  state transitions, separate UI surfaces
- **Manual SO fallback validation** (v2 Amendment 4): RESTlet
  patches `custbody_nexus_quote_id`; subsequent retry safety check
- **Sandbox Validation Phase** (v2 Amendment 7 / §9.5): MERGE GATE.
  SV-1 through SV-13 scenarios. Edward + Aisha sign-off documented in
  PR description.
- **Async polling mechanism** (v3 §3): Mechanism A — modal stays
  open during pending, client polls
  `/api/quote-acceptance-status/{quote_id}` with backoff (250ms × 12 →
  1s × 60 → 5s × 60 → stop). New endpoint + `useAcceptanceStatus`
  hook per v3 §3.
- **CD prototype + designer notes + data-source map per Pattern 30
  path-B-default** (v3 §4): scope expanded per Amendment 5 above,
  discipline unchanged.

---

## Amendment 8 · §0.5 Verification Wrap-up additions

CC during Step 1 §0.5 finalization runs these new items (additions
to v1 §13 + v2 §13 + v3 §6 checklists):

- [ ] Inventory current "Send to Client" surface location (file path
      + components) — for sub-tab migration scope
- [ ] Inventory current "Tier Selection" surface location (file path
      + components) — for sub-tab migration scope
- [ ] Enumerate UPDATE-path server actions that need
      `status = 'accepted'` guard (#A1+A2 freeze enforcement coverage).
      Verify each action uses `quoteByIdDraft()` OR adds an explicit
      guard.
- [ ] Enumerate internal `href` references to `/mark-accepted/` for
      bookmark/link audit (#A7 combined scope)
- [ ] Verify `quoteStatus` enum has `'accepted'` value (already
      confirmed in §0.5 findings; carry through to migration safety
      check)
- [ ] Verify HubSpot client extension surface for
      `advanceDealStage` method (Gate 7 design check pre-implementation)
- [ ] Re-evaluate frozen-state read-only rendering paths on
      Pricing/Costs/Setup now that freeze signal = `status` check
      (not column check). Existing surfaces likely already gate on
      `status === 'draft'` per PR #54 pricing/page.tsx convention;
      verify coverage.

---

## §1 · Step 1 Sequencing (post-v4 ship)

Per v3 §9 parallel workstreams, adjusted for combined scope. Calendar
days approximate; absolute dates set when Edward kicks Step 1.

**Day 0 (parallel kickoff):**
- CC: §0.5 wrap-up (Amendment 8 additions) + identity mapping
  payload spec draft
- CD: prototype kickoff against v1+v2+v3+v4 canonical set
- Edward + Aisha + DPS NetSuite admin: sandbox environment +
  RESTlet contract initial draft + OTC-* SKU enumeration

**Mid Step 1 (~Day 2-3):**
- CC: §0.5 findings closed → CA + Edward review + dispositions
- Edward + Aisha: RESTlet first iteration ready for review
- CD: prototype first pass (HTML + JSX modules for both umbrella +
  Mark-Accepted)

**Late Step 1 (~Day 4-5):**
- Edward + Aisha: RESTlet contract locked
- CD: prototype finalized + designer notes + data-source map
- CC: async polling spec (Mechanism A) + HubSpot deal-stage method
  draft
- Edward + DPS admin: OTC-* SKUs created in sandbox +
  `custbody_nexus_quote_id` field added

**Step 1 close (~Day 6-7):**
- Sandbox Validation Phase (SV-1 through SV-13)
- All 7 gates closed
- Edward + Aisha sign-off documented
- Step 2 (schema migration) authorized

---

## §2 · §0.5 Ledger update

- This slice: **14 catches** (11 pre-build + 3 post-v3 cross-reference)
- 2 BLOCKER-class avoided: #A1+A2 mid-migration revert; #A5
  impossible-helper authoring
- Cumulative across 13 slices: **64 catches**
- §0.5 ROI: empirical — Pattern 22 §0.5 verification at every slice
  kickoff paying for itself slice-over-slice. CA observation: worth
  folding the ledger metric into CLAUDE.md as a standing practice
  note alongside the Pattern 22 standing protocol. Banked for v1.1+
  documentation pass.

---

## Summary of v4 changes

| # | Amendment | Brief impact |
|---|---|---|
| 1 | §3 schema corrections | Migration shrinks ~17 ADDs → 10 ADDs + 1 DROP; drops `accepted_snapshot_json`; drops `snapshot_quote_version_number` |
| 2 | §3 freeze enforcement strategy | `status='accepted'` guards + audit cascade; no version anchor; production_recipes IS the contract |
| 3 | §1 UI scope expansion (combined slice) | Quote umbrella restructure folded in; 4-sub-tab IA; ~11 surfaces touched |
| 4 | §1 UI scope contraction | AcceptedTierPickerModal FOLDED into AcceptConfirmModal adaptive |
| 5 | §4 CD coordination scope expansion | CD prototype covers umbrella + Mark-Accepted writeback |
| 6 | §7 Step 1 gates | 7 gates (was 6); +HubSpot deal-stage method authoring |
| 7 | (Unchanged carry-through enumerated) | v1+v2+v3 backend, RESTlet, status model, manual SO, sandbox phase, polling, CD discipline stand |
| 8 | §0.5 Verification Wrap-up additions | 7 new checklist items for Step 1 §0.5 finalization |

---

## Authorization

**CC drafts v4 brief amendments doc (this file).** CA reviews; Edward
signs off. Once v4 ships (merged to main), Step 1 kicks off per Day-0
parallel workstreams.

CA standing by for v4 draft review + Step 1 kickoff signaling.

Edward + CA standing by for §0.5 wrap-up findings, sandbox readiness
signal, and the first scoped Step 1 implementation milestone.

---

**End of v4 amendments.** Canonical brief set: **v1 + v2 + v3 + v4**.
v4 takes precedence on conflicts with prior docs.
