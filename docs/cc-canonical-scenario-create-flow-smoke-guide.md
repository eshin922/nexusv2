# Canonical scenario-create flow · CB smoke guide

**Branch:** `slice-canonical-scenario-create-flow`
**Scope:** CSF-1 through CSF-9 (per CC impl brief)
**Date:** 2026-05-20

## Pre-walk DB sanity

Run before walking; expect each query to match:

```sql
-- Step 2 schema additions
select column_name from information_schema.columns
 where table_name = 'quotes'
   and column_name in ('intent_note', 'customer_target_tier_label');
-- Expect 2 rows.

-- quote_attachments table
select count(*)::int as n from quote_attachments;
-- Expect 0 pre-walk (no PM uploads yet).

-- Unique index upgraded
select indexdef from pg_indexes
 where indexname = 'quotes_project_recommended_idx';
-- Expect "CREATE UNIQUE INDEX ... WHERE (is_recommended = true)".

-- Storage bucket + RLS
select id from storage.buckets where id = 'quote-attachments';
-- Expect 1 row.

select count(*)::int from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname ilike '%quote attachments%';
-- Expect 3 (read + insert + delete).

-- Backfill state
select count(*)::int from quotes where is_recommended = true;
-- Expect 12 (one per project; total project count).
```

## Smoke walks

### CSF-1 · Modal opens correctly

**Path:** Navigate to any project detail page → click `+ New scenario`.

**Expected:**
- Modal opens with backdrop dim
- Title: `+ New scenario · {client name or deal name}`
- Three radios under "Start from":
  - Scratch (selected by default)
  - Copy a scenario from this project
  - Copy a quote from another project
- Form fields rendered:
  - Scenario name input (placeholder = next-available "Alt N")
  - "Why this scenario? (optional)" textarea (placeholder "Why does this scenario exist?")
  - "Customer's target tier (optional)" select with current scenario's tier labels + "(unspecified)" default
  - "Brief or RFQ (optional)" file input + "PDF / Word / Excel / Image · up to 25MB" caption
  - "Mark as recommended (★ Primary)" checkbox + "Currently recommended: '{name}'" sub-label
  - "What about the current scenario?" radios: "Keep both" (default) / "Drop the current scenario — '{name}' stays in record as 'dropped'"
- Footer: Cancel + Create scenario primary

**Dismiss:**
- Click backdrop outside modal → closes
- Escape key → closes (when not pending)
- Cancel button → closes

### CSF-2 · Scratch path · minimal create

**Path:** Open modal → accept all defaults → click `Create scenario`.

**Expected:**
- Primary button shows "Creating…"
- Modal closes
- Router navigates to `/projects/<id>/quotes/<newId>/setup`
- Setup page renders empty-state ASY/LEAF tree (`AssemblyTreeView` with "No assemblies yet" empty state)

**DB verification:**

```sql
select scenario_label, intent_note, customer_target_tier_label,
       is_recommended, scenario_status
  from quotes
 where created_at > now() - interval '5 minutes'
   and scenario_label like 'Alt %'
 order by created_at desc limit 1;

select action, diff_json
  from audit_log
 where action = 'created' and entity_type = 'quote'
   and created_at > now() - interval '5 minutes'
 order by created_at desc limit 1;
-- diff_json should have audit_source: 'canonical_modal'
```

### CSF-3 · Scratch path · full capture

**Path:** Open modal → fill every field:
- Scenario name: "Cost-down exploration"
- Intent: "Customer requested 15% cost reduction"
- Target tier: select any from dropdown
- Attach a small PDF (≤ 25 MB)
- Check "Mark as recommended"
- Pick "Drop the current scenario"
- Click `Create scenario`

**Expected:**
- All fields persist; modal closes; Setup loads
- New scenario is recommended (★ Primary on project detail card)
- Previously-recommended scenario is no longer recommended
- Previous current scenario shows `scenarioStatus = 'dropped'` + `drop_reason = 'manual'`

**Audit verification:**

```sql
select action, diff_json, created_at
  from audit_log
 where created_at > now() - interval '5 minutes'
   and action in (
     'created',
     'scenario_dropped',
     'scenario_recommended_changed',
     'quote_attachment_added'
   )
 order by created_at desc;
-- Expect 4 rows.
```

### CSF-4 · Copy paths disabled state

**Path:** Open modal → click "Copy a scenario from this project" radio.

**Expected:**
- Inline warning banner appears: "⏳ Copy operations ship in the next slice. For now, create from scratch and re-enter data manually."
- All form fields below disable
- "Create scenario" button visibly disabled (opacity 0.5 + cursor not-allowed via impl-3 patch)
- Click "Create scenario" → inline error: "Copy operations ship in the next slice. For now, create from scratch."

Switch to "Copy a quote from another project" radio → same disabled state.

Switch back to "Scratch" → fields re-enable + button enables.

### CSF-5 · File validation

**Path:** Open modal → click file input.

**Tests:**
- Select a `.exe` file (or any non-allowlisted type) → inline error: "Allowed: PDF, Word, Excel, images (PNG/JPG/WebP), plain text." File input clears.
- Select a 30+ MB file → inline error: "File exceeds 25 MB limit." File input clears.
- Select a valid PDF ≤ 25 MB → "Selected: {name} ({KB} KB)" caption appears below input.

Server-side validation is defense-in-depth — even bypassing the client checks would trip the `addQuoteAttachment` action-layer validation.

### CSF-6 · `usesNewSchema` routing fix

**Path:** Navigate to ANY pre-existing quote (e.g., quote `ed74cce9-42a0-4c49-8864-3ce45111c3b4` which has zero assemblies in DB).

**Expected:**
- Setup page renders the new ASY/LEAF tree (NOT the legacy horizontal SKUs+Tiers card)
- Empty-state copy: "No assemblies yet. Use the buttons above to add a product."
- "+ Add product" + "↗ Pull from HubSpot" buttons in the .a1v2-card-head .actions cluster (impl-4 trigger + impl-2 inert HubSpot button per current state; HubSpot writeback regression is the queued micro-slice)
- Tier card below renders as before

Navigate to a quote WITH assemblies (e.g., `f84334bd-afa1-4016-9511-71f7d5600e35`) → ASY tree renders normally (regression check; no change for existing-tree-data quotes).

### CSF-7 · Post-creation surfaces

**Path:** After CSF-3 full capture, navigate back to the project detail page.

**Expected on scenario cards:**
- Newly-created scenario card shows:
  - ★ Primary badge (left of scenario label)
  - "1 version · 📎 1" meta row (📎 chip is a clickable Link to /setup)
  - Intent note as italic truncated text below meta row; hover reveals full text in tooltip
- Previously-recommended scenario card no longer shows ★
- Dropped scenario card shows DROPPED status badge + drop_reason chip

**Path:** From new scenario card → click the 📎 chip → navigates to /setup.

**Expected on Setup header:**
- `.r7b-head .actions` cluster shows `📎 1 attachment` trigger button
- Click trigger → AttachmentListModal opens

### CSF-8 · Attachment removal

**Path:** From attachment-list modal → click "Remove" on an attachment.

**Expected:**
- Button text changes to "Confirm remove" (two-step pattern)
- Click "Confirm remove" → button shows pending state
- Row disappears from the list
- Router refreshes; modal stays open with the row gone
- Setup-header trigger updates count (or flips to "📎 Add attachment" if count → 0)

**Audit verification:**

```sql
select diff_json, created_at
  from audit_log
 where action = 'quote_attachment_removed'
 order by created_at desc limit 1;
-- diff_json should have full pre-delete snapshot
```

### CSF-9 · Pattern 45 boundary

Run the prebuild verifier:

```bash
npm run verify:boundaries
```

Expected: `[customer-view-boundary] OK — 8 file(s) under src/components/pdf/ verified clean.` (unchanged from pre-slice baseline; no new pdf/ additions).

Manual inspection:
- Navigate to the Quote (Preview Quote) surface for a quote WITH attachments
- Inspect the rendered PDF DOM — NO attachment data appears
- attachment-list components live in `src/components/quote-attachments/`; PDF render tree imports nothing from there

## Phase wrap — Pattern 27 cumulative manifest

**STRUCTURAL coverage (8 commits across 8 steps):**

- Step 1 — kickoff + Pattern 22 §0.5 verification (5 checks PASS)
- Step 2 — schema migration + Storage bucket SQL (applied)
- Step 2 — backfill SQL (applied; 12 projects flipped)
- Step 3 — loader refactor + legacy renderer removal (+ HubSpot writeback lineage acknowledgment per CA disposition 4)
- Step 4 — server actions (createScenario refactor, addQuoteAttachment, removeQuoteAttachment, setScenarioRecommended) + supabase-server helper + CLAUDE.md audit namespace
- Step 5 — canonical modal client component + trigger
- Step 6 — trigger wiring on project detail page + createScenarioLegacy deletion
- Step 7 — post-creation surfaces (project detail card 📎 chip + intent tooltip + Setup-header attachment list trigger + modal)
- Step 8 (this commit) — smoke guide + Pattern 27 wrap

**Pattern 22 §0.5 catches in v1 cycle to date:** **8**
1. Phantom `quote_skus.global_price_adj_pct` (Pricing reframe)
2. Phantom `scenarios` table (Phase A.1 v2 Architect)
3. Phantom `products` table (Phase A.1 v2 impl-1)
4. Missing PP/SP `field_schema` (impl-3 Bug #J)
5. Missing `leaves.hubspot_product_id` (impl-4 kickoff)
6. `drop_reason` enum value mismatch (this slice Step 1)
7. `quotes.is_recommended` already exists (this slice Step 2)
8. Clerk vs Supabase Auth on Storage RLS (this slice Step 4)

Pre-impl-schema-truth verification automation is high-leverage v1.5+ candidate per CA banking.

**Audit log namespace additions** (per CLAUDE.md update in Step 4):
- `scenario_recommended_changed` (entity_type='project')
- `scenario_dropped` (existing enum value documented)
- `quote_attachment_added` (entity_type='quote')
- `quote_attachment_removed` (entity_type='quote'; pre-delete snapshot)
- Extended `quote.created` diff_json + `audit_source: 'canonical_modal'`

## Pre-merge gates

- [x] Typecheck PASS every commit
- [x] Pattern 47 verify PASS every commit (one violation caught + fixed at Step 7 prebuild)
- [x] Pattern 22 §0.5 verification PASS (8 cumulative catches in v1 cycle; brief amendments folded in)
- [x] Pattern 27 two-layer manifest per commit
- [x] Pattern 30 — modal shell reuses canonical `.a1v2-modal-*` CSS; content nexus-authored per CA Pattern 28 N/A disposition
- [x] Pattern 45 customer-view boundary clean (8 files; no new pdf/ additions)
- [ ] CB end-of-phase smoke walk (merge gate)

## Carry-forwards (banked per brief)

- **FR-12 copy operations** — dedicated next slice (Copy a scenario from this project + Copy a quote from another project; field-bucket enforcement per SPEC FR-12)
- **HubSpot bidirectional micro-slice** — queued after FR-12 slice; restores write path before pre-launch review (CA disposition memo from earlier session)
- **Multi-file upload at modal time** — single at modal, multi via post-creation list modal
- **Customer-facing scenario name distinct from internal** — v1.1+
- **Confidence level field** (high/med/low/exploratory) — v1.1+
- **Tags / category field** — v1.1+ analytics
- **Sourcing model field** — wait for Brain MD post-launch
- **AI-assisted spec entry from uploaded brief** — v2 / v1.5+
- **Templates Library explicit UI** — v2 per SPEC pre-wire #9

## Standing patterns banked from this slice

Per CA brief + disposition memo:

1. **Modal moments as high-leverage capture surfaces** — every modal moment asks "what's the cheapest field to capture now that would be lost otherwise?"
2. **SPEC FR-* compliance audit** — pre-launch slice walks every FR-* explicitly
3. **Refactor regression class** — behavioral guarantees from legacy enumerated at Pattern 22 §0.5 (forward-creation routing, side-effects, audit shapes, external integration calls)
4. **Document-centric infrastructure inflection** — relational tables with full metadata, not single text-url columns (precedent: quote_attachments paves the way for AI spec parsing + project history + customer correspondence threading)
5. **Cross-slice regression-window lineage tracking** — when a slice removes infra another upcoming slice depends on, commit messages explicitly state the dependency (precedent: this slice's Step 3 HubSpot writeback acknowledgment)
6. **Pattern 22 §0.5 catch automation** — 8 catches accumulated; v1.5+ tooling candidate

## Status

Branch state — **9 commits** (Step 1-7 + 2 backfill commits + Step 8 wrap). All gates PASS at this commit; ready for CB smoke walk.

Pre-launch test data state: 12 projects, 28 quotes, 12 recommended-scenarios (one per project), 0 attachments uploaded yet.
