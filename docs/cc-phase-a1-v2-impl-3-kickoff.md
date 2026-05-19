# Phase A.1 v2 impl-3 — Spec entry surface · kickoff

**Branch:** `slice-phase-a1-v2-impl-3-spec-entry`
**Brief:** §5.3 Phase 3 (5-6 day estimate)
**Scenarios:** ⑤-⑩ (Group B · Spec entry per qw_data.js)

## Companion docs

- Canonical CSS: `src/styles/r-a1v2-setup.css` (imported in impl-2;
  reuses for impl-3 — same canonical CSS file covers spec entry
  rules at lines 281+)
- Canonical JSX: `docs/design-prototypes/dist/qw_a1v2.jsx` —
  `SpecEntry` (lines 280-345), `TypePicker` (347-369),
  `PlaceholderPanel` (371-382), `SpecPanel` (384-405),
  `VersionHistoryCard` (407-441), `CascadeWarningDemo` (801-850)
- Canonical fixtures: `docs/design-prototypes/dist/qw_data.js` —
  product_types field_schemas (PP/SP/TP), leaf scenarios
- Designer notes: `docs/cd-quote-workflow-a1-v2-designer-notes.md`
  — §3 "Edit specs is type-aware", Design Decision 2 ("Two
  placeholders, not one"), Pushback 2 ("Cascade warning is
  informational, not blocking")

## Pattern 22 §0.5 verification — PASS

Impl-3 reads + writes these schema entities; all verified present:

| Entity / column | Status | Notes |
|---|---|---|
| `leaves` table | ✓ present | impl-1 |
| `leaves.product_type_id` | ✓ present | write target for type-change |
| `leaves.archived` | ✓ present | read-only in impl-3 |
| `leaf_specs` table | ✓ present | impl-1 |
| `leaf_specs.spec_values` (jsonb) | ✓ present | primary write target |
| `leaf_specs.is_current` | ✓ present | partial unique enforces 1-current |
| `leaf_specs.version_number` | ✓ present | bumped on quote-pin events |
| `leaf_specs.effective_from` / `effective_to` | ✓ present | versioning |
| `leaf_specs.created_by` (uuid, NOT NULL) | ✓ present | every insert needs this |
| `product_types` table | ✓ present | 17 rows seeded impl-1 |
| `product_types.field_schema` (jsonb) | ✓ present | read for panel render |
| `product_types.placeholder` (bool) | ✓ present | drives placeholder panel |
| `product_types.scope` (enum) | ✓ present | filter to leaf-scope types |
| `assembly_leaves` | ✓ present | read for ref-count |
| `assemblies` + `quotes` | ✓ present | read for cascade-warning context |
| `users.can_edit_specs` | ✓ present | gate via assertCanEditSpecs (impl-1) |
| `audit_log` | ✓ present | actions per CLAUDE.md namespace |

**Audit actions in scope (already banked in CLAUDE.md):**
- `leaf_spec_create` — first-time spec values on a leaf
- `leaf_spec_field_edit` — single-field update (most common during
  edit; cascade pattern via caused_by_audit_id for N-field saves)
- `leaf_spec_type_change` — Product Type changed (rare; discards
  prior spec_values per Pattern 32 pre-prod tolerance)

**Audit actions in scope NOT yet wired (future):**
- `leaf_spec_version_pin` — system event on quote send (impl-7
  scope: Quote umbrella + NetSuite finalization)

## Routing — per-quote URL with leaf id

Brief doesn't specify; canonical CD prototype is opinion-light on
routing. Decision (CC call):

```
/projects/:id/quotes/:qid/leaves/:leafId/specs
```

Rationale:
- Library scope is preserved at the data layer (no quote_id on
  leaves table); URL nesting is a routing convenience for PM
  workflow context (back-nav to Setup of the originating quote)
- Matches sibling pattern (/projects/.../quotes/.../setup, /costs,
  /pricing, /quote, /mark-accepted)
- Future "library browse" surface (impl-5 Phase 5) gets a global
  URL `/leaves` for cross-quote browsing; spec entry stays per-
  quote-anchored

If Edward + CA disagree, route can flip to global with returnTo
param: `/leaves/:leafId/specs?returnTo=...`. Decision deferred to
Step 12 smoke if no early redirect.

## Step plan (12 commits)

1. **Step 1 — Kickoff + Pattern 22 §0.5 verification + plan doc**
2. **Step 2 — Route scaffolding + leaf data loader**
   `loadLeafForSpecEntry(leafId)` server-side helper returning
   leaf + product_type + current leaf_spec + reference count +
   cascade context
3. **Step 3 — SpecEntry surface chrome** (scenario ⑤ + ⑥ structural)
   - .a1v2-leaf-header with icon + name + meta line (SKU · v
     version · cost · refs · FSC if claim)
   - Right cluster: completeness chip + type tag
4. **Step 4 — SpecPanel field-grid renderer** (scenario ⑤ PP complete
   + ⑥ SP partial)
   - Reads product_type.field_schema; renders text input or
     textarea based on field-key heuristic (per canonical line 395-
     398: `additional` / `description` / `packout` → textarea)
   - "{filled} of {total} fields" caption per panel
5. **Step 5 — Save action + Pattern 47 controlled inputs**
   `updateLeafSpec` server action: assertCanEditSpecs guard +
   leaf_specs UPSERT (in-place update on current row per CLAUDE.md
   "Versioning semantics" — version bump deferred to quote-pin
   events, not field-edits)
   - Per-field cascade audit pattern: root `leaf_spec_field_edit`
     audit row + N derived rows per changed field, linked via
     `caused_by_audit_id`
6. **Step 6 — PlaceholderPanel** (scenario ⑦ + ⑧ Soft goods + TP)
   - "fields TBD · pending schema" stub for placeholder types
   - Same .a1v2-placeholder-panel canonical structure
7. **Step 7 — TypePicker empty state** (scenario ⑨)
   - .a1v2-type-picker with ∅ glyph + leaf-type options
   - Click → confirm type assignment → trigger initial leaf_spec_create
     audit row + render the panel for that type
8. **Step 8 — RLS read-only treatment** (scenario ⑩)
   - assertCanEditSpecs guard on action layer (existing from impl-1)
   - readOnly prop disables all inputs at component level
   - .a1v2-rls-banner with 🔒 glyph + role-based copy
9. **Step 9 — Type change confirmation modal** (per brief §4.10
   of CA brief; designer notes "discards prior spec_values" warning)
10. **Step 10 — Cascade warning modal** (canonical CascadeWarningDemo)
    - Pre-save modal when leaf is widely referenced; lists referencing
      ASYs with sent/draft status; informational only (Pushback 2)
11. **Step 11 — Audit log sweep + completion check**
    - Verify cascade pattern (root + derived rows via
      caused_by_audit_id) works for multi-field saves
    - Confirm `leaf_spec_create` fires on first-time entry
12. **Step 12 — Smoke fixtures + CB smoke guide + Pattern 27 wrap**
    - Fixture seed adds scenario ⑤-⑩ exercising states (already
      partially set in impl-2 smoke seed: complete PP + partial SP
      + placeholder TP + no_type leaf are all live)
    - Smoke guide walks all 6 scenarios

## Risk + open items

- **Versioning semantics during edit**: per CLAUDE.md "leaf_specs"
  block lines 1763-1777, edits during quote authoring UPDATE the
  current row's spec_values in-place (no version bump). Quote-pin
  events (impl-7) close + version-bump the row. Impl-3 implements
  the in-place UPDATE path only.
- **App-side validation**: brief calls for `spec_values` validation
  against `field_schema`. Minimum-viable: reject keys not in schema;
  required-field enforcement (when type declares `required: true`)
  follows once any type declares required fields (none in current
  v1 PP/SP starters).
- **Type-picker assignment vs type-change**: TypePicker fires on
  no-type leaves (initial assignment); type-change modal fires on
  already-typed leaves switching type. Different audit actions
  (`leaf_spec_create` vs `leaf_spec_type_change`).

## Companion polish items (deferred)

Per impl-2 dispositions (carry-forward):
- "1 leaves" plural-always grammar (Pattern 28 fidelity to canonical)
- Drag-handle hit area refinement (landed in PR #43)
- /setup route alias (landed in PR #43)

## Next

Step 2 starts now (route scaffolding + leaf data loader).
Per-commit Pattern 27 two-layer manifest per standing protocol.
End-of-phase CB smoke at Step 12.
