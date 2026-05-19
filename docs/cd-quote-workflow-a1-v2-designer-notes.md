# Quote Workflow A.1 v2 — Designer notes (ASY/LEAF model + library)

> **A.1 v2** layers on top of Phase A. The Quote umbrella 4+1 sub-tabs, persistent PDF panel, and action-cluster grammar all stay shipped. v2 replaces iter 1's SKU-level specs model with **ASY/LEAF** + **globally-reusable leaf library** per Edward's recalibration.

## The load-bearing distinction

Cost-stack tree has two node types:

- **ASY** = quotable SKU. Has commercial fields (unit price, margin, markup, tax schedule). ASY-level Product Type for **categorization** (Skincare / Supplement / Body). **No specs.** Per-scenario.
- **LEAF** = reusable component nested under ASYs. Has identity + leaf-level Product Type for **spec rendering** + spec values. **Globally reusable across scenarios.** Versioned. Library item.

Iter 1 had specs at the SKU level (one product = PP panel + SP panel). v2's correct shape: **one SKU = N leaves; specs live per leaf, scoped by leaf's product_type.**

## What survived from iter 1 (visual language, 100%)

| Element | Iter 1 | v2 |
|---|---|---|
| Completeness chips | Per product | Per leaf (with type-aware completeness rule) + ASY rollup |
| Empty state ∅ glyph | Per product | Per leaf — also drives type-picker when leaf has no type |
| RLS read-only banner | Per product | Per leaf |
| PDF addendum 2-column layout | One block per product | Sub-block per leaf, grouped under ASY headers |
| Version-pinning meta | Per product | Per leaf (with cross-quote pinning) |
| Cascade warning | Active-quotes list per product | Active-references list per leaf (`scenario · ASY · status`) |
| Soft gate | Per-SKU detail | Per-leaf detail with type-aware status copy |
| "Pull from HubSpot" | Per product | Now per leaf (library reference) |
| Audit export modal + CSV preview | Per quote · per product | Per quote · per leaf (with library audit scope) |
| Page-head + eyebrow + DN callout | Phase A grammar | Unchanged |

## What changed (the 5 conceptual shifts per recalibration brief)

### 1. Setup > SKUs page is a tree

ASYs as parent rows; LEAFs as nested children (one indent level). Each leaf row carries: SKU pill · name + qty/cost meta · type tag · cross-reference count · completeness chip · context-trigger.

The leaf-row tree connector (vertical rule + L-elbow) reads cleanly without claiming nested-leaves-under-leaves until that becomes a real workflow (the `parent_assembly_leaf_id` column is in the schema so deeper nesting can ship later).

### 2. Leaf context menu owns `Edit specs`

Leaf context menu: `Edit specs` (primary, accent-tinted) · Move up / down · Assign to parent · View library record · Delete from this ASY (with "library leaf stays" caption so PMs don't think they're nuking the canonical record).

ASY context menu: `Edit product · Duplicate · Move position · Edit specs (disabled · leaves only) · Delete ASY (cascade)`. The disabled `Edit specs` row stays in the menu so PMs who try to edit specs at the ASY level get explicit feedback rather than missing affordance.

### 3. Edit specs is type-aware

Reads `leaf.product_type_id`, looks up the type's `field_schema`, renders the matching panel.

- **PP (10 fields):** full panel with the existing field set
- **SP (11 fields):** same pattern
- **Soft goods + Tertiary packaging (placeholders):** render a stub panel — accent-tinted type-name pill + "fields TBD · Edward provides field list iteratively" copy. Pattern is the same as PP/SP; only the schema is pending
- **No type set:** type-picker empty state with all available leaf types, each with field-count meta ("10 fields" / "fields TBD")

### 4. Library is global; references are visible

Leaves are globally scoped (no `scenario_id` on `leaves` table). `assembly_leaves` junction tracks many-to-many.

Surfaces that expose the library shape:
- **Library browse** under the tree on Setup — search by name/SKU/type, filter by scenarios. Each row shows reference count + an `+ Add to {ASY}` CTA for unreferenced leaves
- **Leaf reference count** in spec entry header: "Used in N ASYs across M scenarios"
- **Cascade warning** on edit: lists each referencing ASY with sent/draft status. Sent quotes stay pinned; drafts auto-update
- **Replenishment view** with version-stamp pills (`v4 · unchanged since QU-2024-0142` / `v5 · changed since QU-2024-0142 (was v4)` / `new since QU-2024-0142`)

### 5. PDF addendum renders per-leaf, grouped by ASY

```
[Addendum header — "Product specifications"]

  [ASY block · GLW-30 · Hydra-Glow Vitamin C Serum 30ml · 5 LEAFs]
    [Leaf sub-block · Primary packaging — 10 fields]
    [Leaf sub-block · Secondary packaging — 11 fields]
    [Leaf sub-block · Soft goods · fields TBD · placeholder]
    [Leaf sub-block · untyped · no specs render]
    [Leaf sub-block · Tertiary packaging · fields TBD · placeholder]

  [ASY block · GLW-50 · ...]
  [ASY block · RPL-200 · ...]
  [ASY block · CAP-60 · ...]
```

Mixed types in one ASY render naturally — each leaf's `product_type` drives its sub-block layout. Empty fields render `--`. Placeholders render a centered "fields TBD · pending schema" stub message. Untyped leaves render "No Product Type set · specs cannot render."

## Six design decisions worth documenting

### 1. Type taxonomy with `scope` flag (per Q-Type3 disposition)

Single `product_types` table, one row per type, `scope` enum (`assembly` | `leaf`). ASY-scope types have `field_schema: null` (no specs at ASY level — categorization only). Leaf-scope types have populated `field_schema` (or `placeholder: true` for TBD types).

Architect may prefer two separate tables. Same end design; the prototype's data shape uses the unified table for simpler reference.

### 2. Two placeholders, not one

Per CD R7-confirm refinement: **Soft goods + Tertiary packaging** as placeholders, not just one. The visual switch between PP (10 fields) → SP (11 fields) → Soft goods (placeholder) → Tertiary (placeholder) demonstrates the type-aware mechanism. One placeholder alone would let CC read it as "PP/SP are real, everything else is the same one stub" — two placeholders confirm the system varies per `leaf.product_type_id`.

The 4 other leaf types (Component / Assembly sub-component / Service / Other) are in the taxonomy but `hidden: true` in fixtures — they exist for the type-picker dropdown demo, not as standalone scenarios. Edward's iterative field-list rollout doesn't need 8 placeholder scenarios.

### 3. Leaf sub-blocks in the addendum use a paper-2 inner card

Iter 1's addendum had one large product block per SKU. v2's addendum has nested sub-blocks — each leaf wears `paper-2` inner card chrome with its own type-tag + version stamp header. Visually distinguishes the ASY hierarchy from the leaf hierarchy without doubling the page count.

For wide-field leaves (PP/SP with 10+ fields), the sub-block uses a 2-column grid. Single-section types (one panel) get full-width within the sub-block. Pattern handles arbitrary field counts as types land.

### 4. Replenishment version stamp uses three states, not just "unchanged/changed"

Three explicit pill states:
- `unchanged · v4 · since QU-2024-0142` (good-tinted)
- `changed · v5 · since QU-2024-0142 (was v4)` (warn-tinted) + `View diff` button
- `new · v1 · since QU-2024-0142` (paper-3 muted) — leaf added after the prior reference quote

The third state matters: a PM looking at the replenishment view wants to know "what's new compared to last time" as much as "what changed." The new-pill makes that visible.

### 5. Add Product modal mode toggle uses card-style segmented control

Two prominent cards across the top of the modal, each with `lab` (ASY / LEAF) and `desc` (one-line consequence). Active card gets paper-bordered + shadow + accent-tinted text. The visual weight signals that this is a mode toggle, not a sub-tab — different fields appear below based on selection.

LEAF mode shows a `Continue to specs → / Add leaf · specs empty` choice in the footer when a Product Type is selected. The defer CTA is the secondary affordance; primary is forward-into-specs.

### 6. Modal-closes → canonical Edit specs surface (per Q-Type6)

The "Continue to specs" CTA closes the modal and opens the Edit specs surface for the new leaf. Single canonical entry surface across all 3 entry points (context menu, modal flow, library browse). Multi-step modals were considered and rejected — they fork the spec entry surface design, which doesn't scale across the 8 leaf types.

The scenario ⑭ in the prototype demonstrates this: clicking through modal LEAF mode → Continue to specs shows the new leaf in the same `SpecEntry` surface that the tree-context-menu route lands on.

## Three pushbacks

### Pushback 1 · Cross-scenario library scope may surprise PMs who think leaves are quote-scoped

When PM creates a new leaf in Scenario A and goes to Scenario B next week, the leaf is already in the library — easy to add. Easy enough that a PM might accidentally reference a leaf they intended to be one-off. The library browse affordance helps (search before create) but it's opt-in. v1 ships with the broad library; v1.1 could add a "private to this scenario" flag if real workflow shows accidental cross-scenario references are a problem. Flagged for first-month measurement.

### Pushback 2 · Cascade warning is informational, not blocking — same risk as iter 1's soft gate

When PM edits a widely-referenced leaf's specs, the cascade warning lists referencing ASYs with sent/draft status. The PM has to confirm the save, but the warning doesn't block. Sent quotes stay pinned (correct); drafts auto-update (correct). The risk: a PM dismisses the warning, saves, and a draft quote that was 90% pricing-locked now references new specs that imply cost changes.

The current design doesn't block this. v1 trusts the PM to read the cascade list. v1.5+ executive-approval gating per Aisha 1:1 backlog covers the worst case but adds friction PMs don't always want. Worth measuring: how often do PMs save through the cascade warning without reviewing the referencing list?

### Pushback 3 · Tree-only IA hides "compare across SKUs" workflow

PMs asking "are all my products using the same factory?" need to scan across ASYs. v2's tree IA puts each ASY's leaves under that ASY — to compare, the PM expands all and scans manually. The Library browse view answers this question (filter by factory, see all leaves + which ASYs use them) but it's a side trip from the tree.

A "flat leaves view" toggle on the SKUs page would let PMs flip between tree (default — context-rich) and list (factory/type/usage comparisons easier). v1 ships tree-only; flat view is a v1.1 candidate if real workflow surfaces the gap.

## Considered and rejected

- **Multi-step modal for LEAF creation.** Step 1 = identity, step 2 = specs in same modal. Felt cluttered; PMs juggling spec entry alongside identity entry. Replaced with modal-closes → canonical Edit specs (Q-Type6 disposition).
- **Single combined surface for both ASY + LEAF spec entry.** Even though ASYs don't have specs, a unified "product detail" surface was considered — toggle to "edit child leaves." Rejected: the IA conflation is exactly what iter 1 got wrong. Specs are leaf-scoped; the surface should be too.
- **Inline expansion of leaves within the ASY row** (master/detail UI). Considered making the ASY row expand inline to show specs of all its leaves at once. Too dense — a 5-leaf ASY would produce a 100+ field accordion. The tree view + drill-into-leaf-spec-entry-on-click pattern reads cleaner.
- **Field-level diff modal on cascade warning.** When PM edits a widely-referenced leaf, the warning could show a per-field diff before save. Deferred to v1.5+. v1 trusts PM to know what they're saving; spec changes appear in audit log post-save.
- **Library lock indicator** on referenced leaves. Could show a 🔒 icon when leaf is referenced by any sent quote. Felt like noise; the per-scenario reference list inside the cascade warning provides the same information when it matters.

## Feature commitments out of v2

1. **`product_types` table** with scope flag (assembly/leaf) and JSONB field_schema. New types ship via row insert (no DDL).
2. **`leaves` table** globally scoped — library items reusable across scenarios.
3. **`assembly_leaves` junction** with `quantity`, `position`, optional `parent_assembly_leaf_id` for future deeper-nesting.
4. **`leaf_specs` table** with `spec_values` JSONB + versioning. App-side validation against `product_types.field_schema`.
5. **`quote_leaves` junction** with `leaf_spec_version_id` populated at send (null for drafts).
6. **8 new audit log actions** (`leaf_spec_field_edit`, `leaf_spec_type_change`, `leaf_spec_create`, `leaf_spec_version_pin`, `leaf_create`, `leaf_archive`, `assembly_leaf_attach`, `assembly_leaf_detach`).
7. **`caused_by_audit_id` cascade pattern** carries forward from iter 1.
8. **RLS permissions**: `can_edit_specs` + `can_create_leaves` flags on `users`.

## Carry-forward to v1.1+

- **HubSpot deal-level → product-level migration** (Edward Q2 disposition)
- **Time-range global audit export** (admin panel surface)
- **Executive approval gating** for spec changes on active quotes
- **Field-level diff modal** on cascade warning
- **Flat-leaves view** on SKUs page (compare-across workflow)
- **"Private to scenario" flag** for one-off leaves
- **Leaf archive UX** — soft-archive workflow + view-archived browse
- **Bulk leaf-spec editing** when multiple leaves share the same supplier/material
- **Per-product default toggle** for addendum (currently per-quote)
- **Side-by-side spec diff** on the replenishment view's `View diff` button
