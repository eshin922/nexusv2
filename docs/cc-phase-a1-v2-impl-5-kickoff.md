# Phase A.1 v2 impl-5 — library browse + replenishment · kickoff

**Branch:** `slice-phase-a1-v2-impl-5-library-replenishment`
**Brief:** §5.5 Phase 5 (4-5 day estimate)
**Scenarios:** ⑰-㉒ (Group D · Library + replenishment per qw_data.js)

## Companion docs

- Canonical CSS: `src/styles/r-a1v2-setup.css` covers
  `.a1v2-library-*`, `.a1v2-version-stamp` rules
- Canonical JSX `docs/design-prototypes/dist/qw_a1v2.jsx`:
  - `LibrarySurface` (lines 682-690) — dispatcher
  - `LibraryBrowse` (692-753) — search + filters + results
  - `LeafReferences` (755-799) — already shipped (impl-3 SpecEntry
    header surfaces ref count)
  - `CascadeWarningDemo` (801-849) — already shipped (impl-3
    cascade-warning.tsx)
  - `ReplenishmentSurface` (852-903) — version-stamp comparison
- Designer notes Decision 4 (three-state replenishment pills) +
  Pushback 3 (tree-only IA gap — replenishment partially answers
  "compare across" workflow)

## Pattern 22 §0.5 verification

| Entity / column | Status | Notes |
|---|---|---|
| `leaves` table | ✓ present | impl-1; library is read-source for browse |
| `leaves.archived` | ✓ present | filter on archived=false for active set |
| `assembly_leaves` (junction) | ✓ present | impl-1; write target for attach |
| `assembly_leaves.id` unique on `(assembly_id, leaf_id)` | ✓ present | partial unique index; prevents duplicate attaches |
| `product_types` | ✓ present | type filter source |
| `audit_log` | ✓ present | `assembly_leaf_attach` action banked in CLAUDE.md namespace (first canonical wire here) |
| `quote_leaves.leaf_spec_version_id` (replenishment data) | ⚠ pre-impl-7 NULL | per CLAUDE.md "Versioning semantics" — drafts auto-update; pinning only happens at quote-send (impl-7 scope) |
| Replenishment prior-quote anchor | ⚠ missing | no `quotes.parent_quote_id` or equivalent column |

## Two Pattern-22 / Pattern-32 findings

**Finding 1: replenishment data flow is impl-7-gated.**
The three-state version stamps (unchanged / changed / new)
compare current quote's `quote_leaves.leaf_spec_version_id` to a
prior quote's. But pre-impl-7, NO quote has its `quote_leaves`
populated (drafts auto-update; pinning at quote-send is impl-7
scope). Comparing currently surfaces all-NULL on both sides →
no meaningful diff.

**Finding 2: prior-quote anchor mechanism missing.**
No `quotes.parent_quote_id` column or replenishment-link schema
exists. CD prototype uses a single hardcoded prior-quote ref
label ("QU-2024-0142"). For nexus, the anchor needs:
(a) New schema (`quotes.parent_quote_id`) + UI to declare which
prior quote a new quote replaces, OR
(b) Implicit anchor (most-recent OTHER quote in same project), OR
(c) PM-picks-at-render-time (no schema; just a query input)

## Disposition (CC call)

**Carve replenishment view (scenarios ㉑/㉒) to impl-7** where
pinning data naturally arrives. Impl-5 ships:

- Library browse (scenarios ⑰-⑱) — the primary load-bearing
  work
- `attachAssemblyLeaf` server action (write path; `assembly_leaf_attach`
  audit first canonical wire)
- "+ Add leaf from library" affordance wiring on Setup tree
  (impl-2 left inert)
- ⑲ Leaf reference count — already shipped in impl-3 SpecEntry
  header; verify + bank
- ⑳ Cascade warning — already shipped in impl-3 cascade-
  warning.tsx; verify + bank

Replenishment carved to impl-7 because:
1. Data flow (quote_leaves pinning) is impl-7 scope
2. Showing UI with no data is misleading; users would interpret
   "all unchanged" as canonical state when in fact there's no
   prior pin to compare
3. Prior-quote anchor schema decision deserves Edward + CA
   disposition; not a CC call

If Edward + CA prefer to ship the replenishment UI shell in
impl-5 (empty-state until impl-7 lands), I can lift via
follow-up commit.

## Step plan (7 commits)

1. **Step 1 — Kickoff + Pattern 22 §0.5 + replenishment carve**
2. **Step 2 — Library browse loader + attachAssemblyLeaf action**
   - `loadLibraryBrowse({ search, typeFilter, scopeFilter, quoteId })`
     server helper returning paginated leaf rows + global ref count
     + per-quote-attached flag
   - `attachAssemblyLeaf(formData)` server action: validates leaf
     not already attached to target ASY; INSERTs assembly_leaves;
     emits `assembly_leaf_attach` audit row
3. **Step 3 — Library browse client component**
   - `.a1v2-library-browse` chrome (search input + 3 selects)
   - `.a1v2-library-results` rows with leaf identity + type chip
     + ref count + attach CTA or "✓ in scenario"
   - ASY-target picker at the top (nexus extension; canonical
     hardcoded "+ Add to GLW-30")
4. **Step 4 — Wire "+ Add leaf from library" affordance on Setup
   tree** (impl-2 Step 4 left the button inert)
5. **Step 5 — Reference list surface** (scenario ⑲ already in
   impl-3 SpecEntry header but the FULL list rendering — per
   canonical LeafReferences lines 755-799 — may want a "View
   all references" expansion in the SpecEntry header)
   - May fold into Step 4 if scope is tight
6. **Step 6 — audit_log sweep + namespace docs**
   - `assembly_leaf_attach` already banked in CLAUDE.md; verify
     first-wire diff_json shape matches namespace docs
7. **Step 7 — CB smoke guide + Pattern 27 wrap**

## Carry-forwards (explicit)

- Replenishment view (scenarios ㉑/㉒) → impl-7 (Quote umbrella
  + NetSuite finalization; pinning lands there)
- Prior-quote anchor schema decision → impl-7 prep
- Cascade-warning verification on widely-referenced edits (⑳)
  → already shipped impl-3; verify in smoke
- Leaf archive + "view archived" filter → v1.1+ polish

## Next

Step 2 — server-side library loader + attach action.
Per-commit Pattern 27 manifest. End-of-phase CB smoke at Step 7.
