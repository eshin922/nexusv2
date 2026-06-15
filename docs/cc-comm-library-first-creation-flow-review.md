# Library-first creation flow · CC review

**Brief:** `docs/cc-comm-library-first-creation-flow-brief.md` (CA
draft, 2026-06-05).
**Branch (when kicked):** `slice-library-first-creation-flow`.
**Status:** Brief draft. CC review per Pattern 22 §0.5 standing
protocol — verification pass against current code architecture
before Edward + CA approve.
**Date:** 2026-06-15.

---

## §1 — Verdict

Brief is **load-bearing and well-scoped**. UI-only restructure;
zero schema changes; existing actions reused; cognitive-model
alignment is genuine (current 3-button state has empty-state
friction, surfaced first-touch on PR #50 CB walk).

**No blocking architectural issues.** Several scope refinements
and one dead-code observation surfaced. Open questions Q1-Q4 from
brief plus Q5-Q9 added by CC review. All dispositionable inline
with Edward + CA.

CC concur with CA's sequencing lean — library-first before FR-12
copy operations (smaller scope; closes the immediate friction; FR-
12 absorbs the new UX vocabulary).

---

## §2 — Pattern 22 §0.5 verification

Pre-approval pass against current `src/` for every code reference
the brief makes. Seven catches dispositioned below; same shape as
the slice-hubspot-bidirectional ledger.

### Catch #1 — Two `AddProductModal` files in codebase

**Architectural mismatch.** Brief references "Add Product modal"
as a singular entity. Two distinct files exist:

1. `src/components/add-product/add-product-modal.tsx` — Phase A.1
   v2 impl-4. ASY/LEAF mode toggle, defer/continue split for LEAF.
   Mounted via `AddProductTrigger` on the ASY tree
   (`assembly-tree-view.tsx`). **This is the modal the brief
   means.**
2. `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx`
   — Phase 1 (May 2026) HubSpot-first 13-field form. No ASY/LEAF
   toggle. Mounted via `sku-footer.tsx` + `sku-row.tsx`.

The Phase 1 modal at sku-footer is **dead code** in the v1
canonical-scenario-create-flow. Page comment at
`src/app/projects/[id]/quotes/[quoteId]/page.tsx:252-256`:

> canonical-scenario-create-flow Step 3 — every quote renders the
> new ASY/LEAF tree. Legacy `<div className="r7b-card">` SKU table
> \+ SkuRowList + SkuFooter chain removed alongside the read-path
> branching. AssemblyTreeView handles empty state internally.

`sku-footer.tsx` + the modal it mounts are no longer reachable
via any active route. **Banked as cleanup target** — out of
scope for this slice; UX_BACKLOG entry candidate.

**Disposition (CC lean):** brief proceeds against Phase A.1 v2
modal as the canonical Add Product modal. Cleanup of the Phase 1
orphan is parallel work (post-slice; UX_BACKLOG entry).

### Catch #2 — Modal stacking z-index collision

**Architectural verification.** Brief's CA lean: "(b) stack
modals" for the "+ Create new" sub-flow. Current canonical CSS:

- `.a1v2-modal-backdrop { position: fixed; inset: 0; z-index: 100 }`
  (`r-a1v2-setup.css:457`)
- Every modal in the surface (AddProductModal, LibraryBrowseModal,
  ScenarioCreateModal, etc.) uses this single backdrop class.

When stacked, both backdrops occupy `z-index: 100` → DOM-order
resolves which renders on top (later mount = on top), which works
visually. But:

1. **Backdrop dimming stacks** — two `oklch(0.10 0.01 255 / 0.55)`
   layers darken the background twice. Slight visual regression
   but acceptable.
2. **Escape key fires both listeners.** Both modals install
   `document.addEventListener("keydown")` on mount. Pressing
   Escape with both open closes BOTH. PM expects only the top
   modal to dismiss.
3. **Click-outside on backdrop** — top modal's backdrop click
   dismisses top modal correctly; the bottom modal's backdrop is
   under the top modal's so click-through can't reach it (correct
   behavior emerges naturally from z-index DOM order).

**Disposition (CC lean):** ship stacking with a small Pattern 39
nexus extension:

- Add nexus class `r-a1v2-modal-stacked` to the stacked-on-top
  modal's backdrop, with `z-index: 110` (above the `100` base)
- Escape handler on the stacked modal stops propagation
  (`e.stopPropagation()`) so the underlying modal's handler
  doesn't fire
- Document the pattern in `r-a1v2-overrides.css` so future
  stacking scenarios reuse the convention

Trivial. ~20-line addition. Brief's "(b) stack modals" is
feasible.

### Catch #3 — Library browse modal empty-state copy

**Notation gap (brief assumes; current code single-states).**
Current modal (`src/components/library/library-browse-modal.tsx:276-287`)
renders one empty-state string: "No leaves match the current
filters." Brief proposes splitting:

- **State A** — library has items, filter returns zero
  ("No components match "{search}." Library has N components
  total.")
- **State B** — library genuinely empty (first-touch)
  ("Library is empty. Start by creating your first product…")

Implementation requires the loader to return library total count
(currently returns only filtered count via the trimmed result).

**Disposition (CC lean):** Step 2 of the slice extends
`loadLibraryBrowse` to return `{ rows, total, libraryTotal }`
where `libraryTotal` = `select count(*) from leaves where
archived = false` (unfiltered). Trivial; one extra query in
parallel with the existing rows fetch.

### Catch #4 — `AddProductModal` lacks `onSuccess` callback

**API gap (brief asks; doesn't exist).** Brief §3 asks "Modal's
close handler — does it support `onSuccess` callback that the
library modal could intercept?" Answer: **no.**

Current `AddProductModal` props:
```ts
{ quoteId, projectId, open, onClose, assemblyTypes, leafTypes }
```

`onClose` fires regardless of submit success vs cancel-without-
submit. To intercept "PM just created a LEAF — refresh the
library browse + highlight the new product," the library modal
needs to know:

- Whether the close was a successful submit or a cancel
- The new `leafId` so it can scroll-to / highlight

**Disposition (CC lean):** Step 3 of the slice extends
`AddProductModal` with an optional `onSuccess?: (result: { kind:
'asy' | 'leaf', id: string }) => void` callback. When provided,
fires alongside `onClose` on successful create. When absent,
preserves current behavior (no impact on non-stacked invocations).

### Catch #5 — `PullFromHubSpotTrigger` modal stack interaction

**Architectural concern (brief assumes seamless relocation).**
`PullFromHubSpotTrigger` (`src/components/assembly-tree/pull-from-hubspot-trigger.tsx`)
already renders its own modal (the pull-progress overlay). When
relocated into the library modal header:

- PM clicks "↗ Refresh from HubSpot" in library modal header
- Pull-progress overlay opens (modal #3 on the stack? or
  replaces the library modal?)

Three layered modals (Setup tree → Library → Pull-progress) is
a UX smell. The brief says "PM stays in library context" — which
means the pull overlay should appear on top, library stays open
underneath.

**Disposition (CC lean):** Use the Catch #2 stacking pattern
extended — three-deep stack:
- Library modal: `z-index: 100` (base)
- Pull-progress overlay: `z-index: 110` (stacked)
- Tier reserved: `z-index: 120` (if Add Product stacks WHILE Pull
  is running — edge case; can be prevented by disabling "+ Create
  new" while Pull pending)

Alternatively (cleaner): when PM triggers Pull, library modal
shows an inline progress band in its header instead of opening a
nested overlay. PMs see Pull running without losing library
context, no modal triangulation. CC lean toward inline progress
band over nested overlay — surfaces to Edward + CA.

### Catch #6 — Permission gating posture

**Verification.** Brief §5 asks about permission gates. Current
state:

- **Server actions** are properly gated:
  - `createLeaf` → `assertCanCreateLeaves` (`src/app/actions/leaves.ts:74`)
  - `pullFromHubSpot` → `assertCanCreateLeaves` (`src/app/actions/hubspot-pull.ts:61`)
  - `attachAssemblyLeaf` → uses `requireUser` (no `canCreateLeaves`
    check — attach doesn't require create permission, which is
    correct semantically)
- **UI components do NOT gate.** Grep across
  `src/components/library/`, `src/components/add-product/`,
  `src/components/assembly-tree/` for `canCreateLeaves` returns
  zero matches. UI buttons render unconditionally; server-side
  guards catch permission failures and surface
  `ActionResult.error.message` to the user.

**Disposition (CC lean):** brief Open Question 6 (permission
gating consolidation) is right to call out. Slice should add:

- New `permissions: { canCreateLeaves: boolean }` prop on
  `LibraryBrowseModal` (and the AddProductTrigger that nests it)
- "+ Create new product" button rendered `disabled` with tooltip
  when `!canCreateLeaves`
- "↗ Refresh from HubSpot" same treatment (also gated server-
  side on `canCreateLeaves`)
- Attach actions remain ungated at UI level (correct per
  server-side semantic)

Plumbing: page-level fetcher reads `user.canCreateLeaves` from
session; passes through `AssemblyTreeView` to nested triggers.
~30-line additive change; no schema, no action layer impact.

### Catch #7 — Sub-copy `{scenario}` placeholder semantic

**Notation question.** Brief modal sub-copy uses `{scenario}`
placeholder: "Find or create a component for {scenario}". What
fills this?

Schema check: `quotes.scenarioLabel text NOT NULL` is the human-
readable scenario name (e.g., "Hydra Glow A · v2"). Versions
within a scenario share the label.

**Disposition (CC lean):** fill with `quote.scenarioLabel` — PM-
facing label, matches how PMs talk about scenarios. Edward
confirm or override.

---

## §3 — Open Questions (CC additions to brief Q1-Q4)

### Q5 — Three-deep modal stack vs inline progress band

(From Catch #5.) When PM triggers Pull from inside library modal:

- **(α) Three-deep stack:** Setup → Library → Pull-progress
  overlay. Existing PullFromHubSpotTrigger renders unchanged;
  z-index: 110 on the stack-on-top.
- **(β) Inline progress band:** Library modal header shows pull
  progress inline (batches · added · updated · archived stats)
  without opening a nested modal. PM stays visually in library.

**CC lean: (β) inline progress band.** Cleaner UX. Catch #5 fix
shape.

### Q6 — Permission gating UI layer (from Catch #6)

Brief §5 already asks about consolidated gating. CC concur — add
`permissions` prop to `LibraryBrowseModal` + render disabled
states with tooltips for create-restricted PMs. Server-side
guards remain authoritative.

### Q7 — Library total count surfacing (from Catch #3)

Loader change required. Confirm:
- (α) Return `libraryTotal` field on the bundle (CC lean — single
  loader query bump; trivial)
- (β) Separate `getLibraryTotal()` action called by modal on open
  — second roundtrip

CC lean: (α). Saves a round trip.

### Q8 — Phase 1 `add-product-modal.tsx` dead-code cleanup

`src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx`
(+ `sku-footer.tsx`, sku-row.tsx AddProductModal references) are
orphan code in the canonical scenario create flow. Banked here so
the slice doesn't accidentally fix-in-place; cleanup is a separate
parallel workstream.

**Disposition (CC lean):** bank as UX_BACKLOG entry post-slice;
don't touch this slice. Cleanup PR can be scoped separately.

### Q9 — Add Product modal's existing toast UX

Just-shipped patch (PR #50 commit 10) repositioned the
AddProductModal toast as fixed bottom-right. When the modal opens
stacked on top of library, the toast on success appears at the
bottom-right of the viewport (correct). When the user attaches a
library leaf, the library modal needs its OWN toast pattern.

**Disposition (CC lean):** Step 4 of the slice adds matching
toast UX inside LibraryBrowseModal:
- "Attached '{leaf name}' to {ASY sku}." on successful attach
- Same `.a1v2-toast` register; fixed bottom-right
- Auto-dismisses 3s

Trivial. Reuses existing CSS + toast pattern.

---

## §4 — Step plan refinement

Brief's 6-step plan is structurally sound. CC's adjustments:

1. **Step 1** · Kickoff + investigation + Pattern 22 §0.5 (this
   document satisfies most; verification ledger lands in
   kickoff doc)
2. **Step 2** · `loadLibraryBrowse` extension — return
   `libraryTotal` + restructured empty-state copy in
   `LibraryBrowseModal` ("library empty" vs "filtered to zero")
3. **Step 3** · `AddProductModal` `onSuccess` callback + "+ Create
   new" button inside LibraryBrowseModal footer/empty-state
4. **Step 4** · Modal stacking pattern — `r-a1v2-modal-stacked`
   nexus extension + Escape stop-propagation + attach-toast in
   library modal
5. **Step 5** · Inline pull-progress band in library modal
   header (replaces relocating PullFromHubSpotTrigger as nested
   overlay) — touches the existing trigger to expose its progress
   state as a controlled component
6. **Step 6** · Setup card-head simplification — remove all three
   current buttons; consolidate to single `+ Add component →` CTA
7. **Step 7** · Smoke guide (LFC-1..LFC-7) + Pattern 27 wrap

Inserted a step (became 7); merged Catch #3 + Catch #4 + Q9 work
into Steps 2-4 naturally.

---

## §5 — Acceptance / sequencing

**No blockers.** Brief is approvable pending Edward + CA
dispositions on Q1-Q9. CC stands by to kick off Step 1 once
the brief is patched inline with dispositions.

**Sequencing concur:** library-first before FR-12 copy
operations. Smaller scope; closes immediate PM-UX friction
surfaced on PR #50; FR-12 brief absorbs the new vocabulary.

**Prereq verification:** PR #50 must merge before this slice
opens — the HubSpot pull infrastructure (PullFromHubSpotTrigger,
pullFromHubSpot action, `leaves.hubspot_product_id`) lands on PR
#50 and is referenced throughout this slice.

— CC, 2026-06-15
