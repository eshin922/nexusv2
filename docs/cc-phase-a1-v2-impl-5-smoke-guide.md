# Phase A.1 v2 impl-5 — CB smoke guide

**Branch:** `slice-phase-a1-v2-impl-5-library-replenishment`
**Scope:** scenarios ⑰-⑳ (⑦/⑧ verified) + library browse + attach
**Date:** 2026-05-19

## Prep — no new fixtures

The impl-2/3/4 seed data is sufficient. Library browse will show
the 5 fixture leaves (LEAF-GLW-30-PP / LEAF-GLW-FCT / LEAF-GLW-TP
/ LEAF-GLW-UNK / LEAF-GLW-SG) plus any leaves Edward created via
impl-4's modal.

If clean-slate needed: re-apply `0030_phase_a1_v2_impl2_smoke_fixtures.sql`
+ `0031_phase_a1_v2_impl3_smoke_fixtures.sql` + `0033_impl3_smoke_revert.sql`
in sequence.

## Smoke walks

Target: Setup surface for the seeded quote
`/projects/ff8c04f2-50b7-4207-98a0-53b44c85ab90/quotes/f84334bd-afa1-4016-9511-71f7d5600e35/setup`

### Scenario ⑰ — Add existing library leaf to ASY

**Path:**
1. Scroll to the bottom of the SKUs card → click **+ Add leaf
   from library →** in the .a1v2-library-affordance footer
2. Library browse modal opens
3. Pick target ASY from the dropdown at the top (e.g.,
   "GLW-30 · Hydra-Glow Vitamin C Serum 30ml")
4. Find a leaf NOT yet on GLW-30 (e.g., LEAF-GLW-FCT which is on
   GLW-50 + RPL-200)
5. Click **+ Add to GLW-30**

**Expected:**
- Button shows "Adding…" → completes
- Row flips to "✓ on this ASY" inline state
- Behind the modal, Setup tree refreshes (after close) to show
  the new junction
- Audit log row:

```sql
select id, action, entity_type, entity_id, diff_json, created_at
  from audit_log
 where action = 'assembly_leaf_attach'
 order by created_at desc limit 1;
```

Expected diff_json shape: `{"assembly_id": "...", "leaf_id":
"...", "quantity": "1", "position": <max+1>}` per CLAUDE.md
namespace doc.

### Scenario ⑱ — Library search · by name / SKU / type / factory

**Path:** Open library browse modal.

**Interactions:**
- Type "dropper" into search → 300ms debounce → row filtered to
  LEAF-GLW-30-PP only (matches name)
- Clear search → all 5 fixture leaves return
- Type "FCT" → only LEAF-GLW-FCT (matches SKU)
- Clear → set Type filter to "Secondary packaging (SP)" → only
  LEAF-GLW-FCT matches
- Clear → set Scope filter to "This scenario only" → only leaves
  attached to assemblies in the current quote remain (all 5
  fixture leaves once impl-2 seed plus attach actions are in)
- Set Scope filter to "Used elsewhere" → leaves not attached
  to ANY ASY in this quote (typically 0 in dev DB unless other
  quotes have shared leaves)

**Audit:** read-only; no new audit rows fire from filter changes.

### Scenario ⑲ — Leaf header · reference count

**Path:** Setup tree → any LEAF row's ⋯ → Edit specs → SpecEntry
surface opens.

**Expected (already shipped impl-3):**
- Header meta line includes "Referenced by N ASYs"
- N reflects the total assembly_leaves rows pointing at this
  leaf (cross-quote count via `leaf-spec-loader`'s references
  array length)

For LEAF-GLW-30-PP: should show "Referenced by 2 ASYs" (GLW-30
+ GLW-50 from impl-2 seed) + any additional attaches from this
smoke walk.

For LEAF-GLW-FCT: should show "Referenced by 2 ASYs" (GLW-50
+ RPL-200) or "3 ASYs" if scenario ⑰ attached it to GLW-30.

### Scenario ⑳ — Edit widely-referenced leaf · cascade warning

**Path:** Continue from scenario ⑲. SpecEntry surface for a leaf
with > 1 reference shows the cascade warning above the card.

**Expected (already shipped impl-3 cascade-warning.tsx):**
- ⚠ banner: "{leaf name} is used in {N} ASYs across {M}
  scenarios."
- "sent quotes stay pinned" vs "draft quotes auto-update"
  distinction
- Per-reference rows: scenario · ASY · status

For impl-5 verification: confirm the banner renders for
LEAF-GLW-30-PP (2 refs) and LEAF-GLW-FCT (2-3 refs).

### Scenarios ㉑/㉒ — Replenishment view (CARVED to impl-7)

Per kickoff disposition, replenishment view is deferred to
impl-7 because:
1. Three-state version stamps need `quote_leaves.leaf_spec_version_id`
   populated (impl-7 pinning at quote-send)
2. Prior-quote anchor schema decision deserves Edward + CA
   disposition

NOT smoke-walked in this PR; the carve is the smoke outcome.

## Audit log sweep verification

After exercising scenarios ⑰-⑳, this query should return rows
matching the impl-5 audit shape:

```sql
select action, count(*)::int as n
  from audit_log
 where created_at > now() - interval '1 hour'
   and action in ('assembly_leaf_attach', 'assembly_leaf_detach')
 group by action
 order by action;
```

`assembly_leaf_attach` should appear at least once (from
scenario ⑰). `assembly_leaf_detach` may also appear if you
test the inverse to clean up.

Both actions banked in CLAUDE.md namespace docs (impl-1 + impl-2).
First canonical wire of `assembly_leaf_attach` is this PR.

## Pre-merge gates

- [x] Typecheck PASS every commit
- [x] Pattern 47 verify PASS every commit
- [x] Pattern 22 §0.5 verification PASS (with replenishment carve
      disposition)
- [x] Pattern 27 two-layer manifest per commit
- [x] Pattern 28 verbatim copy from canonical (with nexus extensions
      documented in component file headers)
- [x] Pattern 30 path-B-default (no new canonical CSS; reuses
      impl-2 r-a1v2-setup.css library + modal rules)
- [ ] CB end-of-phase smoke walk (merge gate)

## Phase wrap — Pattern 27 cumulative manifest

**STRUCTURAL coverage (3 commits across 7 steps):**
- Step 1 — Kickoff + Pattern 22 §0.5 + replenishment carve
- Step 2 — library-browse-loader + attachAssemblyLeaf action
- Steps 3-4 folded — library browse modal + Setup tree trigger
  wiring
- Steps 5-7 (this commit) — Verification + smoke guide

**Scenarios:**
- ⑰ Add existing library leaf to ASY → loadLibraryBrowse +
  attachAssemblyLeaf
- ⑱ Library search / filters → modal search + 3 filter selects
- ⑲ Leaf header ref count → verified already-shipped impl-3
- ⑳ Cascade warning on widely-referenced edit → verified
  already-shipped impl-3
- ㉑ Replenishment unchanged → CARVED to impl-7
- ㉒ Replenishment changed → CARVED to impl-7

**Audit log new wires:**
- `assembly_leaf_attach` (first canonical wire of impl-1-banked
  action; namespace doc verified matches diff_json shape)

## Carry-forwards

- Replenishment view (scenarios ㉑/㉒) → impl-7
- Prior-quote anchor schema decision → impl-7 prep
- Leaf archive + "view archived" filter → v1.1+ polish
- Pagination beyond 50 rows → v1.1+ if library grows past
  several hundred leaves
- Bulk-attach (select multiple library leaves at once) → v1.1+
