# Phase A.1 v2 impl-6 — CB smoke guide

**Branch:** `slice-phase-a1-v2-impl-6-pdf-addendum`
**Scope:** scenarios ㉓-㉘ + Preview Quote addendum behaviors
**Date:** 2026-05-19

## Prep — no new fixtures

The impl-2/3/4/5 seed data is sufficient. The target quote
`f84334bd-afa1-4016-9511-71f7d5600e35` has:
- 4 assemblies (GLW-30 / GLW-50 / CAP-60 / RPL-200)
- 8 leaf attachments via assembly_leaves
- LEAF-GLW-30-PP fully populated (10/10 PP fields per
  impl-3 revert restoration)
- LEAF-GLW-FCT partial (6/11 SP fields)
- LEAF-GLW-TP empty (0/10 TP fields)
- LEAF-GLW-SG (Soft goods · placeholder)
- LEAF-GLW-UNK (untyped)

This covers every leaf-block variant the addendum renders.

## Smoke walks

Navigate to the Preview Quote surface:
`/projects/ff8c04f2-50b7-4207-98a0-53b44c85ab90/quotes/f84334bd-afa1-4016-9511-71f7d5600e35/quote`

### Scenario ㉓ — Addendum OFF · single-page pricing

**Path:** click the **Include spec addendum** toggle until it's
OFF.

**Expected:**
- Toggle .meta caption: "· pricing-only PDF"
- Below the existing pricing PdfPage(s), NO addendum pages
  render
- Pricing surface unchanged from pre-impl-6 (RI.6 baseline)

### Scenario ㉔ — Addendum ON · per-leaf blocks under ASY

**Path:** Toggle ON.

**Expected:**
- Toggle .meta caption: "· {N} leaves across {M} ASYs" with N =
  total leaves across all attached junctions; M = ASY count
- One `.a1v2-pdf-paper` per assembly that has at least one leaf
  (CAP-60 has zero leaves → its paper is suppressed per the
  internal `if (asy.leaves.length === 0) return null` guard)
- Each paper has:
  - .a1v2-addendum-header: "Product specifications" h2 +
    sub-copy "Leaf specs · for {client name}" + meta
    "Quotation"
  - .a1v2-addendum-asy: .asy-head with sku/name/leaf-count
  - Per-leaf .a1v2-leaf-block (one of 3 variants)

For GLW-30:
- One leaf: LEAF-GLW-30-PP (typed, PP, 10/10 filled) → renders
  with full PP field grid; every field shows the seeded value
  (e.g., "pp_description: 30ml dropper bottle for serum")

### Scenario ㉕ — Addendum · mixed leaf types in one ASY

**Path:** Navigate to RPL-200 in the addendum (4th paper).

**Expected:**
- RPL-200 has 4 leaves attached: LEAF-GLW-FCT (SP partial),
  LEAF-GLW-TP (TP empty), LEAF-GLW-UNK (untyped), LEAF-GLW-SG
  (Soft goods placeholder)
- Mixed variants render in sequence:
  - LEAF-GLW-FCT: typed, "Secondary packaging (SP)" type-tag,
    11-field grid (6 filled, 5 empty "--")
  - LEAF-GLW-TP: typed, "Tertiary packaging (TP)" type-tag,
    10-field grid (all 10 empty "--")
  - LEAF-GLW-UNK: untyped, .placeholder block, bad-tinted
    "untyped" type-tag, "No Product Type set · specs cannot
    render" msg
  - LEAF-GLW-SG: placeholder, "Soft goods (placeholder)"
    type-tag, "Soft goods (placeholder) · fields TBD · pending
    schema" msg

### Scenario ㉖ — Addendum · partial specs render as --

Verified by scenario ㉕'s LEAF-GLW-FCT + LEAF-GLW-TP coverage.
Empty values render the literal "--" string per canonical line
1076. The `.empty` class on `.val` allows CSS to dim/de-emphasize
visually (canonical CSS at line 770+).

### Scenario ㉗ — Addendum toggled ON · zero spec data · suppress

This requires a quote where EVERY leaf has empty spec_values
AND no untyped/placeholder leaves. The target quote has
LEAF-GLW-UNK (untyped, meaningful content) so its
hasMeaningfulContent=true.

**For dedicated ㉗ verification:** temporarily clear the spec
values on the target quote's only-filled leaf:

```sql
update leaf_specs
   set spec_values = '{}'::jsonb,
       updated_at = now()
 where id = '22222222-2222-2222-2222-222222222201';

-- Also detach the untyped + placeholder leaves to truly empty
-- the meaningful-content count:
delete from assembly_leaves
 where id in (
   '44444444-4444-4444-4444-444444444406',  -- TP on RPL-200
   '44444444-4444-4444-4444-444444444407',  -- untyped on RPL-200
   '44444444-4444-4444-4444-444444444408'   -- Soft goods on RPL-200
 );
```

**Expected after the SQL above:**
- Toggle meta caption: "· all empty — will suppress"
- NO addendum pages render even when toggle is ON

**Restore after smoke:**
```sql
-- Restore spec values via 0033 revert:
node --env-file=.env.local scripts/apply-manual-sql.mjs \
  drizzle/manual/0033_impl3_smoke_revert.sql
-- Re-attach the leaves (consider running 0030 + 0031 fixtures
-- again if missing; idempotent)
```

### Scenario ㉘ — Toggle UI · renders N leaves across M ASYs

Cumulatively verified in scenarios ㉔ + ㉗. Toggle meta caption
shows the count when content exists; suppress-warning when
not.

## Pattern 45 boundary verification

Run the prebuild verifier:

```bash
npm run verify:boundaries
```

Expected: `[customer-view-boundary] OK — 8 file(s) under
src/components/pdf/ verified clean.` (was 7 pre-impl-6; +1 for
pdf-addendum.tsx).

The addendum components live in src/components/pdf/ and import
ONLY from React + @/lib/addendum-loader (types). No costing /
audit / action / schema imports.

## Pre-merge gates

- [x] Typecheck PASS every commit
- [x] Pattern 47 verify PASS every commit
- [x] Pattern 22 §0.5 verification PASS (Pattern 32 finding on
      toggle persistence dispositioned to session-transient)
- [x] Pattern 27 two-layer manifest per commit
- [x] Pattern 28 verbatim copy from canonical (with version-
      stamp omission documented)
- [x] Pattern 30 path-B-default (no new canonical CSS; reuses
      r-a1v2-setup.css addendum rules at lines 658+)
- [x] Pattern 45 customer-view boundary clean (8 files)
- [ ] CB end-of-phase smoke walk (merge gate)

## Phase wrap — Pattern 27 cumulative manifest

**STRUCTURAL coverage (4 commits across 8 steps):**
- Step 1 — Kickoff + Pattern 22 §0.5 + Pattern 45 plan +
  Pattern 32 toggle-persistence disposition
- Step 2 — loadQuoteAddendum loader + QuoteAddendumData type
- Steps 3-5 folded — pdf-addendum.tsx with 3 leaf-block variants
- Steps 6-7 — AddendumToggle + QuoteHost wiring + multi-page
  rendering
- Step 8 (this commit) — smoke guide + Pattern 27 wrap

**Scenarios:**
- ㉓ Addendum OFF · single-page pricing → toggle-off path
- ㉔ Addendum ON · per-leaf blocks under ASY → variant=typed
- ㉕ Mixed leaf types in one ASY → all 3 variants in sequence
- ㉖ Partial specs render as "--" → .val.empty fallback
- ㉗ Zero spec data · suppress → hasMeaningfulContent guard
- ㉘ Toggle UI · renders N leaves across M ASYs → meta caption

**Audit log namespace:**
- No new audit actions (PDF preview is read-only; data crosses
  boundary unchanged)

## Carry-forwards (banked)

- Toggle persistence (per-quote column / per-user pref) → impl-7
- Version stamps in leaf-block heads → impl-7 (Pattern 45
  boundary disposition: lift `version_number` whitelist?)
- Actual PDF file generation (`.pdf` output) → impl-7 or
  follow-up; impl-6 ships in-browser preview only
- "View diff" button on replenishment (㉒ + addendum diff per
  leaf) → impl-7
