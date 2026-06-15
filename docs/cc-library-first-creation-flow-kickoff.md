# slice-library-first-creation-flow · Step 1 kickoff

**Branch:** `slice-library-first-creation-flow`
**Step:** 1 (kickoff + investigation findings + Pattern 22 §0.5
verification)
**Date:** 2026-06-15
**Companion docs:**
- Brief: `docs/cc-comm-library-first-creation-flow-brief.md` (CA,
  2026-06-05; all 9 dispositions confirmed verbal Edward
  2026-06-15)
- Review: `docs/cc-comm-library-first-creation-flow-review.md` (CC,
  2026-06-15)
- Predecessor: PR #50 (slice-hubspot-bidirectional) merged
  2026-06-15 as `8e5ae41`. This slice opens on the surface state
  PR #50 leaves behind.

---

## §1 — Slice purpose

Restructure the Setup tree's "add something to a quote" workflow
from three coequal creation buttons (`+ Add product` ·
`↗ Pull from HubSpot` · `+ Add leaf from library →`) to a
**library-first search-or-create flow**: single primary CTA
opens the library browse modal; PM searches first; creates from
empty-state context if no match; Pull relocates as inline
progress band inside the library modal header.

UI-only restructure. Zero schema changes. Existing server actions
reused: `createLeaf`, `attachAssemblyLeaf`, `pullFromHubSpot`,
`loadLibraryBrowse`.

---

## §2 — Locked dispositions (Q1-Q9)

All 9 confirmed verbal Edward 2026-06-15, matching CC leans from
review. Reproduced here so the kickoff is self-contained.

| Q | Disposition |
|---|---|
| Q1 | CTA copy: **`+ Add component →`** |
| Q2 | Footer affordance `+ Add leaf from library →`: **remove** (single entry point; predictable) |
| Q3 | Pull label: **`↗ Refresh from HubSpot`** |
| Q4 | "+ Create new" sub-flow: **stack modals** (Add Product on top of Library; preserves library context) |
| Q5 | Pull-from-within-library presentation: **inline progress band** in library modal header (NOT a nested overlay; avoids three-deep modal stack) |
| Q6 | Permission gating: add `permissions: { canCreateLeaves: boolean }` prop to LibraryBrowseModal; render `+ Create new product` + `↗ Refresh from HubSpot` disabled with tooltip when `!canCreateLeaves`. Attach actions remain ungated at UI layer (server-side gate is canonical) |
| Q7 | Library total count surfacing: **extend `loadLibraryBrowse` loader** to return `libraryTotal` (single query bump; avoids second round-trip) |
| Q8 | Phase 1 dead-code cleanup (`src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx` + `sku-footer.tsx`): **bank as parallel work** post-slice; out of scope here |
| Q9 | Library-modal attach toast: **add inside LibraryBrowseModal** matching the `.a1v2-toast` pattern shipped on PR #50 commit 10. Copy: `Attached "{leaf name}" to {ASY sku}.` |

---

## §3 — Pattern 22 §0.5 verification ledger

Pre-build verification pass against current `main` (`8e5ae41` +
heap-bump `a09ecb8`). Seven catches dispositioned in the review,
all confirmed against current code state. No new catches surfaced
during this kickoff verification.

### Catch #1 — Two `AddProductModal` files (architectural)

Two distinct files exist:
1. `src/components/add-product/add-product-modal.tsx` — Phase A.1
   v2 impl-4. ASY/LEAF toggle, defer/continue split. Mounted via
   `AddProductTrigger` on the ASY tree. **This is the canonical
   modal the slice uses.**
2. `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx`
   — Phase 1 HubSpot-first 13-field form. Mounted via
   `sku-footer.tsx` + `sku-row.tsx`. **Dead code in
   canonical-scenario-create-flow.** Page comment at
   `src/app/projects/[id]/quotes/[quoteId]/page.tsx:252-256`
   confirms the SkuFooter chain was removed.

**Disposition:** slice proceeds against Phase A.1 v2 modal.
Cleanup of Phase 1 orphan is post-slice parallel work (Q8). Verify
during Step 3 that `AddProductTrigger` is the only active
`AddProductModal` mount in the canonical flow.

### Catch #2 — Modal stacking z-index collision (architectural)

`.a1v2-modal-backdrop { z-index: 100 }` (`r-a1v2-setup.css:457`).
Both LibraryBrowseModal and AddProductModal share this; stacking
relies on DOM order (later mount = on top).

**Disposition:** Step 4 ships Pattern 39 nexus extension class
`r-a1v2-modal-stacked { z-index: 110 }` in `r-a1v2-overrides.css`.
Escape handler on the stacked modal calls `e.stopPropagation()`
so the underlying modal's handler doesn't also fire.

### Catch #3 — Library browse modal empty-state copy (notation)

Current `LibraryBrowseModal` at
`src/components/library/library-browse-modal.tsx:276-287` renders
one string: "No leaves match the current filters." Brief proposes
splitting into "library empty" vs "filtered to zero" with
distinct CTAs.

**Disposition:** Step 2 extends `loadLibraryBrowse` (Q7) to return
`libraryTotal`. Modal renders one of two empty-state shapes based
on `libraryTotal === 0` vs `libraryTotal > 0 && rows.length === 0`.

### Catch #4 — `AddProductModal` lacks `onSuccess` callback (API gap)

Current props: `{ quoteId, projectId, open, onClose,
assemblyTypes, leafTypes }`. `onClose` fires on both successful
submit and cancel — caller can't discriminate. Library-first
flow needs to refresh library + highlight new product on
successful LEAF create.

**Disposition:** Step 3 extends `AddProductModal` with optional
`onSuccess?: (result: { kind: 'asy' | 'leaf', id: string }) =>
void`. Fires alongside `onClose` on successful create. Existing
mounts (no `onSuccess` prop) preserve current behavior.

### Catch #5 — `PullFromHubSpotTrigger` modal stack interaction (architectural)

`PullFromHubSpotTrigger` at
`src/components/assembly-tree/pull-from-hubspot-trigger.tsx`
renders its own modal (the pull-progress overlay). Brief option
"relocate into library modal header" risked three-deep modal
stack.

**Disposition:** Q5 chose option (β) inline progress band.
Step 5 refactors `PullFromHubSpotTrigger` to expose its pull state
as a controlled-component shape (props: `{ phase, totals,
errorMessage, onStart, onRetry, onClose }`). LibraryBrowseModal
embeds the progress UI inline in its header instead of nesting a
modal. The standalone trigger button (current Setup card-head
position) is removed in Step 6 — only one Pull entry point
remains.

### Catch #6 — Permission gating posture (architectural)

- Server actions properly gated:
  - `createLeaf` → `assertCanCreateLeaves` (leaves.ts:74)
  - `pullFromHubSpot` → `assertCanCreateLeaves` (hubspot-pull.ts:61)
  - `attachAssemblyLeaf` → `requireUser` (correctly not gated on
    create permission)
- UI components **don't gate**. Buttons render unconditionally;
  server-side guards catch failures and surface
  `ActionResult.error.message` inline.

**Disposition:** Step 3 + Step 5 + Step 6 plumb `permissions:
{ canCreateLeaves: boolean }` from the page-level fetcher through
`AssemblyTreeView` → `LibraryBrowseTrigger` → `LibraryBrowseModal`.
The `+ Create new product` button and the `↗ Refresh from HubSpot`
inline band render `disabled` with tooltip when permission is
false. Attach actions stay ungated at UI layer.

### Catch #7 — `{scenario}` placeholder semantic (notation)

Brief modal sub-copy: "Find or create a component for {scenario}".
Schema: `quotes.scenarioLabel text NOT NULL` — human-readable
scenario name PM uses (e.g., "Hydra Glow A · v2").

**Disposition:** fill with `quote.scenarioLabel`. Loader extension
in Step 2 surfaces this alongside `libraryTotal`.

---

## §4 — Step plan (locked)

Refined from review §4. Per-commit Pattern 27 two-layer manifest
required on every implementation commit.

1. ✅ **Step 1** — Kickoff + investigation + §0.5 verification
   (this document)
2. **Step 2** — `loadLibraryBrowse` extension: return
   `libraryTotal` + `scenarioLabel`; restructure LibraryBrowseModal
   empty-state copy into two-shape rendering (library-empty vs
   filtered-empty)
3. **Step 3** — `AddProductModal` `onSuccess` callback prop +
   `+ Create new product →` button + empty-state CTA inside
   LibraryBrowseModal footer; permission gating (`!canCreateLeaves`
   → disabled + tooltip)
4. **Step 4** — Modal stacking pattern: `r-a1v2-modal-stacked`
   nexus CSS extension + Escape `stopPropagation` on the stacked
   modal + attach-toast inside LibraryBrowseModal (matching the
   `.a1v2-toast` register PR #50 commit 10 shipped)
5. **Step 5** — Inline pull-progress band in LibraryBrowseModal
   header: refactor `PullFromHubSpotTrigger` to expose controlled
   pull-state props; LibraryBrowseModal renders progress + stats
   inline; `↗ Refresh from HubSpot` triggers via library modal
6. **Step 6** — Setup card-head simplification: remove the three
   current buttons (`+ Add product`, `↗ Pull from HubSpot`,
   `+ Add leaf from library →` footer); consolidate to single
   `+ Add component →` CTA opening LibraryBrowseModal
7. **Step 7** — Smoke guide (LFC-1 through LFC-7 from brief §CB
   smoke scenarios) + cumulative Pattern 27 manifest fold +
   §0.5 catch ledger

---

## §5 — Pre-merge gates

- [ ] Typecheck PASS every commit (`npx tsc --noEmit`)
- [ ] Pattern 47 verify PASS every commit (autosave focus-stability
      check on any new inputs; LibraryBrowseModal's search input
      is the existing instance to preserve)
- [ ] Pattern 22 §0.5 verification PASS (this kickoff; no further
      schema checks expected)
- [ ] Pattern 27 two-layer manifest per implementation commit
- [ ] Pattern 28 N/A (no R-round design source; canonical CSS
      reused; nexus-authored empty-state copy follows existing
      `.a1v2-*` register)
- [ ] Pattern 45 customer-view boundary clean (no PDF tree impact;
      LibraryBrowseModal is PM-internal)
- [ ] CB end-of-phase smoke walk LFC-1..LFC-7 (merge gate)

---

## §6 — Carry-forwards (banked, NOT in this slice)

From the review §3 + brief §carry-forwards:

- **Search-driven AI suggestion** — fuzzy match when search returns
  zero — v1.1+
- **"Create from this search" pre-fill** — pre-fill new-product
  name with search term — v1.5+ polish
- **Library categorization / folders** — v1.1+
- **Recently used / favorites** — v1.1+
- **Multi-select attach** — v1.1+
- **Phase 1 `add-product-modal.tsx` dead-code cleanup** (Q8) —
  standalone post-slice cleanup; UX_BACKLOG candidate
- **CSF-HBS-PATCH-3 Pull modal-gate** (CB banked during PR #50
  smoke) — this slice absorbs the underlying concern by relocating
  Pull into the library modal header inline; no separate work
  needed

---

## §7 — Predecessor state inherited

PR #50 merged 2026-06-15 (`8e5ae41`). On `main` post-merge:

- `slice-hubspot-bidirectional` migration 0032 + `leaves.
  hubspot_product_id` + indexes
- `createLeaf` HubSpot-first refactor + `pullFromHubSpot` action
- `PullFromHubSpotTrigger` modal (this slice refactors it into
  controlled-component shape per Catch #5)
- `LibraryBrowseModal` `⤓ HS` indicator chip (preserved unchanged)
- Empty-state hierarchy commit 11 (3 buttons all visible always
  with primary/ghost weights) — this slice replaces the card-head
  cluster entirely in Step 6
- LEAF/ASY toast `.a1v2-toast` positioning + JSX glyph + body
  shape (commit 10) — this slice's attach-toast (Step 4) reuses
  the same register

Heap bump `a09ecb8` from earlier today gives the dev environment
8GB headroom across the slice's HMR cycles. No further dev
infrastructure work expected.

---

## §8 — Standing by

Step 1 PASS. Cleared to proceed to Step 2 on Edward's next
directive.

Loader extension (`loadLibraryBrowse` → `{ rows, total,
libraryTotal, scenarioLabel }`) is the load-bearing change of
Step 2; everything else builds on its return shape.

— CC, 2026-06-15
