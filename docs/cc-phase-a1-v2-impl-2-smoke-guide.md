# Phase A.1 v2 impl-2 — CB smoke guide

**Branch:** `slice-phase-a1-v2-impl-2-setup-ia`
**Scope:** CD prototype scenarios ①-④ + Setup IA shift behaviors
**Date:** 2026-05-19

## Prep — seed fixture data

The shared dev DB doesn't yet have any quotes using the new ASY/LEAF
schema (impl-2 ships the read+write infrastructure; impl-4 ships the
"+ Add product" modal that creates real production rows). To exercise
the new tree visually, seed fixture rows against an existing draft
quote.

```bash
# 1. Pick an existing draft quote_id from the shared DB. Default
#    fixture target: f84334bd-afa1-4016-9511-71f7d5600e35 (scenario
#    "Alt 1"). Verify still draft + accessible.

# 2. Apply the smoke fixture seed (idempotent via ON CONFLICT
#    DO NOTHING):
node --env-file=.env.local scripts/apply-manual-sql.mjs \
  drizzle/manual/0030_phase_a1_v2_impl2_smoke_fixtures.sql
```

The seed creates:
- **4 library leaves** in `leaves`:
  - `LEAF-GLW-30-PP` (Primary packaging) with 10/10 spec fields filled → triggers `complete` state
  - `LEAF-GLW-FCT` (Secondary packaging) with 6/11 fields → triggers `partial` state
  - `LEAF-GLW-TP` (Tertiary packaging — placeholder type) → triggers `placeholder` state
  - `LEAF-GLW-UNK` with no `product_type_id` → triggers `no_type` state
- **4 assemblies** in `assemblies` for the target quote
- **7 junctions** in `assembly_leaves`

## Smoke walk

Navigate to `/projects/<project_id>/quotes/<target_quote_id>` (the
project_id resolves automatically from the quote — see Setup URL).
The Setup surface should render the new ASY tree (scenarios ①-④).

### Scenario ① — ASY tree with nested leaves

✓ **Expected:**
- Card header `SKUs · cost-stack tree` with .actions cluster on the right
- Counter caption "{7} SKUs · {4} assemblies" (4 ASYs; 7 leaves total)
- Tree summary row with pip counts: "X ASY all-complete · Y partial · Z empty"
- Right-side caption "{N} of {M} leaves have complete specs"
- 4 ASY rows: `GLW-30 · Hydra-Glow 30ml` / `GLW-50 · Hydra-Glow 50ml` /
  `CAP-60 · Glow Capsule` / `RPL-200 · Replenish 200ml`
- Each ASY has nested LEAF rows below it (where leaves are attached)
- LEAF rows show: leaf SKU · name + qty/cost meta · type tag · refs
  caption · completeness chip · ⋯ trigger

✓ **Tree connector visuals:**
- Vertical rule + L-elbow connecting LEAF rows to their parent ASY
- ASY rows that have children show `.expanded` border-left treatment
  (accent-tinted)

### Scenario ② — LEAF context menu (Edit specs primary)

✓ Click any LEAF row's ⋯ trigger:
- Menu opens with header "Leaf actions"
- First item "Edit specs" rendered accent-tinted (`.item.accent`)
  → click is inert (impl-3 wires the SpecEntry surface; tooltip
  explains)
- Separator
- "Move up" / "Move down" / "Assign to parent ASY" / "View library
  record" — all inert with tooltip explaining future-phase landing
- Separator
- "Delete from this ASY" destructive item with "library leaf stays"
  caption on the right (mono ink-4)
  → click triggers two-step confirm; second click fires
  `detachAssemblyLeaf` server action (junction removed; library leaf
  preserved); on success, menu closes, leaf row disappears from tree

✓ Click outside the menu OR press Escape → menu dismisses.
✓ With the menu open, the trigger button shows `aria-expanded="true"`.

### Scenario ③ — ASY context menu (no Edit specs)

✓ Click any ASY row's ⋯ trigger:
- Menu opens with header "ASY actions"
- "Edit product" / "Duplicate ASY" / "Move position" inert with
  tooltips
- Separator
- "Edit specs" with `.item.disabled` styling + "leaves only" caption
  + tooltip "Specs live on leaves, not ASYs"
- Separator
- "Delete ASY · cascade" destructive item
  → two-step confirm fires `deleteAssembly`; on success, the entire
  ASY row + nested LEAF children disappear (CASCADE on junctions;
  library leaves themselves untouched)

### Scenario ④ — ASY rollup completeness states

✓ The 4 fixture ASYs exercise the rollup variants:
- `GLW-30`: 1 complete PP leaf → rollup chip "✓ All 1 leaves complete"
  (note: canonical's plural-always — "1 leaves" not "1 leaf" — is
  Pattern 28 verbatim copy from CD; bank if the singular grammar
  is wanted as a polish later)
- `GLW-50`: 1 complete + 1 partial + 1 placeholder → rollup chip
  "⚠ {pending} of 3 leaves pending"
- `CAP-60`: no leaves attached → rollup chip "— No leaves"
- `RPL-200`: 1 partial + 1 placeholder + 1 untyped → rollup chip
  "⚠ 3 of 3 leaves pending"

✓ The per-leaf completeness chips inside RPL-200:
- LEAF-GLW-FCT (partial SP) → "⚠ {N} fields pending"
- LEAF-GLW-TP (placeholder TP) → "⚠ Fields pending"
- LEAF-GLW-UNK (no type) → "⚠ No type set"

### Setup IA shift behaviors

✓ **DOM order:** The SKU card (now ASY tree) renders at the top
position. The Tier card renders below it. The grid is single-column
full-width (`.r7b-grid.r-a1v2-stack` modifier active when
`usesNewSchema=true`). Legacy quotes without `assemblies` rows
keep the §6.b 2fr/1fr grid composition.

✓ **Per-SKU notes drawer (Step 8):**
- Each ASY row has a "Notes ⌄" trigger button in the action cluster
- GLW-30 has `internalNotes` populated → HAS NOTE chip displayed
  next to the trigger
- Click trigger → drawer slides open between row and leaves;
  textarea contains the existing notes
- Edit textarea → "saving…" appears after debounce (500ms); flips to
  "saved" on successful commit
- Pattern 47 invariant: `disabled={pending}` NOT on the textarea;
  focus stays stable during save
- Close drawer (click "Notes ⌃") → state preserved; reopening shows
  current draft

✓ **Drag-to-reorder (Step 9):**
- Drag any ASY row by its twirl glyph (or anywhere on the row) to
  reorder. Optimistic position updates during drag; server commits
  on drop.
- Drag any LEAF row within its parent ASY to reorder.
- Cross-ASY leaf drag: NOT enabled in v1 (use "Assign to parent"
  context menu item — currently inert pending follow-up).
- Non-draft quotes: drag is disabled (`draggable={editable}`).

✓ **Header buttons (Step 10):**
- "↗ Pull from HubSpot" .a1v2-btn.ghost.sm renders, disabled with
  tooltip pointing to impl-4
- "+ Add product" .a1v2-btn.primary.sm renders, disabled with same
  tooltip when quote is draft (additionally disabled when status
  is non-draft)

### Audit log verification

After exercising the actions (delete ASY, detach leaf, reorder
either, edit notes), run this query to verify audit rows:

```sql
select id, action, entity_type, entity_id, diff_json, created_at
from audit_log
where created_at > now() - interval '1 hour'
  and action in (
    'assembly_deleted',
    'assembly_leaf_detach',
    'notes_updated',
    'assemblies_reordered',
    'assembly_leaves_reordered'
  )
order by created_at desc;
```

Each PM action should produce one corresponding audit row with
populated `diff_json` per the CLAUDE.md namespace section.

## Known limitations + deferred items

| Item | Deferred to |
|---|---|
| + Add product modal | impl-4 (Phase 4 brief §5.4) |
| Pull from HubSpot wiring | impl-4 |
| Edit specs (LEAF) action wiring | impl-3 (Phase 3 SpecEntry surface) |
| Move up/down via context menu | follow-up (drag is primary path) |
| Assign to parent ASY (cross-ASY drag) | follow-up |
| View library record | impl-5 (Phase 5 library browse) |
| Duplicate ASY | follow-up (clone-leaves-or-shell disposition needed) |
| `assembly_leaf_attach` audit firing | impl-4/5 (no UI write path in impl-2) |

## Cleanup after smoke

If you want to remove the fixture data before opening real test
quotes:

```sql
delete from assembly_leaves
 where id in (
   '44444444-4444-4444-4444-444444444401',
   '44444444-4444-4444-4444-444444444402',
   '44444444-4444-4444-4444-444444444403',
   '44444444-4444-4444-4444-444444444404',
   '44444444-4444-4444-4444-444444444405',
   '44444444-4444-4444-4444-444444444406',
   '44444444-4444-4444-4444-444444444407'
 );

delete from assemblies
 where id in (
   '33333333-3333-3333-3333-333333333301',
   '33333333-3333-3333-3333-333333333302',
   '33333333-3333-3333-3333-333333333303',
   '33333333-3333-3333-3333-333333333304'
 );

delete from leaf_specs
 where id in (
   '22222222-2222-2222-2222-222222222201',
   '22222222-2222-2222-2222-222222222202'
 );

delete from leaves
 where id in (
   '11111111-1111-1111-1111-111111111101',
   '11111111-1111-1111-1111-111111111102',
   '11111111-1111-1111-1111-111111111103',
   '11111111-1111-1111-1111-111111111104'
 );
```

The fixture IDs use a recognizable pattern (`11111111-..` for leaves,
`22222222-..` for specs, etc.) so cleanup is safe and the schema
self-documents the test data shape.

## Status

All 12 steps committed on branch. PR ready for review + smoke.

Pattern 27 two-layer manifests across all commits document
structural + polish coverage per scenario. End-of-phase CB smoke
walk is the merge gate per standing convention.
