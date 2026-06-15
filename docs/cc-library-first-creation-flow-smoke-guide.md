# slice-library-first-creation-flow · CB smoke guide

**Branch:** `slice-library-first-creation-flow`
**Status:** Ready for Edward + CB CB walk. Merge gate.
**Date:** 2026-06-15
**Companion docs:**
- Kickoff: `docs/cc-library-first-creation-flow-kickoff.md` (Step 1)
- Brief: `docs/cc-comm-library-first-creation-flow-brief.md` (CA,
  2026-06-05; all Q1-Q9 dispositioned)
- CC review: `docs/cc-comm-library-first-creation-flow-review.md`
  (CC, 2026-06-15; Q5-Q9 + §0.5 catches)

---

## Pre-walk environment check

Run before walking the modal flows to confirm baseline state.

```sql
-- 1. Schema unchanged (no migrations this slice; verify the
-- predecessor PR #50 entities are still in place)
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'leaves'
   and column_name in ('hubspot_product_id', 'archived')
 order by column_name;
-- Expect:
--   archived             boolean   nullable=NO
--   hubspot_product_id   text      nullable=YES

-- 2. Library inventory snapshot
select count(*) filter (where hubspot_product_id is not null) as hs_sourced,
       count(*) filter (where hubspot_product_id is null) as nexus_local,
       count(*) filter (where archived = true) as archived_count,
       count(*) as total
  from leaves;
-- Expect post-PR-50 state: hs_sourced ≥ 24 + any HBS-1-style
-- additions; nexus_local ≥ 7; archived ≥ 2; total ≥ 33.

-- 3. Active scenario candidates for CB walk
select q.id, q.scenario_label, p.client_name, p.deal_name
  from quotes q
       inner join projects p on p.id = q.project_id
 where q.scenario_status = 'active'
   and q.status = 'draft'
 order by q.created_at desc
 limit 5;
-- Pick a draft quote with some assemblies for LFC-1 baseline;
-- pick a quote with zero assemblies for LFC-3 empty-state walk
-- (or create a fresh scenario via + New scenario from project
-- detail).

-- 4. Verify signed-in user's canCreateLeaves
select id, email, can_create_leaves, role
  from users
 where email = '{CB_EMAIL}'
 limit 1;
-- Expect can_create_leaves = true for CB walk on LFC-1..LFC-5,
-- LFC-7. Toggle to false in DB + re-sign-in to walk LFC-6
-- permission gating.
```

Environment:
- Local dev: `npm run dev` (cross-env NODE_OPTIONS 8GB heap per
  PR #51 / commit `a09ecb8`)
- HubSpot DEV sandbox via `HUBSPOT_DEV_ACCESS_TOKEN`
- Single fresh browser tab per smoke run (no leftover tabs from
  prior dev cycles → no Server-Action-not-found errors)

---

## LFC-1 · Library has component (happy path)

**Path:**
1. Open a draft quote with at least one ASY in the tree
2. Setup card-head → click **`+ Add component →`**
3. LibraryBrowseModal opens
4. Pick a target ASY from the "Attach target:" dropdown
5. (Optional) search for an existing leaf by name or SKU
6. Click **`+ Add to {ASY sku}`** on a matching row
7. Verify the row flips to "✓ on this ASY"
8. Verify toast bottom-right: `Attached "{leaf name}" to {ASY sku}.`
9. Auto-dismiss after ~3s
10. Close library modal
11. Setup tree behind shows the new leaf under the target ASY

**DB verification:**
```sql
-- Junction row created
select al.id, al.assembly_id, al.leaf_id, al.position, al.quantity,
       a.sku as assembly_sku, l.name as leaf_name
  from assembly_leaves al
       inner join assemblies a on a.id = al.assembly_id
       inner join leaves l on l.id = al.leaf_id
 where al.created_at > now() - interval '5 minutes'
 order by al.created_at desc
 limit 5;
-- Expect 1 row matching the attached pair.

-- Audit row emitted
select action, diff_json, created_at
  from audit_log
 where created_at > now() - interval '5 minutes'
   and action = 'assembly_leaf_attach'
 order by created_at desc
 limit 1;
-- Expect 1 row. diff_json carries {assembly_id, leaf_id,
-- quantity, position}.
```

---

## LFC-2 · Library doesn't have component, create new (stacked modal flow)

**Path:**
1. Open a draft quote with at least one ASY (so target picker is
   usable)
2. Click **`+ Add component →`** → LibraryBrowseModal opens
3. Type a search term unlikely to match anything (e.g., `xyzqq01`)
4. Wait for debounce (~300ms); verify filtered-empty copy:
   `No components match "xyzqq01." Library has {N} components
   total. Try a different search, or:`
5. Click **`+ Create new product →`** below the copy
6. AddProductModal opens **stacked on top** of LibraryBrowseModal
   - Backdrop darkens twice (locked Q4 / Catch #2 stacking
     pattern)
   - Library modal still visible behind
7. Stay in LEAF mode (default)
8. Fill: name `LFC-2 created leaf`, type any, SKU `LFC-2-SMOKE-001`,
   unit cost `2.50`
9. Click **`Add leaf · specs empty`** (defer path)
10. Confirm:
    - AddProductModal closes
    - Toast bottom-right: `Added "LFC-2 created leaf" to the
      library · specs deferred.`
    - LibraryBrowseModal **still open** behind
    - Library rows refreshed; new leaf appears at top
    - Search input cleared (filters reset on refreshLibrary)
11. Pick a target ASY → click **`+ Add to {ASY sku}`** on the
    new leaf
12. Attach succeeds; row flips to "✓ on this ASY"

**Escape behavior verification (Q4 Catch #2 stacking):**
- After step 6 (AddProductModal stacked open), press **Escape**
- Confirm: only AddProductModal closes; LibraryBrowseModal
  stays open
- Press Escape again → LibraryBrowseModal dismisses

**DB verification:**
```sql
-- New leaf created via HubSpot-first path (since PR #50 createLeaf
-- refactor is on main)
select id, name, sku, hubspot_product_id, created_at
  from leaves
 where sku = 'LFC-2-SMOKE-001';
-- Expect 1 row; hubspot_product_id non-null.

-- Audit: leaf_create + assembly_leaf_attach
select action, created_at
  from audit_log
 where created_at > now() - interval '5 minutes'
   and action in ('leaf_create', 'assembly_leaf_attach')
 order by created_at asc;
-- Expect 2 rows in order: leaf_create then assembly_leaf_attach.
```

---

## LFC-3 · Library is empty (first-touch)

**Pre-condition:** library has zero rows OR all rows match
`archived = true`. If DEV sandbox has been pulled, archive all
leaves OR use a fresh database / branch with no pulls run.

If can't drain library, simulate by manually archiving most rows:
```sql
-- One-time setup for LFC-3 only; REVERT after the smoke
update leaves set archived = true where archived = false;
```

**Path:**
1. Open a fresh draft quote (with or without ASYs — doesn't
   matter for empty-state)
2. Click **`+ Add component →`** → LibraryBrowseModal opens
3. Verify truly-empty copy:
   `Library is empty. Start by creating your first product or
   pulling the HubSpot catalog.`
4. Verify **`+ Create new product →`** CTA visible below

**Two test paths from here:**

**3a — Create-new path:**
5a. Click **`+ Create new product →`** → AddProductModal stacks
6a. Fill: LEAF mode, name `LFC-3 first leaf`, type any, SKU
    `LFC-3-SMOKE-001`, cost `1.00`
7a. Click `Add leaf · specs empty`
8a. AddProductModal closes; library shows 1 row; PM can attach

**3b — Pull-from-HubSpot path:**
5b. Click **`↗ Refresh from HubSpot`** in library modal header
6b. Inline progress band appears below modal head: "Pulling…
    pass 1/2 · active products"
7b. Wait for both passes; completion banner: "✓ Pulled N HubSpot
    products · X added · Y updated · Z archived"
8b. Library rows refresh; PM can search + attach

**Revert post-smoke (if you used the archive hack):**
```sql
update leaves set archived = false
 where archived = true
   and updated_at > now() - interval '1 hour';
```

**DB verification (3a):**
```sql
select count(*) from leaves where archived = false;
-- Expect 1 (the LFC-3 first leaf).
```

---

## LFC-4 · Pull from HubSpot from inside library modal (inline band)

**Path:**
1. Open a draft quote → click **`+ Add component →`**
2. LibraryBrowseModal opens
3. Click **`↗ Refresh from HubSpot`** in modal header
4. Inline progress band appears below the head (paper-2 tint):
   `Pulling… pass 1/2 · active products`
5. Per-batch breakdown in mono register updates:
   `Batch N: {processed} processed · +{added} added · ~{updated}
   updated · {archived} archived`
6. Phase flips to `Pulling… pass 2/2 · archived sweep` when
   active pass completes
7. On completion: phase = `Pull complete`; green-soft banner
   `✓ Pulled {N} HubSpot products · {added} added · {updated}
   updated · {archived} archived`
8. Library rows refresh automatically (onComplete fires
   refreshLibrary)
9. **Dismiss** button clears the progress band
10. PM continues browsing / attaching

**Cancellation guard:** during active pull (steps 4-6), backdrop
click + close button + Escape do NOT dismiss the modal
(`pullBlocking === true` until phase ∈ {complete, error, idle}).

**Verify no three-deep modal stack:** confirm only ONE modal
backdrop visible during pull (the library backdrop). No nested
overlay appears (Q5 β disposition honored).

**DB verification:**
```sql
-- Pull batch root audits
select count(*),
       sum((diff_json->>'processed')::int) as processed,
       sum((diff_json->>'added')::int) as added,
       sum((diff_json->>'updated')::int) as updated
  from audit_log
 where created_at > now() - interval '5 minutes'
   and action = 'hubspot_pull_batch';
-- Expect: row count = active batches + archived batches.
```

---

## LFC-5 · ASY creation path preserved

**Path:**
1. Open library modal via `+ Add component →`
2. Click **`+ Create new product →`** (works regardless of
   library state)
3. AddProductModal stacks
4. **Flip mode toggle to ASY**
5. Fill: Product name `LFC-5 created assembly`, type any
6. Click **`Add product`** (single submit button in ASY mode)
7. Confirm:
   - AddProductModal closes
   - Toast bottom-right: `Added "LFC-5 created assembly" to this
     quote.`
   - LibraryBrowseModal still open
   - LibraryBrowseModal rows do **NOT** show the new ASY (correct
     — library is leaves only; ASYs are quote-local)
   - Setup tree behind shows new ASY at top
8. Close library modal
9. Verify Setup tree has the new ASY visible

**DB verification:**
```sql
-- New ASY row
select id, sku, name, quote_id, created_at
  from assemblies
 where created_at > now() - interval '5 minutes'
   and name like 'LFC-5 created assembly%'
 order by created_at desc
 limit 1;

-- ASY does NOT appear in leaves table (library)
select count(*) from leaves where name like 'LFC-5 created assembly%';
-- Expect 0.

-- Audit: assembly_created
select action, diff_json, created_at
  from audit_log
 where created_at > now() - interval '5 minutes'
   and action = 'assembly_created';
-- Expect 1 row.
```

---

## LFC-6 · Permission gating (canCreateLeaves = false)

**Setup:**
```sql
-- Flip the signed-in user's canCreateLeaves to false
update users set can_create_leaves = false where email = '{CB_EMAIL}';
-- Sign out of Clerk session + sign back in to reload session
-- claims (or restart dev server + refresh tab).
```

**Path:**
1. Sign in as the gated user
2. Open library modal via `+ Add component →`
3. Confirm:
   - **`↗ Refresh from HubSpot`** in header: rendered `disabled`
     with tooltip `You don't have permission to create new
     products. Ask an admin.`
   - Attach buttons on rows: **enabled** (canonical — attach
     doesn't require create permission per Catch #6 disposition)
4. Search a term that returns zero results
5. Confirm filtered-empty copy + **`+ Create new product →`**
   rendered `disabled` with same tooltip
6. Click the attach button on a library row → succeeds
   (ungated)

**Server-side gate verification:**
- Even if the UI is bypassed (e.g., POST directly to the
  createLeaf action), the server-side guard
  `assertCanCreateLeaves` will reject with
  `ActionResult.error.code = 'FORBIDDEN'`. UI gate is defense
  in depth; canonical gate is the action layer.

**Revert post-smoke:**
```sql
update users set can_create_leaves = true where email = '{CB_EMAIL}';
```

---

## LFC-7 · Card-head simplification regression check

**Path:**
1. Open any draft quote (empty or populated — both states)
2. Look at Setup card-head — verify:
   - **ONLY** `+ Add component →` button visible (primary register)
   - SKU/assembly counter caption present
   - NO `+ Add product` button
   - NO `↗ Pull from HubSpot` button
3. Scroll to Setup tree — verify:
   - NO footer `.a1v2-library-affordance` block
   - NO `+ Add leaf from library →` button
   - NO `browse globally-reusable components` meta caption
4. Empty-state guidance (quote with zero ASYs):
   `Start by adding your first product · click + Add component →
   to search the library or create new.`

**Static codebase verification:**
```sh
# Zero callers for deleted triggers
grep -rn "PullFromHubSpotTrigger\|AddProductTrigger" src/
# Expect: only the LibraryBrowseTrigger doc comment + the
# scenario-create trigger's pattern-mirror comment.
```

---

## CB merge-gate checklist

After all 7 LFC scenarios pass:

- [ ] LFC-1 happy path (attach existing) — PASS
- [ ] LFC-2 stacked create-new flow — PASS
- [ ] LFC-3a empty-state create-new — PASS
- [ ] LFC-3b empty-state pull-from-HubSpot — PASS
- [ ] LFC-4 inline pull-progress band — PASS
- [ ] LFC-5 ASY creation path preserved — PASS
- [ ] LFC-6 permission gating (UI + server) — PASS
- [ ] LFC-7 card-head simplification regression — PASS

---

## Cumulative Pattern 27 manifest (full slice)

This slice ships 7 commits across 7 steps. Each implementation
commit (Steps 2-6) carries its own manifest; this section folds
them for end-of-slice audit.

### STRUCTURAL MATCHED (full slice)

- `loadLibraryBrowse` extended return shape: `{ rows, total,
  libraryTotal, scenarioLabel }` (Step 2)
- `fetchLibraryBrowse` action signature updated (Step 2)
- LibraryBrowseModal libraryTotal + scenarioLabel state plumbing
  + two-shape empty-state copy split (Step 2)
- AddProductModal `onSuccess` callback prop (Step 3)
- LibraryBrowseModal `+ Create new product →` CTA inside both
  empty-state shapes + nested AddProductModal mount with
  onSuccess wiring (Step 3)
- Permission gating prop chain: page → AssemblyTreeView →
  LibraryBrowseTrigger → LibraryBrowseModal (Step 3)
- Page-level `ensureUser()` call + `permissions: { canCreateLeaves }`
  threading (Step 3)
- `r-a1v2-modal-stacked` nexus CSS extension (z-index 110)
  (Step 4)
- AddProductModal `stacked` prop + capture-phase Escape with
  `stopImmediatePropagation` (Step 4)
- LibraryBrowseModal attach toast state + auto-dismiss + canonical
  `.a1v2-toast` JSX shape (Step 4)
- `usePullFromHubSpot` hook extraction with full state machine
  (Step 5)
- LibraryBrowseModal inline pull-progress band rendering (Step 5)
- `↗ Refresh from HubSpot` button in library modal header with
  permission gating (Step 5)
- Card-head simplification: three buttons → single `+ Add
  component →` primary CTA (Step 6)
- Footer `.a1v2-library-affordance` block removed (Step 6)
- Orphan-component cleanup: `AddProductTrigger` +
  `PullFromHubSpotTrigger` deleted (Step 6)
- Empty-state copy refresh in `assembly-tree-body.tsx` (Step 6)

### POLISH MATCHED (full slice)

- Locked dispositions Q1-Q9 honored verbatim in copy + behavior
- Empty-state copy verbatim per Edward's Step 2 directive:
  - libraryTotal === 0: "Library is empty. Start by creating
    your first product or pulling the HubSpot catalog."
  - libraryTotal > 0 + zero rows: "No components match
    '{search}.' Library has {libraryTotal} components total.
    Try a different search, or:"
- Card-head CTA copy verbatim per locked Q1: `+ Add component →`
- CTA visual register: `a1v2-btn primary sm` matches the prior
  `+ Add product` primary CTA position + weight
- Tooltip copy denied (canCreateLeaves false): consistent across
  affordances — `You don't have permission to create new
  products. Ask an admin.`
- Refresh button copy: `↗ Refresh from HubSpot` per locked Q3
- Phase captions verbatim per Edward's Step 5 directive (active
  / archived sweep / complete / paused-on-error)
- Attach toast copy verbatim per locked Q9: `Attached "{leaf
  name}" to {ASY sku}.`
- Modal sub-copy `Find or create a component for {scenarioLabel}`
  threading prepared (scenarioLabel surfaced in state from Step 2;
  visual render available for future R-round chrome work; not
  rendered visually in v1 to avoid scope creep)
- Stacked-modal backdrop dimming stacks naturally (oklch alpha
  multiplicative composition) — PMs read "I am one level
  deeper" at-a-glance
- Cascade audit pattern preserved across all flows (Steps 2-6
  don't touch audit shapes; PR #50 lineage intact)

### DEFERRED (full slice → carry-forwards, NOT in this slice)

Per brief §carry-forwards + review §3 banked items:

- **Search-driven AI suggestion** — fuzzy match when search
  returns zero — v1.1+
- **"Create from this search" pre-fill** — pre-fill new-product
  name with search term — v1.5+ polish
- **Library categorization / folders** — visual grouping by type
  beyond filter — v1.1+
- **Recently used / favorites** — surface PMs' recent attaches —
  v1.1+
- **Multi-select attach** — checkbox + bulk attach action —
  v1.1+
- **Scenario sub-copy render** — "Find or create a component for
  {scenarioLabel}" visual render in modal header (data already
  threaded; R-round work surfaces it) — v1.1+
- **Phase 1 `add-product-modal.tsx` dead-code cleanup (Q8)** —
  standalone post-slice cleanup; UX_BACKLOG candidate. The
  `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx`
  file + sibling `sku-footer.tsx` chain are dead code in
  canonical-scenario-create-flow.
- **CSF-HBS-PATCH-3 Pull modal-gate** (CB banked during PR #50) —
  absorbed: Pull now lives inside the library modal header as
  inline band; no standalone Pull modal to gate.

### NOT-IN-ANY-STEP

(none)

---

## §0.5 Pattern 22 catch ledger (cumulative across slice)

| # | Catch | Step shipped | Disposition |
|---|---|---|---|
| 1 | Two AddProductModal files in codebase | 6 | Phase A.1 v2 modal used; Phase 1 orphan banked for parallel cleanup (Q8) |
| 2 | Modal stacking z-index collision | 4 | `r-a1v2-modal-stacked` nexus class (z-index: 110) + capture-phase Escape with stopImmediatePropagation |
| 3 | Library browse empty-state copy single-string | 2 | `loadLibraryBrowse` returns `libraryTotal`; modal splits into two-shape rendering |
| 4 | `AddProductModal` lacks onSuccess callback | 3 | Optional `onSuccess?: (result) => void` prop; absent → preserves prior consumer behavior |
| 5 | `PullFromHubSpotTrigger` modal stack interaction | 5 | `usePullFromHubSpot` hook extracted; inline progress band in library modal header (Q5 β); avoids three-deep stack |
| 6 | Permission gating posture | 3-5 | `permissions: { canCreateLeaves }` prop threaded; create + refresh affordances UI-gated; attach ungated at UI per canonical server-side semantic |
| 7 | `{scenario}` placeholder semantic | 2 | Fill with `quote.scenarioLabel`; loader returns it; threaded into modal state for future visual render |

Cumulative §0.5 count across slices: 14 (PR #50) → **21** (this
slice). Pattern 22 standing protocol continues to catch all
architectural mismatches pre-build.

---

## Implementation commit log (this slice)

```
6253b1d  Step 6 — Setup card-head simplification + orphan-component cleanup
178e5a6  Step 5 — inline pull-progress band + Refresh from HubSpot in library modal
d5a2722  Step 4 — modal stacking pattern + attach toast
016eb2d  Step 3 — onSuccess callback + Create-new CTA + permission gating
c3ee076  Step 2 — loadLibraryBrowse extension + empty-state copy split
5b61e8d  Step 1 — kickoff + brief + review
```

Plus this guide (Step 7).

---

## Standing by

Edward walks LFC-1 through LFC-7 (CB may parallel-walk if
bandwidth). CSF-style "pass, merged" on PR confirmation completes
the slice.

— CC, 2026-06-15
