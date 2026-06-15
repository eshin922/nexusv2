# Library-first creation flow · CC impl brief

**Slice name:** `slice-library-first-creation-flow`
**Status:** Brief draft. Ready for CC review.
**Date:** 2026-06-05
**Predecessor:** First-touch CB smoke on PR #50 surfaced empty-state
button confusion. Edward proposed library-first workflow restructure.

---

## Slice purpose

Restructure the "add something to a quote" workflow on the Setup
tree from **three coequal creation buttons** to a **library-first
search-or-create flow** that matches PM cognitive model.

**Current friction:** Setup card-head shows three coequal buttons
(+ Add product / ↗ Pull from HubSpot / + Add leaf from library) when
ASY tree is empty. PMs see no hierarchy or workflow order. Three
architecturally distinct workflows (quote-local ASY create, library
attach, HubSpot bulk pull) are exposed as parallel choices.

**Restructured flow:** Single primary CTA → library browse → search
finds what PM needs OR PM creates new from the empty search result
context. Pull from HubSpot relocates as secondary affordance inside
library modal header (the action that POPULATES the library PM is
browsing).

---

## Cognitive model alignment

PM intent on Setup tree is always "I need a component for this
quote." Three sub-paths from there:

| PM thought | Action |
|---|---|
| "Do I have this thing? Let me look." | Library search |
| "I don't. Let me create it." | "+ Create new" from search empty-state |
| "Library's stale. Let me refresh." | Pull from HubSpot inside library modal |

Restructured UI maps 1:1 to this model. Current UI requires PM to
already know which architectural entity they need before they look.

---

## Locked dispositions (from prior CA exchange)

| Q | Disposition |
|---|---|
| Single primary CTA on Setup card-head | Yes — `+ Add component →` (label TBD) |
| ASY vs LEAF distinction on create | Preserved — "+ Create new" inside library launches Add Product modal with existing ASY/LEAF mode toggle |
| Pull from HubSpot location | Moves into library modal header as secondary affordance |
| Library scope | LEAFs only (existing semantic preserved); ASYs stay quote-local |
| First-touch UX | Empty library accepted as one extra click — clarity worth the depth |

---

## Investigation ask (CC, before kickoff)

### 1. Current button surface inventory

- Setup card-head: confirm three buttons in code at
  `src/components/assembly-tree/assembly-tree-view.tsx`
- "+ Add product" — current trigger for Add Product modal
- "↗ Pull from HubSpot" — current trigger for
  `PullFromHubSpotTrigger` (Step 6 of PR #50)
- "+ Add leaf from library →" — current trigger for library
  browse modal

### 2. Library browse modal current scope

- File location of library browse modal component
- Current props it accepts
- Currently mounted target ASY picker — modal already supports
  picking which ASY to attach to (per impl-5)
- Current empty-state copy when search returns zero results

### 3. Add Product modal current invocation paths

- All call sites that mount `<AddProductModal>` or equivalent
- Confirm modal can be invoked as a sub-flow (mounted on top of /
  replacing library modal)
- Modal's close handler — does it support `onSuccess` callback
  that the library modal could intercept?

### 4. Pull from HubSpot trigger invocation

- Current mount point of `<PullFromHubSpotTrigger>`
- Component encapsulation — can it relocate into library modal
  header without refactor?
- Does it depend on Setup tree props (e.g., `projectId`) that
  library modal already passes?

### 5. PM permission gating

- Does library browse modal already check `assertCanCreateLeaves`?
- Does Add Product modal already check?
- Does Pull from HubSpot already check?
- After consolidation: single CTA on Setup tree should be gated by
  the most-permissive (PMs who can attach but not create still see
  the CTA, with "+ Create new" disabled inside library if their
  permissions don't allow create)

---

## UI changes

### Setup card-head — before vs after

**Before:**
```
.actions cluster:
  [+ Add product]  [↗ Pull from HubSpot]  [+ Add leaf from library →]
```

**After:**
```
.actions cluster:
  [+ Add component →]
```

Single primary CTA. Opens library browse modal.

Optional: keep "+ Add leaf from library →" footer affordance unchanged
(it's a secondary entry point lower in the card body, less visible).
Or remove for consistency. CC's call.

CA lean: remove footer affordance too. Single entry point;
predictable.

### Library browse modal — restructured

**New components/sections inside the modal:**

```
┌──────────────────────────────────────────────────────────┐
│  Library                            [↗ Refresh from HS]  │
│  Find or create a component for {scenario}               │
├──────────────────────────────────────────────────────────┤
│  Attach to: [GLW-30 ▾]                                   │
│  Search:    [_________________________]    Type: [All ▾] │
│  Scope:     [Any ▾]                                      │
├──────────────────────────────────────────────────────────┤
│  ☐ 30ml Glass Dropper Bottle · LEAF-GLW-30-PP   PP  ⤓HS │
│      Used by 2 ASYs across 1 scenario           [Attach] │
│  ☐ Folding Carton 200gsm SBS · LEAF-GLW-FCT     SP  ⤓HS │
│      Used by 3 ASYs across 1 scenario           [Attach] │
│  ...                                                      │
├──────────────────────────────────────────────────────────┤
│  No matches?                          [+ Create new] →   │
└──────────────────────────────────────────────────────────┘
```

Key changes:
- **Header:** modal title + sub-copy + relocated "↗ Refresh from
  HubSpot" affordance (small, secondary visual weight)
- **Filters:** ASY target picker + search + type + scope (existing)
- **Body:** results list (existing)
- **Footer:** "+ Create new" CTA always visible; prominent when
  search returns zero results

### Empty-state inside library modal

When search returns 0 results:

```
┌──────────────────────────────────────────────────────────┐
│  Library                            [↗ Refresh from HS]  │
│  Find or create a component for {scenario}               │
├──────────────────────────────────────────────────────────┤
│  Attach to: [GLW-30 ▾]                                   │
│  Search:    [matte black bottle____]                     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│           No components match "matte black bottle."       │
│                                                           │
│           Library has 47 components total.                │
│           Try a different search, or:                     │
│                                                           │
│              [+ Create new product →]                     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

Copy explicit about library size (47) so PMs understand search
narrowed it, not that library is empty.

When library is truly empty (first-touch):

```
┌──────────────────────────────────────────────────────────┐
│  Library                            [↗ Refresh from HS]  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│           Library is empty.                               │
│                                                           │
│           Start by creating your first product            │
│           or pulling the HubSpot catalog.                 │
│                                                           │
│              [+ Create new product →]                     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### "+ Create new" sub-flow

Click "+ Create new product" inside library modal → launches Add
Product modal:

Two implementation options:

- **(a) Replace library modal.** Library modal closes; Add Product
  modal opens in its place. On Add Product success: refresh
  library modal and re-open with new product highlighted /
  selected.

- **(b) Stack modals.** Add Product modal opens on top of library
  modal (deeper z-index, backdrop dims library further). On Add
  Product success: dismiss top modal, library refreshes
  underneath, new product visible.

CA lean: **(b) stack modals.** Preserves library context; PM
returns to where they were.

CC verifies modal stacking is feasible with current architecture.
If not, fall back to (a).

### "↗ Refresh from HubSpot" relocation

`<PullFromHubSpotTrigger>` moves from Setup card-head into
library modal header as small secondary affordance:

- Visual treatment: text link or small ghost button
- Same modal-pull-progress UX as PR #50 — opens overlay; PM stays
  in library context
- On completion: library modal refreshes with new products

### Card-head simplification

The `.actions` cluster on Setup card-head becomes single-button.
Removes visual noise; primary CTA reads cleanly.

If non-empty ASY tree state was previously showing all three
buttons for parity → simplifies there too. Single CTA always.

---

## Server actions — no changes

This is a UI restructure only. All existing server actions
(`createLeaf`, `attachAssemblyLeaf`, `pullFromHubSpot`) keep
current signatures and behavior. No schema changes.

Re-using:
- `createLeaf` (HubSpot-first push restored in PR #50)
- `attachAssemblyLeaf` (impl-5)
- `pullFromHubSpot` (PR #50)
- Library browse loader (impl-5; extended in PR #50 for HubSpot
  chip)

---

## Audit log — no changes

Existing audit namespace honors all flows. PM creates from search
context → `leaf_create` with `source: 'nexus_authored'` (current).
PM attaches existing leaf → `assembly_leaf_attach`. PM pulls →
`hubspot_pull_batch` + derived `leaf_create` rows.

---

## CB smoke scenarios

End-of-phase smoke covers PM workflow paths:

### LFC-1 · Library has the component (happy path)

- Open new quote, create one ASY scratch
- Click `+ Add component →` on Setup card-head
- Library modal opens with results
- Type "dropper" → results filter
- Click [Attach] on a matching leaf
- Verify leaf attaches to ASY; modal stays open; PM can attach more
- Close modal; tree refreshes showing attached leaf

### LFC-2 · Library doesn't have component, create new

- Open library modal
- Search "obscure unique term that won't match anything"
- Results empty; copy reads "No components match … Library has N
  components total."
- Click "+ Create new product →"
- Add Product modal opens stacked on top (or library closes and
  re-opens after; per CC implementation)
- Fill LEAF mode form; submit
- Verify Add Product modal closes; library modal shows new product
  highlighted
- Click Attach on new product
- Verify attach succeeds; tree refreshes

### LFC-3 · Library is empty (first-touch)

- Open brand-new quote with empty library (or new scenario in new
  project)
- Click `+ Add component →`
- Library modal opens with truly-empty state
- Copy reads "Library is empty. Start by creating your first
  product or pulling the HubSpot catalog."
- Click "+ Create new product →"
- Add Product modal opens; PM creates LEAF
- Library modal refreshes with new product visible
- PM can attach immediately or close

### LFC-4 · Pull from HubSpot from inside library modal

- Open library modal
- Click "↗ Refresh from HubSpot" in header
- Pull overlay opens (existing PR #50 UX)
- Wait for completion
- Library modal refreshes with newly-pulled products visible

### LFC-5 · ASY creation path preserved

- Click `+ Add component →` → library opens
- Click "+ Create new product →" inside library
- Add Product modal opens with ASY/LEAF mode toggle
- Toggle to ASY mode
- Fill ASY form; submit
- Verify new ASY appears in Setup tree (NOT in library — ASYs
  stay quote-local per existing semantic)
- Library modal does NOT show the new ASY (correct — library is
  leaves only)

### LFC-6 · Permission gating

- User with `can_create_leaves = false` but quote access
- Open library modal
- Verify attach affordances enabled (attach doesn't require
  create permission)
- Verify "+ Create new product" button disabled with tooltip:
  "You don't have permission to create new products. Ask an admin."
- Verify "↗ Refresh from HubSpot" disabled with similar tooltip
  (or hidden entirely; CC's call)

### LFC-7 · Card-head simplification

- Navigate to populated Setup tree (existing test fixture quote)
- Verify card-head shows ONLY `+ Add component →`
- Verify no "+ Add product" / "↗ Pull from HubSpot" / "+ Add leaf
  from library →" buttons remain

### Pre-walk DB sanity

```sql
-- Verify library has leaves to browse
select count(*)::int from leaves where archived = false;

-- Verify Setup card-head test fixture state
select count(*)::int as fixture_asys from assemblies
 where quote_id = 'f84334bd-afa1-4016-9511-71f7d5600e35';
```

---

## Step plan

Suggested commit grouping (CC discretion):

1. **Step 1** · Kickoff + investigation findings + Pattern 22 §0.5
2. **Step 2** · Library modal "+ Create new" affordance + empty-
   state copy variants
3. **Step 3** · Add Product modal stacking on top of library modal
   (or modal replacement if stacking infeasible)
4. **Step 4** · Pull from HubSpot trigger relocation into library
   modal header
5. **Step 5** · Setup card-head simplification (remove redundant
   buttons; consolidate to single `+ Add component →` CTA)
6. **Step 6** · Smoke guide + Pattern 27 wrap

---

## Pre-merge gates

- [ ] Typecheck PASS every commit
- [ ] Pattern 47 verify PASS every commit
- [ ] Pattern 22 §0.5 verification PASS (no schema additions
      expected; UI-only)
- [ ] Pattern 27 two-layer manifest per commit
- [ ] Pattern 28 N/A (canonical modal CSS reused; nexus-authored
      empty-state copy)
- [ ] Pattern 45 customer-view boundary clean (no PDF tree impact)
- [ ] CB end-of-phase smoke walk (merge gate)

---

## Carry-forwards (banked)

- **Search-driven AI suggestion** — when PM searches "matte black
  bottle" and no exact match, suggest closest matches by name +
  description fuzzy match — v1.1+
- **"Create from this search" pre-fill** — when PM clicks "+ Create
  new" from a search context, pre-fill the new-product name field
  with the search term — v1.5+ usability polish
- **Library categorization / folders** — visual grouping by type
  beyond filter — v1.1+
- **Recently used / favorites** — surface PMs' recent attaches at
  top of search results — v1.1+
- **Multi-select attach** — checkbox + bulk attach action — v1.1+

---

## Open questions for Edward (at brief lock time)

1. **Card-head CTA copy.** `+ Add component →` vs `+ Add to quote
   →` vs `+ Find component →` vs other. CA lean `+ Add component
   →` — describes intent without overspecifying entity. Confirm
   or override.

2. **"+ Add leaf from library →" footer affordance.** Remove
   (single entry point; predictable) or keep (secondary lower-
   visibility shortcut)? CA lean remove.

3. **Pull from HubSpot label.** "↗ Refresh from HubSpot" vs
   "↗ Pull catalog" vs other. CA lean "↗ Refresh from HubSpot" —
   describes effect (library refreshes) without overspecifying
   mechanism. Confirm or override.

4. **Modal stacking vs replacement on "+ Create new".** CA lean
   stacking. If CC investigation surfaces stacking is non-trivial
   in current modal architecture, fall back to replacement.

---

## Banking from this slice

**Pattern: PM cognitive model drives UI structure.** Three
architecturally distinct entities (ASY / LEAF / HubSpot Product)
were exposed as three coequal buttons. PMs think in tasks, not
entities. Library-first restructures around the task ("find or
create a component") rather than the entity.

Adds to standing patterns under UX discipline.

**Pattern: Empty-state copy explicit about library size.** When
filtered results return zero, distinguish "library is empty" from
"library has 47 items but none match your search." Different
states, different next actions.

Adds to standing patterns under empty-state discipline.

---

## Status

Brief draft. CC reviews, surfaces concerns. CA + Edward lock Q1-Q4
before kickoff.

Slot in v1 critical path: after PR #50 merges. CC discretion on
sequencing relative to FR-12 copy operations slice (both queued).

CA lean on sequencing: library-first first. Reasons:
- Smaller scope (UI-only; no schema; no new actions)
- Closes the immediate PM-UX friction CB surfaced
- FR-12 copy operations brief can absorb library-first UX
  conventions when it drafts
