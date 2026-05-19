# Phase A.1 v2 impl-6 — PDF addendum · kickoff

**Branch:** `slice-phase-a1-v2-impl-6-pdf-addendum`
**Brief:** §5.6 Phase 6 (4-5 day estimate)
**Scenarios:** ㉓-㉘ (Group E · PDF addendum per qw_data.js)

## Companion docs

- Canonical CSS: `src/styles/r-a1v2-setup.css` covers
  `.a1v2-pdf-*`, `.a1v2-addendum-*`, `.a1v2-leaf-block` rules
  (lines 658+)
- Canonical JSX: `docs/design-prototypes/dist/qw_a1v2.jsx`:
  - `AddendumSurface` (lines 907-955) — toggle UI + PDF preview shell
  - `PricingPage` (957-1017) — base pricing page render
  - `AddendumPage` (1019-1089) — per-ASY addendum page with
    nested per-leaf blocks
- Designer notes Decision 3 (leaf sub-blocks in paper-2 inner card)
  + Decision 5 (3-state pills — N/A for addendum) + Decision 2
  (two placeholders, not one)

## Pattern 22 §0.5 verification — PASS

All entities the addendum needs are already shipped:

| Entity / column | Status | Notes |
|---|---|---|
| `assemblies` table | ✓ present | impl-1; addendum iterates ASYs in display order |
| `leaves` + `assembly_leaves` | ✓ present | impl-1; junction provides per-ASY leaf order |
| `leaf_specs` (is_current=true) | ✓ present | impl-1; addendum renders current spec values per leaf |
| `product_types.field_schema` | ✓ present | impl-1 + impl-3 patch; PP/SP/TP now have schemas |
| `quotes.*` | ✓ present | scenario_label / status etc. for the PDF header context |
| `addendum on/off` persistence | ⚠ none | per Pattern 32 disposition below |

## Pattern 45 — customer-view boundary discipline

The addendum render tree lives BELOW the customer-view boundary
guard (`scripts/verify/customer-view-boundary.ts` runs at
prebuild). New addendum components live in `src/components/pdf/`
and follow the same import discipline as existing PDF children:

- ✅ ALLOWED: React, sibling pdf/* components, `@/types/quote`
- ❌ FORBIDDEN: action layer, audit_log, costing, schema imports,
  internal-only-badge components

All addendum-side data must be pre-loaded by the server page +
flattened into the typed prop shape BEFORE crossing the boundary.

The `customer-view-boundary.ts` verifier already enforces this
at prebuild; my impl-3 addition (`leaf-spec-loader.ts`) lives
OUTSIDE the boundary tree, which is correct — the addendum
needs ITS OWN typed loader feeding ITS OWN prop shape into the
PDF subtree.

## Pattern 32 finding — addendum-on/off persistence

Brief says: "Toggle on Preview Quote ('Include spec addendum')
with leaf-count meta". The toggle state has 3 placement
candidates:

(a) **Per-quote column** — `quotes.include_spec_addendum BOOL
    DEFAULT true`. Travels with the quote; persists across PM
    sessions. New DDL.
(b) **Per-user preference** — `users.default_spec_addendum BOOL`.
    Travels with PM. New DDL.
(c) **Session/transient** — UI state only in the client toggle
    component. No persistence; resets on page reload.

**CC's call: (c) for impl-6 v1.** Reasons:
- Per Pattern 32 pre-prod tolerance, transient UI state is
  the lowest-risk minimum
- The toggle's ultimate persistence concern is "what should
  the PDF the customer sees include?" — that crystallizes at
  quote-send time (impl-7 territory). v1 pre-impl-7 has no
  customer-facing PDF generation yet; the toggle in impl-6 is
  preview-only
- If Edward + CA prefer per-quote persistence, lift via a
  follow-up migration (cheap; one nullable BOOL column)

If you disagree, lift via follow-up before merge.

## Step plan (8 commits)

1. **Step 1 — Kickoff + Pattern 22 §0.5 + Pattern 45 boundary plan**
2. **Step 2 — Server-side addendum data loader** — extends quote
   page data to load assemblies + leaves + current leaf_specs +
   product_types field_schemas, flattened into a typed
   `QuoteAddendumData` shape suitable for the PDF boundary
3. **Step 3 — AddendumPage component (untyped variant)** —
   renders `.a1v2-leaf-block.placeholder` for leaves with no
   product_type
4. **Step 4 — AddendumPage placeholder variant** — `.a1v2-leaf-
   block.placeholder` for leaves with placeholder type
   (Soft goods etc.)
5. **Step 5 — AddendumPage typed-with-schema variant** —
   `.pp-sp-grid` + per-field rendering with `--` fallback for
   empty values
6. **Step 6 — Toggle UI on Preview Quote surface** + leaf-count
   meta + empty-data suppression
7. **Step 7 — Wire addendum render conditionally based on toggle
   state** — multi-page PDF preview (pricing page + N addendum
   pages, one per ASY)
8. **Step 8 — CB smoke guide + Pattern 27 wrap**

## Risk + open items

- **Multi-page PDF preview** — the existing PdfPage component
  is single-page; addendum needs N additional pages (one per
  ASY). Either extend PdfPage to accept multi-page children OR
  render multiple PdfPage components stacked in QuoteHost.
  Latter is cleaner (less state-coupling); will explore in Step 7.
- **Pattern 30 path-B-default** — canonical CSS already covers
  all addendum rules; no new CSS file needed. JSX consumes
  `.a1v2-pdf-shell` / `.a1v2-addendum-*` / `.a1v2-leaf-block`
  per the canonical lines 658-790.
- **Pricing page existing render** — nexus already has its own
  PDF render via QuoteHost (pdf-pricing-table, pdf-header, etc.
  in src/components/pdf/). The addendum extends but doesn't
  replace the pricing render. Care needed not to break existing.

## Carry-forwards

- Addendum-on/off persistence → impl-7 (Quote umbrella +
  NetSuite finalization; pinning at quote-send may include
  addendum-in-payload preference)
- PDF generation (actual `.pdf` file output) → impl-7 or
  follow-up; impl-6 ships the IN-BROWSER preview only (matches
  current Slice RI.6 customer-view shape)
- "View diff" button on replenishment for changed leaves
  (scenario ㉒) → impl-7 replenishment view (carved from impl-5)

## Next

Step 2 — addendum data loader.
Per-commit Pattern 27 manifest. End-of-phase CB smoke at Step 8.
