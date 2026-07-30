# Canonical scenario-create flow · CA disposition memo

**Status:** Queued behind PR #47 (impl-6 visual bug patch round). Do not
start work until PR #47 merges. Read for context; flag any
inconsistencies before kickoff.

**Date:** 2026-05-19
**Triggered by:** Edward's hands-on PM workflow testing surfaced
multiple stacked issues in the New Scenario action.

---

## Problem statement

PMs creating a new scenario on the Epicuren quote experienced:

1. No modal — scenario auto-named "ALT 2", auto-routed to Setup
2. Setup rendered the legacy SKUs+Tiers horizontal layout (Phase
   A.0 / pre-impl-2 IA), not the new ASY/LEAF tree
3. No way to copy from an existing scenario or quote at creation
4. No way to attach the customer's brief / RFQ to the scenario
5. No way to capture intent or target tier

SPEC FR-2 explicitly defines a modal interaction on New Scenario.
SPEC FR-12 explicitly defines Copy operations. Neither is honored
in the current build. This memo dispositions a unified slice that
addresses all five issues + extends the modal to capture
high-leverage context that compounds forward.

---

## Strategic frame

The scenario-create moment is the **last time PMs make a
deliberate, conscious choice about scenario identity before
disappearing into the workflow.** Whatever we capture here
propagates forward; whatever we don't capture, PMs work without.

This slice converts the moment from a friction point into a
strategic capture surface.

---

## Investigation ask (CC, before kickoff)

Run these before drafting impl plan. Report findings + any
deviations from CA's assumptions.

### 1. What scenario-create / copy actions exist in code?

Grep for:
- `createScenario` / `createNewScenario`
- `copyScenario`
- `copyQuoteToProject` (or any cross-project copy action)
- `copyQuoteFromSource` with field-bucket enforcement per
  SPEC FR-12 (cloneable / inherited / reset semantics)

### 2. Check `copied_from_quote_id` population

```sql
select count(*) from quotes where copied_from_quote_id is not null;
```

If zero → copy actions never been used or don't exist.

### 3. Current scenario-create UI trigger

- What button currently triggers "New Scenario"?
- Location: project detail page? Quote tab strip? Setup
  surface header?
- Does ANY modal fire? Or does scenario-create skip prompt
  entirely (auto-name + auto-route per Edward's observation)?

### 4. Current `scenarios` table schema state

```sql
\d scenarios
```

Expected current shape: `id`, `quote_id` (or `project_id`),
`scenario_label`, `scenario_status`, possibly more. We're
adding columns; need current state to plan migration cleanly.

### 5. `usesNewSchema` detector location + logic

Find the loader / page component that branches between legacy
`quote_skus` renderer and new ASY/LEAF tree. Likely in
`src/app/projects/.../quotes/.../setup/page.tsx` or a shared
loader.

### 6. Supabase Storage bucket inventory

What storage buckets currently exist? Any `attachments` /
`uploads` / `files` patterns we should align with?

---

## Modal scope (CA disposition)

### Shape

```
+ New scenario · {project name} · {quote name or tier shorthand}

Start from:
  ○ Scratch
  ○ Copy a scenario from this project
  ○ Copy a quote from another project

[conditional source picker — only if Copy path selected]

Scenario name:           [Standard quote · cost-down option       ]
                          placeholder: "ALT N" (auto-incremented)

Why this scenario? (optional)
                          [Customer pushed back on packaging cost ]
                          [— try matte lamination removed         ]
                          placeholder: "Why does this scenario exist?"

Customer's target tier (optional):
                          [(unspecified) ▾]
                          dropdown of parent quote's tiers

Brief or RFQ (optional):
                          [📎 Drop file or click to upload]
                          PDF / Word / Excel / Image · up to 25MB

[ ] Mark as recommended (★ Primary)
    (Currently recommended: "{name}")

What about the current scenario?
  ○ Keep both active  (default per SPEC FR-2)
  ○ Drop current scenario

                                      [ Cancel ] [ Create scenario ]
```

### Fields summary

| Field | Required? | Default | Schema column |
|---|---|---|---|
| Start-path radio | Yes | Scratch | (not persisted; routes server action) |
| Source picker (conditional) | If Copy | none | (not persisted; FK lookup at create time) |
| Scenario name | Yes | "ALT N" auto-increment | `scenarios.scenario_label` (existing) |
| Intent note | No | empty | `scenarios.intent_note` (NEW) |
| Customer target tier | No | unspecified | `scenarios.customer_target_tier_id` (NEW) |
| Brief attachment | No | none | `scenario_attachments` table (NEW) |
| Recommended toggle | No | off (except first scenario in project) | `scenarios.recommended` (per r4 banked) |
| Drop-vs-keep current | Yes | Keep both | (action param; affects existing scenario status) |

### Behavior

**Scratch path:**
- `createScenario` action with explicit name, intent_note,
  customer_target_tier_id, recommended flag, drop choice
- Routes to `/projects/.../quotes/<new-quote-id>/setup`
- Empty Setup tree (per impl-2 empty-state, which needs verifying)

**Copy scenario from this project:**
- `copyScenario` action with source_scenario_id + same fields above
- Field-bucket enforcement per SPEC FR-12:
  - Cloneable: sku_label, product_name, product_category,
    packaging_category, units_per_pack, retail_benchmark, all
    `packaging_inputs`, `freight_inputs` policy fields, all
    `production_inputs`, `global_price_adj_pct`
  - Inherited from target project: project_id, hubspot_deal_id,
    deal_name, client_name, sales_rep_user_id, pm_user_id
  - Reset: id, version_number=1, status=draft, accepted_at,
    sent_at, pdf_url, hubspot_quote_id, customer_facing_notes,
    internal_notes, valid_until, retail_benchmark, freight
    shipment-specific fields, scenario_label, scenario_status
- Sets `copied_from_quote_id` on new quote
- Routes to Setup of new quote

**Copy quote from another project:**
- `copyQuoteToProject` action with source_quote_id (any project)
- Same field-bucket enforcement
- Sets `copied_from_quote_id`
- Routes to Setup of new quote in current project

**Brief attachment upload (any path):**
- File uploaded to Supabase Storage bucket `scenario-attachments`
- `scenario_attachments` row inserted post-quote-create
- Audit row `scenario_attachment_added`

---

## Schema additions

### Migration 1: `scenarios` table extensions

```sql
alter table scenarios
  add column intent_note text,
  add column customer_target_tier_id uuid references quote_tiers(id),
  add column recommended boolean not null default false;

-- Set existing first-scenarios per project to recommended
update scenarios s
   set recommended = true
 where id = (
   select min(s2.id)
     from scenarios s2
    where s2.project_id = s.project_id  -- or quote_id pivot per current schema
   order by s2.created_at asc
   limit 1
 );

-- Ensure only one recommended scenario per project at a time
create unique index scenarios_one_recommended_per_project
  on scenarios (project_id)  -- adjust per actual FK
  where recommended = true;
```

CC adjusts based on actual `scenarios` schema (verified in
investigation ask #4).

### Migration 2: `scenario_attachments` table

```sql
create table scenario_attachments (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  filename text not null,
  storage_url text not null,
  mime_type text,
  file_size_bytes int,
  uploaded_by uuid not null references users(id),
  uploaded_at timestamptz not null default now(),
  notes text  -- optional context, e.g., "customer's revised RFQ v2"
);

create index scenario_attachments_scenario_id_idx
  on scenario_attachments (scenario_id);
```

### Supabase Storage bucket

- Bucket name: `scenario-attachments`
- Access: authenticated users only (RLS on bucket policies)
- File path convention: `{scenario_id}/{uuid}-{filename}`

### File constraints

- Max size per file: 25 MB
- Allowed MIME types:
  - `application/pdf`
  - `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `image/png`, `image/jpeg`, `image/webp`
  - `text/plain`
- Blocked: executables, archives, video, audio

---

## Server action surface

New / refactored actions:

1. `createScenario(input)` — refactored to accept intent_note,
   customer_target_tier_id, recommended, drop choice
2. `copyScenario(source_scenario_id, input)` — new; within-project
   clone with field-bucket enforcement
3. `copyQuoteToProject(source_quote_id, target_project_id, input)`
   — new; cross-project clone with field-bucket enforcement
4. `addScenarioAttachment(scenario_id, file)` — new; uploads to
   Storage + inserts row
5. `removeScenarioAttachment(attachment_id)` — new; deletes from
   Storage + soft/hard delete row (TBD; lean hard delete since
   PMs may need to remove sensitive customer data; audit captures
   removal)
6. `setScenarioRecommended(scenario_id)` — new; sets flag + auto-
   unflags any sibling scenarios in project

All actions return `ActionResult<T>` per established pattern.

---

## Audit log namespaces (CLAUDE.md additions)

- `scenario_created` — diff_json carries full new scenario state
  including intent_note, customer_target_tier_id, recommended,
  copied_from_quote_id (null on scratch path), source_scenario_id
  (for copy), drop_current_scenario_choice
- `scenario_copied` — variant of created with source linkage; or
  fold into `scenario_created` with `source: 'copy'` discriminator
- `scenario_attachment_added` — entity = scenario; diff_json has
  filename, mime_type, file_size_bytes, uploaded_by, notes
- `scenario_attachment_removed` — same shape
- `scenario_recommended_changed` — diff_json has
  `{from_scenario_id, to_scenario_id, project_id}` for the swap

CC's call on best discriminator pattern.

---

## Pattern 45 boundary discipline

**CRITICAL.** Scenario attachments are PM-internal. They must NOT
appear on any customer-view surface.

- `scenario_attachments` table NOT imported into
  `src/components/pdf/` tree
- Pattern 45 boundary verifier scope extended to confirm this
  isolation
- Attachment viewer / list UI lives in `src/components/scenarios/`
  or `src/components/setup/` (NOT pdf/)
- Quote PDF render (impl-6 + future impl-7 finalization) never
  references attachments

CC verifies at impl time via the verifier:

```
npm run verify:boundaries
```

Expected: attachments dir is in the "PM-side" allowlist, not the
PDF-side allowlist.

---

## `usesNewSchema` routing fix (bundled with this slice)

**Drop the detector entirely.** All quotes route to new ASY/LEAF
tree renderer regardless of `assemblies` count.

Empty `assemblies` count → empty-state Setup tree prompts PM to
click "+ Add product" (per impl-4 modal, already wired).

CC investigates:
- Where is the detector? (Likely `usesNewSchema()` function in
  loader or page component)
- Does the new-path loader gracefully handle zero-assembly state,
  or assume at least one assembly row exists?
- If new-path loader breaks on empty state, an empty-state
  component needs wiring (per impl-2 — verify if one exists or
  needs to be added)

Patch:
- Remove `usesNewSchema` detector + all call sites
- Remove legacy renderer code path import / mount
- Verify empty-state Setup tree renders cleanly when
  `assemblies.count == 0`
- All quote-creation paths (this slice's modal + any others)
  result in PM landing on new ASY/LEAF tree

---

## Surface affordances (post-creation)

### Project detail page · scenario card
- "★ Primary" treatment for recommended scenario (banked from
  r4-designer-notes.md)
- Attachment count chip: "📎 2" when attachments exist
- Intent note tooltip on hover (truncate to first 80 chars + …
  with full text on hover)

### Setup surface · scenario header
- Attachment list affordance: "📎 1 attachment · brief.pdf"
- Click → modal with attachment list (filename, uploaded_by,
  uploaded_at, notes, download link, remove button)
- "Add attachment" button on the list modal for post-creation
  additions

### Audit log
- Every attachment add/remove is auditable per namespace above

---

## Field-bucket enforcement on copy (SPEC FR-12 compliance)

Per SPEC, the copy actions enforce three field buckets. CC's impl
needs to centralize this — either as a helper function or as
explicit field-by-field handling in each copy action.

CA lean: **centralize as `applyFieldBuckets(source, target, bucket_map)`**
helper. Reasons:
- Same logic for `copyScenario` and `copyQuoteToProject`
- Future copy actions (templates library v2) reuse
- Single source of truth; if SPEC FR-12 buckets ever change, one
  file to update

Bucket map lives in `src/lib/scenario-copy-buckets.ts` (or
similar):

```ts
export const COPY_BUCKETS = {
  cloneable: ['sku_label', 'product_name', /* ... */],
  inherited: ['project_id', 'hubspot_deal_id', /* ... */],
  reset: ['id', 'version_number', 'status', /* ... */],
} as const;
```

Brief attachments specifically:
- **NOT cloneable** in the default semantics — when PM copies
  scenario, do they want the original brief auto-copied? Or do
  they want to upload a different one for the new scenario?
- CA lean: **cloneable.** Reasons: customer briefs often carry
  forward (version 2 quote responds to same brief); PMs can
  remove if not relevant. Friction is lower in remove-direction
  than in re-upload-direction.
- If CC's investigation surfaces that cloning storage files is
  non-trivial (Supabase copy semantics, etc.), bank as v1.1+ and
  reset bucket holds attachments in copy semantics.

---

## Slot

Lands after PR #47 (impl-6 visual bug patch) merges.

**Slot sequence:**
1. PR #47 impl-6 visual bug patch round → merge
2. Canonical scenario-create flow slice (this disposition) →
   merge
3. HubSpot bidirectional micro-slice (banked earlier) → merge
4. impl-7 (Quote umbrella + NetSuite finalization) → kickoff

Or interleave (2) and (3) depending on CC's preferred order.
Both block training UX equally.

---

## Bundling decision

**This slice bundles:**

1. Unified scenario-create modal (start-path picker + name +
   intent + target tier + recommended + attachment + drop choice)
2. Schema: `scenarios.intent_note`, `scenarios.customer_target_tier_id`,
   `scenarios.recommended`, `scenario_attachments` table, Supabase
   Storage bucket
3. Server actions: `createScenario` refactor, `copyScenario`,
   `copyQuoteToProject`, `addScenarioAttachment`,
   `removeScenarioAttachment`, `setScenarioRecommended`
4. Field-bucket enforcement helper for copy actions
5. `usesNewSchema` routing fix (drop detector, route all to new
   path)
6. Audit log namespace additions
7. Post-creation surface affordances on project detail + Setup
8. Empty-state Setup tree verification + wiring (if missing)
9. Pattern 45 boundary verifier scope extended
10. CB smoke covering all paths

**Why bundled, not split:**

- All changes touch the same flow; PMs experience as single
  integrated capability
- Splitting introduces transitional states (modal works but no
  attachments / attachments but no intent note / routing fixed
  but modal unchanged) — worse PM UX than holistic landing
- Patch round velocity has been good; CC's been shipping cleanly
- Single smoke walk verifies the canonical flow end-to-end vs
  multiple incremental walks

---

## What's NOT in this slice (explicit deferral list)

Banked for later phases / v1.1+:

- **Sourcing model field** (full Nexus / hybrid / turnkey) — wait
  for Brain MD hybrid scope to clarify post-launch; v1.1+
- **Confidence level field** (high / med / low / exploratory) —
  v1.1+ Deal Organizer / Mgmt Dashboard polish
- **Tags / category** field — v1.1+ analytics layer
- **Lead-time variant** — out of scope; firm default holds
- **Customer-facing scenario name distinct from internal** —
  v1.1+ if PMs request
- **Templates library** explicit UI (per SPEC v2 pre-wire #9) —
  v2 scope
- **AI-assisted spec entry from uploaded brief** — v2 / v1.5+
- **Multi-file upload at modal time** (single at modal, multi
  post-creation surface) — UX gating decision; multi-upload is
  available via the post-creation list modal, just not the create
  modal
- **Side-by-side scenario comparison** — explicitly v2 per SPEC
  non-goals
- **Inline scenario name edit affordance** (already banked v1.1+)
  — separate from at-creation naming

---

## Standing patterns banked from this exchange

### Pattern: Modal moments as high-leverage capture surfaces

At every modal moment, ask: "what's the cheapest field to capture
now that would otherwise be lost or expensive to reconstruct?"

Audit candidates:
- Add Product modal (impl-4) — anything missing?
- Library browse + attach (impl-5) — "as primary supplier" vs
  "as backup" flag at attach time?
- Quote umbrella Tier Selection Advance (impl-7) — beyond tier
  ID, capture reasoning / pushback context?

Bank for review at each impl kickoff.

### Pattern: SPEC FR-* compliance audit

CB walks scenario gates defined in CD prototypes + smoke guides;
doesn't walk SPEC-defined user flows outside slice scope. This
exchange surfaced THREE SPEC FR-* gaps via Edward's hands-on
testing (FR-2 modal missing, FR-12 copy operations missing, FR-2
SPEC-default-drop-vs-keep choice missing).

Banking: **Pre-launch review slice walks every SPEC FR-*
explicitly as a SPEC compliance audit, separate from per-slice
smoke verification.** Catches gaps where "SPEC said this should
work, slice didn't touch this surface, smoke didn't catch."

Adds to standing patterns under pre-launch discipline.

### Pattern: Refactor regression class

Phase A.1 v2 refactor preserved schema structure (parallel paths)
without preserving behavioral semantics (which path fires when,
which integrations carry forward). Banked previously as
"behavioral guarantees from legacy path enumerated at Pattern 22
§0.5 — side-effects, audit shapes, external integration calls,
**forward-creation routing**."

Reinforced this turn by `usesNewSchema` forward-creation routing
catch. Pattern still applies.

### Pattern: Document-centric infrastructure inflection

`scenario_attachments` is the first piece of document-centric
infrastructure in Nexus. If we get this right, it grows
(attachments → AI spec parsing → project history → customer
correspondence threading). If we cram as a single url field, it
stays stuck.

Bank: when adding "attachment-like" features, default to
relational table with full metadata, not single text-url
column. Future composition pays off.

---

## Open questions for Edward at brief time (post-investigation)

These don't block kickoff but should be dispositioned before
implementation locks:

1. **Copy semantics: attachments cloneable or reset?** CA lean
   cloneable. Confirm or override.

2. **Attachment removal: soft or hard delete?** Hard delete +
   audit, or soft delete (archived flag) + retention? CA lean
   hard delete with audit (customer data hygiene).

3. **First-scenario-per-project recommended default** — should
   migration backfill existing first scenarios as recommended,
   or leave at false and let PMs explicitly mark? CA lean
   backfill.

4. **Drop-current modal copy** — SPEC says modal asks. What's
   the precise copy? CA lean: "Keep both scenarios active for
   negotiation" / "Drop {current scenario name} — keeps record
   but marks as inactive."

5. **Empty-state Setup tree copy** — when PM lands on Setup with
   zero assemblies, what's the copy? CA lean: "Add your first
   product to get started." with prominent "+ Add product" CTA.

CC surfaces these as smoke-prep dispositions; CA + Edward lock
before merge.

---

## Status

This memo is **strategic + scope-level**. Detailed impl brief
(steps, commits, gates, smoke scenarios) drafts AFTER:

1. CC completes investigation asks 1-6 above
2. Edward dispositions open questions 1-5 above
3. PR #47 impl-6 visual bug patch round merges

CC: read for context, surface concerns before kickoff. Do not
start implementation; we're not done with PR #47.
