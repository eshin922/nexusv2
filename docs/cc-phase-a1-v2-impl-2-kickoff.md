# Phase A.1 v2 impl-2 — Setup IA shift · kickoff

**Branch:** `slice-phase-a1-v2-impl-2-setup-ia`
**Brief:** §5.2 Phase 2 (5-6 day estimate)
**Companion docs:**
- CD canonical CSS: `docs/design-prototypes/dist/qw_styles.css` (877 lines)
- CD canonical JSX: `docs/design-prototypes/dist/qw_a1v2.jsx` (1384 lines)
- CD fixtures: `docs/design-prototypes/dist/qw_data.js` (612 lines)
- Designer notes: `docs/cd-quote-workflow-a1-v2-designer-notes.md`
- Data source map: `docs/cd-quote-workflow-a1-v2-data-source-map.md`

## Open question — scenario numbering (surfaced + proceeding with brief read)

Edward's kickoff note: "Impl-2 visual verification against CD prototype
scenarios ⑤-⑩ per impl brief §5."

Brief §5.2 (Phase 2 — Setup IA shift) explicit scope says scenarios
**①-④**. Brief §5.3 (Phase 3 — Spec entry surface) says scenarios
**⑤-⑩**. Per CD's scenario index in `qw_data.js`:

- ①-④ → Group A · ASY tree (matches Phase 2 scope: tree view, leaf
  context menu, ASY context menu, rollup completeness)
- ⑤-⑩ → Group B · Spec entry (Phase 3 scope: PP complete, SP partial,
  Soft goods placeholder, Tertiary placeholder, no-type picker, RLS
  readonly)

**CC read:** branch name + Phase 2 brief scope point to scenarios
**①-④** (Setup IA shift). Edward's mention of ⑤-⑩ likely a typo
(Spec entry is Phase 3). Proceeding with ①-④ per brief §5.2; will
redirect if Edward intended scope expansion to scenarios ①-⑩
(combined Phase 2+3).

## Pattern 22 §0.5 verification — PASS

Impl-2 writes to these schema entities; all verified post-impl-1:

| Entity | Status | Notes |
|---|---|---|
| `assemblies` | ✓ present | new in impl-1; PR #41 |
| `leaves` | ✓ present | new in impl-1 |
| `assembly_leaves` | ✓ present | new in impl-1 |
| `product_types` | ✓ present | 17 rows seeded in impl-1 |
| `assemblies.internal_notes` | ✓ present | per brief §5.2 "Per-SKU notes" |
| `assemblies.position` | ✓ present | drag-to-reorder write target |
| `assembly_leaves.position` | ✓ present | drag-to-reorder write target |
| `users.can_edit_specs` | ✓ present | reads not write in impl-2 |
| `audit_log` | ✓ present | 8 new namespaced actions per CLAUDE.md |
| `--paper-4` token | ✓ present | drop CD's local 0.92 override; use nexus 0.925 |

Code-architecture verification:
- Pattern 30 path-B-default applies (qw_styles.css uses `.a1v2-*`
  prefix-clean selectors throughout; verbatim verbatim adoption safe)
- Read-path branching per brief §4.2 Step 6: existing quote rendering
  unchanged when no `assemblies` rows; new rendering when present

## Step plan (12 commits)

1. **Step 1 — Pattern 30 path-B-default canonical CSS adoption**
   - Copy `qw_styles.css` → `src/styles/r-a1v2-setup.css` verbatim
   - Drop CD's local `--paper-4` override (use nexus tokens)
   - Drop `.a1v2-state-strip` (R-round review chrome per CLAUDE.md
     "R-round prototype state strips are review aids, not production
     UI")
   - Import into Setup page; add bridge if any missing tokens surface

2. **Step 2 — Data plumbing (assemblies + assembly_leaves + leaves +
   product_types)**
   - Server-action helper to load tree shape per quote
   - Detect "new schema path" via `assemblies` row presence
   - Branch read paths cleanly; existing `quoteSkus` path untouched

3. **Step 3 — DOM order shift**: SKUs section to top, Tiers below

4. **Step 4 — ASY tree render (scenarios ① + ④)**: parent rows,
   nested LEAF children, completeness rollups (no leaves / partial /
   all complete / mixed)

5. **Step 5 — Type chips**: ASY filled blue / LEAF outline

6. **Step 6 — ASY context menu (scenario ③)**: Edit product /
   Duplicate / Move position / Edit specs disabled (with caption) /
   Delete cascade

7. **Step 7 — LEAF context menu (scenario ②)**: Edit specs primary
   (accent-tinted) / Move up-down / Assign to parent / View library
   record / Delete from this ASY (with library-stays caption)

8. **Step 8 — Per-SKU notes + HAS NOTE chip**: textarea writes
   `assemblies.internal_notes`; Pattern 47 focus stability

9. **Step 9 — Drag-to-reorder**: writes `assemblies.position` +
   `assembly_leaves.position`; Pattern 47 invariants

10. **Step 10 — Header counter + buttons**: "N SKUs · M assemblies"
    + "+ Add product" button + "Pull from HubSpot" button (no "Pull
    from inventory" per Edward disposition)

11. **Step 11 — Audit log wiring**: `assembly_leaf_attach` +
    `assembly_leaf_detach` actions; cascade pattern via
    `caused_by_audit_id`

12. **Step 12 — Comprehensive smoke + Pattern 27 manifest**:
    visual fidelity vs scenarios ①-④; Designer audit invocation
    if drift surfaces

Per-commit fidelity manifest (Pattern 27 two-layer) on each step
per standing protocol.

## Risk + open items

- **New-quote rendering smoke** requires an existing quote with
  `assemblies` rows. Until impl-2 ships the write path (Steps 2-10),
  smoke happens via SQL-inserted fixture rows in the shared DB OR a
  Step 0 "seed dev fixture" path. Will surface preference at Step 4.
- **Drag-to-reorder library choice**: `@dnd-kit` (already in repo
  per earlier slices?) vs hand-rolled HTML drag-and-drop. Will
  inspect deps at Step 9.
- **Read-path branching trigger**: presence of `assemblies` rows is
  the canonical detector. If a quote has BOTH legacy `quote_skus` AND
  new `assemblies` rows (shouldn't happen in v1, but Pattern 32
  pre-prod tolerance), assemblies wins.

## Next

Step 1 starts now (canonical CSS adoption). Manifest-per-commit
discipline per Pattern 27.
