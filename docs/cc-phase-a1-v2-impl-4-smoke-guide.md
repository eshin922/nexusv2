# Phase A.1 v2 impl-4 — CB smoke guide

**Branch:** `slice-phase-a1-v2-impl-4-add-product`
**Scope:** CD prototype scenarios ⑪-⑯ + Add Product modal behaviors
**Date:** 2026-05-19

## Prep — no new fixtures

Impl-4 ships the Add Product modal which CREATES rows. The
existing impl-2 + impl-3 seed data (target quote
`f84334bd-afa1-4016-9511-71f7d5600e35`) is sufficient as a
canvas — new ASYs / leaves get added on top.

If the dev DB accumulates too many smoke artifacts, clean up
after each pass:

```sql
-- Cleanup new ASYs created by smoke walks (anything not in the
-- canonical fixture range 33333333-...01..04):
delete from assemblies
 where quote_id = 'f84334bd-afa1-4016-9511-71f7d5600e35'
   and id::text not like '33333333-%';

-- Cleanup new library leaves (anything not in the canonical
-- 11111111-...01..05 fixture range):
delete from leaves where id::text not like '11111111-%';
```

## Smoke walks

Navigate to the Setup tree at:
`/projects/ff8c04f2-50b7-4207-98a0-53b44c85ab90/quotes/f84334bd-afa1-4016-9511-71f7d5600e35/setup`

Click **+ Add product** in the SKUs card-head .actions cluster.
The modal opens in ASY mode by default (canonical scenario ⑪).

### Scenario ⑪ — Modal · ASY mode · commercial fields

**Expected on open:**
- Backdrop dim overlay
- Modal title: "Add product · ASY"
- Sub-copy: "Creates a new product/SKU in this scenario. Leaves
  get attached separately."
- Mode toggle: ASY active (accent-tinted .active class) /
  LEAF idle
- ASY fields rendered:
  - **Product name** (required, asterisk)
  - **ASY Product Type** select (Skincare / Supplement / Hair
    care / Color cosmetics / Body care / Beverage / Pet care /
    Household / Other — 9 options from §15.1)
  - **SKU** (optional, placeholder "auto-generated if blank")
  - **Description** textarea (optional)
  - **Unit price / Unit cost / Markup %** triple
- Footer left: "⌥ Leaves added separately via the tree"
- Footer right: Cancel + "Add product" primary

**Interactions:**
- Type a product name → primary stays enabled
- Leave name blank + click "Add product" → inline error
  "Product name is required."
- Fill name "Test ASY for smoke walk" + select a type + click
  "Add product" → primary shows "Adding…" → modal closes →
  toast appears at bottom-right: "Added Test ASY for smoke
  walk to this quote." → Setup tree refreshes with the new
  row at the bottom

**Verify in DB (post-add):**
```sql
select sku, name, product_type_id, position
  from assemblies
 where quote_id = 'f84334bd-afa1-4016-9511-71f7d5600e35'
 order by position desc limit 3;

select action, diff_json
  from audit_log
 where action = 'assembly_created'
 order by created_at desc limit 1;
```
Expected: 1 new row with auto-generated SKU "ASY-f84334bd-N";
audit row with diff_json carrying the full snapshot.

### Scenario ⑫ — Modal · LEAF mode · no type selected

**Path:** Open modal → click LEAF mode toggle button.

**Expected:**
- Title shifts to "Add product · LEAF"
- Sub-copy: "↗ Creating a globally reusable library item ·
  available across all scenarios"
- LEAF fields rendered (Leaf name / Leaf Product Type / SKU /
  Unit cost / URL)
- Type select shows "— Pick a type —" + 4 leaf-scope options
  (Primary packaging · 10 fields / Secondary packaging · 11
  fields / Tertiary packaging · 10 fields / Soft goods · fields
  TBD)
- Hidden types (component / assembly_sub / service / other)
  NOT in the picker
- "Next step" preview card NOT rendered (no type selected)
- Footer left: "⌥ Specs entered next step · or defer"
- Footer right: Cancel + **"Pick a Product Type"** primary
  rendered inert (opacity 0.5 + cursor not-allowed via impl-3
  patch round CSS rule)

### Scenario ⑬ — Modal · LEAF mode · PP type · Continue to specs

**Path:** Scenario ⑫ → select "Primary packaging · 10 fields".

**Expected:**
- "Pick a Product Type" inert button replaced with TWO buttons:
  - **"Add leaf · specs empty"** ghost
  - **"Continue to specs →"** primary
- "Next step" preview card appears with copy: "Continue to
  specs renders the `Primary packaging` field set (10 fields)."
- Selecting Soft goods instead → preview card shows
  placeholder variant: "The `Soft goods` field schema is
  pending Edward's input. Ship the leaf empty for now;
  populate when fields land."

**Interaction:**
- Type leaf name "Smoke walk leaf · PP"
- Select Primary packaging
- Click **"Continue to specs →"** → primary shows "Adding…" →
  modal closes → URL navigates to
  `/projects/.../quotes/.../leaves/<newLeafId>/specs` →
  impl-3 SpecEntry surface renders with:
  - Header "Smoke walk leaf · PP"
  - Type tag "PRIMARY PACKAGING"
  - Completeness chip "⚠ No specs entered" (empty state)
  - SpecPanel with 10 empty PP fields

This is the Q-Type6 disposition end-to-end (modal-closes →
canonical Edit specs surface; same SpecEntry component
regardless of entry point).

### Scenario ⑭ — Modal-closes → Edit specs surface opens

Already covered by scenario ⑬ Continue path. Verifies:
- Modal unmounts cleanly (no orphaned backdrop)
- router.push lands on the leaf's spec entry URL
- New leaf's specs are editable from there

### Scenario ⑮ — Modal · LEAF mode · defer specs (empty)

**Path:** Open modal → LEAF mode → fill name + select type →
click **"Add leaf · specs empty"**.

**Expected:**
- Primary shows "Adding…" → modal closes → toast appears:
  "Added <name> to the library · specs deferred."
- NO navigation away from Setup
- Setup tree refreshes; new leaf doesn't appear in any ASY
  (library-only; not attached)

The Setup tree doesn't currently render library leaves that
aren't attached to an ASY — that's impl-5 (Phase 5 library
browse) territory. Verification of the leaf landing is via:

```sql
select id, name, sku, product_type_id, archived
  from leaves
 where id::text not like '11111111-%'
 order by created_at desc limit 3;

select action, diff_json
  from audit_log
 where action = 'leaf_create'
 order by created_at desc limit 1;
```

### Scenario ⑯ — Library-scope copy + post-creation toast

Covered cumulatively by scenarios ⑫-⑮:
- LEAF mode sub-copy "↗ Creating a globally reusable library
  item · available across all scenarios" verified at modal
  open (scenarios ⑫-⑮)
- Post-creation toast verified at ASY-add (scenario ⑪) AND
  LEAF-defer (scenario ⑮); LEAF-continue navigates away so
  toast suppressed (PM lands on spec surface instead)

### Modal close paths

Verify dismiss behaviors:
- **Escape key** while modal open → closes (when !pending;
  during in-flight save, Escape is blocked)
- **Backdrop click** (outside the modal card) → closes
  (when !pending)
- **Cancel button** → closes immediately
- **Submit success** → closes + toast/nav (per mode)

### Permission gating (Bug-#K-adjacent)

The trigger button itself respects the `editable` boolean
(quote.status === 'draft'). On a non-draft quote, the button is
disabled with title "Quote is not draft — editing disabled".

LEAF creation specifically requires `users.can_create_leaves`
OR admin role (assertCanCreateLeaves gate). Edward (admin
implicit-pass) can always create; non-admin users without the
flag get a structured error from the action layer:
"You don't have permission to create library leaves." Modal
displays the error inline above the footer.

### Audit verification

After exercising the scenarios, the audit log should show
the new rows:

```sql
select id, action, entity_type, entity_id, diff_json, created_at
  from audit_log
 where created_at > now() - interval '15 minutes'
   and action in ('assembly_created', 'leaf_create')
 order by created_at desc;
```

`assembly_created` rows: entity_id = new assembly.id;
diff_json snapshot has all commercial fields.
`leaf_create` rows: entity_id = new leaf.id; diff_json has
identity + initial fields + created_by.

## Phase wrap — Pattern 27 cumulative manifest

**STRUCTURAL coverage (4 commits across 9 steps):**
- Step 1 — Kickoff + Pattern 22 §0.5 verification
- Step 2 — createAssembly + createLeaf server actions
- Steps 3-7 — Add Product modal client component (modal shell,
  mode toggle, ASY/LEAF forms, submit handlers, library-scope
  copy, post-creation toast) folded into one commit
- Step 8 — Trigger button wiring + product-type loader +
  audit namespace docs
- Step 9 — Smoke guide + this manifest (current commit)

**POLISH coverage (Pattern 28 verbatim from canonical):**
- .a1v2-modal-backdrop / .a1v2-modal / -head / -body / -foot
  hierarchy
- .a1v2-mode-toggle ASY/LEAF segmented control with .active class
- ASY/LEAF mode sub-copy verbatim
- "↗ Creating a globally reusable library item · available
  across all scenarios" lib-scope copy
- Button labels: "Add product" / "Continue to specs →" /
  "Add leaf · specs empty" / "Pick a Product Type" / "Cancel"
- Footer left captions: "⌥ Leaves added separately via the
  tree" / "⌥ Specs entered next step · or defer"
- "Next step" preview card framing + placeholder vs typed-with-
  schema variant copy
- .a1v2-toast post-creation surface

**Audit log namespace coverage:**
- `leaf_create` ✓ (Step 2; first canonical wire of the
  impl-1-banked action)
- `assembly_created` ✓ (Step 2; banked in CLAUDE.md at Step 8)

**Pattern 47 invariants:**
- Controlled inputs/textareas/selects throughout
- `disabled={pending}` confined to buttons (input-only rule
  honored)
- Modal close paths respect !pending guard

## Pre-merge gates

- [x] Typecheck PASS every commit
- [x] Pattern 47 verify PASS every commit
- [x] Pattern 22 §0.5 verification PASS (kickoff with one
      Pattern 32 finding for tax_schedules)
- [x] Pattern 27 two-layer manifest per commit
- [x] Pattern 28 verbatim copy from canonical
- [x] Pattern 30 path-B-default (no new canonical CSS; reuses
      impl-2 r-a1v2-setup.css modal rules)
- [ ] CB end-of-phase smoke walk (merge gate)

## Carry-forwards

Deferred per brief + smoke scope:
- "↗ Pull from HubSpot" wiring → impl-5 or follow-up
- Owner select on ASY/LEAF modal → v1 polish (single-user dev
  doesn't exercise the picker meaningfully)
- Tax schedule field → Pattern 22 finding (no tax_schedules
  table); v1.1+ candidate
- Library browse + "+ Add from library" attach flow → impl-5
- HubSpot deal-level → product-level migration → v1.1+
