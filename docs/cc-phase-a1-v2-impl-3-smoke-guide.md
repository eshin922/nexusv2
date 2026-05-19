# Phase A.1 v2 impl-3 — CB smoke guide

**Branch:** `slice-phase-a1-v2-impl-3-spec-entry`
**Scope:** CD prototype scenarios ⑤-⑩ + Spec entry surface behaviors
**Date:** 2026-05-19

## Prep — apply impl-3 smoke fixture (additive on impl-2 seed)

The impl-2 smoke seed already covers leaves for scenarios ⑤/⑥/⑨.
Impl-3 adds one Soft goods leaf for scenario ⑦ + notes scenario ⑧
supersession per Edward §15.2 dispositions (TP elevated to first-
class; placeholder demonstration moves to Soft goods alone).

```bash
node --env-file=.env.local scripts/apply-manual-sql.mjs \
  drizzle/manual/0031_phase_a1_v2_impl3_smoke_fixtures.sql
```

Verify post-apply:

```sql
select sku, name, product_type_id from leaves
 where id::text like '11111111-%' order by sku;
```

Expected: 5 leaves (4 from impl-2 + 1 new Soft goods leaf
`LEAF-GLW-SG`).

## Smoke walks

Navigate from the Setup tree (impl-2 surface) — click each LEAF
row's ⋯ context menu → **Edit specs** (accent-tinted item;
previously inert in impl-2; now wired in impl-3 Step 3). The link
takes you to the per-leaf SpecEntry surface.

URL: `/projects/<projectId>/quotes/<quoteId>/leaves/<leafId>/specs`

Target quote for testing:
`/projects/ff8c04f2-50b7-4207-98a0-53b44c85ab90/quotes/f84334bd-afa1-4016-9511-71f7d5600e35/...`

### Scenario ⑤ — Primary packaging leaf · complete

**Path:** Setup tree → GLW-30 ASY → LEAF-GLW-30-PP row → ⋯ →
Edit specs

**Expected:**
- Header: ◦ icon + "30ml Glass Dropper Bottle..." name + meta
  ("SKU LEAF-GLW-30-PP · v1 · $1.85 unit cost · Referenced by 2
  ASYs"), accent-tinted "PRIMARY PACKAGING" type tag + "Change
  type" trigger
- Completeness chip: "✓ Complete" (good-tinted)
- Cascade warning banner above card: "30ml Glass Dropper Bottle…
  is used in 2 ASYs across 1 scenario" + ref list
- SpecPanel "Primary packaging" with "10 of 10 fields" caption
- All 10 input/textarea fields populated with the seed values
  (pp_description / pp_component_type / pp_quantities / pp_size /
  pp_material / pp_deco / pp_additional_details / pp_factory_1 /
  pp_factory_2 / pp_packout_details)
- Multi-line fields (description, additional, packout) render
  as textareas; single-line fields as inputs

**Interactions to test:**
- Edit any field → "saving…" caption appears after debounce
  (500ms) → flips to "saved" on commit
- Focus stays on the field during save (Pattern 47 invariant)
- Refresh page → edit persists (DB write confirmed)

### Scenario ⑥ — Secondary packaging leaf · partial

**Path:** Setup tree → GLW-50 ASY → LEAF-GLW-FCT row → ⋯ →
Edit specs

**Expected:**
- Header meta shows "Referenced by 2 ASYs" (GLW-50 + RPL-200)
- Completeness chip: "⚠ 5 fields pending" (partial; 6 of 11
  filled per impl-2 seed)
- SpecPanel "Secondary packaging" with "6 of 11 fields" caption
- 6 fields populated; 5 empty (placeholder "—")
- Cascade warning banner shown (2 ASYs across 1 scenario)

### Scenario ⑦ — Soft goods leaf · placeholder treatment

**Path:** Setup tree → RPL-200 ASY → LEAF-GLW-SG row → ⋯ →
Edit specs

**Expected:**
- Header: "SOFT GOODS" type tag
- Completeness chip: "⚠ Fields pending" (placeholder state)
- Body: PlaceholderPanel renders instead of SpecPanel:
  - h4 "Soft goods specs · fields TBD"
  - Paragraph "Field schema for Soft goods is pending. Edward
    provides field lists iteratively per type…"
  - Stub footer "design pattern · type-aware rendering · field
    count TBD"
- "Change type" trigger still visible (PM can switch the leaf to
  a real type if needed)

### Scenario ⑧ — Tertiary packaging · superseded

Per Edward §15.2 dispositions, Tertiary packaging was elevated
from placeholder to first-class. The starter field_schema (10
fields) is seeded; rendering follows the SpecPanel path (same as
scenarios ⑤/⑥), NOT the PlaceholderPanel path.

**Walk:** Setup tree → GLW-50 ASY → LEAF-GLW-TP row → ⋯ →
Edit specs. SpecPanel renders the 10 TP fields (all empty per
seed; "0 of 10 fields" caption + "⚠ 10 fields pending" chip).

If Edward wants the **canonical** scenario ⑧ behavior (TP as
placeholder) for smoke verification, manually toggle the seed:

```sql
update product_types
   set placeholder = true, field_schema = null
 where id = 'leaf_tertiary_packaging';
```

This reverts to placeholder behavior temporarily. Restore after
smoke:

```sql
-- Restore TP starter schema per Edward §15.2
update product_types
   set placeholder = false,
       field_schema = '{ ... TP starter JSON ... }'::jsonb
 where id = 'leaf_tertiary_packaging';
```

(See `drizzle/manual/0030_phase_a1_v2_seed.sql` for the full
canonical TP starter JSON.)

### Scenario ⑨ — Leaf without Product Type · type-picker

**Path:** Setup tree → RPL-200 ASY → LEAF-GLW-UNK row → ⋯ →
Edit specs

**Expected:**
- Header: NO type tag (no productType assigned)
- Completeness chip: "⚠ No type set" (bad-tinted)
- NO "Change type" trigger (impl-3 Step 9 only shows for already-
  typed leaves; initial assignment uses TypePicker)
- Cascade warning shown if leaf has > 1 reference (single ref in
  current seed → banner suppressed)
- Body: TypePicker empty state:
  - ∅ glyph + "Set product type first" h4
  - Description "This leaf has no Product Type — pick one to
    render its spec schema. Type drives which fields appear."
  - .options grid with all 4 non-hidden leaf-scope types:
    - Primary packaging (10 fields)
    - Secondary packaging (11 fields)
    - Tertiary packaging (10 fields)
    - Soft goods (fields TBD — .placeholder modifier class)

**Interaction:**
- Click "Soft goods" → "assigning…" caption appears → page
  re-renders with the Soft goods type assigned + PlaceholderPanel
  body
- (For testing: revert the assignment via SQL if you want to
  re-test scenario ⑨: `update leaves set product_type_id = null
  where id = '11111111-1111-1111-1111-111111111104';`)

### Scenario ⑩ — Unauthorized user · RLS read-only

**Path:** sign in as a user with `can_edit_specs = false` AND
non-admin role. Navigate to any leaf's spec entry surface.

**Expected:**
- 🔒 RLS banner above the card: "Read-only view. Your role
  doesn't have spec_edit permission. Spec values render but
  inputs are disabled."
- SpecPanel renders all field values (PMs can read);
  input/textarea elements are `disabled` (cursor: not-allowed)
- TypePicker option buttons disabled (if untyped leaf)
- "Change type" trigger NOT rendered (hidden when readOnly)
- Cascade warning banner NOT rendered (hidden when readOnly)

**For dev DB testing:** the seed gave Edward (admin) implicit
edit access via the admin role bypass. To exercise scenario ⑩,
either:
(a) Temporarily downgrade Edward's row:
  `update users set role = 'pm', can_edit_specs = false where
   email = 'edward.shin@gmail.com';`
  (Restore after: `update users set role = 'admin' where
   email = 'edward.shin@gmail.com';`)
(b) Create a second test user via Clerk sign-in flow (more
  involved; defer until Microsoft 365 OAuth lands)

### Cross-cutting — Type-change confirmation modal

**Path:** any typed leaf's surface (e.g., LEAF-GLW-30-PP) →
click "Change type" trigger.

**Expected:**
- Modal opens with backdrop dim
- Title "Change Product Type" + destructive copy ("Switching from
  Primary packaging discards all current spec values…")
- Radio list of available leaf-scope types EXCEPT current
- Pick a target → "Confirm · clears spec values" enables
- Confirm → "Changing…" → page re-renders with new type +
  empty spec values
- Cancel / Esc / outside-click dismisses

**Audit verification (post-change):**

```sql
select id, action, entity_type, entity_id, diff_json,
       caused_by_audit_id, created_at
 from audit_log
 where created_at > now() - interval '5 minutes'
   and action in (
     'leaf_spec_type_change',
     'leaf_spec_field_edit',
     'leaf_spec_create',
     'leaf_product_type_assigned'
   )
 order by created_at desc;
```

Expected:
- 1 root row with action `leaf_spec_type_change` (entity_id =
  leaf.id; diff_json has {from_type_id, to_type_id,
  cleared_field_count, current_spec_id})
- N derived rows with action `leaf_spec_field_edit` (one per
  non-null cleared field) with `caused_by_audit_id` = root id
  + `diff_json.source = 'type_change_clear'`

This verifies the cascade audit pattern works end-to-end.

## Cleanup after smoke

```sql
delete from assembly_leaves where id::text like '44444444-4444-4444-4444-44444444440%';
delete from assemblies where id::text like '33333333-%';
delete from leaf_specs where id::text like '22222222-%';
delete from leaves where id::text like '11111111-%';
```

## Known limitations + deferred items

| Item | Deferred to |
|---|---|
| Multi-field atomic save (single Save button vs autosave) | Future polish — current autosave model is canonical |
| Field-level diff modal on cascade warning | Future v1.5+ executive-approval gating |
| Version-pinning ("v4 · pinned by 2 active quotes") | impl-7 (Quote umbrella + NetSuite finalization) |
| Version history surface | impl-7 |
| App-side spec_values validation against type schema | Minimal validation shipped (unknown keys rejected); required-field enforcement requires schema declaration (none in v1 PP/SP/TP starters) |
| `leaf_archive` audit + UI flow | impl-5 (Phase 5 library browse) |
| `leaf_create` audit + UI flow | impl-4 (Phase 4 Add Product modal LEAF mode) |
| `leaf_spec_version_pin` audit | impl-7 (quote-pin events on send) |

## Status

All 12 steps committed on branch (Steps 5+8 folded into adjacent
commits; net 7 commits total covering 12 brief features).
Pattern 27 two-layer manifests across each commit document
structural + polish coverage.

End-of-phase CB smoke walk is the merge gate per standing
convention.
