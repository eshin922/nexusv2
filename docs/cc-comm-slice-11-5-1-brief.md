# slice-11-5-1-old-table-drops — CC brief (draft)

**Branch:** `slice-11-5-1-old-table-drops` (TBD on CC kickoff)
**Baseline:** `main` post Slice 11.5 close (PR #73 merge)
**Strategic position:** **pre-launch** v1 critical-path follow-up
to Slice 11.5. Migrates 5 deeply-integrated files that still read
OLD-model cost tables, then drops the OLD tables. Required before
the launch wipe-and-reseed (Slice 11.5 Q2 posture) since legacy
reads would otherwise return empty-data states of unknown handling
quality.
**Driver:** Slice 11.5 Step 8 carve disposition + Edward
reclassification (2026-06-18) from v1.1+ → pre-launch. The 5
deeply-integrated files surfaced in the Step 8 grep audit (~215
OLD-schema refs) are not safe to leave to "either it works on
empty data or it doesn't."
**Authoring:** CC drafts post Slice 11.5 close.
**Date:** 2026-06-18

---

## §0 · Fidelity Discipline (read before every step)

This brief is a **scope contract**, not a fidelity contract.

Slice 11.5.1 is an internal architectural cleanup slice. **No CD
prototype.** UI surfaces don't change (warnings panel + admin
markup-defaults page already render; this slice keeps them
rendering identical output sourced from NEW model).

**Architectural fidelity lives in:**
- `src/lib/costing.ts` — math layer untouched; consumer of NEW
  model + adapter
- `src/lib/costing-adapter.ts` — NEW-model adapter from Slice
  11.5 Step 3; this slice does NOT modify it
- Slice 11.5 Step 5 verification doc — UI invariants from the
  Pricing surface BELOW_FLOOR review panel + Mark-Accepted
  flagged lines that warnings.ts feeds into

**Before implementing each step, CC MUST:**
1. Read brief §X.Y for scope + table mapping
2. Verify warnings.ts behavior is parity-preserved against the
   seeded sample-order quote (verifier in §5 spec)

---

## §0.5 · Schema verification (pre-approval)

Per Pattern 22 standing protocol. CC ran verification BEFORE
brief draft (Step 8 audit serves double duty here — the OLD-
schema reference inventory IS the §0.5 verification for this
slice).

**OLD tables to drop:**
- [x] `quote_skus` ✓ exists (`schema.ts` Slice 5)
- [x] `packaging_inputs` ✓ exists (`schema.ts` Slice 5)
- [x] `production_inputs` ✓ exists (`schema.ts` Slice 6)
- [x] `quote_sku_tiers` ✓ exists (`schema.ts` Slice 9.3)
- [x] `quote_sku_tier_targets` ✓ exists (`schema.ts` Slice 9.4b)

**NEW tables to read from (already shipped Slice 11.5 Step 2):**
- [x] `assembly_leaf_inputs` ✓ exists
- [x] `assembly_production_inputs` ✓ exists
- [x] `assembly_leaf_overrides` ✓ exists
- [x] `assembly_leaf_targets` ✓ exists
- [x] `assemblies` + `assembly_leaves` + `leaves` ✓ exist

**Code architecture verification (Pattern 22 extension):**
- [x] `src/app/actions/warnings.ts` reads OLD model — confirmed
- [x] `src/app/actions/markup-defaults.ts` reads OLD — confirmed
- [x] `src/app/actions/quotes.ts` references OLD quote_skus —
      audit unused functions
- [x] `src/lib/quote-guards.ts` has OLD helpers
      (`quoteForSku`, `quoteForLeafSku`, `quoteForLineGroup`) —
      NEW equivalents shipped Step 4
      (`quoteForAssembly`, `quoteForAssemblyLeaf`,
      `quoteForAssemblyLeafInputLineGroup`)
- [x] `src/lib/sku-tree.ts` already migrated to structural
      `SkuRow` in Slice 11.5 Step 8 (PR #73)

No §0.5 catches surfaced. Inventory is complete.

---

## §1 · Strategic framing

**Pre-launch positioning.** Per Edward 2026-06-18: Slice 11.5.1
is pre-launch, not v1.1+. The wipe-and-reseed at launch (Slice
11.5 Q2 posture) eliminates OLD-table data. Once data is gone,
legacy reads in the 5 files either:
- Break (NULL handling, type assumptions)
- Render degraded (empty warnings, empty admin views)
- Work fine

We can't safely wipe OLD tables at launch unless 11.5.1 has
shipped. Pre-launch slot is mandatory.

**Slottable in v1 critical path:**
- After Slice 11.5 close (PR #73 merged) and CB walks sign off
- Before Slice 11 audit OR in parallel with Slice 12 external
  lead time

**Scope (5 files + 1 schema drop):**

| File | Migration |
|---|---|
| `src/app/actions/warnings.ts` | Validation engine reads NEW-model rows |
| `src/app/actions/markup-defaults.ts` | Admin category-usage counts from NEW |
| `src/app/actions/quotes.ts` | Delete unused quote_skus-only functions |
| `src/lib/quote-guards.ts` | Delete OLD helpers; NEW already shipped |
| `src/db/schema.ts` | Drop 5 OLD tables + generate drop migration |

---

## §2 · Architecture

### warnings.ts validation engine migration

`src/app/actions/warnings.ts` is the Slice 9.5 validation engine.
Surfaces warnings on:
- Pricing surface BELOW_FLOOR review panel
  (`LinesRequiringReview` component)
- Mark-Accepted flagged lines section

Engine reads:
- `quote_skus` (for SKU iteration)
- `packaging_inputs` (for packaging cell warnings)
- `production_inputs` (for production cell warnings)
- `quote_sku_tiers` (for override warnings)
- `quote_sku_tier_targets` (for target warnings)

**Migration:** rewrite reads to consume the **same adapter
output that getCostingBundle already produces**. The bundle's
`skuRollups[]` already exposes per-(leaf, tier) margin status,
sell sources, contribution costs — everything the warnings
engine needs without re-querying raw cost tables. Engine
becomes a pure projection from bundle → warnings list.

This is the cleanest reframe: warnings.ts becomes downstream of
the math layer, NOT a parallel reader of raw data. Pattern 22 §3
math-layer-as-load-bearing-surface principle extends naturally.

### markup-defaults.ts admin queries

Three queries currently read `packaging_inputs.category`:
1. List categories with usage counts (display in admin)
2. Count rows using a category before delete (warning)
3. Cascade-delete rows when admin removes a category (rare)

**Migration:** swap `packaging_inputs` → `assembly_leaf_inputs`
in all three. Same column name (`category`); same semantics. ~10
line change per query.

### actions/quotes.ts audit + cleanup

Functions to audit for remaining callers after Slice 11.5 Step
8 orphan deletes:
- `addSkuFromHubspotProduct` (UI: orphan; delete)
- `addProductSku` (UI: orphan; delete)
- `addAssemblySku` (UI: orphan; delete)
- `reorderQuoteSkus` (UI: orphan; delete)
- `updateQtyPerParent` (UI: orphan; delete)
- `assignSkuToParent` (UI: orphan; delete)
- `unassignSkuFromParent` (UI: orphan; delete)
- `convertSkuRole` (UI: orphan; delete)
- `convertLeafToAssemblyDestructive` (UI: orphan; delete)
- `attachAndConvertToLeaf` (UI: orphan; delete)
- `refreshSkuFromHubspot` (UI: orphan; delete)
- `updateSku` (UI: orphan; delete)
- `deleteSku` (UI: orphan; delete)
- `moveSku` (UI: orphan; delete)
- `checkProductSku` (UI: ?; audit)
- `getCurrentHubspotOwner` (UI: ?; audit — Add Product modal may still call)

**Preserve** (tier-side + quote-level — not quote_skus-bound):
- `createQuote`, `createScenario`, `setScenarioRecommended`,
  `updateQuoteNotes`, `searchHubspotProductsAction`,
  `addTier`, `updateTier`, `setTierRecommended`, `deleteTier`,
  `moveTier`, `applyTierPreset`, `sendQuote`,
  `recordCustomerAcceptance`, `clearCustomerAcceptance`

### quote-guards.ts cleanup

Remove `quoteForSku`, `quoteForLeafSku`, `quoteForLineGroup`.
NEW counterparts already shipped Slice 11.5 Step 4. Confirm
no remaining callers post-cleanup.

### schema.ts drop migration

Drop in this order (FK dependency safety):
```sql
DROP TABLE quote_sku_tier_targets;
DROP TABLE quote_sku_tiers;
DROP TABLE production_inputs;
DROP TABLE packaging_inputs;
DROP TABLE quote_skus;  -- cascading FKs already cleared
```

Generate via drizzle-kit after schema.ts edits.

---

## §3 · Verification

### Parity test (CC pre-PR)

**warnings parity verifier:** load the seeded sample-order
quote, run warnings engine pre-migration (current code) vs
post-migration (new code), assert identical warning list shape
+ content + order.

The seeded sample order (Slice 11.5 Step 6) is the canonical
fixture; runs against prod DB.

### Browser smoke walks (CB)

- **Walk 1:** Pricing surface — open seeded sample order, scroll
  to LinesRequiringReview. Should be empty (all GOOD margins).
  Override one cell below floor → flagged line surfaces with
  correct (assembly_leaf-keyed) identity.
- **Walk 2:** Mark-Accepted page — open seeded sample order →
  flaggedLines section empty (all GOOD). Override one cell
  below floor → flagged line surfaces in modal.
- **Walk 3:** Admin markup-defaults page — open
  `/admin/markup-defaults`. Category usage counts render
  correctly (sample order has 9 assembly_leaf_inputs rows
  across Primary / Secondary / Soft Goods categories).

---

## §4 · Step plan

3-4 steps over ~half-day to one day:

### Step 1 · warnings.ts migration
- Rewrite engine to consume `bundle.data.costing.skuRollups`
  instead of raw cost tables
- Update parity verifier
- Run verifier against sample order

### Step 2 · markup-defaults.ts migration
- Swap `packaging_inputs` → `assembly_leaf_inputs` in 3 queries
- Smoke admin page

### Step 3 · quotes.ts + quote-guards.ts cleanup
- Audit + delete unused functions
- Remove OLD guard helpers
- tsc check

### Step 4 · Drop schema + migration + apply
- Edit `src/db/schema.ts` to remove OLD tables
- drizzle-kit generate
- Apply migration to prod (per Slice 11.5 Step 2 pattern)
- Verify schema diff is exactly the 5 drops + cascading FK
  cleanup
- PR open + merge

---

## §5 · Cutover plan

**Hard cutover at slice merge** (mirrors Slice 11.5 Q5 posture).

### Pre-merge tasks
1. CC verifies parity verifier passes
2. CC verifies tsc clean post-deletion
3. CB walks 1-3 sign off

### Merge day
1. PR merges
2. Production deploys
3. drizzle-kit migrate against prod drops OLD tables

### Post-merge monitoring (Week 1)
- Pricing surface BELOW_FLOOR review panel renders correctly
  on any quote that triggers warnings
- Mark-Accepted flagged lines section renders correctly
- Admin markup-defaults page renders correctly

### Rollback plan
Git revert + redeploy. OLD tables are dropped at merge time;
rollback restores schema.ts but the prod DB has lost the
tables. Recovery: backup-restore from Supabase point-in-time
recovery (Pro tier supports 7-day PITR). Risk window is
short — if smoke surfaces a bug Week 1, revert + restore is
clean.

---

## §6 · Out of scope / banked v1.1+

- **Per-assembly production fan-out math layer extension** —
  remains v1.1+ per CB walk outcome
- **Per-component flagging mitigation** — remains v1.1+ per
  CB walk outcome
- **copyTier helper** — remains v1.1+ ("promote if PMs ask")

---

## §7 · §0.5 ledger update post-this-brief

- Slice 11.5.1 contributes 0 §0.5 catches (inventory done
  during Slice 11.5 Step 8 audit; no new catches surfaced)
- Cumulative across slices post-this-brief: **68 across 15
  slices**

---

**Status: draft, awaiting CB sign-off on Slice 11.5 MIG walks
1-9.** Once CB closes Slice 11.5 formally, this brief reads as
ready for Edward approval + Step 1 kickoff. Small-scope slice;
no Pattern 22-heavy review needed per Edward's 2026-06-18 note
(inventory is already done).
