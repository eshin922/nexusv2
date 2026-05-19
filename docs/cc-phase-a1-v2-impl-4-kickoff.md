# Phase A.1 v2 impl-4 — Add Product modal · kickoff

**Branch:** `slice-phase-a1-v2-impl-4-add-product`
**Brief:** §5.4 Phase 4 (3-4 day estimate)
**Scenarios:** ⑪-⑯ (Group C · Add Product modal per qw_data.js)

## Companion docs

- Canonical CSS: `src/styles/r-a1v2-setup.css` (already imported;
  reuses `.a1v2-modal-*` rules at lines ~470+)
- Canonical JSX: `docs/design-prototypes/dist/qw_a1v2.jsx`:
  - `AddProductModal` (lines 445-508)
  - `AsyModalFields` (510-567)
  - `LeafModalFields` (569-627)
  - `AddProductStep2` (629+ — Step 2 SpecEntry-style surface
    after LEAF "Continue to specs"; nexus reuses the impl-3
    SpecEntrySurface for this destination)
- Designer notes: `docs/cd-quote-workflow-a1-v2-designer-notes.md`
  Design Decision 5 (card-style segmented control) + Decision 6
  (modal-closes → canonical Edit specs per Q-Type6)

## Pattern 22 §0.5 verification — PASS with one Pattern-32 finding

| Entity / column | Status | Notes |
|---|---|---|
| `assemblies` table | ✓ present | impl-1 |
| `assemblies.sku` | ✓ present | unique per quote |
| `assemblies.name` | ✓ present | required |
| `assemblies.product_type_id` | ✓ present | FK → product_types |
| `assemblies.description` | ✓ present | optional |
| `assemblies.unit_price` / `unit_cost` | ✓ present | numeric |
| `assemblies.markup_pct` | ✓ present | numeric(5,4) |
| `assemblies.tax_schedule_id` | ⚠ present but no FK | nullable uuid; no `tax_schedules` table exists |
| `assemblies.owner_id` | ✓ present | FK → users |
| `assemblies.position` | ✓ present | auto-assign max+1 |
| `leaves` table | ✓ present | impl-1 |
| `leaves.name` / `sku` / `product_type_id` / `unit_cost` / `owner_id` / `url` | ✓ present | per impl-1 schema |
| `audit_log` actions | partial | `leaf_create` banked in CLAUDE.md namespace (impl-1); `assembly_created` is NEW — wired in this slice + banked in Step 8 |

**Pattern 32 finding — tax_schedules:** `assemblies.tax_schedule_id`
exists as nullable uuid with no FK reference to any
`tax_schedules` table (which doesn't exist). CD prototype shows
"Default (US — wholesale)" / "EU VAT" hardcoded options, but
nexus has no backing schema for these.

**Disposition (CC call):** drop the Tax schedule field from the
impl-4 modal. The column stays nullable; a future admin tool /
tax-schedule slice can populate it. Banking as a v1.1+ candidate.
If Edward + CA disagree, lift back into a follow-up commit.

## Step plan (9 commits)

1. **Step 1 — Kickoff + Pattern 22 §0.5 verification + plan doc**
2. **Step 2 — Server actions:** `createAssembly`, `createLeaf`
   - Both gated by `assertCanEditSpecs` for LEAF create (per
     `users.can_create_leaves` flag) + permission helper for ASY
     create (admin / quote-draft owner)
   - `createAssembly` writes assemblies row + emits
     `assembly_created` audit (parallels `assembly_deleted` from impl-2)
   - `createLeaf` writes leaves row + emits `leaf_create` audit
     per CLAUDE.md namespace (banked impl-1, first wire impl-4)
3. **Step 3 — Modal shell + mode toggle**
   - `.a1v2-modal-backdrop` + `.a1v2-modal` chrome
   - `.a1v2-mode-toggle` card-style segmented control
     (ASY / LEAF buttons; active class drives accent treatment)
   - Open/close state + Escape + backdrop-click dismiss
4. **Step 4 — ASY mode form + submit**
   - Scenario ⑪ — commercial fields (name, product type, SKU,
     description, unit_price, unit_cost, markup_pct, owner)
   - Tax schedule field DROPPED (Pattern 32 finding above)
   - Submit → createAssembly action → close modal → revalidate
     Setup tree
5. **Step 5 — LEAF mode form + leaf type picker + "Next step"
   preview card**
   - Scenarios ⑫ / ⑬ / ⑮ — leaf name, type select, SKU, unit
     cost, owner, URL
   - "Next step" preview card showing what Continue/Defer will do
     (placeholder/non-placeholder type)
6. **Step 6 — LEAF submit + "Continue to specs" navigation flow**
   - Scenarios ⑬ / ⑭ — "Continue to specs" closes modal +
     navigates to /projects/.../leaves/<newLeafId>/specs
   - Scenario ⑮ — "Defer specs" closes modal silently;
     leaf saved with no spec values
   - Q-Type6 disposition: same canonical SpecEntry surface
     regardless of entry point (impl-3 surface reused)
7. **Step 7 — Library-scope copy + post-creation toast (scenario ⑯)**
   - LEAF mode header sub-copy: "↗ Creating a globally reusable
     library item · available across all scenarios"
   - Post-creation toast affirming library-scope (sticks ~3s)
8. **Step 8 — Wire "+ Add product" button in Setup tree +
   audit log sweep + namespace docs**
   - Assembly tree's inert button (impl-2 Step 10) lights up
   - CLAUDE.md update: `assembly_created` action banked
9. **Step 9 — CB smoke guide + Pattern 27 wrap manifest**

## Risk + open items

- **Modal portal-escape (Pattern 30 namespace-scoped variant)** —
  The modal renders via React portal? The canonical uses inline
  rendering with `.a1v2-modal-backdrop` as a top-level div. Since
  Phase A.1 v2 CSS uses prefix-clean selectors (Path-B-default),
  no portal-escape collision risk. If portal mounting becomes
  needed for layering reasons, ensure the `.a1v2-page` parent
  class travels with it.
- **`createLeaf` permission gate** — uses `assertCanCreateLeaves`
  (impl-1 helper). Initial sign-in default is `false`; only
  admin role bypasses. For dev DB smoke, Edward is admin so
  permission gate auto-passes.
- **assembly_created audit action name** — not in original 8
  namespace banked impl-1 (those covered spec/library/junction
  lifecycle). Adding as standalone like `assembly_deleted` did.

## Carry-forwards

Per brief — out of impl-4 scope:
- "Add leaf from library" affordance (attach existing library leaf
  to an ASY) → impl-5 (Phase 5 library browse + replenishment)
- Pull from HubSpot → impl-4 stretch OR impl-5 (depends on whether
  HubSpot import has product-type implications)
- `quote_leaves` per-quote pinning → impl-7 (Quote umbrella +
  NetSuite finalization)

## Next

Step 2 starts now (server actions). Per-commit Pattern 27 manifest.
End-of-phase CB smoke at Step 9.
