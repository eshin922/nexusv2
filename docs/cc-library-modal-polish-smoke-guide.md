# slice-library-modal-polish · CB smoke guide

**Branch:** `slice-library-modal-polish`
**Status:** Ready for Edward + CB CB walk. Merge gate.
**Date:** 2026-06-15
**Companion docs:**
- Kickoff: `docs/cc-library-modal-polish-kickoff.md` (Step 1 +
  Pattern 30 path determination + §0.5 ledger + 8-step plan)
- CD designer notes: `docs/design-prototypes/dist/docs/cd-library-modal-designer-notes.md`
- CD data-source map: `docs/design-prototypes/dist/docs/cd-library-modal-data-source-map.md`

---

## Pre-walk environment check

```sql
-- 1. Schema unchanged (no migrations this slice)
select column_name, is_nullable from information_schema.columns
 where table_name = 'leaves'
   and column_name in ('archived', 'hubspot_product_id');
-- Expect: archived NOT NULL, hubspot_product_id NULLABLE

-- 2. Library inventory snapshot
select count(*) filter (where archived = false) as active,
       count(*) filter (where archived = true) as archived,
       count(*) filter (where hubspot_product_id is not null) as hs_sourced,
       count(*) filter (where hubspot_product_id is null) as nexus_local,
       count(*) as total
  from leaves;

-- 3. Pick a quote with assemblies (LMP-1, LMP-5, LMP-6, LMP-7)
--    and one without (LMP-2, LMP-4)
select q.id, p.client_name, q.scenario_label,
       count(a.id) filter (where a.id is not null) as asy_count
  from quotes q
       inner join projects p on p.id = q.project_id
       left join assemblies a on a.quote_id = q.id
 where q.scenario_status = 'active' and q.status = 'draft'
 group by q.id, p.client_name, q.scenario_label
 order by q.created_at desc
 limit 5;

-- 4. Confirm CB has canCreateLeaves = true for LMP-1..-3, LMP-5..-8
select email, can_create_leaves from users where email = '{CB_EMAIL}';
```

Environment:
- Local dev: `npm run dev` (heap-bumped cross-env from PR #50 era)
- HubSpot DEV sandbox via `HUBSPOT_DEV_ACCESS_TOKEN`
- Single fresh tab per smoke run

---

## LMP-1 · Library has component (happy path)

**Path:**
1. Open a draft quote with at least one ASY
2. Setup card-head → `+ Add component →` → LibraryBrowseModal opens
3. Confirm modal frame:
   - Title: **Library · components** (no "leaves" jargon)
   - Subtitle: `{clientName} · {quoteId.slice(0,8)}` (em-dash if
     project has no client_name)
   - Header head-actions: subtle `↗ Refresh from HubSpot` button
     + `✕` close icon
4. Confirm attach-target bar:
   - Eyebrow: **Attaching to**
   - Selected ASY: ◈ icon + name + `{sku} · N component(s)` meta
   - Hint right: **Components you attach land here**
5. Confirm filter row (single row):
   - `⌕ Search by name or SKU` input
   - Type segmented control: `All types | Primary packaging (PP) |
     Secondary packaging (SP) | Soft goods | Tertiary packaging (TP)`
   - Result count right: `{N} of {libraryTotal}`
6. Confirm 5-col header: `· | Component | Type | Status | Action`
7. Confirm a `ready` row:
   - Rail: transparent
   - No row tint
   - Source badge: `nexus` (accent-soft pink/violet) OR `hubspot`
     (warm orange)
   - SKU + tertiary muted usage caption
   - Status pill: `ready` (grey)
   - Action: `Attach` button (accent-filled)
8. Click **Attach** on any ready row
9. Confirm:
   - Toast bottom-right: `Attached "{leaf name}" to {ASY sku}.`
   - Row flips: rail green, faint green tint, status pill
     `attached`, action shows `✓ Attached` (no button)

**DB verification:** same as PR #51 LFC-1 (assembly_leaf row +
`assembly_leaf_attach` audit).

---

## LMP-2 · Library is empty (first-touch ⊹)

**Setup:** archive all active leaves OR use a fresh dev DB:
```sql
update leaves set archived = true where archived = false;
-- Remember to revert post-smoke (LMP-6 covers restoring some).
```

**Path:**
1. Open any draft quote → `+ Add component →`
2. Confirm `.lib-empty` shape renders:
   - Glyph: **⊹** (seed/spark)
   - Heading: **Your library is empty**
   - Body: "No reusable components yet. Create your first one,
     or pull your existing catalog from HubSpot to get started."
   - CTA row with **equal-weight** buttons:
     - **`+ Create new product →`** (accent-filled primary)
     - **`↗ Refresh from HubSpot`** (paper/border secondary)
3. CB chooses one — both paths exercise the same modal stacking
   + pull engine surfaces from PR #51

**Revert:**
```sql
update leaves set archived = false
 where updated_at > now() - interval '2 hours';
```

---

## LMP-3 · Filtered to zero (∅)

**Path:**
1. Open a draft quote with populated library
2. `+ Add component →` → LibraryBrowseModal opens
3. Type into search: `xyzzy-no-match-text`
4. Wait for debounce (300ms)
5. Confirm `.lib-empty` shape renders:
   - Glyph: **∅** (null set)
   - Heading: **No components match**
   - Body: `Nothing in the library matches `xyzzy-no-match-text`.
     Adjust the search, or create it as a new product.`
   - Query echo: search term in `.q` chip (mono, paper-3 bg)
   - CTA row:
     - **`+ Create new product →`** (primary)
     - **`Clear search`** (secondary)
   - **Refresh button ABSENT** — CD §4 lock: refreshing won't
     help a bad query
6. Click **Clear search** → search input clears → results return

---

## LMP-4 · Permission gating (canCreateLeaves = false)

**Setup:**
```sql
update users set can_create_leaves = false where email = '{CB_EMAIL}';
-- Sign out + back in (or hard refresh tab + clerk session) so
-- ensureUser picks up the new permission.
```

**Path:**
1. Open library modal
2. Confirm header:
   - `↗ Refresh from HubSpot` button **disabled** with tooltip
     `You don't have permission to refresh the library catalog.
     Ask an admin.`
3. In a populated state with rows visible:
   - Attach buttons **enabled** (canonical — attach doesn't
     require create permission per Catch #6)
4. Search a no-match query → `.lib-empty` ∅ shape:
   - `+ Create new product →` **disabled** with tooltip
   - **Perm note** beneath CTAs: `You don't have permission to
     create new products. Ask an admin.`
5. Archive a leaf and confirm Restore button on its row is
   **disabled** with tooltip `You don't have permission to
   restore library items. Ask an admin.`

**Revert:**
```sql
update users set can_create_leaves = true where email = '{CB_EMAIL}';
```

---

## LMP-5 · Target bar picker + readiness re-evaluation

**Path:**
1. Open library modal in a quote with 2+ ASYs
2. Confirm attach-target bar shows the first ASY (default
   selection per CD §3 "always set")
3. Attach a library leaf to ASY-A
4. Confirm row flips to `attached` readiness (green rail + pill
   + ✓ Attached mark)
5. Click the attach-target bar → `.lib-target-menu` popover
   opens:
   - Menu header: `Assemblies in {scenarioLabel}`
   - Each item: ◈ icon + name + `{sku} · N component(s)` +
     ✓ check on currently-selected
6. Click ASY-B → menu closes; bar reflects new target
7. Confirm previously-attached leaf:
   - Now reads `ready` (not attached to NEW target) — rail
     transparent, no tint, pill `ready`, action `Attach` button
   - Per CD §7 "re-evaluate when target changes"
8. Click outside the menu → menu dismisses without changing
   target

---

## LMP-6 · Restore archived leaf

**Setup:** ensure at least one archived leaf exists. Either
pre-existing or:
```sql
update leaves set archived = true
 where sku like 'HBS-%' or sku like 'LMP-%'
 limit 1;
```

**Path:**
1. Open library modal
2. Find the archived leaf in the list (it now appears alongside
   ready leaves — base query no longer filters archived)
3. Confirm `archived` readiness rendering:
   - Rail: ink-4 grey
   - Row tint: paper-2 (slightly muted)
   - Name color: ink-3 (dimmed)
   - Status pill: `archived` (paper-3/ink-4)
   - Action: `Restore` button (paper border-rule-2 ghost shape)
4. Click **Restore**
5. Confirm:
   - Toast bottom-right: `Restored "{leaf name}" to the library.`
   - Row flips to `ready` readiness
6. DB verification:
   ```sql
   select id, name, archived, updated_at from leaves
    where updated_at > now() - interval '2 minutes' and archived = false;
   -- Expect 1 row.

   select action, diff_json from audit_log
    where action = 'leaf_restored'
      and created_at > now() - interval '2 minutes';
   -- Expect 1 row with diff_json = {"archived":{"from":true,"to":false},"leaf_name":"..."}.
   ```

---

## LMP-7 · Inline pull-progress band (.lib-pull-band)

**Path:**
1. Open library modal
2. Click `↗ Refresh from HubSpot` in header
3. Confirm `.lib-pull-band` shape renders below `.lib-head`:
   - Accent-bordered **spinner** rotating (lib-spin keyframe)
   - Track-wrap: `**Refreshing catalog from HubSpot…** existing
     components stay usable` + per-batch breakdown beneath
   - Count column right: `{N} processed · pass {1/2,2/2}`
4. Per CD §6: filter row + table do **NOT** reflow when band
   appears (fixed slot above target-bar)
5. Pull continues — phase flips active → archived sweep
6. On completion: `.lib-pull-band` clears; green-soft summary
   band appears with `✓ Pulled N HubSpot products · X added ·
   Y updated · Z archived` + Dismiss button
7. On error (not blocking smoke unless you can sabotage the
   token mid-walk): red-soft band with Retry + Dismiss

---

## LMP-8 · Readiness rendering matrix

Quick visual sweep over the 3 readiness states in a single view:

**Setup:** seed at least one of each:
- A ready leaf (attached nowhere)
- An attached leaf (attached to current target ASY)
- An archived leaf

**Path:**
1. Open library modal in a quote where conditions above hold
2. Confirm at-a-glance distinguishability:

   | Readiness | Rail color | Row tint | Pill | Action |
   |---|---|---|---|---|
   | ready | transparent | none | grey "ready" | Attach (accent) |
   | attached | green | faint green | green "attached" | ✓ Attached |
   | archived | ink-4 grey | paper-2 muted | grey "archived" | Restore (ghost) |

3. Confirm source badge variants:
   - `nexus` badge: accent-soft background, accent-ink text
   - `hubspot` badge: warm peach/orange background; on hover the
     title tooltip shows the HubSpot product id
4. Confirm tertiary usage caption is **muted, opacity-dropped**
   (per CD §2 — present but not competing)

---

## CB merge-gate checklist

After all 8 LMP scenarios pass:

- [ ] LMP-1 happy path attach — PASS
- [ ] LMP-2 library-empty ⊹ — PASS
- [ ] LMP-3 filtered-to-zero ∅ — PASS
- [ ] LMP-4 permission gating — PASS
- [ ] LMP-5 target picker + readiness re-eval — PASS
- [ ] LMP-6 restore archived leaf — PASS
- [ ] LMP-7 inline pull-progress band — PASS
- [ ] LMP-8 readiness rendering matrix — PASS

---

## Cumulative Pattern 27 manifest (full slice)

7 commits across 7 implementation steps (Steps 2-7) + this guide
(Step 8). Per-commit manifests fold here for end-of-slice audit.

### STRUCTURAL MATCHED (full slice)

- Pattern 30 path-B-default canonical CSS adoption
  (`src/styles/r-library-modal.css`)
- Review-chrome rules dropped at file header per Pattern 31
  precedent (`.lib-stage`, `.lib-strip`, `.lib-blurb`)
- All 19 CD-referenced tokens verified pre-import (zero gaps)
- `loadLibraryBrowse` extended return shape `{ ...prior,
  clientName, ... }` via projects join; `LibraryBrowseRow.archived`
  field surfaced for client-side readiness derivation
- `LibraryBrowseRow.archived = false` filter removed from base
  query; libraryTotal retains active-only count
- New `restoreLeaf` action + `leaf_restored` audit namespace
  entry (CLAUDE.md update)
- `AssemblyTarget.leafCount` field threaded via
  `a.children.length`
- `.lib-modal` sizing override applied to `.a1v2-modal`
- `.lib-head` header structure replacing `.a1v2-card-head`
- `.lib-target-bar` persistent prominent control with picker
  popover (`.lib-target-menu`)
- Default-target-selection effect (`assemblies[0].id` on open)
- Click-outside dismiss for target picker via document mousedown
  listener
- `.lib-filters` consolidated filter row (search + type seg +
  count)
- 5-col `.lib-table-head` + `.lib-row` results table; fixed
  56px rows
- Client-side readiness derivation: archived > attached > ready
- Per-readiness CSS variants (rail color + row tint + pill +
  action shape)
- Two `.lib-empty` shapes: ⊹ library-empty (Refresh promoted to
  primary tier) + ∅ filtered-to-zero (Clear search secondary,
  Refresh absent)
- Permission notes beneath empty-state CTAs when
  !canCreateLeaves
- `.lib-pull-band` inline band for active pull (spinner + label
  + count) — fixed slot above attach-target bar; no reflow per
  CD §6
- Scope filter dropped from default filter row per CD §8 (state
  preserved server-side)

### POLISH MATCHED (full slice)

- All copy verbatim from CD prototype + designer notes:
  - "Library · components" title
  - "Attaching to" eyebrow
  - "Components you attach land here" hint
  - "Assemblies in {scenarioLabel}" menu header
  - "+ Add to {ASY sku}" → "Attach" simplification
  - "Refreshing catalog from HubSpot… existing components stay
    usable" reassurance
  - Empty-state headings + body copy
  - "Your library is empty" / "No components match" headings
  - "Nothing in the library matches `{search}`" with .q chip
  - Permission note: "You don't have permission to create new
    products. Ask an admin."
- All canonical CSS classes preserved byte-for-byte
- Glyphs verbatim: ⊹ ∅ ◈ ◦ ⌕ ↗ ✕ ✓
- Source badge `nexus`/`hubspot` variants per CD CSS
- Status pill 3-variant register (ready/attached/archived)
- Readiness rail + tint per CD §7
- Tertiary usage caption muted-inline per CD §2 (not hidden)
- COPY-1 tooltip cascade preserved from PR #51 commit 8
- Tooltips reframed around outcome (target-bar select hint,
  refresh outcome, restore outcome, perm tooltips)

### DEFERRED (full slice → carry-forwards, NOT in this slice)

- **Q1** virtualization @ 990 items — v1.1+; row height fixed
  for trivial future virtualization
- **Q3** multi-target attach — v1.5+; target bar evolves to
  multi-select when workflow lands
- **`factory` search dimension** — v1.1+ if metadata ever
  lands on leaves; schema doesn't carry the column today
- **Scenario filter** — banked as overflow/advanced affordance
  if PMs request; default row dropped per CD §8
- **Bidirectional restore sync to HubSpot** — Nexus-side only
  in v1; v1.1+ candidate per Pattern 32 pre-prod tolerance
- **Pull-progress percentage track** — production HubSpot
  list endpoint has no total denominator; .track + .fill DOM
  omitted; v1.1+ if a cheap count-API workaround surfaces
- **Subtitle scenarioLabel · v{versionNumber}** — banked v1.1+
  if PMs prefer over the 8-char UUID prefix
- **leaf.factory data dimension** — search dimension dropped
  pre-build per Catch #3

### NOT-IN-ANY-STEP

(none)

---

## §0.5 Pattern 22 catch ledger (cumulative across slice)

| # | Catch | Step shipped | Disposition |
|---|---|---|---|
| 1 | leaf.readiness derived field | 5 | Client-side derivation per CD §7; loader inputs (`archived` + `attachedAssemblyIdsInTargetQuote`) already present |
| 2 | Subtitle requires clientName | 2 | Extend loadLibraryBrowse via projects join; single-trip; row state mirrors scenarioLabel pattern |
| 3 | leaf.factory search dimension | (none) | Drop from CD's intent; schema doesn't carry the column |
| 4 | Status pill + source badge new primitives | 5 | Ship as Pattern 30 canonical CSS adoption; class names verbatim |
| 5 | Type filter taxonomy | 5 | Wire to existing leafTypesForFilter chain; CD mock list was synthetic |

Cumulative §0.5 count across slices: 21 (PR #51) → **26** (this
slice). Pattern 22 standing protocol continues to catch all
architectural mismatches pre-build.

---

## Implementation commit log (this slice)

```
d9ae8b1  Step 7 — inline pull-progress band redesign
907443c  Step 6 — two empty shapes + perm notes
3ca1156  Step 5 — filter row + 5-col table + readiness + restoreLeaf
786a3d8  Step 4 — persistent attach-target bar + row attach simplification
138bd63  Step 3 — modal frame + header redesign
918fcd1  Step 2 — canonical CSS import + clientName loader extension
3ae5e07  Step 1 — kickoff + CD prototype assets
```

Plus this guide (Step 8).

---

## Standing by

Edward + CB walk LMP-1 through LMP-8. CSF-style "pass, merged"
on PR confirmation completes the slice.

— CC, 2026-06-15
